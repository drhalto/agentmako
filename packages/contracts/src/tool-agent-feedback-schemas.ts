import { z } from "zod";
import {
  RuntimeUsefulnessGradeSchema,
  type RuntimeUsefulnessGrade,
} from "./runtime-telemetry.js";
import type { ProjectLocatorInput } from "./tool-project-locator.js";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";

/**
 * `agent_feedback` writes direct agent usefulness feedback into the
 * shared runtime telemetry table. It intentionally requires a request
 * id so feedback stays tied to a concrete prior tool run.
 */

export interface AgentFeedbackToolInput extends ProjectLocatorInput {
  referencedToolName: string;
  referencedRequestId: string;
  grade: RuntimeUsefulnessGrade;
  reasonCodes: string[];
  reason?: string;
}

export const AgentFeedbackToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  referencedToolName: z.string().trim().min(1),
  referencedRequestId: z.string().trim().min(1),
  grade: RuntimeUsefulnessGradeSchema,
  reasonCodes: z.array(z.string().trim().min(1)).min(1).max(20),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict() satisfies z.ZodType<AgentFeedbackToolInput>;

export interface AgentFeedbackToolOutput {
  toolName: "agent_feedback";
  projectId: string;
  eventId: string;
  capturedAt: string;
}

export const AgentFeedbackToolOutputSchema = z.object({
  toolName: z.literal("agent_feedback"),
  projectId: z.string().min(1),
  eventId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
}) satisfies z.ZodType<AgentFeedbackToolOutput>;

export interface AgentFeedbackReportToolInput extends ProjectLocatorInput {
  referencedToolName?: string;
  grade?: RuntimeUsefulnessGrade;
  since?: string;
  until?: string;
  limit?: number;
}

export const AgentFeedbackReportToolInputSchema =
  ProjectLocatorInputObjectSchema.extend({
    referencedToolName: z.string().trim().min(1).optional(),
    grade: RuntimeUsefulnessGradeSchema.optional(),
    since: z.string().datetime({ offset: true }).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(500).optional(),
  }).strict() satisfies z.ZodType<AgentFeedbackReportToolInput>;

export interface AgentFeedbackAggregate {
  referencedToolName: string;
  full: number;
  partial: number;
  no: number;
  total: number;
}

export const AgentFeedbackAggregateSchema = z.object({
  referencedToolName: z.string().min(1),
  full: z.number().int().nonnegative(),
  partial: z.number().int().nonnegative(),
  no: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}) satisfies z.ZodType<AgentFeedbackAggregate>;

export interface AgentFeedbackEntry {
  eventId: string;
  capturedAt: string;
  referencedToolName: string;
  referencedRequestId: string;
  grade: RuntimeUsefulnessGrade;
  reasonCodes: string[];
  reason?: string;
}

export const AgentFeedbackEntrySchema = z.object({
  eventId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  referencedToolName: z.string().min(1),
  referencedRequestId: z.string().min(1),
  grade: RuntimeUsefulnessGradeSchema,
  reasonCodes: z.array(z.string().min(1)),
  reason: z.string().min(1).optional(),
}) satisfies z.ZodType<AgentFeedbackEntry>;

export interface AgentFeedbackReportToolOutput {
  toolName: "agent_feedback_report";
  projectId: string;
  feedbackInWindow: number;
  byTool: AgentFeedbackAggregate[];
  entries: AgentFeedbackEntry[];
  truncated: boolean;
  warnings: string[];
}

export const AgentFeedbackReportToolOutputSchema = z.object({
  toolName: z.literal("agent_feedback_report"),
  projectId: z.string().min(1),
  feedbackInWindow: z.number().int().nonnegative(),
  byTool: z.array(AgentFeedbackAggregateSchema),
  entries: z.array(AgentFeedbackEntrySchema),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<AgentFeedbackReportToolOutput>;
