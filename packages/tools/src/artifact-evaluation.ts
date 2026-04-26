import type {
  ArtifactBase,
  ArtifactExposureDecision,
  ArtifactExposurePromotionPath,
  ArtifactExposureState,
  ArtifactKind,
  ArtifactPromotionMetrics,
  ArtifactPromotionThresholds,
  ArtifactUsefulnessEvaluation,
  ArtifactUsefulnessGrade,
  ArtifactUsefulnessReasonCode,
  ArtifactWrapperExposureDecision,
  ArtifactWrapperFamily,
  ArtifactWrapperPromotionMetrics,
  ArtifactWrapperUsefulnessEvaluation,
  ArtifactWrapperUsefulnessReasonCode,
  ImplementationHandoffArtifact,
  ImplementationHandoffArtifactToolOutput,
  ReviewBundleArtifact,
  ReviewBundleArtifactToolOutput,
  TaskPreflightArtifact,
  TaskPreflightArtifactToolOutput,
  ToolOutput,
  VerificationBundleArtifact,
  VerificationBundleArtifactToolOutput,
} from "@mako-ai/contracts";

/**
 * 7.5 artifact usefulness evaluator.
 *
 * Mirrors `packages/tools/src/workflow-evaluation.ts` strictly. The 7.5 phase
 * rule requires reusing the Roadmap 6 grading shape, so the scoring
 * accumulator, grade thresholds, and promotion / exposure helpers stay the
 * same here. Artifact-specific logic lives only in the per-kind switch
 * inside `evaluateArtifactUsefulness` and in the exposure policy table
 * below.
 *
 * Grade rules (same as R6 power-workflow):
 * - score >= 3 OR (score >= 2 AND observedFollowupCount > 0) → `full`
 * - score >= 1 → `partial`
 * - otherwise → `no`
 *
 * Follow-up signal only lifts the `full` boundary — `partial` still
 * requires at least one intrinsic usefulness signal. This matches R6 so
 * 7.5 doesn't accidentally promote artifacts that nobody engaged with.
 */

// ===== Artifact-level exposure policy =====
//
// Initial values are conservative first-slice picks aligned with the 7.5
// phase doc's rule "do not auto-promote weak artifacts just because they
// exist." Task 11 tunes these against eval data before the roadmap closes.

interface ArtifactExposurePolicy {
  targetExposure: ArtifactExposureState;
  fallbackExposure: ArtifactExposureState;
  rationale: string;
  thresholds?: ArtifactPromotionThresholds;
}

const ARTIFACT_DEFAULT_THRESHOLDS: ArtifactPromotionThresholds = {
  minEligibleCount: 1,
  minHelpedRate: 0.75,
  minNoNoiseRate: 0.75,
};

const ARTIFACT_OPT_IN_THRESHOLDS: ArtifactPromotionThresholds = {
  minEligibleCount: 1,
  minHelpedRate: 0.5,
  minNoNoiseRate: 0.5,
};

const ARTIFACT_EXPOSURE_POLICIES: Record<ArtifactKind, ArtifactExposurePolicy> = {
  task_preflight: {
    targetExposure: "default",
    fallbackExposure: "opt_in",
    thresholds: ARTIFACT_DEFAULT_THRESHOLDS,
    rationale:
      "task_preflight composes shipped packets + change_plan + verification_plan; low-risk surface that earns default exposure when it consistently lands change surfaces and verification steps.",
  },
  implementation_handoff: {
    targetExposure: "opt_in",
    fallbackExposure: "dark",
    thresholds: ARTIFACT_OPT_IN_THRESHOLDS,
    rationale:
      "implementation_handoff is most useful at explicit session boundaries; opt-in until the handoff payload consistently carries both session momentum and prior follow-up continuation.",
  },
  review_bundle: {
    targetExposure: "default",
    fallbackExposure: "opt_in",
    thresholds: ARTIFACT_DEFAULT_THRESHOLDS,
    rationale:
      "review_bundle closes the 7.0 basis gap with impact_packet + diagnostics; default exposure when the bundle stays strictly stronger than reaching for those tools directly.",
  },
  verification_bundle: {
    targetExposure: "opt_in",
    fallbackExposure: "dark",
    thresholds: ARTIFACT_OPT_IN_THRESHOLDS,
    rationale:
      "verification_bundle is reviewer/verifier-facing and now carries trust state; opt-in until trustState + stop conditions consistently clear go/no-go on real change scopes.",
  },
};

