import { z } from "zod";
import type { ProjectLocatorInput } from "./tool-project-locator.js";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";

const DbPlatformSchema = z.enum(["postgres", "supabase", "unknown"]);
export type DbPlatform = z.infer<typeof DbPlatformSchema>;

export interface DbPingToolInput extends ProjectLocatorInput {}
export const DbPingToolInputSchema = ProjectLocatorInputObjectSchema.strict() satisfies z.ZodType<DbPingToolInput>;

export const DbPingToolOutputSchema = z.object({
  toolName: z.literal("db_ping"),
  connected: z.literal(true),
  platform: DbPlatformSchema,
  database: z.string(),
  serverVersion: z.string(),
  currentUser: z.string(),
  readOnly: z.boolean(),
  schemas: z.array(z.string()),
});

export type DbPingToolOutput = z.infer<typeof DbPingToolOutputSchema>;

const DbTableInputSchema = ProjectLocatorInputObjectSchema.extend({
  table: z.string().trim().min(1),
  schema: z.string().trim().min(1).optional(),
}).strict();

export interface DbColumnsToolInput extends ProjectLocatorInput {
  table: string;
  schema?: string;
}

export const DbColumnsToolInputSchema = DbTableInputSchema satisfies z.ZodType<DbColumnsToolInput>;

export const DbColumnDescriptorSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
  isPrimaryKey: z.boolean(),
  isIdentity: z.boolean(),
  comment: z.string().nullable().optional(),
});

export type DbColumnDescriptor = z.infer<typeof DbColumnDescriptorSchema>;

export const DbColumnsToolOutputSchema = z.object({
  toolName: z.literal("db_columns"),
  table: z.string(),
  schema: z.string(),
  columns: z.array(DbColumnDescriptorSchema),
});

export type DbColumnsToolOutput = z.infer<typeof DbColumnsToolOutputSchema>;

export interface DbFkToolInput extends ProjectLocatorInput {
  table: string;
  schema?: string;
}

export const DbFkToolInputSchema = DbTableInputSchema satisfies z.ZodType<DbFkToolInput>;

export const DbForeignKeyOutboundSchema = z.object({
  constraintName: z.string(),
  columns: z.array(z.string()),
  targetSchema: z.string(),
  targetTable: z.string(),
  targetColumns: z.array(z.string()),
  onUpdate: z.string(),
  onDelete: z.string(),
});

export const DbForeignKeyInboundSchema = z.object({
  constraintName: z.string(),
  sourceSchema: z.string(),
  sourceTable: z.string(),
  sourceColumns: z.array(z.string()),
  columns: z.array(z.string()),
  onUpdate: z.string(),
  onDelete: z.string(),
});

export type DbForeignKeyOutbound = z.infer<typeof DbForeignKeyOutboundSchema>;
export type DbForeignKeyInbound = z.infer<typeof DbForeignKeyInboundSchema>;

export const DbFkToolOutputSchema = z.object({
  toolName: z.literal("db_fk"),
  table: z.string(),
  schema: z.string(),
  outbound: z.array(DbForeignKeyOutboundSchema),
  inbound: z.array(DbForeignKeyInboundSchema),
});

export type DbFkToolOutput = z.infer<typeof DbFkToolOutputSchema>;

export interface DbRlsToolInput extends ProjectLocatorInput {
  table: string;
  schema?: string;
}

export const DbRlsToolInputSchema = DbTableInputSchema satisfies z.ZodType<DbRlsToolInput>;

export const DbRlsPolicySchema = z.object({
  name: z.string(),
  mode: z.enum(["PERMISSIVE", "RESTRICTIVE"]),
  command: z.string(),
  roles: z.array(z.string()),
  usingExpression: z.string().nullable(),
  withCheckExpression: z.string().nullable(),
});

export type DbRlsPolicy = z.infer<typeof DbRlsPolicySchema>;

export const DbRlsToolOutputSchema = z.object({
  toolName: z.literal("db_rls"),
  table: z.string(),
  schema: z.string(),
  rlsEnabled: z.boolean(),
  forceRls: z.boolean(),
  policies: z.array(DbRlsPolicySchema),
});

export type DbRlsToolOutput = z.infer<typeof DbRlsToolOutputSchema>;

