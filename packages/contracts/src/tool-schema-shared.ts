import { z } from "zod";
import type {
  AnswerComparisonChange,
  AnswerTrustReason,
  QueryKind,
} from "./answer.js";
import type { JsonObject } from "./common.js";

export const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;
export const TimestampSchema = z.string().min(1);
export const SupportLevelSchema = z.enum(["native", "adapted", "best_effort"]);
export const EvidenceStatusSchema = z.enum(["complete", "partial"]);
export const ReasoningTierSchema = z.enum(["fast", "standard", "deep"]);
export const ContextLayoutZoneSchema = z.enum(["start", "middle", "end"]);
export const QueryKindSchema = z.enum([
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
]) satisfies z.ZodType<QueryKind>;

export const AnswerSurfaceIssueSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export const AnswerSurfaceIssueConfidenceSchema = z.enum(["possible", "probable", "confirmed"]);
export const AnswerSurfaceIssueCategorySchema = z.enum([
  "trust",
  "producer_consumer_drift",
  "identity_key_mismatch",
  "rpc_helper_reuse",
  "auth_role_drift",
  "sql_alignment",
  "ranking",
]);
export const AnswerTrustStateSchema = z.enum([
  "stable",
  "changed",
  "aging",
  "stale",
  "superseded",
  "contradicted",
  "insufficient_evidence",
]);
export const AnswerTrustScopeRelationSchema = z.enum([
  "none",
  "same_scope",
  "changed_scope",
  "backtested_old_scope",
]);
export const AnswerTrustFacetSchema = z.enum([
  "core_claim",
  "answer_status",
  "support_level",
  "answer_confidence",
  "evidence_set",
  "missing_information",
  "staleness",
  "answer_markdown",
]);
export const AnswerTrustReasonCodeSchema = z.enum([
  "no_meaningful_change",
  "meaningful_change_detected",
  "scope_changed",
  "freshness_warning",
  "freshness_expired",
  "packet_staleness_flag",
  "partial_evidence",
  "best_effort_support",
  "missing_information",
  "query_evidence_mismatch",
  "superseded_by_newer_run",
  "conflicting_cluster_detected",
]);
export const AnswerComparisonChangeCodeSchema = z.enum([
  "answer_markdown_changed",
  "answer_status_changed",
  "answer_confidence_changed",
  "support_level_changed",
  "core_claim_conflict",
  "evidence_added",
  "evidence_removed",
  "missing_info_added",
  "missing_info_removed",
  "staleness_flag_added",
  "staleness_flag_removed",
]);

export const AnswerTrustReasonSchema = z.object({
  code: AnswerTrustReasonCodeSchema,
  detail: z.string().min(1),
}) satisfies z.ZodType<AnswerTrustReason>;

export const AnswerComparisonChangeSchema = z.object({
  code: AnswerComparisonChangeCodeSchema,
  detail: z.string().min(1),
}) satisfies z.ZodType<AnswerComparisonChange>;
