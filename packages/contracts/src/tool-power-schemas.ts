import { z } from "zod";
import type {
  ChangePlanResult,
  FlowMapResult,
  GraphEdgeKind,
  GraphNeighborsResult,
  GraphNodeKind,
  GraphNodeLocator,
  GraphPathResult,
  GraphTraversalDirection,
} from "./graph.js";
import type {
  InvestigateResult,
  InvestigationCommonInput,
  SuggestResult,
} from "./investigation.js";
import type { TenantLeakAuditResult } from "./operators.js";
import type {
  HealthTrendResult,
  IssuesNextResult,
  SessionHandoffResult,
} from "./project-intelligence.js";
import type { ProjectLocatorInput } from "./tool-project-locator.js";
import {
  ChangePlanResultSchema,
  FlowMapResultSchema,
  GraphEdgeKindSchema,
  GraphNeighborsResultSchema,
  GraphNodeKindSchema,
  GraphNodeLocatorSchema,
  GraphPathResultSchema,
  GraphTraversalDirectionSchema,
} from "./graph.js";
import {
  InvestigateResultSchema,
  InvestigationCommonInputSchema,
  SuggestResultSchema,
} from "./investigation.js";
import { TenantLeakAuditResultSchema } from "./operators.js";
import {
  HealthTrendResultSchema,
  IssuesNextResultSchema,
  SessionHandoffResultSchema,
} from "./project-intelligence.js";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";

export interface GraphNeighborsToolInput extends ProjectLocatorInput {
  startEntities: GraphNodeLocator[];
  direction?: GraphTraversalDirection;
  traversalDepth?: number;
  nodeKinds?: GraphNodeKind[];
  edgeKinds?: GraphEdgeKind[];
  includeHeuristicEdges?: boolean;
  limit?: number;
}

export const GraphNeighborsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  startEntities: z.array(GraphNodeLocatorSchema).min(1),
  direction: GraphTraversalDirectionSchema.optional(),
  traversalDepth: z.number().int().positive().max(5).optional(),
  nodeKinds: z.array(GraphNodeKindSchema).optional(),
  edgeKinds: z.array(GraphEdgeKindSchema).optional(),
  includeHeuristicEdges: z.boolean().optional(),
  limit: z.number().int().positive().max(100).optional(),
}).strict() satisfies z.ZodType<GraphNeighborsToolInput>;

export interface GraphNeighborsToolOutput {
  toolName: "graph_neighbors";
  projectId: string;
  result: GraphNeighborsResult;
}

export const GraphNeighborsToolOutputSchema = z.object({
  toolName: z.literal("graph_neighbors"),
  projectId: z.string().min(1),
  result: GraphNeighborsResultSchema,
}) satisfies z.ZodType<GraphNeighborsToolOutput>;

export interface GraphPathToolInput extends ProjectLocatorInput {
  startEntity: GraphNodeLocator;
  targetEntity: GraphNodeLocator;
  direction?: GraphTraversalDirection;
  traversalDepth?: number;
  nodeKinds?: GraphNodeKind[];
  edgeKinds?: GraphEdgeKind[];
  includeHeuristicEdges?: boolean;
}

export const GraphPathToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  startEntity: GraphNodeLocatorSchema,
  targetEntity: GraphNodeLocatorSchema,
  direction: GraphTraversalDirectionSchema.optional(),
  traversalDepth: z.number().int().positive().max(8).optional(),
  nodeKinds: z.array(GraphNodeKindSchema).optional(),
  edgeKinds: z.array(GraphEdgeKindSchema).optional(),
  includeHeuristicEdges: z.boolean().optional(),
}).strict() satisfies z.ZodType<GraphPathToolInput>;

export interface GraphPathToolOutput {
  toolName: "graph_path";
  projectId: string;
  result: GraphPathResult;
}

export const GraphPathToolOutputSchema = z.object({
  toolName: z.literal("graph_path"),
  projectId: z.string().min(1),
  result: GraphPathResultSchema,
}) satisfies z.ZodType<GraphPathToolOutput>;

export interface FlowMapToolInput extends ProjectLocatorInput {
  startEntity: GraphNodeLocator;
  targetEntity: GraphNodeLocator;
  direction?: GraphTraversalDirection;
  traversalDepth?: number;
  edgeKinds?: GraphEdgeKind[];
  includeHeuristicEdges?: boolean;
}

export const FlowMapToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  startEntity: GraphNodeLocatorSchema,
  targetEntity: GraphNodeLocatorSchema,
  direction: GraphTraversalDirectionSchema.optional(),
  traversalDepth: z.number().int().positive().max(8).optional(),
  edgeKinds: z.array(GraphEdgeKindSchema).optional(),
  includeHeuristicEdges: z.boolean().optional(),
}).strict() satisfies z.ZodType<FlowMapToolInput>;

export interface FlowMapToolOutput {
  toolName: "flow_map";
  projectId: string;
  result: FlowMapResult;
}

export const FlowMapToolOutputSchema = z.object({
  toolName: z.literal("flow_map"),
  projectId: z.string().min(1),
  result: FlowMapResultSchema,
}) satisfies z.ZodType<FlowMapToolOutput>;

export interface ChangePlanToolInput extends ProjectLocatorInput {
  startEntity: GraphNodeLocator;
  targetEntity: GraphNodeLocator;
  direction?: GraphTraversalDirection;
  traversalDepth?: number;
  edgeKinds?: GraphEdgeKind[];
  includeHeuristicEdges?: boolean;
}

