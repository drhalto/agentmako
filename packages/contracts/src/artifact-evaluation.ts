import { z } from "zod";
import { ARTIFACT_KINDS, type ArtifactKind } from "./artifacts.js";

/**
 * 7.5 artifact usefulness evaluation contract.
 *
 * This mirrors `PowerWorkflowUsefulnessEvaluation` from Roadmap 6 deliberately
 * — the 7.5 phase rule requires reusing the shape, not inventing a parallel
 * grading system. Only the identifiers differ: artifacts grade per
 * `ArtifactKind` (not per tool name), and wrappers grade per
 * `ArtifactWrapperFamily` independently from the artifacts they deliver.
 *
 * Additions beyond the R6 shape:
 *
 * - each evaluation carries a short typed `reason` string alongside the
 *   `reasonCodes[]` — borrowed from the `deepeval` `BaseMetric { reason, success }`
 *   idiom so eval output stays inspectable without forcing callers to
 *   look up reason-code definitions. Codes remain the machine-readable
 *   primitive; `reason` is a one-line human hint.
 *
 * - artifact and wrapper evaluations live on parallel but separate types
 *   (matching the 7.5 rule: "one useful artifact does not earn exposure
 *   for a wrapper around it").
 */

// ===== Shared grade / exposure enums =====

export type ArtifactUsefulnessGrade = "full" | "partial" | "no";

export type ArtifactExposureState = "default" | "opt_in" | "dark" | "not_promoted";

export type ArtifactExposurePromotionPath =
  | "target_met"
  | "threshold_failed"
  | "policy_capped";

export const ArtifactUsefulnessGradeSchema = z.enum(["full", "partial", "no"]);

export const ArtifactExposureStateSchema = z.enum([
  "default",
  "opt_in",
  "dark",
  "not_promoted",
]);

export const ArtifactExposurePromotionPathSchema = z.enum([
  "target_met",
  "threshold_failed",
  "policy_capped",
]);

// ===== Artifact-level eval =====

/**
 * Reason codes the artifact evaluator can emit. The set spans every
 * Roadmap 7 artifact family so per-family scoring logic (7.5 tasks #6–#9)
 * can pick from a shared vocabulary without mutating the enum. Codes split
 * into three bands:
 *
 * - Shared basis health (every family emits these)
 * - Per-family structural content (what makes this specific artifact useful)
 * - Observed-usage signals (did the user act on it)
 */
export type ArtifactUsefulnessReasonCode =
  // Shared basis health
  | "basis_complete"
  | "missing_basis_ref"
  | "stale_basis_ref"
  | "no_actionable_result"
  | "followup_action_taken"
  | "warnings_present"
  // task_preflight
  | "preflight_has_read_items"
  | "preflight_has_change_surfaces"
  | "preflight_has_verification_steps"
  | "preflight_has_risks"
  | "preflight_empty_surfaces"
  // implementation_handoff
  | "handoff_current_focus_present"
  | "handoff_key_context_present"
  | "handoff_session_momentum_present"
  | "handoff_prior_followups_present"
  | "handoff_followups_present"
  // review_bundle
  | "review_inspect_items_present"
  | "review_surfaces_present"
  | "review_reviewer_checks_present"
  | "review_impact_zones_present"
  | "review_diagnostic_findings_present"
  | "review_operator_direct_present"
  | "review_operator_weak_present"
  | "review_empty_surfaces"
  // verification_bundle
  | "verify_baseline_checks_present"
  | "verify_required_checks_present"
  | "verify_stop_conditions_present"
  | "verify_change_management_present"
  | "verify_operator_direct_present"
  | "verify_operator_weak_present"
  | "verify_trust_state_present"
  | "verify_trust_state_unstable";

