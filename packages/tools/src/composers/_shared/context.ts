/**
 * Composer context — what every composer receives when invoked through
 * `defineComposer`. This is the Layer 5→Layer 3 seam: composers get read-only
 * access to snapshot accessors, freshness signals, and identity, nothing else.
 *
 * Composers never touch live DBs, never call services, never instantiate
 * stores. The only surface they consume is this context.
 */

import type { ProjectProfile } from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";

export interface ComposerFreshness {
  /**
   * The mode the snapshot was produced in. Composers should surface this on
   * their packets so consumers know whether to trust the evidence. See
   * `packages/store/src/project-store-snapshots.ts` for the full lifecycle.
   */
  sourceMode: "repo_only" | "live_db" | "unknown";
  /** ISO timestamp of the latest successful snapshot build. */
  generatedAt: string | null;
  /** True when the snapshot is older than `MAKO_SNAPSHOT_STALE_THRESHOLD_MS`. */
  driftDetected: boolean;
}

export interface ComposerContext {
  projectId: string;
  canonicalPath: string;
  projectRoot: string;
  profile: ProjectProfile | null;
  store: ProjectStore;
  freshness: ComposerFreshness;
}

const DEFAULT_STALE_THRESHOLD_MS = Number.parseInt(
  process.env.MAKO_SNAPSHOT_STALE_THRESHOLD_MS ?? `${1000 * 60 * 60 * 24 * 7}`,
  10,
);

export function readFreshness(store: ProjectStore): ComposerFreshness {
  const latest = store.getLatestIndexRun();
  if (!latest) {
    return { sourceMode: "unknown", generatedAt: null, driftDetected: true };
  }
  const generatedAt = latest.finishedAt ?? latest.startedAt ?? latest.createdAt;
  const ageMs =
    generatedAt != null ? Date.now() - new Date(generatedAt).getTime() : Number.POSITIVE_INFINITY;
  return {
    sourceMode: "repo_only",
    generatedAt,
    driftDetected: ageMs > DEFAULT_STALE_THRESHOLD_MS,
  };
}
