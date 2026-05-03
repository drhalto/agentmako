import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JsonValue, ProjectFact, ProjectFinding, SchemaSnapshot } from "../../packages/contracts/src/index.ts";
import { ReefCalculationNodeSchema } from "../../packages/contracts/src/index.ts";
import { hashText, type IndexedFileRecord, type ProjectStore } from "../../packages/store/src/index.ts";
import {
  calculateRouteContext,
  calculateRpcNeighborhood,
  calculateTableNeighborhood,
} from "../../packages/tools/src/neighborhoods/index.ts";
import {
  calculateActiveFindingStatus,
  calculateDiagnosticCoverage,
  calculateDuplicateCandidates,
  calculateReefImpactStructural,
  calculateReefWhereUsedStructural,
  createReefQueryCalculationRegistry,
  REEF_ACTIVE_FINDING_STATUS_QUERY_KIND,
  REEF_DIAGNOSTIC_COVERAGE_QUERY_KIND,
  REEF_DUPLICATE_CANDIDATES_QUERY_KIND,
  REEF_IMPACT_QUERY_KIND,
  REEF_QUERY_CALCULATION_NODES,
  REEF_ROUTE_CONTEXT_QUERY_KIND,
  REEF_RPC_NEIGHBORHOOD_QUERY_KIND,
  REEF_TABLE_NEIGHBORHOOD_QUERY_KIND,
  REEF_WHERE_USED_NODE,
  REEF_WHERE_USED_QUERY_KIND,
  runCachedReefCalculation,
} from "../../packages/tools/src/reef/index.ts";
import { seedReefProject } from "../fixtures/reef/index.ts";

