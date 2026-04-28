import { z } from "zod";
import type { JsonObject, Timestamp } from "./common.js";
import type {
  SchemaRlsPolicy,
  SchemaRlsState,
  SchemaRpc,
  SchemaTable,
} from "./schema-snapshot.js";
import {
  SchemaRlsPolicySchema,
  SchemaRlsStateSchema,
  SchemaRpcSchema,
  SchemaTableSchema,
} from "./schema-snapshot.js";
import type { ProjectLocatorInput } from "./tool-project-locator.js";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";
import type { ReefToolExecution } from "./tool-reef-execution-schemas.js";
import { ReefToolExecutionSchema } from "./tool-reef-execution-schemas.js";
import { JsonObjectSchema } from "./tool-schema-shared.js";

const MAX_NEIGHBORHOOD_SECTION_LIMIT = 100;

export interface NeighborhoodSection<T> {
  entries: T[];
  truncated: boolean;
  totalCount: number;
}

function neighborhoodSectionSchema<T extends z.ZodTypeAny>(
  entrySchema: T,
): z.ZodType<NeighborhoodSection<z.infer<T>>> {
  return z.object({
    entries: z.array(entrySchema),
    truncated: z.boolean(),
    totalCount: z.number().int().nonnegative(),
  });
}

export interface NeighborhoodTrustSurface {
  state?: string;
  source?: string;
  details?: JsonObject;
}

export const NeighborhoodTrustSurfaceSchema = z.object({
  state: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  details: JsonObjectSchema.optional(),
}) satisfies z.ZodType<NeighborhoodTrustSurface>;

export interface NeighborhoodSchemaUsageMatch {
  filePath: string;
  usageKind: string;
  line?: number;
  excerpt?: string;
}

export const NeighborhoodSchemaUsageMatchSchema = z.object({
  filePath: z.string().min(1),
  usageKind: z.string().min(1),
  line: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
}) satisfies z.ZodType<NeighborhoodSchemaUsageMatch>;

export interface NeighborhoodFunctionTableRef {
  rpcSchema: string;
  rpcName: string;
  rpcKind: "function" | "procedure";
  argTypes: string[];
  targetSchema: string;
  targetTable: string;
}

export const NeighborhoodFunctionTableRefSchema = z.object({
  rpcSchema: z.string().min(1),
  rpcName: z.string().min(1),
  rpcKind: z.enum(["function", "procedure"]),
  argTypes: z.array(z.string()),
  targetSchema: z.string().min(1),
  targetTable: z.string().min(1),
}) satisfies z.ZodType<NeighborhoodFunctionTableRef>;

export interface NeighborhoodRouteRecord {
  routeKey: string;
  framework: string;
  pattern: string;
  method?: string;
  handlerName?: string;
  isApi?: boolean;
  filePath: string;
  metadata?: JsonObject;
}

