import type { AnswerResult, WorkflowPacketFamily, WorkflowPacketSectionKind } from "@mako-ai/contracts";
import { decideCompanionPacket } from "./attachment-policy.js";

export type WorkflowPacketUsefulnessGrade = "full" | "partial" | "no";

export type WorkflowPacketUsefulnessReasonCode =
  | "no_attachment_expected"
  | "unexpected_attachment"
  | "missing_expected_attachment"
  | "wrong_packet_family"
  | "attachment_reason_present"
  | "execution_target_present"
  | "followup_action_taken"
  | "handoff_present"
  | "grounded_citations"
  | "actionable_sections_present"
  | "diagnostic_guidance_present"
  | "refresh_guidance_present"
  | "generic_only";

export interface WorkflowPacketUsefulnessEvaluation {
  eligible: boolean;
  attached: boolean;
  family: WorkflowPacketFamily | null;
  grade: WorkflowPacketUsefulnessGrade;
  reasonCodes: WorkflowPacketUsefulnessReasonCode[];
  observedFollowupCount: number;
}

export interface WorkflowPacketPromotionMetrics {
  eligibleCount: number;
  attachedCount: number;
  fullCount: number;
  partialCount: number;
  noCount: number;
  unexpectedAttachmentCount: number;
  missingExpectedAttachmentCount: number;
  actualFollowupTakenCount: number;
  packetHelpedNextStepRate: number | null;
  actualFollowupRate: number | null;
  noNoiseRate: number | null;
}

export interface WorkflowPacketPromotionThresholds {
  minEligibleCount: number;
  minHelpedRate: number;
  minNoNoiseRate: number;
  minActualFollowupRate?: number;
}

const ACTIONABLE_SECTION_KINDS = new Set<WorkflowPacketSectionKind>([
  "verification",
  "done_criteria",
  "steps",
]);

const DIAGNOSTIC_ITEM_PREFIX = "diagnostic:";

export function evaluateWorkflowPacketUsefulness(
  result: Pick<
    AnswerResult,
    "queryKind" | "supportLevel" | "evidenceStatus" | "trust" | "diagnostics" | "companionPacket" | "candidateActions"
  >,
  options: { observedFollowupCount?: number } = {},
): WorkflowPacketUsefulnessEvaluation {
  const observedFollowupCount = Math.max(0, options.observedFollowupCount ?? 0);
  const packetSurface = result.companionPacket ?? null;
  const attachmentDecision = packetSurface?.attachmentDecision ?? null;
  const expectedDecision = attachmentDecision ?? decideCompanionPacket(result);

  if (!expectedDecision) {
    return packetSurface
      ? {
          eligible: false,
          attached: true,
          family: packetSurface.packet.family,
          grade: "no",
          reasonCodes: ["unexpected_attachment"],
          observedFollowupCount,
        }
      : {
          eligible: false,
          attached: false,
          family: null,
          grade: "full",
          reasonCodes: ["no_attachment_expected"],
          observedFollowupCount,
        };
  }

  if (!packetSurface) {
    return {
      eligible: true,
      attached: false,
      family: null,
      grade: "no",
      reasonCodes: ["missing_expected_attachment"],
      observedFollowupCount,
    };
  }

  if (packetSurface.packet.family !== expectedDecision.family) {
    return {
      eligible: true,
      attached: true,
      family: packetSurface.packet.family,
      grade: "no",
      reasonCodes: ["wrong_packet_family"],
      observedFollowupCount,
    };
  }

  const reasonCodes: WorkflowPacketUsefulnessReasonCode[] = [];
  let qualityScore = 0;

  // This remains mostly a packet-quality proxy. When mako observes an actual
  // packet-guided follow-up execution, that fact is folded in as the strongest
  // signal instead of pretending the packet was only inspected.
  if (typeof packetSurface.attachmentReason === "string" && packetSurface.attachmentReason.trim().length > 0) {
    reasonCodes.push("attachment_reason_present");
    qualityScore += 1;
  }

  const workflowAction = result.candidateActions[0];
  if (
    workflowAction?.execute?.toolName === "workflow_packet" &&
    workflowAction.execute.input.family === packetSurface.packet.family
  ) {
    reasonCodes.push("execution_target_present");
    qualityScore += 1;
  }

  if (observedFollowupCount > 0) {
    reasonCodes.push("followup_action_taken");
  }

  if (
    packetSurface.handoff &&
    packetSurface.handoff.current.trim().length > 0 &&
    packetSurface.handoff.stopWhen.trim().length > 0
  ) {
    reasonCodes.push("handoff_present");
    qualityScore += 1;
  }

  if (packetSurface.packet.citations.length > 0) {
    reasonCodes.push("grounded_citations");
    qualityScore += 1;
  }

  if (packetSurface.packet.sections.some((section) => ACTIONABLE_SECTION_KINDS.has(section.kind))) {
    reasonCodes.push("actionable_sections_present");
    qualityScore += 1;
  }

  if (
    (result.diagnostics?.length ?? 0) > 0 &&
    packetSurface.packet.citations.some((citation) => citation.itemId.startsWith(DIAGNOSTIC_ITEM_PREFIX))
  ) {
    reasonCodes.push("diagnostic_guidance_present");
    qualityScore += 1;
  }

  if (
    result.trust &&
    (packetSurface.handoff?.refreshWhen?.trim().length ?? 0) > 0
  ) {
    reasonCodes.push("refresh_guidance_present");
    qualityScore += 1;
  }

  // Observed follow-up is stronger evidence than packet shape alone, but it
  // should not fully override grounding/actionability. Require a small amount
  // of packet quality before it can promote the grade.
  if ((observedFollowupCount > 0 && qualityScore >= 2) || qualityScore >= 4) {
    return {
      eligible: true,
      attached: true,
      family: packetSurface.packet.family,
      grade: "full",
      reasonCodes,
      observedFollowupCount,
    };
  }

  if ((observedFollowupCount > 0 && qualityScore >= 1) || qualityScore >= 2) {
    return {
      eligible: true,
      attached: true,
      family: packetSurface.packet.family,
      grade: "partial",
      reasonCodes,
      observedFollowupCount,
    };
  }

  return {
    eligible: true,
    attached: true,
    family: packetSurface.packet.family,
    grade: "no",
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ["generic_only"],
    observedFollowupCount,
  };
}

