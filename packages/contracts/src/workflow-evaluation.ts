import { z } from "zod";

export type PowerWorkflowFamily =
  | "graph_traversal"
  | "graph_workflow"
  | "tenant_audit"
  | "project_intelligence"
  | "bounded_investigation";

export type PowerWorkflowToolName =
  | "graph_neighbors"
  | "graph_path"
  | "flow_map"
  | "change_plan"
  | "tenant_leak_audit"
  | "session_handoff"
  | "health_trend"
  | "issues_next"
  | "suggest"
  | "investigate";

export type PowerWorkflowUsefulnessGrade = "full" | "partial" | "no";

export type PowerWorkflowExposureState = "default" | "opt_in" | "dark" | "not_promoted";

export type PowerWorkflowExposurePromotionPath =
  | "target_met"
  | "threshold_failed"
  | "policy_capped";

export type PowerWorkflowUsefulnessReasonCode =
  | "graph_results_present"
  | "start_entity_suggestions_present"
  | "path_found"
  | "exact_path_found"
  | "no_path_reason_present"
  | "flow_steps_present"
  | "major_boundaries_present"
  | "change_surfaces_present"
  | "change_steps_present"
  | "follow_on_present"
  | "tenant_direct_evidence_present"
  | "tenant_weak_signal_present"
  | "reviewed_safe_surfaces_present"
  | "advisory_only"
  | "current_focus_present"
  | "recent_queries_present"
  | "stop_conditions_present"
  | "trend_history_present"
  | "insufficient_history_only"
  | "current_issue_present"
  | "queued_issues_present"
  | "queued_issues_truncated"
  | "canonical_tool_selected"
  | "bounded_sequence_suggested"
  | "executed_steps_present"
  | "investigation_completed"
  | "budget_exhausted"
  | "heuristic_edge_used"
  | "followup_action_taken"
  | "warnings_present"
  | "unsupported_result"
  | "no_actionable_result";

export interface PowerWorkflowUsefulnessEvaluation {
  eligible: boolean;
  toolName: PowerWorkflowToolName;
  family: PowerWorkflowFamily;
  grade: PowerWorkflowUsefulnessGrade;
  reasonCodes: PowerWorkflowUsefulnessReasonCode[];
  observedFollowupCount: number;
}

export interface PowerWorkflowPromotionMetrics {
  toolName: PowerWorkflowToolName;
  family: PowerWorkflowFamily;
  eligibleCount: number;
  fullCount: number;
  partialCount: number;
  noCount: number;
  actualFollowupTakenCount: number;
  helpfulRate: number | null;
  actualFollowupRate: number | null;
  noNoiseRate: number | null;
}

export interface PowerWorkflowPromotionThresholds {
  minEligibleCount: number;
  minHelpedRate: number;
  minNoNoiseRate: number;
  minActualFollowupRate?: number;
}

export interface PowerWorkflowExposureDecision {
  toolName: PowerWorkflowToolName;
  family: PowerWorkflowFamily;
  exposure: PowerWorkflowExposureState;
  targetExposure: PowerWorkflowExposureState;
  fallbackExposure: PowerWorkflowExposureState;
  promotionPath: PowerWorkflowExposurePromotionPath;
  rationale: string;
}

export const PowerWorkflowFamilySchema = z.enum([
  "graph_traversal",
  "graph_workflow",
  "tenant_audit",
  "project_intelligence",
  "bounded_investigation",
]);

export const PowerWorkflowToolNameSchema = z.enum([
  "graph_neighbors",
  "graph_path",
  "flow_map",
  "change_plan",
  "tenant_leak_audit",
  "session_handoff",
  "health_trend",
  "issues_next",
  "suggest",
  "investigate",
]);

export const PowerWorkflowUsefulnessGradeSchema = z.enum(["full", "partial", "no"]);

export const PowerWorkflowExposureStateSchema = z.enum([
  "default",
  "opt_in",
  "dark",
  "not_promoted",
]);

export const PowerWorkflowExposurePromotionPathSchema = z.enum([
  "target_met",
  "threshold_failed",
  "policy_capped",
]);

export const PowerWorkflowUsefulnessReasonCodeSchema = z.enum([
  "graph_results_present",
  "start_entity_suggestions_present",
  "path_found",
  "exact_path_found",
  "no_path_reason_present",
  "flow_steps_present",
  "major_boundaries_present",
  "change_surfaces_present",
  "change_steps_present",
  "follow_on_present",
  "tenant_direct_evidence_present",
  "tenant_weak_signal_present",
  "reviewed_safe_surfaces_present",
  "advisory_only",
  "current_focus_present",
  "recent_queries_present",
  "stop_conditions_present",
  "trend_history_present",
  "insufficient_history_only",
  "current_issue_present",
  "queued_issues_present",
  "queued_issues_truncated",
  "canonical_tool_selected",
  "bounded_sequence_suggested",
  "executed_steps_present",
  "investigation_completed",
  "budget_exhausted",
  "heuristic_edge_used",
  "followup_action_taken",
  "warnings_present",
  "unsupported_result",
  "no_actionable_result",
]);

export const PowerWorkflowUsefulnessEvaluationSchema = z.object({
  eligible: z.boolean(),
  toolName: PowerWorkflowToolNameSchema,
  family: PowerWorkflowFamilySchema,
  grade: PowerWorkflowUsefulnessGradeSchema,
  reasonCodes: z.array(PowerWorkflowUsefulnessReasonCodeSchema),
  observedFollowupCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<PowerWorkflowUsefulnessEvaluation>;

export const PowerWorkflowPromotionMetricsSchema = z.object({
  toolName: PowerWorkflowToolNameSchema,
  family: PowerWorkflowFamilySchema,
  eligibleCount: z.number().int().nonnegative(),
  fullCount: z.number().int().nonnegative(),
  partialCount: z.number().int().nonnegative(),
  noCount: z.number().int().nonnegative(),
  actualFollowupTakenCount: z.number().int().nonnegative(),
  helpfulRate: z.number().min(0).max(1).nullable(),
  actualFollowupRate: z.number().min(0).max(1).nullable(),
  noNoiseRate: z.number().min(0).max(1).nullable(),
}) satisfies z.ZodType<PowerWorkflowPromotionMetrics>;

export const PowerWorkflowPromotionThresholdsSchema = z.object({
  minEligibleCount: z.number().int().positive(),
  minHelpedRate: z.number().min(0).max(1),
  minNoNoiseRate: z.number().min(0).max(1),
  minActualFollowupRate: z.number().min(0).max(1).optional(),
}) satisfies z.ZodType<PowerWorkflowPromotionThresholds>;

export const PowerWorkflowExposureDecisionSchema = z.object({
  toolName: PowerWorkflowToolNameSchema,
  family: PowerWorkflowFamilySchema,
  exposure: PowerWorkflowExposureStateSchema,
  targetExposure: PowerWorkflowExposureStateSchema,
  fallbackExposure: PowerWorkflowExposureStateSchema,
  promotionPath: PowerWorkflowExposurePromotionPathSchema,
  rationale: z.string().trim().min(1),
}) satisfies z.ZodType<PowerWorkflowExposureDecision>;
