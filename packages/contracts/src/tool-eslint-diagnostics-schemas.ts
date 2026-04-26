import { z } from "zod";
import {
  ProjectFindingSchema,
  ReefDiagnosticRunStatusSchema,
  type ProjectFinding,
  type ReefDiagnosticRunStatus,
} from "./reef.js";
import { ProjectLocatorInputObjectSchema, type ProjectLocatorInput } from "./tool-project-locator.js";

export interface EslintDiagnosticsToolInput extends ProjectLocatorInput {
  files: string[];
  scriptName?: string;
  maxFindings?: number;
}

export const EslintDiagnosticsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  files: z.array(z.string().trim().min(1)).min(1).max(200),
  scriptName: z.string().trim().min(1).optional(),
  maxFindings: z.number().int().positive().max(1000).optional(),
}).strict() satisfies z.ZodType<EslintDiagnosticsToolInput>;

export interface EslintDiagnosticsToolOutput {
  toolName: "eslint_diagnostics";
  projectId: string;
  projectRoot: string;
  status: ReefDiagnosticRunStatus;
  durationMs: number;
  requestedFiles: string[];
  checkedFileCount: number;
  command?: string;
  exitCode?: number;
  findings: ProjectFinding[];
  totalFindings: number;
  persistedFindings: number;
  truncated: boolean;
  warnings: string[];
  errorText?: string;
}

export const EslintDiagnosticsToolOutputSchema = z.object({
  toolName: z.literal("eslint_diagnostics"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  status: ReefDiagnosticRunStatusSchema,
  durationMs: z.number().int().nonnegative(),
  requestedFiles: z.array(z.string().min(1)),
  checkedFileCount: z.number().int().nonnegative(),
  command: z.string().min(1).optional(),
  exitCode: z.number().int().optional(),
  findings: z.array(ProjectFindingSchema),
  totalFindings: z.number().int().nonnegative(),
  persistedFindings: z.number().int().nonnegative(),
  truncated: z.boolean(),
  warnings: z.array(z.string().min(1)),
  errorText: z.string().min(1).optional(),
}) satisfies z.ZodType<EslintDiagnosticsToolOutput>;
