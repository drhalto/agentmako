import { z } from "zod";
import type { AnswerResult } from "./answer.js";
import type { JsonObject } from "./common.js";
import type { ProjectLocatorInput } from "./tool-project-locator.js";
import {
  JsonObjectSchema,
} from "./tool-schema-shared.js";
import { AnswerResultSchema } from "./tool-answer-schemas.js";
import {
  ProjectLocatorInputObjectSchema,
  ProjectLocatorInputSchema,
} from "./tool-project-locator.js";
import { ReefToolExecutionSchema } from "./tool-reef-execution-schemas.js";
import { ReefProjectSchemaStatusSchema } from "./reef-service.js";

export interface RouteTraceToolInput extends ProjectLocatorInput {
  route: string;
}

export const RouteTraceToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  route: z.string().trim().min(1),
}) satisfies z.ZodType<RouteTraceToolInput>;

export interface SchemaUsageToolInput extends ProjectLocatorInput {
  object: string;
  schema?: string;
}

export const SchemaUsageToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  object: z.string().trim().min(1),
  schema: z.string().trim().min(1).optional(),
}) satisfies z.ZodType<SchemaUsageToolInput>;

export interface FileHealthToolInput extends ProjectLocatorInput {
  file: string;
}

export const FileHealthToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  file: z.string().trim().min(1),
}) satisfies z.ZodType<FileHealthToolInput>;

export interface AuthPathToolInput extends ProjectLocatorInput {
  route?: string;
  file?: string;
  feature?: string;
}

const AuthPathTargetSchema = z.union([
  z.object({
    route: z.string().trim().min(1),
    file: z.string().trim().min(1).optional(),
    feature: z.string().trim().min(1).optional(),
  }),
  z.object({
    route: z.string().trim().min(1).optional(),
    file: z.string().trim().min(1),
    feature: z.string().trim().min(1).optional(),
  }),
  z.object({
    route: z.string().trim().min(1).optional(),
    file: z.string().trim().min(1).optional(),
    feature: z.string().trim().min(1),
  }),
]);

export const AuthPathToolInputSchema = ProjectLocatorInputObjectSchema.and(
  AuthPathTargetSchema,
) satisfies z.ZodType<AuthPathToolInput>;

export interface ImportsDepsToolInput extends ProjectLocatorInput {
  file: string;
}

export const ImportsDepsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  file: z.string().trim().min(1),
}) satisfies z.ZodType<ImportsDepsToolInput>;

export interface ImportsImpactToolInput extends ProjectLocatorInput {
  file: string;
  depth?: number;
}

export const ImportsImpactToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  file: z.string().trim().min(1),
  depth: z.number().int().min(1).max(8).default(2),
}) satisfies z.ZodType<ImportsImpactToolInput>;

export interface ImportsHotspotsToolInput extends ProjectLocatorInput {
  limit?: number;
}

export const ImportsHotspotsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  limit: z.number().int().min(1).max(50).default(10),
}) satisfies z.ZodType<ImportsHotspotsToolInput>;

export type ImportsCyclesToolInput = ProjectLocatorInput;
export const ImportsCyclesToolInputSchema = ProjectLocatorInputSchema;

export interface SymbolsOfToolInput extends ProjectLocatorInput {
  file: string;
}

export const SymbolsOfToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  file: z.string().trim().min(1),
}) satisfies z.ZodType<SymbolsOfToolInput>;

export interface ExportsOfToolInput extends ProjectLocatorInput {
  file: string;
}

export const ExportsOfToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  file: z.string().trim().min(1),
}) satisfies z.ZodType<ExportsOfToolInput>;

export interface ToolSymbol {
  name: string;
  kind: string;
  exportName?: string;
  lineStart?: number;
  lineEnd?: number;
  signatureText?: string;
  metadata?: JsonObject;
}

export const ToolSymbolSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  exportName: z.string().min(1).optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  signatureText: z.string().optional(),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ToolSymbol>;

export interface ToolImportLink {
  sourcePath: string;
  targetPath: string;
  specifier: string;
  importKind: string;
  isTypeOnly: boolean;
  line?: number;
  targetExists: boolean;
}

export const ToolImportLinkSchema = z.object({
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
  specifier: z.string().min(1),
  importKind: z.string().min(1),
  isTypeOnly: z.boolean(),
  line: z.number().int().positive().optional(),
  targetExists: z.boolean(),
}) satisfies z.ZodType<ToolImportLink>;

export interface ImportsImpactEntry {
  filePath: string;
  depth: number;
  via: string[];
}