export function summarizeWorkflowPacketPromotionMetrics(
  evaluations: readonly WorkflowPacketUsefulnessEvaluation[],
): WorkflowPacketPromotionMetrics {
  const eligibleCount = evaluations.filter((evaluation) => evaluation.eligible).length;
  const attachedCount = evaluations.filter((evaluation) => evaluation.attached).length;
  const fullCount = evaluations.filter((evaluation) => evaluation.grade === "full").length;
  const partialCount = evaluations.filter((evaluation) => evaluation.grade === "partial").length;
  const noCount = evaluations.filter((evaluation) => evaluation.grade === "no").length;
  const unexpectedAttachmentCount = evaluations.filter((evaluation) =>
    evaluation.reasonCodes.includes("unexpected_attachment"),
  ).length;
  const missingExpectedAttachmentCount = evaluations.filter((evaluation) =>
    evaluation.reasonCodes.includes("missing_expected_attachment"),
  ).length;
  const actualFollowupTakenCount = evaluations.filter((evaluation) => evaluation.observedFollowupCount > 0).length;

  return {
    eligibleCount,
    attachedCount,
    fullCount,
    partialCount,
    noCount,
    unexpectedAttachmentCount,
    missingExpectedAttachmentCount,
    actualFollowupTakenCount,
    // This is still a proxy metric over packet actionability/grounding, not a
    // complete "what the user did next" trace. Actual packet-guided follow-up
    // now has a dedicated metric below when mako observes an executed action.
    packetHelpedNextStepRate:
      eligibleCount > 0
        ? evaluations.filter(
            (evaluation) =>
              evaluation.eligible && (evaluation.grade === "full" || evaluation.grade === "partial"),
          ).length / eligibleCount
        : null,
    actualFollowupRate:
      eligibleCount > 0 && actualFollowupTakenCount > 0
        ? actualFollowupTakenCount / eligibleCount
        : null,
    noNoiseRate:
      attachedCount > 0
        ? evaluations.filter(
            (evaluation) =>
              evaluation.attached && evaluation.grade !== "no",
          ).length / attachedCount
        : null,
  };
}

export function shouldPromoteWorkflowPacketAttachment(
  metrics: WorkflowPacketPromotionMetrics,
  thresholds: WorkflowPacketPromotionThresholds,
): boolean {
  return (
    metrics.eligibleCount >= thresholds.minEligibleCount &&
    metrics.packetHelpedNextStepRate != null &&
    metrics.packetHelpedNextStepRate >= thresholds.minHelpedRate &&
    metrics.noNoiseRate != null &&
    metrics.noNoiseRate >= thresholds.minNoNoiseRate &&
    (typeof thresholds.minActualFollowupRate !== "number" ||
      metrics.actualFollowupRate == null ||
      metrics.actualFollowupRate >= thresholds.minActualFollowupRate)
  );
}
