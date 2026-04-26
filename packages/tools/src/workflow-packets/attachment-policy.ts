import type {
  AnswerResult,
  QueryKind,
  WorkflowPacketAttachmentDecision,
  WorkflowPacketFamily,
} from "@mako-ai/contracts";

type CompanionEligibleQueryKind = Extract<
  QueryKind,
  "route_trace" | "file_health" | "trace_file" | "trace_table" | "trace_rpc"
>;

const COMPANION_PACKET_FAMILY_BY_QUERY_KIND: Record<
  CompanionEligibleQueryKind,
  WorkflowPacketFamily
> = {
  route_trace: "verification_plan",
  file_health: "verification_plan",
  trace_file: "verification_plan",
  trace_table: "verification_plan",
  trace_rpc: "verification_plan",
};

export function decideCompanionPacket(
  result: Pick<AnswerResult, "queryKind" | "supportLevel" | "evidenceStatus" | "trust">,
): WorkflowPacketAttachmentDecision | null {
  const family = companionPacketFamilyForQueryKind(result.queryKind);
  if (!family) {
    return null;
  }

  const trustState = result.trust?.state ?? null;
  if (trustState === "contradicted") {
    return null;
  }

  if (insufficientEvidenceBlocksAttachment(result)) {
    return null;
  }

  return {
    family,
    trigger: {
      queryKind: result.queryKind,
      supportLevel: result.supportLevel,
      evidenceStatus: result.evidenceStatus,
      trustState,
    },
  };
}

export function buildCompanionPacketAttachmentReason(
  decision: WorkflowPacketAttachmentDecision,
): string {
  const { family, trigger } = decision;
  return `Attached ${family} because queryKind=${trigger.queryKind} produced ${trigger.evidenceStatus} ${trigger.supportLevel} evidence${trigger.trustState ? ` with trust state ${trigger.trustState}` : ""}.`;
}

function insufficientEvidenceBlocksAttachment(
  result: Pick<AnswerResult, "trust">,
): boolean {
  if (result.trust?.state !== "insufficient_evidence") {
    return false;
  }

  const reasonCodes = new Set(result.trust.reasons.map((reason) => reason.code));
  if (reasonCodes.size === 0) {
    return true;
  }

  // `best_effort_support` reflects the tool's expected support mode, not a
  // stronger signal that the answer is actively misleading. Keep the
  // verification-plan attachment available in that narrow case.
  return Array.from(reasonCodes).some((code) => code !== "best_effort_support");
}

function companionPacketFamilyForQueryKind(
  queryKind: AnswerResult["queryKind"],
): WorkflowPacketFamily | null {
  if (queryKind in COMPANION_PACKET_FAMILY_BY_QUERY_KIND) {
    return COMPANION_PACKET_FAMILY_BY_QUERY_KIND[queryKind as CompanionEligibleQueryKind];
  }
  return null;
}
