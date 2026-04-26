/**
 * Phase 3.6.1 smoke — trace_table composer end-to-end.
 *
 * Proves:
 *   - getSchemaTableSnapshot surfaces columns/indexes/FKs/RLS/triggers
 *   - listFunctionTableRefs({ tableName, targetSchema }) surfaces RPC → table edges
 *     (with argTypes preserved for overloaded functions)
 *   - ast-grep `.from('$TABLE')` confirms app-code call sites
 *   - Degrades cleanly when the table is missing from the snapshot
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { TraceTableToolOutput } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-trace-table-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "trace-table-smoke", version: "0.0.0" }),
  );

  const callerPath = path.join(projectRoot, "src", "events-repo.ts");
  const callerBody = [
    "import { supabase } from './client';",
    "",
    "export async function loadEvents() {",
    "  return supabase.from('events').select('*');",
    "}",
    "",
    "export async function archiveEvents(id: string) {",
    "  return supabase.from('events').update({ archived: true }).eq('id', id);",
    "}",
  ].join("\n");
  writeFileSync(callerPath, callerBody);

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "trace-table-smoke",
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
        name: "trace-table-smoke",
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
            path: "src/events-repo.ts",
            sha256: "events",
            language: "typescript",
            sizeBytes: callerBody.length,
            lineCount: callerBody.split("\n").length,
            chunks: [
              {
                chunkKind: "file",
                name: "src/events-repo.ts",
                lineStart: 1,
                lineEnd: callerBody.split("\n").length,
                content: callerBody,
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
      store.beginIndexRun("smoke");

      const now = new Date().toISOString();
      store.saveSchemaSnapshot({
        snapshotId: `snap_${randomUUID()}`,
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "trace-table-smoke",
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
                      name: "archived",
                      dataType: "boolean",
                      nullable: false,
                      defaultExpression: "false",
                      sources: [],
                    },
                  ],
                  indexes: [
                    {
                      name: "idx_events_pkey",
                      unique: true,
                      primary: true,
                      columns: ["id"],
                    },
                  ],
                  rls: {
                    rlsEnabled: true,
                    forceRls: false,
                    policies: [],
                  },
                  triggers: [
                    {
                      name: "events_touch",
                      enabled: true,
                      enabledMode: "O",
                      timing: "BEFORE",
                      events: ["UPDATE"],
                    },
                  ],
                },
              ],
              views: [],
              enums: [],
              rpcs: [
                {
                  name: "refresh_events",
                  schema: "public",
                  argTypes: [],
                  sources: [],
                  bodyText:
                    "BEGIN UPDATE events SET updated_at = now() WHERE archived = false; END;",
                },
              ],
            },
            private: {
              tables: [
                {
                  name: "events",
                  schema: "private",
                  sources: [],
                  columns: [],
                },
              ],
              views: [],
              enums: [],
              rpcs: [
                {
                  name: "refresh_private_events",
                  schema: "private",
                  argTypes: [],
                  sources: [],
                  bodyText:
                    "BEGIN UPDATE private.events SET updated_at = now() WHERE true; END;",
                },
              ],
            },
          },
        },
      });
    } finally {
      store.close();
    }

    const output = (await invokeTool("trace_table", {
      projectId,
      table: "events",
    })) as TraceTableToolOutput;

    assert.equal(output.toolName, "trace_table");
    assert.ok(output.result.companionPacket, "expected trace_table to attach a companion workflow packet");
    assert.equal(output.result.companionPacket?.packet.family, "verification_plan");
    assert.match(
      output.result.companionPacket?.attachmentReason ?? "",
      /queryKind=trace_table/,
      "expected the companion packet to explain why it attached",
    );
    assert.match(
      output.result.companionPacket?.rendered ?? "",
      /## Verification/,
      "expected the companion packet to render a verification plan",
    );
    assert.equal(output.result.candidateActions[0]?.label, "Follow verification plan");
    assert.match(output.result.candidateActions[0]?.description ?? "", /Current:/);
    assert.match(output.result.candidateActions[0]?.description ?? "", /Stop when:/);
    assert.equal(output.result.candidateActions[0]?.execute?.toolName, "workflow_packet");
    assert.equal(output.result.candidateActions[0]?.execute?.input.family, "verification_plan");
    assert.equal(output.result.candidateActions[0]?.execute?.input.queryKind, "trace_table");
    assert.equal(output.result.candidateActions[0]?.execute?.input.queryText, "events");
    assert.deepEqual(output.result.candidateActions[0]?.execute?.input.queryArgs, {
      table: "events",
      schema: "public",
    });
    const workflowPacketOutput = await invokeTool(
      "workflow_packet",
      output.result.candidateActions[0]!.execute!.input as never,
    );
    assert.equal((workflowPacketOutput as { toolName: string }).toolName, "workflow_packet");
    const evidence = output.result.packet.evidence;

    assert.ok(
      evidence.some((b) => b.kind === "schema" && b.title.startsWith("column events.id")),
      "columns should surface from getSchemaTableSnapshot",
    );
    assert.ok(
      evidence.some((b) => b.kind === "schema" && b.title.startsWith("index idx_events_pkey")),
      "indexes should surface",
    );
    assert.ok(
      evidence.some(
        (b) => b.kind === "schema" && b.title.startsWith("trigger events_touch"),
      ),
      "triggers should surface",
    );
    assert.ok(
      evidence.some(
        (b) =>
          b.kind === "trace" &&
          b.title.startsWith("public.refresh_events → public.events"),
      ),
      "listFunctionTableRefs should surface an RPC → table edge",
    );
    assert.ok(
      !evidence.some(
        (b) =>
          b.kind === "trace" &&
          b.title.startsWith("private.refresh_private_events → private.events"),
      ),
      "trace_table(public.events) must not leak refs for private.events",
    );
    assert.ok(
      evidence.filter(
        (b) => b.kind === "finding" && b.title.startsWith(".from('events') at "),
      ).length >= 2,
      "ast-grep should find both .from('events') call sites in the caller file",
    );

    // Degraded path: unknown table
    const missing = (await invokeTool("trace_table", {
      projectId,
      table: "ghost",
    })) as TraceTableToolOutput;
    assert.ok(
      missing.result.packet.missingInformation.length >= 1,
      "missing table should populate missingInformation",
    );
    assert.equal(missing.result.packet.evidenceStatus, "partial");

    console.log("composer-trace-table: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
