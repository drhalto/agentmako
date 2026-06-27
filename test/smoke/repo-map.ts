/**
 * `repo_map` smoke — token-budgeted aider-style project outline.
 *
 * Seeds a 4-file project with a realistic import graph:
 *   - lib/core.ts     (pure leaf, no outbound; imported by 2)
 *   - lib/shared.ts   (imports core; imported by 1)
 *   - app/page.tsx    (imports core + shared; not imported)
 *   - vendor/util.js  (isolated, no edges)
 *
 * Asserts:
 * - ranking follows import-graph PageRank (lib/core.ts ranks highest — most reused)
 * - symbol selection surfaces exported declarations first
 * - `focusFiles` boost moves a file to the top regardless of centrality
 * - focused maps include both dependencies and dependents
 * - isolated `focusFiles` omit unrelated zero-reach files with a warning
 * - `pathGlob` filters the file set
 * - token-budget trimming drops files when the budget is tight
 * - aider-style formatter renders `⋮...│` elisions correctly
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { RepoMapToolOutput } from "../../packages/contracts/src/index.ts";
import { rankImportGraphFiles } from "../../packages/tools/src/code-intel/import-graph-ranking.ts";
import { matchesPathGlob } from "../../packages/tools/src/code-intel/path-globs.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "repo-map-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "lib"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app"), { recursive: true });
  mkdirSync(path.join(projectRoot, "vendor"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "repo-map-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const coreContent = [
    "export class UserService {",
    "  findById(id: string) { return null; }",
    "}",
    "export function loadUser(id: string) { return null; }",
    "const internalHelper = 1;",
  ].join("\n");

  const sharedContent = [
    "import { UserService } from './core';",
    "export function buildUserService() { return new UserService(); }",
  ].join("\n");

  const pageContent = [
    "import { UserService } from '../lib/core';",
    "import { buildUserService } from '../lib/shared';",
    "export function Page() { return buildUserService(); }",
  ].join("\n");

  const vendorContent = [
    "export function vendorHelper(x) { return x + 1; }",
  ].join("\n");

  writeFileSync(path.join(projectRoot, "lib", "core.ts"), `${coreContent}\n`);
  writeFileSync(path.join(projectRoot, "lib", "shared.ts"), `${sharedContent}\n`);
  writeFileSync(path.join(projectRoot, "app", "page.tsx"), `${pageContent}\n`);
  writeFileSync(path.join(projectRoot, "vendor", "util.js"), `${vendorContent}\n`);

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "repo-map-smoke",
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

    const file = (
      relPath: string,
      content: string,
      language: "typescript" | "tsx" | "javascript",
      symbols: Array<{
        name: string;
        kind: string;
        exportName?: string;
        lineStart?: number;
        lineEnd?: number;
      }>,
      imports: Array<{ targetPath: string; specifier: string }>,
      routes: Array<{ routeKey: string; pattern: string; method?: string; handlerName?: string; isApi?: boolean }> = [],
    ) => ({
      path: relPath,
      sha256: relPath,
      language,
      sizeBytes: content.length,
      lineCount: content.split("\n").length,
      chunks: [
        {
          chunkKind: "file" as const,
          name: relPath,
          lineStart: 1,
          lineEnd: content.split("\n").length,
          content,
        },
      ],
      symbols,
      imports: imports.map((edge) => ({
        targetPath: edge.targetPath,
        specifier: edge.specifier,
        importKind: "static",
        isTypeOnly: false,
      })),
      routes: routes.map((route) => ({
        framework: "nextjs",
        ...route,
      })),
    });

    store.replaceIndexSnapshot({
      files: [
        file(
          "lib/core.ts",
          coreContent,
          "typescript",
          [
            { name: "UserService", kind: "class", exportName: "UserService", lineStart: 1, lineEnd: 3 },
            { name: "loadUser", kind: "function", exportName: "loadUser", lineStart: 4, lineEnd: 4 },
            { name: "internalHelper", kind: "variable", lineStart: 5, lineEnd: 5 },
          ],
          [],
        ),
        file(
          "lib/shared.ts",
          sharedContent,
          "typescript",
          [
            {
              name: "buildUserService",
              kind: "function",
              exportName: "buildUserService",
              lineStart: 2,
              lineEnd: 2,
            },
          ],
          [{ targetPath: "lib/core.ts", specifier: "./core" }],
        ),
        file(
          "app/page.tsx",
          pageContent,
          "tsx",
          [{ name: "Page", kind: "function", exportName: "Page", lineStart: 3, lineEnd: 3 }],
          [
            { targetPath: "lib/core.ts", specifier: "../lib/core" },
            { targetPath: "lib/shared.ts", specifier: "../lib/shared" },
          ],
          [{
            routeKey: "GET /",
            pattern: "/",
            method: "GET",
            handlerName: "Page",
            isApi: false,
          }],
        ),
        file(
          "vendor/util.js",
          vendorContent,
          "javascript",
          [{ name: "vendorHelper", kind: "function", exportName: "vendorHelper", lineStart: 1, lineEnd: 1 }],
          [],
        ),
      ],
      schemaObjects: [{
        objectKey: "table:public.user_profiles",
        objectType: "table",
        schemaName: "public",
        objectName: "user_profiles",
      }],
      schemaUsages: [{
        objectKey: "table:public.user_profiles",
        filePath: "lib/shared.ts",
        usageKind: "read",
        line: 2,
        excerpt: "export function buildUserService() { return new UserService(); }",
      }],
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  assert.equal(matchesPathGlob("lib/core.ts", "lib/**/*.ts"), true);
  assert.equal(matchesPathGlob("lib/core.ts", "lib/{core,shared}.ts"), false);
  assert.equal(matchesPathGlob("lib/core.ts", "lib/+(core).ts"), false);

  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-repo-map-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    const graphStore = openProjectStore({ projectRoot });
    try {
      const absoluteSeedRanks = rankImportGraphFiles(graphStore, {
        seedPaths: [path.join(projectRoot, "lib", "shared.ts")],
        personalizationDirection: "bidirectional",
      });
      const absoluteSeedEntry = absoluteSeedRanks.find((entry) => entry.filePath === "lib/shared.ts");
      assert.ok(absoluteSeedEntry, "absolute seed should resolve to the indexed relative file path");
      assert.equal(
        absoluteSeedEntry.mode,
        "personalized",
        "rankImportGraphFiles should canonicalize absolute platform-specific seed paths",
      );
      assert.equal(absoluteSeedEntry.focusRelation, "self");
    } finally {
      graphStore.close();
    }

    // --- 1. Default call: ranking, symbol selection, formatter ---
    const map = (await invokeTool("repo_map", {
      projectId,
    })) as RepoMapToolOutput;
    assert.equal(map.toolName, "repo_map");
    assert.equal(map.projectId, projectId);
    assert.equal(map.totalFilesIndexed, 4);
    assert.equal(map.totalFilesEligible, 4);
    assert.equal(map.truncatedByBudget, false);
    assert.equal(map.truncatedByMaxFiles, false);

    // lib/core.ts has the most inbound edges (2), so it should rank first
    // even though its outbound count is zero.
    assert.equal(
      map.files[0]?.filePath,
      "lib/core.ts",
      "lib/core.ts has the highest inbound count and should rank first",
    );
    assert.equal(map.files[0]?.inboundCount, 2);
    assert.equal(map.files[0]?.outboundCount, 0);
    assert.equal(map.files[0]?.graphRankMode, "global");
    assert.equal(map.files[0]?.graphRankDirection, "outbound");
    assert.ok(Number(map.files[0]?.graphRank ?? 0) > 0, "repo_map should expose the raw graph rank");
    assert.ok(
      Number(map.files[0]?.graphRankScore ?? 0) > 0,
      "repo_map should expose the unboosted graph rank score",
    );

    // Symbol selection should surface exported class/function before variable.
    const coreSymbols = map.files[0]?.symbolsIncluded ?? [];
    assert.ok(coreSymbols.length >= 2);
    assert.equal(coreSymbols[0]?.name, "UserService", "exported class should rank first");
    assert.equal(coreSymbols[0]?.exported, true);
    assert.ok(coreSymbols.some((s) => s.name === "loadUser" && s.exported));
    // Non-exported `internalHelper` ranks last; with maxSymbolsPerFile=6 it
    // still lands but after the exports.
    const internalIdx = coreSymbols.findIndex((s) => s.name === "internalHelper");
    if (internalIdx >= 0) {
      assert.ok(internalIdx > 0, "non-exported variable should not rank first");
    }

    // Renderer emits aider-style elision markers around kept signatures.
    assert.ok(map.rendered.includes("lib/core.ts:"));
    assert.ok(map.rendered.includes("⋮..."));
    assert.ok(map.rendered.includes("│"), "rendered output should include left-bar signature lines");

    // --- 2. focusFiles boost moves a low-centrality file to the top ---
    const focused = (await invokeTool("repo_map", {
      projectId,
      focusFiles: ["vendor/util.js"],
    })) as RepoMapToolOutput;
    assert.equal(
      focused.files[0]?.filePath,
      "vendor/util.js",
      "focus boost should move vendor/util.js to the top",
    );
    assert.equal(focused.files[0]?.graphRankMode, "personalized");
    assert.equal(focused.files[0]?.graphRankDirection, "bidirectional");
    assert.equal(focused.files[0]?.focusRelation, "self");
    assert.equal(focused.files[0]?.focusDistance, 0);
    assert.ok(
      Number(focused.files[0]?.score ?? 0) > Number(focused.files[0]?.graphRankScore ?? 0),
      "focused file score should include the focus boost while preserving raw graphRankScore",
    );
    assert.equal(
      focused.files.length,
      1,
      "isolated focus file should not pull arbitrary zero-rank files into a personalized map",
    );
    assert.ok(
      focused.warnings.some((warning) =>
        warning.includes("outside the focused import graph")
      ),
      "focused repo_map should warn when unrelated zero-rank files are omitted",
    );

    // --- 3. focused maps include both dependencies and dependents ---
    const sharedFocused = (await invokeTool("repo_map", {
      projectId,
      focusFiles: ["lib/shared.ts"],
      tokenBudget: 10000,
    })) as RepoMapToolOutput;
    const sharedFocusedPaths = new Set(sharedFocused.files.map((file) => file.filePath));
    assert.equal(
      sharedFocused.files[0]?.filePath,
      "lib/shared.ts",
      "focused file should remain first in a personalized map",
    );
    assert.equal(sharedFocused.files[0]?.graphRankMode, "personalized");
    assert.equal(sharedFocused.files[0]?.graphRankDirection, "bidirectional");
    assert.equal(sharedFocused.files[0]?.focusRelation, "self");
    assert.ok(
      sharedFocusedPaths.has("lib/core.ts"),
      "focused map should include dependencies of the focused file",
    );
    assert.ok(
      sharedFocusedPaths.has("app/page.tsx"),
      "focused map should include dependents of the focused file",
    );
    assert.equal(
      sharedFocusedPaths.has("vendor/util.js"),
      false,
      "focused map should omit unrelated isolated files",
    );
    const sharedDependency = sharedFocused.files.find((file) => file.filePath === "lib/core.ts");
    assert.equal(sharedDependency?.focusRelation, "dependency");
    assert.equal(sharedDependency?.dependencyDistance, 1);
    assert.equal(sharedDependency?.focusDistance, 1);
    const sharedDependent = sharedFocused.files.find((file) => file.filePath === "app/page.tsx");
    assert.equal(sharedDependent?.focusRelation, "dependent");
    assert.equal(sharedDependent?.dependentDistance, 1);
    assert.equal(sharedDependent?.focusDistance, 1);

    const normalizedFocus = (await invokeTool("repo_map", {
      projectId,
      focusFiles: [".\\lib\\shared.ts"],
      tokenBudget: 10000,
    })) as RepoMapToolOutput;
    assert.equal(
      normalizedFocus.files[0]?.filePath,
      "lib/shared.ts",
      "repo_map should canonicalize platform-specific focus file paths",
    );
    assert.equal(normalizedFocus.files[0]?.focusRelation, "self");
    assert.equal(
      normalizedFocus.warnings.some((warning) => warning.includes("focus file is not indexed")),
      false,
      "canonicalized focus files should not produce false missing-file warnings",
    );

    // --- 4. route, symbol, and schema anchors personalize repo_map directly ---
    const routeFocused = (await invokeTool("repo_map", {
      projectId,
      focusRoutes: ["/"],
      tokenBudget: 10000,
    })) as RepoMapToolOutput;
    assert.equal(routeFocused.files[0]?.filePath, "app/page.tsx");
    assert.equal(routeFocused.files[0]?.focusRelation, "self");
    assert.equal(routeFocused.files[0]?.graphRankMode, "personalized");
    assert.ok(
      routeFocused.files.some((file) => file.filePath === "lib/shared.ts" && file.focusRelation === "dependency"),
      "route-focused repo_map should include dependencies of the route file",
    );

    const symbolFocused = (await invokeTool("repo_map", {
      projectId,
      focusSymbols: ["buildUserService"],
      tokenBudget: 10000,
    })) as RepoMapToolOutput;
    assert.equal(symbolFocused.files[0]?.filePath, "lib/shared.ts");
    assert.equal(symbolFocused.files[0]?.focusRelation, "self");
    assert.ok(
      symbolFocused.files.some((file) => file.filePath === "app/page.tsx" && file.focusRelation === "dependent"),
      "symbol-focused repo_map should include dependents of the symbol owner file",
    );

    const schemaFocused = (await invokeTool("repo_map", {
      projectId,
      focusDatabaseObjects: ["public.user_profiles"],
      tokenBudget: 10000,
    })) as RepoMapToolOutput;
    assert.equal(schemaFocused.files[0]?.filePath, "lib/shared.ts");
    assert.equal(schemaFocused.files[0]?.focusRelation, "self");
    assert.ok(
      schemaFocused.files.some((file) => file.filePath === "lib/core.ts" && file.focusRelation === "dependency"),
      "schema-focused repo_map should include dependencies of the schema usage file",
    );

    // --- 5. unresolved focus anchors warn and do not create a phantom boost ---
    const missingFocus = (await invokeTool("repo_map", {
      projectId,
      focusFiles: ["missing/file.ts"],
      focusRoutes: ["/missing"],
      focusSymbols: ["missingSymbol"],
      focusDatabaseObjects: ["public.missing_table"],
    })) as RepoMapToolOutput;
    assert.ok(
      missingFocus.warnings.some((warning) =>
        warning.includes("focus file is not indexed") && warning.includes("missing/file.ts")
      ),
      "repo_map should warn when a focus file is not indexed",
    );
    assert.ok(
      missingFocus.warnings.some((warning) =>
        warning.includes("focus route did not resolve") && warning.includes("/missing")
      ),
      "repo_map should warn when a focus route is not indexed",
    );
    assert.ok(
      missingFocus.warnings.some((warning) =>
        warning.includes("focus symbol did not resolve") && warning.includes("missingSymbol")
      ),
      "repo_map should warn when a focus symbol is not indexed",
    );
    assert.ok(
      missingFocus.warnings.some((warning) =>
        warning.includes("focus database object did not resolve") && warning.includes("public.missing_table")
      ),
      "repo_map should warn when a focus database object has no indexed usage",
    );
    assert.equal(
      missingFocus.files[0]?.filePath,
      "lib/core.ts",
      "missing focus file should not create a phantom focus boost",
    );

    // --- 6. pathGlob narrows the eligible set ---
    const libOnly = (await invokeTool("repo_map", {
      projectId,
      pathGlob: "lib/**/*.ts",
    })) as RepoMapToolOutput;
    assert.equal(libOnly.totalFilesEligible, 2);
    assert.ok(libOnly.files.every((f) => f.filePath.startsWith("lib/")));

    // --- 7. Tight token budget trims the rendered output ---
    const tight = (await invokeTool("repo_map", {
      projectId,
      tokenBudget: 20,
    })) as RepoMapToolOutput;
    assert.ok(tight.files.length < map.files.length, "tighter budget should keep fewer files");
    assert.ok(
      tight.truncatedByBudget === true || tight.files.length === 1,
      "tight budget should either flag truncation or keep only the top file",
    );

    // --- 8. maxFiles caps the file count even when budget allows more ---
    const capped = (await invokeTool("repo_map", {
      projectId,
      maxFiles: 2,
      tokenBudget: 10000,
    })) as RepoMapToolOutput;
    assert.equal(capped.files.length, 2);
    assert.equal(capped.truncatedByMaxFiles, true);

    console.log("repo-map: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
