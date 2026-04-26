/**
 * Phase 2 CC smoke: concurrent tool-plane execution through one shared
 * ProjectStoreCache. This mirrors Claude Code fan-out at the invokeTool
 * surface instead of testing store methods directly.
 */

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AstFindPatternToolOutput,
  ImportsDepsToolOutput,
  LintFilesToolOutput,
  RepoMapToolOutput,
  SchemaUsageToolOutput,
} from "../../packages/contracts/src/index.ts";
import {
  createProjectStoreCache,
  openGlobalStore,
  openProjectStore,
  type ImportEdgeRecord,
  type IndexedFileRecord,
  type ProjectStoreCache,
  type SymbolRecord,
} from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import type { ToolServiceOptions } from "../../packages/tools/src/runtime.ts";

const FEATURE_FILE_COUNT = 47;
const TOTAL_INDEXED_FILES = 50;
const AST_PARALLELISM = 5;
const STRESS_PARALLELISM = 20;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function lineCount(content: string): number {
  return content.split("\n").length;
}

function writeProjectFile(projectRoot: string, relPath: string, content: string): void {
  const fullPath = path.join(projectRoot, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${content}\n`);
}

function fileRecord(
  projectRoot: string,
  relPath: string,
  content: string,
  options: {
    symbols?: SymbolRecord[];
    imports?: ImportEdgeRecord[];
  } = {},
): IndexedFileRecord {
  const indexedContent = `${content}\n`;
  const lines = lineCount(indexedContent);
  const stat = statSync(path.join(projectRoot, relPath));
  return {
    path: relPath,
    sha256: sha256(indexedContent),
    language: "typescript",
    sizeBytes: stat.size,
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
    symbols: options.symbols ?? [],
    imports: options.imports ?? [],
    routes: [],
  };
}

function seedProject(projectRoot: string, projectId: string): void {
  writeProjectFile(
    projectRoot,
    "package.json",
    JSON.stringify({ name: "mcp-parallel-tool-execution-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, ".mako", "rules"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "mcp-parallel-tool-execution-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const sharedContent = [
    "export const sharedValue = 41;",
  ].join("\n");
  const userQueryContent = [
    "export function loadUser(userId: string) {",
    "  sensitiveQuery(userId);",
    "  sensitiveQuery(userId);",
    "}",
  ].join("\n");
  const dbUsageContent = [
    "export async function loadUsers(supabase: any) {",
    "  return supabase.from(\"users\").select(\"*\");",
    "}",
  ].join("\n");

  writeProjectFile(projectRoot, "src/shared.ts", sharedContent);
  writeProjectFile(projectRoot, "src/user-query.ts", userQueryContent);
  writeProjectFile(projectRoot, "src/db-usage.ts", dbUsageContent);

  const featureFiles: IndexedFileRecord[] = [];
  for (let index = 0; index < FEATURE_FILE_COUNT; index += 1) {
    const relPath = `src/feature-${index}.ts`;
    const content = [
      "import { sharedValue } from \"./shared\";",
      "",
      `export function feature${index}(input: string): number {`,
      "  console.log(input);",
      `  return sharedValue + input.length + ${index};`,
      "}",
    ].join("\n");

    writeProjectFile(projectRoot, relPath, content);
    featureFiles.push(
      fileRecord(projectRoot, relPath, content, {
        symbols: [
          {
            name: `feature${index}`,
            kind: "function",
            exportName: `feature${index}`,
            lineStart: 3,
            lineEnd: 6,
            signatureText: `export function feature${index}(input: string): number`,
          },
        ],
        imports: [
          {
            targetPath: "src/shared.ts",
            specifier: "./shared",
            importKind: "static",
            isTypeOnly: false,
            line: 1,
          },
        ],
      }),
    );
  }

  const rulePack = [
    "name: phase-2-parallel-smoke",
    "rules:",
    "  - id: smoke.sensitive_query_tenant_scope",
    "    category: identity_key_mismatch",
    "    severity: high",
    "    confidence: confirmed",
    "    languages: [ts, tsx]",
    "    message: 'Sensitive query receives `{{capture.ARG}}` - confirm it is tenant-scoped'",
    "    pattern: sensitiveQuery($ARG)",
  ].join("\n");
  writeProjectFile(projectRoot, ".mako/rules/tenant.yaml", rulePack);

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "mcp-parallel-tool-execution-smoke",
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
      files: [
        fileRecord(projectRoot, "src/shared.ts", sharedContent, {
          symbols: [
            {
              name: "sharedValue",
              kind: "variable",
              exportName: "sharedValue",
              lineStart: 1,
              lineEnd: 1,
            },
          ],
        }),
        fileRecord(projectRoot, "src/user-query.ts", userQueryContent, {
          symbols: [
            {
              name: "loadUser",
              kind: "function",
              exportName: "loadUser",
              lineStart: 1,
              lineEnd: 4,
              signatureText: "export function loadUser(userId: string)",
            },
          ],
        }),
        fileRecord(projectRoot, "src/db-usage.ts", dbUsageContent, {
          symbols: [
            {
              name: "loadUsers",
              kind: "function",
              exportName: "loadUsers",
              lineStart: 1,
              lineEnd: 3,
              signatureText: "export async function loadUsers(supabase: any)",
            },
          ],
        }),
        ...featureFiles,
      ],
      schemaObjects: [
        {
          objectKey: "public.users",
          objectType: "table",
          schemaName: "public",
          objectName: "users",
        },
      ],
      schemaUsages: [
        {
          objectKey: "public.users",
          filePath: "src/db-usage.ts",
          usageKind: "table_query",
          line: 2,
          excerpt: 'supabase.from("users").select("*")',
        },
      ],
    });
  } finally {
    store.close();
  }
}

function optionsFor(cache: ProjectStoreCache): ToolServiceOptions {
  return {
    projectStoreCache: cache,
    requestContext: { requestId: `phase2_parallel_${randomUUID()}` },
  };
}

async function runAstFind(projectId: string, cache: ProjectStoreCache): Promise<AstFindPatternToolOutput> {
  return (await invokeTool(
    "ast_find_pattern",
    {
      projectId,
      pattern: "console.log($X)",
      captures: ["X"],
      maxMatches: 1000,
    },
    optionsFor(cache),
  )) as AstFindPatternToolOutput;
}

function matchFingerprints(output: AstFindPatternToolOutput): string[] {
  return output.matches.map((match) => match.ackableFingerprint).sort();
}

function assertSameAstMatches(
  actual: AstFindPatternToolOutput,
  expectedFingerprints: string[],
): void {
  assert.equal(actual.toolName, "ast_find_pattern");
  assert.equal(actual.matches.length, FEATURE_FILE_COUNT);
  assert.deepEqual(matchFingerprints(actual), expectedFingerprints);
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-mcp-parallel-tools-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  const cache = createProjectStoreCache();
  try {
    const baseline = await runAstFind(projectId, cache);
    assert.equal(baseline.filesScanned, TOTAL_INDEXED_FILES);
    const baselineFingerprints = matchFingerprints(baseline);
    assert.equal(baselineFingerprints.length, FEATURE_FILE_COUNT);

    const parallelAstResults = await Promise.all(
      Array.from({ length: AST_PARALLELISM }, () => runAstFind(projectId, cache)),
    );
    for (const result of parallelAstResults) {
      assertSameAstMatches(result, baselineFingerprints);
    }
    assert.equal(cache.size(), 1, "parallel ast calls should share one project-store handle");

    const heteroResults = await Promise.all([
      runAstFind(projectId, cache),
      invokeTool(
        "lint_files",
        { projectId, files: ["src/user-query.ts"] },
        optionsFor(cache),
      ),
      invokeTool(
        "repo_map",
        { projectId, tokenBudget: 4096, maxFiles: TOTAL_INDEXED_FILES },
        optionsFor(cache),
      ),
      invokeTool(
        "imports_deps",
        { projectId, file: "src/feature-0.ts" },
        optionsFor(cache),
      ),
      invokeTool(
        "schema_usage",
        { projectId, schema: "public", object: "users" },
        optionsFor(cache),
      ),
    ]);

    const heteroAst = heteroResults[0] as AstFindPatternToolOutput;
    const lint = heteroResults[1] as LintFilesToolOutput;
    const repoMap = heteroResults[2] as RepoMapToolOutput;
    const imports = heteroResults[3] as ImportsDepsToolOutput;
    const schemaUsage = heteroResults[4] as SchemaUsageToolOutput;

    assertSameAstMatches(heteroAst, baselineFingerprints);
    assert.equal(lint.toolName, "lint_files");
    assert.deepEqual(lint.resolvedFiles, ["src/user-query.ts"]);
    assert.ok(lint.findings.length >= 1, "lint_files should find the seeded custom-rule issue");
    assert.equal(repoMap.toolName, "repo_map");
    assert.equal(repoMap.totalFilesIndexed, TOTAL_INDEXED_FILES);
    assert.ok(repoMap.files.length > 0, "repo_map should include indexed files");
    assert.equal(imports.toolName, "imports_deps");
    assert.equal(imports.resolvedFilePath, "src/feature-0.ts");
    assert.ok(
      imports.imports.some((edge) => edge.targetPath === "src/shared.ts"),
      "imports_deps should report the seeded internal import",
    );
    assert.equal(schemaUsage.toolName, "schema_usage");
    assert.equal(schemaUsage.projectId, projectId);
    assert.equal(cache.size(), 1, "heterogeneous calls should still share one project-store handle");

    const serialStart = Date.now();
    const serialAst = await runAstFind(projectId, cache);
    const serialMs = Math.max(1, Date.now() - serialStart);
    assertSameAstMatches(serialAst, baselineFingerprints);

    const stressStart = Date.now();
    const stressResults = await Promise.all(
      Array.from({ length: STRESS_PARALLELISM }, () => runAstFind(projectId, cache)),
    );
    const stressMs = Math.max(1, Date.now() - stressStart);
    for (const result of stressResults) {
      assertSameAstMatches(result, baselineFingerprints);
    }

    const thresholdMs = Math.max(10_000, serialMs * STRESS_PARALLELISM * 4);
    assert.ok(
      stressMs < thresholdMs,
      `20 parallel ast_find_pattern calls should complete under ${thresholdMs}ms; serial=${serialMs}ms stress=${stressMs}ms`,
    );

    cache.flush();
    assert.equal(cache.size(), 0, "flush should close the shared project-store handle");
    console.log("mcp-parallel-tool-execution: PASS");
  } finally {
    cache.flush();
    rmSync(tmp, { recursive: true, force: true });
  }
}

await main();
