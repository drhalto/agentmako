import { getClaudeCodeToolHint } from "./claude-code-hints.js";
import { MAKO_SERVER_INSTRUCTIONS } from "./mako-server-instructions.js";
import { toMcpProgressPayload } from "./progress-shape.js";
import type { AgentClient } from "./types.js";

export const ClaudeCodeClient: AgentClient = {
  id: "claude-code",
  toolMeta(tool) {
    const hint = getClaudeCodeToolHint(tool.name);
    if (!hint) return undefined;

    const meta: Record<string, unknown> = {
      "anthropic/searchHint": hint.searchHint,
    };
    if (hint.alwaysLoad) {
      meta["anthropic/alwaysLoad"] = true;
    }
    return meta;
  },
  serverInstructions: () => MAKO_SERVER_INSTRUCTIONS,
  progressShape: toMcpProgressPayload,
};
