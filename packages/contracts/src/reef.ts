import { z } from "zod";
import type { JsonObject, Timestamp } from "./common.js";
import { JsonObjectSchema, TimestampSchema } from "./tool-schema-shared.js";

export const PROJECT_OVERLAYS = ["indexed", "working_tree", "staged", "preview"] as const;
export type ProjectOverlay = (typeof PROJECT_OVERLAYS)[number];
export const ProjectOverlaySchema = z.enum(PROJECT_OVERLAYS);

export const REEF_SEVERITIES = ["info", "warning", "error"] as const;
export type ReefSeverity = (typeof REEF_SEVERITIES)[number];
export const ReefSeveritySchema = z.enum(REEF_SEVERITIES);

export const PROJECT_FINDING_STATUSES = ["active", "resolved", "acknowledged", "suppressed"] as const;
export type ProjectFindingStatus = (typeof PROJECT_FINDING_STATUSES)[number];
export const ProjectFindingStatusSchema = z.enum(PROJECT_FINDING_STATUSES);

export const FACT_FRESHNESS_STATES = ["fresh", "stale", "unknown"] as const;
export type FactFreshnessState = (typeof FACT_FRESHNESS_STATES)[number];
export const FactFreshnessStateSchema = z.enum(FACT_FRESHNESS_STATES);

export const REEF_DIAGNOSTIC_RUN_STATUSES = ["unavailable", "ran_with_error", "succeeded"] as const;
export type ReefDiagnosticRunStatus = (typeof REEF_DIAGNOSTIC_RUN_STATUSES)[number];
export const ReefDiagnosticRunStatusSchema = z.enum(REEF_DIAGNOSTIC_RUN_STATUSES);

export const REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS = 30 * 60 * 1000;
export const REEF_DIAGNOSTIC_CACHE_STATES = ["fresh", "stale", "unknown"] as const;
export type ReefDiagnosticCacheState = (typeof REEF_DIAGNOSTIC_CACHE_STATES)[number];
export const ReefDiagnosticCacheStateSchema = z.enum(REEF_DIAGNOSTIC_CACHE_STATES);

export interface FactFreshness {
  state: FactFreshnessState;
  checkedAt: Timestamp;
  reason: string;
}

export const FactFreshnessSchema = z.object({
  state: FactFreshnessStateSchema,
  checkedAt: TimestampSchema,
  reason: z.string().min(1),
}) satisfies z.ZodType<FactFreshness>;

export type FactSubject =
  | { kind: "file"; path: string }
  | { kind: "symbol"; path: string; symbolName: string; line?: number }
  | { kind: "route"; routeKey: string }
  | { kind: "schema_object"; schemaName: string; objectName: string }
  | { kind: "import_edge"; sourcePath: string; targetPath: string }
  | { kind: "diagnostic"; path: string; ruleId?: string; code?: string };

export const FactSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1) }),
  z.object({
    kind: z.literal("symbol"),
    path: z.string().min(1),
    symbolName: z.string().min(1),
    line: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal("route"), routeKey: z.string().min(1) }),
  z.object({
    kind: z.literal("schema_object"),
    schemaName: z.string().min(1),
    objectName: z.string().min(1),
  }),
  z.object({
    kind: z.literal("import_edge"),
    sourcePath: z.string().min(1),
    targetPath: z.string().min(1),
  }),
  z.object({
    kind: z.literal("diagnostic"),
    path: z.string().min(1),
    ruleId: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
  }),
]) satisfies z.ZodType<FactSubject>;

export type ReefCalculationDependency =
  | { kind: "file"; path: string }
  | { kind: "glob"; pattern: string }
  | { kind: "fact_kind"; factKind: string }
  | { kind: "config"; path: string }
  | { kind: "artifact_kind"; artifactKind: string; extractorVersion?: string }
  | { kind: "diagnostic_source"; source: string }
  | { kind: "schema_snapshot"; source?: string }
  | { kind: "git_index" };

