/**
 * Phase 3.6.1 smoke — preflight_table composer end-to-end.
 *
 * Proves:
 *   - The composer reads the full SchemaTable snapshot surface (columns,
 *     indexes, FKs, RLS policies, triggers) via `getSchemaTableSnapshot`.
 *   - `searchRoutes(tableName)` contributes related routes.
 *   - ast-grep on FTS-retrieved candidate files finds `z.object({ ... })`
 *     declarations whose surrounding file mentions the table.
 *   - Degrades gracefully when the table is not in the snapshot
 *     (`missingInformation` populated, evidenceStatus = "partial").
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-preflight-table-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "preflight-smoke", version: "0.0.0" }),
  );
  const eventsSchemaBody = [
    "import { z } from 'zod';",
    "",
    "// Input schema for the events table",
    "export const EventInput = z.object({",
    "  owner_id: z.string().uuid(),",
    "  payload: z.unknown(),",
    "});",
  ].join("\n");
  const mixedBody = [
    "import { z } from 'zod';",
    "",
    "const tableName = 'events';",
    "",
    "export const UserSchema = z.object({",
    "  id: z.string().uuid(),",
    "});",
  ].join("\n");
  writeFileSync(path.join(projectRoot, "src", "events-schema.ts"), eventsSchemaBody);
  writeFileSync(path.join(projectRoot, "src", "mixed.ts"), mixedBody);

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "preflight-smoke",
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
        name: "preflight-smoke",
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

      // Seed a minimal indexed file + one route referencing the events table
      // so the code-retrieval leg has something to surface.
      store.replaceIndexSnapshot({
        files: [
          {
            path: "src/events-schema.ts",
            sha256: "deadbeef",
            language: "typescript",
            sizeBytes: eventsSchemaBody.length,
            lineCount: eventsSchemaBody.split("\n").length,
            chunks: [
              {
                chunkKind: "file",
                name: "src/events-schema.ts",
                lineStart: 1,
                lineEnd: eventsSchemaBody.split("\n").length,
                content: eventsSchemaBody,
              },
            ],
            symbols: [
              {
                name: "EventInput",
                kind: "variable",
                exportName: "EventInput",
                lineStart: 4,
                lineEnd: 7,
                signatureText: "export const EventInput = z.object(...)",
              },
            ],
            imports: [],
            routes: [
              {
                routeKey: "GET /api/events",
                framework: "express",
                pattern: "/api/events",
                method: "GET",
                handlerName: "listEvents",
                isApi: true,
              },
            ],
          },
          {
            path: "src/mixed.ts",
            sha256: "cafebabe",
            language: "typescript",
            sizeBytes: mixedBody.length,
            lineCount: mixedBody.split("\n").length,
            chunks: [
              {
                chunkKind: "file",
                name: "src/mixed.ts",
                lineStart: 1,
                lineEnd: mixedBody.split("\n").length,
                content: mixedBody,
              },
            ],
            symbols: [
              {
                name: "UserSchema",
                kind: "variable",
                exportName: "UserSchema",
                lineStart: 3,
                lineEnd: 3,
                signatureText: "export const UserSchema = z.object(...)",
              },
            ],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
      store.beginIndexRun("smoke");

      const now = new Date().toISOString();
      store.saveSchemaSnapshot({
        snapshotId: `snap_${randomUUID()}`,
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "smoke-fingerprint",
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
                  sources: [],
                  columns: [
                    {
                      name: "id",
                      dataType: "uuid",
                      nullable: false,
                      isPrimaryKey: true,
                      sources: [],
                    },
                    {
                      name: "owner_id",
                      dataType: "uuid",
                      nullable: false,
                      sources: [],
                    },
                    {
                      name: "payload",
                      dataType: "jsonb",
                      nullable: false,
                      sources: [],
                    },
                  ],
                  primaryKey: ["id"],
                  indexes: [
                    {
                      name: "idx_events_owner",
                      unique: true,
                      primary: false,
                      columns: ["owner_id"],
                    },
                  ],
                  foreignKeys: {
                    outbound: [
                      {
                        constraintName: "events_owner_id_fkey",
                        columns: ["owner_id"],
                        targetSchema: "public",
                        targetTable: "users",
                        targetColumns: ["id"],
                        onUpdate: "NO ACTION",
                        onDelete: "CASCADE",
                      },
                    ],
                    inbound: [],
                  },
                  rls: {
                    rlsEnabled: true,
                    forceRls: true,
                    policies: [
                      {
                        name: "events_read",
                        mode: "PERMISSIVE",
                        command: "SELECT",
                        roles: ["authenticated"],
                        usingExpression: "owner_id IS NOT NULL",
                        withCheckExpression: null,
                      },
                    ],
                  },
                  triggers: [
                    {
                      name: "events_audit",
                      enabled: true,
                      enabledMode: "O",
                      timing: "AFTER",
                      events: ["INSERT"],
                    },
                  ],
                },
              ],
              views: [],
              enums: [],
              rpcs: [],
            },
          },
        },
      });
    } finally {
      store.close();
    }

    const output = (await invokeTool("preflight_table", {
      projectId,
      table: "events",
    })) as {
      toolName: string;
      projectId: string;
      result: {
        packet: {
          evidence: Array<{ kind: string; title: string; metadata?: Record<string, unknown> }>;
          missingInformation: string[];
          evidenceStatus: string;
        };
      };
    };

    assert.equal(output.toolName, "preflight_table");
    assert.equal(output.projectId, projectId);

    const evidence = output.result.packet.evidence;
    const schemaBlocks = evidence.filter((b) => b.kind === "schema");
    assert.ok(
      schemaBlocks.some((b) => b.title.startsWith("column events.id")),
      "columns should surface as schema blocks",
    );
    assert.ok(
      schemaBlocks.some((b) => b.title.startsWith("index idx_events_owner")),
      "indexes should surface as schema blocks",
    );
    assert.ok(
      schemaBlocks.some((b) => b.title.startsWith("FK events_owner_id_fkey")),
      "foreign keys should surface as schema blocks",
    );
    assert.ok(
      schemaBlocks.some((b) => b.title.startsWith("RLS on events")),
      "RLS state should surface",
    );
    assert.ok(
      schemaBlocks.some((b) => b.title.startsWith("policy events_read")),
      "RLS policies should surface",
    );
    assert.ok(
      schemaBlocks.some((b) => b.title.startsWith("trigger events_audit")),
      "triggers should surface",
    );

    assert.ok(
      evidence.some((b) => b.kind === "route" && b.title.includes("/api/events")),
      "routes matching the table name should surface",
    );

    assert.ok(
      evidence.some((b) => b.kind === "finding" && b.title.startsWith("zod schema in ")),
      "ast-grep should find at least one zod schema in a file that mentions the table",
    );
    assert.ok(
      !evidence.some(
        (b) => b.kind === "finding" && b.title === "zod schema in src/mixed.ts",
      ),
      "unrelated zod schemas must not surface just because the file mentions the table elsewhere",
    );

    // Degraded path: unknown table
    const missing = (await invokeTool("preflight_table", {
      projectId,
      table: "ghost_table",
    })) as {
      result: { packet: { missingInformation: string[]; evidenceStatus: string } };
    };
    assert.ok(
      missing.result.packet.missingInformation.length >= 1,
      "missing table should populate missingInformation",
    );
    assert.equal(missing.result.packet.evidenceStatus, "partial");

    console.log("composer-preflight-table: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
