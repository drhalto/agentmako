import type {
  ContextPacketEvidenceQuality,
  ContextPacketExpandableTool,
  ContextPacketIntent,
  ContextPacketLiveTextMiss,
  ContextPacketMode,
  ContextPacketOmittedRequestedAnchor,
  ContextPacketProviderRunDetail,
  ContextPacketProviderSkipDetail,
  ContextPacketRequestCoverage,
  ContextPacketRetrievalDiagnostics,
  ContextPacketRetrievalPlan,
  ToolName,
} from "@mako-ai/contracts";

type GraphQuality = ContextPacketEvidenceQuality["graph"];

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function isDebugFamily(family: ContextPacketIntent["primaryFamily"]): boolean {
  return family.startsWith("debug_");
}

function omittedAnchorTool(anchor: ContextPacketOmittedRequestedAnchor): ToolName {
  switch (anchor.kind) {
    case "file":
      return "cross_search";
    case "symbol":
      return "reef_where_used";
    case "route":
      return "route_context";
    case "database_object":
      return "table_neighborhood";
  }
}

function omittedAnchorTools(anchors: readonly ContextPacketOmittedRequestedAnchor[]): ToolName[] {
  return uniqueStrings(anchors.map(omittedAnchorTool)) as ToolName[];
}

function omittedAnchorSummary(anchors: readonly ContextPacketOmittedRequestedAnchor[]): string | undefined {
  if (anchors.length === 0) return undefined;
  const preview = anchors
    .slice(0, 4)
    .map((anchor) => `${anchor.kind}:${anchor.value}`)
    .join(", ");
  return anchors.length > 4 ? `${preview}, +${anchors.length - 4} more` : preview;
}

function compactOmittedAnchors(
  anchors: readonly ContextPacketOmittedRequestedAnchor[],
): ContextPacketOmittedRequestedAnchor[] | undefined {
  return anchors.length > 0 ? anchors.slice(0, 6).map((anchor) => ({ ...anchor })) : undefined;
}

function recommendedToolsForPlan(args: {
  level: ContextPacketRetrievalPlan["level"];
  strategy: ContextPacketRetrievalPlan["strategy"];
  requestCoverage: ContextPacketRequestCoverage;
  graphQuality: GraphQuality;
  expandableTools: readonly ContextPacketExpandableTool[];
  omittedRequestedAnchors: readonly ContextPacketOmittedRequestedAnchor[];
}): ToolName[] {
  const available = new Set(args.expandableTools.map((tool) => tool.toolName));
  const out: ToolName[] = [];
  const add = (toolName: ToolName): void => {
    if (available.has(toolName) && !out.includes(toolName)) out.push(toolName);
  };
  const addMany = (toolNames: readonly ToolName[]): void => {
    for (const toolName of toolNames) add(toolName);
  };

  if (available.has("tool_batch")) add("tool_batch");
  addMany(omittedAnchorTools(args.omittedRequestedAnchors));
  if (args.requestCoverage.status === "missing" || args.requestCoverage.status === "partial") {
    addMany(["live_text_search", "reef_where_used", "route_context", "table_neighborhood", "repo_map"]);
  }
  if (args.graphQuality.status === "missing" || args.graphQuality.status === "isolated") {
    addMany(["imports_deps", "imports_impact", "repo_map", "reef_where_used"]);
  }

  if (args.level === "broader_context_retrieval") {
    addMany(["imports_deps", "imports_impact", "repo_map", "reef_where_used", "change_plan"]);
  } else if (args.level === "issue_to_edit_localization") {
    addMany(["reef_where_used", "route_context", "change_plan", "verification_state", "lint_files", "live_text_search"]);
  } else if (args.strategy === "literal_search") {
    addMany(["live_text_search", "ast_find_pattern", "reef_where_used"]);
  } else {
    addMany(["reef_where_used", "live_text_search", "repo_map", "evidence_confidence"]);
  }

  return out.slice(0, 6);
}

function recommendedFollowUpsForPlan(args: {
  recommendedTools: readonly ToolName[];
  expandableTools: readonly ContextPacketExpandableTool[];
}): ContextPacketExpandableTool[] {
  const usedIndexes = new Set<number>();
  const out: ContextPacketExpandableTool[] = [];
  for (const toolName of args.recommendedTools) {
    const index = args.expandableTools.findIndex((tool, candidateIndex) =>
      !usedIndexes.has(candidateIndex) && tool.toolName === toolName
    );
    if (index < 0) continue;
    usedIndexes.add(index);
    const tool = args.expandableTools[index];
    if (!tool) continue;
    out.push({
      toolName: tool.toolName,
      suggestedArgs: { ...tool.suggestedArgs },
      reason: tool.reason,
      whenToUse: tool.whenToUse,
      readOnly: tool.readOnly,
    });
  }
  return out.slice(0, 6);
}

