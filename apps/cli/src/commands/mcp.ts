import { runMcpStdioServer } from "@mako-ai/api";

/**
 * `agentmako mcp` — stdio MCP transport.
 *
 * Designed to be spawned as a child process by MCP clients via their
 * `.mcp.json` config:
 *
 *   {
 *     "mcpServers": {
 *       "mako": { "command": "agentmako", "args": ["mcp"] }
 *     }
 *   }
 *
 * The command takes no arguments in this first slice. If a future
 * release wants project scoping at spawn time, add it as flags here;
 * today, projects are resolved per tool call via the same locator
 * logic the HTTP transport uses.
 */
export async function runMcpCommand(rawArgs: string[]): Promise<void> {
  if (rawArgs.length > 0) {
    const unknown = rawArgs[0]!;
    if (unknown === "--help" || unknown === "-h" || unknown === "help") {
      printUsage();
      return;
    }
    throw new Error(
      `Unknown argument for 'agentmako mcp': ${unknown}. This command reads JSON-RPC from stdin and takes no flags in this release.`,
    );
  }

  await runMcpStdioServer();
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: agentmako mcp",
      "",
      "Launch the mako MCP server on stdio. Intended to be spawned by",
      "MCP clients (Claude Code, Codex, Cursor) via their .mcp.json",
      "config. Takes no arguments; reads JSON-RPC on stdin, writes",
      "JSON-RPC on stdout, writes logs on stderr.",
      "",
      "Example .mcp.json:",
      "  {",
      "    \"mcpServers\": {",
      "      \"mako\": { \"command\": \"agentmako\", \"args\": [\"mcp\"] }",
      "    }",
      "  }",
      "",
    ].join("\n"),
  );
}
