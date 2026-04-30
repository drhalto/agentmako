import { z } from "zod";
import type { JsonObject } from "./common.js";
import { ProjectLocatorInputObjectSchema, type ProjectLocatorInput } from "./tool-project-locator.js";
import { ToolNameSchema, type ToolName } from "./tool-registry.js";

const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;

export const MakoHelpRecipeIdSchema = z.enum([
  "auth_flow_audit",
  "db_schema_rls_audit",
  "file_edit_preflight",
  "review_verify_changes",
  "diagnostics_triage",
  "general_orientation",
]);
export type MakoHelpRecipeId = z.infer<typeof MakoHelpRecipeIdSchema>;

export const MakoHelpPhaseSchema = z.enum([
  "orient",
  "inspect",
  "expand",
  "pre_edit",
  "post_edit",
  "verify",
]);
export type MakoHelpPhase = z.infer<typeof MakoHelpPhaseSchema>;

export interface MakoHelpToolStep {
  id: string;
  phase: MakoHelpPhase;
  toolName: ToolName;
  title: string;
  why: string;
  whenToUse: string;
  suggestedArgs: JsonObject;
  readOnly: boolean;
  batchable: boolean;
}

export const MakoHelpToolStepSchema = z.object({
  id: z.string().min(1),
  phase: MakoHelpPhaseSchema,
  toolName: ToolNameSchema,
  title: z.string().min(1),
  why: z.string().min(1),
  whenToUse: z.string().min(1),
  suggestedArgs: JsonObjectSchema,
  readOnly: z.boolean(),
  batchable: z.boolean(),
}) satisfies z.ZodType<MakoHelpToolStep>;

export interface MakoHelpToolInput extends ProjectLocatorInput {
  task: string;
  focusFiles?: string[];
  changedFiles?: string[];
  route?: string;
  table?: string;
  rpc?: string;
  maxSteps?: number;
}

export const MakoHelpToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  task: z.string().trim().min(1),
  focusFiles: z.array(z.string().trim().min(1)).max(20).optional(),
  changedFiles: z.array(z.string().trim().min(1)).max(20).optional(),
  route: z.string().trim().min(1).optional(),
  table: z.string().trim().min(1).optional(),
  rpc: z.string().trim().min(1).optional(),
  maxSteps: z.number().int().min(1).max(12).optional(),
}).strict() satisfies z.ZodType<MakoHelpToolInput>;

export interface MakoHelpToolOutput {
  toolName: "mako_help";
  task: string;
  recipeId: MakoHelpRecipeId;
  summary: string;
  steps: MakoHelpToolStep[];
  batchHint: {
    toolName: "tool_batch";
    suggestedArgs: JsonObject;
    eligibleStepIds: string[];
  };
  notes: string[];
}

export const MakoHelpToolOutputSchema = z.object({
  toolName: z.literal("mako_help"),
  task: z.string().min(1),
  recipeId: MakoHelpRecipeIdSchema,
  summary: z.string().min(1),
  steps: z.array(MakoHelpToolStepSchema),
  batchHint: z.object({
    toolName: z.literal("tool_batch"),
    suggestedArgs: JsonObjectSchema,
    eligibleStepIds: z.array(z.string().min(1)),
  }),
  notes: z.array(z.string().min(1)),
}) satisfies z.ZodType<MakoHelpToolOutput>;
