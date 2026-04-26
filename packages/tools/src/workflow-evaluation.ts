import type {
  ChangePlanToolOutput,
  FlowMapToolOutput,
  GraphNeighborsToolOutput,
  GraphPathToolOutput,
  PowerWorkflowExposurePromotionPath,
  HealthTrendToolOutput,
  InvestigateToolOutput,
  IssuesNextToolOutput,
  PowerWorkflowExposureDecision,
  PowerWorkflowExposureState,
  PowerWorkflowFamily,
  PowerWorkflowPromotionMetrics,
  PowerWorkflowPromotionThresholds,
  PowerWorkflowToolName,
  PowerWorkflowUsefulnessEvaluation,
  PowerWorkflowUsefulnessGrade,
  PowerWorkflowUsefulnessReasonCode,
  SessionHandoffToolOutput,
  SuggestToolOutput,
  TenantLeakAuditToolOutput,
  ToolOutput,
} from "@mako-ai/contracts";

interface PowerWorkflowExposurePolicy {
  targetExposure: PowerWorkflowExposureState;
  fallbackExposure: PowerWorkflowExposureState;
  rationale: string;
  thresholds?: PowerWorkflowPromotionThresholds;
}

const GRAPH_DEFAULT_THRESHOLDS: PowerWorkflowPromotionThresholds = {
  minEligibleCount: 1,
  minHelpedRate: 0.75,
  minNoNoiseRate: 0.75,
};

const OPT_IN_THRESHOLDS: PowerWorkflowPromotionThresholds = {
  minEligibleCount: 1,
  minHelpedRate: 0.5,
  minNoNoiseRate: 0.5,
};

const POWER_WORKFLOW_FAMILY_BY_TOOL: Record<PowerWorkflowToolName, PowerWorkflowFamily> = {
  graph_neighbors: "graph_traversal",
  graph_path: "graph_traversal",
  flow_map: "graph_workflow",
  change_plan: "graph_workflow",
  tenant_leak_audit: "tenant_audit",
  session_handoff: "project_intelligence",
  health_trend: "project_intelligence",
  issues_next: "project_intelligence",
  suggest: "bounded_investigation",
  investigate: "bounded_investigation",
};

const POWER_WORKFLOW_EXPOSURE_POLICIES: Record<PowerWorkflowToolName, PowerWorkflowExposurePolicy> = {
  graph_neighbors: {
    targetExposure: "default",
    fallbackExposure: "opt_in",
    thresholds: GRAPH_DEFAULT_THRESHOLDS,
    rationale: "graph_neighbors is low-risk and can be default when it consistently surfaces useful adjacent graph context without excess noise.",
  },
  graph_path: {
    targetExposure: "default",
    fallbackExposure: "opt_in",
    thresholds: GRAPH_DEFAULT_THRESHOLDS,
    rationale: "graph_path is the strongest direct graph answer when it consistently resolves bounded connections better than raw trace chains.",
  },
  flow_map: {
    targetExposure: "default",
    fallbackExposure: "opt_in",
    thresholds: GRAPH_DEFAULT_THRESHOLDS,
    rationale: "flow_map can be broader exposure when it adds boundary-aware flow structure beyond a raw path without introducing noise.",
  },
  change_plan: {
    targetExposure: "opt_in",
    fallbackExposure: "not_promoted",
    thresholds: OPT_IN_THRESHOLDS,
    rationale: "change_plan remains an advisory graph-derived planning surface and should stay opt-in unless it stays consistently actionable.",
  },
  tenant_leak_audit: {
    targetExposure: "opt_in",
    fallbackExposure: "dark",
    thresholds: OPT_IN_THRESHOLDS,
    rationale: "tenant_leak_audit is high-risk and advisory-only, so even strong usefulness should keep it at most opt-in in this roadmap.",
  },
  session_handoff: {
    targetExposure: "opt_in",
    fallbackExposure: "dark",
    thresholds: OPT_IN_THRESHOLDS,
    rationale: "session_handoff is useful in operator-facing contexts, but should earn opt-in exposure with low-noise current-focus guidance first.",
  },
  health_trend: {
    targetExposure: "opt_in",
    fallbackExposure: "not_promoted",
    thresholds: OPT_IN_THRESHOLDS,
    rationale: "health_trend is derived and can be useful, but it should stay opt-in unless enough-history outputs consistently beat ad hoc project summary checks.",
  },
  issues_next: {
    targetExposure: "opt_in",
    fallbackExposure: "dark",
    thresholds: OPT_IN_THRESHOLDS,
    rationale: "issues_next is recommendation-shaped and should stay opt-in unless the ranked queue remains consistently actionable and low-noise.",
  },
  suggest: {
    targetExposure: "dark",
    fallbackExposure: "not_promoted",
    rationale: "suggest intentionally stays dark in Roadmap 6 even when useful, because it is planner-adjacent and should not broaden by default.",
  },
  investigate: {
    targetExposure: "opt_in",
    fallbackExposure: "dark",
    thresholds: OPT_IN_THRESHOLDS,
    rationale: "investigate can earn opt-in exposure if bounded multi-tool execution consistently helps more than one canonical workflow alone.",
  },
};

