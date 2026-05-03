import type { ToolAnnotations, ToolName } from "@mako-ai/contracts";

export type ToolPreviewDecision = "not_applicable" | "required" | "useful" | "skip";

export interface ToolOperationalMetadata {
  annotations: ToolAnnotations;
  previewDecision: ToolPreviewDecision;
  mutationKind: "none" | "append_log" | "diagnostic_refresh" | "index_refresh" | "working_tree_snapshot" | "db_review";
  previewReason: string;
}

const RO = { readOnlyHint: true, idempotentHint: true } as const;
const RO_DERIVED = { readOnlyHint: true, idempotentHint: true, derivedOnly: true } as const;
const RO_ADVISORY_DERIVED = { readOnlyHint: true, idempotentHint: true, advisoryOnly: true, derivedOnly: true } as const;
const RO_OPEN = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;
const RO_ADVISORY_OPEN = { readOnlyHint: true, idempotentHint: true, openWorldHint: true, advisoryOnly: true } as const;
const RO_ADVISORY_DERIVED_OPEN = { readOnlyHint: true, idempotentHint: true, openWorldHint: true, advisoryOnly: true, derivedOnly: true } as const;
const MUTATION_OPEN = { mutation: true, openWorldHint: true } as const;
const MUTATION_ADVISORY_OPEN = { mutation: true, advisoryOnly: true, openWorldHint: true } as const;

function readOnly(annotations: ToolAnnotations): ToolOperationalMetadata {
  return {
    annotations,
    previewDecision: "not_applicable",
    mutationKind: "none",
    previewReason: "Read-only tool.",
  };
}

function mutation(
  annotations: ToolAnnotations,
  mutationKind: ToolOperationalMetadata["mutationKind"],
  previewDecision: Exclude<ToolPreviewDecision, "not_applicable">,
  previewReason: string,
): ToolOperationalMetadata {
  return {
    annotations,
    previewDecision,
    mutationKind,
    previewReason,
  };
}

