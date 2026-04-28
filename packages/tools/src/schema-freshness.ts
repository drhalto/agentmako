/**
 * Schema-snapshot freshness gate.
 *
 * Some tools (notably `tenant_leak_audit`, `trace_table`, `preflight_table`)
 * read the persisted schema snapshot. When the snapshot drifts behind the live
 * DB, those tools emit findings against stale state — worst case, a security
 * audit flags "no policies" when the live DB has six. This helper is the
 * shared seam that detects staleness and refreshes the snapshot inline before
 * the tool runs.
 *
 * Design constraints (Roadmap 5 / Roadmap 6 rules):
 *   - No daemon, no background worker. Refresh is only triggered by a tool
 *     invocation that opts into this helper.
 *   - No silent mutation on projects without a live DB binding — we skip and
 *     return a warning instead.
 *   - No hot-loop refresh. Per-process debounce prevents a flurry of tool
 *     calls from hammering the DB within a short window.
 *   - Never break the caller on refresh failure. A failed refresh logs and
 *     returns the existing (stale) snapshot plus a warning; the tool still
 *     runs against whatever is on disk.
 */

import type { SchemaFreshnessStatus, SchemaSnapshot } from "@mako-ai/contracts";
import { REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS } from "@mako-ai/contracts";
import {
  computeSnapshotFreshness,
  readProjectManifest,
  refreshProjectDb,
} from "@mako-ai/indexer";
import { createLogger } from "@mako-ai/logger";
import type { ProjectStore } from "@mako-ai/store";
import type { ToolServiceOptions } from "./runtime.js";

const logger = createLogger("mako-tools", { component: "schema-freshness" });

export const SCHEMA_FRESHNESS_DEFAULT_DEBOUNCE_MS = 60_000;
/**
 * Max age of a snapshot's `refreshedAt` timestamp before the helper considers
 * it live-DB-stale and triggers a refresh, even when `computeSnapshotFreshness`
 * reports `"fresh"`. Repo-source drift is one dimension of staleness; live DB
 * drift (e.g. an operator adding RLS policies directly to prod) is not visible
 * via source-hash comparison and needs a time-based heuristic.
 *
 * Defaults to 5 minutes. Callers can override via `maxSnapshotAgeMs`.
 */
export const SCHEMA_FRESHNESS_DEFAULT_MAX_AGE_MS = REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS;

const REFRESH_TRIGGERS: ReadonlySet<SchemaFreshnessStatus> = new Set([
  "stale",
  "refresh_required",
  "drift_detected",
]);

export type EnsureFreshSchemaSkipReason =
  | "no_snapshot"
  | "no_db_binding"
  | "not_stale"
  | "debounced"
  | "refresh_failed"
  | "disabled";

export interface EnsureFreshSchemaResult {
  snapshot: SchemaSnapshot | null;
  refreshed: boolean;
  skipReason?: EnsureFreshSkipReason;
  freshnessBefore: SchemaFreshnessStatus | "no_snapshot" | "unknown";
  freshnessAfter?: SchemaFreshnessStatus | "unknown";
  warnings: string[];
}

// Legacy alias — `EnsureFreshSchemaSkipReason` is the canonical name; a
// shorter local alias kept the type signatures readable during development.
type EnsureFreshSkipReason = EnsureFreshSchemaSkipReason;

export interface EnsureFreshSchemaSnapshotInput {
  projectId: string;
  projectRoot: string;
  projectStore: ProjectStore;
  freshen?: boolean;
  debounceMs?: number;
  /**
   * Max age (in ms) of the snapshot's `refreshedAt` before a refresh is
   * triggered for live-DB-backed projects. Defaults to
   * `SCHEMA_FRESHNESS_DEFAULT_MAX_AGE_MS`. Ignored when the project has no
   * live DB binding.
   */
  maxSnapshotAgeMs?: number;
  toolOptions?: ToolServiceOptions;
}

interface DebounceEntry {
  lastAttemptAt: number;
  outcome: "refreshed" | "refresh_failed";
}

const refreshDebounce = new Map<string, DebounceEntry>();

/**
 * Exposed for tests — resets the in-process debounce map so two smoke runs do
 * not interfere with each other. Not part of the public runtime API.
 */
export function __resetSchemaFreshnessDebounceForTests(): void {
  refreshDebounce.clear();
}