// ===== Helpers =====

const ARTIFACT_TOOL_NAMES = [
  "task_preflight_artifact",
  "implementation_handoff_artifact",
  "review_bundle_artifact",
  "verification_bundle_artifact",
] as const;
type ArtifactToolName = (typeof ARTIFACT_TOOL_NAMES)[number];

export function isArtifactToolName(toolName: string): toolName is ArtifactToolName {
  return (ARTIFACT_TOOL_NAMES as readonly string[]).includes(toolName);
}

/**
 * Extract the typed artifact from one of the four artifact-producing tool
 * outputs. Returns null for non-artifact tool outputs so the eval-runner
 * can call this unconditionally on every tool result.
 */
export function extractArtifactFromToolOutput(
  output: ToolOutput,
): ArtifactBase<ArtifactKind, unknown> | null {
  if (!isArtifactToolName(output.toolName)) {
    return null;
  }
  switch (output.toolName) {
    case "task_preflight_artifact":
      return (output as TaskPreflightArtifactToolOutput).result;
    case "implementation_handoff_artifact":
      return (output as ImplementationHandoffArtifactToolOutput).result;
    case "review_bundle_artifact":
      return (output as ReviewBundleArtifactToolOutput).result;
    case "verification_bundle_artifact":
      return (output as VerificationBundleArtifactToolOutput).result;
  }
}

// ===== Artifact-level evaluator =====

export function evaluateArtifactUsefulness(
  artifact: ArtifactBase<ArtifactKind, unknown>,
  options: { observedFollowupCount?: number } = {},
): ArtifactUsefulnessEvaluation {
  const observedFollowupCount = Math.max(0, options.observedFollowupCount ?? 0);
  const reasonCodes: ArtifactUsefulnessReasonCode[] = [];
  let score = 0;

  // Shared basis health — every artifact contributes these signals before
  // per-family scoring runs.
  const staleBasisCount = artifact.freshness.staleBasisRefIds.length;
  if (staleBasisCount > 0) {
    reasonCodes.push("stale_basis_ref");
  } else if (artifact.basis.length > 0) {
    reasonCodes.push("basis_complete");
    score += 1;
  } else {
    // ArtifactBaseShape forbids empty basis at the contract layer, so this
    // branch is defensive — if we somehow see it, degrade the grade cleanly.
    reasonCodes.push("missing_basis_ref");
  }

  // Per-family payload scoring.
  switch (artifact.kind) {
    case "task_preflight":
      score += scoreTaskPreflight(artifact as TaskPreflightArtifact, reasonCodes);
      break;
    case "implementation_handoff":
      score += scoreImplementationHandoff(artifact as ImplementationHandoffArtifact, reasonCodes);
      break;
    case "review_bundle":
      score += scoreReviewBundle(artifact as ReviewBundleArtifact, reasonCodes);
      break;
    case "verification_bundle":
      score += scoreVerificationBundle(artifact as VerificationBundleArtifact, reasonCodes);
      break;
  }

  if (observedFollowupCount > 0) {
    reasonCodes.push("followup_action_taken");
  }

  const uniqueReasonCodes = [...new Set(reasonCodes)];
  const finalReasonCodes = uniqueReasonCodes.length > 0 ? uniqueReasonCodes : (["no_actionable_result"] as ArtifactUsefulnessReasonCode[]);
  const grade = gradeArtifactUsefulness(score, observedFollowupCount);

  return {
    eligible: true,
    kind: artifact.kind,
    grade,
    reasonCodes: finalReasonCodes,
    reason: explainGrade(grade, finalReasonCodes),
    observedFollowupCount,
  };
}

