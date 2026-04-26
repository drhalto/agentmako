import { z } from "zod";
import type { JsonObject, Timestamp } from "./common.js";

export type SchemaSourceKind =
  | "sql_migration"
  | "generated_types"
  | "prisma_schema"
  | "drizzle_schema"
  | "live_catalog";

export type SchemaSourceMode =
  | "repo_only"
  | "repo_plus_live_verify"
  | "live_refresh_enabled";

export type SchemaFreshnessStatus =
  | "unknown"
  | "fresh"
  | "stale"
  | "verified"
  | "drift_detected"
  | "refresh_required";

export type SchemaSnapshotState = "no_sources" | "not_built" | "present";

export type SchemaSnapshotWarningKind =
  | "unsupported_source"
  | "source_missing"
  | "parser_partial"
  | "schema_sources_not_found";

export interface SchemaSourceRef {
  kind: SchemaSourceKind;
  path: string;
  line?: number;
}

export interface SchemaColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultExpression?: string;
  isPrimaryKey?: boolean;
  sources: SchemaSourceRef[];
}

export interface SchemaIndex {
  name: string;
  unique: boolean;
  primary: boolean;
  columns: string[];
  definition?: string | null;
}

export interface SchemaForeignKeyOutbound {
  constraintName: string;
  columns: string[];
  targetSchema: string;
  targetTable: string;
  targetColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface SchemaForeignKeyInbound {
  constraintName: string;
  sourceSchema: string;
  sourceTable: string;
  sourceColumns: string[];
  columns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface SchemaRlsPolicy {
  name: string;
  mode: "PERMISSIVE" | "RESTRICTIVE";
  command: string;
  roles: string[];
  usingExpression: string | null;
  withCheckExpression: string | null;
}

export interface SchemaRlsState {
  rlsEnabled: boolean;
  forceRls: boolean;
  policies: SchemaRlsPolicy[];
}

export interface SchemaTrigger {
  name: string;
  enabled: boolean;
  enabledMode: "O" | "D" | "R" | "A";
  timing: string;
  events: string[];
  /**
   * Raw body or invocation text for the trigger. For Postgres triggers that
   * call a function (`EXECUTE FUNCTION fn_name(...)`), this holds the
   * `EXECUTE FUNCTION ...` clause — the actual logic lives on the referenced
   * function. Populated from repo-SQL migrations; absent on live-refresh-only
   * projects that haven't been re-indexed.
   */
  bodyText?: string | null;
}

export interface SchemaTable {
  name: string;
  schema: string;
  columns: SchemaColumn[];
  primaryKey?: string[];
  indexes?: SchemaIndex[];
  foreignKeys?: {
    outbound: SchemaForeignKeyOutbound[];
    inbound: SchemaForeignKeyInbound[];
  };
  rls?: SchemaRlsState;
  triggers?: SchemaTrigger[];
  sources: SchemaSourceRef[];
}

export interface SchemaView {
  name: string;
  schema: string;
  sources: SchemaSourceRef[];
}

export interface SchemaEnum {
  name: string;
  schema: string;
  values: string[];
  sources: SchemaSourceRef[];
}

export interface SchemaRpc {
  name: string;
  schema: string;
  argTypes?: string[];
  returnType?: string;
  /**
   * PL/pgSQL body text (between `AS $$...$$` or `AS $tag$...$tag$`). Populated
   * from repo-SQL migrations via `extract-pg-functions.ts`. Composers like
   * `trace_rpc` and `cross_search` scan this column to answer "which RPC
   * references table X".
   */
  bodyText?: string | null;
  sources: SchemaSourceRef[];
}

export interface SchemaNamespace {
  tables: SchemaTable[];
  views: SchemaView[];
  enums: SchemaEnum[];
  rpcs: SchemaRpc[];
}

export interface SchemaIR {
  version: "1.0.0";
  schemas: Record<string, SchemaNamespace>;
}

export interface SchemaSnapshotSource {
  kind: SchemaSourceKind;
  path: string;
  sha256: string;
  lastModifiedAt?: Timestamp;
  sizeBytes?: number;
}

export interface SchemaSnapshotWarning {
  kind: SchemaSnapshotWarningKind;
  sourceKind?: SchemaSourceKind;
  sourcePath?: string;
  message: string;
  details?: JsonObject;
}

export interface SchemaSnapshot {
  snapshotId: string;
  sourceMode: SchemaSourceMode;
  generatedAt: Timestamp;
  refreshedAt: Timestamp;
  verifiedAt?: Timestamp;
  fingerprint: string;
  freshnessStatus: SchemaFreshnessStatus;
  driftDetected: boolean;
  driftDetectedAt?: Timestamp;
  sources: SchemaSnapshotSource[];
  warnings: SchemaSnapshotWarning[];
  ir: SchemaIR;
}

export interface SchemaSnapshotSummary {
  state: SchemaSnapshotState;
  snapshotId?: string;
  sourceMode?: SchemaSourceMode;
  generatedAt?: Timestamp;
  refreshedAt?: Timestamp;
  fingerprint?: string;
  freshnessStatus?: SchemaFreshnessStatus;
  driftDetected?: boolean;
  sourceCount?: number;
  warningCount?: number;
}

export const SchemaSourceKindSchema = z.enum([
  "sql_migration",
  "generated_types",
  "prisma_schema",
  "drizzle_schema",
  "live_catalog",
]);

export const SchemaSourceModeSchema = z.enum([
  "repo_only",
  "repo_plus_live_verify",
  "live_refresh_enabled",
]);

export const SchemaFreshnessStatusSchema = z.enum([
  "unknown",
  "fresh",
  "stale",
  "verified",
  "drift_detected",
  "refresh_required",
]);

export const SchemaSnapshotStateSchema = z.enum(["no_sources", "not_built", "present"]);

export const SchemaSnapshotWarningKindSchema = z.enum([
  "unsupported_source",
  "source_missing",
  "parser_partial",
  "schema_sources_not_found",
]);

export const SchemaSourceRefSchema: z.ZodType<SchemaSourceRef> = z.object({
  kind: SchemaSourceKindSchema,
  path: z.string().trim().min(1),
  line: z.number().int().positive().optional(),
});

export const SchemaColumnSchema: z.ZodType<SchemaColumn> = z.object({
  name: z.string().trim().min(1),
  dataType: z.string(),
  nullable: z.boolean(),
  defaultExpression: z.string().optional(),
  isPrimaryKey: z.boolean().optional(),
  sources: z.array(SchemaSourceRefSchema),
});

export const SchemaIndexSchema: z.ZodType<SchemaIndex> = z.object({
  name: z.string().trim().min(1),
  unique: z.boolean(),
  primary: z.boolean(),
  columns: z.array(z.string().trim().min(1)),
  definition: z.string().nullable().optional(),
});

export const SchemaForeignKeyOutboundSchema: z.ZodType<SchemaForeignKeyOutbound> = z.object({
  constraintName: z.string().trim().min(1),
  columns: z.array(z.string().trim().min(1)),
  targetSchema: z.string().trim().min(1),
  targetTable: z.string().trim().min(1),
  targetColumns: z.array(z.string().trim().min(1)),
  onUpdate: z.string().trim().min(1),
  onDelete: z.string().trim().min(1),
});

export const SchemaForeignKeyInboundSchema: z.ZodType<SchemaForeignKeyInbound> = z.object({
  constraintName: z.string().trim().min(1),
  sourceSchema: z.string().trim().min(1),
  sourceTable: z.string().trim().min(1),
  sourceColumns: z.array(z.string().trim().min(1)),
  columns: z.array(z.string().trim().min(1)),
  onUpdate: z.string().trim().min(1),
  onDelete: z.string().trim().min(1),
});

export const SchemaRlsPolicySchema: z.ZodType<SchemaRlsPolicy> = z.object({
  name: z.string().trim().min(1),
  mode: z.enum(["PERMISSIVE", "RESTRICTIVE"]),
  command: z.string().trim().min(1),
  roles: z.array(z.string().trim().min(1)),
  usingExpression: z.string().nullable(),
  withCheckExpression: z.string().nullable(),
});

export const SchemaRlsStateSchema: z.ZodType<SchemaRlsState> = z.object({
  rlsEnabled: z.boolean(),
  forceRls: z.boolean(),
  policies: z.array(SchemaRlsPolicySchema),
});

export const SchemaTriggerSchema: z.ZodType<SchemaTrigger> = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean(),
  enabledMode: z.enum(["O", "D", "R", "A"]),
  timing: z.string().trim().min(1),
  events: z.array(z.string().trim().min(1)),
  bodyText: z.string().nullable().optional(),
});

