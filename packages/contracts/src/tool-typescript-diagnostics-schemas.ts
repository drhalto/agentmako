import { z } from "zod";
import {
  ProjectFindingSchema,
  type ProjectFinding,
} from "./reef.js";
import { ProjectLocatorInputObjectSchema, type ProjectLocatorInput } from "./tool-project-locator.js";

export const TypeScriptDiagnosticsRunStatusSchema = z.enum([
  "unavailable",
  "ran_with_error",
  "succeeded",
]);
export type TypeScriptDiagnosticsRunStatus = z.infer<typeof TypeScriptDiagnosticsRunStatusSchema>;

export interface TypeScriptDiagnosticsToolInput extends ProjectLocatorInput {
  files?: string[];
  tsconfigPath?: string;
  maxFindings?: number;
}

export const TypeScriptDiagnosticsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  files: z.array(z.string().trim().min(1)).min(1).max(200).optional(),
  tsconfigPath: z.string().trim().min(1).optional(),
  maxFindings: z.number().int().positive().max(1000).optional(),
}).strict() satisfies z.ZodType<TypeScriptDiagnosticsToolInput>;

export interface TypeScriptDiagnosticsToolOutput {
  toolName: "typescript_diagnostics";
  projectId: string;
  projectRoot: string;
  status: TypeScriptDiagnosticsRunStatus;
  durationMs: number;
  tsconfigPath?: string;
  requestedFiles: string[];
  checkedFileCount: number;
  findings: ProjectFinding[];
  totalFindings: number;
  persistedFindings: number;
  truncated: boolean;
  warnings: string[];
  errorText?: string;
}

export const TypeScriptDiagnosticsToolOutputSchema = z.object({
  toolName: z.literal("typescript_diagnostics"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  status: TypeScriptDiagnosticsRunStatusSchema,
  durationMs: z.number().int().nonnegative(),
  tsconfigPath: z.string().min(1).optional(),
  requestedFiles: z.array(z.string().min(1)),
  checkedFileCount: z.number().int().nonnegative(),
  findings: z.array(ProjectFindingSchema),
  totalFindings: z.number().int().nonnegative(),
  persistedFindings: z.number().int().nonnegative(),
  truncated: z.boolean(),
  warnings: z.array(z.string().min(1)),
  errorText: z.string().min(1).optional(),
}) satisfies z.ZodType<TypeScriptDiagnosticsToolOutput>;
