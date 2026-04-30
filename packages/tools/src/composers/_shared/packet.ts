/**
 * Packet helpers — Layer 4 of the composer stack.
 *
 * `makePacket` is the single boundary where every composer's evidence gets
 * shaped into an `AnswerResult`. It computes confidence, populates freshness
 * flags, runs `AnswerPacketSchema.parse` so no composer ever returns a
 * malformed packet, and delegates the human summary to the caller.
 *
 * `assessConfidence` is the single rubric across all composers — freshness,
 * evidence density, missing-source markers. Tuned to Fenrir's original
 * confidence semantics (high/medium/low) rendered as a 0-1 score so the
 * existing `AnswerResult.answerConfidence` field carries it directly.
 */

import type {
  AnswerPacket,
  AnswerResult,
  CandidateAction,
  ComposerQueryKind,
  EvidenceBlock,
  EvidenceStatus,
  SupportLevel,
} from "@mako-ai/contracts";
import { AnswerPacketSchema, AnswerResultSchema } from "@mako-ai/contracts";
import { createId } from "@mako-ai/store";
import { orderByContextLayout } from "../../context-layout.js";
import { enrichEvidenceFreshness } from "../../index-freshness/index.js";
import type { ComposerContext } from "./context.js";

export interface MakePacketInput {
  queryKind: ComposerQueryKind;
  queryText: string;
  evidence: EvidenceBlock[];
  summary: string;
  /** Human-readable sources that could not be read (composer degrades). */
  missingInformation?: string[];
  /** Suggested next actions for the user / agent. Usually empty for composers. */
  candidateActions?: CandidateAction[];
}

const SUMMARY_MAX_LEN = 600;

function truncateSummary(summary: string): string {
  if (summary.length <= SUMMARY_MAX_LEN) return summary;
  return `${summary.slice(0, SUMMARY_MAX_LEN - 1)}…`;
}

function deriveEvidenceStatus(
  evidenceCount: number,
  missingCount: number,
  driftDetected: boolean,
): EvidenceStatus {
  if (evidenceCount === 0) return "partial";
  if (missingCount > 0 || driftDetected) return "partial";
  return "complete";
}

export interface ConfidenceAssessment {
  score: number;
  reasons: string[];
}

export function assessConfidence(
  evidence: EvidenceBlock[],
  freshness: ComposerContext["freshness"],
  missingInformation: string[],
  hasStaleIndexEvidence = false,
): ConfidenceAssessment {
  const reasons: string[] = [];
  let score = 0.9;

  if (evidence.length === 0) {
    score = 0.1;
    reasons.push("no-evidence");
    return { score, reasons };
  }

  if (evidence.length < 3) {
    score -= 0.25;
    reasons.push("thin-evidence");
  }

  if (missingInformation.length > 0) {
    score -= 0.2;
    reasons.push(`missing-${missingInformation.length}`);
  }

  if (freshness.driftDetected) {
    score -= 0.3;
    reasons.push("snapshot-stale");
  }

  if (freshness.generatedAt == null) {
    score -= 0.2;
    reasons.push("snapshot-unknown");
  }

  if (hasStaleIndexEvidence) {
    score -= 0.25;
    reasons.push("index-stale-evidence");
  }

  if (reasons.length === 0) {
    reasons.push("fresh-complete");
  }

  score = Math.max(0.05, Math.min(0.99, score));
  return { score, reasons };
}

function resolveSupportLevel(
  evidenceCount: number,
  missingCount: number,
  driftDetected: boolean,
): SupportLevel {
  if (evidenceCount === 0) return "best_effort";
  if (driftDetected || missingCount > 0) return "adapted";
  return "native";
}

export function makePacket(
  ctx: ComposerContext,
  input: MakePacketInput,
): AnswerResult {
  const missingInformation = input.missingInformation ?? [];
  const enriched = enrichEvidenceFreshness({
    projectRoot: ctx.projectRoot,
    store: ctx.store,
    evidence: input.evidence,
  });
  const stalenessFlags: string[] = [];
  if (ctx.freshness.driftDetected) stalenessFlags.push("snapshot-stale");
  if (ctx.freshness.generatedAt == null) stalenessFlags.push("snapshot-absent");
  stalenessFlags.push(...enriched.stalenessFlags);
  const hasStaleIndexEvidence = enriched.summary.state !== "fresh";
  const evidence = orderByContextLayout(enriched.evidence);

  const evidenceStatus = deriveEvidenceStatus(
    evidence.length,
    missingInformation.length,
    ctx.freshness.driftDetected || hasStaleIndexEvidence,
  );

  const { score, reasons } = assessConfidence(
    evidence,
    ctx.freshness,
    missingInformation,
    hasStaleIndexEvidence,
  );

  const supportLevel = resolveSupportLevel(
    evidence.length,
    missingInformation.length,
    ctx.freshness.driftDetected || hasStaleIndexEvidence,
  );

  const packet: AnswerPacket = {
    queryId: createId("query"),
    projectId: ctx.projectId,
    queryKind: input.queryKind,
    queryText: input.queryText,
    tierUsed: "standard",
    supportLevel,
    evidenceStatus,
    evidenceConfidence: score,
    missingInformation,
    stalenessFlags,
    indexFreshness: enriched.summary,
    evidence,
    generatedAt: new Date().toISOString(),
  };

  AnswerPacketSchema.parse(packet);

  const result: AnswerResult = {
    queryId: packet.queryId,
    projectId: packet.projectId,
    queryKind: packet.queryKind,
    tierUsed: packet.tierUsed,
    supportLevel: packet.supportLevel,
    evidenceStatus: packet.evidenceStatus,
    answer: truncateSummary(input.summary),
    answerConfidence: score,
    packet,
    candidateActions: input.candidateActions ?? [],
  };
  AnswerResultSchema.parse(result);

  // `reasons` from `assessConfidence` is a debugging signal — callers can
  // reflect on it via the packet's confidence score, but we don't expose it
  // as a separate field because AnswerPacket's shape is frozen.
  // Leaving this as a deliberate no-op so the array isn't unused.
  void reasons;

  return result;
}
