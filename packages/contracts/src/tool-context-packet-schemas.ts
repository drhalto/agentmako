import { z } from "zod";
import type { IndexFreshnessDetail, IndexFreshnessSummary, ProjectFreshnessGate } from "./index-freshness.js";
import {
  IndexFreshnessDetailSchema,
  IndexFreshnessSummarySchema,
  ProjectFreshnessGateSchema,
} from "./index-freshness.js";
import type { JsonObject } from "./common.js";
import type { ProjectFinding } from "./reef.js";
import { ProjectFindingSchema } from "./reef.js";
import { ToolNameSchema, type ToolName } from "./tool-registry.js";
import { ProjectLocatorInputObjectSchema, type ProjectLocatorInput } from "./tool-project-locator.js";
import type { ReefToolExecution } from "./tool-reef-execution-schemas.js";
import { ReefToolExecutionSchema } from "./tool-reef-execution-schemas.js";

const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;

// Candidate sources reflect the providers that actually emit candidates.
// Forward-looking sources (e.g. ast_pattern_provider, finding_ack_memory) will
// be added back when their providers ship.
export const ContextPacketSourceSchema = z.enum([
  "live_text_provider",
  "route_provider",
  "file_provider",
  "schema_provider",
  "symbol_provider",
  "import_graph_provider",
  "repo_map_provider",
  "hot_hint_index",
  "working_tree_overlay",
  "reef_convention",
]);
export type ContextPacketSource = z.infer<typeof ContextPacketSourceSchema>;

export const ContextPacketStrategySchema = z.enum([
  "exact_match",
  "deterministic_graph",
  "symbol_reference",
  "schema_usage",
  "hot_hint",
  "centrality_rank",
  "overlay_fact",
  "convention_memory",
]);
export type ContextPacketStrategy = z.infer<typeof ContextPacketStrategySchema>;

export const ContextPacketIntentFamilySchema = z.enum([
  "debug_route",
  "debug_type_contract",
  "debug_auth_state",
  "debug_database_usage",
  "debug_ui_behavior",
  "implement_feature",
  "review_change",
  "find_precedent",
  "unknown",
]);
export type ContextPacketIntentFamily = z.infer<typeof ContextPacketIntentFamilySchema>;

export const ContextPacketModeSchema = z.enum([
  "explore",
  "plan",
  "implement",
  "review",
]);
export type ContextPacketMode = z.infer<typeof ContextPacketModeSchema>;

export interface ContextPacketToolInput extends ProjectLocatorInput {
  request: string;
  mode?: ContextPacketMode;
  focusFiles?: string[];
  focusSymbols?: string[];
  focusRoutes?: string[];
  focusDatabaseObjects?: string[];
  changedFiles?: string[];
  maxPrimaryContext?: number;
  maxRelatedContext?: number;
  budgetTokens?: number;
  includeInstructions?: boolean;
  includeRisks?: boolean;
  risksMinConfidence?: number;
  includeLiveHints?: boolean;
  freshnessPolicy?: "report" | "prefer_fresh";
}

export const ContextPacketToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  request: z.string().trim().min(1),
  mode: ContextPacketModeSchema.optional(),
  focusFiles: z.array(z.string().trim().min(1)).max(50).optional(),
  focusSymbols: z.array(z.string().trim().min(1)).max(50).optional(),
  focusRoutes: z.array(z.string().trim().min(1)).max(50).optional(),
  focusDatabaseObjects: z.array(z.string().trim().min(1)).max(50).optional(),
  changedFiles: z.array(z.string().trim().min(1)).max(100).optional(),
  maxPrimaryContext: z.number().int().min(1).max(30).optional(),
  maxRelatedContext: z.number().int().min(0).max(60).optional(),
  budgetTokens: z.number().int().min(256).max(12_000).optional(),
  includeInstructions: z.boolean().optional(),
  includeRisks: z.boolean().optional(),
  risksMinConfidence: z.number().min(0).max(1).optional(),
  includeLiveHints: z.boolean().optional(),
  freshnessPolicy: z.enum(["report", "prefer_fresh"]).optional(),
}) satisfies z.ZodType<ContextPacketToolInput>;

