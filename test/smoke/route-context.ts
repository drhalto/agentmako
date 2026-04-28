import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RouteContextToolOutput, SchemaSnapshot } from "../../packages/contracts/src/index.ts";
import { RouteContextToolOutputSchema } from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-route-context-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "route-context-smoke" }));
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "route-context-smoke",
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
        name: "route-context-smoke",
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
          {
            ...file("app/api/admin/users/[id]/route.ts", "import { handleBanUser } from './handler';"),
            imports: [
              {
                targetPath: "app/api/admin/users/[id]/handler.ts",
                specifier: "./handler",
                importKind: "value",
                line: 1,
              },
            ],
            routes: [
              {
                routeKey: "nextjs:POST:/api/admin/users/[id]",
                framework: "nextjs",
                pattern: "/api/admin/users/[id]",
                method: "POST",
                isApi: true,
              },
            ],
          },
          {
            ...file("app/api/admin/users/[id]/handler.ts", "import { banUser } from '../../../../../lib/admin/dal';"),
            imports: [
              {
                targetPath: "lib/admin/dal.ts",
                specifier: "../../../../../lib/admin/dal",
                importKind: "value",
                line: 1,
              },
            ],
          },
          file("lib/admin/dal.ts", "export async function banUser() { return null; }"),
        ],
        schemaObjects: [
          {
            objectKey: "public.admin_users",
            objectType: "table",
            schemaName: "public",
            objectName: "admin_users",
          },
          {
            objectKey: "public.admin_ban_user",
            objectType: "rpc",
            schemaName: "public",
            objectName: "admin_ban_user",
          },
        ],
        schemaUsages: [
          {
            objectKey: "public.admin_ban_user",
            filePath: "lib/admin/dal.ts",
            usageKind: "call",
            line: 4,
            excerpt: "supabase.rpc('admin_ban_user')",
          },
          {
            objectKey: "public.admin_users",
            filePath: "lib/admin/dal.ts",
            usageKind: "read",
            line: 5,
            excerpt: "supabase.from('admin_users').select('*')",
          },
        ],
      });
      store.saveSchemaSnapshot(createSnapshot());
    } finally {
      store.close();
    }

    const output = RouteContextToolOutputSchema.parse(await invokeTool("route_context", {
      projectId,
      route: "POST /api/admin/users/[id]",
    })) as RouteContextToolOutput;

    assert.equal(output.toolName, "route_context");
    assert.equal(output.resolvedRoute?.pattern, "/api/admin/users/[id]");
    assert.equal(output.handlerFile?.path, "app/api/admin/users/[id]/route.ts");
    assert.equal(output.outboundImports.entries.length, 1, "route should expose direct handler import");
    assert.equal(output.outboundImports.entries[0]?.targetPath, "app/api/admin/users/[id]/handler.ts");
    assert.equal(output.downstreamRpcs.entries.length, 1, "route should expose downstream RPC through imported files");
    assert.ok(
      output.downstreamTables.entries.some((entry) => entry.tableName === "admin_users"),
      "route should expose downstream table touches",
    );
    assert.equal(output.rlsPolicies.entries.length, 1, "nearest table RLS policy should surface");
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("route_trace:")));
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("file_health:")));
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("imports_deps:")));
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("trace_rpc:")));

    console.log("route-context: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function file(pathname: string, body: string) {
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
    routes: [],
  };
}

function createSnapshot(): SchemaSnapshot {
  const now = new Date().toISOString();
  return {
    snapshotId: `snap_${randomUUID()}`,
    sourceMode: "repo_only",
    generatedAt: now,
    refreshedAt: now,
    fingerprint: "route-context-smoke",
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
              name: "admin_users",
              schema: "public",
              columns: [
                {
                  name: "id",
                  dataType: "uuid",
                  nullable: false,
                  isPrimaryKey: true,
                  sources: [],
                },
              ],
              rls: {
                rlsEnabled: true,
                forceRls: false,
                policies: [
                  {
                    name: "admin_users_admin_only",
                    mode: "PERMISSIVE",
                    command: "ALL",
                    roles: ["authenticated"],
                    usingExpression: "is_admin(auth.uid())",
                    withCheckExpression: "is_admin(auth.uid())",
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
              bodyText: "BEGIN UPDATE public.admin_users SET banned = true WHERE id = $1; END;",
              sources: [],
            },
          ],
        },
      },
    },
  };
}

main().catch((error) => {
  console.error("route-context: FAIL");
  console.error(error);
  process.exit(1);
});
