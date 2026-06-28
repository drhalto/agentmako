import assert from "node:assert/strict";
import {
  CLAUDE_CODE_TOOL_HINTS,
  ClaudeCodeClient,
  GenericAgentClient,
  MAKO_SERVER_INSTRUCTIONS,
  selectAgentClient,
} from "../../packages/tools/src/agent-clients/index.js";
import { COMPACT_MODEL_FACING_REGISTRY_TOOLS } from "../../packages/tools/src/tool-exposure.js";
import { MAKO_TOOL_NAMES } from "../../packages/contracts/src/tool-registry.js";

const ALWAYS_LOAD_TOOLS = new Set([
  "tool_search",
  ...COMPACT_MODEL_FACING_REGISTRY_TOOLS,
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
      `${name} alwaysLoad selection matches the compact model-facing surface`,
    );

    const meta = ClaudeCodeClient.toolMeta({ name });
    assert.equal(meta?.["anthropic/searchHint"], hint.searchHint, `${name} emits searchHint meta`);
    if (ALWAYS_LOAD_TOOLS.has(name)) {
      assert.equal(meta?.["anthropic/alwaysLoad"], true, `${name} emits alwaysLoad meta`);
    }
  }

  assert.ok(
    CLAUDE_CODE_TOOL_HINTS.repo_map.searchHint.includes("PageRank"),
    "repo_map hint advertises graph ranking",
  );
  assert.ok(
    CLAUDE_CODE_TOOL_HINTS.repo_map.searchHint.includes("anchors"),
    "repo_map hint advertises focus anchors",
  );
  assert.ok(
    CLAUDE_CODE_TOOL_HINTS.context_packet.searchHint.includes("graph"),
    "context_packet hint advertises graph expansion",
  );
  assert.ok(
    CLAUDE_CODE_TOOL_HINTS.context_packet.searchHint.includes("retrieval") &&
      CLAUDE_CODE_TOOL_HINTS.context_packet.searchHint.includes("plans"),
    "context_packet hint advertises retrieval plans",
  );
  assert.ok(
    CLAUDE_CODE_TOOL_HINTS.tool_batch.searchHint.includes("compact"),
    "tool_batch hint advertises compact summaries",
  );
  assert.ok(
    CLAUDE_CODE_TOOL_HINTS.tool_batch.searchHint.includes("parallel"),
    "tool_batch hint advertises parallel follow-up batching",
  );
  assert.ok(
    CLAUDE_CODE_TOOL_HINTS.tool_batch.searchHint.includes("bounded"),
    "tool_batch hint advertises bounded concurrency",
  );

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
  assert.ok(
    MAKO_SERVER_INSTRUCTIONS.includes("context_packet"),
    "server instructions point agents at context_packet",
  );
  assert.ok(
    MAKO_SERVER_INSTRUCTIONS.includes("retrievalDiagnostics.retrievalPlan.level") &&
      MAKO_SERVER_INSTRUCTIONS.includes("evidenceGate") &&
      MAKO_SERVER_INSTRUCTIONS.includes("evidenceGaps") &&
      MAKO_SERVER_INSTRUCTIONS.includes("recommendedFollowUps") &&
      MAKO_SERVER_INSTRUCTIONS.includes("nextStep"),
    "server instructions teach agents to read retrieval plans and executable follow-ups",
  );
  assert.ok(
    MAKO_SERVER_INSTRUCTIONS.includes("focusRoutes") &&
      MAKO_SERVER_INSTRUCTIONS.includes("focusSymbols") &&
      MAKO_SERVER_INSTRUCTIONS.includes("focusDatabaseObjects"),
    "server instructions mention high-signal context anchors",
  );
  assert.ok(
    MAKO_SERVER_INSTRUCTIONS.includes("repo_map") &&
      MAKO_SERVER_INSTRUCTIONS.includes("PageRank"),
    "server instructions connect repo_map to PageRank expansion",
  );
  assert.ok(
    MAKO_SERVER_INSTRUCTIONS.includes("compact summaries"),
    "server instructions mention compact tool_batch summaries",
  );
  assert.ok(
    MAKO_SERVER_INSTRUCTIONS.includes("continueOnError=true") &&
      MAKO_SERVER_INSTRUCTIONS.includes("bounded concurrency") &&
      MAKO_SERVER_INSTRUCTIONS.includes("maxConcurrency"),
    "server instructions mention bounded concurrent tool_batch execution",
  );

  console.log("agent-client-selection: PASS");
}

main().catch((error) => {
  console.error("agent-client-selection: FAIL");
  console.error(error);
  process.exit(1);
});
