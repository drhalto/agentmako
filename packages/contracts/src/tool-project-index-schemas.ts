import { z } from "zod";
import type { JsonObject } from "./common.js";
import { JsonObjectSchema } from "./tool-schema-shared.js";
import {
  IndexFreshnessSummarySchema,
  IndexRunSurfaceSchema,
  ProjectIndexWatchStateSchema,
  type IndexFreshnessSummary,
  type IndexRunSurface,
  type ProjectIndexWatchState,
} from "./index-freshness.js";
import { ProjectOverlaySchema, type ProjectOverlay } from "./reef.js";
import {
  ProjectLocatorInputObjectSchema,
  type ProjectLocatorInput,
} from "./tool-project-locator.js";

export type ProjectIndexSuggestedAction =
  | "none"
  | "run_live_text_search"
  | "project_index_refresh";

export const ProjectIndexSuggestedActionSchema = z.enum([
  "none",
  "run_live_text_search",
  "project_index_refresh",
]);

export interface ProjectIndexUnindexedScan {
  status: "included" | "skipped" | "watch_hint";
  message: string;
  count?: number;
  possibleCount?: number;
}

export const ProjectIndexUnindexedScanSchema = z.object({
  status: z.enum(["included", "skipped", "watch_hint"]),
  message: z.string().min(1),
  count: z.number().int().nonnegative().optional(),
  possibleCount: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<ProjectIndexUnindexedScan>;

export interface ProjectIndexReefFactsSummary {
  overlay: ProjectOverlay;
  source: string;
  kind: string;
  total: number;
  queryLimit: number;
  truncated: boolean;
  freshCount: number;
  staleCount: number;
  unknownCount: number;
  deletedSnapshotCount: number;
  checkedAt: string;
  rollbackEnv: "MAKO_REEF_BACKED";
}

export const ProjectIndexReefFactsSummarySchema = z.object({
  overlay: ProjectOverlaySchema,
  source: z.string().min(1),
  kind: z.string().min(1),
  total: z.number().int().nonnegative(),
  queryLimit: z.number().int().positive(),
  truncated: z.boolean(),
  freshCount: z.number().int().nonnegative(),
  staleCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  deletedSnapshotCount: z.number().int().nonnegative(),
  checkedAt: z.string().min(1),
  rollbackEnv: z.literal("MAKO_REEF_BACKED"),
}) satisfies z.ZodType<ProjectIndexReefFactsSummary>;

export interface ProjectIndexStatusToolInput extends ProjectLocatorInput {
  includeUnindexed?: boolean;
}

export const ProjectIndexStatusToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  includeUnindexed: z.boolean().optional(),
}).strict() satisfies z.ZodType<ProjectIndexStatusToolInput>;

export interface ProjectIndexStatusToolOutput {
  toolName: "project_index_status";
  projectId: string;
  projectRoot: string;
  latestRun?: IndexRunSurface;
  lastIndexedAt?: string;
  freshness: IndexFreshnessSummary;
  reefFacts?: ProjectIndexReefFactsSummary;
  watch?: ProjectIndexWatchState;
  unindexedScan: ProjectIndexUnindexedScan;
  suggestedAction: ProjectIndexSuggestedAction;
  suggestedActionReason: string;
}

export const ProjectIndexStatusToolOutputSchema = z.object({
  toolName: z.literal("project_index_status"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  latestRun: IndexRunSurfaceSchema.optional(),
  lastIndexedAt: z.string().optional(),
  freshness: IndexFreshnessSummarySchema,
  reefFacts: ProjectIndexReefFactsSummarySchema.optional(),
  watch: ProjectIndexWatchStateSchema.optional(),
  unindexedScan: ProjectIndexUnindexedScanSchema,
  suggestedAction: ProjectIndexSuggestedActionSchema,
  suggestedActionReason: z.string().min(1),
}) satisfies z.ZodType<ProjectIndexStatusToolOutput>;

export interface ProjectIndexRefreshToolInput extends ProjectLocatorInput {
  mode?: "if_stale" | "force";
  reason?: string;
}

export const ProjectIndexRefreshToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  mode: z.enum(["if_stale", "force"]).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict() satisfies z.ZodType<ProjectIndexRefreshToolInput>;

export interface ProjectIndexRefreshToolOutput {
  toolName: "project_index_refresh";
  projectId: string;
  projectRoot: string;
  skipped: boolean;
  operatorReason?: string;
  reason: string;
  before: IndexFreshnessSummary;
  after?: IndexFreshnessSummary;
  run?: IndexRunSurface;
  stats?: JsonObject;
  warnings: string[];
}

export const ProjectIndexRefreshToolOutputSchema = z.object({
  toolName: z.literal("project_index_refresh"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  skipped: z.boolean(),
  operatorReason: z.string().min(1).optional(),
  reason: z.string().min(1),
  before: IndexFreshnessSummarySchema,
  after: IndexFreshnessSummarySchema.optional(),
  run: IndexRunSurfaceSchema.optional(),
  stats: JsonObjectSchema.optional(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<ProjectIndexRefreshToolOutput>;
