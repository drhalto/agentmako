import { REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS } from "@mako-ai/contracts";
import type {
  ReefDiagnosticRun,
  VerificationChangedFile,
  VerificationSourceState,
  VerificationStateToolInput,
  VerificationStateToolOutput,
} from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import {
  diagnosticRunCache,
  diagnosticRunCheckedBeforeFileModified,
  diagnosticRunTouchesAnyFile,
  diagnosticRunTouchesFile,
  filePathFromFact,
  latestDiagnosticRunsBySource,
  overallVerificationStatus,
  stringDataValue,
  verificationStateForSource,
  verificationSuggestedActions,
  watcherDiagnosticWarnings,
} from "./shared.js";
import { buildReefToolExecution } from "./tool-execution.js";

export async function verificationStateTool(
  input: VerificationStateToolInput,
  options: ToolServiceOptions,
): Promise<VerificationStateToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const cacheStalenessMs = input.cacheStalenessMs ?? REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS;
    const checkedAtMs = Date.now();
    const checkedAt = new Date(checkedAtMs).toISOString();
    const requestedFileList = (input.files ?? []).map((filePath) => normalizeFileQuery(project.canonicalPath, filePath));
    const requestedFiles = new Set(requestedFileList);
    const watcher = options.indexRefreshCoordinator?.getWatchState(project.projectId);
    const runs = projectStore.queryReefDiagnosticRuns({ projectId: project.projectId, limit: 100 }).map((run) => ({
      ...run,
      cache: diagnosticRunCache(run, { checkedAt, checkedAtMs, staleAfterMs: cacheStalenessMs }),
    }));
    const relevantRuns = requestedFileList.length > 0
      ? runs.filter((run) => diagnosticRunTouchesAnyFile(project.canonicalPath, run, requestedFileList, normalizeFileQuery))
      : runs;
    const latestBySource = latestDiagnosticRunsBySource(relevantRuns);
    const sources = input.sources ?? [...latestBySource.keys()];
    const sourceStates: VerificationSourceState[] = sources.map((source) => verificationStateForSource(source, latestBySource.get(source)));
    const recentRuns = relevantRuns.filter((run) => sources.includes(run.source)).slice(0, 20);
    const changedFiles: VerificationChangedFile[] = [];
    let newestRequestedFileModifiedAt: string | undefined;

    for (const fact of projectStore.queryReefFacts({
      projectId: project.projectId,
      overlay: "working_tree",
      source: "working_tree_overlay",
      kind: "file_snapshot",
      limit: 500,
    })) {
      const filePath = filePathFromFact(fact);
      if (!filePath || (requestedFiles.size > 0 && !requestedFiles.has(filePath))) continue;
      const lastModifiedAt = stringDataValue(fact.data, "lastModifiedAt");
      if (!lastModifiedAt) continue;
      const modifiedMs = Date.parse(lastModifiedAt);
      if (!Number.isFinite(modifiedMs)) continue;
      if (!newestRequestedFileModifiedAt || modifiedMs > Date.parse(newestRequestedFileModifiedAt)) {
        newestRequestedFileModifiedAt = lastModifiedAt;
      }
      const staleForSources = sources.filter((source) => {
        const latestRunForFile = latestDiagnosticRunsBySource(
          runs.filter((run) =>
            run.source === source &&
            run.status === "succeeded" &&
            diagnosticRunTouchesFile(project.canonicalPath, run, filePath, normalizeFileQuery)
          ),
        ).get(source);
        return !latestRunForFile || diagnosticRunCheckedBeforeFileModified(latestRunForFile, modifiedMs);
      });
      if (staleForSources.length > 0) {
        changedFiles.push({ filePath, lastModifiedAt, staleForSources });
      }
    }

    const status = overallVerificationStatus(sourceStates, changedFiles);
    const returnedChangedFiles = changedFiles.slice(0, input.limit ?? 100);
    const warnings = sources.length === 0
      ? ["no Reef diagnostic runs are available for this project"]
      : [];
    warnings.push(...watcherDiagnosticWarnings(watcher, requestedFileList, newestRequestedFileModifiedAt));
    const reefExecution = await buildReefToolExecution({
      toolName: "verification_state",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "allow_stale_labeled",
      staleEvidenceLabeled: sourceStates.filter((source) => source.status !== "fresh").length + returnedChangedFiles.length,
      returnedCount: sourceStates.length + recentRuns.length + returnedChangedFiles.length,
    });

    return {
      toolName: "verification_state",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      status,
      sources: sourceStates,
      recentRuns,
      changedFiles: returnedChangedFiles,
      suggestedActions: verificationSuggestedActions(sourceStates, changedFiles),
      ...(watcher ? { watcher } : {}),
      reefExecution,
      warnings,
    };
  });
}