function recommendedToolsForGap(
  recommendedTools: readonly ToolName[],
  preferredTools: readonly ToolName[],
): ToolName[] {
  return preferredTools.filter((toolName) => recommendedTools.includes(toolName)).slice(0, 4);
}

function evidenceGapsForPlan(args: {
  level: ContextPacketRetrievalPlan["level"];
  strategy: ContextPacketRetrievalPlan["strategy"];
  mode: ContextPacketMode;
  requestCoverage: ContextPacketRequestCoverage;
  graphQuality: GraphQuality;
  totalContextCount: number;
  providerRunCount: number;
  providerCandidateCount: number;
  zeroCandidateProviderCount: number;
  recommendedTools: readonly ToolName[];
  recommendedFollowUpCount: number;
  liveTextMissCount: number;
  symbolLiveTextMissCount: number;
  scopedLiveTextMissCount: number;
  scopedSymbolLiveTextMissCount: number;
  budgetExhausted: boolean;
  selectionLimitHit: boolean;
  candidatesOmittedByLimit: number;
  requestedAnchorsOmitted: number;
  omittedRequestedAnchors: readonly ContextPacketOmittedRequestedAnchor[];
  supportingSignalsOmitted: number;
}): ContextPacketRetrievalPlan["evidenceGaps"] {
  const gaps: ContextPacketRetrievalPlan["evidenceGaps"] = [];
  const editMode = args.mode === "implement" || args.mode === "review" || args.level === "issue_to_edit_localization";
  const addGap = (
    gap: ContextPacketRetrievalPlan["evidenceGaps"][number],
  ): void => {
    if (
      gaps.some((existing) =>
        existing.kind === gap.kind &&
        existing.severity === gap.severity &&
        existing.message === gap.message
      )
    ) {
      return;
    }
    gaps.push(gap);
  };

  if (args.totalContextCount === 0) {
    addGap({
      kind: "provider_recall",
      severity: "blocking",
      message: "No deterministic context was returned in this packet.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "live_text_search", "repo_map", "reef_where_used"],
      ),
    });
  }

  if (args.requestCoverage.status === "missing" || args.requestCoverage.status === "partial") {
    addGap({
      kind: "request_coverage",
      severity: "blocking",
      message: "Requested anchors are unresolved or only partially covered.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "live_text_search", "reef_where_used", "route_context", "table_neighborhood", "repo_map"],
      ),
    });
  }

  if (args.graphQuality.requested && args.graphQuality.status === "missing") {
    addGap({
      kind: "graph_evidence",
      // With no resolved anchor there is nothing to hang a graph on — the
      // actionable problem is the unresolved anchors (request_coverage), so
      // the graph gap must not also block the packet.
      severity: args.graphQuality.anchorFileCount > 0 ? "blocking" : "advisory",
      message: "Dependency or impact evidence was requested but no graph evidence was returned.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "imports_deps", "imports_impact", "repo_map", "reef_where_used"],
      ),
    });
  } else if (args.graphQuality.requested && args.graphQuality.status === "isolated") {
    addGap({
      kind: "graph_evidence",
      severity: "blocking",
      message: "Dependency or impact evidence is only file-local or isolated.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "imports_deps", "imports_impact", "repo_map", "reef_where_used"],
      ),
    });
  }

  if (args.liveTextMissCount > 0) {
    const symbolMiss = args.symbolLiveTextMissCount > 0;
    const scopedMiss = args.scopedLiveTextMissCount > 0;
    let message = "A quoted literal was not found on the current filesystem.";
    if (args.scopedSymbolLiveTextMissCount > 0) {
      message = "A requested symbol was not found in scoped current files.";
    } else if (symbolMiss) {
      message = "A requested symbol was not found on the current filesystem.";
    } else if (scopedMiss) {
      message = "A quoted literal was not found in scoped current files.";
    }
    addGap({
      kind: "literal_evidence",
      severity: scopedMiss || args.strategy === "literal_search" ? "blocking" : "advisory",
      message,
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "live_text_search", "ast_find_pattern", "reef_where_used"],
      ),
    });
  }

  if (editMode && args.providerCandidateCount === 0) {
    addGap({
      kind: "edit_localization",
      severity: "blocking",
      message: "No retrieval providers produced edit-localization candidates.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "live_text_search", "repo_map", "reef_where_used"],
      ),
    });
  } else if (editMode && args.recommendedFollowUpCount > 0) {
    addGap({
      kind: "edit_localization",
      severity: "advisory",
      message: "Edit or review work should run impact, where-used, literal, or diagnostic follow-ups before final claims.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "reef_where_used", "route_context", "change_plan", "verification_state", "lint_files", "live_text_search"],
      ),
    });
  }

  if (args.level === "broader_context_retrieval" && args.recommendedFollowUpCount > 0) {
    addGap({
      kind: "graph_evidence",
      severity: "advisory",
      message: "Broader repository claims should run the recommended graph or where-used follow-ups first.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "imports_deps", "imports_impact", "repo_map", "reef_where_used"],
      ),
    });
  }

  if (args.graphQuality.requested && args.graphQuality.warningCount > 0) {
    addGap({
      kind: "graph_evidence",
      severity: "advisory",
      message: "Graph evidence is warning-labeled or bounded; do not treat returned graph context as exhaustive.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "imports_deps", "imports_impact", "repo_map", "reef_where_used"],
      ),
    });
  }

  if (
    args.requestCoverage.status === "not_requested" &&
    args.graphQuality.status === "not_requested" &&
    args.totalContextCount > 0
  ) {
    addGap({
      kind: "exact_line_verification",
      severity: "advisory",
      message: "Packet evidence covers the request shape; verify exact lines before finalizing.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["live_text_search", "ast_find_pattern", "reef_where_used"],
      ),
    });
  }

  if (args.providerRunCount > 0 && args.zeroCandidateProviderCount >= Math.max(3, Math.ceil(args.providerRunCount / 2))) {
    addGap({
      kind: "provider_recall",
      severity: "advisory",
      message: "Several providers returned no candidates; narrower anchors or quoted literals may improve recall.",
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "live_text_search", "repo_map", "reef_where_used"],
      ),
    });
  }

  if (args.budgetExhausted) {
    addGap({
      kind: "context_budget",
      severity: "advisory",
      message: "Context was budget-truncated; increase budgetTokens or narrow the request to inspect more candidates.",
      recommendedTools: recommendedToolsForGap(args.recommendedTools, ["tool_batch", "repo_map"]),
    });
  }

  if (args.selectionLimitHit) {
    addGap({
      kind: "context_budget",
      severity: "advisory",
      message:
        `${args.candidatesOmittedByLimit} ranked candidate(s) were omitted by maxPrimaryContext/maxRelatedContext limits.`,
      recommendedTools: recommendedToolsForGap(args.recommendedTools, ["tool_batch", "repo_map", "reef_where_used"]),
    });
  }

  if (args.requestedAnchorsOmitted > 0) {
    const anchorSummary = omittedAnchorSummary(args.omittedRequestedAnchors);
    const omittedTools = omittedAnchorTools(args.omittedRequestedAnchors);
    const anchors = compactOmittedAnchors(args.omittedRequestedAnchors);
    addGap({
      kind: "context_budget",
      severity: "blocking",
      message:
        `${args.requestedAnchorsOmitted} requested anchor(s) were ranked but omitted from returned context${
          anchorSummary ? `: ${anchorSummary}.` : "."
        }`,
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", ...omittedTools, "reef_where_used", "route_context", "table_neighborhood", "cross_search", "repo_map", "live_text_search"],
      ),
      ...(anchors ? { anchors } : {}),
    });
  }

  if (args.supportingSignalsOmitted > 0) {
    addGap({
      kind: "context_budget",
      severity: "advisory",
      message:
        `${args.supportingSignalsOmitted} supporting signal(s) were omitted to keep returned context within budget.`,
      recommendedTools: recommendedToolsForGap(
        args.recommendedTools,
        ["tool_batch", "reef_where_used", "repo_map", "live_text_search"],
      ),
    });
  }

  return gaps;
}