export const ImportsImpactEntrySchema = z.object({
  filePath: z.string().min(1),
  depth: z.number().int().min(1),
  via: z.array(z.string().min(1)),
}) satisfies z.ZodType<ImportsImpactEntry>;

export interface ImportsHotspotEntry {
  filePath: string;
  inboundCount: number;
  outboundCount: number;
  totalConnections: number;
}

export const ImportsHotspotEntrySchema = z.object({
  filePath: z.string().min(1),
  inboundCount: z.number().int().min(0),
  outboundCount: z.number().int().min(0),
  totalConnections: z.number().int().min(0),
}) satisfies z.ZodType<ImportsHotspotEntry>;

const AnswerToolResultBaseSchema = z.object({
  projectId: z.string().min(1),
  result: AnswerResultSchema,
});

const CompactVerbositySchema = z.enum(["compact", "full"]);

const ToolFallbackSuggestionSchema = z.object({
  tool: z.string().min(1),
  args: JsonObjectSchema,
  reason: z.string().min(1).optional(),
});

export const RouteTraceToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("route_trace"),
});

export const SchemaUsageToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("schema_usage"),
  reefExecution: ReefToolExecutionSchema.optional(),
  schemaFreshness: ReefProjectSchemaStatusSchema.optional(),
});

export const FileHealthToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("file_health"),
});

export const AuthPathToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("auth_path"),
  matched: z.boolean().optional(),
  reason: z.string().min(1).optional(),
  fallbackReason: z.string().min(1).optional(),
  suggestedNext: ToolFallbackSuggestionSchema.optional(),
});

export interface TraceFileToolInput extends ProjectLocatorInput {
  file: string;
}

export const TraceFileToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  file: z.string().trim().min(1),
}) satisfies z.ZodType<TraceFileToolInput>;

export const TraceFileToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("trace_file"),
});

export interface PreflightTableToolInput extends ProjectLocatorInput {
  table: string;
  schema?: string;
}

export const PreflightTableToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  table: z.string().trim().min(1),
  schema: z.string().trim().min(1).optional(),
}) satisfies z.ZodType<PreflightTableToolInput>;

export const PreflightTableToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("preflight_table"),
});

export interface CrossSearchToolInput extends ProjectLocatorInput {
  term: string;
  limit?: number;
  verbosity?: "compact" | "full";
}

export const CrossSearchToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  term: z.string().trim().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  verbosity: CompactVerbositySchema.optional(),
}) satisfies z.ZodType<CrossSearchToolInput>;

export const CrossSearchToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("cross_search"),
});

export interface TraceEdgeToolInput extends ProjectLocatorInput {
  name: string;
}

export const TraceEdgeToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  name: z.string().trim().min(1),
}) satisfies z.ZodType<TraceEdgeToolInput>;

export const TraceEdgeToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("trace_edge"),
});

export interface TraceErrorToolInput extends ProjectLocatorInput {
  term: string;
}

export const TraceErrorToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  term: z.string().trim().min(1),
}) satisfies z.ZodType<TraceErrorToolInput>;

export const TraceErrorToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("trace_error"),
});

export interface TraceTableToolInput extends ProjectLocatorInput {
  table: string;
  schema?: string;
}

export const TraceTableToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  table: z.string().trim().min(1),
  schema: z.string().trim().min(1).optional(),
}) satisfies z.ZodType<TraceTableToolInput>;

export const TraceTableToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("trace_table"),
});

export interface TraceRpcToolInput extends ProjectLocatorInput {
  name: string;
  schema?: string;
  argTypes?: string[];
}

export const TraceRpcToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  name: z.string().trim().min(1),
  schema: z.string().trim().min(1).optional(),
  argTypes: z.array(z.string().trim().min(1)).optional(),
}) satisfies z.ZodType<TraceRpcToolInput>;

export const TraceRpcToolOutputSchema = AnswerToolResultBaseSchema.extend({
  toolName: z.literal("trace_rpc"),
});