export const SchemaTableSchema: z.ZodType<SchemaTable> = z.object({
  name: z.string().trim().min(1),
  schema: z.string().trim().min(1),
  columns: z.array(SchemaColumnSchema),
  primaryKey: z.array(z.string().trim().min(1)).optional(),
  indexes: z.array(SchemaIndexSchema).optional(),
  foreignKeys: z
    .object({
      outbound: z.array(SchemaForeignKeyOutboundSchema),
      inbound: z.array(SchemaForeignKeyInboundSchema),
    })
    .optional(),
  rls: SchemaRlsStateSchema.optional(),
  triggers: z.array(SchemaTriggerSchema).optional(),
  sources: z.array(SchemaSourceRefSchema),
});

export const SchemaViewSchema: z.ZodType<SchemaView> = z.object({
  name: z.string().trim().min(1),
  schema: z.string().trim().min(1),
  sources: z.array(SchemaSourceRefSchema),
});

export const SchemaEnumSchema: z.ZodType<SchemaEnum> = z.object({
  name: z.string().trim().min(1),
  schema: z.string().trim().min(1),
  values: z.array(z.string()),
  sources: z.array(SchemaSourceRefSchema),
});

export const SchemaRpcSchema: z.ZodType<SchemaRpc> = z.object({
  name: z.string().trim().min(1),
  schema: z.string().trim().min(1),
  argTypes: z.array(z.string()).optional(),
  returnType: z.string().optional(),
  bodyText: z.string().nullable().optional(),
  sources: z.array(SchemaSourceRefSchema),
});

