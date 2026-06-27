import type {
  ContextPacketEvidenceQuality,
  ContextPacketGraphSummary,
  ContextPacketReadableCandidate,
  ContextPacketRequestCoverage,
  IndexFreshnessSummary,
  ProjectFreshnessGate,
} from "@mako-ai/contracts";

type GraphQuality = ContextPacketEvidenceQuality["graph"];

const GRAPH_REQUEST_PATTERN =
  /\b(dependency|dependencies|dependent|dependents|imports?|imported|importing|callers?|call[- ]?sites?|downstream|upstream|impact|where used|references?)\b|import graph/i;

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function numberMetadata(candidate: ContextPacketReadableCandidate, key: string): number | undefined {
  const value = candidate.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringMetadata(candidate: ContextPacketReadableCandidate, key: string): string | undefined {
  const value = candidate.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function candidateHasLiveOverlay(candidate: ContextPacketReadableCandidate): boolean {
  return stringMetadata(candidate, "overlay") === "working_tree" ||
    stringMetadata(candidate, "evidenceConfidenceLabel") === "verified_live";
}

function candidateFreshnessBucket(
  candidate: ContextPacketReadableCandidate,
): "fresh" | "dirty" | "unknown" {
  if (candidateHasLiveOverlay(candidate)) return "fresh";
  switch (candidate.freshness?.state) {
    case "fresh":
      return "fresh";
    case "stale":
    case "deleted":
    case "unindexed":
      return "dirty";
    case "unknown":
    default:
      return "unknown";
  }
}

function labelForScore(args: {
  score: number;
  totalContextCount: number;
  primaryContextCount: number;
  dirtyContextCount: number;
  changedFilesMissingOverlayCount: number;
  budgetExhausted: boolean;
  freshnessGateStatus: ProjectFreshnessGate["status"];
  requestCoverageStatus: ContextPacketRequestCoverage["status"];
  unresolvedRequestCount: number;
  graphStatus: GraphQuality["status"];
}): ContextPacketEvidenceQuality["label"] {
  if (args.totalContextCount === 0 || args.score < 0.35) return "weak";
  if (args.requestCoverageStatus === "missing" && args.unresolvedRequestCount > 0) return "weak";
  if (args.requestCoverageStatus === "partial" && args.unresolvedRequestCount > 0) return "partial";
  if (args.graphStatus === "missing") return "partial";
  if (args.graphStatus === "isolated") return "partial";
  if (
    args.score >= 0.78 &&
    args.primaryContextCount > 0 &&
    args.dirtyContextCount === 0 &&
    args.changedFilesMissingOverlayCount === 0 &&
    !args.budgetExhausted &&
    args.freshnessGateStatus !== "stale" &&
    args.freshnessGateStatus !== "degraded" &&
    (args.requestCoverageStatus === "complete" || args.requestCoverageStatus === "not_requested") &&
    (args.graphStatus === "connected" || args.graphStatus === "not_requested")
  ) {
    return "strong";
  }
  if (args.score >= 0.58 && args.primaryContextCount > 0) return "usable";
  return "partial";
}

function recommendedAction(args: {
  label: ContextPacketEvidenceQuality["label"];
  requestCoverageStatus: ContextPacketRequestCoverage["status"];
  unresolvedRequestCount: number;
  graphStatus: GraphQuality["status"];
}): string {
  if (args.unresolvedRequestCount > 0) {
    if (args.requestCoverageStatus === "missing") {
      return "Do not rely on this packet for the requested anchors until expandableTools or live_text_search resolve the missing coverage.";
    }
    return "Use expandableTools or live_text_search to resolve uncovered requested anchors before making broad changes.";
  }
  if (args.graphStatus === "missing") {
    return "Use graph expansion tools such as repo_map, imports_impact, or reef_where_used before making dependency or impact claims.";
  }
  if (args.graphStatus === "isolated") {
    return "Treat this as file-local context; run repo_map or imports_impact before making broader dependency or impact claims.";
  }
  switch (args.label) {
    case "strong":
      return "Use this packet as focused starting context; still read cited files before editing exact lines.";
    case "usable":
      return "Use this packet as starting context and verify exact lines or changed files before editing.";
    case "partial":
      return "Expand with suggested tools or live_text_search before making broad changes.";
    case "weak":
      return "Broaden the request or use reef_ask/live_text_search before relying on this packet.";
  }
}

function graphRequested(request: string): boolean {
  return GRAPH_REQUEST_PATTERN.test(request);
}

function assessGraphQuality(args: {
  request: string;
  graphSummary: ContextPacketGraphSummary;
}): GraphQuality {
  const requested = graphRequested(args.request);
  const connectedFileCount = args.graphSummary.dependencyFileCount +
    args.graphSummary.dependentFileCount +
    args.graphSummary.bidirectionalFileCount;
  const status: GraphQuality["status"] = !requested
    ? "not_requested"
    : args.graphSummary.returnedFileCount === 0 || args.graphSummary.anchorFiles.length === 0
      ? "missing"
      : args.graphSummary.edgeCount > 0 || connectedFileCount > 0
        ? "connected"
        : "isolated";

  return {
    status,
    requested,
    anchorFileCount: args.graphSummary.anchorFiles.length,
    returnedFileCount: args.graphSummary.returnedFileCount,
    edgeCount: args.graphSummary.edgeCount,
    connectedFileCount,
    warningCount: args.graphSummary.warnings.length,
  };
}

export function assessContextPacketEvidenceQuality(args: {
  request: string;
  primaryContext: readonly ContextPacketReadableCandidate[];
  relatedContext: readonly ContextPacketReadableCandidate[];
  graphSummary: ContextPacketGraphSummary;
  freshnessGate: ProjectFreshnessGate;
  indexFreshness: IndexFreshnessSummary;
  providersFailed: readonly string[];
  budgetExhausted: boolean;
  changedFilesMissingOverlayCount: number;
  requestCoverage: ContextPacketRequestCoverage;
}): ContextPacketEvidenceQuality {
  const allContext = [...args.primaryContext, ...args.relatedContext];
  const totalContextCount = allContext.length;
  const primaryContextCount = args.primaryContext.length;
  const relatedContextCount = args.relatedContext.length;
  const liveOverlayContextCount = allContext.filter(candidateHasLiveOverlay).length;
  const corroboratedContextCount = allContext.filter((candidate) =>
    (numberMetadata(candidate, "corroboratedSignalCount") ?? 0) >= 2
  ).length;
  const highConfidenceContextCount = allContext.filter((candidate) => candidate.confidence >= 0.75).length;
  const averageConfidence = totalContextCount === 0
    ? 0
    : allContext.reduce((sum, candidate) => sum + candidate.confidence, 0) / totalContextCount;
  const freshnessBuckets = allContext.map(candidateFreshnessBucket);
  const freshContextCount = freshnessBuckets.filter((bucket) => bucket === "fresh").length;
  const staleContextCount = freshnessBuckets.filter((bucket) => bucket === "dirty").length;
  const unknownFreshnessCount = freshnessBuckets.filter((bucket) => bucket === "unknown").length;
  const dirtyContextCount = staleContextCount + unknownFreshnessCount;
  const contextCoverage = primaryContextCount > 0
    ? Math.min(1, primaryContextCount / 4)
    : relatedContextCount > 0
      ? 0.35
      : 0;
  const freshRatio = totalContextCount === 0 ? 0 : freshContextCount / totalContextCount;
  const staleRatio = totalContextCount === 0 ? 0 : staleContextCount / totalContextCount;
  const unknownRatio = totalContextCount === 0 ? 0 : unknownFreshnessCount / totalContextCount;
  const highConfidenceRatio = totalContextCount === 0 ? 0 : highConfidenceContextCount / totalContextCount;
  const corroborationRatio = totalContextCount === 0
    ? 0
    : Math.min(1, corroboratedContextCount / Math.max(1, Math.ceil(totalContextCount / 2)));
  const gatePenalty = args.freshnessGate.status === "degraded"
    ? 0.18
    : args.freshnessGate.status === "stale"
      ? 0.12
      : 0;
  const indexPenalty = args.indexFreshness.state === "fresh" ? 0 : 0.1;
  const providerPenalty = Math.min(0.15, args.providersFailed.length * 0.05);
  const overlayPenalty = Math.min(0.12, args.changedFilesMissingOverlayCount * 0.04);
  const budgetPenalty = args.budgetExhausted ? 0.05 : 0;
  const unresolvedRequestCount = args.requestCoverage.uncoveredCount + args.requestCoverage.notCheckedCount;
  const coveragePenalty = args.requestCoverage.status === "missing"
    ? 0.32
    : args.requestCoverage.status === "partial"
      ? Math.min(0.24, 0.12 + unresolvedRequestCount * 0.04)
      : 0;
  const graph = assessGraphQuality({
    request: args.request,
    graphSummary: args.graphSummary,
  });
  const graphPenalty = graph.status === "missing"
    ? 0.24
    : graph.status === "isolated"
      ? 0.18
      : 0;

  const score = clamp01(
    contextCoverage * 0.35 +
    averageConfidence * 0.3 +
    freshRatio * 0.2 +
    highConfidenceRatio * 0.1 +
    corroborationRatio * 0.05 -
    staleRatio * 0.35 -
    unknownRatio * 0.1 -
    gatePenalty -
    indexPenalty -
    providerPenalty -
    overlayPenalty -
    budgetPenalty -
    coveragePenalty -
    graphPenalty,
  );
  const roundedScore = round4(score);
  const label = labelForScore({
    score: roundedScore,
    totalContextCount,
    primaryContextCount,
    dirtyContextCount,
    changedFilesMissingOverlayCount: args.changedFilesMissingOverlayCount,
    budgetExhausted: args.budgetExhausted,
    freshnessGateStatus: args.freshnessGate.status,
    requestCoverageStatus: args.requestCoverage.status,
    unresolvedRequestCount,
    graphStatus: graph.status,
  });

  const reasons: string[] = [];
  if (totalContextCount === 0) {
    reasons.push("No deterministic context candidates matched the request.");
  } else {
    reasons.push(`${primaryContextCount} primary and ${relatedContextCount} related context item(s) returned.`);
    reasons.push(`${freshContextCount}/${totalContextCount} context item(s) have fresh indexed or live-overlay evidence.`);
  }
  if (highConfidenceContextCount > 0) {
    reasons.push(`${highConfidenceContextCount} context item(s) are high confidence.`);
  }
  if (corroboratedContextCount > 0) {
    reasons.push(`${corroboratedContextCount} context item(s) have corroborating provider signals.`);
  }
  if (args.changedFilesMissingOverlayCount > 0) {
    reasons.push(`${args.changedFilesMissingOverlayCount} changed file(s) lack working-tree overlay facts.`);
  }
  if (unresolvedRequestCount > 0) {
    reasons.push(`${unresolvedRequestCount}/${args.requestCoverage.requestedCount} requested anchor(s) are uncovered or unchecked.`);
  }
  if (graph.status === "missing") {
    reasons.push("Dependency/impact-style request has no graph anchors or returned graph evidence.");
  } else if (graph.status === "isolated") {
    reasons.push("Dependency/impact-style request only returned isolated graph evidence with no connected dependency edges.");
  }
  if (args.budgetExhausted) {
    reasons.push("Context was truncated by the token budget.");
  }
  if (args.providersFailed.length > 0) {
    reasons.push(`${args.providersFailed.length} provider(s) failed while building the packet.`);
  }
  if (args.indexFreshness.state !== "fresh") {
    reasons.push(`Indexed evidence freshness is ${args.indexFreshness.state}.`);
  }
  if (args.freshnessGate.status === "stale" || args.freshnessGate.status === "degraded") {
    reasons.push(`Project freshness gate is ${args.freshnessGate.status}.`);
  }

  return {
    label,
    score: roundedScore,
    reasons,
    recommendedAction: recommendedAction({
      label,
      requestCoverageStatus: args.requestCoverage.status,
      unresolvedRequestCount,
      graphStatus: graph.status,
    }),
    primaryContextCount,
    relatedContextCount,
    totalContextCount,
    freshContextCount,
    staleContextCount,
    unknownFreshnessCount,
    liveOverlayContextCount,
    corroboratedContextCount,
    highConfidenceContextCount,
    averageConfidence: round4(averageConfidence),
    freshness: {
      gateStatus: args.freshnessGate.status,
      indexState: args.indexFreshness.state,
      dirtyContextCount,
    },
    requestCoverage: {
      status: args.requestCoverage.status,
      requestedCount: args.requestCoverage.requestedCount,
      coveredCount: args.requestCoverage.coveredCount,
      unresolvedCount: unresolvedRequestCount,
      uncoveredCount: args.requestCoverage.uncoveredCount,
      notCheckedCount: args.requestCoverage.notCheckedCount,
    },
    graph,
  };
}
