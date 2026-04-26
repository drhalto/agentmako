import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LiveTextSearchToolOutput } from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { toProjectRelativePath } from "../../packages/tools/src/live-text-search/paths.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "live-text-search-smoke" }));
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
  mkdirSync(path.join(projectRoot, "components", "onboarding"), { recursive: true });
  writeFileSync(path.join(projectRoot, "src", "alpha.ts"), "export const firstNeedle = 'needle';\n");
  writeFileSync(path.join(projectRoot, "src", "beta.ts"), "export const secondNeedle = 'NEEDLE';\n");
  writeFileSync(path.join(projectRoot, "docs", "notes.md"), "needle in docs\n");
  writeFileSync(
    path.join(projectRoot, "components", "onboarding", "RegisterButton.tsx"),
    "export function RegisterButton() {\n  return useMediaQuery('(min-width: 768px)');\n}\n",
  );

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "live-text-search-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const projectStore = openProjectStore({ projectRoot });
  try {
    projectStore.saveProjectProfile({
      name: "live-text-search-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });
  } finally {
    projectStore.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-live-text-search-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalPath = process.env.PATH;
  const originalWindowsPath = process.env.Path;
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;
  process.env.PATH = "";
  process.env.Path = "";

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    assert.equal(toProjectRelativePath(projectRoot, path.join(projectRoot, "src", "alpha.ts")), "src/alpha.ts");
    assert.equal(toProjectRelativePath(projectRoot, path.join(tmp, "outside.ts")), null);

    const srcOnly = await invokeTool("live_text_search", {
      projectId,
      query: "needle",
      pathGlob: "src/**/*.ts",
    }) as LiveTextSearchToolOutput;

    assert.equal(srcOnly.toolName, "live_text_search");
    assert.equal(srcOnly.projectId, projectId);
    assert.equal(srcOnly.evidenceMode, "live_filesystem");
    assert.deepEqual(srcOnly.filesMatched, ["src/alpha.ts", "src/beta.ts"]);
    assert.equal(srcOnly.matches.length, 2);
    assert.ok(srcOnly.matches.every((match) => match.filePath.startsWith("src/")));

    const shallowGlob = await invokeTool("live_text_search", {
      projectId,
      query: "useMediaQuery(",
      pathGlob: "components/onboarding/*.tsx",
    }) as LiveTextSearchToolOutput;

    assert.deepEqual(shallowGlob.filesMatched, ["components/onboarding/RegisterButton.tsx"]);
    assert.equal(shallowGlob.matches.length, 1, "shallow-star pathGlob should match direct children");

    const regexEscaped = await invokeTool("live_text_search", {
      projectId,
      query: "useMediaQuery\\(",
      fixedStrings: false,
      pathGlob: "components/onboarding/*.tsx",
    }) as LiveTextSearchToolOutput;

    assert.deepEqual(regexEscaped.filesMatched, ["components/onboarding/RegisterButton.tsx"]);
    assert.equal(regexEscaped.matches.length, 1, "fixedStrings: false should honor ripgrep regex escapes");

    writeFileSync(path.join(projectRoot, "src", "fresh.ts"), "fresh-unindexed-needle\n");
    const fresh = await invokeTool("live_text_search", {
      projectId,
      query: "fresh-unindexed-needle",
      pathGlob: "src/fresh.ts",
    }) as LiveTextSearchToolOutput;

    assert.deepEqual(fresh.filesMatched, ["src/fresh.ts"]);
    assert.equal(fresh.matches.length, 1);

    const truncated = await invokeTool("live_text_search", {
      projectId,
      query: "needle",
      maxMatches: 1,
    }) as LiveTextSearchToolOutput;

    assert.equal(truncated.matches.length, 1);
    assert.equal(truncated.truncated, true);
    assert.ok(truncated.warnings.some((warning) => warning.includes("matches capped at 1")));

    console.log("live-text-search: PASS");
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalWindowsPath === undefined) {
      delete process.env.Path;
    } else {
      process.env.Path = originalWindowsPath;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
