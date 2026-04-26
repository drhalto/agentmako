import { z } from "zod";
import type { AnswerTrustState, QueryKind } from "./answer.js";
import type { EvidenceStatus, SupportLevel, Timestamp } from "./common.js";

const TimestampSchema = z.string().trim().min(1);
const QueryKindSchema = z.enum([
  "route_trace",
  "schema_usage",
  "auth_path",
  "file_health",
  "free_form",
  "trace_file",
  "preflight_table",
  "cross_search",
  "trace_edge",
  "trace_error",
  "trace_table",
  "trace_rpc",
]);
const SupportLevelSchema = z.enum(["native", "adapted", "best_effort"]);
const EvidenceStatusSchema = z.enum(["complete", "partial"]);
const AnswerTrustStateSchema = z.enum([
  "stable",
  "changed",
  "aging",
  "stale",
  "superseded",
  "contradicted",
  "insufficient_evidence",
]);

export type SessionHandoffFocusReasonCode =
  | "trust_contradicted"
  | "trust_insufficient_evidence"
  | "trust_stale"
  | "trust_aging"
  | "trust_changed"
  | "comparison_changed"
  | "followup_in_progress";

export type SessionHandoffPrimaryReasonCode = Exclude<
  SessionHandoffFocusReasonCode,
  "followup_in_progress"
>;

export interface ProjectIntelligenceBasis {
  latestIndexRunId?: string | null;
  schemaSnapshotId?: string | null;
  schemaFingerprint?: string | null;
  sourceTraceLimit: number;
}

export type SessionHandoffBasis = ProjectIntelligenceBasis;

export interface SessionHandoffRecentQuery {
  traceId: string;
  targetId?: string | null;
  comparisonId?: string | null;
  queryKind: QueryKind;
  queryText: string;
  createdAt: Timestamp;
  supportLevel: SupportLevel;
  evidenceStatus: EvidenceStatus;
  trustState?: AnswerTrustState | null;
  meaningfulChangeDetected: boolean;
  followupCount: number;
  lastFollowupAt?: Timestamp | null;
  signalCodes: SessionHandoffFocusReasonCode[];
  isCurrentFocus: boolean;
}

export interface SessionHandoffCurrentFocus extends SessionHandoffRecentQuery {
  reasonCode: SessionHandoffPrimaryReasonCode;
  reason: string;
  stopWhen: string[];
}

export interface ProjectHealthSnapshot {
  traceCount: number;
  unresolvedQueryCount: number;
  stableQueryCount: number;
  changedQueryCount: number;
  contradictedQueryCount: number;
  insufficientEvidenceQueryCount: number;
  queriesWithFollowups: number;
}

export interface SessionHandoffSummary {
  recentQueryCount: number;
  unresolvedQueryCount: number;
  changedQueryCount: number;
  queriesWithFollowups: number;
}

export interface SessionHandoffResult {
  generatedAt: Timestamp;
  basis: SessionHandoffBasis;
  summary: SessionHandoffSummary;
  currentFocus: SessionHandoffCurrentFocus | null;
  recentQueries: SessionHandoffRecentQuery[];
  warnings: string[];
}

export type HealthTrendMetricName =
  | "unresolved_queries"
  | "stable_queries"
  | "changed_queries"
  | "contradicted_queries"
  | "insufficient_evidence_queries"
  | "queries_with_followups";

export type HealthTrendMetricDirection = "up" | "down" | "flat" | "insufficient_history";

export interface HealthTrendMetric {
  metric: HealthTrendMetricName;
  recentCount: number;
  priorCount: number;
  direction: HealthTrendMetricDirection;
  interpretation: string;
}

export interface HealthTrendSummary extends ProjectHealthSnapshot {
  enoughHistory: boolean;
  recentWindowTraceCount: number;
  priorWindowTraceCount: number;
}

export interface HealthTrendResult {
  generatedAt: Timestamp;
  basis: ProjectIntelligenceBasis;
  summary: HealthTrendSummary;
  recentWindow: ProjectHealthSnapshot;
  priorWindow: ProjectHealthSnapshot | null;
  metrics: HealthTrendMetric[];
  warnings: string[];
}

