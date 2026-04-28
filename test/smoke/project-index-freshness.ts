import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AstFindPatternToolOutput,
  ProjectIndexRefreshToolOutput,
  ProjectIndexStatusToolOutput,
} from "../../packages/contracts/src/index.ts";
import { createProjectStoreCache } from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { indexProject } from "../../services/indexer/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-index-freshness-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  const originalReefBacked = process.env.MAKO_REEF_BACKED;
  const originalReefMode = process.env.MAKO_REEF_MODE;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "index-freshness-smoke" }));
  writeFileSync(path.join(projectRoot, "src", "alpha.ts"), "export const value = 1;\n");
  writeFileSync(path.join(projectRoot, "src", "delete-me.ts"), "export const deleteMe = true;\n");

  const cache = createProjectStoreCache();
  try {
    const indexed = await indexProject(projectRoot, { projectStoreCache: cache });
    const borrowedStore = cache.borrow({ projectRoot });
    const initialFile = borrowedStore.findFile("src/alpha.ts");
    assert.ok(initialFile, "indexed file exists in borrowed cache store");

    const fresh = await invokeTool(
      "project_index_status",
      { projectId: indexed.project.projectId },
      { projectStoreCache: cache },
    ) as ProjectIndexStatusToolOutput;
    assert.equal(fresh.toolName, "project_index_status");
    assert.equal(fresh.freshness.state, "fresh");
    assert.equal(fresh.unindexedScan.status, "skipped");
    assert.equal(fresh.suggestedAction, "none");
    assert.equal(fresh.reefFacts?.source, "working_tree_overlay");
    assert.equal(fresh.reefFacts?.kind, "file_snapshot");
    assert.equal(fresh.reefFacts?.truncated, false);

    writeFileSync(path.join(projectRoot, "src", "new-file.ts"), "export const added = true;\n");

    const freshWithoutDiskWalk = await invokeTool(
      "project_index_status",
      { projectId: indexed.project.projectId },
      { projectStoreCache: cache },
    ) as ProjectIndexStatusToolOutput;
    assert.equal(freshWithoutDiskWalk.freshness.state, "fresh");
    assert.equal(freshWithoutDiskWalk.freshness.unindexedCount, 0);
    assert.equal(freshWithoutDiskWalk.unindexedScan.status, "skipped");
    assert.match(freshWithoutDiskWalk.unindexedScan.message, /includeUnindexed/);

    const watcherHint = await invokeTool(
      "project_index_status",
      { projectId: indexed.project.projectId },
      {
        projectStoreCache: cache,
        indexRefreshCoordinator: {
          getWatchState: () => ({
            mode: "watch",
            status: "dirty",
            projectId: indexed.project.projectId,
            projectRoot,
            dirtyPaths: ["src/new-file.ts"],
          }),
        },
      },
    ) as ProjectIndexStatusToolOutput;
    assert.equal(watcherHint.unindexedScan.status, "watch_hint");
    assert.equal(watcherHint.unindexedScan.possibleCount, 1);
    assert.equal(watcherHint.suggestedAction, "project_index_refresh");

    const unindexed = await invokeTool(
      "project_index_status",
      { projectId: indexed.project.projectId, includeUnindexed: true },
      { projectStoreCache: cache },
    ) as ProjectIndexStatusToolOutput;
    assert.equal(unindexed.freshness.state, "dirty");
    assert.equal(unindexed.freshness.unindexedCount, 1);
    assert.equal(unindexed.unindexedScan.status, "included");
    assert.equal(unindexed.unindexedScan.count, 1);
    assert.equal(unindexed.suggestedAction, "project_index_refresh");

    writeFileSync(
      path.join(projectRoot, "src", "alpha.ts"),
      "export const value = 123456;\nexport const changed = true;\n",
    );

    const stale = await invokeTool(
      "project_index_status",
      { projectId: indexed.project.projectId },
      { projectStoreCache: cache },
    ) as ProjectIndexStatusToolOutput;
    assert.equal(stale.freshness.state, "dirty");
    assert.ok(stale.freshness.staleCount >= 1);
    assert.equal(stale.suggestedAction, "project_index_refresh");
    assert.ok(stale.freshness.sample.some((detail) => detail.filePath === "src/alpha.ts"));

    const staleAst = await invokeTool(
      "ast_find_pattern",
      {
        projectId: indexed.project.projectId,
        pattern: "export const value = 1",
        pathGlob: "src/alpha.ts",
      },
      { projectStoreCache: cache },
    ) as AstFindPatternToolOutput;
    assert.equal(staleAst.matches.length, 0, "stale indexed files should be skipped by the Reef AST freshness guard");
    assert.equal(staleAst.reefFreshness.reefMode, "in_process");
    assert.equal(staleAst.reefFreshness.freshnessPolicy, "require_fresh");
    assert.equal(staleAst.reefFreshness.state, "dirty");
    assert.ok((staleAst.reefFreshness.staleEvidenceDropped ?? 0) > 0);
    assert.ok(staleAst.warnings.some((warning) => warning.includes("Reef freshness guard")));
    assert.equal(
      staleAst.warnings.some((warning) => warning.includes("no indexed files matched the language/glob filters")),
      false,
    );

    rmSync(path.join(projectRoot, "src", "delete-me.ts"));
    const deletedAst = await invokeTool(
      "ast_find_pattern",
      {
        projectId: indexed.project.projectId,
        pattern: "export const deleteMe = true",
        pathGlob: "src/delete-me.ts",
      },
      { projectStoreCache: cache },
    ) as AstFindPatternToolOutput;
    assert.equal(deletedAst.matches.length, 0, "deleted indexed files should be skipped by the Reef AST guard");
    assert.equal(deletedAst.reefFreshness.state, "dirty");
    assert.ok((deletedAst.reefFreshness.staleEvidenceDropped ?? 0) > 0);

    process.env.MAKO_REEF_MODE = "legacy";
    process.env.MAKO_REEF_BACKED = "ast_find_pattern";
    try {
      const legacyModeAst = await invokeTool(
        "ast_find_pattern",
        {
          projectId: indexed.project.projectId,
          pattern: "export const value = 1",
          pathGlob: "src/alpha.ts",
        },
        { projectStoreCache: cache },
      ) as AstFindPatternToolOutput;
      assert.equal(
        legacyModeAst.matches.length,
        1,
        "MAKO_REEF_MODE=legacy should globally bypass the Reef freshness gate",
      );
      assert.equal(legacyModeAst.reefFreshness.reefMode, "legacy");
    } finally {
      restoreEnv("MAKO_REEF_MODE", originalReefMode);
      restoreEnv("MAKO_REEF_BACKED", originalReefBacked);
    }

    process.env.MAKO_REEF_BACKED = "legacy";
    try {
      const legacyStaleAst = await invokeTool(
        "ast_find_pattern",
        {
          projectId: indexed.project.projectId,
          pattern: "export const value = 1",
          pathGlob: "src/alpha.ts",
        },
        { projectStoreCache: cache },
      ) as AstFindPatternToolOutput;
      assert.equal(
        legacyStaleAst.matches.length,
        1,
        "MAKO_REEF_BACKED=legacy should keep the old indexed-snapshot AST behavior available",
      );
      assert.equal(legacyStaleAst.reefFreshness.reefMode, "legacy");
    } finally {
      restoreEnv("MAKO_REEF_BACKED", originalReefBacked);
    }

    const refreshed = await invokeTool(
      "project_index_refresh",
      {
        projectId: indexed.project.projectId,
        mode: "if_stale",
        reason: "smoke refresh",
      },
      { projectStoreCache: cache },
    ) as ProjectIndexRefreshToolOutput;
    assert.equal(refreshed.toolName, "project_index_refresh");
    assert.equal(refreshed.skipped, false);
    assert.equal(refreshed.reason, "index refresh completed");
    assert.equal(refreshed.operatorReason, "smoke refresh");
    assert.equal(refreshed.before.state, "dirty");
    assert.equal(refreshed.after?.state, "fresh");
    assert.equal(refreshed.run?.triggerSource, "mcp_refresh");

    const refreshedFile = borrowedStore.findFile("src/alpha.ts");
    assert.ok(refreshedFile, "refreshed file is visible through the same borrowed cache handle");
    assert.notEqual(refreshedFile.sizeBytes, initialFile.sizeBytes);

    const oldAst = await invokeTool(
      "ast_find_pattern",
      {
        projectId: indexed.project.projectId,
        pattern: "export const value = 1",
        pathGlob: "src/alpha.ts",
      },
      { projectStoreCache: cache },
    ) as { matches: unknown[] };
    assert.equal(oldAst.matches.length, 0, "old AST/chunk content should be gone after refresh");

    const refreshedAst = await invokeTool(
      "ast_find_pattern",
      {
        projectId: indexed.project.projectId,
        pattern: "export const changed = true",
        pathGlob: "src/alpha.ts",
      },
      { projectStoreCache: cache },
    ) as { matches: unknown[] };
    assert.equal(refreshedAst.matches.length, 1, "refreshed AST/chunk content should be searchable");

    const newFileAst = await invokeTool(
      "ast_find_pattern",
      {
        projectId: indexed.project.projectId,
        pattern: "export const added = true",
        pathGlob: "src/new-file.ts",
      },
      { projectStoreCache: cache },
    ) as { matches: unknown[] };
    assert.equal(newFileAst.matches.length, 1, "newly indexed file should be searchable after refresh");

    console.log("project-index-freshness: PASS");
  } finally {
    cache.flush();
    if (originalStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = originalStateHome;
    }
    if (originalStateDirName === undefined) {
      delete process.env.MAKO_STATE_DIRNAME;
    } else {
      process.env.MAKO_STATE_DIRNAME = originalStateDirName;
    }
    restoreEnv("MAKO_REEF_BACKED", originalReefBacked);
    restoreEnv("MAKO_REEF_MODE", originalReefMode);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
