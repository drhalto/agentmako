import { z } from "zod";
import type { JsonObject, Timestamp } from "./common.js";
import {
  type WorkflowPacketFollowOnHint,
  WorkflowPacketFollowOnHintSchema,
} from "./workflow-follow-on.js";

const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;

export type GraphNodeKind =
  | "file"
  | "symbol"
  | "route"
  | "rpc"
  | "table"
  | "policy"
  | "trigger"
  | "edge_function"
  | "auth_boundary";

export type GraphEdgeKind =
  | "imports"
  | "exports"
  | "declares_symbol"
  | "serves_route"
  | "calls_rpc"
  | "touches_table"
  | "has_rls_policy"
  | "has_trigger"
  | "invokes_edge"
  | "references_auth_boundary";

export type GraphEdgeExactness = "exact" | "heuristic";

export type GraphEdgeInventoryStatus = "emitted" | "inventory_only";
export type GraphTraversalDirection = "upstream" | "downstream" | "both";
export type GraphPathNoPathReason =
  | "start_not_resolved"
  | "target_not_resolved"
  | "no_exact_path"
  | "depth_exceeded"
  | "disconnected";
export type FlowMapBoundaryKind =
  | "entry"
  | "file"
  | "symbol"
  | "route"
  | "rpc"
  | "data"
  | "policy"
  | "trigger"
  | "generic";
export type ChangePlanSurfaceRole = "direct" | "dependent";

export interface GraphNode {
  nodeId: string;
  kind: GraphNodeKind;
  key: string;
  label: string;
  sourceRef?: string;
  metadata?: JsonObject;
}

export interface GraphEdgeProvenance {
  source: string;
  sourceObjectId?: string | null;
  evidenceRefs: string[];
}

export interface GraphEdge {
  edgeId: string;
  kind: GraphEdgeKind;
  fromNodeId: string;
  toNodeId: string;
  exactness: GraphEdgeExactness;
  provenance: GraphEdgeProvenance;
  metadata?: JsonObject;
}

export interface GraphEdgeInventoryEntry {
  kind: GraphEdgeKind;
  exactness: GraphEdgeExactness;
  firstSliceStatus: GraphEdgeInventoryStatus;
  source: string;
  evidenceShape: string[];
}

export type GraphSliceDerivationStrategy = "whole_project";

export interface GraphSliceBasis {
  strategy: GraphSliceDerivationStrategy;
  latestIndexRunId?: string | null;
  schemaSnapshotId?: string | null;
  schemaFingerprint?: string | null;
}

export interface GraphSlice {
  derivedAt: Timestamp;
  basis: GraphSliceBasis;
  nodes: GraphNode[];
  edges: GraphEdge[];
  inventory: GraphEdgeInventoryEntry[];
  warnings: string[];
}

export interface GraphNodeLocator {
  kind: GraphNodeKind;
  key: string;
}

export interface GraphPathHop {
  hopIndex: number;
  direction: Exclude<GraphTraversalDirection, "both">;
  fromNode: GraphNode;
  toNode: GraphNode;
  edge: GraphEdge;
  explanation: string;
}

export interface GraphNeighborMatch {
  node: GraphNode;
  distance: number;
  via: GraphPathHop[];
  containsHeuristicEdge: boolean;
}

export interface GraphNeighborsResult {
  requestedStartEntities: GraphNodeLocator[];
  resolvedStartNodes: GraphNode[];
  missingStartEntities: GraphNodeLocator[];
  suggestedStartEntities?: GraphNodeLocator[];
  direction: GraphTraversalDirection;
  traversalDepth: number;
  includeHeuristicEdges: boolean;
  appliedNodeKinds?: GraphNodeKind[];
  appliedEdgeKinds?: GraphEdgeKind[];
  neighbors: GraphNeighborMatch[];
  graphBasis: GraphSliceBasis;
  warnings: string[];
}

export interface GraphPathResult {
  requestedStartEntity: GraphNodeLocator;
  requestedTargetEntity: GraphNodeLocator;
  resolvedStartNode?: GraphNode;
  resolvedTargetNode?: GraphNode;
  direction: GraphTraversalDirection;
  traversalDepth: number;
  includeHeuristicEdges: boolean;
  pathFound: boolean;
  noPathReason?: GraphPathNoPathReason;
  hops: GraphPathHop[];
  containsHeuristicEdge: boolean;
  graphBasis: GraphSliceBasis;
  warnings: string[];
}

export interface FlowMapStep {
  stepIndex: number;
  node: GraphNode;
  boundary: FlowMapBoundaryKind;
  reachedViaHop?: GraphPathHop;
}