export const NeighborhoodRouteRecordSchema = z.object({
  routeKey: z.string().min(1),
  framework: z.string().min(1),
  pattern: z.string().min(1),
  method: z.string().min(1).optional(),
  handlerName: z.string().min(1).optional(),
  isApi: z.boolean().optional(),
  filePath: z.string().min(1),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<NeighborhoodRouteRecord>;

export interface NeighborhoodFileSummary {
  path: string;
  language: string;
  sizeBytes: number;
  lineCount: number;
  isGenerated: boolean;
  chunkPreview?: string;
}

export const NeighborhoodFileSummarySchema = z.object({
  path: z.string().min(1),
  language: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
  isGenerated: z.boolean(),
  chunkPreview: z.string().optional(),
}) satisfies z.ZodType<NeighborhoodFileSummary>;

export interface NeighborhoodImportLink {
  sourcePath: string;
  targetPath: string;
  specifier: string;
  importKind: string;
  isTypeOnly: boolean;
  line?: number;
  targetExists: boolean;
}

export const NeighborhoodImportLinkSchema = z.object({
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
  specifier: z.string().min(1),
  importKind: z.string().min(1),
  isTypeOnly: z.boolean(),
  line: z.number().int().positive().optional(),
  targetExists: z.boolean(),
}) satisfies z.ZodType<NeighborhoodImportLink>;

export interface NeighborhoodTableTouch {
  schemaName: string;
  tableName: string;
  usageKind: string;
  filePath?: string;
  line?: number;
  excerpt?: string;
}

export const NeighborhoodTableTouchSchema = z.object({
  schemaName: z.string().min(1),
  tableName: z.string().min(1),
  usageKind: z.string().min(1),
  filePath: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
}) satisfies z.ZodType<NeighborhoodTableTouch>;

export interface NeighborhoodRpcTouch {
  schemaName: string;
  rpcName: string;
  usageKind: string;
  filePath?: string;
  line?: number;
  excerpt?: string;
}

export const NeighborhoodRpcTouchSchema = z.object({
  schemaName: z.string().min(1),
  rpcName: z.string().min(1),
  usageKind: z.string().min(1),
  filePath: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
}) satisfies z.ZodType<NeighborhoodRpcTouch>;

export interface NeighborhoodRlsPolicyEntry {
  schemaName: string;
  tableName: string;
  policy: SchemaRlsPolicy;
}

export const NeighborhoodRlsPolicyEntrySchema = z.object({
  schemaName: z.string().min(1),
  tableName: z.string().min(1),
  policy: SchemaRlsPolicySchema,
}) satisfies z.ZodType<NeighborhoodRlsPolicyEntry>;

export interface TableNeighborhoodToolInput extends ProjectLocatorInput {
  schemaName?: string;
  tableName: string;
  maxPerSection?: number;
}

export const TableNeighborhoodToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  schemaName: z.string().trim().min(1).optional(),
  tableName: z.string().trim().min(1),
  maxPerSection: z.number().int().positive().max(MAX_NEIGHBORHOOD_SECTION_LIMIT).optional(),
}).strict() satisfies z.ZodType<TableNeighborhoodToolInput>;

export interface TableNeighborhoodToolOutput {
  toolName: "table_neighborhood";
  projectId: string;
  generatedAt: Timestamp;
  schemaName: string;
  tableName: string;
  table: SchemaTable | null;
  rls: SchemaRlsState | null;
  reads: NeighborhoodSection<NeighborhoodSchemaUsageMatch>;
  writes: NeighborhoodSection<NeighborhoodSchemaUsageMatch>;
  dependentRpcs: NeighborhoodSection<NeighborhoodFunctionTableRef>;
  dependentRoutes: NeighborhoodSection<NeighborhoodRouteRecord>;
  evidenceRefs: string[];
  trust: NeighborhoodTrustSurface | null;
  warnings: string[];
}

