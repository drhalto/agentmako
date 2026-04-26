import type {
  IndexRunSurface,
  JsonObject,
  ProjectIndexRefreshToolInput,
  ProjectIndexRefreshToolOutput,
  ProjectIndexReefFactsSummary,
  ProjectIndexStatusToolInput,
  ProjectIndexStatusToolOutput,
  ProjectIndexSuggestedAction,
  ProjectIndexUnindexedScan,
} from "@mako-ai/contracts";
import { indexProject, summarizeProjectIndexFreshness } from "@mako-ai/indexer";
import type { IndexRunRecord, ProjectStore } from "@mako-ai/store";
import { isReefBackedToolViewEnabled } from "../reef/migration-flags.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

const REEF_FACT_SUMMARY_QUERY_LIMIT = 10_000;

function toIndexRunSurface(run: IndexRunRecord | null | undefined): IndexRunSurface | undefined {
  if (!run) return undefined;
  return {
    runId: run.runId,
    triggerSource: run.triggerSource,
    status: run.status,
    startedAt: run.startedAt ?? run.createdAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    createdAt: run.createdAt,
    ...(run.errorText ? { errorText: run.errorText } : {}),
    ...(run.stats ? { stats: run.stats } : {}),
  };
}

function suggestAction(
  freshnessState: ProjectIndexStatusToolOutput["freshness"]["state"],
  unindexedScan?: ProjectIndexUnindexedScan,
): { action: ProjectIndexSuggestedAction; reason: string } {
  if ((unindexedScan?.count ?? unindexedScan?.possibleCount ?? 0) > 0) {
    return {
      action: "project_index_refresh",
      reason: unindexedScan?.status === "watch_hint"
        ? "watcher saw paths that are not in the index; refresh or rerun status with includeUnindexed for exact details"
        : "new indexable files exist on disk but are not in the index",
    };
  }

  switch (freshnessState) {
    case "fresh":
      return {
        action: "none",
        reason: "indexed file metadata matches the current disk snapshot",
      };
    case "dirty":
      return {
        action: "project_index_refresh",
        reason: "one or more indexed files are stale, deleted, or unindexed; refresh before trusting indexed answers",
      };
    case "unknown":
      return {
        action: "run_live_text_search",
        reason: "index freshness could not be proven; use live text search or refresh before relying on old rows",
      };
  }
}

function buildUnindexedScan(args: {
  includeUnindexed: boolean;
  freshness: ProjectIndexStatusToolOutput["freshness"];
  indexedPaths: Set<string>;
  watchDirtyPaths: readonly string[];
}): ProjectIndexUnindexedScan {
  if (args.includeUnindexed) {
    const count = args.freshness.unindexedCount;
    return {
      status: "included",
      count,
      message: count === 0
        ? "no new indexable files found on disk"
        : `${count} new indexable file${count === 1 ? "" : "s"} found on disk but not yet indexed`,
    };
  }

  const possibleCount = args.watchDirtyPaths.filter((filePath) => !args.indexedPaths.has(filePath)).length;
  if (possibleCount > 0) {
    return {
      status: "watch_hint",
      possibleCount,
      message: `${possibleCount} watcher-dirty path${possibleCount === 1 ? "" : "s"} are not in the index; pass includeUnindexed: true for exact details`,
    };
  }

  return {
    status: "skipped",
    message: "new files on disk were not checked; pass includeUnindexed: true for exact details",
  };
}