interface CachedPayload {
  value: string;
  files: string[];
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-query-calculations-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  const seeded = await seedReefProject({ projectRoot });
  try {
    assertQueryCalculationRegistry();
    seedIndexedProject(seeded.store);
    seedOperationalEvidence(seeded.store, seeded.projectId, projectRoot);

    const whereUsed = calculateReefWhereUsedStructural({
      projectStore: seeded.store,
      query: "loadUser",
      targetKind: "symbol",
      limit: 20,
    });
    assert.equal(whereUsed.definitions.length, 1);
    assert.equal(whereUsed.definitions[0]?.filePath, "src/auth.ts");
    assert.ok(whereUsed.usages.some((usage) =>
      usage.filePath === "src/auth.ts" && usage.usageKind === "definition"
    ));
    assert.ok(whereUsed.usages.some((usage) =>
      usage.filePath === "src/consumer.ts" && usage.usageKind === "dependent"
    ));
    assert.deepEqual(whereUsed.coverage.directUsageSources, [
      "definitions",
      "import_edges",
      "indexed_identifier_text",
    ]);

    const impact = calculateReefImpactStructural({
      projectStore: seeded.store,
      filePaths: ["src/auth.ts"],
      depth: 1,
      maxCallersPerFile: 10,
    });
    assert.equal(impact.changedFiles[0]?.filePath, "src/auth.ts");
    assert.equal(impact.changedFiles[0]?.indexed, true);
    assert.ok(impact.changedFiles[0]?.exportedSymbols.includes("loadUser"));
    assert.ok(impact.impactedCallers.some((caller) =>
      caller.sourceFilePath === "src/auth.ts" &&
      caller.callerFilePath === "src/consumer.ts" &&
      caller.depth === 1
    ));

    const table = calculateTableNeighborhood({
      projectStore: seeded.store,
      tableName: "users",
      schemaName: "public",
      maxPerSection: 20,
    });
    assert.equal(table.table?.name, "users");
    assert.equal(table.reads.entries.length, 1);
    assert.equal(table.dependentRpcs.entries.length, 1);

    const rpc = calculateRpcNeighborhood({
      projectStore: seeded.store,
      rpcName: "get_user",
      schemaName: "public",
      argTypes: ["uuid"],
      maxPerSection: 20,
    });
    assert.equal(rpc.rpc?.name, "get_user");
    assert.equal(rpc.callers.entries.length, 1);
    assert.equal(rpc.tablesTouched.entries[0]?.targetTable, "users");

    const route = calculateRouteContext({
      projectStore: seeded.store,
      route: "GET /api/user",
      maxPerSection: 20,
    });
    assert.equal(route.resolvedRoute?.pattern, "/api/user");
    assert.ok(route.downstreamRpcs.entries.some((entry) => entry.rpcName === "get_user"));
    assert.ok(route.downstreamTables.entries.some((entry) => entry.tableName === "users"));

    const diagnosticCoverage = calculateDiagnosticCoverage({
      projectStore: seeded.store,
      projectId: seeded.projectId,
      projectRoot,
      requestedFileList: ["src/auth.ts"],
      sources: ["eslint"],
      limit: 20,
      checkedAt: new Date().toISOString(),
      checkedAtMs: Date.now(),
      cacheStalenessMs: 60_000,
      normalizeFilePath: (_root, filePath) => filePath.replace(/\\/gu, "/").replace(/^\.\//u, ""),
    });
    assert.equal(diagnosticCoverage.status, "stale");
    assert.equal(diagnosticCoverage.changedFiles[0]?.filePath, "src/auth.ts");

    const activeFindingStatus = calculateActiveFindingStatus({
      projectStore: seeded.store,
      projectId: seeded.projectId,
      limit: 100,
    });
    assert.equal(activeFindingStatus.totalActive, 2);
    assert.equal(activeFindingStatus.byRule[0]?.key, "reuse.helper_bypass");

    const duplicates = calculateDuplicateCandidates({
      projectStore: seeded.store,
      projectId: seeded.projectId,
      limit: 10,
    });
    assert.equal(duplicates.candidates.length, 1);
    assert.deepEqual(duplicates.candidates[0]?.files, ["src/auth.ts", "src/consumer.ts"]);

    let computeCount = 0;
    const first = runCachedReefCalculation<CachedPayload>({
      projectStore: seeded.store,
      projectId: seeded.projectId,
      root: projectRoot,
      node: REEF_WHERE_USED_NODE,
      queryKind: REEF_WHERE_USED_QUERY_KIND,
      sourceRevision: 7,
      input: { query: "loadUser", targetKind: "symbol", limit: 20 },
      compute: () => {
        computeCount += 1;
        return { value: "where-used", files: whereUsed.usages.map((usage) => usage.filePath) };
      },
      toJson: cachedPayloadToJson,
      fromJson: cachedPayloadFromJson,
    });
    assert.equal(first.cache.enabled, true);
    assert.equal(first.cache.hit, false);
    assert.ok(first.cache.path?.startsWith("query/where_used/"));

    const second = runCachedReefCalculation<CachedPayload>({
      projectStore: seeded.store,
      projectId: seeded.projectId,
      root: projectRoot,
      node: REEF_WHERE_USED_NODE,
      queryKind: REEF_WHERE_USED_QUERY_KIND,
      sourceRevision: 7,
      input: { query: "loadUser", targetKind: "symbol", limit: 20 },
      compute: () => {
        computeCount += 1;
        return { value: "recomputed", files: [] };
      },
      toJson: cachedPayloadToJson,
      fromJson: cachedPayloadFromJson,
    });
    assert.equal(second.cache.enabled, true);
    assert.equal(second.cache.hit, true);
    assert.equal(second.value.value, "where-used");
    assert.equal(computeCount, 1, "cached calculation should not recompute on an unchanged source revision");

    const third = runCachedReefCalculation<CachedPayload>({
      projectStore: seeded.store,
      projectId: seeded.projectId,
      root: projectRoot,
      node: REEF_WHERE_USED_NODE,
      queryKind: REEF_WHERE_USED_QUERY_KIND,
      sourceRevision: 8,
      input: { query: "loadUser", targetKind: "symbol", limit: 20 },
      compute: () => {
        computeCount += 1;
        return { value: "new-revision", files: [] };
      },
      toJson: cachedPayloadToJson,
      fromJson: cachedPayloadFromJson,
    });
    assert.equal(third.cache.hit, false);
    assert.equal(third.value.value, "new-revision");
    assert.equal(computeCount, 2, "changed source revision should invalidate the cached calculation");

    console.log("reef-query-calculations: PASS");
  } finally {
    await seeded.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
}

function assertQueryCalculationRegistry(): void {
  for (const node of REEF_QUERY_CALCULATION_NODES) {
    ReefCalculationNodeSchema.parse(node);
  }
  const registry = createReefQueryCalculationRegistry();
  assert.equal(registry.list().length, 8);
  for (const queryKind of [
    REEF_WHERE_USED_QUERY_KIND,
    REEF_IMPACT_QUERY_KIND,
    REEF_TABLE_NEIGHBORHOOD_QUERY_KIND,
    REEF_RPC_NEIGHBORHOOD_QUERY_KIND,
    REEF_ROUTE_CONTEXT_QUERY_KIND,
    REEF_DIAGNOSTIC_COVERAGE_QUERY_KIND,
    REEF_ACTIVE_FINDING_STATUS_QUERY_KIND,
    REEF_DUPLICATE_CANDIDATES_QUERY_KIND,
  ]) {
    assert.ok(
      registry.findProducer({ kind: "query", queryKind }),
      `expected query calculation producer for ${queryKind}`,
    );
  }
}

function seedIndexedProject(store: ProjectStore): void {
  const authContent = [
    "export function loadUser(id: string) {",
    "  return { id };",
    "}",
  ].join("\n");
  const consumerContent = [
    "import { loadUser } from \"./auth\";",
    "",
    "export function renderUser(id: string) {",
    "  return loadUser(id);",
    "}",
  ].join("\n");
  const routeContent = [
    "import { renderUser } from \"../../src/consumer\";",
    "",
    "export function GET() {",
    "  return Response.json(renderUser(\"1\"));",
    "}",
  ].join("\n");
  store.replaceIndexSnapshot({
    files: [
      indexedFile("src/auth.ts", authContent, {
        symbols: [{
          name: "loadUser",
          kind: "function",
          exportName: "loadUser",
          lineStart: 1,
          lineEnd: 3,
        }],
      }),
      indexedFile("src/consumer.ts", consumerContent, {
        symbols: [{
          name: "renderUser",
          kind: "function",
          exportName: "renderUser",
          lineStart: 3,
          lineEnd: 5,
        }],
        imports: [{
          targetPath: "src/auth.ts",
          specifier: "./auth",
          importKind: "static",
          isTypeOnly: false,
          line: 1,
        }],
      }),
      indexedFile("app/api/user/route.ts", routeContent, {
        imports: [{
          targetPath: "src/consumer.ts",
          specifier: "../../src/consumer",
          importKind: "static",
          isTypeOnly: false,
          line: 1,
        }],
        routes: [{
          routeKey: "nextjs:GET:/api/user",
          framework: "nextjs",
          pattern: "/api/user",
          method: "GET",
          handlerName: "GET",
          isApi: true,
        }],
      }),
    ],
    schemaObjects: [
      {
        objectKey: "public.users",
        objectType: "table",
        schemaName: "public",
        objectName: "users",
      },
      {
        objectKey: "public.get_user",
        objectType: "rpc",
        schemaName: "public",
        objectName: "get_user",
      },
    ],
    schemaUsages: [
      {
        objectKey: "public.users",
        filePath: "src/auth.ts",
        usageKind: "read",
        line: 2,
        excerpt: "supabase.from('users').select('*')",
      },
      {
        objectKey: "public.get_user",
        filePath: "src/consumer.ts",
        usageKind: "call",
        line: 4,
        excerpt: "supabase.rpc('get_user')",
      },
    ],
  });
  store.saveSchemaSnapshot(createSchemaSnapshot());
}

function indexedFile(
  filePath: string,
  content: string,
  overrides: Partial<Pick<IndexedFileRecord, "symbols" | "imports" | "routes">> = {},
): IndexedFileRecord {
  return {
    path: filePath,
    sha256: hashText(content),
    language: "ts",
    sizeBytes: Buffer.byteLength(content, "utf8"),
    lineCount: content.split(/\r?\n/u).length,
    isGenerated: false,
    chunks: [{
      chunkKind: "file",
      lineStart: 1,
      lineEnd: content.split(/\r?\n/u).length,
      content,
    }],
    symbols: overrides.symbols ?? [],
    imports: overrides.imports ?? [],
    routes: overrides.routes ?? [],
  };
}

function seedOperationalEvidence(store: ProjectStore, projectId: string, projectRoot: string): void {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 10_000).toISOString();
  store.saveReefDiagnosticRun({
    projectId,
    source: "eslint",
    overlay: "working_tree",
    status: "succeeded",
    startedAt: old,
    finishedAt: old,
    durationMs: 10,
    checkedFileCount: 1,
    findingCount: 0,
    persistedFindingCount: 0,
    command: "fixture eslint",
    cwd: projectRoot,
    metadata: { requestedFiles: ["src/auth.ts"] },
  });

  const subject = { kind: "file" as const, path: "src/auth.ts" };
  const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
  const overlayFact: ProjectFact = {
    projectId,
    kind: "file_snapshot",
    subject,
    subjectFingerprint,
    overlay: "working_tree",
    source: "working_tree_overlay",
    confidence: 1,
    fingerprint: store.computeReefFactFingerprint({
      projectId,
      kind: "file_snapshot",
      subjectFingerprint,
      overlay: "working_tree",
      source: "working_tree_overlay",
      data: { lastModifiedAt: now },
    }),
    freshness: { state: "fresh", checkedAt: now, reason: "fixture overlay" },
    provenance: { source: "reef-query-calculations-smoke", capturedAt: now },
    data: { lastModifiedAt: now },
  };
  store.upsertReefFacts([overlayFact]);

  const findings: ProjectFinding[] = ["src/auth.ts", "src/consumer.ts"].map((filePath) => {
    const findingSubject = { kind: "diagnostic" as const, path: filePath, code: "reuse.helper_bypass" };
    const findingSubjectFingerprint = store.computeReefSubjectFingerprint(findingSubject);
    const message = `${filePath} duplicates helper behavior and bypasses the canonical helper.`;
    return {
      projectId,
      fingerprint: store.computeReefFindingFingerprint({
        source: "rule_pack:reuse",
        ruleId: "reuse.helper_bypass",
        subjectFingerprint: findingSubjectFingerprint,
        message,
        evidenceRefs: [filePath],
      }),
      source: "rule_pack:reuse",
      subjectFingerprint: findingSubjectFingerprint,
      overlay: "working_tree",
      severity: "warning",
      status: "active",
      filePath,
      ruleId: "reuse.helper_bypass",
      evidenceRefs: [filePath],
      freshness: { state: "fresh", checkedAt: now, reason: "fixture finding" },
      capturedAt: now,
      message,
      factFingerprints: [],
    };
  });
  store.replaceReefFindingsForSource({
    projectId,
    source: "rule_pack:reuse",
    overlay: "working_tree",
    findings,
  });
}

function createSchemaSnapshot(): SchemaSnapshot {
  const now = new Date().toISOString();
  return {
    snapshotId: "reef-query-calculations-schema",
    sourceMode: "repo_only",
    generatedAt: now,
    refreshedAt: now,
    fingerprint: "reef-query-calculations-schema",
    freshnessStatus: "fresh",
    driftDetected: false,
    sources: [],
    warnings: [],
    ir: {
      version: "1.0.0",
      schemas: {
        public: {
          tables: [{
            name: "users",
            schema: "public",
            columns: [{
              name: "id",
              dataType: "uuid",
              nullable: false,
              isPrimaryKey: true,
              sources: [],
            }],
            rls: {
              rlsEnabled: true,
              forceRls: false,
              policies: [{
                name: "users_self_read",
                mode: "PERMISSIVE",
                command: "SELECT",
                roles: ["authenticated"],
                usingExpression: "id = auth.uid()",
                withCheckExpression: null,
              }],
            },
            sources: [],
          }],
          views: [],
          enums: [],
          rpcs: [{
            name: "get_user",
            schema: "public",
            argTypes: ["uuid"],
            returnType: "jsonb",
            bodyText: "BEGIN RETURN (SELECT to_jsonb(users) FROM public.users WHERE id = $1); END;",
            sources: [],
          }],
        },
      },
    },
  };
}

function cachedPayloadToJson(value: CachedPayload): JsonValue {
  return value as unknown as JsonValue;
}

function cachedPayloadFromJson(value: JsonValue): CachedPayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Partial<CachedPayload>;
  if (typeof record.value !== "string" || !Array.isArray(record.files)) {
    return undefined;
  }
  return {
    value: record.value,
    files: record.files.filter((file): file is string => typeof file === "string"),
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