export const ArtifactUsefulnessReasonCodeSchema = z.enum([
  "basis_complete",
  "missing_basis_ref",
  "stale_basis_ref",
  "no_actionable_result",
  "followup_action_taken",
  "warnings_present",
  "preflight_has_read_items",
  "preflight_has_change_surfaces",
  "preflight_has_verification_steps",
  "preflight_has_risks",
  "preflight_empty_surfaces",
  "handoff_current_focus_present",
  "handoff_key_context_present",
  "handoff_session_momentum_present",
  "handoff_prior_followups_present",
  "handoff_followups_present",
  "review_inspect_items_present",
  "review_surfaces_present",
  "review_reviewer_checks_present",
  "review_impact_zones_present",
  "review_diagnostic_findings_present",
  "review_operator_direct_present",
  "review_operator_weak_present",
  "review_empty_surfaces",
  "verify_baseline_checks_present",
  "verify_required_checks_present",
  "verify_stop_conditions_present",
  "verify_change_management_present",
  "verify_operator_direct_present",
  "verify_operator_weak_present",
  "verify_trust_state_present",
  "verify_trust_state_unstable",
]);

export interface ArtifactUsefulnessEvaluation {
  eligible: boolean;
  kind: ArtifactKind;
  grade: ArtifactUsefulnessGrade;
  reasonCodes: ArtifactUsefulnessReasonCode[];
  // Short human-readable explanation of the grade. Machine-readable data
  // lives in `reasonCodes`; `reason` is for inspection and eval reports so
  // operators don't have to look up codes to understand why a family graded
  // `partial` or `no`. Keep under one line.
  reason: string;
  observedFollowupCount: number;
}