export interface FlowMapTransition {
  transitionId: string;
  hop: GraphPathHop;
  boundary: FlowMapBoundaryKind;
}

export interface FlowMapResult {
  requestedStartEntity: GraphNodeLocator;
  requestedTargetEntity: GraphNodeLocator;
  resolvedStartNode?: GraphNode;
  resolvedTargetNode?: GraphNode;
  direction: GraphTraversalDirection;
  traversalDepth: number;
  includeHeuristicEdges: boolean;
  pathFound: boolean;
  noPathReason?: GraphPathNoPathReason;
  steps: FlowMapStep[];
  transitions: FlowMapTransition[];
  majorBoundaryKinds: FlowMapBoundaryKind[];
  containsHeuristicEdge: boolean;
  graphBasis: GraphSliceBasis;
  warnings: string[];
}

export interface ChangePlanSurface {
  surfaceId: string;
  node: GraphNode;
  role: ChangePlanSurfaceRole;
  distance: number;
  rationale: string;
  via: GraphPathHop[];
  containsHeuristicEdge: boolean;
}

export interface ChangePlanStep {
  stepId: string;
  title: string;
  surfaceId: string;
  dependsOnStepIds: string[];
  rationale: string;
}

export interface ChangePlanResult {
  requestedStartEntity: GraphNodeLocator;
  requestedTargetEntity: GraphNodeLocator;
  resolvedStartNode?: GraphNode;
  resolvedTargetNode?: GraphNode;
  direction: GraphTraversalDirection;
  traversalDepth: number;
  includeHeuristicEdges: boolean;
  pathFound: boolean;
  noPathReason?: GraphPathNoPathReason;
  directSurfaces: ChangePlanSurface[];
  dependentSurfaces: ChangePlanSurface[];
  steps: ChangePlanStep[];
  recommendedFollowOn?: WorkflowPacketFollowOnHint;
  containsHeuristicEdge: boolean;
  graphBasis: GraphSliceBasis;
  warnings: string[];
}

export const GRAPH_EDGE_INVENTORY: readonly GraphEdgeInventoryEntry[] = [
  {
    kind: "imports",
    exactness: "exact",
    firstSliceStatus: "emitted",
    source: "project_store.listAllImportEdges",
    evidenceShape: ["source file path", "import line", "resolved target file path"],
  },
  {
    kind: "exports",
    exactness: "exact",
    firstSliceStatus: "emitted",
    source: "project_store.listFiles + project_store.listSymbolsForFile",
    evidenceShape: ["file path", "exported symbol line", "export name"],
  },
  {
    kind: "declares_symbol",
    exactness: "exact",
    firstSliceStatus: "emitted",
    source: "project_store.listFiles + project_store.listSymbolsForFile",
    evidenceShape: ["file path", "symbol line", "symbol name"],
  },
  {
    kind: "serves_route",
    exactness: "exact",
    firstSliceStatus: "emitted",
    source: "project_store.listRoutes",
    evidenceShape: ["route key", "route file path", "handler name when available"],
  },
  {
    kind: "calls_rpc",
    exactness: "heuristic",
    firstSliceStatus: "emitted",
    source: "project_store.listSchemaUsages",
    evidenceShape: [
      "usage file path",
      "usage line",
      "RPC name without guaranteed overload resolution",
    ],
  },
  {
    kind: "touches_table",
    exactness: "exact",
    firstSliceStatus: "emitted",
    source: "project_store.listFunctionTableRefs",
    evidenceShape: ["RPC schema/name/signature", "target schema", "target table"],
  },
  {
    kind: "has_rls_policy",
    exactness: "exact",
    firstSliceStatus: "emitted",
    source: "project_store.loadSchemaSnapshot",
    evidenceShape: ["table schema/name", "policy name", "policy command"],
  },
  {
    kind: "has_trigger",
    exactness: "exact",
    firstSliceStatus: "emitted",
    source: "project_store.loadSchemaSnapshot",
    evidenceShape: ["table schema/name", "trigger name", "trigger timing/events"],
  },
  {
    kind: "invokes_edge",
    exactness: "heuristic",
    firstSliceStatus: "inventory_only",
    source: "trace_edge evidence + route/file conventions",
    evidenceShape: ["edge entry file path", "symbol/route context", "matching edge handler name when available"],
  },
  {
    kind: "references_auth_boundary",
    exactness: "heuristic",
    firstSliceStatus: "inventory_only",
    source: "project profile auth guards + auth_path evidence",
    evidenceShape: ["middleware or guard symbol path", "auth_path evidence refs", "guard symbol name when available"],
  },
] as const;

