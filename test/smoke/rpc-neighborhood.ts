import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RpcNeighborhoodToolOutput, SchemaSnapshot } from "../../packages/contracts/src/index.ts";
import { RpcNeighborhoodToolOutputSchema } from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-rpc-neighborhood-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "rpc-neighborhood-smoke" }));
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "rpc-neighborhood-smoke",
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
        name: "rpc-neighborhood-smoke",
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
          file("lib/admin/user-actions.ts", "export async function banUser() { return supabase.rpc('admin_ban_user'); }"),
        ],
        schemaObjects: [
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
            filePath: "lib/admin/user-actions.ts",
            usageKind: "call",
            line: 1,
            excerpt: "supabase.rpc('admin_ban_user')",
          },
        ],
      });
      store.saveSchemaSnapshot(createSnapshot());
    } finally {
      store.close();
    }

    const output = RpcNeighborhoodToolOutputSchema.parse(await invokeTool("rpc_neighborhood", {
      projectId,
      schemaName: "public",
      rpcName: "admin_ban_user",
      argTypes: ["uuid"],
    })) as RpcNeighborhoodToolOutput;

    assert.equal(output.toolName, "rpc_neighborhood");
    assert.equal(output.rpc?.name, "admin_ban_user");
    assert.ok(output.rpc?.bodyText?.includes("admin_audit_log"), "RPC body should surface");
    assert.equal(output.callers.entries.length, 1, "one app-code caller expected");
    assert.equal(output.tablesTouched.entries.length, 2, "RPC should write two tables");
    assert.ok(
      output.tablesTouched.entries.some((entry) => entry.targetTable === "admin_audit_log"),
      "audit table edge should surface",
    );
    assert.ok(
      output.tablesTouched.entries.some((entry) => entry.targetTable === "user_roles"),
      "roles table edge should surface",
    );
    assert.equal(output.rlsPolicies.entries.length, 2, "RLS policies for both touched tables should surface");
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("db_rpc:")));
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("schema_usage:")));
    assert.ok(output.evidenceRefs.some((ref) => ref.startsWith("trace_rpc:")));

    console.log("rpc-neighborhood: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function file(pathname: string, body: string) {
  return {
    path: pathname,
    sha256: pathname,
    language: "typescript",
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
    fingerprint: "rpc-neighborhood-smoke",
    freshnessStatus: "fresh",
    driftDetected: false,
    sources: [],
    warnings: [],
    ir: {
      version: "1.0.0",
      schemas: {
        public: {
          tables: [
            table("admin_audit_log", "admin_audit_log_insert"),
            table("user_roles", "user_roles_update"),
          ],
          views: [],
          enums: [],
          rpcs: [
            {
              name: "admin_ban_user",
              schema: "public",
              argTypes: ["uuid"],
              returnType: "void",
              bodyText: [
                "BEGIN",
                "  INSERT INTO public.admin_audit_log(id, actor_id) VALUES (gen_random_uuid(), $1);",
                "  UPDATE public.user_roles SET disabled = true WHERE user_id = $1;",
                "END;",
              ].join("\n"),
              sources: [],
            },
          ],
        },
      },
    },
  };
}

function table(name: string, policyName: string) {
  return {
    name,
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
          name: policyName,
          mode: "PERMISSIVE" as const,
          command: "ALL",
          roles: ["authenticated"],
          usingExpression: "is_admin(auth.uid())",
          withCheckExpression: "is_admin(auth.uid())",
        },
      ],
    },
    sources: [],
  };
}

main().catch((error) => {
  console.error("rpc-neighborhood: FAIL");
  console.error(error);
  process.exit(1);
});
