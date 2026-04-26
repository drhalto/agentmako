import { z } from "zod";
import {
  FINDING_ACK_STATUSES,
  FINDING_ACK_SUBJECT_KINDS,
  FindingAckSchema,
  FindingAckStatusSchema,
  FindingAckSubjectKindSchema,
  type FindingAck,
  type FindingAckStatus,
  type FindingAckSubjectKind,
} from "./finding-acks.js";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";

/**
 * `finding_ack` — mutation tool that persists one row to the append-only
 * finding_acks ledger. Category is caller-owned; for `lint_files` findings,
 * `finding.code` is the recommended default (both as `category` and
 * `sourceRuleId`). For `ast_find_pattern` matches, the caller supplies
 * the category (e.g. "hydration-check") and the fingerprint comes from
 * `AstFindPatternMatch.ackableFingerprint`.
 *
 * `finding_acks_report` — read-only query tool over the same ledger.
 * Returns aggregate counts (by category / status / subjectKind / filePath)
 * plus a bounded, reverse-chronological list of rows.
 */

export interface FindingAckToolInput {
  projectId?: string;
  projectRef?: string;
  category: string;
  subjectKind: FindingAckSubjectKind;
  filePath?: string;
  fingerprint: string;
  snippet?: string;
  status?: FindingAckStatus;
  reason: string;
  acknowledgedBy?: string;
  sourceToolName?: string;
  sourceRuleId?: string;
  sourceIdentityMatchBasedId?: string;
}

export const FindingAckToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  category: z.string().trim().min(1),
  subjectKind: FindingAckSubjectKindSchema,
  filePath: z.string().trim().min(1).optional(),
  fingerprint: z.string().trim().min(1),
  snippet: z.string().optional(),
  // Handler defaults to "ignored" when status is omitted — see
  // `packages/tools/src/finding-acks/ack.ts`.
  status: FindingAckStatusSchema.optional(),
  reason: z.string().trim().min(1),
  acknowledgedBy: z.string().trim().min(1).optional(),
  sourceToolName: z.string().trim().min(1).optional(),
  sourceRuleId: z.string().trim().min(1).optional(),
  sourceIdentityMatchBasedId: z.string().trim().min(1).optional(),
}).strict() satisfies z.ZodType<FindingAckToolInput>;

export interface FindingAckToolOutput {
  toolName: "finding_ack";
  projectId: string;
  ack: FindingAck;
}

export const FindingAckToolOutputSchema = z.object({
  toolName: z.literal("finding_ack"),
  projectId: z.string().min(1),
  ack: FindingAckSchema,
}) satisfies z.ZodType<FindingAckToolOutput>;

// ===== finding_ack_batch =====

export interface FindingAckBatchRow {
  label?: string;
  category?: string;
  subjectKind?: FindingAckSubjectKind;
  filePath?: string;
  fingerprint: string;
  snippet?: string;
  status?: FindingAckStatus;
  reason?: string;
  acknowledgedBy?: string;
  sourceToolName?: string;
  sourceRuleId?: string;
  sourceIdentityMatchBasedId?: string;
}

export const FindingAckBatchRowSchema = z.object({
  label: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  subjectKind: FindingAckSubjectKindSchema.optional(),
  filePath: z.string().trim().min(1).optional(),
  fingerprint: z.string().trim().min(1),
  snippet: z.string().optional(),
  status: FindingAckStatusSchema.optional(),
  reason: z.string().trim().min(1).optional(),
  acknowledgedBy: z.string().trim().min(1).optional(),
  sourceToolName: z.string().trim().min(1).optional(),
  sourceRuleId: z.string().trim().min(1).optional(),
  sourceIdentityMatchBasedId: z.string().trim().min(1).optional(),
}).strict() satisfies z.ZodType<FindingAckBatchRow>;

export interface FindingAckBatchToolInput {
  projectId?: string;
  projectRef?: string;
  category?: string;
  subjectKind?: FindingAckSubjectKind;
  status?: FindingAckStatus;
  reason?: string;
  acknowledgedBy?: string;
  sourceToolName?: string;
  sourceRuleId?: string;
  rows: FindingAckBatchRow[];
  continueOnError?: boolean;
}

export const FindingAckBatchToolInputSchema =
  ProjectLocatorInputObjectSchema.extend({
    category: z.string().trim().min(1).optional(),
    subjectKind: FindingAckSubjectKindSchema.optional(),
    status: FindingAckStatusSchema.optional(),
    reason: z.string().trim().min(1).optional(),
    acknowledgedBy: z.string().trim().min(1).optional(),
    sourceToolName: z.string().trim().min(1).optional(),
    sourceRuleId: z.string().trim().min(1).optional(),
    rows: z.array(FindingAckBatchRowSchema).min(1).max(200),
    continueOnError: z.boolean().optional(),
  }).strict() satisfies z.ZodType<FindingAckBatchToolInput>;

