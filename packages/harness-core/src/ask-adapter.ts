/**
 * No-agent tier adapter.
 *
 * In Phase 3.0 there is no model. When a user sends a message at tier
 * `no-agent`, we delegate to the shipped heuristic `ask` tool
 * (`packages/tools/src/ask/`) and shape its output into an assistant
 * text message. Later phases replace this with real model dispatch.
 */

import { invokeTool, type ToolServiceOptions } from "@mako-ai/tools";

export interface AskAdapterResult {
  text: string;
  raw: unknown;
}

function summarize(result: unknown): string {
  if (result == null) return "No result.";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export async function runNoAgentTurn(
  question: string,
  options: { projectId?: string | null; toolOptions?: ToolServiceOptions } = {},
): Promise<AskAdapterResult> {
  try {
    const toolOptions: ToolServiceOptions = {
      ...options.toolOptions,
      requestContext: {
        ...options.toolOptions?.requestContext,
        sessionProjectId: options.projectId ?? options.toolOptions?.requestContext?.sessionProjectId,
      },
    };
    const output = (await invokeTool(
      "ask",
      { question, ...(options.projectId ? { projectId: options.projectId } : {}) },
      toolOptions,
    )) as {
      result?: { answer?: string; summary?: string; headline?: string };
      selectedTool?: string;
      confidence?: number;
    };

    const result = output.result ?? {};
    const text =
      result.answer ??
      result.summary ??
      result.headline ??
      `Routed to \`${output.selectedTool ?? "unknown"}\` (confidence ${output.confidence ?? 0}).\n\n${summarize(result)}`;

    return { text, raw: output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      text: `Unable to answer without a model configured. The deterministic \`ask\` router returned an error: ${message}`,
      raw: { error: message },
    };
  }
}
