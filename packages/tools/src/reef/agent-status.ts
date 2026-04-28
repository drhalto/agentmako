import type {
  ProjectFinding,
  ReefAgentStatusToolInput,
  ReefAgentStatusToolOutput,
  ReefDiagnosticSourceState,
  ReefKnownIssuesToolInput,
  ReefKnownIssuesToolOutput,
  ReefProjectStatus,
  VerificationChangedFile,
  VerificationSourceState,
} from "@mako-ai/contracts";
import type { ReefDiagnosticRunRecord } from "@mako-ai/store";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import {
  applyReefToolFreshnessPolicy,
  buildReefToolExecution,
  defaultReefToolFreshnessPolicy,
} from "./tool-execution.js";

export async function reefKnownIssuesTool(
  input: ReefKnownIssuesToolInput,
  options: ToolServiceOptions = {},
): Promise<ReefKnownIssuesToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const limit = input.limit ?? 100;
    const bufferedLimit = limit * 3;
    const freshnessPolicy = defaultReefToolFreshnessPolicy(input.freshnessPolicy);
    const projectStatus = await loadProjectStatus(project.projectId, options);
    const rawIssues = projectStore.queryReefFindings({
      projectId: project.projectId,
      overlay: "working_tree",
      ...(input.files ? { filePaths: input.files } : {}),
      ...(input.sources ? { sources: input.sources } : {}),
      ...(input.severities ? { severities: input.severities } : {}),
      includeResolved: false,
      excludeAcknowledged: !input.includeAcknowledged,
      limit: bufferedLimit,
    });
    const filteredIssues = applyReefToolFreshnessPolicy(rawIssues, freshnessPolicy, "known issue");
    const issues = filteredIssues.items
      .sort(compareFindings)
      .slice(0, limit);
    const reefExecution = await buildReefToolExecution({
      toolName: "reef_known_issues",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy,
      staleEvidenceDropped: filteredIssues.staleEvidenceDropped,
      staleEvidenceLabeled: filteredIssues.staleEvidenceLabeled,
      returnedCount: issues.length,
    });
    const staleSources = projectStatus?.diagnostics?.sources.filter((source) => source.state === "stale").length ?? 0;
    const failedSources = projectStatus?.diagnostics?.sources.filter((source) => source.state === "failed").length ?? 0;
    const unavailableSources = projectStatus?.diagnostics?.sources.filter((source) => source.state === "unavailable").length ?? 0;
    const unknownSources = projectStatus?.diagnostics?.sources.filter((source) => source.state === "unknown").length ?? 0;

    return {
      toolName: "reef_known_issues",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      issues,
      summary: {
        total: issues.length,
        errors: issues.filter((issue) => issue.severity === "error").length,
        warnings: issues.filter((issue) => issue.severity === "warning").length,
        infos: issues.filter((issue) => issue.severity === "info").length,
        staleSources,
        failedSources,
        unavailableSources,
        unknownSources,
      },
      reefExecution,
      suggestedActions: suggestedKnownIssueActions(issues, projectStatus),
      warnings: [
        ...filteredIssues.warnings,
        ...(projectStatus ? [] : ["Reef service status was unavailable; returned durable known issues only."]),
      ],
    };
  });
}

