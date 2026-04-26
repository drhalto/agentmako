import { z } from "zod";
import type { JsonValue, Timestamp } from "./common.js";
import { JsonObjectSchema, TimestampSchema } from "./tool-schema-shared.js";

export const INDEX_FRESHNESS_MTIME_TOLERANCE_MS = 1500;

export const INDEX_FRESHNESS_STATES = [
  "fresh",
  "stale",
  "deleted",
  "unindexed",
  "unknown",
] as const;

export type IndexFreshnessState = (typeof INDEX_FRESHNESS_STATES)[number];

export const IndexFreshnessStateSchema = z.enum(INDEX_FRESHNESS_STATES);

export interface IndexFreshnessDetail {
  state: IndexFreshnessState;
  filePath: string;
  indexedAt?: Timestamp;
  indexedMtime?: Timestamp;
  liveMtime?: Timestamp;
  indexedSizeBytes?: number;
  liveSizeBytes?: number;
  reason: string;
}

export const IndexFreshnessDetailSchema = z.object({
  state: IndexFreshnessStateSchema,
  filePath: z.string().min(1),
  indexedAt: TimestampSchema.optional(),
  indexedMtime: TimestampSchema.optional(),
  liveMtime: TimestampSchema.optional(),
  indexedSizeBytes: z.number().int().nonnegative().optional(),
  liveSizeBytes: z.number().int().nonnegative().optional(),
  reason: z.string().min(1),
}) satisfies z.ZodType<IndexFreshnessDetail>;

export interface IndexFreshnessSummary {
  checkedAt: Timestamp;
  state: "fresh" | "dirty" | "unknown";
  freshCount: number;
  staleCount: number;
  deletedCount: number;
  unindexedCount: number;
  unknownCount: number;
  newestIndexedAt?: Timestamp;
  newestLiveMtime?: Timestamp;
  sample: IndexFreshnessDetail[];
}

export const IndexFreshnessSummarySchema = z.object({
  checkedAt: TimestampSchema,
  state: z.enum(["fresh", "dirty", "unknown"]),
  freshCount: z.number().int().nonnegative(),
  staleCount: z.number().int().nonnegative(),
  deletedCount: z.number().int().nonnegative(),
  unindexedCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  newestIndexedAt: TimestampSchema.optional(),
  newestLiveMtime: TimestampSchema.optional(),
  sample: z.array(IndexFreshnessDetailSchema),
}) satisfies z.ZodType<IndexFreshnessSummary>;

export interface ProjectIndexWatchState {
  mode: "off" | "watch";
  status: "idle" | "dirty" | "scheduled" | "indexing" | "failed" | "disabled";
  projectId?: string;
  projectRoot?: string;
  dirtyPaths: string[];
  transition?: "started" | "stopped" | "switched";
  lastEventAt?: Timestamp;
  scheduledFor?: Timestamp;
  lastRefreshStartedAt?: Timestamp;
  lastRefreshFinishedAt?: Timestamp;
  lastRefreshMode?: "paths" | "full";
  lastRefreshFallbackReason?: string;
  lastRefreshPathCount?: number;
  lastRefreshDeletedPathCount?: number;
  lastOverlayFactUpdatedAt?: Timestamp;
  lastOverlayFactCount?: number;
  lastOverlayResolvedFindingCount?: number;
  lastOverlayFactDurationMs?: number;
  lastOverlayFactError?: string;
  switchFromProjectId?: string;
  disabledReason?: string;
  lastError?: string;
}

export const ProjectIndexWatchStateSchema = z.object({
  mode: z.enum(["off", "watch"]),
  status: z.enum(["idle", "dirty", "scheduled", "indexing", "failed", "disabled"]),
  projectId: z.string().min(1).optional(),
  projectRoot: z.string().min(1).optional(),
  dirtyPaths: z.array(z.string().min(1)),
  transition: z.enum(["started", "stopped", "switched"]).optional(),
  lastEventAt: TimestampSchema.optional(),
  scheduledFor: TimestampSchema.optional(),
  lastRefreshStartedAt: TimestampSchema.optional(),
  lastRefreshFinishedAt: TimestampSchema.optional(),
  lastRefreshMode: z.enum(["paths", "full"]).optional(),
  lastRefreshFallbackReason: z.string().min(1).optional(),
  lastRefreshPathCount: z.number().int().nonnegative().optional(),
  lastRefreshDeletedPathCount: z.number().int().nonnegative().optional(),
  lastOverlayFactUpdatedAt: TimestampSchema.optional(),
  lastOverlayFactCount: z.number().int().nonnegative().optional(),
  lastOverlayResolvedFindingCount: z.number().int().nonnegative().optional(),
  lastOverlayFactDurationMs: z.number().int().nonnegative().optional(),
  lastOverlayFactError: z.string().min(1).optional(),
  switchFromProjectId: z.string().min(1).optional(),
  disabledReason: z.string().min(1).optional(),
  lastError: z.string().min(1).optional(),
}) satisfies z.ZodType<ProjectIndexWatchState>;

export interface IndexRunSurface {
  runId: string;
  triggerSource: string;
  status: string;
  startedAt: Timestamp;
  finishedAt?: Timestamp;
  createdAt: Timestamp;
  errorText?: string;
  stats?: Record<string, JsonValue>;
}

export const IndexRunSurfaceSchema = z.object({
  runId: z.string().min(1),
  triggerSource: z.string().min(1),
  status: z.string().min(1),
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  errorText: z.string().optional(),
  stats: JsonObjectSchema.optional(),
}) satisfies z.ZodType<IndexRunSurface>;
