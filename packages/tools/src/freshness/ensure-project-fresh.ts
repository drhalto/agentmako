import type {
  AttachedProject,
  IndexFreshnessSummary,
  ProjectFreshnessGate,
  ProjectIndexWatchCatchUpResult,
  ProjectIndexWatchState,
} from "@mako-ai/contracts";
import { summarizeProjectIndexFreshness } from "@mako-ai/indexer";
import type { ProjectStore } from "@mako-ai/store";
import type { ToolServiceOptions } from "../runtime.js";

export interface EnsureProjectFreshInput {
  project: AttachedProject;
  projectStore: ProjectStore;
  options: ToolServiceOptions;
  reason: string;
  maxWaitMs?: number;
  waitWhenIdle?: boolean;
}

function isPendingWatchState(watch: ProjectIndexWatchState | undefined): boolean {
  return watch?.status === "dirty" || watch?.status === "scheduled" || watch?.status === "indexing" ||
    (watch?.dirtyPaths.length ?? 0) > 0;
}

function summarizeKnownIndexedFiles(project: AttachedProject, projectStore: ProjectStore): IndexFreshnessSummary {
  return summarizeProjectIndexFreshness({
    projectRoot: project.canonicalPath,
    store: projectStore,
    includeUnindexed: false,
  });
}

function buildWarnings(args: {
  watch?: ProjectIndexWatchState;
  catchUp?: ProjectIndexWatchCatchUpResult;
  freshness: IndexFreshnessSummary;
}): string[] {
  const warnings: string[] = [];
  if (args.catchUp?.status === "timed_out") {
    warnings.push("Watcher catch-up timed out; indexed context may lag recent saved file changes.");
  }
  if (args.catchUp?.error) {
    warnings.push(`Watcher catch-up reported an error: ${args.catchUp.error}`);
  }
  if (args.watch?.status === "failed") {
    warnings.push(`Index watcher failed: ${args.watch.lastError ?? "unknown watcher error"}.`);
  }
  if (args.watch?.status === "disabled") {
    warnings.push(`Index watcher is disabled: ${args.watch.disabledReason ?? "no watcher is active"}.`);
  }
  if (args.freshness.state !== "fresh") {
    warnings.push("Indexed file metadata is not fresh; verify exact lines with live_text_search or project_index_status.");
  }
  return warnings;
}

export async function ensureProjectFresh(input: EnsureProjectFreshInput): Promise<ProjectFreshnessGate> {
  const provider = input.options.indexRefreshCoordinator;
  let watch = provider?.getWatchState(input.project.projectId);
  let catchUp: ProjectIndexWatchCatchUpResult | undefined;

  if (provider?.waitForCatchUp && watch?.mode === "watch" && watch.status !== "failed" && watch.status !== "disabled") {
    const shouldWait = input.waitWhenIdle === true || isPendingWatchState(watch);
    if (shouldWait) {
      catchUp = await provider.waitForCatchUp(input.project.projectId, {
        ...(input.maxWaitMs != null ? { maxWaitMs: input.maxWaitMs } : {}),
        reason: input.reason,
      });
      watch = provider.getWatchState(input.project.projectId) ?? watch;
    }
  }

  const indexFreshness = summarizeKnownIndexedFiles(input.project, input.projectStore);
  const warnings = buildWarnings({ watch, catchUp, freshness: indexFreshness });
  const checkedAt = new Date().toISOString();

  if (!provider) {
    return {
      status: indexFreshness.state === "fresh" ? "skipped" : "stale",
      source: "metadata",
      checkedAt,
      reason: indexFreshness.state === "fresh"
        ? "no watcher provider was available; indexed metadata for known files is fresh"
        : "no watcher provider was available and indexed metadata is not fresh",
      warnings,
      indexFreshness,
    };
  }

  if (!watch) {
    return {
      status: indexFreshness.state === "fresh" ? "skipped" : "stale",
      source: "none",
      checkedAt,
      reason: indexFreshness.state === "fresh"
        ? "watcher state was unavailable; indexed metadata for known files is fresh"
        : "watcher state was unavailable and indexed metadata is not fresh",
      warnings,
      indexFreshness,
    };
  }

  if (watch.status === "failed" || watch.status === "disabled") {
    return {
      status: "degraded",
      source: "watcher",
      checkedAt,
      reason: watch.lastError ?? watch.disabledReason ?? `watcher is ${watch.status}`,
      warnings,
      watch,
      indexFreshness,
    };
  }

  if (catchUp?.status === "timed_out" || indexFreshness.state !== "fresh") {
    return {
      status: "stale",
      source: catchUp ? "watcher" : "metadata",
      checkedAt,
      reason: catchUp?.status === "timed_out"
        ? "watcher catch-up timed out before indexed freshness could be proven"
        : "indexed metadata is not fresh",
      warnings,
      ...(catchUp ? { catchUp } : {}),
      watch,
      indexFreshness,
    };
  }

  return {
    status: "fresh",
    source: catchUp ? "watcher" : "metadata",
    checkedAt,
    reason: catchUp?.status === "succeeded"
      ? "watcher catch-up completed and indexed metadata is fresh"
      : "indexed metadata for known files is fresh",
    warnings,
    ...(catchUp ? { catchUp } : {}),
    watch,
    indexFreshness,
  };
}
