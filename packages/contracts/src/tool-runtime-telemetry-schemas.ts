import { z } from "zod";
import {
  RUNTIME_USEFULNESS_DECISION_KINDS,
  RuntimeUsefulnessDecisionKindSchema,
  RuntimeUsefulnessEventSchema,
  RuntimeUsefulnessGradeSchema,
  type RuntimeUsefulnessDecisionKind,
  type RuntimeUsefulnessEvent,
  type RuntimeUsefulnessGrade,
} from "./runtime-telemetry.js";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";

/**
 * `runtime_telemetry_report` — read-only view over
 * `mako_usefulness_events` rows persisted by Phase 8.1b capture sites.
 *
 * Returns both aggregate counts (by decisionKind, by family, by grade)
 * and a bounded list of raw events. 8.1c ships this as the operator
 * surface so "we have the data but can't see it" is not a bottleneck
 * before 8.2 read models open.
 *
 * Scope:
 * - read-only; never writes to the event table
 * - filtered by projectId (required via locator), optional decisionKind,
 *   family, requestId, and time window
 * - events are ordered by `capturedAt DESC` with stable tie-break on
 *   eventId, matching `queryUsefulnessEvents` in @mako-ai/store
 */

export interface RuntimeTelemetryReportToolInput {
  projectId?: string;
  projectRef?: string;
  decisionKind?: RuntimeUsefulnessDecisionKind;
  family?: string;
  requestId?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export const RuntimeTelemetryReportToolInputSchema =
  ProjectLocatorInputObjectSchema.extend({
    decisionKind: RuntimeUsefulnessDecisionKindSchema.optional(),
    family: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1).optional(),
    since: z.string().datetime({ offset: true }).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().positive().max(500).optional(),
  }).strict() satisfies z.ZodType<RuntimeTelemetryReportToolInput>;

export interface RuntimeTelemetryReportDecisionKindCount {
  decisionKind: RuntimeUsefulnessDecisionKind;
  count: number;
}

export const RuntimeTelemetryReportDecisionKindCountSchema = z.object({
  decisionKind: RuntimeUsefulnessDecisionKindSchema,
  count: z.number().int().nonnegative(),
}) satisfies z.ZodType<RuntimeTelemetryReportDecisionKindCount>;

export interface RuntimeTelemetryReportFamilyCount {
  family: string;
  decisionKind: RuntimeUsefulnessDecisionKind;
  count: number;
}

export const RuntimeTelemetryReportFamilyCountSchema = z.object({
  family: z.string().min(1),
  decisionKind: RuntimeUsefulnessDecisionKindSchema,
  count: z.number().int().nonnegative(),
}) satisfies z.ZodType<RuntimeTelemetryReportFamilyCount>;

export interface RuntimeTelemetryReportGradeCount {
  grade: RuntimeUsefulnessGrade;
  count: number;
}

export const RuntimeTelemetryReportGradeCountSchema = z.object({
  grade: RuntimeUsefulnessGradeSchema,
  count: z.number().int().nonnegative(),
}) satisfies z.ZodType<RuntimeTelemetryReportGradeCount>;

export interface RuntimeTelemetryReportToolOutput {
  toolName: "runtime_telemetry_report";
  projectId: string;
  eventsInWindow: number;
  byDecisionKind: RuntimeTelemetryReportDecisionKindCount[];
  byFamily: RuntimeTelemetryReportFamilyCount[];
  byGrade: RuntimeTelemetryReportGradeCount[];
  events: RuntimeUsefulnessEvent[];
  truncated: boolean;
  warnings: string[];
}

export const RuntimeTelemetryReportToolOutputSchema = z.object({
  toolName: z.literal("runtime_telemetry_report"),
  projectId: z.string().min(1),
  eventsInWindow: z.number().int().nonnegative(),
  byDecisionKind: z.array(RuntimeTelemetryReportDecisionKindCountSchema),
  byFamily: z.array(RuntimeTelemetryReportFamilyCountSchema),
  byGrade: z.array(RuntimeTelemetryReportGradeCountSchema),
  events: z.array(RuntimeUsefulnessEventSchema),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<RuntimeTelemetryReportToolOutput>;

// Re-export decision-kind list so the tool handler can iterate when
// building aggregate counts for absent kinds (they report `count: 0`
// rather than dropping from the array).
export { RUNTIME_USEFULNESS_DECISION_KINDS };
