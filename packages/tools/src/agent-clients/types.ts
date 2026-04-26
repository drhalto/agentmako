import type { McpProgressPayload, ProgressEvent } from "../progress/types.js";

export interface AgentClientInitializeInfo {
  name?: string;
  version?: string;
}

export interface AgentClientToolInfo {
  name: string;
  description?: string;
}

export interface AgentClient {
  readonly id: "claude-code" | "generic" | "codex" | (string & {});
  toolMeta(tool: AgentClientToolInfo): Record<string, unknown> | undefined;
  serverInstructions(): string | undefined;
  progressShape(event: ProgressEvent): McpProgressPayload;
}
