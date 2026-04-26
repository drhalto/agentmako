import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TenantLeakAuditToolOutputSchema } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-tenant-leak-audit-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "events"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const routeBody = [
    "import { supabase } from '../../../../src/supabase';",
    "",
    "export async function GET() {",
    "  await supabase.rpc('refresh_events');",
    "  return Response.json([]);",
    "}",
  ].join("\n");

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "tenant-leak-audit-smoke", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "app", "api", "events", "route.ts"), routeBody);

  const projectId = randomUUID();
  let latestIndexRunId: string | null = null;

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "tenant-leak-audit-smoke",
        canonicalPath: projectRoot,
        lastSeenPath: projectRoot,
        supportTarget: "best_effort",
      });
    } finally {
      globalStore.close();
    }

    const store = openProjectStore({ projectRoot });
    try {
      store.saveProjectProfile({
        name: "tenant-leak-audit-smoke",
        rootPath: projectRoot,
        framework: "nextjs",
        orm: "supabase",
        srcRoot: "src",
        entryPoints: [],
        pathAliases: {},
        middlewareFiles: [],
        serverOnlyModules: [],
        authGuardSymbols: [],
        supportLevel: "native",
        authz: {
          presetId: "supabase-multi-tenant",
          adminValues: ["admin"],
          tenantForeignKey: "tenant_id",
        },
        detectedAt: new Date().toISOString(),
      });

      store.replaceIndexSnapshot({
        files: [
          {
            path: "app/api/events/route.ts",
            sha256: "route",
            language: "typescript",
            sizeBytes: routeBody.length,
            lineCount: routeBody.split("\n").length,
            chunks: [
              {
                chunkKind: "file",
                name: "app/api/events/route.ts",
                lineStart: 1,
                lineEnd: routeBody.split("\n").length,
                content: routeBody,
              },
            ],
            symbols: [
              {
                name: "GET",
                kind: "function",
                exportName: "GET",
                lineStart: 3,
                lineEnd: 6,
              },
            ],
            imports: [],
            routes: [
              {
                routeKey: "GET /api/events",
                framework: "nextjs-app-router",
                pattern: "/api/events",
                method: "GET",
                handlerName: "GET",
                isApi: true,
              },
            ],
          },
        ],
        schemaObjects: [
          {
            objectKey: "public.refresh_events",
            objectType: "rpc",
            schemaName: "public",
            objectName: "refresh_events",
          },
        ],
        schemaUsages: [
          {
            objectKey: "public.refresh_events",
            filePath: "app/api/events/route.ts",
            usageKind: "rpc_call",
            line: 4,
            excerpt: "supabase.rpc('refresh_events')",
          },
        ],
      });
      latestIndexRunId = store.getLatestIndexRun()?.runId ?? null;

      const now = new Date().toISOString();
      store.saveSchemaSnapshot({
        snapshotId: "tenant_leak_audit_snapshot",
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "tenant-leak-audit-smoke",
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: [],
        warnings: [],
        ir: {
          version: "1.0.0",
          schemas: {
            public: {
              tables: [
                {
                  name: "events",
                  schema: "public",
                  columns: [
                    {
                      name: "id",
                      dataType: "uuid",
                      nullable: false,
                      isPrimaryKey: true,
                      sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_events.sql", line: 1 }],
                    },
                    {
                      name: "tenant_id",
                      dataType: "uuid",
                      nullable: false,
                      sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_events.sql", line: 2 }],
                    },
                  ],
                  rls: {
                    rlsEnabled: false,
                    forceRls: false,
                    policies: [],
                  },
                  sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_events.sql", line: 1 }],
                },
                {
                  name: "projects",
                  schema: "public",
                  columns: [
                    {
                      name: "id",
                      dataType: "uuid",
                      nullable: false,
                      isPrimaryKey: true,
                      sources: [{ kind: "sql_migration", path: "supabase/migrations/0002_projects.sql", line: 1 }],
                    },
                    {
                      name: "tenant_id",
                      dataType: "uuid",
                      nullable: false,
                      sources: [{ kind: "sql_migration", path: "supabase/migrations/0002_projects.sql", line: 2 }],
                    },
                  ],
                  rls: {
                    rlsEnabled: true,
                    forceRls: false,
                    policies: [
                      {
                        name: "projects_read",
                        mode: "PERMISSIVE",
                        command: "SELECT",
                        roles: ["authenticated"],
                        usingExpression: "current_tenant() = user_tenant()",
                        withCheckExpression: null,
                      },
                    ],
                  },
                  sources: [{ kind: "sql_migration", path: "supabase/migrations/0002_projects.sql", line: 1 }],
                },
              ],
              views: [],
              enums: [],
              rpcs: [
                {
                  name: "refresh_events",
                  schema: "public",
                  argTypes: [],
                  sources: [{ kind: "sql_migration", path: "supabase/migrations/0003_refresh_events.sql", line: 1 }],
                  bodyText: "BEGIN UPDATE public.events SET id = id; END;",
                },
              ],
            },
          },
        },
      });
    } finally {
      store.close();
    }

    const output = TenantLeakAuditToolOutputSchema.parse(
      await invokeTool("tenant_leak_audit", {
        projectId,
        acknowledgeAdvisory: true,
      }),
    );

    await assert.rejects(
      () => invokeTool("tenant_leak_audit", { projectId }),
      (error: unknown) => {
        assert.equal(typeof error, "object");
        assert.equal((error as { code?: string }).code, "invalid_tool_input");
        assert.match(
          JSON.stringify((error as { details?: unknown }).details ?? {}),
          /acknowledgeAdvisory/,
        );
        return true;
      },
    );

    assert.equal(output.toolName, "tenant_leak_audit");
    assert.equal(output.result.advisoryOnly, true);
    assert.equal(output.result.rolloutStage, "opt_in");
    assert.deepEqual(output.result.basis, {
      latestIndexRunId,
      schemaSnapshotId: "tenant_leak_audit_snapshot",
      schemaFingerprint: "tenant-leak-audit-smoke",
    });
    assert.deepEqual(output.result.tenantSignals.includes("tenant_id"), true);
    assert.deepEqual(
      output.result.protectedTables.map((entry) => entry.tableKey),
      ["public.events", "public.projects"],
    );
    assert.deepEqual(output.result.recommendedFollowOn, {
      toolName: "workflow_packet",
      family: "implementation_brief",
      reason:
        "turn the direct tenant-protection gap into one implementation brief with concrete remediation and verification guidance",
    });

    const directFinding = output.result.findings.find((entry) => entry.code === "table_rls_disabled");
    assert.ok(directFinding, "expected direct RLS finding");
    assert.equal(directFinding?.strength, "direct_evidence");
    assert.equal(directFinding?.surfaceKind, "table");
    assert.ok((directFinding?.evidenceRefs.length ?? 0) > 0);

    const rpcFinding = output.result.findings.find(
      (entry) => entry.code === "rpc_touches_protected_table_without_tenant_signal",
    );
    assert.ok(rpcFinding, "expected weak RPC finding");
    assert.equal(rpcFinding?.strength, "weak_signal");
    // Finding B regression: rpcSurfaceKey used to double-qualify as
    // `public.public.refresh_events()` because `buildRpcKey` already
    // includes the schema. surfaceKey must be the single-schema form
    // matching the graph's rpc node key, and the rendered message must
    // not contain `public.public.`.
    assert.equal(rpcFinding?.surfaceKey, "public.refresh_events()");
    assert.doesNotMatch(
      rpcFinding?.message ?? "",
      /public\.public\./,
      "RPC finding messages must not double-qualify the schema",
    );

    const routeFinding = output.result.findings.find(
      (entry) => entry.code === "route_rpc_usage_missing_tenant_signal",
    );
    assert.ok(routeFinding, "expected weak route usage finding");
    assert.equal(routeFinding?.surfaceKind, "route");

    const reviewedTable = output.result.reviewedSurfaces.find(
      (entry) => entry.surfaceKind === "table" && entry.surfaceKey === "public.projects",
    );
    assert.ok(reviewedTable, "expected reviewed safe table surface");
    assert.equal(reviewedTable?.classification, "not_a_leak");

    assert.deepEqual(output.result.summary, {
      protectedTableCount: 2,
      directEvidenceCount: 1,
      weakSignalCount: 2,
      reviewedSurfaceCount: 1,
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

void main();
