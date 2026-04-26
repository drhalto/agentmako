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
  filePathFromFact,
  latestDiagnosticRunsBySource,
  overallVerificationStatus,
  stringDataValue,
  verificationStateForSource,
  verificationSuggestedActions,
} from "./shared.js";

export async function verificationStateTool(
  input: VerificationStateToolInput,
  options: ToolServiceOptions,
): Promise<VerificationStateToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const cacheStalenessMs = input.cacheStalenessMs ?? REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS;
    const checkedAtMs = Date.now();
    const checkedAt = new Date(checkedAtMs).toISOString();
    const requestedFiles = new Set((input.files ?? []).map((filePath) => normalizeFileQuery(project.canonicalPath, filePath)));
    const runs = projectStore.queryReefDiagnosticRuns({ projectId: project.projectId, limit: 100 }).map((run) => ({
      ...run,
      cache: diagnosticRunCache(run, { checkedAt, checkedAtMs, staleAfterMs: cacheStalenessMs }),
    }));
    const latestBySource = latestDiagnosticRunsBySource(runs);
    const sources = input.sources ?? [...latestBySource.keys()];
    const sourceStates: VerificationSourceState[] = sources.map((source) => verificationStateForSource(source, latestBySource.get(source)));
    const successfulRuns = new Map(
      sourceStates
        .map((state) => [state.source, state.lastRun] as const)
        .filter((entry): entry is readonly [string, ReefDiagnosticRun] => Boolean(entry[1] && entry[1].status === "succeeded")),
    );
    const changedFiles: VerificationChangedFile[] = [];

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
      const staleForSources = [...successfulRuns.entries()]
        .filter(([, run]) => {
          const finishedAtMs = Date.parse(run.finishedAt);
          return Number.isFinite(finishedAtMs) && modifiedMs > finishedAtMs;
        })
        .map(([source]) => source);
      if (staleForSources.length > 0) {
        changedFiles.push({ filePath, lastModifiedAt, staleForSources });
      }
    }

    const status = overallVerificationStatus(sourceStates, changedFiles);
    return {
      toolName: "verification_state",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      status,
      sources: sourceStates,
      changedFiles: changedFiles.slice(0, input.limit ?? 100),
      suggestedActions: verificationSuggestedActions(sourceStates, changedFiles),
      warnings: sources.length === 0 ? ["no Reef diagnostic runs are available for this project"] : [],
    };
  });
}