// The evidence gate is a thin projection of `evidenceGaps` so the two can never
// disagree: status follows directly from gap severities, and the gate's reasons
// are the gap messages. Previously this re-encoded the entire gap condition
// ladder by hand and had already drifted (the gate ignored live-text / provider
// signals the gaps used), so a packet could report a "satisfied" gate alongside
// a blocking gap. Deriving from the gaps removes that whole class of bug.
function evidenceGateFromGaps(
  gaps: ContextPacketRetrievalPlan["evidenceGaps"],
  editMode: boolean,
): ContextPacketRetrievalPlan["evidenceGate"] {
  const blockingReasons = uniqueStrings(
    gaps.filter((gap) => gap.severity === "blocking").map((gap) => gap.message),
  );
  const advisoryReasons = uniqueStrings(
    gaps.filter((gap) => gap.severity === "advisory").map((gap) => gap.message),
  );
  const status: ContextPacketRetrievalPlan["evidenceGate"]["status"] = blockingReasons.length > 0
    ? "follow_up_required"
    : advisoryReasons.length > 0
      ? "follow_up_recommended"
      : "satisfied";

  return {
    status,
    canAnswerFromPacket: status !== "follow_up_required",
    canEditFromPacket: editMode && status === "satisfied",
    blockingReasons,
    advisoryReasons,
  };
}