export const TOOL_OPERATIONAL_METADATA = {
  task_preflight_artifact: readOnly(RO_DERIVED),
  implementation_handoff_artifact: readOnly({ readOnlyHint: true, derivedOnly: true }),
  review_bundle_artifact: readOnly(RO_DERIVED),
  verification_bundle_artifact: readOnly(RO_DERIVED),
  suggest: readOnly(RO_ADVISORY_DERIVED),
  investigate: readOnly(RO_ADVISORY_DERIVED),
  graph_neighbors: readOnly(RO),
  graph_path: readOnly(RO),
  flow_map: readOnly(RO),
  change_plan: readOnly(RO),
  tenant_leak_audit: readOnly(RO_ADVISORY_DERIVED),
  health_trend: readOnly(RO_DERIVED),
  issues_next: readOnly(RO),
  session_handoff: readOnly(RO_DERIVED),
  recall_answers: readOnly(RO),
  recall_tool_runs: readOnly(RO),
  table_neighborhood: readOnly(RO_DERIVED),
  route_context: readOnly(RO_DERIVED),
  rpc_neighborhood: readOnly(RO_DERIVED),
  agent_feedback: mutation({ mutation: true }, "append_log", "skip", "Low-risk append-only feedback log; preview adds friction without safety."),
  agent_feedback_report: readOnly(RO),
  route_trace: readOnly(RO),
  schema_usage: readOnly(RO),
  file_health: readOnly(RO),
  auth_path: readOnly(RO),
  imports_deps: readOnly(RO),
  imports_impact: readOnly(RO),
  imports_hotspots: readOnly(RO),
  imports_cycles: readOnly(RO),
  symbols_of: readOnly(RO),
  exports_of: readOnly(RO),
  db_ping: readOnly(RO_OPEN),
  db_columns: readOnly(RO_OPEN),
  db_fk: readOnly(RO_OPEN),
  db_rls: readOnly(RO_OPEN),
  db_rpc: readOnly(RO_OPEN),
  db_table_schema: readOnly(RO_OPEN),
  mako_help: readOnly(RO_DERIVED),
  ask: readOnly({ readOnlyHint: true }),
  trace_file: readOnly(RO),
  preflight_table: readOnly(RO),
  cross_search: readOnly(RO),
  trace_edge: readOnly(RO),
  trace_error: readOnly(RO),
  trace_table: readOnly(RO),
  trace_rpc: readOnly(RO),
  workflow_packet: readOnly(RO),
  ast_find_pattern: readOnly(RO_OPEN),
  live_text_search: readOnly(RO_OPEN),
  lint_files: mutation(MUTATION_ADVISORY_OPEN, "diagnostic_refresh", "skip", "Diagnostic ingestion writes the local findings cache as its explicit purpose."),
  typescript_diagnostics: mutation(MUTATION_ADVISORY_OPEN, "diagnostic_refresh", "skip", "Diagnostic ingestion writes the local findings cache as its explicit purpose."),
  eslint_diagnostics: mutation(MUTATION_ADVISORY_OPEN, "diagnostic_refresh", "skip", "Diagnostic ingestion writes the local findings cache as its explicit purpose."),
  oxlint_diagnostics: mutation(MUTATION_ADVISORY_OPEN, "diagnostic_refresh", "skip", "Diagnostic ingestion writes the local findings cache as its explicit purpose."),
  biome_diagnostics: mutation(MUTATION_ADVISORY_OPEN, "diagnostic_refresh", "skip", "Diagnostic ingestion writes the local findings cache as its explicit purpose."),
  git_precommit_check: mutation(MUTATION_ADVISORY_OPEN, "diagnostic_refresh", "skip", "Diagnostic ingestion writes the local findings cache as its explicit purpose."),
  diagnostic_refresh: mutation(MUTATION_ADVISORY_OPEN, "diagnostic_refresh", "skip", "Refresh command is already the explicit local-state write."),
  db_reef_refresh: mutation(MUTATION_ADVISORY_OPEN, "diagnostic_refresh", "skip", "Refresh command is already the explicit local-state write."),
  db_review_comment: mutation({ mutation: true, advisoryOnly: true }, "db_review", "useful", "Durable user-visible review note; preview can show target/comment metadata."),
  db_review_comments: readOnly(RO),
  repo_map: readOnly(RO),
  runtime_telemetry_report: readOnly(RO),
  project_index_status: readOnly(RO_OPEN),
  project_index_refresh: mutation(MUTATION_OPEN, "index_refresh", "skip", "Refresh command is already the explicit local index write."),
  context_packet: readOnly(RO_OPEN),
  tool_batch: readOnly({ readOnlyHint: true, derivedOnly: true, openWorldHint: true }),
  reef_ask: readOnly(RO_ADVISORY_DERIVED_OPEN),
  finding_ack: mutation({ mutation: true }, "append_log", "useful", "Acknowledgement suppresses future findings for a reviewed fingerprint."),
  finding_ack_batch: mutation({ mutation: true }, "append_log", "required", "Batch acknowledgement may suppress many future findings."),
  finding_acks_report: readOnly(RO),
  project_findings: readOnly(RO),
  file_findings: readOnly(RO),
  file_preflight: readOnly(RO_DERIVED),
  project_facts: readOnly(RO),
  file_facts: readOnly(RO),
  working_tree_overlay: mutation(MUTATION_ADVISORY_OPEN, "working_tree_snapshot", "skip", "Local cache snapshot; preview would duplicate the output."),
  reef_overlay_diff: readOnly(RO),
  reef_diff_impact: readOnly(RO_DERIVED),
  reef_impact: readOnly(RO_DERIVED),
  reef_instructions: readOnly(RO_ADVISORY_DERIVED_OPEN),
  reef_learning_review: readOnly(RO_ADVISORY_DERIVED_OPEN),
  list_reef_rules: readOnly(RO),
  rule_pack_validate: readOnly(RO_ADVISORY_DERIVED_OPEN),
  extract_rule_template: readOnly(RO_ADVISORY_DERIVED_OPEN),
  project_diagnostic_runs: readOnly(RO),
  reef_scout: readOnly(RO),
  reef_inspect: readOnly(RO),
  reef_where_used: readOnly(RO_DERIVED),
  reef_verify: readOnly(RO_ADVISORY_DERIVED),
  project_open_loops: readOnly(RO),
  verification_state: readOnly(RO),
  project_conventions: readOnly(RO),
  rule_memory: readOnly(RO),
  evidence_confidence: readOnly(RO),
  evidence_conflicts: readOnly(RO),
  reef_known_issues: readOnly(RO_DERIVED),
  reef_status: readOnly(RO_ADVISORY_DERIVED),
  reef_agent_status: readOnly(RO_ADVISORY_DERIVED),
} satisfies Record<ToolName, ToolOperationalMetadata>;

export function getToolOperationalMetadata(toolName: ToolName): ToolOperationalMetadata {
  return TOOL_OPERATIONAL_METADATA[toolName];
}

export function maybeGetToolOperationalMetadata(toolName: string): ToolOperationalMetadata | undefined {
  return (TOOL_OPERATIONAL_METADATA as Record<string, ToolOperationalMetadata | undefined>)[toolName];
}

export function toolAnnotations(toolName: ToolName): ToolAnnotations {
  return getToolOperationalMetadata(toolName).annotations;
}
