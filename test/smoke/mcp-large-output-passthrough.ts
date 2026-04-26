/**
 * Phase 3 CC smoke: mako should not pre-truncate large-but-reasonable
 * text outputs that Claude Code can persist to disk with a preview.
 */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AstFindPatternToolOutput,
  LintFilesToolOutput,
} from "../../packages/contracts/src/index.ts";
import {
  openGlobalStore,
  openProjectStore,
  type IndexedFileRecord,
} from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

const HIT_COUNT = 320;
const MAX_REASONABLE_OUTPUT_BYTES = 1_000_000;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function fileRecord(projectRoot: string, relPath: string, content: string): IndexedFileRecord {
  const indexedContent = `${content}\n`;
  const lines = indexedContent.split("\n").length;
  const stat = statSync(path.join(projectRoot, relPath));
  return {
    path: relPath,
    sha256: sha256(indexedContent),
    language: "typescript",
    sizeBytes: Buffer.byteLength(indexedContent, "utf8"),
    lineCount: lines,
    lastModifiedAt: stat.mtime.toISOString(),
    chunks: [
      {
        chunkKind: "file",
        name: relPath,
        lineStart: 1,
        lineEnd: lines,
        content: indexedContent,
      },
    ],
    symbols: [
      {
        name: "runLargeOutputFixture",
        kind: "function",
        exportName: "runLargeOutputFixture",
        lineStart: 1,
        lineEnd: lines,
        signatureText: "export function runLargeOutputFixture(userId: string): void",
      },
    ],
    imports: [],
    routes: [],
  };
}

function writeProjectFile(projectRoot: string, relPath: string, content: string): void {
  const fullPath = path.join(projectRoot, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${content}\n`);
}

function seedProject(projectRoot: string, projectId: string): void {
  writeProjectFile(
    projectRoot,
    "package.json",
    JSON.stringify({ name: "mcp-large-output-passthrough-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, ".mako", "rules"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "mcp-large-output-passthrough-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const body: string[] = [
    "export function runLargeOutputFixture(userId: string): void {",
  ];
  for (let index = 0; index < HIT_COUNT; index += 1) {
    body.push(`  console.log("hit-${index}");`);
    body.push(`  sensitiveQuery(userId, "tenant-${index}");`);
  }
  body.push("}");
  const fixtureContent = body.join("\n");
  writeProjectFile(projectRoot, "src/large-output.ts", fixtureContent);

  const rulePack = [
    "name: phase-3-large-output",
    "rules:",
    "  - id: smoke.sensitive_query_tenant_scope",
    "    category: identity_key_mismatch",
    "    severity: high",
    "    confidence: confirmed",
    "    languages: [ts, tsx]",
    "    message: 'Sensitive query receives `{{capture.ARG}}` - confirm it is tenant-scoped'",
    "    pattern: sensitiveQuery($ARG, $TENANT)",
  ].join("\n");
  writeProjectFile(projectRoot, ".mako/rules/tenant.yaml", rulePack);

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "mcp-large-output-passthrough-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: "src",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });

    store.replaceIndexSnapshot({
      files: [fileRecord(projectRoot, "src/large-output.ts", fixtureContent)],
      schemaObjects: [],
      schemaUsages: [],
    });
  } finally {
    store.close();
  }
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-mcp-large-output-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    const ast = (await invokeTool("ast_find_pattern", {
      projectId,
      pattern: "console.log($X)",
      captures: ["X"],
    })) as AstFindPatternToolOutput;

    assert.equal(ast.toolName, "ast_find_pattern");
    assert.equal(ast.matches.length, HIT_COUNT);
    assert.equal(ast.truncated, false, "default maxMatches should pass through 300+ matches");
    assert.ok(
      serializedBytes(ast) < MAX_REASONABLE_OUTPUT_BYTES,
      "ast output should stay below the 1 MB sanity ceiling",
    );

    const lint = (await invokeTool("lint_files", {
      projectId,
      files: ["src/large-output.ts"],
    })) as LintFilesToolOutput;

    assert.equal(lint.toolName, "lint_files");
    assert.equal(lint.findings.length, HIT_COUNT);
    assert.equal(lint.truncated, false, "default maxFindings should pass through 300+ findings");
    assert.ok(
      serializedBytes(lint) < MAX_REASONABLE_OUTPUT_BYTES,
      "lint output should stay below the 1 MB sanity ceiling",
    );

    console.log("mcp-large-output-passthrough: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
