import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const PLUGIN_ROOT = path.join(REPO_ROOT, "plugins");
const EXPECTED_SKILLS = [
  "mako-code-intel",
  "mako-database",
  "mako-discovery",
  "mako-graph",
  "mako-guide",
  "mako-neighborhoods",
  "mako-trace",
  "mako-workflow",
];

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relPath), "utf8")) as Record<string, unknown>;
}

function assertMcpServer(value: unknown, label: string): void {
  assert.ok(value && typeof value === "object", `${label} is an object`);
  const servers = (value as { mcpServers?: Record<string, unknown> }).mcpServers;
  assert.ok(servers?.["mako-ai"], `${label} defines mako-ai MCP server`);
  const server = servers["mako-ai"] as { command?: unknown; args?: unknown };
  assert.equal(server.command, "npx", `${label} uses npx`);
  assert.deepEqual(server.args, ["-y", "agentmako", "mcp"], `${label} invokes agentmako mcp`);
}

function assertSkills(relPath: string): void {
  const root = path.join(REPO_ROOT, relPath);
  assert.ok(existsSync(root), `${relPath} exists`);
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(dirs, [...EXPECTED_SKILLS].sort(), `${relPath} has expected skills`);
  for (const skill of EXPECTED_SKILLS) {
    assert.ok(existsSync(path.join(root, skill, "SKILL.md")), `${relPath}/${skill}/SKILL.md exists`);
  }
}

function main(): void {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/sync-plugins.ts", "--check"], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });

  assertSkills("plugins/_shared/skills");
  assertSkills("plugins/claude-code/skills");
  assertSkills("plugins/codex/skills");
  assertSkills("plugins/cursor/skills");
  assertSkills("plugins/gemini/skills");
  assertSkills("mako-ai-claude-plugin/skills");

  assert.ok(existsSync(path.join(PLUGIN_ROOT, "claude-code", ".claude-plugin", "plugin.json")));
  assert.ok(existsSync(path.join(PLUGIN_ROOT, "codex", ".codex-plugin", "plugin.json")));
  assert.ok(existsSync(path.join(PLUGIN_ROOT, "gemini", "extension.json")));
  assert.ok(existsSync(path.join(PLUGIN_ROOT, "cursor", "mcp.json")));

  assertMcpServer(readJson("plugins/claude-code/.mcp.json"), "Claude Code .mcp.json");
  assertMcpServer(readJson("plugins/codex/.mcp.json"), "Codex .mcp.json");
  assertMcpServer(readJson("plugins/cursor/mcp.json"), "Cursor mcp.json");
  assertMcpServer(readJson("plugins/gemini/.mcp.json"), "Gemini .mcp.json");
  assertMcpServer(readJson("mako-ai-claude-plugin/.mcp.json"), "legacy Claude Code .mcp.json");

  const codexManifest = readJson("plugins/codex/.codex-plugin/plugin.json");
  assert.equal(codexManifest.name, "mako-ai");

  const geminiManifest = readJson("plugins/gemini/extension.json");
  assert.equal(geminiManifest.name, "mako-ai");
  assertMcpServer(geminiManifest, "Gemini extension.json");

  console.log("plugin-parity: PASS");
}

main();