export const GraphNodeKindSchema = z.enum([
  "file",
  "symbol",
  "route",
  "rpc",
  "table",
  "policy",
  "trigger",
  "edge_function",
  "auth_boundary",
]);

export const GraphEdgeKindSchema = z.enum([
  "imports",
  "exports",
  "declares_symbol",
  "serves_route",
  "calls_rpc",
  "touches_table",
  "has_rls_policy",
  "has_trigger",
  "invokes_edge",
  "references_auth_boundary",
]);

export const GraphEdgeExactnessSchema = z.enum(["exact", "heuristic"]);
export const GraphEdgeInventoryStatusSchema = z.enum(["emitted", "inventory_only"]);
export const GraphSliceDerivationStrategySchema = z.enum(["whole_project"]);
export const GraphTraversalDirectionSchema = z.enum(["upstream", "downstream", "both"]);
export const GraphPathNoPathReasonSchema = z.enum([
  "start_not_resolved",
  "target_not_resolved",
  "no_exact_path",
  "depth_exceeded",
  "disconnected",
]);
export const FlowMapBoundaryKindSchema = z.enum([
  "entry",
  "file",
  "symbol",
  "route",
  "rpc",
  "data",
  "policy",
  "trigger",
  "generic",
]);
export const ChangePlanSurfaceRoleSchema = z.enum(["direct", "dependent"]);

export const GraphNodeSchema: z.ZodType<GraphNode> = z.object({
  nodeId: z.string().trim().min(1),
  kind: GraphNodeKindSchema,
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  sourceRef: z.string().trim().min(1).optional(),
  metadata: JsonObjectSchema.optional(),
});

