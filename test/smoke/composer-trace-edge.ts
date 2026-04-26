/**
 * Phase 3.6.1 smoke — trace_edge composer end-to-end.
 *
 * Proves:
 *   - `searchRoutes(name)` surfaces the edge's own route metadata
 *   - ast-grep finds app-code callers of `supabase.functions.invoke('$NAME', ...)`
 *     and `fetch('/functions/v1/$NAME')` in FTS-retrieved candidate files
 *   - ast-grep finds `.from('$TABLE')` / `.rpc('$FN')` in the handler's own file
 *   - `searchSchemaBodies(name)` filtered to triggers surfaces DB triggers that
 *     reference the edge via `net.http`
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-trace-edge-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  mkdirSync(path.join(projectRoot, "supabase", "functions", "email_dispatch"), {
    recursive: true,
  });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "trace-edge-smoke", version: "0.0.0" }),
  );

  const handlerPath = path.join(
    projectRoot,
    "supabase",
    "functions",
    "email_dispatch",
    "index.ts",
  );
  const handlerBody = [
    "import { createClient } from '@supabase/supabase-js';",
    "",
    "export default async function handler() {",
    "  const supabase = createClient('url', 'key');",
    "  await supabase.from('email_log').insert({});",
    "  await supabase.rpc('enqueue_email', { payload: {} });",
    "  return new Response('ok');",
    "}",
  ].join("\n");
  writeFileSync(handlerPath, handlerBody);

  const callerPath = path.join(projectRoot, "src", "caller.ts");
  const callerBody = [
    "import { supabase } from './client';",
    "",
    "export async function sendEmail() {",
    "  await supabase.functions.invoke('email_dispatch', { body: {} });",
    "  await fetch('/functions/v1/email_dispatch', { method: 'POST' });",
    "}",
  ].join("\n");
  writeFileSync(callerPath, callerBody);

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "trace-edge-smoke",
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
        name: "trace-edge-smoke",
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
            path: "supabase/functions/email_dispatch/index.ts",
            sha256: "handler",
            language: "typescript",
            sizeBytes: handlerBody.length,
            lineCount: handlerBody.split("\n").length,
            chunks: [
              {
                chunkKind: "file",
                name: "supabase/functions/email_dispatch/index.ts",
                lineStart: 1,
                lineEnd: handlerBody.split("\n").length,
                content: handlerBody,
              },
            ],
            symbols: [],
            imports: [],
            routes: [
              {
                routeKey: "edge:email-dispatch",
                framework: "supabase-edge",
                pattern: "/functions/v1/email_dispatch",
                method: "POST",
                handlerName: "email_dispatch",
                isApi: true,
              },
            ],
          },
          {
            path: "src/caller.ts",
            sha256: "caller",
            language: "typescript",
            sizeBytes: callerBody.length,
            lineCount: callerBody.split("\n").length,
            chunks: [
              {
                chunkKind: "file",
                name: "src/caller.ts",
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
        fingerprint: "trace-edge-smoke",
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
                  columns: [],
                  triggers: [
                    {
                      name: "invoke_email_dispatch",
                      enabled: true,
                      enabledMode: "O",
                      timing: "AFTER",
                      events: ["INSERT"],
                      bodyText:
                        "CREATE TRIGGER invoke_email_dispatch AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION net.http_post(url := 'https://example.com/functions/v1/email_dispatch');",
                    },
                  ],
                },
                {
                  name: "email_dispatch",
                  schema: "public",
                  sources: [],
                  columns: [],
                  triggers: [
                    {
                      name: "audit_email_dispatch",
                      enabled: true,
                      enabledMode: "O",
                      timing: "AFTER",
                      events: ["INSERT"],
                      bodyText:
                        "CREATE TRIGGER audit_email_dispatch AFTER INSERT ON email_dispatch FOR EACH ROW EXECUTE FUNCTION audit_row();",
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

    const output = (await invokeTool("trace_edge", {
      projectId,
      name: "email_dispatch",
    })) as {
      toolName: string;
      result: {
        packet: {
          evidence: Array<{ kind: string; title: string; content: string }>;
        };
      };
    };

    assert.equal(output.toolName, "trace_edge");
    const evidence = output.result.packet.evidence;

    assert.ok(
      evidence.some(
        (b) => b.kind === "route" && b.title.includes("/functions/v1/email_dispatch"),
      ),
      "expected the edge's own route to appear",
    );
    assert.ok(
      evidence.some(
        (b) => b.kind === "finding" && b.title.startsWith("invokes 'email_dispatch' at "),
      ),
      "ast-grep must find an invoke or fetch caller",
    );
    assert.ok(
      evidence.some(
        (b) => b.kind === "finding" && b.title === "handler touches table email_log",
      ),
      "handler's own .from('email_log') call must surface as a table touch",
    );
    assert.ok(
      evidence.some(
        (b) => b.kind === "finding" && b.title === "handler touches rpc enqueue_email",
      ),
      "handler's own .rpc('enqueue_email') call must surface as an rpc touch",
    );
    assert.ok(
      evidence.some(
        (b) =>
          b.kind === "schema" &&
          b.title.startsWith("trigger public.invoke_email_dispatch"),
      ),
      "schema-bodies should surface the trigger whose body mentions the edge",
    );
    assert.ok(
      !evidence.some(
        (b) =>
          b.kind === "schema" &&
          b.title.startsWith("trigger public.audit_email_dispatch"),
      ),
      "trigger hits must not be fabricated from table-name-only matches",
    );

    console.log("composer-trace-edge: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