export const ReefCalculationDependencySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1) }),
  z.object({ kind: z.literal("glob"), pattern: z.string().min(1) }),
  z.object({ kind: z.literal("fact_kind"), factKind: z.string().min(1) }),
  z.object({ kind: z.literal("config"), path: z.string().min(1) }),
  z.object({
    kind: z.literal("artifact_kind"),
    artifactKind: z.string().min(1),
    extractorVersion: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("diagnostic_source"), source: z.string().min(1) }),
  z.object({ kind: z.literal("schema_snapshot"), source: z.string().min(1).optional() }),
  z.object({ kind: z.literal("git_index") }),
]) satisfies z.ZodType<ReefCalculationDependency>;

export const REEF_CALCULATION_NODE_KINDS = [
  "input",
  "derived_query",
  "fact_writer",
  "artifact_writer",
] as const;
export type ReefCalculationNodeKind = (typeof REEF_CALCULATION_NODE_KINDS)[number];
export const ReefCalculationNodeKindSchema = z.enum(REEF_CALCULATION_NODE_KINDS);

export const REEF_CALCULATION_REFRESH_SCOPES = [
  "path_scoped",
  "source_scoped",
  "project_scoped",
] as const;
export type ReefCalculationRefreshScope = (typeof REEF_CALCULATION_REFRESH_SCOPES)[number];
export const ReefCalculationRefreshScopeSchema = z.enum(REEF_CALCULATION_REFRESH_SCOPES);

export const REEF_CALCULATION_FALLBACKS = [
  "drop",
  "mark_stale",
  "full_refresh",
] as const;
export type ReefCalculationFallback = (typeof REEF_CALCULATION_FALLBACKS)[number];
export const ReefCalculationFallbackSchema = z.enum(REEF_CALCULATION_FALLBACKS);

export const REEF_CALCULATION_DURABILITY_TIERS = ["high", "low"] as const;
export type ReefCalculationDurabilityTier = (typeof REEF_CALCULATION_DURABILITY_TIERS)[number];
export const ReefCalculationDurabilityTierSchema = z.enum(REEF_CALCULATION_DURABILITY_TIERS);

export type ReefCalculationOutput =
  | { kind: "fact"; factKind: string }
  | { kind: "finding"; source: string }
  | { kind: "artifact"; artifactKind: string; extractorVersion: string }
  | { kind: "query"; queryKind: string };

export const ReefCalculationOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fact"), factKind: z.string().min(1) }),
  z.object({ kind: z.literal("finding"), source: z.string().min(1) }),
  z.object({
    kind: z.literal("artifact"),
    artifactKind: z.string().min(1),
    extractorVersion: z.string().min(1),
  }),
  z.object({ kind: z.literal("query"), queryKind: z.string().min(1) }),
]) satisfies z.ZodType<ReefCalculationOutput>;

export type ReefCalculationBackdating =
  | { strategy: "none" }
  | { strategy: "output_fingerprint"; equalityKeys?: string[] }
  | {
      strategy: "structural_changed_ranges";
      relevantRangeKinds: string[];
      equalityKeys?: string[];
    };

export const ReefCalculationBackdatingSchema = z.discriminatedUnion("strategy", [
  z.object({ strategy: z.literal("none") }),
  z.object({
    strategy: z.literal("output_fingerprint"),
    equalityKeys: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    strategy: z.literal("structural_changed_ranges"),
    relevantRangeKinds: z.array(z.string().min(1)).min(1),
    equalityKeys: z.array(z.string().min(1)).optional(),
  }),
]) satisfies z.ZodType<ReefCalculationBackdating>;

export interface ReefCalculationNode {
  id: string;
  kind: ReefCalculationNodeKind;
  version?: string;
  description?: string;
  outputs: ReefCalculationOutput[];
  dependsOn: ReefCalculationDependency[];
  refreshScope: ReefCalculationRefreshScope;
  fallback: ReefCalculationFallback;
  durability: ReefCalculationDurabilityTier;
  backdating: ReefCalculationBackdating;
}