export const ChangePlanToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  startEntity: GraphNodeLocatorSchema,
  targetEntity: GraphNodeLocatorSchema,
  direction: GraphTraversalDirectionSchema.optional(),
  traversalDepth: z.number().int().positive().max(8).optional(),
  edgeKinds: z.array(GraphEdgeKindSchema).optional(),
  includeHeuristicEdges: z.boolean().optional(),
}).strict() satisfies z.ZodType<ChangePlanToolInput>;

export interface ChangePlanToolOutput {
  toolName: "change_plan";
  projectId: string;
  result: ChangePlanResult;
}

export const ChangePlanToolOutputSchema = z.object({
  toolName: z.literal("change_plan"),
  projectId: z.string().min(1),
  result: ChangePlanResultSchema,
}) satisfies z.ZodType<ChangePlanToolOutput>;

export interface TenantLeakAuditToolInput extends ProjectLocatorInput {
  acknowledgeAdvisory: true;
  freshen?: boolean;
}

export const TenantLeakAuditToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  acknowledgeAdvisory: z.literal(true),
  freshen: z.boolean().optional(),
}).strict() satisfies z.ZodType<TenantLeakAuditToolInput>;

export interface TenantLeakAuditToolOutput {
  toolName: "tenant_leak_audit";
  projectId: string;
  result: TenantLeakAuditResult;
}

export const TenantLeakAuditToolOutputSchema = z.object({
  toolName: z.literal("tenant_leak_audit"),
  projectId: z.string().min(1),
  result: TenantLeakAuditResultSchema,
}) satisfies z.ZodType<TenantLeakAuditToolOutput>;

export interface SessionHandoffToolInput extends ProjectLocatorInput {
  limit?: number;
}

export const SessionHandoffToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  limit: z.number().int().positive().max(32).optional(),
}).strict() satisfies z.ZodType<SessionHandoffToolInput>;

export interface SessionHandoffToolOutput {
  toolName: "session_handoff";
  projectId: string;
  result: SessionHandoffResult;
}

export const SessionHandoffToolOutputSchema = z.object({
  toolName: z.literal("session_handoff"),
  projectId: z.string().min(1),
  result: SessionHandoffResultSchema,
}) satisfies z.ZodType<SessionHandoffToolOutput>;

export interface HealthTrendToolInput extends ProjectLocatorInput {
  limit?: number;
}

export const HealthTrendToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  limit: z.number().int().positive().max(32).optional(),
}).strict() satisfies z.ZodType<HealthTrendToolInput>;

export interface HealthTrendToolOutput {
  toolName: "health_trend";
  projectId: string;
  result: HealthTrendResult;
}

export const HealthTrendToolOutputSchema = z.object({
  toolName: z.literal("health_trend"),
  projectId: z.string().min(1),
  result: HealthTrendResultSchema,
}) satisfies z.ZodType<HealthTrendToolOutput>;

export interface IssuesNextToolInput extends ProjectLocatorInput {
  limit?: number;
}

export const IssuesNextToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  limit: z.number().int().positive().max(32).optional(),
}).strict() satisfies z.ZodType<IssuesNextToolInput>;

export interface IssuesNextToolOutput {
  toolName: "issues_next";
  projectId: string;
  result: IssuesNextResult;
}

export const IssuesNextToolOutputSchema = z.object({
  toolName: z.literal("issues_next"),
  projectId: z.string().min(1),
  result: IssuesNextResultSchema,
}) satisfies z.ZodType<IssuesNextToolOutput>;

export interface SuggestToolInput extends ProjectLocatorInput, InvestigationCommonInput {
  maxSteps?: number;
}

export const SuggestToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  question: InvestigationCommonInputSchema.shape.question,
  startEntity: InvestigationCommonInputSchema.shape.startEntity,
  targetEntity: InvestigationCommonInputSchema.shape.targetEntity,
  direction: InvestigationCommonInputSchema.shape.direction,
  traversalDepth: InvestigationCommonInputSchema.shape.traversalDepth,
  includeHeuristicEdges: InvestigationCommonInputSchema.shape.includeHeuristicEdges,
  maxSteps: z.number().int().positive().max(3).optional(),
}).strict() satisfies z.ZodType<SuggestToolInput>;

export interface SuggestToolOutput {
  toolName: "suggest";
  projectId: string;
  result: SuggestResult;
}

export const SuggestToolOutputSchema = z.object({
  toolName: z.literal("suggest"),
  projectId: z.string().min(1),
  result: SuggestResultSchema,
}) satisfies z.ZodType<SuggestToolOutput>;

export interface InvestigateToolInput extends ProjectLocatorInput, InvestigationCommonInput {
  budget?: number;
}

export const InvestigateToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  question: InvestigationCommonInputSchema.shape.question,
  startEntity: InvestigationCommonInputSchema.shape.startEntity,
  targetEntity: InvestigationCommonInputSchema.shape.targetEntity,
  direction: InvestigationCommonInputSchema.shape.direction,
  traversalDepth: InvestigationCommonInputSchema.shape.traversalDepth,
  includeHeuristicEdges: InvestigationCommonInputSchema.shape.includeHeuristicEdges,
  budget: z.number().int().positive().max(5).optional(),
}).strict() satisfies z.ZodType<InvestigateToolInput>;

export interface InvestigateToolOutput {
  toolName: "investigate";
  projectId: string;
  result: InvestigateResult;
}

export const InvestigateToolOutputSchema = z.object({
  toolName: z.literal("investigate"),
  projectId: z.string().min(1),
  result: InvestigateResultSchema,
}) satisfies z.ZodType<InvestigateToolOutput>;

