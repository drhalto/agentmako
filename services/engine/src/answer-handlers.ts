import { isComposerQueryKind } from "@mako-ai/contracts";
import type { AnswerEngineQueryKind } from "./query-plans.js";
import { createLogger } from "@mako-ai/logger";
import { type AnswerContext } from "./answer-handler-shared.js";
import { HANDLERS } from "./answer-handler-operations.js";

const engineLogger = createLogger("mako-engine", { component: "answer" });

export type { AnswerContext } from "./answer-handler-shared.js";

export function synthesizeAnswer(context: AnswerContext) {
  const startedAt = Date.now();
  const queryKind = context.packet.queryKind;
  if (isComposerQueryKind(queryKind)) {
    throw new Error(
      `answer-engine/unsupported-query-kind: composer kind "${queryKind}" routes through defineComposer, not the answer engine.`,
    );
  }
  const engineQueryKind: AnswerEngineQueryKind = queryKind;
  engineLogger.info("answer.start", { queryKind: engineQueryKind });
  try {
    const result = HANDLERS[engineQueryKind](context);
    engineLogger.info("answer.complete", {
      queryKind,
      supportLevel: result.supportLevel,
      candidateCount: result.candidateActions?.length ?? 0,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    engineLogger.error("answer.fail", {
      queryKind,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}
