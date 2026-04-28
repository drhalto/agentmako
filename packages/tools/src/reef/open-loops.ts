import { REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS } from "@mako-ai/contracts";
import type {
  ProjectFact,
  ProjectOpenLoopsToolInput,
  ProjectOpenLoopsToolOutput,
  ReefDiagnosticRun,
  ReefOpenLoop,
} from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { diagnosticRunCache, filePathFromFact, severityWeight } from "./shared.js";
import { buildReefToolExecution } from "./tool-execution.js";

export async function projectOpenLoopsTool(
  input: ProjectOpenLoopsToolInput,
  options: ToolServiceOptions,
): Promise<ProjectOpenLoopsToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
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

    const aggregatedDbFacts = new Map<string, { state: ProjectFact["freshness"]["state"]; reason: string; facts: ProjectFact[] }>();
    for (const fact of projectStore.queryReefFacts({ projectId: project.projectId, limit: 500 })) {
      if (filePath && filePathFromFact(fact) !== filePath) continue;
      if (fact.freshness.state === "fresh") continue;
      if (!filePath && isDbReefFact(fact)) {
        const key = `${fact.freshness.state}:${fact.freshness.reason}`;
        const existing = aggregatedDbFacts.get(key);
        if (existing) {
          existing.facts.push(fact);
        } else {
          aggregatedDbFacts.set(key, {
            state: fact.freshness.state,
            reason: fact.freshness.reason,
            facts: [fact],
          });
        }
        continue;
      }
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

    let aggregateIndex = 0;
    for (const aggregate of aggregatedDbFacts.values()) {
      aggregateIndex += 1;
      const byKind: Record<string, number> = {};
      for (const fact of aggregate.facts) {
        byKind[fact.kind] = (byKind[fact.kind] ?? 0) + 1;
      }
      loops.push({
        id: `fact_group:db_reef_refresh:${aggregate.state}:${aggregateIndex}`,
        kind: aggregate.state === "stale" ? "stale_fact" : "unknown_fact",
        severity: aggregate.state === "stale" ? "warning" : "info",
        title: `${aggregate.facts.length} DB Reef facts are ${aggregate.state}`,
        source: "db_reef_refresh",
        reason: aggregate.reason,
        suggestedActions: ["Run db_reef_refresh after a live schema snapshot succeeds, or inspect schemaFreshness before relying on DB facts."],
        metadata: {
          freshnessState: aggregate.state,
          factCount: aggregate.facts.length,
          byKind,
        },
      });
    }

    for (const run of latestDiagnosticRunsBySource(projectStore.queryReefDiagnosticRuns({ projectId: project.projectId, limit: 100 }))) {
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
    const reefExecution = await buildReefToolExecution({
      toolName: "project_open_loops",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "allow_stale_labeled",
      staleEvidenceLabeled: sorted.filter((loop) =>
        loop.kind === "stale_fact" || loop.kind === "unknown_fact" || loop.kind === "stale_diagnostic_run"
      ).length,
      returnedCount: sorted.length,
    });

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
      reefExecution,
      warnings: [],
    };
  });
}

function isDbReefFact(fact: ProjectFact): boolean {
  return fact.source === "db_reef_refresh" && fact.kind.startsWith("db_");
}

function latestDiagnosticRunsBySource(runs: ReefDiagnosticRun[]): ReefDiagnosticRun[] {
  const latest = new Map<string, ReefDiagnosticRun>();
  for (const run of runs) {
    const existing = latest.get(run.source);
    if (!existing || diagnosticRunSortTime(run) > diagnosticRunSortTime(existing)) {
      latest.set(run.source, run);
    }
  }
  return [...latest.values()];
}

function diagnosticRunSortTime(run: ReefDiagnosticRun): number {
  return Math.max(
    Date.parse(run.finishedAt ?? ""),
    Date.parse(run.startedAt),
    0,
  );
}