export const TableNeighborhoodToolOutputSchema = z.object({
  toolName: z.literal("table_neighborhood"),
  projectId: z.string().min(1),
  generatedAt: z.string().min(1),
  schemaName: z.string().min(1),
  tableName: z.string().min(1),
  table: SchemaTableSchema.nullable(),
  rls: SchemaRlsStateSchema.nullable(),
  reads: neighborhoodSectionSchema(NeighborhoodSchemaUsageMatchSchema),
  writes: neighborhoodSectionSchema(NeighborhoodSchemaUsageMatchSchema),
  dependentRpcs: neighborhoodSectionSchema(NeighborhoodFunctionTableRefSchema),
  dependentRoutes: neighborhoodSectionSchema(NeighborhoodRouteRecordSchema),
  evidenceRefs: z.array(z.string().min(1)),
  trust: NeighborhoodTrustSurfaceSchema.nullable(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<TableNeighborhoodToolOutput>;

export interface RouteContextToolInput extends ProjectLocatorInput {
  route: string;
  maxPerSection?: number;
}

export const RouteContextToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  route: z.string().trim().min(1),
  maxPerSection: z.number().int().positive().max(MAX_NEIGHBORHOOD_SECTION_LIMIT).optional(),
}).strict() satisfies z.ZodType<RouteContextToolInput>;

export interface RouteContextToolOutput {
  toolName: "route_context";
  projectId: string;
  generatedAt: Timestamp;
  route: string;
  resolvedRoute: NeighborhoodRouteRecord | null;
  handlerFile: NeighborhoodFileSummary | null;
  outboundImports: NeighborhoodSection<NeighborhoodImportLink>;
  inboundImports: NeighborhoodSection<NeighborhoodImportLink>;
  downstreamTables: NeighborhoodSection<NeighborhoodTableTouch>;
  downstreamRpcs: NeighborhoodSection<NeighborhoodRpcTouch>;
  rlsPolicies: NeighborhoodSection<NeighborhoodRlsPolicyEntry>;
  evidenceRefs: string[];
  trust: NeighborhoodTrustSurface | null;
  reefExecution: ReefToolExecution;
  warnings: string[];
}

export const RouteContextToolOutputSchema = z.object({
  toolName: z.literal("route_context"),
  projectId: z.string().min(1),
  generatedAt: z.string().min(1),
  route: z.string().min(1),
  resolvedRoute: NeighborhoodRouteRecordSchema.nullable(),
  handlerFile: NeighborhoodFileSummarySchema.nullable(),
  outboundImports: neighborhoodSectionSchema(NeighborhoodImportLinkSchema),
  inboundImports: neighborhoodSectionSchema(NeighborhoodImportLinkSchema),
  downstreamTables: neighborhoodSectionSchema(NeighborhoodTableTouchSchema),
  downstreamRpcs: neighborhoodSectionSchema(NeighborhoodRpcTouchSchema),
  rlsPolicies: neighborhoodSectionSchema(NeighborhoodRlsPolicyEntrySchema),
  evidenceRefs: z.array(z.string().min(1)),
  trust: NeighborhoodTrustSurfaceSchema.nullable(),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string()),
}) satisfies z.ZodType<RouteContextToolOutput>;

export interface RpcNeighborhoodToolInput extends ProjectLocatorInput {
  schemaName?: string;
  rpcName: string;
  argTypes?: string[];
  maxPerSection?: number;
}

export const RpcNeighborhoodToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  schemaName: z.string().trim().min(1).optional(),
  rpcName: z.string().trim().min(1),
  argTypes: z.array(z.string().trim().min(1)).optional(),
  maxPerSection: z.number().int().positive().max(MAX_NEIGHBORHOOD_SECTION_LIMIT).optional(),
}).strict() satisfies z.ZodType<RpcNeighborhoodToolInput>;

export interface RpcNeighborhoodToolOutput {
  toolName: "rpc_neighborhood";
  projectId: string;
  generatedAt: Timestamp;
  schemaName: string;
  rpcName: string;
  argTypes?: string[];
  rpc: SchemaRpc | null;
  callers: NeighborhoodSection<NeighborhoodSchemaUsageMatch>;
  tablesTouched: NeighborhoodSection<NeighborhoodFunctionTableRef>;
  rlsPolicies: NeighborhoodSection<NeighborhoodRlsPolicyEntry>;
  evidenceRefs: string[];
  trust: NeighborhoodTrustSurface | null;
  warnings: string[];
}

export const RpcNeighborhoodToolOutputSchema = z.object({
  toolName: z.literal("rpc_neighborhood"),
  projectId: z.string().min(1),
  generatedAt: z.string().min(1),
  schemaName: z.string().min(1),
  rpcName: z.string().min(1),
  argTypes: z.array(z.string()).optional(),
  rpc: SchemaRpcSchema.nullable(),
  callers: neighborhoodSectionSchema(NeighborhoodSchemaUsageMatchSchema),
  tablesTouched: neighborhoodSectionSchema(NeighborhoodFunctionTableRefSchema),
  rlsPolicies: neighborhoodSectionSchema(NeighborhoodRlsPolicyEntrySchema),
  evidenceRefs: z.array(z.string().min(1)),
  trust: NeighborhoodTrustSurfaceSchema.nullable(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<RpcNeighborhoodToolOutput>;
