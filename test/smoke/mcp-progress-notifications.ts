import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface IndexedNotification {
  index: number;
  notification: JsonRpcNotification;
}

interface IndexedResponse {
  index: number;
  response: JsonRpcResponse;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CLI_ENTRY = path.join(REPO_ROOT, "apps", "cli", "src", "index.ts");

class StdioClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pendingResponses = new Map<number, (response: IndexedResponse) => void>();
  private stdoutBuffer = "";
  private messageIndex = 0;
  readonly notifications: IndexedNotification[] = [];
  readonly stderrChunks: string[] = [];

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.drainStdoutLines();
    });
    child.stderr.on("data", (chunk: string) => {
      this.stderrChunks.push(chunk);
    });
  }

  private drainStdoutLines(): void {
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        let parsed: JsonRpcResponse | JsonRpcNotification;
        try {
          parsed = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
        } catch (error) {
          throw new Error(
            `stdout carried non-JSON line: ${JSON.stringify(line)} (parse error: ${error instanceof Error ? error.message : String(error)})`,
          );
        }

        this.messageIndex += 1;
        if ("id" in parsed) {
          const id = parsed.id;
          if (typeof id === "number") {
            const resolver = this.pendingResponses.get(id);
            if (resolver) {
              this.pendingResponses.delete(id);
              resolver({ index: this.messageIndex, response: parsed });
            }
          }
        } else if ("method" in parsed) {
          this.notifications.push({ index: this.messageIndex, notification: parsed });
        }
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  async request<T>(id: number, method: string, params?: unknown): Promise<{ result: T; index: number }> {
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const responsePromise = new Promise<IndexedResponse>((resolve) => {
      this.pendingResponses.set(id, resolve);
    });
    this.child.stdin.write(payload);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`timeout waiting for response to ${method} (id=${id})`)), 30_000);
    });
    const indexed = await Promise.race([responsePromise, timeout]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (indexed.response.error) {
      throw new Error(
        `JSON-RPC error for ${method}: [${indexed.response.error.code}] ${indexed.response.error.message}`,
      );
    }
    return { result: indexed.response.result as T, index: indexed.index };
  }

  notify(method: string, params?: unknown): void {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";
    this.child.stdin.write(payload);
  }

  async shutdown(): Promise<number | null> {
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
    }
    const [code] = (await once(this.child, "exit")) as [number | null, NodeJS.Signals | null];
    return code;
  }
}

function seedProject(tmp: string): { projectId: string; stateHome: string } {
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "events"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const routeBody = [
    "import { supabase } from '../../../src/supabase';",
    "",
    "function normalizeEvents() { return []; }",
    "",
    "export async function GET() {",
    "  await supabase.rpc('refresh_events');",
    "  return Response.json(normalizeEvents());",
    "}",
  ].join("\n");

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "mcp-progress-notifications-smoke", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "app", "api", "events", "route.ts"), routeBody);

  const projectId = randomUUID();
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "mcp-progress-notifications-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const projectStore = openProjectStore({ projectRoot });
  try {
    projectStore.saveProjectProfile({
      name: "mcp-progress-notifications-smoke",
      rootPath: projectRoot,
      framework: "nextjs",
      orm: "supabase",
      srcRoot: "src",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });
    projectStore.replaceIndexSnapshot({
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
              name: "normalizeEvents",
              kind: "function",
              lineStart: 3,
              lineEnd: 3,
            },
            {
              name: "GET",
              kind: "function",
              exportName: "GET",
              lineStart: 5,
              lineEnd: 8,
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
          line: 6,
          excerpt: "supabase.rpc('refresh_events')",
        },
      ],
    });

    const now = new Date().toISOString();
    projectStore.saveSchemaSnapshot({
      snapshotId: "mcp_progress_notifications_snapshot",
      sourceMode: "repo_only",
      generatedAt: now,
      refreshedAt: now,
      fingerprint: "mcp-progress-notifications-smoke",
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
                columns: [],
                rls: {
                  rlsEnabled: true,
                  forceRls: false,
                  policies: [],
                },
                triggers: [],
                sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_events.sql", line: 1 }],
              },
            ],
            views: [],
            enums: [],
            rpcs: [
              {
                name: "refresh_events",
                schema: "public",
                argTypes: [],
                sources: [{ kind: "sql_migration", path: "supabase/migrations/0002_refresh.sql", line: 1 }],
                bodyText: "BEGIN UPDATE public.events SET updated_at = now(); END;",
              },
            ],
          },
        },
      },
    });
  } finally {
    projectStore.close();
  }

  return { projectId, stateHome };
}

