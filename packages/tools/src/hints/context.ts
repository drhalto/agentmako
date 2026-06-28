import type { ContextPacketLiveTextMiss, ContextPacketToolOutput } from "@mako-ai/contracts";

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function arrayValue<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function omittedAnchorTool(kind: string): string {
  switch (kind) {
    case "file":
      return "cross_search";
    case "symbol":
      return "reef_where_used";
    case "route":
      return "route_context";
    case "database_object":
      return "table_neighborhood";
    default:
      return "";
  }
}

function omittedAnchorHint(
  retrievalPlan: NonNullable<ContextPacketToolOutput["retrievalDiagnostics"]>["retrievalPlan"],
): string | undefined {
  const anchors = arrayValue(retrievalPlan.evidenceGaps)
    .flatMap((gap) => arrayValue(gap.anchors));
  if (anchors.length === 0) return undefined;

  const anchorSummary = anchors
    .slice(0, 4)
    .map((anchor) => `${anchor.kind}:${anchor.value}`)
    .join("; ");
  const followUpToolNames = new Set<string>(
    arrayValue(retrievalPlan.recommendedFollowUps).map((tool) => tool.toolName),
  );
  const executableTools = uniqueStrings(
    anchors
      .map((anchor) => omittedAnchorTool(anchor.kind))
      .filter((toolName) => followUpToolNames.has(toolName)),
  );
  const toolSuffix = executableTools.length > 0
    ? ` Run ${executableTools.slice(0, 4).join(", ")} from retrievalDiagnostics.retrievalPlan.recommendedFollowUps before packet-only claims.`
    : " Run the matching anchor-specific recommendedFollowUps before packet-only claims.";
  const omittedSuffix = anchors.length > 4 ? ` (+${anchors.length - 4} more)` : "";
  return `Omitted requested anchors: ${anchorSummary}${omittedSuffix}.${toolSuffix}`;
}

function liveTextMissHint(misses: readonly ContextPacketLiveTextMiss[]): string | undefined {
  const scopedSymbolMiss = misses.find((miss) => miss.scope === "file" && miss.queryKind === "symbol");
  if (scopedSymbolMiss) {
    return `A requested symbol was not found in scoped current files: ${scopedSymbolMiss.query}. Verify rename/deletion or run reef_where_used/live_text_search before trusting indexed references.`;
  }
  const projectSymbolMiss = misses.find((miss) => miss.queryKind === "symbol");
  if (projectSymbolMiss) {
    return `A requested symbol was not found on the current filesystem: ${projectSymbolMiss.query}. Verify rename/deletion or search related terms before trusting indexed references.`;
  }
  const scopedLiteralMiss = misses.find((miss) => miss.scope === "file");
  if (scopedLiteralMiss) {
    return `A quoted literal was not found in scoped current files: ${scopedLiteralMiss.query}. Verify spelling/case or broaden live_text_search.`;
  }
  const projectLiteralMiss = misses.find((miss) => (miss.queryKind ?? "quoted_text") === "quoted_text");
  if (projectLiteralMiss) {
    return `A quoted literal was not found on the current filesystem: ${projectLiteralMiss.query}. Verify spelling/case or search related terms.`;
  }
  return undefined;
}

