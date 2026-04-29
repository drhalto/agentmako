/**
 * `ast_find_pattern` smoke — read-only structural search tool.
 *
 * Seeds an in-memory project with three files carrying known patterns, then
 * exercises the tool surface end-to-end via `invokeTool("ast_find_pattern", ...)`:
 *
 * - pattern match across TS + TSX files with captures
 * - language filter narrows the result set
 * - pathGlob narrows the result set
 * - truncation warning fires when `maxMatches` is hit
 * - zero-match outcome surfaces the "verify syntax" hint warning
 *
 * This is the public tool test; `ast-patterns.ts` (the internal primitive)
 * is already exercised indirectly by composers and rule-packs smokes.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { AstFindPatternToolOutput } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { assessReefFileEvidence } from "../../packages/tools/src/index-freshness/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { readReefOperations } from "../../services/indexer/src/reef-operation-log.ts";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "ast-find-pattern-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "lib"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app"), { recursive: true });
  mkdirSync(path.join(projectRoot, "vendor"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "ast-find-pattern-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  // Three files with known, distinct patterns.
  const libContent = [
    "export function hello(name: string) {",
    "  console.log(name);",
    "  console.log('ready');",
    "  return name.toUpperCase();",
    "}",
  ].join("\n");

  const appContent = [
    "import * as React from 'react';",
    "export function Page() {",
    "  React.useEffect(() => {",
    "    console.log('mount');",
    "  }, []);",
    "  return <div>hi</div>;",
    "}",
  ].join("\n");

  const vendorContent = [
    "export function vendorLog() {",
    "  console.log('vendor');",
    "}",
  ].join("\n");

  writeFileSync(path.join(projectRoot, "lib", "util.ts"), `${libContent}\n`);
  writeFileSync(path.join(projectRoot, "app", "page.tsx"), `${appContent}\n`);
  writeFileSync(path.join(projectRoot, "vendor", "log.js"), `${vendorContent}\n`);

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "ast-find-pattern-smoke",
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

    const fileRecord = (
      relPath: string,
      content: string,
      language: "typescript" | "tsx" | "javascript",
      extraChunks: Array<{
        chunkKind: string;
        name: string;
        lineStart: number;
        lineEnd: number;
        content: string;
      }> = [],
    ) => {
      const indexedContent = `${content}\n`;
      const lineCount = indexedContent.split("\n").length;
      const stat = statSync(path.join(projectRoot, relPath));
      return {
        path: relPath,
        sha256: relPath,
        language,
        sizeBytes: Buffer.byteLength(indexedContent, "utf8"),
        lineCount,
        lastModifiedAt: stat.mtime.toISOString(),
        chunks: [
          {
            chunkKind: "file" as const,
            name: relPath,
            lineStart: 1,
            lineEnd: lineCount,
            content: indexedContent,
          },
          ...extraChunks,
        ],
        symbols: [],
        imports: [],
        routes: [],
      };
    };

    store.replaceIndexSnapshot({
      files: [
        fileRecord("lib/util.ts", libContent, "typescript"),
        fileRecord("app/page.tsx", appContent, "tsx", [
          {
            chunkKind: "symbol",
            name: "Page",
            lineStart: 2,
            lineEnd: 7,
            content: appContent.split("\n").slice(1).join("\n"),
          },
        ]),
        fileRecord("vendor/log.js", vendorContent, "javascript"),
      ],
      schemaObjects: [],
      schemaUsages: [],
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-ast-find-pattern-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    // --- 1. Find every `console.log($X)` across the project with captures ---
    const allConsoleLogs = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "console.log($X)",
      captures: ["X"],
    })) as AstFindPatternToolOutput;

    assert.equal(allConsoleLogs.toolName, "ast_find_pattern");
    assert.equal(allConsoleLogs.projectId, projectId);
    assert.equal(allConsoleLogs.pattern, "console.log($X)");
    assert.equal(allConsoleLogs.filesScanned, 3, "three supported files should be scanned");
    assert.equal(
      allConsoleLogs.matches.length,
      4,
      "expected 4 console.log hits: 2 in lib, 1 in app, 1 in vendor",
    );
    assert.equal(allConsoleLogs.truncated, false);
    assert.equal(allConsoleLogs.reefExecution.reefMode, "auto");
    assert.equal(allConsoleLogs.reefExecution.serviceMode, "direct");
    assert.equal(allConsoleLogs.reefExecution.queryPath, "reef_query");
    assert.equal(allConsoleLogs.reefExecution.freshnessPolicy, "require_fresh");
    assert.equal(allConsoleLogs.reefExecution.fallback?.used, true);

    const libHits = allConsoleLogs.matches.filter((m) => m.filePath === "lib/util.ts");
    assert.equal(libHits.length, 2, "lib/util.ts has two console.log calls");
    assert.equal(libHits[0]?.language, "ts");
    assert.ok(libHits[0]?.captures.X, "captures should include metavariable X");
    assert.equal(libHits[0]?.captures.X, "name");
    assert.equal(libHits[1]?.captures.X, "'ready'");

    const tsxHits = allConsoleLogs.matches.filter((m) => m.filePath === "app/page.tsx");
    assert.equal(tsxHits.length, 1);
    assert.equal(tsxHits[0]?.language, "tsx");
    assert.equal(tsxHits[0]?.captures.X, "'mount'");

    // --- 2. Language filter narrows: ts-only excludes tsx + js ---
    const tsOnly = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "console.log($X)",
      languages: ["ts"],
    })) as AstFindPatternToolOutput;
    assert.equal(tsOnly.filesScanned, 1, "only lib/util.ts is .ts");
    assert.equal(tsOnly.matches.length, 2, "both lib console.logs");
    assert.deepEqual(tsOnly.languagesApplied, ["ts"]);

    // Some MCP clients re-emit selected/deferred tool params as strings.
    // The registry should recover JSON-stringified arrays and numeric scalars.
    const coercedTransportArgs = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "console.log($X)",
      captures: JSON.stringify(["X"]),
      languages: JSON.stringify(["ts", "tsx"]),
      maxMatches: "3",
    })) as AstFindPatternToolOutput;
    assert.equal(coercedTransportArgs.matches.length, 3);
    assert.deepEqual(coercedTransportArgs.languagesApplied, ["ts", "tsx"]);

    // --- 3. pathGlob narrows by relative path ---
    const libGlob = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "console.log($X)",
      pathGlob: "lib/**/*.ts",
    })) as AstFindPatternToolOutput;
    assert.equal(libGlob.matches.length, 2);
    assert.ok(libGlob.matches.every((m) => m.filePath.startsWith("lib/")));

    const appGlob = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "console.log($X)",
      pathGlob: "app/*.tsx",
    })) as AstFindPatternToolOutput;
    assert.equal(appGlob.matches.length, 1);
    assert.equal(appGlob.matches[0]?.filePath, "app/page.tsx");

    // --- 4. Truncation fires when maxMatches is set below total ---
    const truncated = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "console.log($X)",
      maxMatches: 2,
    })) as AstFindPatternToolOutput;
    assert.equal(truncated.matches.length, 2);
    assert.equal(truncated.truncated, true);
    assert.ok(
      truncated.warnings.some((w) => w.includes("matches capped at 2")),
      "warning should name the maxMatches cap",
    );

    // --- 5. Zero-match surfaces the "verify syntax" hint warning ---
    const noMatches = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "thisFunctionDoesNotExist($X)",
    })) as AstFindPatternToolOutput;
    assert.equal(noMatches.matches.length, 0);
    assert.ok(
      noMatches.warnings.some((w) => w.includes("verify ast-grep pattern syntax")),
      "zero-match result should surface the pattern-syntax hint",
    );

    // --- 6. Structural pattern that text search would miss:
    //        `React.useEffect($FN, [])` — empty deps array only ---
    const emptyDepsEffect = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "React.useEffect($FN, [])",
    })) as AstFindPatternToolOutput;
    assert.equal(
      emptyDepsEffect.matches.length,
      1,
      "exactly one useEffect with empty deps in the seeded project",
    );
    assert.equal(emptyDepsEffect.matches[0]?.filePath, "app/page.tsx");
    assert.ok((emptyDepsEffect.matches[0]?.lineEnd ?? 0) <= 7, "AST hits must not exceed the indexed file line count");
    assert.equal(
      emptyDepsEffect.warnings.some((warning) => warning.includes("line range exceeded")),
      false,
      "file-level source lookup should not parse appended symbol chunks as duplicate source",
    );
    const queryPathOperations = await readReefOperations({}, {
      projectId,
      kind: "query_path",
      limit: 20,
    });
    assert.ok(queryPathOperations.some((operation) =>
      operation.id === allConsoleLogs.reefExecution.operationId
      && operation.data?.toolName === "ast_find_pattern"
      && operation.data?.queryPath === "reef_query"
      && operation.data?.returnedCount === 4
    ));
    const fallbackOperations = await readReefOperations({}, {
      projectId,
      kind: "fallback_used",
      limit: 20,
    });
    assert.ok(fallbackOperations.some((operation) =>
      operation.data?.toolName === "ast_find_pattern"
      && operation.data?.serviceMode === "direct"
    ));

    // --- 7. Helper-level unknown state drops unsafe evidence ---
    const outsideDecision = assessReefFileEvidence({
      projectRoot,
      filePath: path.join(tmp, "outside.ts"),
      freshnessPolicy: "require_fresh",
    });
    assert.equal(outsideDecision.action, "drop");
    assert.equal(outsideDecision.freshness.state, "unknown");

    // --- 8. Live line validation rejects indexed evidence whose metadata
    //        still matches but whose stored source has impossible lines. ---
    const ghostLiveContent = "export const short = true;";
    const ghostPath = path.join(projectRoot, "lib", "ghost.ts");
    writeFileSync(ghostPath, ghostLiveContent);
    const ghostStat = statSync(ghostPath);
    const ghostIndexedContent = [
      "export function ghost() {",
      "  console.log('ghost');",
      "}",
    ].join("\n");
    const ghostStore = openProjectStore({ projectRoot });
    try {
      ghostStore.replaceIndexSnapshot({
        files: [
          {
            path: "lib/ghost.ts",
            sha256: "lib/ghost.ts",
            language: "typescript",
            sizeBytes: ghostStat.size,
            lineCount: 3,
            lastModifiedAt: ghostStat.mtime.toISOString(),
            chunks: [
              {
                chunkKind: "file" as const,
                name: "lib/ghost.ts",
                lineStart: 1,
                lineEnd: 3,
                content: `${ghostIndexedContent}\n`,
              },
            ],
            symbols: [],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
    } finally {
      ghostStore.close();
    }

    const impossibleLine = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "console.log($X)",
      pathGlob: "lib/ghost.ts",
    })) as AstFindPatternToolOutput;
    assert.equal(impossibleLine.matches.length, 0);
    assert.equal(impossibleLine.reefFreshness.state, "dirty");
    assert.ok((impossibleLine.reefFreshness.staleEvidenceDropped ?? 0) > 0);
    assert.equal(impossibleLine.reefExecution.queryPath, "reef_query");
    assert.ok(
      impossibleLine.warnings.some((warning) => warning.includes("line range exceeded live file metadata")),
      "impossible live line ranges should be visible without returning stale evidence",
    );
    const staleQueryPathOperations = await readReefOperations({}, {
      projectId,
      kind: "query_path",
      limit: 20,
    });
    assert.ok(staleQueryPathOperations.some((operation) =>
      operation.id === impossibleLine.reefExecution.operationId
      && typeof operation.data?.staleEvidenceDropped === "number"
      && operation.data.staleEvidenceDropped > 0
    ));

    console.log("ast-find-pattern: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
