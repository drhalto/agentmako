import type { ReefAskToolInput, ReefAskToolOutput } from "@mako-ai/contracts";
import type { ToolServiceOptions } from "../runtime.js";
import { compileReefQuery } from "./query-engine.js";

export async function reefAskTool(
  input: ReefAskToolInput,
  options: ToolServiceOptions,
): Promise<ReefAskToolOutput> {
  const compiled = await compileReefQuery(input, options, {
    executionToolName: "reef_ask",
  });

  return {
    toolName: "reef_ask",
    ...compiled,
  };
}
