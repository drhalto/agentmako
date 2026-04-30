import { z } from "zod";
import type { JsonObject } from "./common.js";
import { ProjectLocatorInputObjectSchema, type ProjectLocatorInput } from "./tool-project-locator.js";
import type { ToolName } from "./tool-registry.js";

const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;

export const TOOL_BATCH_TOOL_NAMES = [
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
  "repo_map",
  "runtime_telemetry_report",
  "project_index_status",
  "context_packet",
  "finding_acks_report",
  "project_findings",
  "file_findings",
  "project_facts",
  "file_facts",
  "reef_overlay_diff",
  "reef_diff_impact",
  "reef_instructions",
  "list_reef_rules",
  "rule_pack_validate",
  "project_diagnostic_runs",
  "reef_scout",
  "reef_inspect",
  "reef_where_used",
  "project_open_loops",
  "verification_state",
  "project_conventions",
  "rule_memory",
  "evidence_confidence",
  "evidence_conflicts",
  "reef_known_issues",
  "reef_agent_status",
  "db_review_comments",
] as const satisfies readonly ToolName[];

export type ToolBatchToolName = (typeof TOOL_BATCH_TOOL_NAMES)[number];
export const ToolBatchToolNameSchema = z.enum(TOOL_BATCH_TOOL_NAMES);

export interface ToolBatchOperation {
  label: string;
  tool: ToolBatchToolName;
  args?: JsonObject;
  resultMode?: "full" | "summary";
}

export interface ToolBatchInput extends ProjectLocatorInput {
  ops: ToolBatchOperation[];
  continueOnError?: boolean;
  maxOps?: number;
  verbosity?: "full" | "compact";
}

export const ToolBatchOperationSchema = z.object({
  label: z.string().trim().min(1),
  tool: ToolBatchToolNameSchema,
  args: JsonObjectSchema.optional(),
  resultMode: z.enum(["full", "summary"]).optional(),
}) satisfies z.ZodType<ToolBatchOperation>;

export const ToolBatchInputSchema = ProjectLocatorInputObjectSchema.extend({
  ops: z.array(ToolBatchOperationSchema).min(1).max(20),
  continueOnError: z.boolean().optional(),
  maxOps: z.number().int().min(1).max(20).optional(),
  verbosity: z.enum(["full", "compact"]).optional(),
}) satisfies z.ZodType<ToolBatchInput>;

export interface ToolBatchResult {
  label: string;
  tool: ToolBatchToolName;
  ok: boolean;
  durationMs: number;
  result?: JsonObject;
  resultSummary?: JsonObject;
  error?: {
    code: "unknown_tool" | "mutation_rejected" | "recursive_batch_rejected" | "tool_error";
    message: string;
  };
}

export const ToolBatchResultSchema = z.object({
  label: z.string().min(1),
  tool: ToolBatchToolNameSchema,
  ok: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  result: JsonObjectSchema.optional(),
  resultSummary: JsonObjectSchema.optional(),
  error: z.object({
    code: z.enum(["unknown_tool", "mutation_rejected", "recursive_batch_rejected", "tool_error"]),
    message: z.string().min(1),
  }).optional(),
}) satisfies z.ZodType<ToolBatchResult>;

export interface ToolBatchToolOutput {
  toolName: "tool_batch";
  projectId: string;
  projectRoot: string;
  results: ToolBatchResult[];
  summary: {
    requestedOps: number;
    executedOps: number;
    succeededOps: number;
    failedOps: number;
    rejectedOps: number;
    durationMs: number;
  };
  warnings: string[];
}

export const ToolBatchToolOutputSchema = z.object({
  toolName: z.literal("tool_batch"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  results: z.array(ToolBatchResultSchema),
  summary: z.object({
    requestedOps: z.number().int().nonnegative(),
    executedOps: z.number().int().nonnegative(),
    succeededOps: z.number().int().nonnegative(),
    failedOps: z.number().int().nonnegative(),
    rejectedOps: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ToolBatchToolOutput>;