export function contextPacketHints(output: ContextPacketToolOutput): string[] {
  const hints: string[] = [];
  const primary = Array.isArray(output.primaryContext) ? output.primaryContext.length : 0;
  const related = Array.isArray(output.relatedContext) ? output.relatedContext.length : 0;
  const retrievalDiagnostics = output.retrievalDiagnostics;
  const retrievalPlan = output.retrievalDiagnostics?.retrievalPlan;
  const adaptiveSkipDetails = arrayValue(output.retrievalDiagnostics?.providersSkippedDetail).filter((detail) => detail.adaptive);
  const hasGraphPathEvidence = arrayValue(output.graphSummary?.files).some((file) => (file.pathEvidenceCount ?? 0) > 0);
  if (retrievalPlan) {
    const recommendedTools = Array.isArray(retrievalPlan.recommendedTools)
      ? retrievalPlan.recommendedTools
      : [];
    if (retrievalPlan.evidenceGate?.status === "follow_up_required") {
      const blockingReasons = arrayValue(retrievalPlan.evidenceGate.blockingReasons).slice(0, 2);
      const reasonSummary = blockingReasons.length > 0
        ? blockingReasons.join(" ")
        : "inspect retrievalDiagnostics.retrievalPlan.evidenceGaps.";
      hints.push(`Evidence gate: follow-up required; ${reasonSummary}`);
    } else if (retrievalPlan.evidenceGate?.status === "follow_up_recommended") {
      hints.push("Evidence gate: follow-up recommended before edit, review, or broad repository claims.");
    } else if (retrievalPlan.evidenceGate?.status === "satisfied") {
      hints.push("Evidence gate: packet evidence is sufficient for a bounded answer after exact-line verification.");
    }
    if (retrievalPlan.level === "issue_to_edit_localization") {
      const requiredEvidence = arrayValue(retrievalPlan.requiredEvidence).slice(0, 2);
      const requirementSummary = requiredEvidence.length > 0
        ? requiredEvidence.join(" and ")
        : "retrieval-plan required evidence";
      hints.push(`Retrieval plan: issue-to-edit localization via ${retrievalPlan.strategy}; verify ${requirementSummary}.`);
    } else if (retrievalPlan.level === "broader_context_retrieval") {
      hints.push(`Retrieval plan: broader context retrieval via ${retrievalPlan.strategy}; use graph/where-used expansion before broad repository claims.${hasGraphPathEvidence ? " Inspect graphSummary.files[].pathEvidence for graph path provenance." : ""}`);
    } else {
      hints.push(`Retrieval plan: code understanding via ${retrievalPlan.strategy}; answer from cited context and exact checks.`);
    }
    if (recommendedTools.length > 0) {
      hints.push(`Recommended follow-up tools: ${recommendedTools.slice(0, 4).join(", ")}.`);
    }
    const omittedHint = omittedAnchorHint(retrievalPlan);
    if (omittedHint) hints.push(omittedHint);
    const evidenceGaps = arrayValue(retrievalPlan.evidenceGaps);
    if (evidenceGaps.length > 0) {
      const gapSummary = evidenceGaps
        .slice(0, 3)
        .map((gap) => `${gap.kind}:${gap.severity}`)
        .join(", ");
      hints.push(`Retrieval evidence gaps: ${gapSummary}.`);
    }
    if (arrayValue(retrievalPlan.recommendedFollowUps).length > 0) {
      hints.push("Executable recommended follow-ups are available at retrievalDiagnostics.retrievalPlan.recommendedFollowUps.");
    }
    const adaptiveSuffix = adaptiveSkipDetails.length > 0
      ? ` Adaptive retrieval skipped ${adaptiveSkipDetails.length} provider(s); first reason: ${adaptiveSkipDetails[0]?.reason}`
      : "";
    hints.push(`Retrieval next step: ${retrievalPlan.nextStep}${adaptiveSuffix}`);
  }
  const liveTextMisses = arrayValue(output.retrievalDiagnostics?.liveTextMisses);
  const liveMissHint = liveTextMissHint(liveTextMisses);
  if (liveMissHint) hints.push(liveMissHint);
  if (primary + related === 0) {
    hints.push(
      "No deterministic context matched; broaden the request or call ask for routing.",
    );
  }
  if (output.evidenceQuality?.label === "weak") {
    hints.push("Evidence quality is weak — broaden the request or use reef_ask/live_text_search before relying on this packet.");
  } else if (output.evidenceQuality?.label === "partial") {
    hints.push("Evidence quality is partial — expand with suggested tools or live_text_search before broad edits.");
  }
  if (output.requestCoverage?.status === "missing" || output.requestCoverage?.status === "partial") {
    hints.push(`${output.requestCoverage.uncoveredCount + output.requestCoverage.notCheckedCount} requested anchor(s) were not covered — inspect requestCoverage before relying on absence.`);
    const unresolved = arrayValue(output.requestCoverage.items)
      .filter((item) => item.status === "uncovered" || item.status === "not_checked")
      .slice(0, 4)
      .map((item) => `${item.kind}:${item.value} (${item.status})`);
    if (unresolved.length > 0) {
      hints.push(`Unresolved requested context: ${unresolved.join("; ")}.`);
    }
  }
  if (output.evidenceQuality?.graph?.status === "missing") {
    hints.push("Graph evidence is missing for a dependency/impact-style request — use repo_map, imports_impact, or reef_where_used before making graph claims.");
  } else if (output.evidenceQuality?.graph?.status === "isolated") {
    hints.push("Graph evidence is isolated for a dependency/impact-style request — treat this packet as file-local until graph expansion confirms neighbors.");
  } else if (output.evidenceQuality?.graph?.requested && output.evidenceQuality.graph.warningCount > 0) {
    hints.push("Graph evidence is bounded or warning-labeled — run graph follow-ups before making exhaustive dependency or impact claims.");
  }
  if (!retrievalPlan && hasGraphPathEvidence) {
    hints.push("Graph path provenance is available at graphSummary.files[].pathEvidence; use it to verify why graph files were included.");
  }
  const failedProviders = arrayValue(output.retrievalDiagnostics?.failedProviders);
  if (failedProviders.length > 0) {
    hints.push(`${failedProviders.length} retrieval provider(s) failed — inspect warnings before relying on missing evidence.`);
  }
  if ((output.retrievalDiagnostics?.providerCandidateCount ?? 1) === 0 && primary + related === 0) {
    hints.push("Retrieval providers returned zero candidates — add focusFiles/focusSymbols or use exact live_text_search.");
  }
  const totalProviderDurationMs = retrievalDiagnostics?.totalProviderDurationMs ?? 0;
  const slowestProvider = retrievalDiagnostics?.slowestProvider;
  if (
    retrievalDiagnostics?.providerExecutionMode === "serial" &&
    (retrievalDiagnostics.providerRunCount ?? 0) > 1 &&
    totalProviderDurationMs >= 750
  ) {
    hints.push(`Retrieval providers ran serially for about ${Math.round(totalProviderDurationMs)}ms — inspect slowestProvider or narrow anchors before broad expansion.`);
  }
  if ((slowestProvider?.durationMs ?? 0) >= 250 && slowestProvider?.provider) {
    hints.push(`Slowest retrieval provider was ${slowestProvider.provider} at ${Math.round(slowestProvider.durationMs)}ms.`);
  }
  const risks = Array.isArray(output.risks) ? output.risks.length : 0;
  if (risks > 0) {
    hints.push(`${risks} risk(s) flagged — review them before editing.`);
  }
  const findings = Array.isArray(output.activeFindings) ? output.activeFindings.length : 0;
  if (findings > 0) {
    hints.push(
      `${findings} active finding(s) on context files — call file_findings or finding_acks_report for details.`,
    );
  }
  if (output.freshnessGate?.status === "stale") {
    hints.push("Freshness gate is stale — use live_text_search or project_index_status before trusting exact lines.");
  }
  if (output.freshnessGate?.status === "degraded") {
    hints.push("Freshness gate is degraded — restart the MCP server or run an explicit refresh if watcher freshness matters.");
  }
  return hints;
}
