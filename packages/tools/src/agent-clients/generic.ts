import { MAKO_SERVER_INSTRUCTIONS } from "./mako-server-instructions.js";
import { toMcpProgressPayload } from "./progress-shape.js";
import type { AgentClient } from "./types.js";

export const GenericAgentClient: AgentClient = {
  id: "generic",
  toolMeta: () => undefined,
  serverInstructions: () => MAKO_SERVER_INSTRUCTIONS,
  progressShape: toMcpProgressPayload,
};
