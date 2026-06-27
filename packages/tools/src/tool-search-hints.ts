import type { ToolName } from "@mako-ai/contracts";

export const REGISTRY_TOOL_SEARCH_HINTS: Partial<Record<ToolName, string>> = {
  mako_help: [
    "start here for Mako workflow selection",
    "repo knowledge workflow recipe focus anchors",
    "which tool should I use",
    "choose reef_ask context_packet repo_map tool_batch",
  ].join(" "),
  reef_ask: [
    "primary repo knowledge question engine",
    "codebase database findings diagnostics freshness open loops",
    "answer structural impact where used verification questions",
  ].join(" "),
  context_packet: [
    "ranked repo context packet",
    "messy request scout graph anchors focus files routes symbols database objects",
    "quoted literal live text current disk",
    "evidence quality confidence freshness risks expandable tools",
    "fast deterministic retrieval before editing",
  ].join(" "),
  repo_map: [
    "repo map orientation PageRank import graph",
    "focus anchors dependencies dependents central files",
    "codebase overview unfamiliar repository first turn",
  ].join(" "),
  tool_batch: [
    "batch compact summaries ranked graph evidence",
    "reduce round trips independent read only lookups",
    "summarize context_packet repo_map reef_ask follow ups",
  ].join(" "),
  live_text_search: [
    "exact live filesystem search ripgrep grep",
    "current disk text literals errors symbols new files",
  ].join(" "),
  project_index_status: [
    "index freshness stale unindexed unknown current disk",
    "watcher status verify indexed evidence",
  ].join(" "),
  working_tree_overlay: [
    "snapshot changed files live overlay facts",
    "working tree freshness before indexed fallback",
  ].join(" "),
  evidence_confidence: [
    "evidence trust labels confidence freshness stale indexed live verified",
    "explain whether facts and findings are reliable",
  ].join(" "),
  evidence_conflicts: [
    "contradictory stale phantom evidence conflict",
    "cross check unreliable facts findings",
  ].join(" "),
};
