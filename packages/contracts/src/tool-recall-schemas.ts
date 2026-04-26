import { z } from "zod";
import type {
  AnswerTrustState,
  QueryKind,
} from "./answer.js";
import type {
  JsonValue,
  SupportLevel,
  Timestamp,
} from "./common.js";
import type { ProjectLocatorInput } from "./tool-project-locator.js";
import {
  AnswerTrustStateSchema,
  QueryKindSchema,
  SupportLevelSchema,
} from "./tool-schema-shared.js";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";

const JsonValueSchema = z.unknown() as z.ZodType<JsonValue>;
const ToolRunOutcomeSchema = z.enum(["success", "failed", "error"]);

export interface RecallAnswersToolInput extends ProjectLocatorInput {
  query?: string;
  queryKind?: QueryKind;
  supportLevel?: SupportLevel;
  trustState?: AnswerTrustState;
  since?: Timestamp;
  until?: Timestamp;
  limit?: number;
}

export const RecallAnswersToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  query: z.string().trim().min(1).optional(),
  queryKind: QueryKindSchema.optional(),
  supportLevel: SupportLevelSchema.optional(),
  trustState: AnswerTrustStateSchema.optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().positive().max(100).optional(),
}).strict() satisfies z.ZodType<RecallAnswersToolInput>;

export interface RecalledAnswerPacketSummary {
  family: string;
  basisCount: number;
  evidenceRefCount: number;
}

export const RecalledAnswerPacketSummarySchema = z.object({
  family: z.string().min(1),
  basisCount: z.number().int().nonnegative(),
  evidenceRefCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<RecalledAnswerPacketSummary>;

export interface RecalledAnswer {
  traceId: string;
  queryKind: QueryKind;
  queryText: string;
  createdAt: Timestamp;
  supportLevel: SupportLevel;
  trustState?: AnswerTrustState;
  answerConfidence?: number;
  answerMarkdown?: string;
  packetSummary: RecalledAnswerPacketSummary;
}

export const RecalledAnswerSchema = z.object({
  traceId: z.string().min(1),
  queryKind: QueryKindSchema,
  queryText: z.string().min(1),
  createdAt: z.string().min(1),
  supportLevel: SupportLevelSchema,
  trustState: AnswerTrustStateSchema.optional(),
  answerConfidence: z.number().optional(),
  answerMarkdown: z.string().optional(),
  packetSummary: RecalledAnswerPacketSummarySchema,
}) satisfies z.ZodType<RecalledAnswer>;

export interface RecallAnswersToolOutput {
  toolName: "recall_answers";
  projectId: string;
  generatedAt: Timestamp;
  matchCount: number;
  truncated: boolean;
  answers: RecalledAnswer[];
  warnings: string[];
}

export const RecallAnswersToolOutputSchema = z.object({
  toolName: z.literal("recall_answers"),
  projectId: z.string().min(1),
  generatedAt: z.string().min(1),
  matchCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  answers: z.array(RecalledAnswerSchema),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<RecallAnswersToolOutput>;

export type RecallToolRunOutcome = z.infer<typeof ToolRunOutcomeSchema>;

export interface RecallToolRunsToolInput extends ProjectLocatorInput {
  toolName?: string;
  outcome?: RecallToolRunOutcome;
  requestId?: string;
  since?: Timestamp;
  until?: Timestamp;
  limit?: number;
  includePayload?: boolean;
}

export const RecallToolRunsToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  toolName: z.string().trim().min(1).optional(),
  outcome: ToolRunOutcomeSchema.optional(),
  requestId: z.string().trim().min(1).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().positive().max(500).optional(),
  includePayload: z.boolean().optional(),
}).strict() satisfies z.ZodType<RecallToolRunsToolInput>;

export interface RecalledToolRun {
  runId: string;
  projectId?: string;
  toolName: string;
  inputSummary: JsonValue;
  outputSummary?: JsonValue;
  payload?: JsonValue;
  outcome: RecallToolRunOutcome;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMs: number;
  requestId?: string;
  errorText?: string;
}

export const RecalledToolRunSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  inputSummary: JsonValueSchema,
  outputSummary: JsonValueSchema.optional(),
  payload: JsonValueSchema.optional(),
  outcome: ToolRunOutcomeSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  requestId: z.string().min(1).optional(),
  errorText: z.string().optional(),
}) satisfies z.ZodType<RecalledToolRun>;

export interface RecallToolRunsToolOutput {
  toolName: "recall_tool_runs";
  projectId: string;
  generatedAt: Timestamp;
  matchCount: number;
  truncated: boolean;
  toolRuns: RecalledToolRun[];
  warnings: string[];
}

export const RecallToolRunsToolOutputSchema = z.object({
  toolName: z.literal("recall_tool_runs"),
  projectId: z.string().min(1),
  generatedAt: z.string().min(1),
  matchCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  toolRuns: z.array(RecalledToolRunSchema),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<RecallToolRunsToolOutput>;