function buildRetrievalPlan(args: {
  mode: ContextPacketMode;
  intent: ContextPacketIntent;
  requestCoverage: ContextPacketRequestCoverage;
  graphQuality: GraphQuality;
  changedFileCount: number;
  focusFileCount: number;
  providerCandidateCount: number;
  totalContextCount: number;
  expandableTools: readonly ContextPacketExpandableTool[];
  providerRunCount: number;
  zeroCandidateProviderCount: number;
  liveTextMissCount: number;
  symbolLiveTextMissCount: number;
  scopedLiveTextMissCount: number;
  scopedSymbolLiveTextMissCount: number;
  budgetExhausted: boolean;
  selectionLimitHit: boolean;
  candidatesOmittedByLimit: number;
  requestedAnchorsOmitted: number;
  omittedRequestedAnchors: readonly ContextPacketOmittedRequestedAnchor[];
  supportingSignalsOmitted: number;
}): ContextPacketRetrievalPlan {
  const signals: string[] = [
    `mode:${args.mode}`,
    `intent:${args.intent.primaryFamily}`,
  ];
  const entityCount =
    args.intent.entities.files.length +
    args.intent.entities.symbols.length +
    args.intent.entities.routes.length +
    args.intent.entities.databaseObjects.length;
  const quotedTextCount = args.intent.entities.quotedText.length;

  if (args.changedFileCount > 0) signals.push(`changed_files:${args.changedFileCount}`);
  if (args.focusFileCount > 0) signals.push(`focus_files:${args.focusFileCount}`);
  if (entityCount > 0) signals.push(`explicit_entities:${entityCount}`);
  if (quotedTextCount > 0) signals.push(`quoted_text:${quotedTextCount}`);
  if (args.graphQuality.requested) signals.push(`graph:${args.graphQuality.status}`);
  if (args.graphQuality.requested && args.graphQuality.warningCount > 0) {
    signals.push(`graph_warnings:${args.graphQuality.warningCount}`);
  }
  if (args.requestCoverage.status !== "not_requested") signals.push(`coverage:${args.requestCoverage.status}`);
  if (args.budgetExhausted) signals.push("budget_exhausted");
  if (args.selectionLimitHit) signals.push(`selection_limit_omitted:${args.candidatesOmittedByLimit}`);
  if (args.requestedAnchorsOmitted > 0) signals.push(`requested_anchors_omitted:${args.requestedAnchorsOmitted}`);
  if (args.supportingSignalsOmitted > 0) signals.push(`supporting_signals_omitted:${args.supportingSignalsOmitted}`);

  const level: ContextPacketRetrievalPlan["level"] =
    args.graphQuality.requested || args.intent.primaryFamily === "find_precedent"
      ? "broader_context_retrieval"
      : args.mode === "implement" ||
          args.mode === "review" ||
          args.changedFileCount > 0 ||
          args.focusFileCount > 0 ||
          args.intent.primaryFamily === "implement_feature" ||
          args.intent.primaryFamily === "review_change" ||
          (isDebugFamily(args.intent.primaryFamily) && entityCount > 0 && quotedTextCount === 0)
        ? "issue_to_edit_localization"
        : "code_understanding";

  const strategy: ContextPacketRetrievalPlan["strategy"] =
    args.graphQuality.requested || level === "broader_context_retrieval"
      ? "graph_expansion"
      : quotedTextCount > 0 && entityCount === 0
        ? "literal_search"
        : quotedTextCount > 0 && entityCount > 0
          ? "hybrid"
          : entityCount > 0 || args.focusFileCount > 0 || args.changedFileCount > 0
            ? "entity_lookup"
            : "hybrid";

  const requiredEvidence: string[] = [];
  if (level === "code_understanding") {
    requiredEvidence.push("matching definitions, exact literals, or local file context");
  } else if (level === "issue_to_edit_localization") {
    requiredEvidence.push("target file or changed file evidence");
    requiredEvidence.push("callers, routes, schema usage, or where-used context for blast radius");
    requiredEvidence.push("fresh diagnostics before claiming the fix is verified");
  } else {
    requiredEvidence.push("dependency graph or where-used evidence");
    requiredEvidence.push("representative precedent files or related routes");
    requiredEvidence.push("bounded follow-up expansion before broad repository claims");
  }
  if (quotedTextCount > 0) requiredEvidence.push("current filesystem literal evidence");
  if (args.intent.primaryFamily === "debug_database_usage") requiredEvidence.push("schema, RLS, or RPC evidence");
  if (args.intent.primaryFamily === "debug_auth_state" || args.intent.primaryFamily === "debug_route") {
    requiredEvidence.push("auth, route, or request-boundary evidence");
  }

  const nextStep = args.requestedAnchorsOmitted > 0
    ? "Inspect omitted requested anchors with anchor-specific follow-ups or higher context limits before relying on packet-only claims."
    : args.requestCoverage.status === "missing" || args.requestCoverage.status === "partial"
      ? "Resolve uncovered requested anchors with expandableTools or live_text_search before relying on broad claims."
      : args.graphQuality.requested && args.graphQuality.status !== "connected"
        ? "Run graph follow-up tools to prove dependency or impact reach before making graph claims."
        : args.budgetExhausted
          ? "Increase budgetTokens or narrow the request, then inspect the additional ranked candidates before broad claims."
          : args.selectionLimitHit
            ? "Raise maxPrimaryContext/maxRelatedContext or use follow-ups to inspect omitted ranked candidates before broad claims."
            : args.supportingSignalsOmitted > 0
              ? "Use recommended follow-ups for full provenance before relying on compacted supporting evidence."
              : level === "broader_context_retrieval"
                ? "Use graph and where-used follow-ups, then read representative files before summarizing repository-wide behavior."
                : level === "issue_to_edit_localization"
                  ? "Read the target files, then use impact and diagnostic follow-ups before editing or reviewing."
                  : "Read the top primary context and verify exact lines before answering.";

  const truncationPenalty =
    (args.budgetExhausted ? 0.05 : 0) +
    (args.selectionLimitHit ? 0.04 : 0) +
    Math.min(0.18, args.requestedAnchorsOmitted * 0.08) +
    Math.min(0.06, args.supportingSignalsOmitted * 0.02);
  const confidence = round4(clamp01(
    0.42 +
    Math.min(0.22, signals.length * 0.035) +
    (entityCount > 0 || args.focusFileCount > 0 || args.changedFileCount > 0 ? 0.12 : 0) +
    (args.providerCandidateCount > 0 ? 0.1 : 0) +
    (args.totalContextCount > 0 ? 0.08 : 0) +
    (args.requestCoverage.status === "complete" || args.requestCoverage.status === "not_requested" ? 0.06 : -0.08) +
    (args.graphQuality.requested && args.graphQuality.status === "connected" ? 0.04 : 0) -
    (args.graphQuality.requested ? Math.min(0.08, args.graphQuality.warningCount * 0.02) : 0) -
    truncationPenalty,
  ));

  const recommendedTools = recommendedToolsForPlan({
    level,
    strategy,
    requestCoverage: args.requestCoverage,
    graphQuality: args.graphQuality,
    expandableTools: args.expandableTools,
    omittedRequestedAnchors: args.omittedRequestedAnchors,
  });
  const recommendedFollowUps = recommendedFollowUpsForPlan({
    recommendedTools,
    expandableTools: args.expandableTools,
  });
  const evidenceGaps = evidenceGapsForPlan({
    level,
    strategy,
    mode: args.mode,
    requestCoverage: args.requestCoverage,
    graphQuality: args.graphQuality,
    totalContextCount: args.totalContextCount,
    providerRunCount: args.providerRunCount,
    providerCandidateCount: args.providerCandidateCount,
    zeroCandidateProviderCount: args.zeroCandidateProviderCount,
    recommendedTools,
    recommendedFollowUpCount: recommendedFollowUps.length,
    liveTextMissCount: args.liveTextMissCount,
    symbolLiveTextMissCount: args.symbolLiveTextMissCount,
    scopedLiveTextMissCount: args.scopedLiveTextMissCount,
    scopedSymbolLiveTextMissCount: args.scopedSymbolLiveTextMissCount,
    budgetExhausted: args.budgetExhausted,
    selectionLimitHit: args.selectionLimitHit,
    candidatesOmittedByLimit: args.candidatesOmittedByLimit,
    requestedAnchorsOmitted: args.requestedAnchorsOmitted,
    omittedRequestedAnchors: args.omittedRequestedAnchors,
    supportingSignalsOmitted: args.supportingSignalsOmitted,
  });
  const editMode =
    args.mode === "implement" || args.mode === "review" || level === "issue_to_edit_localization";

  return {
    level,
    strategy,
    confidence,
    signals: uniqueStrings(signals),
    evidenceGate: evidenceGateFromGaps(evidenceGaps, editMode),
    evidenceGaps,
    requiredEvidence: uniqueStrings(requiredEvidence),
    recommendedTools,
    recommendedFollowUps,
    nextStep,
  };
}

