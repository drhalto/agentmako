import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MAKO_TOOL_NAMES } from "../../packages/contracts/src/tool-registry.js";
import { COMPACT_MODEL_FACING_REGISTRY_TOOLS } from "../../packages/tools/src/tool-exposure.js";

interface ToolDescriptor {
  name: string;
  annotations?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CLI_ENTRY = path.join(REPO_ROOT, "apps", "cli", "src", "index.ts");
const ALWAYS_LOAD_TOOLS = new Set([
  "tool_search",
  ...COMPACT_MODEL_FACING_REGISTRY_TOOLS,
]);

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

async function listToolsForClient(clientName: string): Promise<ToolDescriptor[]> {
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
    const result = await client.listTools();
    return result.tools;
  } finally {
    await client.close().catch(() => undefined);
  }
}

function hintWordCount(hint: string): number {
  return hint.trim().split(/\s+/).filter(Boolean).length;
}

function outputSchemaHasHints(tool: ToolDescriptor): boolean {
  return JSON.stringify(tool.outputSchema).includes("\"_hints\"");
}

async function main(): Promise<void> {
  const expectedMakoTools = [...MAKO_TOOL_NAMES, "tool_search"];

  const claudeTools = await listToolsForClient("claude-code");
  const claudeByName = new Map(claudeTools.map((tool) => [tool.name, tool]));
  for (const name of expectedMakoTools) {
    const tool = claudeByName.get(name);
    assert.ok(tool, `Claude tools/list includes ${name}`);
    const meta = tool._meta ?? {};
    const searchHint = meta["anthropic/searchHint"];
    assert.equal(typeof searchHint, "string", `${name} has anthropic/searchHint`);
    assert.ok((searchHint as string).trim().length > 0, `${name} searchHint is non-empty`);
    assert.equal((searchHint as string).includes("\n"), false, `${name} searchHint is single-line`);
    assert.equal((searchHint as string).endsWith("."), false, `${name} searchHint has no trailing period`);
    const words = hintWordCount(searchHint as string);
    assert.ok(words >= 3 && words <= 10, `${name} searchHint has 3-10 words; got ${words}`);
    assert.equal(
      meta["anthropic/alwaysLoad"] === true,
      ALWAYS_LOAD_TOOLS.has(name),
      `${name} alwaysLoad matches compact surface allowlist`,
    );
    assert.equal(outputSchemaHasHints(tool), true, `${name} output schema includes _hints`);
  }

  assert.equal(claudeByName.get("repo_map")?.annotations?.readOnlyHint, true);
  assert.equal(claudeByName.get("repo_map")?.annotations?.openWorldHint, false);
  assert.equal(claudeByName.get("db_ping")?.annotations?.openWorldHint, true);
  assert.equal(claudeByName.get("finding_ack")?.annotations?.readOnlyHint, false);
  assert.equal(claudeByName.get("finding_ack")?.annotations?.idempotentHint, false);

  const genericTools = await listToolsForClient("mako-generic-smoke");
  for (const tool of genericTools) {
    const anthropicKeys = Object.keys(tool._meta ?? {}).filter((key) =>
      key.startsWith("anthropic/"),
    );
    assert.deepEqual(
      anthropicKeys,
      [],
      `generic client should not receive anthropic metadata for ${tool.name}`,
    );
  }

  console.log("mcp-tool-metadata: PASS");
}

main().catch((error) => {
  console.error("mcp-tool-metadata: FAIL");
  console.error(error);
  process.exit(1);
});
