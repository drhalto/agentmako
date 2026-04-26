import { QUERY_PLANS } from "@mako-ai/engine";
import type { AnswerPacket, AnswerToolQueryKind, SupportLevel } from "@mako-ai/contracts";
import { createId } from "@mako-ai/store";

export type FreshAnswerQueryKind = AnswerToolQueryKind | "free_form";

export function createFreshAnswerPacket(
  projectId: string,
  queryKind: FreshAnswerQueryKind,
  queryText: string,
  supportLevel: SupportLevel,
): AnswerPacket {
  return {
    queryId: createId("query"),
    projectId,
    queryKind,
    queryText,
    tierUsed: QUERY_PLANS[queryKind].defaultTier,
    supportLevel,
    evidenceStatus: "partial",
    evidenceConfidence: 0,
    missingInformation: [],
    stalenessFlags: [],
    evidence: [],
    generatedAt: new Date().toISOString(),
  };
}
