import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProjectStoreCache } from "@mako-ai/store";
import { createHotIndexCache } from "@mako-ai/tools";
import { createProjectIndexRefreshCoordinator } from "./index-refresh-coordinator.js";
import { createMcpServer, type McpSession } from "./mcp.js";
import type { HttpServerOptions } from "./server.js";

/**
 * stdio MCP transport runner.
 *
 * Mirrors the pattern from `servers-main/src/everything/transports/stdio.ts`
 * and the MCP SDK examples: one `StdioServerTransport`, one `McpServer`,
 * no session map, clean SIGINT/SIGTERM shutdown. Designed to be spawned
 * as a child process by MCP clients (Claude Code, Codex, Cursor) via
 * their `.mcp.json` config, e.g.:
 *
 *   { "mcpServers": { "mako": { "command": "agentmako", "args": ["mcp"] } } }
 *
 * Critical invariant: stdout is the JSON-RPC protocol channel. Every log
 * goes to stderr. `@mako-ai/logger` writes to stderr by default, so the
 * existing log calls inside `createMcpServer` are safe — do not add
 * `console.log(...)` anywhere on this path.
 */

export interface RunMcpStdioOptions extends HttpServerOptions {
  /**
   * Optional callback fired once the transport is connected. Useful for
   * smokes that want to know when the server is ready to accept input.
   * The callback is awaited; any write inside must be stderr.
   */
  onReady?: () => Promise<void> | void;
}

export async function runMcpStdioServer(
  options: RunMcpStdioOptions = {},
): Promise<void> {
  // Single-session semantics: stdio is one client, one process. Track
  // active project id in a shared slot so `createMcpServer`'s
  // `getSession` callback can read/write it across tool calls within
  // the same run.
  const projectStoreCache = options.projectStoreCache ?? createProjectStoreCache();
  const hotIndexCache = options.hotIndexCache ?? createHotIndexCache();
  const indexRefreshCoordinator = createProjectIndexRefreshCoordinator({
    ...options,
    projectStoreCache,
  });
  const sharedSession: Pick<McpSession, "activeProjectId" | "indexRefreshCoordinator"> = {
    indexRefreshCoordinator,
  };

  // Per-process project-store pool (Initial Testing roadmap Phase 2).
  // stdio is long-lived, so opening/closing the per-project SQLite on
  // every tool call is pure waste. The cache is threaded through the
  // options object so `withProjectContext` and the runtime-telemetry
  // capture hook borrow instead of opening.
  const serverOptions: RunMcpStdioOptions = {
    ...options,
    projectStoreCache,
    hotIndexCache,
    indexRefreshCoordinator,
  };

  const server = createMcpServer(
    serverOptions,
    () => sharedSession as McpSession,
  );

  const transport = new StdioServerTransport();

  // Idempotent so double-fires from concurrent signals don't race.
  let shuttingDown = false;
  const flushCache = (): void => {
    try {
      hotIndexCache.flush();
      projectStoreCache.flush();
    } catch (error) {
      process.stderr.write(
        `[mako-mcp-stdio] cache flush error: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    }
  };

  const shutdown = async (signal: NodeJS.Signals | "exit"): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await indexRefreshCoordinator.close();
      await server.close();
    } catch (error) {
      process.stderr.write(
        `[mako-mcp-stdio] error during shutdown (${signal}): ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    } finally {
      flushCache();
      if (signal !== "exit") {
        process.exit(0);
      }
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  // Fallback for non-signal exits (e.g. stdin EOF → transport close →
  // natural runtime shutdown). `process.on("exit")` runs synchronously,
  // so the async `server.close()` branch has likely already completed;
  // we just guarantee the WAL checkpoint fires.
  process.once("exit", () => {
    flushCache();
  });

  await server.connect(transport);
  process.stderr.write("[mako-mcp-stdio] ready\n");
  if (options.onReady) {
    await options.onReady();
  }

  // Keep the event loop alive. The transport owns the lifecycle — when
  // the client closes stdin, the transport emits 'close' and the process
  // will exit naturally.
  return await new Promise<void>((resolve) => {
    transport.onclose = () => {
      void shutdown("exit").then(() => resolve());
    };
  });
}