export type RouteTraceToolOutput = z.infer<typeof RouteTraceToolOutputSchema>;
export type SchemaUsageToolOutput = z.infer<typeof SchemaUsageToolOutputSchema>;
export type FileHealthToolOutput = z.infer<typeof FileHealthToolOutputSchema>;
export type AuthPathToolOutput = z.infer<typeof AuthPathToolOutputSchema>;
export type TraceFileToolOutput = z.infer<typeof TraceFileToolOutputSchema>;
export type PreflightTableToolOutput = z.infer<typeof PreflightTableToolOutputSchema>;
export type CrossSearchToolOutput = z.infer<typeof CrossSearchToolOutputSchema>;
export type TraceEdgeToolOutput = z.infer<typeof TraceEdgeToolOutputSchema>;
export type TraceErrorToolOutput = z.infer<typeof TraceErrorToolOutputSchema>;
export type TraceTableToolOutput = z.infer<typeof TraceTableToolOutputSchema>;
export type TraceRpcToolOutput = z.infer<typeof TraceRpcToolOutputSchema>;

export const ImportsDepsToolOutputSchema = z.object({
  toolName: z.literal("imports_deps"),
  projectId: z.string().min(1),
  file: z.string().min(1),
  resolvedFilePath: z.string().min(1).nullable(),
  imports: z.array(ToolImportLinkSchema),
  unresolved: z.array(ToolImportLinkSchema),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string()),
});

export type ImportsDepsToolOutput = z.infer<typeof ImportsDepsToolOutputSchema>;

export const ImportsImpactToolOutputSchema = z.object({
  toolName: z.literal("imports_impact"),
  projectId: z.string().min(1),
  file: z.string().min(1),
  resolvedFilePath: z.string().min(1).nullable(),
  depth: z.number().int().min(1),
  impactedFiles: z.array(ImportsImpactEntrySchema),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string()),
});

export type ImportsImpactToolOutput = z.infer<typeof ImportsImpactToolOutputSchema>;

export const ImportsHotspotsToolOutputSchema = z.object({
  toolName: z.literal("imports_hotspots"),
  projectId: z.string().min(1),
  limit: z.number().int().min(1),
  hotspots: z.array(ImportsHotspotEntrySchema),
  reefExecution: ReefToolExecutionSchema,
});

export type ImportsHotspotsToolOutput = z.infer<typeof ImportsHotspotsToolOutputSchema>;

export const ImportsCyclesToolOutputSchema = z.object({
  toolName: z.literal("imports_cycles"),
  projectId: z.string().min(1),
  cycles: z.array(z.array(z.string().min(1))),
  reefExecution: ReefToolExecutionSchema,
});

export type ImportsCyclesToolOutput = z.infer<typeof ImportsCyclesToolOutputSchema>;

export const SymbolsOfToolOutputSchema = z.object({
  toolName: z.literal("symbols_of"),
  projectId: z.string().min(1),
  file: z.string().min(1),
  resolvedFilePath: z.string().min(1).nullable(),
  symbols: z.array(ToolSymbolSchema),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string()),
});

export type SymbolsOfToolOutput = z.infer<typeof SymbolsOfToolOutputSchema>;

export const ExportsOfToolOutputSchema = z.object({
  toolName: z.literal("exports_of"),
  projectId: z.string().min(1),
  file: z.string().min(1),
  resolvedFilePath: z.string().min(1).nullable(),
  exports: z.array(ToolSymbolSchema),
  reefExecution: ReefToolExecutionSchema,
  warnings: z.array(z.string()),
});

export type ExportsOfToolOutput = z.infer<typeof ExportsOfToolOutputSchema>;

export interface AskToolInput extends Partial<ProjectLocatorInput> {
  question: string;
}

export const AskToolInputSchema = z
  .object({
    question: z.string().trim().min(1),
    projectId: z.string().trim().min(1).optional(),
    projectRef: z.string().trim().min(1).optional(),
  })
  .strict() satisfies z.ZodType<AskToolInput>;

export const AskModeSchema = z.enum(["tool", "fallback"]);
export type AskMode = z.infer<typeof AskModeSchema>;

export const AskSelectedFamilySchema = z.enum(["answers", "imports", "symbols", "db", "composer", "fallback"]);
export type AskSelectedFamily = z.infer<typeof AskSelectedFamilySchema>;

export interface AskToolOutput extends JsonObject {
  toolName: "ask";
  mode: AskMode;
  selectedFamily: AskSelectedFamily;
  selectedTool: string;
  selectedArgs: JsonObject;
  confidence: number;
  fallbackReason: string | null;
  result: JsonObject;
}

export const AskToolOutputSchema = z.object({
  toolName: z.literal("ask"),
  mode: AskModeSchema,
  selectedFamily: AskSelectedFamilySchema,
  selectedTool: z.string().min(1),
  selectedArgs: JsonObjectSchema,
  confidence: z.number().min(0).max(1),
  fallbackReason: z.string().nullable(),
  result: JsonObjectSchema,
}) satisfies z.ZodType<AskToolOutput>;