function scoreTaskPreflight(
  artifact: TaskPreflightArtifact,
  reasonCodes: ArtifactUsefulnessReasonCode[],
): number {
  let score = 0;
  const { readFirst, likelyMoveSurfaces, verifyBeforeStart, activeRisks } = artifact.payload;

  if (readFirst.length > 0) {
    reasonCodes.push("preflight_has_read_items");
    score += 1;
  }
  if (likelyMoveSurfaces.length > 0) {
    reasonCodes.push("preflight_has_change_surfaces");
    score += 2;
  } else {
    // Change plan legitimately returns no surfaces sometimes — mark it
    // so the eval reason is inspectable without collapsing the whole
    // grade to `no` if other signals are strong.
    reasonCodes.push("preflight_empty_surfaces");
  }
  if (verifyBeforeStart.length > 0) {
    reasonCodes.push("preflight_has_verification_steps");
    score += 1;
  }
  if (activeRisks.length > 0) {
    reasonCodes.push("preflight_has_risks");
  }
  return score;
}

function scoreImplementationHandoff(
  artifact: ImplementationHandoffArtifact,
  reasonCodes: ArtifactUsefulnessReasonCode[],
): number {
  let score = 0;
  const { currentFocus, keyContext, followUps, priorFollowups } = artifact.payload;

  if (currentFocus) {
    reasonCodes.push("handoff_current_focus_present");
    score += 2;
  }
  if (keyContext.length >= 2) {
    reasonCodes.push("handoff_key_context_present");
    score += 1;
  }
  // Session momentum signal: a handoff that carries both focus AND a
  // non-empty follow-ups list is meaningfully stronger than either alone.
  if (currentFocus && followUps.length > 0) {
    reasonCodes.push("handoff_session_momentum_present");
    score += 1;
  }
  if (followUps.length > 0) {
    reasonCodes.push("handoff_followups_present");
  }
  if (priorFollowups.length > 0) {
    // 7.5 close: prior workflow_followup records explicitly signal the
    // handoff is landing on ongoing work, not a cold start.
    reasonCodes.push("handoff_prior_followups_present");
    score += 1;
  }
  return score;
}

function scoreReviewBundle(
  artifact: ReviewBundleArtifact,
  reasonCodes: ArtifactUsefulnessReasonCode[],
): number {
  let score = 0;
  const {
    inspectFirst,
    reviewSurfaces,
    reviewerChecks,
    directOperatorFindings,
    weakOperatorSignals,
    impactZones,
    diagnosticFindings,
  } = artifact.payload;

  if (inspectFirst.length > 0) {
    reasonCodes.push("review_inspect_items_present");
    score += 1;
  }
  if (reviewSurfaces.length > 0) {
    reasonCodes.push("review_surfaces_present");
    score += 1;
  } else {
    reasonCodes.push("review_empty_surfaces");
  }
  if (reviewerChecks.length > 0) {
    reasonCodes.push("review_reviewer_checks_present");
    score += 1;
  }
  // 7.5-close basis sections — these are the load-bearing additions from
  // the 7.0 disambiguation table. Score them explicitly so a review_bundle
  // that closes the basis grades higher than a thin one.
  if (impactZones.length > 0) {
    reasonCodes.push("review_impact_zones_present");
    score += 1;
  }
  if (diagnosticFindings.length > 0) {
    reasonCodes.push("review_diagnostic_findings_present");
    score += 1;
  }
  if (directOperatorFindings.length > 0) {
    reasonCodes.push("review_operator_direct_present");
    score += 1;
  }
  if (weakOperatorSignals.length > 0) {
    reasonCodes.push("review_operator_weak_present");
  }
  return score;
}

function scoreVerificationBundle(
  artifact: VerificationBundleArtifact,
  reasonCodes: ArtifactUsefulnessReasonCode[],
): number {
  let score = 0;
  const {
    baselineChecks,
    requiredChecks,
    stopConditions,
    changeManagementChecks,
    directOperatorFindings,
    weakOperatorSignals,
    trustState,
  } = artifact.payload;

  if (baselineChecks.length > 0) {
    reasonCodes.push("verify_baseline_checks_present");
    score += 1;
  }
  if (requiredChecks.length > 0) {
    reasonCodes.push("verify_required_checks_present");
    score += 1;
  }
  if (stopConditions.length > 0) {
    reasonCodes.push("verify_stop_conditions_present");
    score += 1;
  }
  if (changeManagementChecks.length > 0) {
    reasonCodes.push("verify_change_management_present");
  }
  if (directOperatorFindings.length > 0) {
    reasonCodes.push("verify_operator_direct_present");
    score += 1;
  }
  if (weakOperatorSignals.length > 0) {
    reasonCodes.push("verify_operator_weak_present");
  }
  if (trustState) {
    reasonCodes.push("verify_trust_state_present");
    score += 1;
    // Trust state signals that aren't "stable" are a legitimate reviewer
    // signal — verification bundle has work to do. Mark so eval reporting
    // can distinguish "saw trust, it's fine" from "saw trust, needs action."
    if (trustState.state !== "stable") {
      reasonCodes.push("verify_trust_state_unstable");
    }
  }
  return score;
}

