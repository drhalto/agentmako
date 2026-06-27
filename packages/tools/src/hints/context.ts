import type { ContextPacketToolOutput } from "@mako-ai/contracts";

export function contextPacketHints(output: ContextPacketToolOutput): string[] {
  const hints: string[] = [];
  const primary = Array.isArray(output.primaryContext) ? output.primaryContext.length : 0;
  const related = Array.isArray(output.relatedContext) ? output.relatedContext.length : 0;
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
  }
  if (output.evidenceQuality?.graph?.status === "missing") {
    hints.push("Graph evidence is missing for a dependency/impact-style request — use repo_map, imports_impact, or reef_where_used before making graph claims.");
  } else if (output.evidenceQuality?.graph?.status === "isolated") {
    hints.push("Graph evidence is isolated for a dependency/impact-style request — treat this packet as file-local until graph expansion confirms neighbors.");
  }
  const failedProviders = output.retrievalDiagnostics?.failedProviders ?? [];
  if (failedProviders.length > 0) {
    hints.push(`${failedProviders.length} retrieval provider(s) failed — inspect warnings before relying on missing evidence.`);
  }
  if ((output.retrievalDiagnostics?.providerCandidateCount ?? 1) === 0 && primary + related === 0) {
    hints.push("Retrieval providers returned zero candidates — add focusFiles/focusSymbols or use exact live_text_search.");
  }
  const liveTextMisses = output.retrievalDiagnostics?.liveTextMisses ?? [];
  if (liveTextMisses.some((miss) => miss.scope === "file")) {
    hints.push("A quoted literal was not found in scoped current files — verify spelling/case or broaden live_text_search.");
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
