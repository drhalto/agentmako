/**
 * Phase 3.6.1 smoke — cross_search composer end-to-end.
 *
 * Proves:
 *   - code chunk hits (`chunkKind: "trace"`) surface for the searched term
 *   - schema objects whose name matches the term surface as schema blocks
 *   - RPC / trigger bodies that contain the term surface as schema blocks
 *   - routes matching the term surface as route blocks
 *   - memories matching the term surface as document blocks
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-cross-search-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "cross-search-smoke", version: "0.0.0" }),
  );

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "cross-search-smoke",
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
        name: "cross-search-smoke",
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
          {
            path: "src/users-service.ts",
            sha256: "deadbeef",
            language: "typescript",
            sizeBytes: 120,
            lineCount: 4,
            chunks: [
              {
                chunkKind: "file",
                name: "src/users-service.ts",
                lineStart: 1,
                lineEnd: 4,
                content:
                  "export async function loadUsers() {\n  return supabase.from('users').select('*');\n}",
              },
            ],
            symbols: [
              {
                name: "loadUsers",
                kind: "function",
                exportName: "loadUsers",
                lineStart: 1,
                lineEnd: 3,
                signatureText: "export async function loadUsers()",
              },
            ],
            imports: [],
            routes: [
              {
                routeKey: "GET /api/users",
                framework: "express",
                pattern: "/api/users",
                method: "GET",
                handlerName: "listUsers",
                isApi: true,
              },
            ],
          },
        ],
        schemaObjects: [
          {
            objectKey: "public.users",
            objectType: "table",
            schemaName: "public",
            objectName: "users",
          },
        ],
        schemaUsages: [],
      });
      store.beginIndexRun("smoke");

      const now = new Date().toISOString();
      store.saveSchemaSnapshot({
        snapshotId: `snap_${randomUUID()}`,
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "cs-smoke",
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
                  name: "users",
                  schema: "public",
                  sources: [],
                  columns: [
                    {
                      name: "id",
                      dataType: "uuid",
                      nullable: false,
                      isPrimaryKey: true,
                      sources: [],
                    },
                  ],
                },
              ],
              views: [],
              enums: [],
              rpcs: [
                {
                  name: "touch_users",
                  schema: "public",
                  sources: [],
                  bodyText:
                    "BEGIN UPDATE users SET updated_at = now() WHERE id IS NOT NULL; END;",
                },
              ],
            },
          },
        },
      });

      store.insertHarnessMemory({
        projectId,
        text: "Users table owns authentication state.",
        category: "codebase",
        tags: ["users", "auth"],
      });
    } finally {
      store.close();
    }

    const output = (await invokeTool("cross_search", {
      projectId,
      term: "users",
    })) as {
      toolName: string;
      projectId: string;
      result: {
        packet: {
          evidence: Array<{ kind: string; title: string; content: string }>;
        };
      };
    };

    assert.equal(output.toolName, "cross_search");
    const evidence = output.result.packet.evidence;

    assert.ok(
      evidence.some((b) => b.kind === "trace" && b.content.includes("from('users')")),
      "expected a trace block from searchCodeChunks",
    );
    assert.ok(
      evidence.some((b) => b.kind === "schema" && b.title.includes("users")),
      "expected a schema block for the users table",
    );
    assert.ok(
      evidence.some((b) => b.kind === "schema" && b.title.startsWith("rpc public.touch_users")),
      "expected a schema-body match for touch_users (body contains 'users')",
    );
    assert.ok(
      evidence.some((b) => b.kind === "route" && b.title.includes("/api/users")),
      "expected a route block",
    );
    assert.ok(
      evidence.some((b) => b.kind === "document" && b.content.includes("Users table")),
      "expected a memory block",
    );

    console.log("composer-cross-search: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