export interface FindingAckBatchRejectedRow {
  index: number;
  label?: string;
  fingerprint?: string;
  reason: string;
}

export const FindingAckBatchRejectedRowSchema = z.object({
  index: z.number().int().nonnegative(),
  label: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional(),
  reason: z.string().min(1),
}) satisfies z.ZodType<FindingAckBatchRejectedRow>;

export interface FindingAckBatchToolOutput {
  toolName: "finding_ack_batch";
  projectId: string;
  acks: FindingAck[];
  rejected: FindingAckBatchRejectedRow[];
  summary: {
    requestedRows: number;
    ackedRows: number;
    rejectedRows: number;
  };
  warnings: string[];
}

export const FindingAckBatchToolOutputSchema = z.object({
  toolName: z.literal("finding_ack_batch"),
  projectId: z.string().min(1),
  acks: z.array(FindingAckSchema),
  rejected: z.array(FindingAckBatchRejectedRowSchema),
  summary: z.object({
    requestedRows: z.number().int().nonnegative(),
    ackedRows: z.number().int().nonnegative(),
    rejectedRows: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<FindingAckBatchToolOutput>;

// ===== finding_acks_report =====

export interface FindingAcksReportToolInput {
  projectId?: string;
  projectRef?: string;
  category?: string;
  subjectKind?: FindingAckSubjectKind;
  filePath?: string;
  status?: FindingAckStatus;
  since?: string;
  until?: string;
  limit?: number;
}

export const FindingAcksReportToolInputSchema =
  ProjectLocatorInputObjectSchema.extend({
    category: z.string().trim().min(1).optional(),
    subjectKind: FindingAckSubjectKindSchema.optional(),
    filePath: z.string().trim().min(1).optional(),
    status: FindingAckStatusSchema.optional(),
    since: z.string().datetime({ offset: true }).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(500).optional(),
  }).strict() satisfies z.ZodType<FindingAcksReportToolInput>;

export interface FindingAcksReportCategoryCount {
  category: string;
  distinctFingerprints: number;
  totalRows: number;
}

export const FindingAcksReportCategoryCountSchema = z.object({
  category: z.string().min(1),
  distinctFingerprints: z.number().int().nonnegative(),
  totalRows: z.number().int().nonnegative(),
}) satisfies z.ZodType<FindingAcksReportCategoryCount>;

export interface FindingAcksReportStatusCount {
  status: FindingAckStatus;
  count: number;
}

export const FindingAcksReportStatusCountSchema = z.object({
  status: FindingAckStatusSchema,
  count: z.number().int().nonnegative(),
}) satisfies z.ZodType<FindingAcksReportStatusCount>;

export interface FindingAcksReportSubjectKindCount {
  subjectKind: FindingAckSubjectKind;
  count: number;
}

export const FindingAcksReportSubjectKindCountSchema = z.object({
  subjectKind: FindingAckSubjectKindSchema,
  count: z.number().int().nonnegative(),
}) satisfies z.ZodType<FindingAcksReportSubjectKindCount>;

export interface FindingAcksReportFilePathCount {
  filePath: string | null;
  count: number;
}

export const FindingAcksReportFilePathCountSchema = z.object({
  filePath: z.string().min(1).nullable(),
  count: z.number().int().nonnegative(),
}) satisfies z.ZodType<FindingAcksReportFilePathCount>;

export interface FindingAcksReportToolOutput {
  toolName: "finding_acks_report";
  projectId: string;
  acksInWindow: number;
  byCategory: FindingAcksReportCategoryCount[];
  byStatus: FindingAcksReportStatusCount[];
  bySubjectKind: FindingAcksReportSubjectKindCount[];
  byFilePath: FindingAcksReportFilePathCount[];
  acks: FindingAck[];
  truncated: boolean;
  warnings: string[];
}

export const FindingAcksReportToolOutputSchema = z.object({
  toolName: z.literal("finding_acks_report"),
  projectId: z.string().min(1),
  acksInWindow: z.number().int().nonnegative(),
  byCategory: z.array(FindingAcksReportCategoryCountSchema),
  byStatus: z.array(FindingAcksReportStatusCountSchema),
  bySubjectKind: z.array(FindingAcksReportSubjectKindCountSchema),
  byFilePath: z.array(FindingAcksReportFilePathCountSchema),
  acks: z.array(FindingAckSchema),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<FindingAcksReportToolOutput>;

export { FINDING_ACK_STATUSES, FINDING_ACK_SUBJECT_KINDS };
