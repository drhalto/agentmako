import { REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS } from "@mako-ai/contracts";
import type { ProjectOpenLoopsToolInput, ProjectOpenLoopsToolOutput, ReefOpenLoop } from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { diagnosticRunCache, filePathFromFact, severityWeight } from "./shared.js";

export async function projectOpenLoopsTool(
  input: ProjectOpenLoopsToolInput,
  options: ToolServiceOptions,
): Promise<ProjectOpenLoopsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const limit = input.limit ?? 100;
    const cacheStalenessMs = input.cacheStalenessMs ?? REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS;
    const checkedAtMs = Date.now();
    const checkedAt = new Date(checkedAtMs).toISOString();
    const filePath = input.filePath ? normalizeFileQuery(project.canonicalPath, input.filePath) : undefined;
    const loops: ReefOpenLoop[] = [];

    for (const finding of projectStore.queryReefFindings({
      projectId: project.projectId,
      includeResolved: false,
      limit: 500,
    })) {
      if (filePath && finding.filePath !== filePath) continue;
      if (!input.includeAcknowledged && finding.status === "acknowledged") continue;
      loops.push({
        id: `finding:${finding.fingerprint}`,
        kind: "active_finding",
        severity: finding.severity,
        title: finding.message,
        ...(finding.filePath ? { filePath: finding.filePath } : {}),
        subjectFingerprint: finding.subjectFingerprint,
        source: finding.source,
        reason: `Reef finding is ${finding.status}`,
        suggestedActions: ["Inspect the file and either fix the issue, acknowledge it, or verify that it has resolved."],
        metadata: {
          ...(finding.ruleId ? { ruleId: finding.ruleId } : {}),
          status: finding.status,
        },
      });
    }

    for (const fact of projectStore.queryReefFacts({ projectId: project.projectId, limit: 500 })) {
      if (filePath && filePathFromFact(fact) !== filePath) continue;
      if (fact.freshness.state === "fresh") continue;
      loops.push({
        id: `fact:${fact.fingerprint}`,
        kind: fact.freshness.state === "stale" ? "stale_fact" : "unknown_fact",
        severity: fact.freshness.state === "stale" ? "warning" : "info",
        title: `${fact.kind} evidence is ${fact.freshness.state}`,
        ...(filePathFromFact(fact) ? { filePath: filePathFromFact(fact) } : {}),
        subjectFingerprint: fact.subjectFingerprint,
        source: fact.source,
        reason: fact.freshness.reason,
        suggestedActions: ["Refresh the relevant overlay or re-run the producing diagnostic/source."],
        metadata: { freshnessState: fact.freshness.state },
      });
    }

    for (const run of projectStore.queryReefDiagnosticRuns({ projectId: project.projectId, limit: 100 })) {
      const cache = diagnosticRunCache(run, { checkedAt, checkedAtMs, staleAfterMs: cacheStalenessMs });
      if (run.status !== "succeeded") {
        loops.push({
          id: `diagnostic:${run.runId}`,
          kind: "failed_diagnostic_run",
          severity: run.status === "ran_with_error" ? "error" : "warning",
          title: `${run.source} diagnostic run ${run.status}`,
          source: run.source,
          reason: run.errorText ?? `diagnostic source status is ${run.status}`,
          suggestedActions: ["Re-run the diagnostic source before trusting no-finding results."],
          metadata: { runId: run.runId, status: run.status },
        });
      } else if (cache.state === "stale") {
        loops.push({
          id: `diagnostic:${run.runId}`,
          kind: "stale_diagnostic_run",
          severity: "warning",
          title: `${run.source} diagnostic run is stale`,
          source: run.source,
          reason: cache.reason,
          suggestedActions: ["Re-run this diagnostic source or lower the cacheStalenessMs threshold if this is expected."],
          metadata: { runId: run.runId, ageMs: cache.ageMs ?? 0 },
        });
      }
    }

    const sorted = loops
      .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.id.localeCompare(b.id))
      .slice(0, limit);
    return {
      toolName: "project_open_loops",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      ...(filePath ? { filePath } : {}),
      loops: sorted,
      summary: {
        total: sorted.length,
        errors: sorted.filter((loop) => loop.severity === "error").length,
        warnings: sorted.filter((loop) => loop.severity === "warning").length,
        infos: sorted.filter((loop) => loop.severity === "info").length,
      },
      warnings: [],
    };
  });
}