export const ArtifactUsefulnessEvaluationSchema = z.object({
  eligible: z.boolean(),
  kind: z.enum([...ARTIFACT_KINDS]),
  grade: ArtifactUsefulnessGradeSchema,
  reasonCodes: z.array(ArtifactUsefulnessReasonCodeSchema),
  reason: z.string().min(1),
  observedFollowupCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ArtifactUsefulnessEvaluation>;

export interface ArtifactPromotionMetrics {
  kind: ArtifactKind;
  eligibleCount: number;
  fullCount: number;
  partialCount: number;
  noCount: number;
  actualFollowupTakenCount: number;
  helpfulRate: number | null;
  actualFollowupRate: number | null;
  noNoiseRate: number | null;
}

export const ArtifactPromotionMetricsSchema = z.object({
  kind: z.enum([...ARTIFACT_KINDS]),
  eligibleCount: z.number().int().nonnegative(),
  fullCount: z.number().int().nonnegative(),
  partialCount: z.number().int().nonnegative(),
  noCount: z.number().int().nonnegative(),
  actualFollowupTakenCount: z.number().int().nonnegative(),
  helpfulRate: z.number().min(0).max(1).nullable(),
  actualFollowupRate: z.number().min(0).max(1).nullable(),
  noNoiseRate: z.number().min(0).max(1).nullable(),
}) satisfies z.ZodType<ArtifactPromotionMetrics>;

export interface ArtifactPromotionThresholds {
  minEligibleCount: number;
  minHelpedRate: number;
  minNoNoiseRate: number;
  minActualFollowupRate?: number;
}

export const ArtifactPromotionThresholdsSchema = z.object({
  minEligibleCount: z.number().int().positive(),
  minHelpedRate: z.number().min(0).max(1),
  minNoNoiseRate: z.number().min(0).max(1),
  minActualFollowupRate: z.number().min(0).max(1).optional(),
}) satisfies z.ZodType<ArtifactPromotionThresholds>;

export interface ArtifactExposureDecision {
  kind: ArtifactKind;
  exposure: ArtifactExposureState;
  targetExposure: ArtifactExposureState;
  fallbackExposure: ArtifactExposureState;
  promotionPath: ArtifactExposurePromotionPath;
  rationale: string;
}

export const ArtifactExposureDecisionSchema = z.object({
  kind: z.enum([...ARTIFACT_KINDS]),
  exposure: ArtifactExposureStateSchema,
  targetExposure: ArtifactExposureStateSchema,
  fallbackExposure: ArtifactExposureStateSchema,
  promotionPath: ArtifactExposurePromotionPathSchema,
  rationale: z.string().trim().min(1),
}) satisfies z.ZodType<ArtifactExposureDecision>;

// ===== Wrapper-level eval =====

/**
 * Wrapper families evaluated independently from the artifacts they deliver.
 * 7.5 closeout: `tool_plane` and `file_export` are the two wrapper surfaces
 * shipped. `editor` / `ci` / `hook` stayed deferred per the 7.4 decision
 * and are not part of this enum until a concrete friction earns them.
 */
export const ARTIFACT_WRAPPER_FAMILIES = ["tool_plane", "file_export"] as const;
export type ArtifactWrapperFamily = (typeof ARTIFACT_WRAPPER_FAMILIES)[number];
export const ArtifactWrapperFamilySchema = z.enum([...ARTIFACT_WRAPPER_FAMILIES]);

export type ArtifactWrapperUsefulnessReasonCode =
  | "tool_call_delivered"
  | "tool_call_failed"
  | "tool_result_schema_valid"
  | "tool_result_empty_basis"
  | "tool_exported_inline"
  | "export_files_written"
  | "export_declined"
  | "export_empty_rendering"
  | "export_path_rejected"
  | "warnings_present";

export const ArtifactWrapperUsefulnessReasonCodeSchema = z.enum([
  "tool_call_delivered",
  "tool_call_failed",
  "tool_result_schema_valid",
  "tool_result_empty_basis",
  "tool_exported_inline",
  "export_files_written",
  "export_declined",
  "export_empty_rendering",
  "export_path_rejected",
  "warnings_present",
]);

export interface ArtifactWrapperUsefulnessEvaluation {
  eligible: boolean;
  family: ArtifactWrapperFamily;
  artifactKind: ArtifactKind;
  grade: ArtifactUsefulnessGrade;
  reasonCodes: ArtifactWrapperUsefulnessReasonCode[];
  reason: string;
}

export const ArtifactWrapperUsefulnessEvaluationSchema = z.object({
  eligible: z.boolean(),
  family: ArtifactWrapperFamilySchema,
  artifactKind: z.enum([...ARTIFACT_KINDS]),
  grade: ArtifactUsefulnessGradeSchema,
  reasonCodes: z.array(ArtifactWrapperUsefulnessReasonCodeSchema),
  reason: z.string().min(1),
}) satisfies z.ZodType<ArtifactWrapperUsefulnessEvaluation>;

export interface ArtifactWrapperPromotionMetrics {
  family: ArtifactWrapperFamily;
  artifactKind: ArtifactKind;
  eligibleCount: number;
  fullCount: number;
  partialCount: number;
  noCount: number;
  helpfulRate: number | null;
  noNoiseRate: number | null;
}

export const ArtifactWrapperPromotionMetricsSchema = z.object({
  family: ArtifactWrapperFamilySchema,
  artifactKind: z.enum([...ARTIFACT_KINDS]),
  eligibleCount: z.number().int().nonnegative(),
  fullCount: z.number().int().nonnegative(),
  partialCount: z.number().int().nonnegative(),
  noCount: z.number().int().nonnegative(),
  helpfulRate: z.number().min(0).max(1).nullable(),
  noNoiseRate: z.number().min(0).max(1).nullable(),
}) satisfies z.ZodType<ArtifactWrapperPromotionMetrics>;

export interface ArtifactWrapperExposureDecision {
  family: ArtifactWrapperFamily;
  artifactKind: ArtifactKind;
  exposure: ArtifactExposureState;
  targetExposure: ArtifactExposureState;
  fallbackExposure: ArtifactExposureState;
  promotionPath: ArtifactExposurePromotionPath;
  rationale: string;
}

export const ArtifactWrapperExposureDecisionSchema = z.object({
  family: ArtifactWrapperFamilySchema,
  artifactKind: z.enum([...ARTIFACT_KINDS]),
  exposure: ArtifactExposureStateSchema,
  targetExposure: ArtifactExposureStateSchema,
  fallbackExposure: ArtifactExposureStateSchema,
  promotionPath: ArtifactExposurePromotionPathSchema,
  rationale: z.string().trim().min(1),
}) satisfies z.ZodType<ArtifactWrapperExposureDecision>;
