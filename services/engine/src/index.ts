import type { AnswerPacket, AnswerResult } from "@mako-ai/contracts";
import type { AnswerContext } from "./answer-handlers.js";
import { synthesizeAnswer } from "./answer-handlers.js";
import { QUERY_PLANS, type AnswerEngineQueryKind } from "./query-plans.js";

export class AnswerEngine {
  // Composer packets do not have plans — they flow through `defineComposer`,
  // not the answer-engine path. Narrowing the signature keeps this API honest.
  getPlan(kind: AnswerEngineQueryKind) {
    return QUERY_PLANS[kind];
  }

  answer(context: AnswerContext): AnswerResult {
    return synthesizeAnswer(context);
  }

  createFallbackResult(packet: AnswerPacket): AnswerResult {
    return {
      queryId: packet.queryId,
      projectId: packet.projectId,
      queryKind: packet.queryKind,
      tierUsed: packet.tierUsed,
      supportLevel: packet.supportLevel,
      evidenceStatus: packet.evidenceStatus,
      answer:
        packet.missingInformation.length > 0
          ? `I cannot answer this yet: ${packet.missingInformation.join(" ")}`
          : "I cannot answer this yet because the required indexed evidence is missing.",
      answerConfidence: 0.05,
      packet,
      candidateActions: [],
      noSynthesis: true,
    };
  }
}

export function createAnswerEngine(): AnswerEngine {
  return new AnswerEngine();
}

export { QUERY_PLANS };
export type { AnswerContext };