export interface DbRpcToolInput extends ProjectLocatorInput {
  name?: string;
  schema?: string;
  argTypes?: string[];
  includeSource?: boolean;
  list?: boolean;
  limit?: number;
  includeSystemSchemas?: boolean;
}

export const DbRpcToolInputSchema = z
  .object({
    projectId: z.string().trim().min(1).optional(),
    projectRef: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    schema: z.string().trim().min(1).optional(),
    argTypes: z.array(z.string().trim().min(1)).optional(),
    includeSource: z.boolean().optional(),
    list: z.boolean().optional(),
    limit: z.number().int().min(1).max(1_000).optional(),
    includeSystemSchemas: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<DbRpcToolInput>;

export const DbRpcArgumentSchema = z.object({
  name: z.string().nullable(),
  type: z.string(),
  mode: z.enum(["in", "out", "inout", "variadic", "table"]),
});

export const DbRpcLookupToolOutputSchema = z.object({
  toolName: z.literal("db_rpc"),
  name: z.string(),
  schema: z.string(),
  args: z.array(DbRpcArgumentSchema),
  returns: z.string(),
  language: z.string(),
  securityDefiner: z.boolean(),
  volatility: z.enum(["immutable", "stable", "volatile"]),
  source: z.string().nullable(),
});

export const DbRpcListEntrySchema = z.object({
  name: z.string(),
  schema: z.string(),
  kind: z.enum(["function", "procedure"]),
  argTypes: z.array(z.string()),
  args: z.array(DbRpcArgumentSchema),
  returns: z.string(),
  language: z.string(),
  securityDefiner: z.boolean(),
  volatility: z.enum(["immutable", "stable", "volatile"]),
});

export const DbRpcListToolOutputSchema = z.object({
  toolName: z.literal("db_rpc"),
  mode: z.literal("list"),
  schema: z.string().optional(),
  rpcs: z.array(DbRpcListEntrySchema),
  totalReturned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  limit: z.number().int().min(1),
});

export const DbRpcToolOutputSchema = z.object({
  toolName: z.literal("db_rpc"),
  mode: z.enum(["lookup", "list"]).optional(),
  name: z.string().optional(),
  schema: z.string().optional(),
  args: z.array(DbRpcArgumentSchema).optional(),
  returns: z.string().optional(),
  language: z.string().optional(),
  securityDefiner: z.boolean().optional(),
  volatility: z.enum(["immutable", "stable", "volatile"]).optional(),
  source: z.string().nullable().optional(),
  rpcs: z.array(DbRpcListEntrySchema).optional(),
  totalReturned: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  limit: z.number().int().min(1).optional(),
});

export type DbRpcToolOutput = z.infer<typeof DbRpcToolOutputSchema>;

export interface DbTableSchemaToolInput extends ProjectLocatorInput {
  table: string;
  schema?: string;
}

export const DbTableSchemaToolInputSchema = DbTableInputSchema satisfies z.ZodType<DbTableSchemaToolInput>;

export const DbIndexDescriptorSchema = z.object({
  name: z.string(),
  unique: z.boolean(),
  primary: z.boolean(),
  columns: z.array(z.string()),
  definition: z.string().nullable().optional(),
});

export const DbConstraintDescriptorSchema = z.object({
  name: z.string(),
  type: z.string(),
  definition: z.string().nullable().optional(),
});

export const DbTriggerDescriptorSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  enabledMode: z.enum(["O", "D", "R", "A"]),
  timing: z.string(),
  events: z.array(z.string()),
});

export const DbTableSchemaToolOutputSchema = z.object({
  toolName: z.literal("db_table_schema"),
  table: z.string(),
  schema: z.string(),
  columns: z.array(DbColumnDescriptorSchema),
  indexes: z.array(DbIndexDescriptorSchema),
  constraints: z.array(DbConstraintDescriptorSchema),
  foreignKeys: z.object({
    outbound: z.array(DbForeignKeyOutboundSchema),
    inbound: z.array(DbForeignKeyInboundSchema),
  }),
  rls: z.object({
    rlsEnabled: z.boolean(),
    forceRls: z.boolean(),
    policies: z.array(DbRlsPolicySchema),
  }),
  triggers: z.array(DbTriggerDescriptorSchema),
});

export type DbTableSchemaToolOutput = z.infer<typeof DbTableSchemaToolOutputSchema>;