function buildReefFactsSummary(
  projectStore: ProjectStore,
  projectId: string,
): ProjectIndexReefFactsSummary {
  const facts = projectStore.queryReefFacts({
    projectId,
    overlay: "working_tree",
    source: "working_tree_overlay",
    kind: "file_snapshot",
    limit: REEF_FACT_SUMMARY_QUERY_LIMIT,
  });

  let freshCount = 0;
  let staleCount = 0;
  let unknownCount = 0;
  let deletedSnapshotCount = 0;
  for (const fact of facts) {
    switch (fact.freshness.state) {
      case "fresh":
        freshCount += 1;
        break;
      case "stale":
        staleCount += 1;
        break;
      case "unknown":
        unknownCount += 1;
        break;
    }
    if (fact.data?.state === "deleted") {
      deletedSnapshotCount += 1;
    }
  }

  return {
    overlay: "working_tree",
    source: "working_tree_overlay",
    kind: "file_snapshot",
    total: facts.length,
    queryLimit: REEF_FACT_SUMMARY_QUERY_LIMIT,
    truncated: facts.length >= REEF_FACT_SUMMARY_QUERY_LIMIT,
    freshCount,
    staleCount,
    unknownCount,
    deletedSnapshotCount,
    checkedAt: new Date().toISOString(),
    rollbackEnv: "MAKO_REEF_BACKED",
  };
}

export async function projectIndexStatusTool(
  input: ProjectIndexStatusToolInput,
  options: ToolServiceOptions,
): Promise<ProjectIndexStatusToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const includeUnindexed = input.includeUnindexed ?? false;
    const freshness = summarizeProjectIndexFreshness({
      projectRoot: project.canonicalPath,
      store: projectStore,
      includeUnindexed,
    });
    const watch = options.indexRefreshCoordinator?.getWatchState(project.projectId);
    const indexedPaths = new Set(projectStore.listFiles().map((file) => file.path));
    const unindexedScan = buildUnindexedScan({
      includeUnindexed,
      freshness,
      indexedPaths,
      watchDirtyPaths: watch?.dirtyPaths ?? [],
    });
    const suggested = suggestAction(freshness.state, unindexedScan);
    const latestRun = toIndexRunSurface(projectStore.getLatestIndexRun());
    const reefFacts = isReefBackedToolViewEnabled("project_index_status")
      ? buildReefFactsSummary(projectStore, project.projectId)
      : undefined;

    return {
      toolName: "project_index_status",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      ...(latestRun ? { latestRun } : {}),
      ...(project.lastIndexedAt ? { lastIndexedAt: project.lastIndexedAt } : {}),
      freshness,
      ...(reefFacts ? { reefFacts } : {}),
      ...(watch ? { watch } : {}),
      unindexedScan,
      suggestedAction: suggested.action,
      suggestedActionReason: suggested.reason,
    };
  });
}

export async function projectIndexRefreshTool(
  input: ProjectIndexRefreshToolInput,
  options: ToolServiceOptions,
): Promise<ProjectIndexRefreshToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const before = summarizeProjectIndexFreshness({
      projectRoot: project.canonicalPath,
      store: projectStore,
      // Refresh uses the expensive disk walk intentionally: a new unindexed
      // file should count as stale work for `mode: "if_stale"`.
      includeUnindexed: true,
    });
    const mode = input.mode ?? "if_stale";
    if (mode === "if_stale" && before.state === "fresh") {
      return {
        toolName: "project_index_refresh",
        projectId: project.projectId,
        projectRoot: project.canonicalPath,
        skipped: true,
        reason: "index is already fresh",
        ...(input.reason ? { operatorReason: input.reason } : {}),
        before,
        warnings: [],
      };
    }

    const result = await indexProject(project.canonicalPath, {
      configOverrides: options.configOverrides,
      projectStoreCache: options.projectStoreCache,
      triggerSource: "mcp_refresh",
    });
    const after = summarizeProjectIndexFreshness({
      projectRoot: project.canonicalPath,
      store: projectStore,
      includeUnindexed: true,
    });

    return {
      toolName: "project_index_refresh",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      skipped: false,
      reason: mode === "force"
        ? "forced index refresh completed"
        : before.state === "unknown"
          ? "index freshness was unknown; refreshed defensively"
          : "index refresh completed",
      ...(input.reason ? { operatorReason: input.reason } : {}),
      before,
      after,
      run: toIndexRunSurface(result.run),
      stats: result.stats as unknown as JsonObject,
      warnings: result.schemaSnapshotWarnings.map((warning) => warning.message),
    };
  });
}
