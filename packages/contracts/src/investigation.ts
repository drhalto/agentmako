import { z } from "zod";
import type { JsonObject } from "./common.js";
import type { GraphNodeLocator, GraphTraversalDirection } from "./graph.js";
import { GraphNodeLocatorSchema, GraphTraversalDirectionSchema } from "./graph.js";
import type { WorkflowPacketFollowOnHint } from "./workflow-follow-on.js";
import { WorkflowPacketFollowOnHintSchema } from "./workflow-follow-on.js";

const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;

export type InvestigationStrategy =
  | "graph_flow"
  | "flow_then_change"
  | "change_scope"
  | "tenant_audit"
  | "project_handoff"
  | "project_health"
  | "project_queue"
  | "project_status"
  | "ask_routed_canonical"
  | "unsupported";

export type InvestigationStopReason =
  | "satisfied_by_canonical_tool"
  | "bounded_investigation_completed"
  | "budget_exhausted"
  | "unsupported";

export type InvestigationStepStatus = "todo" | "in_progress" | "done";

export interface InvestigationStep {
  stepId: string;
  title: string;
  toolName: string;
  toolInput: JsonObject;
  inputSummary: string;
  rationale: string;
  selectionConfidence?: number;
  status: InvestigationStepStatus;
  resultSummary?: string;
  resultRefs: string[];
  warnings: string[];
  followOn?: WorkflowPacketFollowOnHint;
}

export interface InvestigationCommonInput {
  question: string;
  startEntity?: GraphNodeLocator;
  targetEntity?: GraphNodeLocator;
  direction?: GraphTraversalDirection;
  traversalDepth?: number;
  includeHeuristicEdges?: boolean;
}

export interface SuggestResult {
  strategy: InvestigationStrategy;
  stopReason: InvestigationStopReason;
  steps: InvestigationStep[];
  warnings: string[];
}

export interface InvestigateResult {
  strategy: InvestigationStrategy;
  stopReason: InvestigationStopReason;
  budget: number;
  executedStepCount: number;
  steps: InvestigationStep[];
  followOnHints: WorkflowPacketFollowOnHint[];
  warnings: string[];
}

export const InvestigationStrategySchema = z.enum([
  "graph_flow",
  "flow_then_change",
  "change_scope",
  "tenant_audit",
  "project_handoff",
  "project_health",
  "project_queue",
  "project_status",
  "ask_routed_canonical",
  "unsupported",
]);

export const InvestigationStopReasonSchema = z.enum([
  "satisfied_by_canonical_tool",
  "bounded_investigation_completed",
  "budget_exhausted",
  "unsupported",
]);

export const InvestigationStepStatusSchema = z.enum(["todo", "in_progress", "done"]);

export const InvestigationStepSchema = z.object({
  stepId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  toolName: z.string().trim().min(1),
  toolInput: JsonObjectSchema,
  inputSummary: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  selectionConfidence: z.number().min(0).max(1).optional(),
  status: InvestigationStepStatusSchema,
  resultSummary: z.string().trim().min(1).optional(),
  resultRefs: z.array(z.string().trim().min(1)),
  warnings: z.array(z.string().trim().min(1)),
  followOn: WorkflowPacketFollowOnHintSchema.optional(),
}) satisfies z.ZodType<InvestigationStep>;

export const InvestigationCommonInputSchema = z.object({
  question: z.string().trim().min(1),
  startEntity: GraphNodeLocatorSchema.optional(),
  targetEntity: GraphNodeLocatorSchema.optional(),
  direction: GraphTraversalDirectionSchema.optional(),
  traversalDepth: z.number().int().positive().max(8).optional(),
  includeHeuristicEdges: z.boolean().optional(),
}) satisfies z.ZodType<InvestigationCommonInput>;

export const SuggestResultSchema = z.object({
  strategy: InvestigationStrategySchema,
  stopReason: InvestigationStopReasonSchema,
  steps: z.array(InvestigationStepSchema),
  warnings: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<SuggestResult>;

export const InvestigateResultSchema = z.object({
  strategy: InvestigationStrategySchema,
  stopReason: InvestigationStopReasonSchema,
  budget: z.number().int().positive().max(5),
  executedStepCount: z.number().int().nonnegative(),
  steps: z.array(InvestigationStepSchema),
  followOnHints: z.array(WorkflowPacketFollowOnHintSchema),
  warnings: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<InvestigateResult>;
