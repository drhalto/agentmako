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

export const REEF_FRESHNESS_POLICIES = [
  "require_fresh",
  "allow_stale_labeled",
  "wait_for_refresh",
  "live_fallback",
] as const;

export type ReefFreshnessPolicy = (typeof REEF_FRESHNESS_POLICIES)[number];

export const ReefFreshnessPolicySchema = z.enum(REEF_FRESHNESS_POLICIES);

export const REEF_SNAPSHOT_BEHAVIORS = ["latest", "pinned", "restartable"] as const;

export type ReefSnapshotBehavior = (typeof REEF_SNAPSHOT_BEHAVIORS)[number];

export const ReefSnapshotBehaviorSchema = z.enum(REEF_SNAPSHOT_BEHAVIORS);

export const PROJECT_INDEX_WATCH_CATCH_UP_STATUSES = [
  "succeeded",
  "timed_out",
  "skipped",
] as const;

export type ProjectIndexWatchCatchUpStatus = (typeof PROJECT_INDEX_WATCH_CATCH_UP_STATUSES)[number];

export const ProjectIndexWatchCatchUpStatusSchema = z.enum(PROJECT_INDEX_WATCH_CATCH_UP_STATUSES);

export const PROJECT_INDEX_WATCH_CATCH_UP_METHODS = [
  "watcher_cookie",
  "none",
] as const;

export type ProjectIndexWatchCatchUpMethod = (typeof PROJECT_INDEX_WATCH_CATCH_UP_METHODS)[number];

export const ProjectIndexWatchCatchUpMethodSchema = z.enum(PROJECT_INDEX_WATCH_CATCH_UP_METHODS);

export interface ProjectIndexWatchCatchUpResult {
  status: ProjectIndexWatchCatchUpStatus;
  method: ProjectIndexWatchCatchUpMethod;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMs: number;
  maxWaitMs: number;
  reason: string;
  cookiePath?: string;
  error?: string;
}

export const ProjectIndexWatchCatchUpResultSchema = z.object({
  status: ProjectIndexWatchCatchUpStatusSchema,
  method: ProjectIndexWatchCatchUpMethodSchema,
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  durationMs: z.number().int().nonnegative(),
  maxWaitMs: z.number().int().nonnegative(),
  reason: z.string().min(1),
  cookiePath: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
}) satisfies z.ZodType<ProjectIndexWatchCatchUpResult>;

export const REEF_QUERY_MODES = ["daemon", "in_process", "legacy", "fallback"] as const;

export type ReefQueryMode = (typeof REEF_QUERY_MODES)[number];

export const ReefQueryModeSchema = z.enum(REEF_QUERY_MODES);

export const REEF_QUERY_FRESHNESS_STATES = [
  "fresh",
  "refreshing",
  "dirty",
  "stale",
  "unknown",
  "disabled",
] as const;

export type ReefQueryFreshnessState = (typeof REEF_QUERY_FRESHNESS_STATES)[number];

export const ReefQueryFreshnessStateSchema = z.enum(REEF_QUERY_FRESHNESS_STATES);

export interface ReefQueryFreshness {
  operationId?: string;
  requestId?: string;
  projectId: string;
  root: string;
  analysisRevision?: number;
  latestKnownRevision?: number;
  changeSetId?: string;
  reefMode: ReefQueryMode;
  freshnessPolicy: ReefFreshnessPolicy;
  state: ReefQueryFreshnessState;
  staleEvidenceDropped?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  waitedMs?: number;
  snapshotPinned?: boolean;
  queryRestarted?: boolean;
  queryCanceled?: boolean;
  checkedAt: Timestamp;
}

export const ReefQueryFreshnessSchema = z.object({
  operationId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  root: z.string().min(1),
  analysisRevision: z.number().int().nonnegative().optional(),
  latestKnownRevision: z.number().int().nonnegative().optional(),
  changeSetId: z.string().min(1).optional(),
  reefMode: ReefQueryModeSchema,
  freshnessPolicy: ReefFreshnessPolicySchema,
  state: ReefQueryFreshnessStateSchema,
  staleEvidenceDropped: z.number().int().nonnegative().optional(),
  fallbackUsed: z.boolean().optional(),
  fallbackReason: z.string().min(1).optional(),
  waitedMs: z.number().int().nonnegative().optional(),
  snapshotPinned: z.boolean().optional(),
  queryRestarted: z.boolean().optional(),
  queryCanceled: z.boolean().optional(),
  checkedAt: TimestampSchema,
}) satisfies z.ZodType<ReefQueryFreshness>;

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
  lastCatchUpAt?: Timestamp;
  lastCatchUpStatus?: ProjectIndexWatchCatchUpStatus;
  lastCatchUpMethod?: ProjectIndexWatchCatchUpMethod;
  lastCatchUpDurationMs?: number;
  lastCatchUpReason?: string;
  lastCatchUpError?: string;
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
  lastCatchUpAt: TimestampSchema.optional(),
  lastCatchUpStatus: ProjectIndexWatchCatchUpStatusSchema.optional(),
  lastCatchUpMethod: ProjectIndexWatchCatchUpMethodSchema.optional(),
  lastCatchUpDurationMs: z.number().int().nonnegative().optional(),
  lastCatchUpReason: z.string().min(1).optional(),
  lastCatchUpError: z.string().min(1).optional(),
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