export const ReefCalculationNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: ReefCalculationNodeKindSchema,
    version: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    outputs: z.array(ReefCalculationOutputSchema).min(1),
    dependsOn: z.array(ReefCalculationDependencySchema),
    refreshScope: ReefCalculationRefreshScopeSchema,
    fallback: ReefCalculationFallbackSchema,
    durability: ReefCalculationDurabilityTierSchema,
    backdating: ReefCalculationBackdatingSchema,
  })
  .superRefine((node, ctx) => {
    if (node.kind !== "input" && node.dependsOn.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dependsOn"],
        message: "non-input calculation nodes must declare at least one dependency",
      });
    }

    if (
      node.kind === "artifact_writer" &&
      !node.outputs.some((output) => output.kind === "artifact")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputs"],
        message: "artifact_writer nodes must produce at least one artifact output",
      });
    }

    if (
      node.refreshScope === "path_scoped" &&
      !node.dependsOn.some((dependency) => dependency.kind === "file" || dependency.kind === "glob")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dependsOn"],
        message: "path_scoped calculation nodes must declare a file or glob dependency",
      });
    }

    if (
      node.backdating.strategy === "structural_changed_ranges" &&
      !node.dependsOn.some((dependency) => dependency.kind === "file" || dependency.kind === "glob")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["backdating"],
        message: "structural changed-range backdating requires a file or glob dependency",
      });
    }
  }) satisfies z.ZodType<ReefCalculationNode>;

export function reefCalculationDependencyKey(dependency: ReefCalculationDependency): string {
  switch (dependency.kind) {
    case "file":
      return `file:${dependency.path}`;
    case "glob":
      return `glob:${dependency.pattern}`;
    case "fact_kind":
      return `fact:${dependency.factKind}`;
    case "config":
      return `config:${dependency.path}`;
    case "artifact_kind":
      return `artifact:${dependency.artifactKind}:${dependency.extractorVersion ?? ""}`;
    case "diagnostic_source":
      return `diagnostic:${dependency.source}`;
    case "schema_snapshot":
      return `schema_snapshot:${dependency.source ?? ""}`;
    case "git_index":
      return "git_index";
  }
}

export function reefCalculationOutputKey(output: ReefCalculationOutput): string {
  switch (output.kind) {
    case "fact":
      return `fact:${output.factKind}`;
    case "finding":
      return `finding:${output.source}`;
    case "artifact":
      return `artifact:${output.artifactKind}:${output.extractorVersion}`;
    case "query":
      return `query:${output.queryKind}`;
  }
}

export class ReefCalculationRegistry {
  private readonly nodesById = new Map<string, ReefCalculationNode>();
  private readonly nodeIdsByOutput = new Map<string, string>();
  private readonly nodeIdsByDependency = new Map<string, Set<string>>();

  constructor(nodes: ReefCalculationNode[] = []) {
    for (const node of nodes) {
      this.register(node);
    }
  }

  register(input: ReefCalculationNode): ReefCalculationNode {
    const node = ReefCalculationNodeSchema.parse(input);
    if (this.nodesById.has(node.id)) {
      throw new Error(`Reef calculation node already registered: ${node.id}`);
    }

    for (const output of node.outputs) {
      const outputKey = reefCalculationOutputKey(output);
      const existingNodeId = this.nodeIdsByOutput.get(outputKey);
      if (existingNodeId) {
        throw new Error(
          `Reef calculation output ${outputKey} is already produced by ${existingNodeId}`,
        );
      }
    }

    this.nodesById.set(node.id, node);
    for (const output of node.outputs) {
      this.nodeIdsByOutput.set(reefCalculationOutputKey(output), node.id);
    }
    for (const dependency of node.dependsOn) {
      const dependencyKey = reefCalculationDependencyKey(dependency);
      const nodeIds = this.nodeIdsByDependency.get(dependencyKey) ?? new Set<string>();
      nodeIds.add(node.id);
      this.nodeIdsByDependency.set(dependencyKey, nodeIds);
    }
    return node;
  }

