import { z } from "zod";
import type { JsonObject } from "./common.js";

const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;

export const MAKO_TOOL_NAMES = [
  "task_preflight_artifact",
  "implementation_handoff_artifact",
  "review_bundle_artifact",
  "verification_bundle_artifact",
  "suggest",
  "investigate",
  "graph_neighbors",
  "graph_path",
  "flow_map",
  "change_plan",
  "tenant_leak_audit",
  "health_trend",
  "issues_next",
  "session_handoff",
  "recall_answers",
  "recall_tool_runs",
  "table_neighborhood",
  "route_context",
  "rpc_neighborhood",
  "agent_feedback",
  "agent_feedback_report",
  "route_trace",
  "schema_usage",
  "file_health",
  "auth_path",
  "imports_deps",
  "imports_impact",
  "imports_hotspots",
  "imports_cycles",
  "symbols_of",
  "exports_of",
  "db_ping",
  "db_columns",
  "db_fk",
  "db_rls",
  "db_rpc",
  "db_table_schema",
  "mako_help",
  "ask",
  "trace_file",
  "preflight_table",
  "cross_search",
  "trace_edge",
  "trace_error",
  "trace_table",
  "trace_rpc",
  "workflow_packet",
  "ast_find_pattern",
  "live_text_search",
  "lint_files",
  "typescript_diagnostics",
  "eslint_diagnostics",
  "oxlint_diagnostics",
  "biome_diagnostics",
  "git_precommit_check",
  "diagnostic_refresh",
  "db_reef_refresh",
  "db_review_comment",
  "db_review_comments",
  "repo_map",
  "runtime_telemetry_report",
  "project_index_status",
  "project_index_refresh",
  "context_packet",
  "tool_batch",
  "reef_ask",
  "finding_ack",
  "finding_ack_batch",
  "finding_acks_report",
  "project_findings",
  "file_findings",
  "file_preflight",
  "project_facts",
  "file_facts",
  "working_tree_overlay",
  "reef_overlay_diff",
  "reef_diff_impact",
  "reef_impact",
  "reef_instructions",
  "reef_learning_review",
  "list_reef_rules",
  "rule_pack_validate",
  "extract_rule_template",
  "project_diagnostic_runs",
  "reef_scout",
  "reef_inspect",
  "reef_where_used",
  "reef_verify",
  "project_open_loops",
  "verification_state",
  "project_conventions",
  "rule_memory",
  "evidence_confidence",
  "evidence_conflicts",
  "reef_known_issues",
  "reef_status",
  "reef_agent_status",
] as const;

export type ToolName = (typeof MAKO_TOOL_NAMES)[number];
export const ToolNameSchema = z.enum(MAKO_TOOL_NAMES);

export const MAKO_ANSWER_TOOL_NAMES = ["route_trace", "schema_usage", "file_health", "auth_path"] as const;
export type AnswerToolName = (typeof MAKO_ANSWER_TOOL_NAMES)[number];

export const MAKO_COMPOSER_TOOL_NAMES = [
  "trace_file",
  "preflight_table",
  "cross_search",
  "trace_edge",
  "trace_error",
  "trace_table",
  "trace_rpc",
] as const;
export type ComposerToolName = (typeof MAKO_COMPOSER_TOOL_NAMES)[number];

export const MAKO_TOOL_CATEGORIES = ["answer", "imports", "symbols", "db", "router", "composer", "workflow", "graph", "operator", "artifact", "code_intel", "runtime_telemetry", "project", "finding_acks", "session_recall", "neighborhood", "feedback", "context"] as const;
export type ToolCategory = (typeof MAKO_TOOL_CATEGORIES)[number];
export const ToolCategorySchema = z.enum(MAKO_TOOL_CATEGORIES);

export type ToolAnnotations =
  | {
      readOnlyHint: true;
      idempotentHint?: true;
      openWorldHint?: true;
      advisoryOnly?: true;
      derivedOnly?: true;
  }
  | {
      mutation: true;
      destructiveHint?: true;
      idempotentHint?: true;
      openWorldHint?: true;
      advisoryOnly?: true;
      derivedOnly?: true;
    };

export const ToolAnnotationsSchema: z.ZodType<ToolAnnotations> = z.union([
  z.object({
    readOnlyHint: z.literal(true),
    idempotentHint: z.literal(true).optional(),
    openWorldHint: z.literal(true).optional(),
    advisoryOnly: z.literal(true).optional(),
    derivedOnly: z.literal(true).optional(),
  }),
  z.object({
    mutation: z.literal(true),
    destructiveHint: z.literal(true).optional(),
    idempotentHint: z.literal(true).optional(),
    openWorldHint: z.literal(true).optional(),
    advisoryOnly: z.literal(true).optional(),
    derivedOnly: z.literal(true).optional(),
  }),
]);

export const ToolHintsSchema = z.object({
  _hints: z.array(z.string().min(1)).max(8),
});
export type ToolHints = z.infer<typeof ToolHintsSchema>;

export interface ToolDefinitionSummary {
  name: ToolName;
  category: ToolCategory;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: JsonObject;
  outputSchema: JsonObject;
  searchHint?: string;
  alwaysLoad?: boolean;
}

export const ToolDefinitionSummarySchema = z.object({
  name: ToolNameSchema,
  category: ToolCategorySchema,
  description: z.string().min(1),
  annotations: ToolAnnotationsSchema,
  inputSchema: JsonObjectSchema,
  outputSchema: JsonObjectSchema,
  searchHint: z.string().min(1).optional(),
  alwaysLoad: z.boolean().optional(),
}) satisfies z.ZodType<ToolDefinitionSummary>;