function progressMessagesForToken(
  notifications: IndexedNotification[],
  progressToken: string,
): Array<{ index: number; message: string }> {
  return notifications
    .filter((entry) => entry.notification.method === "notifications/progress")
    .map((entry) => {
      const params = entry.notification.params as { progressToken?: unknown; message?: unknown } | undefined;
      return {
        index: entry.index,
        progressToken: params?.progressToken,
        message: params?.message,
      };
    })
    .filter((entry): entry is { index: number; progressToken: string; message: string } =>
      entry.progressToken === progressToken && typeof entry.message === "string",
    )
    .map((entry) => ({ index: entry.index, message: entry.message }));
}

function assertToolResultSucceeded(result: unknown): void {
  const maybeResult = result as { isError?: unknown; content?: unknown } | undefined;
  assert.notEqual(
    maybeResult?.isError,
    true,
    `tools/call returned isError=true: ${JSON.stringify(maybeResult?.content ?? result)}`,
  );
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-mcp-progress-"));
  const { projectId, stateHome } = seedProject(tmp);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, "mcp"],
    {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MAKO_LOG_LEVEL: "error", MAKO_STATE_HOME: stateHome },
    },
  ) as ChildProcessWithoutNullStreams;

  const client = new StdioClient(child);

  try {
    const ready = new Promise<void>((resolve, reject) => {
      let seen = "";
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        child.stderr.off("data", onStderr);
        child.off("exit", onExit);
      };
      const onStderr = (chunk: string): void => {
        seen += chunk;
        if (seen.includes("[mako-mcp-stdio] ready")) {
          cleanup();
          resolve();
        }
      };
      const onExit = (code: number | null): void => {
        cleanup();
        reject(new Error(`mcp child exited early with code ${code}`));
      };
      child.stderr.on("data", onStderr);
      child.on("exit", onExit);
      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error("timed out waiting for mcp ready marker"));
      }, 30_000);
    });
    await ready;

    await client.request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "claude-code", version: "smoke" },
    });
    client.notify("notifications/initialized");

    const toolArguments = {
      projectId,
      queryKind: "file_health",
      queryText: "app/api/events/route.ts",
      startEntity: { kind: "route", key: "GET /api/events" },
      targetEntity: { kind: "table", key: "public.events" },
      direction: "both",
      traversalDepth: 4,
      includeHeuristicEdges: true,
      includeTenantAudit: false,
      includeDiagnostics: true,
      includeImpactPacket: true,
    };

    const notificationsBeforeNoToken = client.notifications.length;
    const noTokenResponse = await client.request(2, "tools/call", {
      name: "review_bundle_artifact",
      arguments: toolArguments,
    });
    assertToolResultSucceeded(noTokenResponse.result);
    assert.equal(
      client.notifications.slice(notificationsBeforeNoToken).filter((entry) => entry.notification.method === "notifications/progress").length,
      0,
      "tool calls without a progress token must not emit progress notifications",
    );

    const progressToken = "phase4-review-progress";
    const response = await client.request(3, "tools/call", {
      name: "review_bundle_artifact",
      arguments: toolArguments,
      _meta: { progressToken },
    });
    assertToolResultSucceeded(response.result);

    const messages = progressMessagesForToken(client.notifications, progressToken);
    const impactIndex = messages.findIndex((entry) => entry.message.startsWith("impact:"));
    const diagnosticsIndex = messages.findIndex((entry) => entry.message.startsWith("diagnostics:"));
    const composingIndex = messages.findIndex((entry) => entry.message.startsWith("composing:"));

    const timeline = messages.map((entry) => entry.message).join(" | ");
    assert.ok(impactIndex >= 0, `impact progress stage must be emitted; got: ${timeline}`);
    assert.ok(diagnosticsIndex > impactIndex, `diagnostics must follow impact; got: ${timeline}`);
    assert.ok(composingIndex > diagnosticsIndex, `composing must follow diagnostics; got: ${timeline}`);
    assert.ok(
      messages[composingIndex].index < response.index,
      "final tool response must arrive after the last review progress notification",
    );

    const exitCode = await client.shutdown();
    assert.ok(
      exitCode === 0 || exitCode === null,
      `stdio server must exit cleanly on SIGTERM (got exit code ${exitCode})`,
    );

    console.log("mcp-progress-notifications: PASS");
  } catch (error) {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => undefined);
    }
    const stderr = client.stderrChunks.join("");
    console.error("mcp-progress-notifications: FAIL");
    if (stderr) {
      console.error("child stderr:\n" + stderr);
    }
    throw error;
  } finally {
    await removeTempDir(tmp);
  }
}

async function removeTempDir(tmp: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(tmp, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