  get(nodeId: string): ReefCalculationNode | undefined {
    return this.nodesById.get(nodeId);
  }

  list(): ReefCalculationNode[] {
    return [...this.nodesById.values()];
  }

  findProducer(output: ReefCalculationOutput): ReefCalculationNode | undefined {
    const nodeId = this.nodeIdsByOutput.get(reefCalculationOutputKey(output));
    return nodeId ? this.nodesById.get(nodeId) : undefined;
  }

  findDependents(dependency: ReefCalculationDependency): ReefCalculationNode[] {
    const nodeIds = this.nodeIdsByDependency.get(reefCalculationDependencyKey(dependency));
    if (!nodeIds) {
      return [];
    }
    return [...nodeIds]
      .map((nodeId) => this.nodesById.get(nodeId))
      .filter((node): node is ReefCalculationNode => node != null);
  }
}

export interface ReefCalculationExecutionNode {
  nodeId: string;
  kind: ReefCalculationNodeKind;
  refreshScope: ReefCalculationRefreshScope;
  fallback: ReefCalculationFallback;
  durability: ReefCalculationDurabilityTier;
  dependencyKeys: string[];
  outputKeys: string[];
}

export const ReefCalculationExecutionNodeSchema = z.object({
  nodeId: z.string().min(1),
  kind: ReefCalculationNodeKindSchema,
  refreshScope: ReefCalculationRefreshScopeSchema,
  fallback: ReefCalculationFallbackSchema,
  durability: ReefCalculationDurabilityTierSchema,
  dependencyKeys: z.array(z.string().min(1)),
  outputKeys: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefCalculationExecutionNode>;

export interface ReefCalculationExecutionPlan {
  refreshMode: "path_scoped" | "full";
  decisionReason: string;
  fallbackReason?: string;
  inputDependencyKeys: string[];
  changedPaths: string[];
  affectedNodes: ReefCalculationExecutionNode[];
}

export const ReefCalculationExecutionPlanSchema = z.object({
  refreshMode: z.enum(["path_scoped", "full"]),
  decisionReason: z.string().min(1),
  fallbackReason: z.string().min(1).optional(),
  inputDependencyKeys: z.array(z.string().min(1)),
  changedPaths: z.array(z.string().min(1)),
  affectedNodes: z.array(ReefCalculationExecutionNodeSchema),
}) satisfies z.ZodType<ReefCalculationExecutionPlan>;

export interface FactProvenance {
  source: string;
  capturedAt: Timestamp;
  dependencies?: ReefCalculationDependency[];
  metadata?: JsonObject;
}

export const FactProvenanceSchema = z.object({
  source: z.string().min(1),
  capturedAt: TimestampSchema,
  dependencies: z.array(ReefCalculationDependencySchema).optional(),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<FactProvenance>;

export const REEF_GRAPH_NODE_KINDS = [
  "file",
  "symbol",
  "import",
  "export",
  "route",
  "component",
  "server_action",
  "table",
  "column",
  "index",
  "foreign_key",
  "rls_policy",
  "rpc",
  "trigger",
  "diagnostic",
  "finding",
  "rule",
  "convention",
  "instruction",
  "session",
  "patch",
  "test",
  "command",
  "database_object",
] as const;
export type ReefGraphNodeKind = (typeof REEF_GRAPH_NODE_KINDS)[number];
export const ReefGraphNodeKindSchema = z.enum(REEF_GRAPH_NODE_KINDS);

export const REEF_GRAPH_EDGE_KINDS = [
  "defines",
  "imports",
  "exports",
  "calls",
  "renders",
  "handles_route",
  "reads_table",
  "writes_table",
  "calls_rpc",
  "references_column",
  "protected_by_policy",
  "violates_rule",
  "verified_by",
  "depends_on",
  "resolved_by_patch",
  "similar_to",
  "duplicates_pattern",
  "acknowledged_as",
  "learned_from",
  "contains",
  "mentions",
] as const;
export type ReefGraphEdgeKind = (typeof REEF_GRAPH_EDGE_KINDS)[number];
export const ReefGraphEdgeKindSchema = z.enum(REEF_GRAPH_EDGE_KINDS);

export interface ReefGraphNode {
  id: string;
  kind: ReefGraphNodeKind;
  label: string;
  source: string;
  overlay?: ProjectOverlay;
  revision?: number;
  confidence: number;
  freshness: FactFreshness;
  provenance: FactProvenance;
  data?: JsonObject;
}

export const ReefGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: ReefGraphNodeKindSchema,
  label: z.string().min(1),
  source: z.string().min(1),
  overlay: ProjectOverlaySchema.optional(),
  revision: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1),
  freshness: FactFreshnessSchema,
  provenance: FactProvenanceSchema,
  data: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ReefGraphNode>;

export interface ReefGraphEdge {
  id: string;
  kind: ReefGraphEdgeKind;
  from: string;
  to: string;
  source: string;
  overlay?: ProjectOverlay;
  revision?: number;
  confidence: number;
  freshness: FactFreshness;
  provenance: FactProvenance;
  label?: string;
  data?: JsonObject;
}

export const ReefGraphEdgeSchema = z.object({
  id: z.string().min(1),
  kind: ReefGraphEdgeKindSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  source: z.string().min(1),
  overlay: ProjectOverlaySchema.optional(),
  revision: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1),
  freshness: FactFreshnessSchema,
  provenance: FactProvenanceSchema,
  label: z.string().min(1).optional(),
  data: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ReefGraphEdge>;

export interface ReefEvidenceGraphCoverage {
  nodeKinds: Record<string, number>;
  edgeKinds: Record<string, number>;
  sourceCounts: Record<string, number>;
}

export const ReefEvidenceGraphCoverageSchema = z.object({
  nodeKinds: z.record(z.string().min(1), z.number().int().nonnegative()),
  edgeKinds: z.record(z.string().min(1), z.number().int().nonnegative()),
  sourceCounts: z.record(z.string().min(1), z.number().int().nonnegative()),
}) satisfies z.ZodType<ReefEvidenceGraphCoverage>;

export interface ReefEvidenceGraphTruncation {
  nodes: boolean;
  edges: boolean;
  returnedNodes: number;
  totalNodes: number;
  droppedNodes: number;
  returnedEdges: number;
  totalEdges: number;
  droppedEdges: number;
  nodeLimit?: number;
  edgeLimit?: number;
}

export const ReefEvidenceGraphTruncationSchema = z.object({
  nodes: z.boolean(),
  edges: z.boolean(),
  returnedNodes: z.number().int().nonnegative(),
  totalNodes: z.number().int().nonnegative(),
  droppedNodes: z.number().int().nonnegative(),
  returnedEdges: z.number().int().nonnegative(),
  totalEdges: z.number().int().nonnegative(),
  droppedEdges: z.number().int().nonnegative(),
  nodeLimit: z.number().int().positive().optional(),
  edgeLimit: z.number().int().positive().optional(),
}) satisfies z.ZodType<ReefEvidenceGraphTruncation>;

export interface ReefEvidenceGraph {
  generatedAt: Timestamp;
  revision?: number;
  nodes: ReefGraphNode[];
  edges: ReefGraphEdge[];
  coverage: ReefEvidenceGraphCoverage;
  truncated: ReefEvidenceGraphTruncation;
  warnings: string[];
}

export const ReefEvidenceGraphSchema = z.object({
  generatedAt: TimestampSchema,
  revision: z.number().int().nonnegative().optional(),
  nodes: z.array(ReefGraphNodeSchema),
  edges: z.array(ReefGraphEdgeSchema),
  coverage: ReefEvidenceGraphCoverageSchema,
  truncated: ReefEvidenceGraphTruncationSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefEvidenceGraph>;

export interface ProjectFact {
  projectId: string;
  kind: string;
  subject: FactSubject;
  subjectFingerprint: string;
  overlay: ProjectOverlay;
  source: string;
  confidence: number;
  fingerprint: string;
  freshness: FactFreshness;
  provenance: FactProvenance;
  data?: JsonObject;
}

export const ProjectFactSchema = z.object({
  projectId: z.string().min(1),
  kind: z.string().min(1),
  subject: FactSubjectSchema,
  subjectFingerprint: z.string().min(1),
  overlay: ProjectOverlaySchema,
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fingerprint: z.string().min(1),
  freshness: FactFreshnessSchema,
  provenance: FactProvenanceSchema,
  data: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ProjectFact>;

export interface ProjectFindingSuggestedFix {
  kind: "edit" | "manual";
  description: string;
}

export const ProjectFindingSuggestedFixSchema = z.object({
  kind: z.enum(["edit", "manual"]),
  description: z.string().min(1),
}) satisfies z.ZodType<ProjectFindingSuggestedFix>;

export interface ProjectFinding {
  projectId: string;
  fingerprint: string;
  source: string;
  subjectFingerprint: string;
  overlay: ProjectOverlay;
  severity: ReefSeverity;
  status: ProjectFindingStatus;
  filePath?: string;
  line?: number;
  ruleId?: string;
  documentationUrl?: string;
  suggestedFix?: ProjectFindingSuggestedFix;
  evidenceRefs?: string[];
  freshness: FactFreshness;
  capturedAt: Timestamp;
  message: string;
  factFingerprints: string[];
}

export const ProjectFindingSchema = z.object({
  projectId: z.string().min(1),
  fingerprint: z.string().min(1),
  source: z.string().min(1),
  subjectFingerprint: z.string().min(1),
  overlay: ProjectOverlaySchema,
  severity: ReefSeveritySchema,
  status: ProjectFindingStatusSchema,
  filePath: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  ruleId: z.string().min(1).optional(),
  documentationUrl: z.string().min(1).optional(),
  suggestedFix: ProjectFindingSuggestedFixSchema.optional(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  freshness: FactFreshnessSchema,
  capturedAt: TimestampSchema,
  message: z.string().min(1),
  factFingerprints: z.array(z.string().min(1)),
}) satisfies z.ZodType<ProjectFinding>;

export interface ReefRuleDescriptor {
  id: string;
  version: string;
  source: string;
  sourceNamespace: string;
  type: "problem" | "suggestion" | "overlay";
  severity: ReefSeverity;
  title: string;
  description: string;
  docs?: { body: string };
  documentationUrl?: string;
  factKinds: string[];
  dependsOnFactKinds?: string[];
  fixable?: boolean;
  tags?: string[];
  enabledByDefault: boolean;
}

export const ReefRuleDescriptorSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  source: z.string().min(1),
  sourceNamespace: z.string().min(1),
  type: z.enum(["problem", "suggestion", "overlay"]),
  severity: ReefSeveritySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  docs: z.object({ body: z.string() }).optional(),
  documentationUrl: z.string().min(1).optional(),
  factKinds: z.array(z.string().min(1)),
  dependsOnFactKinds: z.array(z.string().min(1)).optional(),
  fixable: z.boolean().optional(),
  tags: z.array(z.string().min(1)).optional(),
  enabledByDefault: z.boolean(),
}) satisfies z.ZodType<ReefRuleDescriptor>;

export interface ReefDiagnosticRunCache {
  state: ReefDiagnosticCacheState;
  checkedAt: Timestamp;
  ageMs?: number;
  staleAfterMs: number;
  reason: string;
}

export const ReefDiagnosticRunCacheSchema = z.object({
  state: ReefDiagnosticCacheStateSchema,
  checkedAt: TimestampSchema,
  ageMs: z.number().int().nonnegative().optional(),
  staleAfterMs: z.number().int().positive(),
  reason: z.string().min(1),
}) satisfies z.ZodType<ReefDiagnosticRunCache>;

export interface ReefDiagnosticRun {
  runId: string;
  projectId: string;
  source: string;
  overlay: ProjectOverlay;
  status: ReefDiagnosticRunStatus;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMs: number;
  checkedFileCount?: number;
  findingCount: number;
  persistedFindingCount: number;
  command?: string;
  cwd?: string;
  configPath?: string;
  errorText?: string;
  metadata?: JsonObject;
  cache?: ReefDiagnosticRunCache;
}

export const ReefDiagnosticRunSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  source: z.string().min(1),
  overlay: ProjectOverlaySchema,
  status: ReefDiagnosticRunStatusSchema,
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  durationMs: z.number().int().nonnegative(),
  checkedFileCount: z.number().int().nonnegative().optional(),
  findingCount: z.number().int().nonnegative(),
  persistedFindingCount: z.number().int().nonnegative(),
  command: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  configPath: z.string().min(1).optional(),
  errorText: z.string().min(1).optional(),
  metadata: JsonObjectSchema.optional(),
  cache: ReefDiagnosticRunCacheSchema.optional(),
}) satisfies z.ZodType<ReefDiagnosticRun>;

export const DB_REVIEW_OBJECT_TYPES = [
  "database",
  "schema",
  "table",
  "view",
  "column",
  "index",
  "foreign_key",
  "rpc",
  "function",
  "policy",
  "rls_policy",
  "trigger",
  "enum",
  "publication",
  "subscription",
  "replication_slot",
  "replication",
  "unknown",
] as const;
export type DbReviewObjectType = (typeof DB_REVIEW_OBJECT_TYPES)[number];
export const DbReviewObjectTypeSchema = z.enum(DB_REVIEW_OBJECT_TYPES);

export const DB_REVIEW_COMMENT_CATEGORIES = [
  "note",
  "review",
  "risk",
  "decision",
  "todo",
] as const;
export type DbReviewCommentCategory = (typeof DB_REVIEW_COMMENT_CATEGORIES)[number];
export const DbReviewCommentCategorySchema = z.enum(DB_REVIEW_COMMENT_CATEGORIES);

export interface DbReviewTarget {
  objectType: DbReviewObjectType;
  objectName: string;
  schemaName?: string;
  parentObjectName?: string;
}

export const DbReviewTargetSchema = z.object({
  objectType: DbReviewObjectTypeSchema,
  objectName: z.string().trim().min(1),
  schemaName: z.string().trim().min(1).optional(),
  parentObjectName: z.string().trim().min(1).optional(),
}) satisfies z.ZodType<DbReviewTarget>;

export interface DbReviewComment {
  commentId: string;
  projectId: string;
  target: DbReviewTarget;
  targetFingerprint: string;
  category: DbReviewCommentCategory;
  severity?: ReefSeverity;
  comment: string;
  tags: string[];
  createdBy?: string;
  createdAt: Timestamp;
  sourceToolName: string;
  metadata?: JsonObject;
}

export const DbReviewCommentSchema = z.object({
  commentId: z.string().min(1),
  projectId: z.string().min(1),
  target: DbReviewTargetSchema,
  targetFingerprint: z.string().min(1),
  category: DbReviewCommentCategorySchema,
  severity: ReefSeveritySchema.optional(),
  comment: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)),
  createdBy: z.string().trim().min(1).optional(),
  createdAt: TimestampSchema,
  sourceToolName: z.string().min(1),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<DbReviewComment>;