export const GraphEdgeProvenanceSchema: z.ZodType<GraphEdgeProvenance> = z.object({
  source: z.string().trim().min(1),
  sourceObjectId: z.string().trim().min(1).nullable().optional(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
});

export const GraphEdgeSchema: z.ZodType<GraphEdge> = z.object({
  edgeId: z.string().trim().min(1),
  kind: GraphEdgeKindSchema,
  fromNodeId: z.string().trim().min(1),
  toNodeId: z.string().trim().min(1),
  exactness: GraphEdgeExactnessSchema,
  provenance: GraphEdgeProvenanceSchema,
  metadata: JsonObjectSchema.optional(),
});

export const GraphEdgeInventoryEntrySchema: z.ZodType<GraphEdgeInventoryEntry> = z.object({
  kind: GraphEdgeKindSchema,
  exactness: GraphEdgeExactnessSchema,
  firstSliceStatus: GraphEdgeInventoryStatusSchema,
  source: z.string().trim().min(1),
  evidenceShape: z.array(z.string().trim().min(1)).min(1),
});

export const GraphSliceBasisSchema: z.ZodType<GraphSliceBasis> = z.object({
  strategy: GraphSliceDerivationStrategySchema,
  latestIndexRunId: z.string().trim().min(1).nullable().optional(),
  schemaSnapshotId: z.string().trim().min(1).nullable().optional(),
  schemaFingerprint: z.string().trim().min(1).nullable().optional(),
});

export const GraphSliceSchema: z.ZodType<GraphSlice> = z.object({
  derivedAt: z.string().trim().min(1),
  basis: GraphSliceBasisSchema,
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  inventory: z.array(GraphEdgeInventoryEntrySchema),
  warnings: z.array(z.string().trim().min(1)),
});

export const GraphNodeLocatorSchema: z.ZodType<GraphNodeLocator> = z.object({
  kind: GraphNodeKindSchema,
  key: z.string().trim().min(1),
});

export const GraphPathHopSchema: z.ZodType<GraphPathHop> = z.object({
  hopIndex: z.number().int().nonnegative(),
  direction: z.enum(["upstream", "downstream"]),
  fromNode: GraphNodeSchema,
  toNode: GraphNodeSchema,
  edge: GraphEdgeSchema,
  explanation: z.string().trim().min(1),
});

export const GraphNeighborMatchSchema: z.ZodType<GraphNeighborMatch> = z.object({
  node: GraphNodeSchema,
  distance: z.number().int().positive(),
  via: z.array(GraphPathHopSchema),
  containsHeuristicEdge: z.boolean(),
});

export const GraphNeighborsResultSchema: z.ZodType<GraphNeighborsResult> = z.object({
  requestedStartEntities: z.array(GraphNodeLocatorSchema),
  resolvedStartNodes: z.array(GraphNodeSchema),
  missingStartEntities: z.array(GraphNodeLocatorSchema),
  suggestedStartEntities: z.array(GraphNodeLocatorSchema).optional(),
  direction: GraphTraversalDirectionSchema,
  traversalDepth: z.number().int().positive(),
  includeHeuristicEdges: z.boolean(),
  appliedNodeKinds: z.array(GraphNodeKindSchema).optional(),
  appliedEdgeKinds: z.array(GraphEdgeKindSchema).optional(),
  neighbors: z.array(GraphNeighborMatchSchema),
  graphBasis: GraphSliceBasisSchema,
  warnings: z.array(z.string().trim().min(1)),
});

export const GraphPathResultSchema: z.ZodType<GraphPathResult> = z.object({
  requestedStartEntity: GraphNodeLocatorSchema,
  requestedTargetEntity: GraphNodeLocatorSchema,
  resolvedStartNode: GraphNodeSchema.optional(),
  resolvedTargetNode: GraphNodeSchema.optional(),
  direction: GraphTraversalDirectionSchema,
  traversalDepth: z.number().int().positive(),
  includeHeuristicEdges: z.boolean(),
  pathFound: z.boolean(),
  noPathReason: GraphPathNoPathReasonSchema.optional(),
  hops: z.array(GraphPathHopSchema),
  containsHeuristicEdge: z.boolean(),
  graphBasis: GraphSliceBasisSchema,
  warnings: z.array(z.string().trim().min(1)),
});

export const FlowMapStepSchema: z.ZodType<FlowMapStep> = z.object({
  stepIndex: z.number().int().nonnegative(),
  node: GraphNodeSchema,
  boundary: FlowMapBoundaryKindSchema,
  reachedViaHop: GraphPathHopSchema.optional(),
});

export const FlowMapTransitionSchema: z.ZodType<FlowMapTransition> = z.object({
  transitionId: z.string().trim().min(1),
  hop: GraphPathHopSchema,
  boundary: FlowMapBoundaryKindSchema,
});

export const FlowMapResultSchema: z.ZodType<FlowMapResult> = z.object({
  requestedStartEntity: GraphNodeLocatorSchema,
  requestedTargetEntity: GraphNodeLocatorSchema,
  resolvedStartNode: GraphNodeSchema.optional(),
  resolvedTargetNode: GraphNodeSchema.optional(),
  direction: GraphTraversalDirectionSchema,
  traversalDepth: z.number().int().positive(),
  includeHeuristicEdges: z.boolean(),
  pathFound: z.boolean(),
  noPathReason: GraphPathNoPathReasonSchema.optional(),
  steps: z.array(FlowMapStepSchema),
  transitions: z.array(FlowMapTransitionSchema),
  majorBoundaryKinds: z.array(FlowMapBoundaryKindSchema),
  containsHeuristicEdge: z.boolean(),
  graphBasis: GraphSliceBasisSchema,
  warnings: z.array(z.string().trim().min(1)),
});

export const ChangePlanSurfaceSchema: z.ZodType<ChangePlanSurface> = z.object({
  surfaceId: z.string().trim().min(1),
  node: GraphNodeSchema,
  role: ChangePlanSurfaceRoleSchema,
  distance: z.number().int().nonnegative(),
  rationale: z.string().trim().min(1),
  via: z.array(GraphPathHopSchema),
  containsHeuristicEdge: z.boolean(),
});

export const ChangePlanStepSchema: z.ZodType<ChangePlanStep> = z.object({
  stepId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  surfaceId: z.string().trim().min(1),
  dependsOnStepIds: z.array(z.string().trim().min(1)),
  rationale: z.string().trim().min(1),
});

export const ChangePlanResultSchema: z.ZodType<ChangePlanResult> = z.object({
  requestedStartEntity: GraphNodeLocatorSchema,
  requestedTargetEntity: GraphNodeLocatorSchema,
  resolvedStartNode: GraphNodeSchema.optional(),
  resolvedTargetNode: GraphNodeSchema.optional(),
  direction: GraphTraversalDirectionSchema,
  traversalDepth: z.number().int().positive(),
  includeHeuristicEdges: z.boolean(),
  pathFound: z.boolean(),
  noPathReason: GraphPathNoPathReasonSchema.optional(),
  directSurfaces: z.array(ChangePlanSurfaceSchema),
  dependentSurfaces: z.array(ChangePlanSurfaceSchema),
  steps: z.array(ChangePlanStepSchema),
  recommendedFollowOn: WorkflowPacketFollowOnHintSchema.optional(),
  containsHeuristicEdge: z.boolean(),
  graphBasis: GraphSliceBasisSchema,
  warnings: z.array(z.string().trim().min(1)),
});
