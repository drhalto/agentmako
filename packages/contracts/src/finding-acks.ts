import { z } from "zod";

/**
 * Phase 1 (Initial Testing roadmap) — finding acknowledgements contract.
 *
 * Base shape for operator-recorded "this match / diagnostic is verified
 * safe" entries. The ledger is append-only with no UPDATE and no DELETE
 * (matching `tool_runs` / `mako_usefulness_events`). Query-time filtering
 * dedupes by `(projectId, category, fingerprint)`.
 *
 * Two identity sources:
 * - `ast_match` — location-aware fingerprint computed over a match from
 *   `ast_find_pattern` (see `computeAstMatchFingerprint` in @mako-ai/store).
 * - `diagnostic_issue` — `AnswerSurfaceIssue.identity.matchBasedId` from
 *   `lint_files` (see `buildSurfaceIssue` in @mako-ai/tools).
 *
 * `status` is operator intent; query-time filtering is status-agnostic.
 * Both `ignored` and `accepted` rows exclude the matching fingerprint from
 * `excludeAcknowledgedCategory` callers. `accepted` distinguishes
 * reviewed-and-kept-filtered from suppress-because-wrong in reports.
 */

export const FINDING_ACK_STATUSES = ["ignored", "accepted"] as const;
export type FindingAckStatus = (typeof FINDING_ACK_STATUSES)[number];
export const FindingAckStatusSchema = z.enum(FINDING_ACK_STATUSES);

export const FINDING_ACK_SUBJECT_KINDS = [
  "ast_match",
  "diagnostic_issue",
] as const;
export type FindingAckSubjectKind =
  (typeof FINDING_ACK_SUBJECT_KINDS)[number];
export const FindingAckSubjectKindSchema = z.enum(FINDING_ACK_SUBJECT_KINDS);

export interface FindingAck {
  ackId: string;
  projectId: string;
  category: string;
  subjectKind: FindingAckSubjectKind;
  filePath?: string;
  fingerprint: string;
  status: FindingAckStatus;
  reason: string;
  acknowledgedBy?: string;
  acknowledgedAt: string;
  snippet?: string;
  sourceToolName?: string;
  sourceRuleId?: string;
  sourceIdentityMatchBasedId?: string;
}

export const FindingAckSchema = z.object({
  ackId: z.string().min(1),
  projectId: z.string().min(1),
  category: z.string().min(1),
  subjectKind: FindingAckSubjectKindSchema,
  filePath: z.string().min(1).optional(),
  fingerprint: z.string().min(1),
  status: FindingAckStatusSchema,
  reason: z.string().min(1),
  acknowledgedBy: z.string().min(1).optional(),
  acknowledgedAt: z.string().min(1),
  snippet: z.string().optional(),
  sourceToolName: z.string().min(1).optional(),
  sourceRuleId: z.string().min(1).optional(),
  sourceIdentityMatchBasedId: z.string().min(1).optional(),
}) satisfies z.ZodType<FindingAck>;
