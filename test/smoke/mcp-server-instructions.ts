import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CLI_ENTRY = path.join(REPO_ROOT, "apps", "cli", "src", "index.ts");
// CC's true cap is MAX_MCP_DESCRIPTION_LENGTH = 2048 (verified at
// CC/services/mcp/client.ts:218). Past that, CC silently appends
// "… [truncated]". Assert 2000 so growth breaks the smoke loud before
// reaching CC's ceiling — leaves ~48 bytes of safety margin.
const INSTRUCTIONS_MAX_CHARS = 2_000;

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.MAKO_LOG_LEVEL = "error";
  return env;
}

async function readInstructionsAndTools(clientName: string): Promise<{
  instructions: string | undefined;
  toolNames: Set<string>;
}> {
  const client = new Client({ name: clientName, version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", CLI_ENTRY, "mcp"],
    cwd: REPO_ROOT,
    env: childEnv(),
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    return {
      instructions: client.getInstructions(),
      toolNames: new Set(tools.tools.map((tool) => tool.name)),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function referencedToolNames(instructions: string): string[] {
  return [...instructions.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((match) => match[1]);
}

async function main(): Promise<void> {
  const claude = await readInstructionsAndTools("claude-code");
  const generic = await readInstructionsAndTools("mako-generic-smoke");

  assert.ok(claude.instructions, "Claude-shaped client receives instructions");
  assert.ok(generic.instructions, "generic client receives instructions");
  assert.equal(
    claude.instructions,
    generic.instructions,
    "Phase 1 emits the same instructions string for Claude and generic clients",
  );
  assert.ok(
    claude.instructions.length < INSTRUCTIONS_MAX_CHARS,
    `instructions stay under ${INSTRUCTIONS_MAX_CHARS} characters ` +
      `(CC's MAX_MCP_DESCRIPTION_LENGTH cap is 2048; 2000 leaves headroom ` +
      `so growth breaks the smoke before CC silently truncates)`,
  );

  const names = referencedToolNames(claude.instructions);
  assert.ok(names.length > 0, "instructions reference at least one tool name");
  for (const name of names) {
    assert.ok(
      claude.toolNames.has(name),
      `instruction tool reference resolves against tools/list: ${name}`,
    );
  }

  console.log("mcp-server-instructions: PASS");
}

main().catch((error) => {
  console.error("mcp-server-instructions: FAIL");
  console.error(error);
  process.exit(1);
});
