/**
 * `ast_find_pattern` → `finding_ack` → `ast_find_pattern` end-to-end loop.
 *
 * Seeds a project with three console.log hits, acks one via `finding_ack`
 * using the `ackableFingerprint` from the first run, re-runs with
 * `excludeAcknowledgedCategory`, and asserts the filter + count.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  AstFindPatternToolOutput,
  FindingAckToolOutput,
} from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "ast-ack-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "lib"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "ast-ack-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const libContent = [
    "export function hello(name: string) {",
    "  console.log(name);",
    "  console.log('ready');",
    "  console.log('done');",
    "}",
  ].join("\n");

  const indexedLibContent = `${libContent}\n`;
  const libPath = path.join(projectRoot, "lib", "util.ts");
  writeFileSync(libPath, indexedLibContent);
  const libStat = statSync(libPath);
  const lineCount = indexedLibContent.split("\n").length;

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "ast-ack-smoke",
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

    store.replaceIndexSnapshot({
      files: [
        {
          path: "lib/util.ts",
          sha256: "lib/util.ts",
          language: "typescript",
          sizeBytes: Buffer.byteLength(indexedLibContent, "utf8"),
          lineCount,
          lastModifiedAt: libStat.mtime.toISOString(),
          chunks: [
            {
              chunkKind: "file" as const,
              name: "lib/util.ts",
              lineStart: 1,
              lineEnd: lineCount,
              content: indexedLibContent,
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
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-ast-ack-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  // --- 1. First run: no category opted into; acknowledgedCount = 0 ---

  const before = (await invokeTool("ast_find_pattern", {
    projectId,
    pattern: "console.log($X)",
    captures: ["X"],
  })) as AstFindPatternToolOutput;
  assert.equal(before.matches.length, 3, "three console.log matches seeded");
  assert.equal(
    before.acknowledgedCount,
    0,
    "acknowledgedCount is 0 when no category is opted into",
  );
  for (const match of before.matches) {
    assert.ok(
      match.ackableFingerprint && match.ackableFingerprint.length > 0,
      "every match carries an ackableFingerprint",
    );
  }

  // --- 1b. Same run, opt into an empty category: still no filter ---

  const beforeWithEmptyCategory = (await invokeTool("ast_find_pattern", {
    projectId,
    pattern: "console.log($X)",
    captures: ["X"],
    excludeAcknowledgedCategory: "never-acked",
  })) as AstFindPatternToolOutput;
  assert.equal(beforeWithEmptyCategory.matches.length, 3);
  assert.equal(
    beforeWithEmptyCategory.acknowledgedCount,
    0,
    "opting into an empty category is zero-cost",
  );

  // --- 2. Ack one match via the shared tool plane ---

  const target = before.matches.find((m) => m.captures.X === "'ready'");
  assert.ok(target, "'ready' match exists in the seed set");

  const ackResult = (await invokeTool("finding_ack", {
    projectId,
    preview: false,
    category: "debug-logs-ok",
    subjectKind: "ast_match",
    filePath: target.filePath,
    fingerprint: target.ackableFingerprint,
    reason: "intentional ready log; debug-visible by design",
    snippet: target.matchText,
    sourceToolName: "ast_find_pattern",
  })) as FindingAckToolOutput;
  assert.ok(ackResult.ack);
  assert.equal(ackResult.ack.fingerprint, target.ackableFingerprint);

  // --- 3. Re-run with excludeAcknowledgedCategory — acked match is filtered ---

  const after = (await invokeTool("ast_find_pattern", {
    projectId,
    pattern: "console.log($X)",
    captures: ["X"],
    excludeAcknowledgedCategory: "debug-logs-ok",
  })) as AstFindPatternToolOutput;
  assert.equal(
    after.matches.length,
    2,
    "acked match is filtered out (3 → 2)",
  );
  assert.equal(after.acknowledgedCount, 1, "acknowledgedCount reports the filter");
  assert.ok(
    after.matches.every((m) => m.ackableFingerprint !== target.ackableFingerprint),
    "filtered-out fingerprint does not appear in the result set",
  );

  // --- 4. Different category: no filter effect ---

  const unrelatedCat = (await invokeTool("ast_find_pattern", {
    projectId,
    pattern: "console.log($X)",
    captures: ["X"],
    excludeAcknowledgedCategory: "hydration-check",
  })) as AstFindPatternToolOutput;
  assert.equal(
    unrelatedCat.matches.length,
    3,
    "ack under 'debug-logs-ok' does not bleed into 'hydration-check'",
  );
  assert.equal(unrelatedCat.acknowledgedCount, 0);

  // --- 5. Fingerprint is stable across runs for the same match ---

  const repeat = (await invokeTool("ast_find_pattern", {
    projectId,
    pattern: "console.log($X)",
    captures: ["X"],
  })) as AstFindPatternToolOutput;
  const repeatTarget = repeat.matches.find((m) => m.captures.X === "'ready'");
  assert.ok(repeatTarget);
  assert.equal(
    repeatTarget.ackableFingerprint,
    target.ackableFingerprint,
    "fingerprint is deterministic across runs",
  );

  console.log("finding-acks-ast-find-pattern: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
