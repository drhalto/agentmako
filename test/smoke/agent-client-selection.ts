import assert from "node:assert/strict";
import {
  CLAUDE_CODE_TOOL_HINTS,
  ClaudeCodeClient,
  GenericAgentClient,
  MAKO_SERVER_INSTRUCTIONS,
  selectAgentClient,
} from "../../packages/tools/src/agent-clients/index.js";
import { MAKO_TOOL_NAMES } from "../../packages/contracts/src/tool-registry.js";

const ALWAYS_LOAD_TOOLS = new Set([
  "tool_search",
  "ask",
  "repo_map",
  "context_packet",
  "reef_scout",
  "table_neighborhood",
]);

function hintWordCount(hint: string): number {
  return hint.trim().split(/\s+/).filter(Boolean).length;
}

async function main(): Promise<void> {
  assert.equal(
    selectAgentClient({ name: "claude-code", version: "1.0.0" }),
    ClaudeCodeClient,
    "claude-code clientInfo selects ClaudeCodeClient",
  );
  assert.equal(
    selectAgentClient({ name: "Claude Code CLI", version: "1.0.0" }),
    ClaudeCodeClient,
    "Claude Code clientInfo match is case-insensitive",
  );
  assert.equal(
    selectAgentClient({ name: "Codex", version: "1.0.0" }),
    GenericAgentClient,
    "Codex falls back to GenericAgentClient until a Codex adapter ships",
  );
  assert.equal(
    selectAgentClient(undefined),
    GenericAgentClient,
    "missing clientInfo falls back to GenericAgentClient",
  );

  const expectedHintNames = [...MAKO_TOOL_NAMES, "tool_search"].sort();
  const actualHintNames = Object.keys(CLAUDE_CODE_TOOL_HINTS).sort();
  assert.deepEqual(
    actualHintNames,
    expectedHintNames,
    "Claude Code hint map covers every registry tool plus tool_search",
  );

  for (const name of expectedHintNames) {
    const hint = CLAUDE_CODE_TOOL_HINTS[name as keyof typeof CLAUDE_CODE_TOOL_HINTS];
    assert.ok(hint, `${name} has a hint`);
    assert.ok(hint.searchHint.trim().length > 0, `${name} hint is non-empty`);
    assert.equal(hint.searchHint.includes("\n"), false, `${name} hint is single-line`);
    assert.equal(hint.searchHint.endsWith("."), false, `${name} hint has no trailing period`);
    const words = hintWordCount(hint.searchHint);
    assert.ok(words >= 3 && words <= 10, `${name} hint has 3-10 words; got ${words}`);
    assert.equal(
      hint.alwaysLoad === true,
      ALWAYS_LOAD_TOOLS.has(name),
      `${name} alwaysLoad selection matches the Phase 1 allowlist`,
    );

    const meta = ClaudeCodeClient.toolMeta({ name });
    assert.equal(meta?.["anthropic/searchHint"], hint.searchHint, `${name} emits searchHint meta`);
    if (ALWAYS_LOAD_TOOLS.has(name)) {
      assert.equal(meta?.["anthropic/alwaysLoad"], true, `${name} emits alwaysLoad meta`);
    }
  }

  assert.equal(
    GenericAgentClient.toolMeta({ name: "ask" }),
    undefined,
    "GenericAgentClient emits no client-specific metadata",
  );
  assert.equal(
    ClaudeCodeClient.serverInstructions(),
    MAKO_SERVER_INSTRUCTIONS,
    "ClaudeCodeClient returns the shared mako instructions",
  );
  assert.equal(
    GenericAgentClient.serverInstructions(),
    MAKO_SERVER_INSTRUCTIONS,
    "GenericAgentClient returns the same shared mako instructions",
  );

  console.log("agent-client-selection: PASS");
}

main().catch((error) => {
  console.error("agent-client-selection: FAIL");
  console.error(error);
  process.exit(1);
});