export interface ContextPacketIntent {
  primaryFamily: ContextPacketIntentFamily;
  families: Array<{
    family: ContextPacketIntentFamily;
    confidence: number;
    signals: string[];
  }>;
  entities: {
    files: string[];
    symbols: string[];
    routes: string[];
    databaseObjects: string[];
    quotedText: string[];
    keywords: string[];
  };
}

export const ContextPacketIntentSchema = z.object({
  primaryFamily: ContextPacketIntentFamilySchema,
  families: z.array(z.object({
    family: ContextPacketIntentFamilySchema,
    confidence: z.number().min(0).max(1),
    signals: z.array(z.string().min(1)),
  })),
  entities: z.object({
    files: z.array(z.string().min(1)),
    symbols: z.array(z.string().min(1)),
    routes: z.array(z.string().min(1)),
    databaseObjects: z.array(z.string().min(1)),
    quotedText: z.array(z.string().min(1)),
    keywords: z.array(z.string().min(1)),
  }),
}) satisfies z.ZodType<ContextPacketIntent>;

export interface ContextPacketReadableCandidate {
  id: string;
  kind: "file" | "symbol" | "route" | "database_object";
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  symbolName?: string;
  routeKey?: string;
  databaseObjectName?: string;
  source: ContextPacketSource;
  strategy: ContextPacketStrategy;
  whyIncluded: string;
  confidence: number;
  score: number;
  freshness?: IndexFreshnessDetail;
  evidenceRef?: string;
  metadata?: JsonObject;
}

export const ContextPacketReadableCandidateSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["file", "symbol", "route", "database_object"]),
  path: z.string().min(1).optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  symbolName: z.string().min(1).optional(),
  routeKey: z.string().min(1).optional(),
  databaseObjectName: z.string().min(1).optional(),
  source: ContextPacketSourceSchema,
  strategy: ContextPacketStrategySchema,
  whyIncluded: z.string().min(1),
  confidence: z.number().min(0).max(1),
  score: z.number(),
  freshness: IndexFreshnessDetailSchema.optional(),
  evidenceRef: z.string().min(1).optional(),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ContextPacketReadableCandidate>;

export interface ContextPacketSymbol {
  name: string;
  kind: string;
  path?: string;
  lineStart?: number;
  source: ContextPacketSource;
  whyIncluded: string;
  confidence: number;
}

export const ContextPacketSymbolSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  path: z.string().min(1).optional(),
  lineStart: z.number().int().positive().optional(),
  source: ContextPacketSourceSchema,
  whyIncluded: z.string().min(1),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<ContextPacketSymbol>;

export interface ContextPacketRoute {
  routeKey: string;
  path?: string;
  method?: string;
  source: ContextPacketSource;
  whyIncluded: string;
  confidence: number;
}

