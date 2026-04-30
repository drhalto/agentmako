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
