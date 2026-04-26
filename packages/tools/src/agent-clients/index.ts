import { ClaudeCodeClient } from "./claude-code.js";
import { GenericAgentClient } from "./generic.js";
import type { AgentClient, AgentClientInitializeInfo } from "./types.js";

export { ClaudeCodeClient } from "./claude-code.js";
export {
  CLAUDE_CODE_TOOL_HINTS,
  getClaudeCodeToolHint,
  type ClaudeCodeHintToolName,
  type ClaudeCodeToolHint,
} from "./claude-code-hints.js";
export { GenericAgentClient } from "./generic.js";
export { MAKO_SERVER_INSTRUCTIONS } from "./mako-server-instructions.js";
export { toMcpProgressPayload } from "./progress-shape.js";
export type {
  AgentClient,
  AgentClientInitializeInfo,
  AgentClientToolInfo,
} from "./types.js";

export function selectAgentClient(
  info: AgentClientInitializeInfo | undefined,
): AgentClient {
  const name = info?.name?.toLowerCase() ?? "";
  if (name.includes("claude")) {
    return ClaudeCodeClient;
  }
  return GenericAgentClient;
}