export async function ensureFreshSchemaSnapshot(
  input: EnsureFreshSchemaSnapshotInput,
): Promise<EnsureFreshSchemaResult> {
  const {
    projectId,
    projectRoot,
    projectStore,
    freshen = true,
    debounceMs = SCHEMA_FRESHNESS_DEFAULT_DEBOUNCE_MS,
    maxSnapshotAgeMs = SCHEMA_FRESHNESS_DEFAULT_MAX_AGE_MS,
    toolOptions,
  } = input;

  const warnings: string[] = [];
  const snapshot = projectStore.loadSchemaSnapshot();

  if (!snapshot) {
    return {
      snapshot: null,
      refreshed: false,
      skipReason: "no_snapshot",
      freshnessBefore: "no_snapshot",
      warnings,
    };
  }

  if (!freshen) {
    return {
      snapshot,
      refreshed: false,
      skipReason: "disabled",
      freshnessBefore: snapshot.freshnessStatus,
      warnings,
    };
  }

  const manifest = readProjectManifest(projectRoot);
  if (!manifest) {
    warnings.push(
      "schema freshness check skipped: project manifest is missing.",
    );
    return {
      snapshot,
      refreshed: false,
      skipReason: "no_db_binding",
      freshnessBefore: snapshot.freshnessStatus,
      warnings,
    };
  }

  const freshnessBefore = computeSnapshotFreshness(
    projectRoot,
    manifest.database,
    snapshot,
  );

  // Repo-source-hash staleness is the cheap check. Live-DB drift is not
  // visible that way (an operator adding an RLS policy directly to prod
  // leaves repo sources untouched), so additionally treat a snapshot whose
  // `refreshedAt` is older than `maxSnapshotAgeMs` as stale when the project
  // has a live DB binding.
  const liveDbBound = Boolean(
    manifest.database.liveBinding?.enabled &&
    manifest.database.liveBinding.ref.trim().length > 0,
  );
  const sourceStale = REFRESH_TRIGGERS.has(freshnessBefore);
  const refreshedAtMs = Date.parse(snapshot.refreshedAt);
  const ageBasedStale =
    liveDbBound &&
    Number.isFinite(refreshedAtMs) &&
    Date.now() - refreshedAtMs > maxSnapshotAgeMs;
  const liveModeStale = liveDbBound && snapshot.sourceMode !== "live_refresh_enabled";
  const shouldRefresh = sourceStale || ageBasedStale || liveModeStale;

  if (!shouldRefresh) {
    return {
      snapshot,
      refreshed: false,
      skipReason: "not_stale",
      freshnessBefore,
      warnings,
    };
  }

  if (!liveDbBound) {
    warnings.push(
      `schema snapshot is \`${freshnessBefore}\` but this project has no live DB binding; serving the stale snapshot.`,
    );
    return {
      snapshot,
      refreshed: false,
      skipReason: "no_db_binding",
      freshnessBefore,
      warnings,
    };
  }

  const now = Date.now();
  const previous = refreshDebounce.get(projectId);
  if (previous && now - previous.lastAttemptAt < debounceMs) {
    const elapsedSeconds = Math.max(
      1,
      Math.round((now - previous.lastAttemptAt) / 1000),
    );
    warnings.push(
      `schema refresh debounced (last attempt ${elapsedSeconds}s ago, outcome=${previous.outcome}); serving the current snapshot.`,
    );
    return {
      snapshot,
      refreshed: false,
      skipReason: "debounced",
      freshnessBefore,
      warnings,
    };
  }

  try {
    const start = Date.now();
    await refreshProjectDb(projectId, toolOptions ?? {});
    const durationMs = Date.now() - start;
    refreshDebounce.set(projectId, { lastAttemptAt: now, outcome: "refreshed" });
    const refreshedSnapshot = projectStore.loadSchemaSnapshot();
    const freshnessAfter = refreshedSnapshot
      ? computeSnapshotFreshness(projectRoot, manifest.database, refreshedSnapshot)
      : "unknown";
    logger.info("schema_freshness.refresh_ok", {
      projectId,
      durationMs,
      freshnessBefore,
      freshnessAfter,
    });
    return {
      snapshot: refreshedSnapshot ?? snapshot,
      refreshed: true,
      freshnessBefore,
      freshnessAfter,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    refreshDebounce.set(projectId, { lastAttemptAt: now, outcome: "refresh_failed" });
    logger.warn("schema_freshness.refresh_failed", {
      projectId,
      error: message,
      freshnessBefore,
    });
    warnings.push(
      `schema refresh failed: ${message}; serving the current snapshot.`,
    );
    return {
      snapshot,
      refreshed: false,
      skipReason: "refresh_failed",
      freshnessBefore,
      warnings,
    };
  }
}