export async function reefAgentStatusTool(
  input: ReefAgentStatusToolInput,
  options: ToolServiceOptions = {},
): Promise<ReefAgentStatusToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const limit = input.limit ?? 50;
    const bufferedLimit = limit * 3;
    const freshnessPolicy = defaultReefToolFreshnessPolicy(input.freshnessPolicy);
    const projectStatus = await loadProjectStatus(project.projectId, options);
    const latestRuns = latestDiagnosticRunsBySource(projectStore.queryReefDiagnosticRuns({
      projectId: project.projectId,
      limit: 100,
    }));
    const rawKnownIssues = projectStore.queryReefFindings({
      projectId: project.projectId,
      overlay: "working_tree",
      ...(input.focusFiles ? { filePaths: input.focusFiles } : {}),
      includeResolved: false,
      excludeAcknowledged: true,
      limit: bufferedLimit,
    });
    const filteredKnownIssues = applyReefToolFreshnessPolicy(rawKnownIssues, freshnessPolicy, "known issue");
    const knownIssues = filteredKnownIssues.items
      .sort(compareFindings)
      .slice(0, limit);
    const changedFiles = (projectStatus?.diagnostics?.changedAfterCheck ?? [])
      .filter((file) => !input.focusFiles || input.focusFiles.includes(file.filePath))
      .map((file): VerificationChangedFile => ({
        filePath: file.filePath,
        lastModifiedAt: file.lastModifiedAt,
        staleForSources: file.staleSources,
      }))
      .slice(0, limit);
    const staleSources = (projectStatus?.diagnostics?.sources ?? [])
      .flatMap((source): VerificationSourceState[] => {
        const verificationStatus = verificationStatusForSourceState(source.state);
        if (verificationStatus === undefined) {
          return [];
        }
        const lastRun = latestRuns.get(source.source);
        return [{
          source: source.source,
          status: verificationStatus,
          ...(lastRun ? { lastRun } : {}),
          reason: source.reason,
          suggestedActions: verificationStatus === "stale"
            ? [`Run diagnostic_refresh for ${source.source} when fresh diagnostics are needed.`]
            : verificationStatus === "failed" || verificationStatus === "unavailable"
              ? [`Inspect project_diagnostic_runs for ${source.source}.`]
              : [`Run diagnostic_refresh for ${source.source} before relying on that source.`],
        }];
      })
      .slice(0, limit);
    const reefExecution = await buildReefToolExecution({
      toolName: "reef_agent_status",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy,
      staleEvidenceDropped: filteredKnownIssues.staleEvidenceDropped,
      staleEvidenceLabeled: filteredKnownIssues.staleEvidenceLabeled,
      returnedCount: knownIssues.length + changedFiles.length + staleSources.length,
    });

    return {
      toolName: "reef_agent_status",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      state: projectStatus?.state ?? "unknown",
      knownIssues,
      changedFiles,
      staleSources,
      ...(projectStatus?.schema ? { schema: projectStatus.schema } : {}),
      summary: {
        knownIssueCount: knownIssues.length,
        changedFileCount: changedFiles.length,
        staleSourceCount: staleSources.length,
        watcherDegraded: projectStatus?.watcher.degraded ?? false,
        backgroundQueue: projectStatus?.writerQueue.running
          ? "running"
          : (projectStatus?.writerQueue.queued ?? 0) > 0
            ? "queued"
            : "idle",
      },
      reefExecution,
      suggestedActions: suggestedAgentActions(knownIssues, changedFiles, staleSources, projectStatus),
      warnings: [
        ...filteredKnownIssues.warnings,
        ...(projectStatus ? [] : ["Reef service status was unavailable; returned durable issue state only."]),
      ],
    };
  });
}

async function loadProjectStatus(
  projectId: string,
  options: ToolServiceOptions,
): Promise<ReefProjectStatus | undefined> {
  try {
    return await options.reefService?.getProjectStatus(projectId);
  } catch {
    return undefined;
  }
}

function latestDiagnosticRunsBySource(
  runs: readonly ReefDiagnosticRunRecord[],
): Map<string, ReefDiagnosticRunRecord> {
  const latest = new Map<string, ReefDiagnosticRunRecord>();
  for (const run of runs) {
    const existing = latest.get(run.source);
    if (!existing || Date.parse(run.finishedAt) > Date.parse(existing.finishedAt)) {
      latest.set(run.source, run);
    }
  }
  return latest;
}

function compareFindings(left: ProjectFinding, right: ProjectFinding): number {
  const severityScore = (finding: ProjectFinding): number =>
    finding.severity === "error" ? 0 : finding.severity === "warning" ? 1 : 2;
  const severityDelta = severityScore(left) - severityScore(right);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  return right.capturedAt.localeCompare(left.capturedAt);
}

function suggestedKnownIssueActions(
  issues: readonly ProjectFinding[],
  status: ReefProjectStatus | undefined,
): string[] {
  const actions: string[] = [];
  if (issues.length > 0) {
    actions.push("Inspect the highest severity known issue before running broad diagnostics.");
  }
  if ((status?.diagnostics?.changedAfterCheck.length ?? 0) > 0) {
    actions.push("Run diagnostic_refresh for changed files before trusting clean diagnostic state.");
  }
  if (actions.length === 0) {
    actions.push("No active Reef issue is currently known; use explicit fallback only if the task needs live verification.");
  }
  return actions;
}

function suggestedAgentActions(
  issues: readonly ProjectFinding[],
  changedFiles: readonly VerificationChangedFile[],
  staleSources: readonly VerificationSourceState[],
  status: ReefProjectStatus | undefined,
): string[] {
  const actions: string[] = [];
  if (issues.length > 0) {
    actions.push("Start with reef_inspect or file_findings for the highest severity known issue.");
  }
  if (changedFiles.length > 0) {
    actions.push("Run diagnostic_refresh on changed files before claiming verification.");
  }
  if (staleSources.length > 0) {
    actions.push("Use project_diagnostic_runs to inspect stale, failed, unavailable, or unknown diagnostic sources.");
  }
  if (status?.watcher.degraded) {
    actions.push("Refresh or audit the project before relying on indexed line evidence.");
  }
  if (actions.length === 0) {
    actions.push("Reef has no urgent known issue or verification gap in maintained state.");
  }
  return actions;
}

function verificationStatusForSourceState(
  state: ReefDiagnosticSourceState,
): VerificationSourceState["status"] | undefined {
  switch (state) {
    case "stale":
    case "failed":
    case "unavailable":
    case "unknown":
      return state;
    case "clean":
    case "findings":
      return undefined;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
