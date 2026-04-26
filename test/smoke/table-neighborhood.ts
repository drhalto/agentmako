import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SchemaSnapshot, TableNeighborhoodToolOutput } from "../../packages/contracts/src/index.ts";
import { TableNeighborhoodToolOutputSchema } from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-table-neighborhood-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "table-neighborhood-smoke" }));
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "table-neighborhood-smoke",
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
        name: "table-neighborhood-smoke",
        rootPath: projectRoot,
        framework: "nextjs",
        orm: "supabase",
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
          file("app/admin/audit/page.tsx", "export default function AuditPage() { return null; }", [
            {
              routeKey: "nextjs:GET:/admin/audit",
              framework: "nextjs",
              pattern: "/admin/audit",
              method: "GET",
              isApi: false,
            },
          ]),
          file("lib/admin/audit-reader.ts", "export const readAudit = () => null;"),
          file("lib/admin/audit-writer.ts", "export const writeAudit = () => null;"),
        ],
        schemaObjects: [
          {
            objectKey: "public.admin_audit_log",
            objectType: "table",
            schemaName: "public",
            objectName: "admin_audit_log",
          },
        ],
        schemaUsages: [
          {
            objectKey: "public.admin_audit_log",
            filePath: "app/admin/audit/page.tsx",
            usageKind: "read",
            line: 7,
            excerpt: "supabase.from('admin_audit_log').select('*')",
          },
          {
            objectKey: "public.admin_audit_log",
            filePath: "lib/admin/audit-reader.ts",
            usageKind: "read",
            line: 3,
            excerpt: "admin_audit_log read helper",
          },
          {
            objectKey: "public.admin_audit_log",
            filePath: "lib/admin/audit-writer.ts",
            usageKind: "write",
            line: 5,
            excerpt: "insert into admin_audit_log",
          },
        ],
      });
      store.saveSchemaSnapshot(createSnapshot());
    } finally {
      store.close();
    }

    const output = TableNeighborhoodToolOutputSchema.parse(await invokeTool("table_neighborhood", {
      projectId,
      tableName: "admin_audit_log",
    })) as TableNeighborhoodToolOutput;

    assert.equal(output.toolName, "table_neighborhood");
    assert.equal(output.projectId, projectId);
    assert.equal(output.schemaName, "public");
    assert.equal(output.table?.columns.length, 2, "table section should include column data");
    assert.equal(output.rls?.policies.length, 1, "RLS policy should surface");
    assert.equal(output.reads.entries.length, 2, "two reader files expected");
    assert.equal(output.writes.entries.length, 1, "one writer file expected");
    assert.equal(output.dependentRpcs.entries.length, 1, "one RPC should reference the table");
    assert.equal(output.dependentRoutes.entries.length, 1, "one route should touch the table");
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("db_table_schema:")));
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("db_rls:")));
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("schema_usage:")));
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("trace_table:")));
    assert.ok(Buffer.byteLength(JSON.stringify(output), "utf8") < 200_000);

    const truncated = TableNeighborhoodToolOutputSchema.parse(await invokeTool("table_neighborhood", {
      projectId,
      tableName: "admin_audit_log",
      maxPerSection: 1,
    })) as TableNeighborhoodToolOutput;
    assert.equal(truncated.reads.entries.length, 1);
    assert.equal(truncated.reads.totalCount, 2);
    assert.equal(truncated.reads.truncated, true);
    assert.ok(truncated.warnings.some((warning) => warning.includes("reads truncated")));

    console.log("table-neighborhood: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function file(pathname: string, body: string, routes = [] as Array<{
  routeKey: string;
  framework: string;
  pattern: string;
  method?: string;
  isApi?: boolean;
}>): {
  path: string;
  sha256: string;
  language: string;
  sizeBytes: number;
  lineCount: number;
  chunks: Array<{
    chunkKind: string;
    name: string;
    lineStart: number;
    lineEnd: number;
    content: string;
  }>;
  symbols: [];
  imports: [];
  routes: typeof routes;
} {
  return {
    path: pathname,
    sha256: pathname,
    language: pathname.endsWith(".tsx") ? "tsx" : "typescript",
    sizeBytes: body.length,
    lineCount: body.split("\n").length,
    chunks: [
      {
        chunkKind: "file",
        name: pathname,
        lineStart: 1,
        lineEnd: body.split("\n").length,
        content: body,
      },
    ],
    symbols: [],
    imports: [],
    routes,
  };
}

function createSnapshot(): SchemaSnapshot {
  const now = new Date().toISOString();
  return {
    snapshotId: `snap_${randomUUID()}`,
    sourceMode: "repo_only",
    generatedAt: now,
    refreshedAt: now,
    fingerprint: "table-neighborhood-smoke",
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
              name: "admin_audit_log",
              schema: "public",
              columns: [
                {
                  name: "id",
                  dataType: "uuid",
                  nullable: false,
                  isPrimaryKey: true,
                  sources: [],
                },
                {
                  name: "actor_id",
                  dataType: "uuid",
                  nullable: false,
                  sources: [],
                },
              ],
              rls: {
                rlsEnabled: true,
                forceRls: false,
                policies: [
                  {
                    name: "admin_audit_log_admin_read",
                    mode: "PERMISSIVE",
                    command: "SELECT",
                    roles: ["authenticated"],
                    usingExpression: "is_admin(actor_id)",
                    withCheckExpression: null,
                  },
                ],
              },
              sources: [],
            },
          ],
          views: [],
          enums: [],
          rpcs: [
            {
              name: "admin_ban_user",
              schema: "public",
              argTypes: ["uuid"],
              returnType: "void",
              bodyText: "BEGIN INSERT INTO public.admin_audit_log(id, actor_id) VALUES (gen_random_uuid(), $1); END;",
              sources: [],
            },
          ],
        },
      },
    },
  };
}

main().catch((error) => {
  console.error("table-neighborhood: FAIL");
  console.error(error);
  process.exit(1);
});
