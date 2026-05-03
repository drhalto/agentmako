import { REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS } from "@mako-ai/contracts";
import type {
  VerificationStateToolInput,
  VerificationStateToolOutput,
} from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { watcherDiagnosticWarnings } from "./shared.js";
import { calculateDiagnosticCoverage } from "./status-calculations.js";
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
    const watcher = options.indexRefreshCoordinator?.getWatchState(project.projectId);
    const coverage = calculateDiagnosticCoverage({
      projectStore,
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      requestedFileList,
      sources: input.sources,
      limit: input.limit ?? 100,
      checkedAt,
      checkedAtMs,
      cacheStalenessMs,
      normalizeFilePath: normalizeFileQuery,
    });
    const warnings = [
      ...coverage.warnings,
      ...watcherDiagnosticWarnings(watcher, requestedFileList, coverage.newestRequestedFileModifiedAt),
    ];
    const reefExecution = await buildReefToolExecution({
      toolName: "verification_state",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "allow_stale_labeled",
      staleEvidenceLabeled: coverage.sources.filter((source) => source.status !== "fresh").length + coverage.changedFiles.length,
      returnedCount: coverage.sources.length + coverage.recentRuns.length + coverage.changedFiles.length,
    });

    return {
      toolName: "verification_state",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      status: coverage.status,
      sources: coverage.sources,
      recentRuns: coverage.recentRuns,
      changedFiles: coverage.changedFiles,
      suggestedActions: coverage.suggestedActions,
      ...(watcher ? { watcher } : {}),
      reefExecution,
      warnings,
    };
  });
}
