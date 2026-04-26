import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AstFindPatternToolOutput } from "../../packages/contracts/src/index.ts";
import { createProjectStoreCache } from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { indexProject, refreshProjectPaths } from "../../services/indexer/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-path-refresh-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "path-refresh-smoke" }));
  writeFileSync(
    path.join(projectRoot, "src", "alpha.ts"),
    [
      "export function stableValue() {",
      "  return 'old-value';",
      "}",
    ].join("\n") + "\n",
  );
  writeFileSync(
    path.join(projectRoot, "src", "beta.ts"),
    [
      "import { stableValue } from './alpha';",
      "export const beta = stableValue();",
    ].join("\n") + "\n",
  );
  writeFileSync(
    path.join(projectRoot, "src", "unused.ts"),
    "const unused = true;\n",
  );

  const cache = createProjectStoreCache();
  try {
    const indexed = await indexProject(projectRoot, { projectStoreCache: cache });
    writeFileSync(
      path.join(projectRoot, "src", "alpha.ts"),
      [
        "export function stableValue() {",
        "  return 'new-value';",
        "}",
      ].join("\n") + "\n",
    );

    const refreshed = await refreshProjectPaths(projectRoot, ["src/alpha.ts"], {
      projectStoreCache: cache,
      triggerSource: "smoke_paths",
    });
    assert.equal(refreshed.mode, "paths");
    assert.equal(refreshed.run.triggerSource, "smoke_paths");
    assert.equal(refreshed.fallbackReason, undefined);

    const oldAst = await invokeTool(
      "ast_find_pattern",
      {
        projectId: indexed.project.projectId,
        pattern: "return 'old-value'",
        pathGlob: "src/alpha.ts",
      },
      { projectStoreCache: cache },
    ) as AstFindPatternToolOutput;
    assert.equal(oldAst.matches.length, 0, "path refresh should delete stale AST/chunk rows");

    const newAst = await invokeTool(
      "ast_find_pattern",
      {
        projectId: indexed.project.projectId,
        pattern: "return 'new-value'",
        pathGlob: "src/alpha.ts",
      },
      { projectStoreCache: cache },
    ) as AstFindPatternToolOutput;
    assert.equal(newAst.matches.length, 1, "path refresh should insert replacement AST/chunk rows");

    const store = cache.borrow({ projectRoot });
    const dependents = store.listDependentsForFile("src/alpha.ts");
    assert.equal(dependents.some((edge) => edge.sourcePath === "src/beta.ts" && edge.targetExists), true);

    unlinkSync(path.join(projectRoot, "src", "unused.ts"));
    const deleted = await refreshProjectPaths(projectRoot, ["src/unused.ts"], {
      projectStoreCache: cache,
      triggerSource: "smoke_paths_delete",
    });
    assert.equal(deleted.mode, "paths");
    assert.equal(store.listFiles().some((file) => file.path === "src/unused.ts"), false);

    writeFileSync(
      path.join(projectRoot, "src", "alpha.ts"),
      [
        "export function renamedValue() {",
        "  return 'renamed';",
        "}",
      ].join("\n") + "\n",
    );
    const fullFallback = await refreshProjectPaths(projectRoot, ["src/alpha.ts"], {
      projectStoreCache: cache,
      triggerSource: "smoke_paths_export_change",
    });
    assert.equal(fullFallback.mode, "full");
    assert.equal(fullFallback.fallbackReason, "exported symbol set changed");

    console.log("path-scoped-refresh: PASS");
  } finally {
    cache.flush();
    restoreEnv("MAKO_STATE_HOME", originalStateHome);
    restoreEnv("MAKO_STATE_DIRNAME", originalStateDirName);
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
