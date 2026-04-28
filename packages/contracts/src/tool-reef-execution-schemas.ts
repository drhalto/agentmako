import { z } from "zod";
import {
  ReefRuntimeModeSchema,
  type ReefRuntimeMode,
} from "./reef-service.js";
import {
  ReefFreshnessPolicySchema,
  ReefSnapshotBehaviorSchema,
  type ReefFreshnessPolicy,
  type ReefSnapshotBehavior,
} from "./index-freshness.js";

export const ReefToolServiceModeSchema = z.enum(["daemon", "in_process", "direct", "legacy"]);
export type ReefToolServiceMode = z.infer<typeof ReefToolServiceModeSchema>;

export const ReefToolQueryPathSchema = z.enum([
  "reef_query",
  "reef_materialized_view",
  "direct_live",
  "legacy",
]);
export type ReefToolQueryPath = z.infer<typeof ReefToolQueryPathSchema>;

export const ReefToolSnapshotStateSchema = z.enum(["fresh", "refreshing", "stale", "unknown"]);
export type ReefToolSnapshotState = z.infer<typeof ReefToolSnapshotStateSchema>;

export const ReefToolCatchUpStatusSchema = z.enum(["succeeded", "timed_out", "skipped", "failed"]);
export type ReefToolCatchUpStatus = z.infer<typeof ReefToolCatchUpStatusSchema>;

export interface ReefToolExecution {
  reefMode: ReefRuntimeMode;
  serviceMode: ReefToolServiceMode;
  queryPath: ReefToolQueryPath;
  freshnessPolicy: ReefFreshnessPolicy;
  snapshot: {
    behavior: ReefSnapshotBehavior;
    revision?: number;
    materializedRevision?: number;
    state: ReefToolSnapshotState;
    restarted?: boolean;
  };
  watcher?: {
    active: boolean;
    degraded: boolean;
    recrawlCount: number;
    lastRecrawlReason?: string;
    lastCatchUpStatus?: ReefToolCatchUpStatus;
  };
  fallback?: {
    used: boolean;
    reason?: string;
  };
  operationId?: string;
  durationMs: number;
}

export const ReefToolExecutionSchema = z.object({
  reefMode: ReefRuntimeModeSchema,
  serviceMode: ReefToolServiceModeSchema,
  queryPath: ReefToolQueryPathSchema,
  freshnessPolicy: ReefFreshnessPolicySchema,
  snapshot: z.object({
    behavior: ReefSnapshotBehaviorSchema,
    revision: z.number().int().nonnegative().optional(),
    materializedRevision: z.number().int().nonnegative().optional(),
    state: ReefToolSnapshotStateSchema,
    restarted: z.boolean().optional(),
  }),
  watcher: z.object({
    active: z.boolean(),
    degraded: z.boolean(),
    recrawlCount: z.number().int().nonnegative(),
    lastRecrawlReason: z.string().min(1).optional(),
    lastCatchUpStatus: ReefToolCatchUpStatusSchema.optional(),
  }).optional(),
  fallback: z.object({
    used: z.boolean(),
    reason: z.string().min(1).optional(),
  }).optional(),
  operationId: z.string().min(1).optional(),
  durationMs: z.number().int().nonnegative(),
}) satisfies z.ZodType<ReefToolExecution>;
