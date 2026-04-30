import type { ToolName } from "@mako-ai/contracts";

export interface ClaudeCodeToolHint {
  searchHint: string;
  alwaysLoad?: boolean;
}

export type ClaudeCodeHintToolName = ToolName | "tool_search";

export const CLAUDE_CODE_TOOL_HINTS: Record<
  ClaudeCodeHintToolName,
  ClaudeCodeToolHint
> = {
  tool_search: {
    searchHint: "find mako tool by task intent",
    alwaysLoad: true,
  },
  task_preflight_artifact: {
    searchHint: "start work implementation brief verification plan",
  },
  implementation_handoff_artifact: {
    searchHint: "handoff implementation brief session state",
  },
  review_bundle_artifact: {
    searchHint: "review change impact diagnostics bundle",
  },
  verification_bundle_artifact: {
    searchHint: "completion verification trust tenant audit",
  },
  suggest: {
    searchHint: "recommend workflow tool chain",
  },
  investigate: {
    searchHint: "bounded investigation run tool chain",
  },
  graph_neighbors: {
    searchHint: "adjacent graph entities callers dependents",
  },
  graph_path: {
    searchHint: "shortest typed connection between entities",
  },
  flow_map: {
    searchHint: "end to end flow steps boundaries",
  },
  change_plan: {
    searchHint: "bounded change scope dependency order",
  },
  tenant_leak_audit: {
    searchHint: "tenant boundary rls rpc audit",
  },
  health_trend: {
    searchHint: "recent project health trend traces",
  },
  issues_next: {
    searchHint: "current issue queued followups",
  },
  session_handoff: {
    searchHint: "recent session handoff unresolved focus",
  },
  recall_answers: {
    searchHint: "prior answers memory session history trust",
  },
  recall_tool_runs: {
    searchHint: "previous tool runs history durations outcomes",
  },
  table_neighborhood: {
    searchHint: "table schema rls readers writers routes rpc",
    alwaysLoad: true,
  },
  route_context: {
    searchHint: "route handler imports db rpc table rls",
  },
  rpc_neighborhood: {
    searchHint: "rpc callers tables writes rls schema",
  },
  agent_feedback: {
    searchHint: "rate tool result usefulness feedback signal",
  },
  agent_feedback_report: {
    searchHint: "prior feedback history group tool",
  },
  route_trace: {
    searchHint: "route handler evidence nearby files",
  },
  schema_usage: {
    searchHint: "schema object code references",
  },
  file_health: {
    searchHint: "file role dependents risks evidence",
  },
  auth_path: {
    searchHint: "authorization boundary route feature file",
  },
  imports_deps: {
    searchHint: "direct imports unresolved internal edges",
  },
  imports_impact: {
    searchHint: "downstream dependents import graph",
  },
  imports_hotspots: {
    searchHint: "most connected files import graph",
  },
  imports_cycles: {
    searchHint: "circular dependencies import graph",
  },
  symbols_of: {
    searchHint: "declared symbols in file",
  },
  exports_of: {
    searchHint: "exported symbols in file",
  },
  db_ping: {
    searchHint: "database connectivity version schemas",
  },
  db_columns: {
    searchHint: "table columns primary key details",
  },
  db_fk: {
    searchHint: "foreign key inbound outbound relationships",
  },
  db_rls: {
    searchHint: "row level security policies table",
  },
  db_rpc: {
    searchHint: "stored procedure function signature security",
  },
  db_table_schema: {
    searchHint: "complete table columns constraints indexes",
  },
  mako_help: {
    searchHint: "mako workflow recipe tool sequence",
    alwaysLoad: true,
  },
  ask: {
    searchHint: "answer question one round answer loop",
    alwaysLoad: true,
  },
  trace_file: {
    searchHint: "file trace symbols imports routes schema",
  },
  preflight_table: {
    searchHint: "table preflight usage rls relations",
  },
  cross_search: {
    searchHint: "cross stack unified search code schema routes",
  },
  trace_edge: {
    searchHint: "relationship edge evidence between entities",
  },
  trace_error: {
    searchHint: "error trace likely causes evidence",
  },
  trace_table: {
    searchHint: "database table code schema trace",
  },
  trace_rpc: {
    searchHint: "rpc function code schema trace",
  },
  workflow_packet: {
    searchHint: "typed workflow packet evidence refs",
  },
  ast_find_pattern: {
    searchHint: "structural code pattern search ast grep",
  },
  live_text_search: {
    searchHint: "live ripgrep text search filesystem",
  },
  lint_files: {
    searchHint: "diagnostics findings rule packs canonical helper files",
  },
  typescript_diagnostics: {
    searchHint: "typescript compiler diagnostics reef ingest",
  },
  eslint_diagnostics: {
    searchHint: "eslint diagnostics reef ingest file mode",
  },
  oxlint_diagnostics: {
    searchHint: "oxlint diagnostics reef ingest file mode",
  },
  biome_diagnostics: {
    searchHint: "biome diagnostics reef ingest gitlab reporter",
  },
  git_precommit_check: {
    searchHint: "staged git precommit route auth client server boundary",
  },
  diagnostic_refresh: {
    searchHint: "refresh reef diagnostic sources lint typescript eslint biome",
  },
  db_reef_refresh: {
    searchHint: "refresh reef database schema facts tables columns indexes rls rpc",
  },
  db_review_comment: {
    searchHint: "leave database review comment note",
  },
  db_review_comments: {
    searchHint: "read database review comments notes",
  },
  repo_map: {
    searchHint: "repo orientation outline central files first turn",
    alwaysLoad: true,
  },
  context_packet: {
    searchHint: "deterministic scout packet ranked context",
    alwaysLoad: true,
  },
  tool_batch: {
    searchHint: "batch read only mako lookups",
  },
  runtime_telemetry_report: {
    searchHint: "runtime usefulness events aggregate report",
  },
  project_index_status: {
    searchHint: "index freshness stale current disk watcher status include unindexed",
  },
  project_index_refresh: {
    searchHint: "refresh stale unknown unindexed project index snapshot",
  },
  finding_ack: {
    searchHint: "acknowledge finding false positive ledger",
  },
  finding_ack_batch: {
    searchHint: "batch acknowledge reviewed findings ledger",
  },
  finding_acks_report: {
    searchHint: "review acknowledged findings ledger trends",
  },
  project_findings: {
    searchHint: "reef active project diagnostics findings",
  },
  file_findings: {
    searchHint: "reef diagnostics for one file",
  },
  file_preflight: {
    searchHint: "reef pre edit file gate",
  },
  project_facts: {
    searchHint: "reef facts calculated project state",
  },
  file_facts: {
    searchHint: "reef facts for one file",
  },
  working_tree_overlay: {
    searchHint: "reef snapshot working tree facts",
  },
  reef_overlay_diff: {
    searchHint: "reef compare indexed working tree overlay facts",
  },
  reef_diff_impact: {
    searchHint: "reef changed files impact callers findings conventions",
  },
  reef_instructions: {
    searchHint: "reef scoped AGENTS mako project instructions",
  },
  list_reef_rules: {
    searchHint: "reef rule descriptor metadata",
  },
  rule_pack_validate: {
    searchHint: "reef validate mako yaml rule packs canonical helper",
  },
  extract_rule_template: {
    searchHint: "reef mine rule pack yaml from git fix diff",
  },
  project_diagnostic_runs: {
    searchHint: "reef diagnostic source run status cache age",
  },
  reef_scout: {
    searchHint: "reef ranked context scout messy request",
    alwaysLoad: true,
  },
  reef_inspect: {
    searchHint: "reef evidence trail file subject facts findings",
  },
  project_open_loops: {
    searchHint: "reef unresolved stale failed work left",
  },
  verification_state: {
    searchHint: "reef diagnostics freshness changed files recent runs watcher verification",
  },
  project_conventions: {
    searchHint: "reef project conventions auth boundary generated schema",
  },
  rule_memory: {
    searchHint: "reef rule history active acknowledged resolved",
  },
  evidence_confidence: {
    searchHint: "reef evidence trust labels stale live indexed semantic",
  },
  evidence_conflicts: {
    searchHint: "reef contradictory stale phantom evidence conflicts",
  },
  reef_where_used: {
    searchHint: "reef maintained structural where used definitions usages",
  },
  reef_known_issues: {
    searchHint: "reef current diagnostics errors warnings stale sources",
  },
  reef_agent_status: {
    searchHint: "reef agent loop project status known issues changed files",
  },
};

export function getClaudeCodeToolHint(
  toolName: string,
): ClaudeCodeToolHint | undefined {
  return CLAUDE_CODE_TOOL_HINTS[toolName as ClaudeCodeHintToolName];
}