function gradeArtifactUsefulness(
  score: number,
  observedFollowupCount: number,
): ArtifactUsefulnessGrade {
  if ((observedFollowupCount > 0 && score >= 2) || score >= 3) {
    return "full";
  }
  if (score >= 1) {
    return "partial";
  }
  return "no";
}

function explainGrade(
  grade: ArtifactUsefulnessGrade,
  reasonCodes: readonly ArtifactUsefulnessReasonCode[],
): string {
  // Short human-readable reason alongside the codes. Inspired by the
  // deepeval `BaseMetric { reason, success }` pattern — codes stay the
  // machine-readable primitive; this string is for eval reports.
  const primary = reasonCodes.filter(
    (code) => code !== "warnings_present" && code !== "followup_action_taken",
  );
  if (grade === "no") {
    return "Artifact produced no actionable signal across shipped payload sections.";
  }
  if (grade === "partial") {
    return `Artifact produced some signal (${primary.slice(0, 3).join(", ") || "basis only"}) but did not reach the full-help threshold.`;
  }
  return `Artifact surfaced actionable structure across multiple sections (${primary.slice(0, 4).join(", ")}).`;
}

// ===== Metrics aggregation + promotion + exposure =====

export function summarizeArtifactPromotionMetrics(
  evaluations: readonly ArtifactUsefulnessEvaluation[],
): ArtifactPromotionMetrics[] {
  const grouped = new Map<ArtifactKind, ArtifactUsefulnessEvaluation[]>();
  for (const evaluation of evaluations) {
    const existing = grouped.get(evaluation.kind);
    if (existing) {
      existing.push(evaluation);
    } else {
      grouped.set(evaluation.kind, [evaluation]);
    }
  }

  return [...grouped.entries()]
    .map(([kind, items]) => {
      const eligibleCount = items.filter((item) => item.eligible).length;
      const fullCount = items.filter((item) => item.grade === "full").length;
      const partialCount = items.filter((item) => item.grade === "partial").length;
      const noCount = items.filter((item) => item.grade === "no").length;
      const actualFollowupTakenCount = items.filter((item) => item.observedFollowupCount > 0).length;
      const lowNoiseCount = items.filter((item) => isLowNoiseEvaluation(item)).length;
      return {
        kind,
        eligibleCount,
        fullCount,
        partialCount,
        noCount,
        actualFollowupTakenCount,
        helpfulRate:
          eligibleCount > 0 ? (fullCount + partialCount) / eligibleCount : null,
        actualFollowupRate:
          eligibleCount > 0 && actualFollowupTakenCount > 0
            ? actualFollowupTakenCount / eligibleCount
            : null,
        noNoiseRate: eligibleCount > 0 ? lowNoiseCount / eligibleCount : null,
      } satisfies ArtifactPromotionMetrics;
    })
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

export function shouldPromoteArtifactExposure(
  metrics: ArtifactPromotionMetrics,
  thresholds: ArtifactPromotionThresholds,
): boolean {
  return (
    metrics.eligibleCount >= thresholds.minEligibleCount &&
    metrics.helpfulRate != null &&
    metrics.helpfulRate >= thresholds.minHelpedRate &&
    metrics.noNoiseRate != null &&
    metrics.noNoiseRate >= thresholds.minNoNoiseRate &&
    (typeof thresholds.minActualFollowupRate !== "number" ||
      metrics.actualFollowupRate == null ||
      metrics.actualFollowupRate >= thresholds.minActualFollowupRate)
  );
}

export function decideArtifactExposure(
  metrics: ArtifactPromotionMetrics,
): ArtifactExposureDecision {
  const policy = ARTIFACT_EXPOSURE_POLICIES[metrics.kind];
  let exposure: ArtifactExposureState;
  let promotionPath: ArtifactExposurePromotionPath;
  if (policy.thresholds == null) {
    exposure = policy.targetExposure;
    promotionPath = "policy_capped";
  } else if (shouldPromoteArtifactExposure(metrics, policy.thresholds)) {
    exposure = policy.targetExposure;
    promotionPath = "target_met";
  } else {
    exposure = policy.fallbackExposure;
    promotionPath = "threshold_failed";
  }

  return {
    kind: metrics.kind,
    exposure,
    targetExposure: policy.targetExposure,
    fallbackExposure: policy.fallbackExposure,
    promotionPath,
    rationale: policy.rationale,
  };
}

function isLowNoiseEvaluation(evaluation: ArtifactUsefulnessEvaluation): boolean {
  return (
    evaluation.grade !== "no" &&
    !evaluation.reasonCodes.includes("warnings_present") &&
    !evaluation.reasonCodes.includes("no_actionable_result") &&
    !evaluation.reasonCodes.includes("missing_basis_ref") &&
    !evaluation.reasonCodes.includes("stale_basis_ref")
  );
}

// ===== Wrapper-level evaluator =====
//
// Wrappers grade independently from the artifact they deliver. Task 10 fills
// in wrapper scoring signals once the realistic smoke shape is nailed down;
// this file provides the plumbing (metrics, promotion, exposure) so the
// wrapper evaluator doesn't have to re-derive them.

interface ArtifactWrapperExposurePolicy {
  targetExposure: ArtifactExposureState;
  fallbackExposure: ArtifactExposureState;
  rationale: string;
  thresholds?: ArtifactPromotionThresholds;
}

const ARTIFACT_WRAPPER_EXPOSURE_POLICIES: Record<ArtifactWrapperFamily, ArtifactWrapperExposurePolicy> = {
  tool_plane: {
    targetExposure: "default",
    fallbackExposure: "opt_in",
    thresholds: ARTIFACT_DEFAULT_THRESHOLDS,
    rationale:
      "tool_plane is the canonical delivery surface for every Roadmap 7 artifact; it earns default exposure when artifact tools consistently return schema-valid, basis-complete results.",
  },
  file_export: {
    targetExposure: "opt_in",
    fallbackExposure: "not_promoted",
    thresholds: ARTIFACT_OPT_IN_THRESHOLDS,
    rationale:
      "file_export is the only 7.4 wrapper shipped; opt-in unless eval data shows the caller-opt-in export path consistently delivers files without noise.",
  },
};

export interface ArtifactWrapperEvaluationInput {
  family: ArtifactWrapperFamily;
  artifactKind: ArtifactKind;
  // tool_plane signals
  toolCallDelivered?: boolean;
  toolCallFailed?: boolean;
  schemaValid?: boolean;
  basisComplete?: boolean;
  // file_export signals
  exportRequested?: boolean;
  exportedFileCount?: number;
  exportRejected?: boolean;
  exportEmptyRendering?: boolean;
  // Shared
  warnings?: readonly string[];
}

export function evaluateArtifactWrapperUsefulness(
  input: ArtifactWrapperEvaluationInput,
): ArtifactWrapperUsefulnessEvaluation {
  const reasonCodes: ArtifactWrapperUsefulnessReasonCode[] = [];
  let score = 0;

  switch (input.family) {
    case "tool_plane":
      if (input.toolCallFailed) {
        reasonCodes.push("tool_call_failed");
      } else if (input.toolCallDelivered) {
        reasonCodes.push("tool_call_delivered");
        score += 1;
      }
      if (input.schemaValid) {
        reasonCodes.push("tool_result_schema_valid");
        score += 1;
      }
      if (input.basisComplete) {
        score += 1;
      } else if (input.toolCallDelivered) {
        reasonCodes.push("tool_result_empty_basis");
      }
      break;
    case "file_export":
      if (input.exportRejected) {
        reasonCodes.push("export_path_rejected");
      } else if (input.exportEmptyRendering) {
        reasonCodes.push("export_empty_rendering");
      } else if ((input.exportedFileCount ?? 0) > 0) {
        reasonCodes.push("export_files_written");
        score += 2;
      } else if (input.exportRequested === false) {
        reasonCodes.push("export_declined");
      }
      break;
  }
  if (input.warnings && input.warnings.length > 0) {
    reasonCodes.push("warnings_present");
  }

  const uniqueReasonCodes = [...new Set(reasonCodes)];
  const grade = gradeArtifactUsefulness(score, 0);
  return {
    eligible: true,
    family: input.family,
    artifactKind: input.artifactKind,
    grade,
    reasonCodes: uniqueReasonCodes.length > 0 ? uniqueReasonCodes : ["tool_result_empty_basis"],
    reason: explainWrapperGrade(input.family, grade, uniqueReasonCodes),
  };
}

function explainWrapperGrade(
  family: ArtifactWrapperFamily,
  grade: ArtifactUsefulnessGrade,
  reasonCodes: readonly ArtifactWrapperUsefulnessReasonCode[],
): string {
  if (grade === "no") {
    if (family === "tool_plane") {
      return "Wrapper did not deliver a schema-valid artifact result.";
    }
    return "Wrapper did not write any export files.";
  }
  if (grade === "partial") {
    return `Wrapper delivered a partial result (${reasonCodes.slice(0, 3).join(", ")}).`;
  }
  return `Wrapper delivered a complete, schema-valid artifact result (${reasonCodes.slice(0, 4).join(", ")}).`;
}

export function summarizeArtifactWrapperPromotionMetrics(
  evaluations: readonly ArtifactWrapperUsefulnessEvaluation[],
): ArtifactWrapperPromotionMetrics[] {
  const grouped = new Map<string, ArtifactWrapperUsefulnessEvaluation[]>();
  for (const evaluation of evaluations) {
    const key = `${evaluation.family}::${evaluation.artifactKind}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(evaluation);
    } else {
      grouped.set(key, [evaluation]);
    }
  }

  return [...grouped.values()]
    .map((items) => {
      const first = items[0]!;
      const eligibleCount = items.filter((item) => item.eligible).length;
      const fullCount = items.filter((item) => item.grade === "full").length;
      const partialCount = items.filter((item) => item.grade === "partial").length;
      const noCount = items.filter((item) => item.grade === "no").length;
      const lowNoiseCount = items.filter((item) => isWrapperLowNoise(item)).length;
      return {
        family: first.family,
        artifactKind: first.artifactKind,
        eligibleCount,
        fullCount,
        partialCount,
        noCount,
        helpfulRate: eligibleCount > 0 ? (fullCount + partialCount) / eligibleCount : null,
        noNoiseRate: eligibleCount > 0 ? lowNoiseCount / eligibleCount : null,
      } satisfies ArtifactWrapperPromotionMetrics;
    })
    .sort((left, right) => {
      const byFamily = left.family.localeCompare(right.family);
      if (byFamily !== 0) return byFamily;
      return left.artifactKind.localeCompare(right.artifactKind);
    });
}

export function decideArtifactWrapperExposure(
  metrics: ArtifactWrapperPromotionMetrics,
): ArtifactWrapperExposureDecision {
  const policy = ARTIFACT_WRAPPER_EXPOSURE_POLICIES[metrics.family];
  let exposure: ArtifactExposureState;
  let promotionPath: ArtifactExposurePromotionPath;
  if (policy.thresholds == null) {
    exposure = policy.targetExposure;
    promotionPath = "policy_capped";
  } else if (
    metrics.eligibleCount >= policy.thresholds.minEligibleCount &&
    metrics.helpfulRate != null &&
    metrics.helpfulRate >= policy.thresholds.minHelpedRate &&
    metrics.noNoiseRate != null &&
    metrics.noNoiseRate >= policy.thresholds.minNoNoiseRate
  ) {
    exposure = policy.targetExposure;
    promotionPath = "target_met";
  } else {
    exposure = policy.fallbackExposure;
    promotionPath = "threshold_failed";
  }

  return {
    family: metrics.family,
    artifactKind: metrics.artifactKind,
    exposure,
    targetExposure: policy.targetExposure,
    fallbackExposure: policy.fallbackExposure,
    promotionPath,
    rationale: policy.rationale,
  };
}

function isWrapperLowNoise(evaluation: ArtifactWrapperUsefulnessEvaluation): boolean {
  return (
    evaluation.grade !== "no" &&
    !evaluation.reasonCodes.includes("warnings_present") &&
    !evaluation.reasonCodes.includes("tool_call_failed") &&
    !evaluation.reasonCodes.includes("export_path_rejected")
  );
}
