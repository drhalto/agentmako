/**
 * Pattern matching is ordered by specificity: DB question shapes first
 * (highest signal), then auth/route, then imports/symbols, then schema/file.
 * Confidence below 0.4 falls back to free_form via runAnswerPacket.
 * No LLM calls — the router is purely structural.
 */
import type {
  AskToolInput,
  AskToolOutput,
  JsonObject,
} from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import type { ToolServiceOptions } from "../runtime.js";
import { executeAskSelection } from "./execution.js";
import { routeAskQuestion } from "./parsing.js";
export type { AskFallbackSelection, AskSelection, AskToolSelection } from "./types.js";
export { executeAskSelection } from "./execution.js";
export { routeAskQuestion } from "./parsing.js";

const askLogger = createLogger("mako-tools", { component: "ask" });

export async function askTool(input: AskToolInput, options: ToolServiceOptions = {}): Promise<AskToolOutput> {
  const startedAt = Date.now();
  const selection = routeAskQuestion(input);
  askLogger.info("ask.dispatch", {
    questionLength: input.question?.length ?? 0,
    mode: selection.mode,
    selectedFamily: selection.selectedFamily,
    selectedTool: selection.selectedTool,
    confidence: selection.confidence,
  });

  try {
    const result = await executeAskSelection(selection, input, options);
    askLogger.info("ask.complete", {
      selectedTool: selection.selectedTool,
      mode: selection.mode,
      durationMs: Date.now() - startedAt,
    });
    return {
      toolName: "ask",
      mode: selection.mode,
      selectedFamily: selection.selectedFamily,
      selectedTool: selection.selectedTool,
      selectedArgs: selection.selectedArgs,
      confidence: selection.confidence,
      fallbackReason: selection.mode === "fallback" ? selection.fallbackReason : null,
      result: result as JsonObject,
    };
  } catch (error) {
    askLogger.error("ask.fail", {
      selectedTool: selection.selectedTool,
      mode: selection.mode,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}