export function buildContextPacketRetrievalDiagnostics(args: {
  mode: ContextPacketMode;
  intent: ContextPacketIntent;
  requestCoverage: ContextPacketRequestCoverage;
  graphQuality: GraphQuality;
  changedFileCount: number;
  focusFileCount: number;
  expandableTools: readonly ContextPacketExpandableTool[];
  providerRunDetails: readonly ContextPacketProviderRunDetail[];
  providersFailed: readonly string[];
  providersSkippedDetail: readonly ContextPacketProviderSkipDetail[];
  liveTextMisses: readonly ContextPacketLiveTextMiss[];
  totalContextCount: number;
  budgetExhausted: boolean;
  selectionLimitHit: boolean;
  candidatesOmittedByLimit: number;
  requestedAnchorsOmitted: number;
  omittedRequestedAnchors?: readonly ContextPacketOmittedRequestedAnchor[];
  supportingSignalsOmitted: number;
}): ContextPacketRetrievalDiagnostics {
  const providerRunCount = args.providerRunDetails.length;
  const providerCandidateCount = args.providerRunDetails.reduce(
    (sum, detail) => sum + detail.candidateCount,
    0,
  );
  const totalProviderDurationMs = args.providerRunDetails.reduce(
    (sum, detail) => sum + detail.durationMs,
    0,
  );
  const zeroCandidateProviders = uniqueStrings(
    args.providerRunDetails
      .filter((detail) => detail.status === "success" && detail.candidateCount === 0)
      .map((detail) => detail.provider),
  );
  const failedProviders = uniqueStrings([
    ...args.providersFailed,
    ...args.providerRunDetails
      .filter((detail) => detail.status === "failed")
      .map((detail) => detail.provider),
  ]);
  const adaptiveSkippedProviders = uniqueStrings(
    args.providersSkippedDetail
      .filter((detail) => detail.adaptive)
      .map((detail) => detail.provider),
  );
  const slowestProvider = [...args.providerRunDetails]
    .sort((left, right) => right.durationMs - left.durationMs || right.candidateCount - left.candidateCount)
    .at(0);

  const recommendations: string[] = [];
  if (failedProviders.length > 0) {
    recommendations.push("Review provider warnings before relying on missing evidence from failed retrieval lanes.");
  }
  const symbolLiveTextMisses = args.liveTextMisses.filter((miss) => miss.queryKind === "symbol");
  const quotedLiveTextMisses = args.liveTextMisses.filter((miss) => (miss.queryKind ?? "quoted_text") === "quoted_text");
  const scopedSymbolLiveTextMisses = symbolLiveTextMisses.filter((miss) => miss.scope === "file");
  const scopedQuotedLiveTextMisses = quotedLiveTextMisses.filter((miss) => miss.scope === "file");
  const scopedLiveTextMisses = args.liveTextMisses.filter((miss) => miss.scope === "file");
  if (scopedSymbolLiveTextMisses.length > 0) {
    recommendations.push("Focused symbol was not found in scoped current files; verify rename/deletion or run reef_where_used before trusting indexed references.");
  } else if (scopedQuotedLiveTextMisses.length > 0) {
    recommendations.push("Quoted literal was not found in scoped current files; verify spelling/case or broaden live_text_search.");
  } else if (symbolLiveTextMisses.length > 0) {
    recommendations.push("Requested symbol was not found on the current filesystem; verify rename/deletion or search related terms.");
  } else if (quotedLiveTextMisses.length > 0) {
    recommendations.push("Quoted literal was not found on the current filesystem; verify spelling/case or search related terms.");
  }
  if (args.totalContextCount === 0 && providerRunCount > 0 && providerCandidateCount === 0) {
    recommendations.push("All executed providers returned zero candidates; add focusFiles/focusSymbols or search exact text with live_text_search.");
  } else if (zeroCandidateProviders.length >= Math.max(3, Math.ceil(providerRunCount / 2))) {
    recommendations.push("Several providers returned no candidates; narrower anchors or quoted literals may improve recall.");
  }
  if (adaptiveSkippedProviders.length > 0) {
    recommendations.push("Adaptive routing narrowed retrieval; use expandableTools if broader context is needed.");
  }
  if (slowestProvider && slowestProvider.durationMs >= 250) {
    recommendations.push(`Provider ${slowestProvider.provider} dominated retrieval time; use focus anchors to reduce broad scans.`);
  }
  if (providerRunCount > 1 && totalProviderDurationMs >= 750) {
    recommendations.push("Retrieval providers run serially on the shared store; inspect slowestProvider and narrow anchors before adding broader provider work.");
  }
  if (args.budgetExhausted) {
    recommendations.push("Context was budget-truncated; increase budgetTokens or narrow the request to inspect more candidates.");
  }
  if (args.selectionLimitHit) {
    recommendations.push("Context hit maxPrimaryContext/maxRelatedContext limits; raise limits or use follow-ups to inspect omitted ranked candidates.");
  }
  if (args.requestedAnchorsOmitted > 0) {
    recommendations.push("Some requested anchors were ranked but omitted; raise context limits or use anchor-specific follow-ups before relying on coverage.");
  }
  if (args.supportingSignalsOmitted > 0) {
    recommendations.push("Some supporting provider signals were compacted out by budget; use recommended follow-ups for full provenance.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Provider coverage looks healthy; read cited files before editing exact lines.");
  }

  return {
    retrievalPlan: buildRetrievalPlan({
      mode: args.mode,
      intent: args.intent,
      requestCoverage: args.requestCoverage,
      graphQuality: args.graphQuality,
      changedFileCount: args.changedFileCount,
      focusFileCount: args.focusFileCount,
      providerCandidateCount,
      totalContextCount: args.totalContextCount,
      expandableTools: args.expandableTools,
      providerRunCount,
      zeroCandidateProviderCount: zeroCandidateProviders.length,
      liveTextMissCount: args.liveTextMisses.length,
      symbolLiveTextMissCount: symbolLiveTextMisses.length,
      scopedLiveTextMissCount: scopedLiveTextMisses.length,
      scopedSymbolLiveTextMissCount: scopedSymbolLiveTextMisses.length,
      budgetExhausted: args.budgetExhausted,
      selectionLimitHit: args.selectionLimitHit,
      candidatesOmittedByLimit: args.candidatesOmittedByLimit,
      requestedAnchorsOmitted: args.requestedAnchorsOmitted,
      omittedRequestedAnchors: args.omittedRequestedAnchors ?? [],
      supportingSignalsOmitted: args.supportingSignalsOmitted,
    }),
    providerRunCount,
    providerCandidateCount,
    providerExecutionMode: "serial",
    totalProviderDurationMs,
    zeroCandidateProviders,
    failedProviders,
    adaptiveSkippedProviders,
    providersSkippedDetail: args.providersSkippedDetail.map((detail) => ({ ...detail })),
    liveTextMisses: args.liveTextMisses.map((miss) => ({ ...miss })),
    ...(slowestProvider
      ? {
          slowestProvider: {
            provider: slowestProvider.provider,
            status: slowestProvider.status,
            candidateCount: slowestProvider.candidateCount,
            durationMs: slowestProvider.durationMs,
          },
        }
      : {}),
    recommendations,
  };
}
