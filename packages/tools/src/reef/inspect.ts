import type { ReefInspectToolInput, ReefInspectToolOutput } from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { matchesFactScope, matchesFindingScope } from "./shared.js";

export async function reefInspectTool(
  input: ReefInspectToolInput,
  options: ToolServiceOptions,
): Promise<ReefInspectToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const limit = input.limit ?? 100;
    const filePath = input.filePath ? normalizeFileQuery(project.canonicalPath, input.filePath) : undefined;
    const subjectFingerprint = input.subjectFingerprint;
    const facts = projectStore.queryReefFacts({ projectId: project.projectId, limit: 500 })
      .filter((fact) => matchesFactScope(fact, { filePath, subjectFingerprint }))
      .slice(0, limit);
    const findings = projectStore.queryReefFindings({
      projectId: project.projectId,
      includeResolved: true,
      limit: 500,
    }).filter((finding) => matchesFindingScope(finding, { filePath, subjectFingerprint })).slice(0, limit);
    const sourceHints = new Set([...findings.map((finding) => finding.source), ...facts.map((fact) => fact.source)]);
    const diagnosticRuns = projectStore.queryReefDiagnosticRuns({ projectId: project.projectId, limit: 100 })
      .filter((run) => sourceHints.size === 0 || sourceHints.has(run.source))
      .slice(0, 20);
    const warnings: string[] = [];
    if (!filePath && !subjectFingerprint) {
      warnings.push("reef_inspect was called without filePath or subjectFingerprint; returning a bounded project sample");
    }

    return {
      toolName: "reef_inspect",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      ...(filePath ? { filePath } : {}),
      ...(subjectFingerprint ? { subjectFingerprint } : {}),
      facts,
      findings,
      diagnosticRuns,
      summary: {
        factCount: facts.length,
        findingCount: findings.length,
        activeFindingCount: findings.filter((finding) => finding.status === "active").length,
        staleFactCount: facts.filter((fact) => fact.freshness.state !== "fresh").length,
      },
      warnings,
    };
  });
}