export function isPowerWorkflowToolName(toolName: string): toolName is PowerWorkflowToolName {
  return toolName in POWER_WORKFLOW_FAMILY_BY_TOOL;
}

export function powerWorkflowFamilyForTool(toolName: PowerWorkflowToolName): PowerWorkflowFamily {
  return POWER_WORKFLOW_FAMILY_BY_TOOL[toolName];
}

export function evaluatePowerWorkflowUsefulness(
  output: ToolOutput,
  options: { observedFollowupCount?: number } = {},
): PowerWorkflowUsefulnessEvaluation | null {
  if (!isPowerWorkflowToolName(output.toolName)) {
    return null;
  }

  const observedFollowupCount = Math.max(0, options.observedFollowupCount ?? 0);
  const toolName = output.toolName;
  const family = powerWorkflowFamilyForTool(toolName);
  const reasonCodes: PowerWorkflowUsefulnessReasonCode[] = [];
  let score = 0;

  switch (toolName) {
    case "graph_neighbors": {
      const result = (output as GraphNeighborsToolOutput).result;
      if (result.neighbors.length > 0) {
        reasonCodes.push("graph_results_present");
        score += 2;
      } else if ((result.suggestedStartEntities?.length ?? 0) > 0) {
        reasonCodes.push("start_entity_suggestions_present");
        score += 1;
      }
      if (result.neighbors.some((neighbor) => neighbor.containsHeuristicEdge)) {
        reasonCodes.push("heuristic_edge_used");
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
    case "graph_path": {
      const result = (output as GraphPathToolOutput).result;
      if (result.pathFound && result.hops.length > 0) {
        reasonCodes.push("path_found");
        score += 2;
        if (!result.containsHeuristicEdge) {
          reasonCodes.push("exact_path_found");
          score += 1;
        } else {
          reasonCodes.push("heuristic_edge_used");
        }
      } else if (result.noPathReason) {
        reasonCodes.push("no_path_reason_present");
        score += 1;
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
    case "flow_map": {
      const result = (output as FlowMapToolOutput).result;
      if (result.pathFound && result.steps.length > 0) {
        reasonCodes.push("flow_steps_present");
        score += 2;
        if (result.majorBoundaryKinds.length > 0) {
          reasonCodes.push("major_boundaries_present");
          score += 1;
        }
        if (result.containsHeuristicEdge) {
          reasonCodes.push("heuristic_edge_used");
        }
      } else if (result.noPathReason) {
        reasonCodes.push("no_path_reason_present");
        score += 1;
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
    case "change_plan": {
      const result = (output as ChangePlanToolOutput).result;
      if (result.pathFound && result.directSurfaces.length > 0) {
        reasonCodes.push("change_surfaces_present");
        score += 2;
        if (result.steps.length > 0) {
          reasonCodes.push("change_steps_present");
          score += 1;
        }
        if (result.recommendedFollowOn) {
          reasonCodes.push("follow_on_present");
          score += 1;
        }
        if (result.containsHeuristicEdge) {
          reasonCodes.push("heuristic_edge_used");
        }
      } else if (result.noPathReason) {
        reasonCodes.push("no_path_reason_present");
        score += 1;
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
    case "tenant_leak_audit": {
      const result = (output as TenantLeakAuditToolOutput).result;
      if (result.summary.directEvidenceCount > 0) {
        reasonCodes.push("tenant_direct_evidence_present");
        score += 2;
      } else if (result.summary.weakSignalCount > 0) {
        reasonCodes.push("tenant_weak_signal_present");
        score += 1;
      }
      if (result.summary.reviewedSurfaceCount > 0) {
        reasonCodes.push("reviewed_safe_surfaces_present");
        score += 1;
      }
      if (result.advisoryOnly) {
        reasonCodes.push("advisory_only");
        score += 1;
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
    case "session_handoff": {
      const result = (output as SessionHandoffToolOutput).result;
      if (result.currentFocus) {
        reasonCodes.push("current_focus_present");
        score += 2;
        if (result.currentFocus.stopWhen.length > 0) {
          reasonCodes.push("stop_conditions_present");
          score += 1;
        }
      } else if (result.recentQueries.length > 0) {
        reasonCodes.push("recent_queries_present");
        score += 1;
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
    case "health_trend": {
      const result = (output as HealthTrendToolOutput).result;
      if (result.summary.enoughHistory) {
        reasonCodes.push("trend_history_present");
        score += 2;
      } else {
        reasonCodes.push("insufficient_history_only");
        score += 1;
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
    case "issues_next": {
      const result = (output as IssuesNextToolOutput).result;
      if (result.currentIssue) {
        reasonCodes.push("current_issue_present");
        score += 2;
      }
      if (result.queuedIssues.length > 0) {
        reasonCodes.push("queued_issues_present");
        score += 1;
      }
      if (result.summary.truncatedQueuedCount > 0) {
        reasonCodes.push("queued_issues_truncated");
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
    case "suggest": {
      const result = (output as SuggestToolOutput).result;
      if (result.stopReason === "unsupported" || result.steps.length === 0) {
        reasonCodes.push("unsupported_result");
        break;
      }
      if (result.stopReason === "satisfied_by_canonical_tool") {
        reasonCodes.push("canonical_tool_selected");
        score += 2;
      } else {
        reasonCodes.push("bounded_sequence_suggested");
        score += 1;
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
    case "investigate": {
      const result = (output as InvestigateToolOutput).result;
      if (result.stopReason === "unsupported" || result.executedStepCount === 0) {
        reasonCodes.push("unsupported_result");
        break;
      }
      reasonCodes.push("executed_steps_present");
      score += 1;
      if (result.stopReason === "satisfied_by_canonical_tool") {
        reasonCodes.push("canonical_tool_selected");
        score += 2;
      } else if (result.stopReason === "bounded_investigation_completed") {
        reasonCodes.push("investigation_completed");
        score += 2;
      } else if (result.stopReason === "budget_exhausted") {
        reasonCodes.push("budget_exhausted");
        score += 1;
      }
      if (result.followOnHints.length > 0) {
        reasonCodes.push("follow_on_present");
        score += 1;
      }
      if (result.warnings.length > 0) {
        reasonCodes.push("warnings_present");
      }
      break;
    }
  }

  if (observedFollowupCount > 0) {
    reasonCodes.push("followup_action_taken");
  }

  const uniqueReasonCodes = [...new Set(reasonCodes)];
  const grade = gradePowerWorkflowUsefulness(score, observedFollowupCount);

  return {
    eligible: true,
    toolName,
    family,
    grade,
    reasonCodes:
      uniqueReasonCodes.length > 0
        ? uniqueReasonCodes
        : ["no_actionable_result"],
    observedFollowupCount,
  };
}

export function summarizePowerWorkflowPromotionMetrics(
  evaluations: readonly PowerWorkflowUsefulnessEvaluation[],
): PowerWorkflowPromotionMetrics[] {
  const grouped = new Map<PowerWorkflowToolName, PowerWorkflowUsefulnessEvaluation[]>();

  for (const evaluation of evaluations) {
    const existing = grouped.get(evaluation.toolName);
    if (existing) {
      existing.push(evaluation);
    } else {
      grouped.set(evaluation.toolName, [evaluation]);
    }
  }

  return [...grouped.entries()]
    .map(([toolName, items]) => {
      const family = items[0]!.family;
      const eligibleCount = items.filter((item) => item.eligible).length;
      const fullCount = items.filter((item) => item.grade === "full").length;
      const partialCount = items.filter((item) => item.grade === "partial").length;
      const noCount = items.filter((item) => item.grade === "no").length;
      const actualFollowupTakenCount = items.filter((item) => item.observedFollowupCount > 0).length;
      const lowNoiseCount = items.filter((item) => isLowNoiseEvaluation(item)).length;
      return {
        toolName,
        family,
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
        noNoiseRate:
          eligibleCount > 0 ? lowNoiseCount / eligibleCount : null,
      } satisfies PowerWorkflowPromotionMetrics;
    })
    .sort((left, right) => left.toolName.localeCompare(right.toolName));
}

export function shouldPromotePowerWorkflowExposure(
  metrics: PowerWorkflowPromotionMetrics,
  thresholds: PowerWorkflowPromotionThresholds,
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

export function decidePowerWorkflowExposure(
  metrics: PowerWorkflowPromotionMetrics,
): PowerWorkflowExposureDecision {
  const policy = POWER_WORKFLOW_EXPOSURE_POLICIES[metrics.toolName];
  let exposure: PowerWorkflowExposureState;
  let promotionPath: PowerWorkflowExposurePromotionPath;
  if (policy.thresholds == null) {
    exposure = policy.targetExposure;
    promotionPath = "policy_capped";
  } else if (shouldPromotePowerWorkflowExposure(metrics, policy.thresholds)) {
    exposure = policy.targetExposure;
    promotionPath = "target_met";
  } else {
    exposure = policy.fallbackExposure;
    promotionPath = "threshold_failed";
  }

  return {
    toolName: metrics.toolName,
    family: metrics.family,
    exposure,
    targetExposure: policy.targetExposure,
    fallbackExposure: policy.fallbackExposure,
    promotionPath,
    rationale: policy.rationale,
  };
}

function gradePowerWorkflowUsefulness(
  score: number,
  observedFollowupCount: number,
): PowerWorkflowUsefulnessGrade {
  if ((observedFollowupCount > 0 && score >= 2) || score >= 3) {
    return "full";
  }
  // Real follow-up only lifts the full boundary in this first slice.
  // Partial still requires at least one intrinsic usefulness signal.
  if (score >= 1) {
    return "partial";
  }
  return "no";
}

function isLowNoiseEvaluation(
  evaluation: PowerWorkflowUsefulnessEvaluation,
): boolean {
  return (
    evaluation.grade !== "no" &&
    !evaluation.reasonCodes.includes("warnings_present") &&
    !evaluation.reasonCodes.includes("unsupported_result") &&
    !evaluation.reasonCodes.includes("no_actionable_result")
  );
}
