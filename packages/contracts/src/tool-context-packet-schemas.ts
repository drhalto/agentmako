import { z } from "zod";
import type { IndexFreshnessDetail, IndexFreshnessSummary } from "./index-freshness.js";
import { IndexFreshnessDetailSchema, IndexFreshnessSummarySchema } from "./index-freshness.js";
import type { JsonObject } from "./common.js";
import type { ProjectFinding } from "./reef.js";
import { ProjectFindingSchema } from "./reef.js";
import { ToolNameSchema, type ToolName } from "./tool-registry.js";
import { ProjectLocatorInputObjectSchema, type ProjectLocatorInput } from "./tool-project-locator.js";

const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;

// Candidate sources reflect the providers that actually emit candidates.
// Forward-looking sources (e.g. live_text_provider, ast_pattern_provider,
// finding_ack_memory) will be added back when their providers ship.
export const ContextPacketSourceSchema = z.enum([
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

export interface ContextPacketToolInput extends ProjectLocatorInput {
  request: string;
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
  includeLiveHints?: boolean;
  freshnessPolicy?: "report" | "prefer_fresh";
}

export const ContextPacketToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  request: z.string().trim().min(1),
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

export interface ContextPacketRisk {
  code: string;
  reason: string;
  source: "risk_detector" | "freshness" | "finding_ack_memory";
  severity: "info" | "low" | "medium" | "high";
  recommendedHarnessStep?: string;
  confidence: number;
}

export const ContextPacketRiskSchema = z.object({
  code: z.string().min(1),
  reason: z.string().min(1),
  source: z.enum(["risk_detector", "freshness", "finding_ack_memory"]),
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
  providersFailed: string[];
  candidatesConsidered: number;
  candidatesReturned: number;
}

export const ContextPacketLimitsSchema = z.object({
  budgetTokens: z.number().int().positive(),
  tokenEstimateMethod: z.literal("char_div_4"),
  maxPrimaryContext: z.number().int().nonnegative(),
  maxRelatedContext: z.number().int().nonnegative(),
  providersRun: z.array(z.string().min(1)),
  providersFailed: z.array(z.string().min(1)),
  candidatesConsidered: z.number().int().nonnegative(),
  candidatesReturned: z.number().int().nonnegative(),
}) satisfies z.ZodType<ContextPacketLimits>;

export interface ContextPacketToolOutput {
  toolName: "context_packet";
  projectId: string;
  projectRoot: string;
  request: string;
  intent: ContextPacketIntent;
  primaryContext: ContextPacketReadableCandidate[];
  relatedContext: ContextPacketReadableCandidate[];
  activeFindings: ProjectFinding[];
  symbols: ContextPacketSymbol[];
  routes: ContextPacketRoute[];
  databaseObjects: ContextPacketDatabaseObject[];
  risks: ContextPacketRisk[];
  scopedInstructions: ContextPacketInstruction[];
  recommendedHarnessPattern: string[];
  expandableTools: ContextPacketExpandableTool[];
  indexFreshness?: IndexFreshnessSummary;
  limits: ContextPacketLimits;
  warnings: string[];
}

export const ContextPacketToolOutputSchema = z.object({
  toolName: z.literal("context_packet"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  request: z.string().min(1),
  intent: ContextPacketIntentSchema,
  primaryContext: z.array(ContextPacketReadableCandidateSchema),
  relatedContext: z.array(ContextPacketReadableCandidateSchema),
  activeFindings: z.array(ProjectFindingSchema),
  symbols: z.array(ContextPacketSymbolSchema),
  routes: z.array(ContextPacketRouteSchema),
  databaseObjects: z.array(ContextPacketDatabaseObjectSchema),
  risks: z.array(ContextPacketRiskSchema),
  scopedInstructions: z.array(ContextPacketInstructionSchema),
  recommendedHarnessPattern: z.array(z.string().min(1)),
  expandableTools: z.array(ContextPacketExpandableToolSchema),
  indexFreshness: IndexFreshnessSummarySchema.optional(),
  limits: ContextPacketLimitsSchema,
  warnings: z.array(z.string().min(1)),
}) satisfies z.ZodType<ContextPacketToolOutput>;
