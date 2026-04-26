/**
 * Phase 3.6.1 smoke — trace_rpc composer end-to-end.
 *
 * Proves:
 *   - `searchSchemaObjects` surfaces the RPC's own definition as a schema block
 *   - `searchSchemaBodies` surfaces OTHER DB bodies that reference the RPC
 *     (excluding the RPC's own body)
 *   - `listFunctionTableRefs({ rpcSchema, rpcName, argTypes })` surfaces only
 *     the targeted RPC's table edges
 *   - ast-grep `.rpc('$FN')` confirms app-code callers
 *   - Degrades cleanly when the RPC isn't in the snapshot
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { TraceRpcToolOutput } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-trace-rpc-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "trace-rpc-smoke", version: "0.0.0" }),
  );

  const callerPath = path.join(projectRoot, "src", "rpc-caller.ts");
  const callerBody = [
    "import { supabase } from './client';",
    "",
    "export async function enqueue(payload: unknown) {",
    "  return supabase.rpc('enqueue_job', { payload });",
    "}",
  ].join("\n");
  writeFileSync(callerPath, callerBody);

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "trace-rpc-smoke",
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
        name: "trace-rpc-smoke",
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
            path: "src/rpc-caller.ts",
            sha256: "caller",
            language: "typescript",
            sizeBytes: callerBody.length,
            lineCount: callerBody.split("\n").length,
            chunks: [
              {
                chunkKind: "file",
                name: "src/rpc-caller.ts",
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
        schemaObjects: [
          {
            objectKey: "public.enqueue_job",
            objectType: "rpc",
            schemaName: "public",
            objectName: "enqueue_job",
          },
          {
            objectKey: "private.enqueue_job",
            objectType: "rpc",
            schemaName: "private",
            objectName: "enqueue_job",
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
        fingerprint: "trace-rpc-smoke",
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
                  name: "jobs",
                  schema: "public",
                  sources: [],
                  columns: [],
                },
                {
                  name: "job_text",
                  schema: "public",
                  sources: [],
                  columns: [],
                },
              ],
              views: [],
              enums: [],
              rpcs: [
                {
                  name: "enqueue_job",
                  schema: "public",
                  argTypes: ["jsonb"],
                  sources: [],
                  bodyText:
                    "BEGIN INSERT INTO jobs(id, payload) VALUES (gen_random_uuid(), $1); END;",
                },
                {
                  name: "enqueue_job",
                  schema: "public",
                  argTypes: ["text"],
                  sources: [],
                  bodyText:
                    "BEGIN INSERT INTO job_text(payload) VALUES ($1); END;",
                },
                {
                  name: "bulk_enqueue",
                  schema: "public",
                  argTypes: ["jsonb[]"],
                  sources: [],
                  bodyText:
                    "BEGIN PERFORM enqueue_job(item) FROM unnest($1) AS item; END;",
                },
              ],
            },
            private: {
              tables: [
                {
                  name: "shadow_jobs",
                  schema: "private",
                  sources: [],
                  columns: [],
                },
              ],
              views: [],
              enums: [],
              rpcs: [
                {
                  name: "enqueue_job",
                  schema: "private",
                  argTypes: ["text"],
                  sources: [],
                  bodyText:
                    "BEGIN PERFORM public.enqueue_job($1::jsonb); END;",
                },
              ],
            },
          },
        },
      });
    } finally {
      store.close();
    }

    const output = (await invokeTool("trace_rpc", {
      projectId,
      name: "enqueue_job",
      schema: "public",
      argTypes: ["jsonb"],
    })) as TraceRpcToolOutput;

    assert.equal(output.toolName, "trace_rpc");
    assert.ok(output.result.companionPacket, "expected trace_rpc to attach a companion workflow packet");
    assert.equal(output.result.companionPacket?.packet.family, "verification_plan");
    assert.match(
      output.result.companionPacket?.attachmentReason ?? "",
      /queryKind=trace_rpc/,
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
    assert.equal(output.result.candidateActions[0]?.execute?.input.queryKind, "trace_rpc");
    assert.equal(output.result.candidateActions[0]?.execute?.input.queryText, "enqueue_job");
    assert.deepEqual(output.result.candidateActions[0]?.execute?.input.queryArgs, {
      name: "enqueue_job",
      schema: "public",
      argTypes: ["jsonb"],
    });
    const workflowPacketOutput = await invokeTool(
      "workflow_packet",
      output.result.candidateActions[0]!.execute!.input as never,
    );
    assert.equal((workflowPacketOutput as { toolName: string }).toolName, "workflow_packet");
    const evidence = output.result.packet.evidence;

    assert.ok(
      evidence.some(
        (b) => b.kind === "schema" && b.title === "rpc public.enqueue_job",
      ),
      "the RPC's own definition should surface via searchSchemaObjects",
    );
    assert.ok(
      evidence.some(
        (b) => b.kind === "schema" && b.title.startsWith("rpc public.bulk_enqueue"),
      ),
      "bulk_enqueue body (which calls enqueue_job) should surface via searchSchemaBodies",
    );
    assert.ok(
      evidence.some(
        (b) => b.kind === "schema" && b.title.startsWith("rpc private.enqueue_job(text)"),
      ),
      "same-name RPCs in other schemas should surface when their body references the target RPC",
    );
    assert.ok(
      evidence.some(
        (b) =>
          b.kind === "trace" &&
          b.title.startsWith("public.enqueue_job(jsonb) → public.jobs"),
      ),
      "listFunctionTableRefs should surface enqueue_job → jobs edge",
    );
    assert.ok(
      !evidence.some(
        (b) =>
          b.kind === "trace" &&
          b.title.startsWith("public.enqueue_job(text) → public.job_text"),
      ),
      "argTypes must scope trace_rpc to the requested overload",
    );
    assert.ok(
      evidence.some(
        (b) => b.kind === "finding" && b.title.startsWith(".rpc('enqueue_job') at "),
      ),
      "ast-grep should find the .rpc('enqueue_job') call site",
    );

    const missing = (await invokeTool("trace_rpc", {
      projectId,
      name: "not_an_rpc",
    })) as TraceRpcToolOutput;
    assert.ok(
      missing.result.packet.missingInformation.length >= 1,
      "missing rpc should populate missingInformation",
    );
    assert.equal(missing.result.packet.evidenceStatus, "partial");

    console.log("composer-trace-rpc: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