export const SchemaNamespaceSchema: z.ZodType<SchemaNamespace> = z.object({
  tables: z.array(SchemaTableSchema),
  views: z.array(SchemaViewSchema),
  enums: z.array(SchemaEnumSchema),
  rpcs: z.array(SchemaRpcSchema),
});

export const SchemaIRSchema: z.ZodType<SchemaIR> = z.object({
  version: z.literal("1.0.0"),
  schemas: z.record(z.string().trim().min(1), SchemaNamespaceSchema),
});

export const SchemaSnapshotSourceSchema: z.ZodType<SchemaSnapshotSource> = z.object({
  kind: SchemaSourceKindSchema,
  path: z.string().trim().min(1),
  sha256: z.string().trim().min(1),
  lastModifiedAt: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export const SchemaSnapshotWarningSchema: z.ZodType<SchemaSnapshotWarning> = z.object({
  kind: SchemaSnapshotWarningKindSchema,
  sourceKind: SchemaSourceKindSchema.optional(),
  sourcePath: z.string().optional(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional() as unknown as z.ZodType<JsonObject | undefined>,
});

export const SchemaSnapshotSchema: z.ZodType<SchemaSnapshot> = z.object({
  snapshotId: z.string().trim().min(1),
  sourceMode: SchemaSourceModeSchema,
  generatedAt: z.string(),
  refreshedAt: z.string(),
  verifiedAt: z.string().optional(),
  fingerprint: z.string().trim().min(1),
  freshnessStatus: SchemaFreshnessStatusSchema,
  driftDetected: z.boolean(),
  driftDetectedAt: z.string().optional(),
  sources: z.array(SchemaSnapshotSourceSchema),
  warnings: z.array(SchemaSnapshotWarningSchema),
  ir: SchemaIRSchema,
});

export const SchemaSnapshotSummarySchema: z.ZodType<SchemaSnapshotSummary> = z.object({
  state: SchemaSnapshotStateSchema,
  snapshotId: z.string().optional(),
  sourceMode: SchemaSourceModeSchema.optional(),
  generatedAt: z.string().optional(),
  refreshedAt: z.string().optional(),
  fingerprint: z.string().optional(),
  freshnessStatus: SchemaFreshnessStatusSchema.optional(),
  driftDetected: z.boolean().optional(),
  sourceCount: z.number().int().nonnegative().optional(),
  warningCount: z.number().int().nonnegative().optional(),
});