export const ContextPacketRouteSchema = z.object({
  routeKey: z.string().min(1),
  path: z.string().min(1).optional(),
  method: z.string().min(1).optional(),
  source: ContextPacketSourceSchema,
  whyIncluded: z.string().min(1),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<ContextPacketRoute>;

export interface ContextPacketDatabaseObject {
  objectType: "schema" | "table" | "view" | "rpc" | "function" | "policy" | "trigger" | "column" | "enum" | "unknown";
  schemaName?: string;
  objectName: string;
  source: ContextPacketSource;
  whyIncluded: string;
  confidence: number;
}

export const ContextPacketDatabaseObjectSchema = z.object({
  objectType: z.enum(["schema", "table", "view", "rpc", "function", "policy", "trigger", "column", "enum", "unknown"]),
  schemaName: z.string().min(1).optional(),
  objectName: z.string().min(1),
  source: ContextPacketSourceSchema,
  whyIncluded: z.string().min(1),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<ContextPacketDatabaseObject>;

export const ContextPacketGraphFileRelationSchema = z.enum([
  "anchor",
  "dependency",
  "dependent",
  "bidirectional",
  "central",
  "unknown",
]);
export type ContextPacketGraphFileRelation = z.infer<typeof ContextPacketGraphFileRelationSchema>;

export interface ContextPacketGraphFileSummary {
  filePath: string;
  relation: ContextPacketGraphFileRelation;
  distance?: number;
  sourceCount: number;
  sources: ContextPacketSource[];
  strategies: ContextPacketStrategy[];
  score: number;
  confidence: number;
  reasons: string[];
}

export const ContextPacketGraphFileSummarySchema = z.object({
  filePath: z.string().min(1),
  relation: ContextPacketGraphFileRelationSchema,
  distance: z.number().int().nonnegative().optional(),
  sourceCount: z.number().int().positive(),
  sources: z.array(ContextPacketSourceSchema),
  strategies: z.array(ContextPacketStrategySchema),
  score: z.number(),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)),
}) satisfies z.ZodType<ContextPacketGraphFileSummary>;

export const ContextPacketGraphEdgeRelationSchema = z.enum([
  "anchor_dependency",
  "anchor_dependent",
  "anchor_link",
  "context_import",
]);
export type ContextPacketGraphEdgeRelation = z.infer<typeof ContextPacketGraphEdgeRelationSchema>;

export interface ContextPacketGraphEdgeSummary {
  from: string;
  to: string;
  relation: ContextPacketGraphEdgeRelation;
  specifier: string;
  importKind: string;
  isTypeOnly: boolean;
  line?: number;
}

export const ContextPacketGraphEdgeSummarySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relation: ContextPacketGraphEdgeRelationSchema,
  specifier: z.string(),
  importKind: z.string(),
  isTypeOnly: z.boolean(),
  line: z.number().int().positive().optional(),
}) satisfies z.ZodType<ContextPacketGraphEdgeSummary>;

export interface ContextPacketGraphSummary {
  anchorFiles: string[];
  returnedFileCount: number;
  edgeCount: number;
  dependencyFileCount: number;
  dependentFileCount: number;
  bidirectionalFileCount: number;
  centralFileCount: number;
  unknownRelationFileCount: number;
  files: ContextPacketGraphFileSummary[];
  edges: ContextPacketGraphEdgeSummary[];
  truncated: boolean;
  warnings: string[];
}

