import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopReefDaemon } from "../../services/indexer/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

/**
 * Smoke test for `agentmako mcp` (stdio MCP transport).
 *
 * Spawns the CLI as a child process, speaks JSON-RPC over stdin/stdout
 * per the MCP stdio spec (newline-delimited JSON), and verifies:
 *
 * 1. initialize handshake succeeds
 * 2. tools/list returns the expected tool surface (registry tools are
 *    present, including the new `runtime_telemetry_report` from 8.1c)
 * 3. tools/call writes a requestId-visible tool_runs row over stdio
 * 4. the process exits cleanly on SIGTERM
 * 5. stdout carries only valid JSON-RPC (no stray console.log)
 */

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface ToolDescriptor {
  name: string;
  description?: string;
}

interface ToolsListResult {
  tools: ToolDescriptor[];
}

interface ToolCallResult {
  structuredContent?: unknown;
  content?: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface RecallToolRunsStructured {
  toolName: "recall_tool_runs";
  toolRuns: Array<{
    runId: string;
    toolName: string;
    requestId?: string;
  }>;
}

interface LiveTextSearchStructured {
  toolName: "live_text_search";
  matches: Array<{
    filePath: string;
    text: string;
  }>;
  warnings: string[];
}

interface ProjectIndexStatusStructured {
  toolName: "project_index_status";
  unindexedScan: {
    status: string;
  };
}

interface AstFindPatternStructured {
  toolName: "ast_find_pattern";
  languagesApplied: string[];
}

interface ToolBatchStructured {
  toolName: "tool_batch";
  summary: {
    requestedOps: number;
  };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CLI_ENTRY = path.join(REPO_ROOT, "apps", "cli", "src", "index.ts");

function seedProject(projectRoot: string, projectId: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "mcp-stdio-smoke",
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
      name: "mcp-stdio-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });
  } finally {
    store.close();
  }
}

function assertToolCallSucceeded(result: ToolCallResult): void {
  assert.notEqual(
    result.isError,
    true,
    `tools/call returned isError=true: ${JSON.stringify(result.content ?? result)}`,
  );
}

function parseStructured<T>(result: ToolCallResult): T {
  assertToolCallSucceeded(result);
  assert.ok(result.structuredContent, "tools/call result includes structuredContent");
  return result.structuredContent as T;
}

async function removeTempDirWithRetries(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if ((code !== "EBUSY" && code !== "EPERM") || attempt === 19) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

class StdioClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pendingResponses = new Map<number, (response: JsonRpcResponse) => void>();
  private stdoutBuffer = "";
  readonly stderrChunks: string[] = [];
  readonly stdoutChunks: string[] = [];

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.stdoutChunks.push(chunk);
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
        let parsed: JsonRpcResponse;
        try {
          parsed = JSON.parse(line) as JsonRpcResponse;
        } catch (error) {
          throw new Error(
            `stdout carried non-JSON line (stdio transport is pure JSON-RPC): ${JSON.stringify(line)} (parse error: ${error instanceof Error ? error.message : String(error)})`,
          );
        }
        if (typeof parsed.id === "number") {
          const resolver = this.pendingResponses.get(parsed.id);
          if (resolver) {
            this.pendingResponses.delete(parsed.id);
            resolver(parsed);
          }
        }
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  async request<T>(id: number, method: string, params?: unknown): Promise<T> {
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const responsePromise = new Promise<JsonRpcResponse>((resolve) => {
      this.pendingResponses.set(id, resolve);
    });
    this.child.stdin.write(payload);
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout waiting for response to ${method} (id=${id})`)), 20_000);
    });
    const response = await Promise.race([responsePromise, timeout]);
    if (response.error) {
      throw new Error(
        `JSON-RPC error for ${method}: [${response.error.code}] ${response.error.message}`,
      );
    }
    return response.result as T;
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

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-mcp-stdio-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(
    path.join(projectRoot, "live-search-target.txt"),
    "mako live text search packaged ripgrep\n",
  );

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  const child = spawn(
    process.execPath,
    ["--import", "tsx", CLI_ENTRY, "mcp"],
    {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MAKO_LOG_LEVEL: "error",
        MAKO_STATE_HOME: stateHome,
        PATH: "",
        Path: "",
      },
    },
  ) as ChildProcessWithoutNullStreams;

  const client = new StdioClient(child);

  try {
    // Wait for "ready" on stderr before writing to stdin — keeps the
    // handshake deterministic across slower CI machines.
    const ready = new Promise<void>((resolve, reject) => {
      let seen = "";
      const onStderr = (chunk: string): void => {
        seen += chunk;
        if (seen.includes("[mako-mcp-stdio] ready")) {
          child.stderr.off("data", onStderr);
          resolve();
        }
      };
      child.stderr.on("data", onStderr);
      child.on("exit", (code) => reject(new Error(`mcp child exited early with code ${code}`)));
      setTimeout(() => reject(new Error("timed out waiting for mcp ready marker")), 30_000);
    });
    await ready;

    // --- initialize handshake ---

    const initResult = await client.request<{
      protocolVersion: string;
      serverInfo: { name: string; version: string };
    }>(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mako-stdio-smoke", version: "1.0.0" },
    });
    assert.ok(initResult.protocolVersion, "initialize returns a protocolVersion");
    assert.ok(initResult.serverInfo?.name, "initialize returns serverInfo.name");

    client.notify("notifications/initialized");

    // --- tools/list ---

    const toolsResult = await client.request<ToolsListResult>(2, "tools/list");
    const toolNames = toolsResult.tools.map((tool) => tool.name).sort();
    assert.ok(toolNames.length > 0, "tools/list must return at least one tool");

    // Core tools that must be discoverable over the stdio transport.
    for (const expected of [
      "runtime_telemetry_report",
      "task_preflight_artifact",
      "graph_neighbors",
      "live_text_search",
      "tool_search",
    ]) {
      assert.ok(
        toolNames.includes(expected),
        `tools/list must include ${expected}; got: ${toolNames.join(", ")}`,
      );
    }

    const liveSearchResult = await client.request<ToolCallResult>(3, "tools/call", {
      name: "live_text_search",
      arguments: {
        projectId,
        query: "packaged ripgrep",
        pathGlob: "live-search-target.txt",
      },
    });
    const liveSearch = parseStructured<LiveTextSearchStructured>(liveSearchResult);
    assert.equal(liveSearch.toolName, "live_text_search");
    assert.deepEqual(
      liveSearch.matches.map((match) => match.filePath),
      ["live-search-target.txt"],
    );
    assert.deepEqual(liveSearch.warnings, []);

    // --- stringified argument tolerance ---
    //
    // Some MCP clients/bridges have been observed to stringify nested
    // non-string argument values before the SDK's Zod validation runs.
    // The stdio surface should accept those values and let Mako's normal
    // typed tool validation see the coerced form.
    const indexStatusResult = await client.request<ToolCallResult>(4, "tools/call", {
      name: "project_index_status",
      arguments: {
        projectId,
        includeUnindexed: "false",
      },
    });
    const indexStatus = parseStructured<ProjectIndexStatusStructured>(indexStatusResult);
    assert.equal(indexStatus.toolName, "project_index_status");
    assert.equal(indexStatus.unindexedScan.status, "skipped");

    const astResult = await client.request<ToolCallResult>(5, "tools/call", {
      name: "ast_find_pattern",
      arguments: {
        projectId,
        pattern: "console.log($X)",
        languages: "[\"ts\",\"tsx\"]",
        maxMatches: "5",
      },
    });
    const ast = parseStructured<AstFindPatternStructured>(astResult);
    assert.equal(ast.toolName, "ast_find_pattern");
    assert.deepEqual(ast.languagesApplied, ["ts", "tsx"]);

    const batchResult = await client.request<ToolCallResult>(6, "tools/call", {
      name: "tool_batch",
      arguments: {
        projectId,
        continueOnError: "true",
        ops: "[{\"label\":\"ping\",\"tool\":\"db_ping\",\"args\":{}}]",
      },
    });
    const batch = parseStructured<ToolBatchStructured>(batchResult);
    assert.equal(batch.toolName, "tool_batch");
    assert.equal(batch.summary.requestedOps, 1);

    // --- tools/call requestId logging ---
    //
    // Regression guard for live-session UX:
    // stdio MCP calls must pass a requestId through ToolServiceOptions
    // so `recall_tool_runs` exposes the id needed by
    // `agent_feedback.referencedRequestId`.
    const firstRecall = await client.request<ToolCallResult>(7, "tools/call", {
      name: "recall_tool_runs",
      arguments: {
        projectId,
        toolName: "recall_tool_runs",
        limit: 1,
      },
    });
    assertToolCallSucceeded(firstRecall);

    const secondRecall = await client.request<ToolCallResult>(8, "tools/call", {
      name: "recall_tool_runs",
      arguments: {
        projectId,
        toolName: "recall_tool_runs",
        limit: 5,
      },
    });
    const recall = parseStructured<RecallToolRunsStructured>(secondRecall);
    const loggedRun = recall.toolRuns.find(
      (run) => run.toolName === "recall_tool_runs",
    );
    assert.ok(loggedRun, "recall_tool_runs sees the prior stdio tool call");
    assert.equal(
      typeof loggedRun.requestId,
      "string",
      "stdio MCP tool calls persist a requestId for agent_feedback",
    );
    assert.ok(
      loggedRun.requestId!.length > 0,
      "persisted requestId is non-empty",
    );

    // --- stdout-purity invariant ---
    //
    // Every line emitted on stdout must have parsed as JSON (drainStdoutLines
    // throws otherwise). Reaching this point without a parse-error throw
    // already proves the invariant. Re-check explicitly so the assertion
    // lives in the smoke output.
    const allStdout = client.stdoutChunks.join("");
    for (const line of allStdout.split("\n")) {
      if (line.trim() === "") continue;
      assert.doesNotThrow(
        () => JSON.parse(line),
        `stdout line is not valid JSON: ${JSON.stringify(line)}`,
      );
    }

    // --- clean shutdown ---

    const exitCode = await client.shutdown();
    assert.ok(
      exitCode === 0 || exitCode === null,
      `stdio server must exit cleanly on SIGTERM (got exit code ${exitCode})`,
    );

    console.log("mcp-stdio: PASS");
  } catch (error) {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => undefined);
    }
    const stderr = client.stderrChunks.join("");
    console.error("mcp-stdio: FAIL");
    if (stderr) {
      console.error("child stderr:\n" + stderr);
    }
    throw error;
  } finally {
    await stopReefDaemon().catch(() => undefined);
    await removeTempDirWithRetries(tmp);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