export interface IssuesNextItem {
  traceId: string;
  targetId?: string | null;
  comparisonId?: string | null;
  queryKind: QueryKind;
  queryText: string;
  createdAt: Timestamp;
  supportLevel: SupportLevel;
  evidenceStatus: EvidenceStatus;
  trustState?: AnswerTrustState | null;
  meaningfulChangeDetected: boolean;
  followupCount: number;
  lastFollowupAt?: Timestamp | null;
  signalCodes: SessionHandoffFocusReasonCode[];
  reasonCode: SessionHandoffPrimaryReasonCode;
  reason: string;
  stopWhen: string[];
}

export interface IssuesNextSummary {
  recentQueryCount: number;
  candidateCount: number;
  activeCount: number;
  queuedCount: number;
  truncatedQueuedCount: number;
  suppressedStableCount: number;
  queriesWithFollowups: number;
}

export interface IssuesNextResult {
  generatedAt: Timestamp;
  basis: ProjectIntelligenceBasis;
  summary: IssuesNextSummary;
  currentIssue: IssuesNextItem | null;
  queuedIssues: IssuesNextItem[];
  warnings: string[];
}

export const SessionHandoffFocusReasonCodeSchema = z.enum([
  "trust_contradicted",
  "trust_insufficient_evidence",
  "trust_stale",
  "trust_aging",
  "trust_changed",
  "comparison_changed",
  "followup_in_progress",
]);

export const SessionHandoffPrimaryReasonCodeSchema = z.enum([
  "trust_contradicted",
  "trust_insufficient_evidence",
  "trust_stale",
  "trust_aging",
  "trust_changed",
  "comparison_changed",
]) satisfies z.ZodType<SessionHandoffPrimaryReasonCode>;

export const ProjectIntelligenceBasisSchema = z.object({
  latestIndexRunId: z.string().trim().min(1).nullable().optional(),
  schemaSnapshotId: z.string().trim().min(1).nullable().optional(),
  schemaFingerprint: z.string().trim().min(1).nullable().optional(),
  sourceTraceLimit: z.number().int().positive(),
}) satisfies z.ZodType<ProjectIntelligenceBasis>;

export const SessionHandoffBasisSchema = ProjectIntelligenceBasisSchema satisfies z.ZodType<SessionHandoffBasis>;

export const SessionHandoffRecentQuerySchema = z.object({
  traceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1).nullable().optional(),
  comparisonId: z.string().trim().min(1).nullable().optional(),
  queryKind: QueryKindSchema,
  queryText: z.string().trim().min(1),
  createdAt: TimestampSchema,
  supportLevel: SupportLevelSchema,
  evidenceStatus: EvidenceStatusSchema,
  trustState: AnswerTrustStateSchema.nullable().optional(),
  meaningfulChangeDetected: z.boolean(),
  followupCount: z.number().int().nonnegative(),
  lastFollowupAt: TimestampSchema.nullable().optional(),
  signalCodes: z.array(SessionHandoffFocusReasonCodeSchema),
  isCurrentFocus: z.boolean(),
}) satisfies z.ZodType<SessionHandoffRecentQuery>;

export const SessionHandoffCurrentFocusSchema = SessionHandoffRecentQuerySchema.extend({
  reasonCode: SessionHandoffPrimaryReasonCodeSchema,
  reason: z.string().trim().min(1),
  stopWhen: z.array(z.string().trim().min(1)).min(1),
}) satisfies z.ZodType<SessionHandoffCurrentFocus>;

export const SessionHandoffSummarySchema = z.object({
  recentQueryCount: z.number().int().nonnegative(),
  unresolvedQueryCount: z.number().int().nonnegative(),
  changedQueryCount: z.number().int().nonnegative(),
  queriesWithFollowups: z.number().int().nonnegative(),
}) satisfies z.ZodType<SessionHandoffSummary>;