export const ContextPacketGraphSummarySchema = z.object({
  anchorFiles: z.array(z.string().min(1)),
  returnedFileCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  dependencyFileCount: z.number().int().nonnegative(),
  dependentFileCount: z.number().int().nonnegative(),
  bidirectionalFileCount: z.number().int().nonnegative(),
  centralFileCount: z.number().int().nonnegative(),
  unknownRelationFileCount: z.number().int().nonnegative(),
  files: z.array(ContextPacketGraphFileSummarySchema),
  edges: z.array(ContextPacketGraphEdgeSummarySchema),
  truncated: z.boolean(),
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ContextPacketGraphSummary>;

export const ContextPacketRequestCoverageKindSchema = z.enum([
  "file",
  "symbol",
  "route",
  "database_object",
  "quoted_text",
]);
export type ContextPacketRequestCoverageKind = z.infer<typeof ContextPacketRequestCoverageKindSchema>;

export const ContextPacketRequestCoverageItemStatusSchema = z.enum([
  "covered",
  "uncovered",
  "not_checked",
]);
export type ContextPacketRequestCoverageItemStatus = z.infer<typeof ContextPacketRequestCoverageItemStatusSchema>;

export const ContextPacketRequestCoverageStatusSchema = z.enum([
  "complete",
  "partial",
  "missing",
  "not_requested",
]);
export type ContextPacketRequestCoverageStatus = z.infer<typeof ContextPacketRequestCoverageStatusSchema>;

export interface ContextPacketRequestCoverageItem {
  kind: ContextPacketRequestCoverageKind;
  value: string;
  status: ContextPacketRequestCoverageItemStatus;
  matchedBy: string[];
  reason: string;
}

export const ContextPacketRequestCoverageItemSchema = z.object({
  kind: ContextPacketRequestCoverageKindSchema,
  value: z.string().min(1),
  status: ContextPacketRequestCoverageItemStatusSchema,
  matchedBy: z.array(z.string().min(1)),
  reason: z.string().min(1),
}) satisfies z.ZodType<ContextPacketRequestCoverageItem>;

export interface ContextPacketRequestCoverageKindSummary {
  requested: number;
  covered: number;
  uncovered: number;
  notChecked: number;
}

export const ContextPacketRequestCoverageKindSummarySchema = z.object({
  requested: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
  uncovered: z.number().int().nonnegative(),
  notChecked: z.number().int().nonnegative(),
}) satisfies z.ZodType<ContextPacketRequestCoverageKindSummary>;

export interface ContextPacketRequestCoverage {
  status: ContextPacketRequestCoverageStatus;
  requestedCount: number;
  coveredCount: number;
  uncoveredCount: number;
  notCheckedCount: number;
  byKind: Record<ContextPacketRequestCoverageKind, ContextPacketRequestCoverageKindSummary>;
  items: ContextPacketRequestCoverageItem[];
  recommendations: string[];
}

export const ContextPacketRequestCoverageSchema = z.object({
  status: ContextPacketRequestCoverageStatusSchema,
  requestedCount: z.number().int().nonnegative(),
  coveredCount: z.number().int().nonnegative(),
  uncoveredCount: z.number().int().nonnegative(),
  notCheckedCount: z.number().int().nonnegative(),
  byKind: z.object({
    file: ContextPacketRequestCoverageKindSummarySchema,
    symbol: ContextPacketRequestCoverageKindSummarySchema,
    route: ContextPacketRequestCoverageKindSummarySchema,
    database_object: ContextPacketRequestCoverageKindSummarySchema,
    quoted_text: ContextPacketRequestCoverageKindSummarySchema,
  }),
  items: z.array(ContextPacketRequestCoverageItemSchema),
  recommendations: z.array(z.string().min(1)),
}) satisfies z.ZodType<ContextPacketRequestCoverage>;

export interface ContextPacketRisk {
  code: string;
  reason: string;
  source: "risk_detector" | "freshness" | "finding_ack_memory" | "open_loop";
  severity: "info" | "low" | "medium" | "high";
  recommendedHarnessStep?: string;
  confidence: number;
}

export const ContextPacketRiskSchema = z.object({
  code: z.string().min(1),
  reason: z.string().min(1),
  source: z.enum(["risk_detector", "freshness", "finding_ack_memory", "open_loop"]),
  severity: z.enum(["info", "low", "medium", "high"]),
  recommendedHarnessStep: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<ContextPacketRisk>;

export interface ContextPacketInstruction {
  path: string;
  appliesTo: string[];
  precedence: number;
  reason: string;
  excerpt: string;
}

export const ContextPacketInstructionSchema = z.object({
  path: z.string().min(1),
  appliesTo: z.array(z.string().min(1)),
  precedence: z.number().int().nonnegative(),
  reason: z.string().min(1),
  excerpt: z.string(),
}) satisfies z.ZodType<ContextPacketInstruction>;

export interface ContextPacketExpandableTool {
  toolName: ToolName;
  suggestedArgs: JsonObject;
  reason: string;
  whenToUse: string;
  readOnly: boolean;
}

export const ContextPacketExpandableToolSchema = z.object({
  toolName: ToolNameSchema,
  suggestedArgs: JsonObjectSchema,
  reason: z.string().min(1),
  whenToUse: z.string().min(1),
  readOnly: z.boolean(),
}) satisfies z.ZodType<ContextPacketExpandableTool>;

export interface ContextPacketLimits {
  budgetTokens: number;
  tokenEstimateMethod: "char_div_4";
  maxPrimaryContext: number;
  maxRelatedContext: number;
  providersRun: string[];
  providersRunDetail: ContextPacketProviderRunDetail[];
  providersSkipped: string[];
  providersSkippedDetail: ContextPacketProviderSkipDetail[];
  providersFailed: string[];
  candidatesConsidered: number;
  candidatesReturned: number;
}

export interface ContextPacketProviderRunDetail {
  provider: string;
  status: "success" | "failed";
  candidateCount: number;
  durationMs: number;
}

export const ContextPacketProviderRunDetailSchema = z.object({
  provider: z.string().min(1),
  status: z.enum(["success", "failed"]),
  candidateCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
}) satisfies z.ZodType<ContextPacketProviderRunDetail>;

export interface ContextPacketProviderSkipDetail {
  provider: string;
  reason: string;
  adaptive: boolean;
}

export const ContextPacketProviderSkipDetailSchema = z.object({
  provider: z.string().min(1),
  reason: z.string().min(1),
  adaptive: z.boolean(),
}) satisfies z.ZodType<ContextPacketProviderSkipDetail>;

export const ContextPacketLimitsSchema = z.object({
  budgetTokens: z.number().int().positive(),
  tokenEstimateMethod: z.literal("char_div_4"),
  maxPrimaryContext: z.number().int().nonnegative(),
  maxRelatedContext: z.number().int().nonnegative(),
  providersRun: z.array(z.string().min(1)),
  providersRunDetail: z.array(ContextPacketProviderRunDetailSchema),
  providersSkipped: z.array(z.string().min(1)),
  providersSkippedDetail: z.array(ContextPacketProviderSkipDetailSchema),
  providersFailed: z.array(z.string().min(1)),
  candidatesConsidered: z.number().int().nonnegative(),
  candidatesReturned: z.number().int().nonnegative(),
}) satisfies z.ZodType<ContextPacketLimits>;

export interface ContextPacketRetrievalSlowestProvider {
  provider: string;
  status: ContextPacketProviderRunDetail["status"];
  candidateCount: number;
  durationMs: number;
}

export const ContextPacketRetrievalSlowestProviderSchema = z.object({
  provider: z.string().min(1),
  status: ContextPacketProviderRunDetailSchema.shape.status,
  candidateCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
}) satisfies z.ZodType<ContextPacketRetrievalSlowestProvider>;

export interface ContextPacketLiveTextMiss {
  query: string;
  scope: "project" | "file";
  scopePath?: string;
}

export const ContextPacketLiveTextMissSchema = z.object({
  query: z.string().min(1),
  scope: z.enum(["project", "file"]),
  scopePath: z.string().min(1).optional(),
}) satisfies z.ZodType<ContextPacketLiveTextMiss>;

export interface ContextPacketRetrievalDiagnostics {
  providerRunCount: number;
  providerCandidateCount: number;
  zeroCandidateProviders: string[];
  failedProviders: string[];
  adaptiveSkippedProviders: string[];
  liveTextMisses: ContextPacketLiveTextMiss[];
  slowestProvider?: ContextPacketRetrievalSlowestProvider;
  recommendations: string[];
}

export const ContextPacketRetrievalDiagnosticsSchema = z.object({
  providerRunCount: z.number().int().nonnegative(),
  providerCandidateCount: z.number().int().nonnegative(),
  zeroCandidateProviders: z.array(z.string().min(1)),
  failedProviders: z.array(z.string().min(1)),
  adaptiveSkippedProviders: z.array(z.string().min(1)),
  liveTextMisses: z.array(ContextPacketLiveTextMissSchema),
  slowestProvider: ContextPacketRetrievalSlowestProviderSchema.optional(),
  recommendations: z.array(z.string().min(1)),
}) satisfies z.ZodType<ContextPacketRetrievalDiagnostics>;

export const ContextPacketEvidenceQualityLabelSchema = z.enum([
  "strong",
  "usable",
  "partial",
  "weak",
]);
export type ContextPacketEvidenceQualityLabel = z.infer<typeof ContextPacketEvidenceQualityLabelSchema>;

export interface ContextPacketEvidenceQualityFreshness {
  gateStatus: ProjectFreshnessGate["status"];
  indexState: IndexFreshnessSummary["state"];
  dirtyContextCount: number;
}

export const ContextPacketEvidenceQualityFreshnessSchema = z.object({
  gateStatus: ProjectFreshnessGateSchema.shape.status,
  indexState: IndexFreshnessSummarySchema.shape.state,
  dirtyContextCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ContextPacketEvidenceQualityFreshness>;

export interface ContextPacketEvidenceQualityRequestCoverage {
  status: ContextPacketRequestCoverageStatus;
  requestedCount: number;
  coveredCount: number;
  unresolvedCount: number;
  uncoveredCount: number;
  notCheckedCount: number;
}

export const ContextPacketEvidenceQualityRequestCoverageSchema = z.object({
  status: ContextPacketRequestCoverageStatusSchema,
  requestedCount: z.number().int().nonnegative(),
  coveredCount: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative(),
  uncoveredCount: z.number().int().nonnegative(),
  notCheckedCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ContextPacketEvidenceQualityRequestCoverage>;

export const ContextPacketEvidenceQualityGraphStatusSchema = z.enum([
  "connected",
  "isolated",
  "missing",
  "not_requested",
]);
export type ContextPacketEvidenceQualityGraphStatus = z.infer<typeof ContextPacketEvidenceQualityGraphStatusSchema>;

export interface ContextPacketEvidenceQualityGraph {
  status: ContextPacketEvidenceQualityGraphStatus;
  requested: boolean;
  anchorFileCount: number;
  returnedFileCount: number;
  edgeCount: number;
  connectedFileCount: number;
  warningCount: number;
}

export const ContextPacketEvidenceQualityGraphSchema = z.object({
  status: ContextPacketEvidenceQualityGraphStatusSchema,
  requested: z.boolean(),
  anchorFileCount: z.number().int().nonnegative(),
  returnedFileCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  connectedFileCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ContextPacketEvidenceQualityGraph>;

export interface ContextPacketEvidenceQuality {
  label: ContextPacketEvidenceQualityLabel;
  score: number;
  reasons: string[];
  recommendedAction: string;
  primaryContextCount: number;
  relatedContextCount: number;
  totalContextCount: number;
  freshContextCount: number;
  staleContextCount: number;
  unknownFreshnessCount: number;
  liveOverlayContextCount: number;
  corroboratedContextCount: number;
  highConfidenceContextCount: number;
  averageConfidence: number;
  freshness: ContextPacketEvidenceQualityFreshness;
  requestCoverage: ContextPacketEvidenceQualityRequestCoverage;
  graph: ContextPacketEvidenceQualityGraph;
}

export const ContextPacketEvidenceQualitySchema = z.object({
  label: ContextPacketEvidenceQualityLabelSchema,
  score: z.number().min(0).max(1),
  reasons: z.array(z.string().min(1)),
  recommendedAction: z.string().min(1),
  primaryContextCount: z.number().int().nonnegative(),
  relatedContextCount: z.number().int().nonnegative(),
  totalContextCount: z.number().int().nonnegative(),
  freshContextCount: z.number().int().nonnegative(),
  staleContextCount: z.number().int().nonnegative(),
  unknownFreshnessCount: z.number().int().nonnegative(),
  liveOverlayContextCount: z.number().int().nonnegative(),
  corroboratedContextCount: z.number().int().nonnegative(),
  highConfidenceContextCount: z.number().int().nonnegative(),
  averageConfidence: z.number().min(0).max(1),
  freshness: ContextPacketEvidenceQualityFreshnessSchema,
  requestCoverage: ContextPacketEvidenceQualityRequestCoverageSchema,
  graph: ContextPacketEvidenceQualityGraphSchema,
}) satisfies z.ZodType<ContextPacketEvidenceQuality>;

export interface ContextPacketModePolicySummary {
  enabledProviders: string[];
  disabledProviders: string[];
  includeInstructions: boolean;
  includeRisks: boolean;
  includeActiveFindings: boolean;
  includeExpandableTools: boolean;
}

export const ContextPacketModePolicySummarySchema = z.object({
  enabledProviders: z.array(z.string().min(1)),
  disabledProviders: z.array(z.string().min(1)),
  includeInstructions: z.boolean(),
  includeRisks: z.boolean(),
  includeActiveFindings: z.boolean(),
  includeExpandableTools: z.boolean(),
}) satisfies z.ZodType<ContextPacketModePolicySummary>;

export interface ContextPacketToolOutput {
  toolName: "context_packet";
  projectId: string;
  projectRoot: string;
  request: string;
  mode: ContextPacketMode;
  modePolicy: ContextPacketModePolicySummary;
  intent: ContextPacketIntent;
  primaryContext: ContextPacketReadableCandidate[];
  relatedContext: ContextPacketReadableCandidate[];
  activeFindings: ProjectFinding[];
  symbols: ContextPacketSymbol[];
  routes: ContextPacketRoute[];
  databaseObjects: ContextPacketDatabaseObject[];
  graphSummary: ContextPacketGraphSummary;
  requestCoverage: ContextPacketRequestCoverage;
  risks: ContextPacketRisk[];
  scopedInstructions: ContextPacketInstruction[];
  recommendedHarnessPattern: string[];
  expandableTools: ContextPacketExpandableTool[];
  freshnessGate: ProjectFreshnessGate;
  indexFreshness?: IndexFreshnessSummary;
  evidenceQuality: ContextPacketEvidenceQuality;
  retrievalDiagnostics: ContextPacketRetrievalDiagnostics;
  reefExecution: ReefToolExecution;
  limits: ContextPacketLimits;
  warnings: string[];
}

export const ContextPacketToolOutputSchema = z.object({
  toolName: z.literal("context_packet"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  request: z.string().min(1),
  mode: ContextPacketModeSchema,
  modePolicy: ContextPacketModePolicySummarySchema,
  intent: ContextPacketIntentSchema,
  primaryContext: z.array(ContextPacketReadableCandidateSchema),
  relatedContext: z.array(ContextPacketReadableCandidateSchema),
  activeFindings: z.array(ProjectFindingSchema),
  symbols: z.array(ContextPacketSymbolSchema),
  routes: z.array(ContextPacketRouteSchema),
  databaseObjects: z.array(ContextPacketDatabaseObjectSchema),
  graphSummary: ContextPacketGraphSummarySchema,
  requestCoverage: ContextPacketRequestCoverageSchema,
  risks: z.array(ContextPacketRiskSchema),
  scopedInstructions: z.array(ContextPacketInstructionSchema),
  recommendedHarnessPattern: z.array(z.string().min(1)),
  expandableTools: z.array(ContextPacketExpandableToolSchema),
  freshnessGate: ProjectFreshnessGateSchema,
  indexFreshness: IndexFreshnessSummarySchema.optional(),
  evidenceQuality: ContextPacketEvidenceQualitySchema,
  retrievalDiagnostics: ContextPacketRetrievalDiagnosticsSchema,
  reefExecution: ReefToolExecutionSchema,
  limits: ContextPacketLimitsSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ContextPacketToolOutput>;