export const SessionHandoffResultSchema = z.object({
  generatedAt: TimestampSchema,
  basis: SessionHandoffBasisSchema,
  summary: SessionHandoffSummarySchema,
  currentFocus: SessionHandoffCurrentFocusSchema.nullable(),
  recentQueries: z.array(SessionHandoffRecentQuerySchema),
  warnings: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<SessionHandoffResult>;

export const ProjectHealthSnapshotSchema = z.object({
  traceCount: z.number().int().nonnegative(),
  unresolvedQueryCount: z.number().int().nonnegative(),
  stableQueryCount: z.number().int().nonnegative(),
  changedQueryCount: z.number().int().nonnegative(),
  contradictedQueryCount: z.number().int().nonnegative(),
  insufficientEvidenceQueryCount: z.number().int().nonnegative(),
  queriesWithFollowups: z.number().int().nonnegative(),
}) satisfies z.ZodType<ProjectHealthSnapshot>;

export const HealthTrendMetricNameSchema = z.enum([
  "unresolved_queries",
  "stable_queries",
  "changed_queries",
  "contradicted_queries",
  "insufficient_evidence_queries",
  "queries_with_followups",
]) satisfies z.ZodType<HealthTrendMetricName>;

export const HealthTrendMetricDirectionSchema = z.enum([
  "up",
  "down",
  "flat",
  "insufficient_history",
]) satisfies z.ZodType<HealthTrendMetricDirection>;

export const HealthTrendMetricSchema = z.object({
  metric: HealthTrendMetricNameSchema,
  recentCount: z.number().int().nonnegative(),
  priorCount: z.number().int().nonnegative(),
  direction: HealthTrendMetricDirectionSchema,
  interpretation: z.string().trim().min(1),
}) satisfies z.ZodType<HealthTrendMetric>;

export const HealthTrendSummarySchema = ProjectHealthSnapshotSchema.extend({
  enoughHistory: z.boolean(),
  recentWindowTraceCount: z.number().int().nonnegative(),
  priorWindowTraceCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<HealthTrendSummary>;

export const HealthTrendResultSchema = z.object({
  generatedAt: TimestampSchema,
  basis: ProjectIntelligenceBasisSchema,
  summary: HealthTrendSummarySchema,
  recentWindow: ProjectHealthSnapshotSchema,
  priorWindow: ProjectHealthSnapshotSchema.nullable(),
  metrics: z.array(HealthTrendMetricSchema),
  warnings: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<HealthTrendResult>;

export const IssuesNextItemSchema = z.object({
  traceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1).nullable().optional(),
  comparisonId: z.string().trim().min(1).nullable().optional(),
  queryKind: QueryKindSchema,
  queryText: z.string().trim().min(1),
  createdAt: TimestampSchema,
  supportLevel: SupportLevelSchema,
  evidenceStatus: EvidenceStatusSchema,
  trustState: AnswerTrustStateSchema.nullable().optional(),
  meaningfulChangeDetected: z.boolean(),
  followupCount: z.number().int().nonnegative(),
  lastFollowupAt: TimestampSchema.nullable().optional(),
  signalCodes: z.array(SessionHandoffFocusReasonCodeSchema),
  reasonCode: SessionHandoffPrimaryReasonCodeSchema,
  reason: z.string().trim().min(1),
  stopWhen: z.array(z.string().trim().min(1)).min(1),
}) satisfies z.ZodType<IssuesNextItem>;

export const IssuesNextSummarySchema = z.object({
  recentQueryCount: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  activeCount: z.number().int().nonnegative(),
  queuedCount: z.number().int().nonnegative(),
  truncatedQueuedCount: z.number().int().nonnegative(),
  suppressedStableCount: z.number().int().nonnegative(),
  queriesWithFollowups: z.number().int().nonnegative(),
}) satisfies z.ZodType<IssuesNextSummary>;

export const IssuesNextResultSchema = z.object({
  generatedAt: TimestampSchema,
  basis: ProjectIntelligenceBasisSchema,
  summary: IssuesNextSummarySchema,
  currentIssue: IssuesNextItemSchema.nullable(),
  queuedIssues: z.array(IssuesNextItemSchema),
  warnings: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<IssuesNextResult>;
