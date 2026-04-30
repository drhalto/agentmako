import { REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS } from "@mako-ai/contracts";
import type {
  FilePreflightToolInput,
  FilePreflightToolOutput,
  JsonObject,
  ProjectConvention,
  ReefDiagnosticRun,
  VerificationChangedFile,
  VerificationSourceState,
} from "@mako-ai/contracts";
import { normalizeFileQuery, withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { collectProjectConventions } from "./conventions.js";
import {
  diagnosticRunCache,
  latestDiagnosticRunsBySource,
  overallVerificationStatus,
  stringDataValue,
  verificationStateForSource,
  verificationSuggestedActions,
} from "./shared.js";
import { applyReefToolFreshnessPolicy, buildReefToolExecution } from "./tool-execution.js";

const DEFAULT_FINDINGS_LIMIT = 50;
const DEFAULT_CONVENTIONS_LIMIT = 20;
const DEFAULT_DIAGNOSTIC_RUNS_LIMIT = 20;
const DEFAULT_ACK_LIMIT = 50;
const DIAGNOSTIC_RUN_SCAN_LIMIT = 200;

export async function filePreflightTool(
  input: FilePreflightToolInput,
  options: ToolServiceOptions,
): Promise<FilePreflightToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const filePath = normalizeFileQuery(project.canonicalPath, input.filePath);
    const freshnessPolicy = input.freshnessPolicy ?? "allow_stale_labeled";
    const cacheStalenessMs = input.cacheStalenessMs ?? REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS;
    const checkedAtMs = Date.now();
    const checkedAt = new Date(checkedAtMs).toISOString();
    const findingsLimit = input.findingsLimit ?? DEFAULT_FINDINGS_LIMIT;
    const conventionsLimit = input.conventionsLimit ?? DEFAULT_CONVENTIONS_LIMIT;
    const diagnosticRunsLimit = input.diagnosticRunsLimit ?? DEFAULT_DIAGNOSTIC_RUNS_LIMIT;
    const ackLimit = input.ackLimit ?? DEFAULT_ACK_LIMIT;
    const warnings: string[] = [];

    const rawFindings = projectStore.queryReefFindings({
      projectId: project.projectId,
      filePath,
      includeResolved: false,
      limit: findingsLimit,
    });
    const filteredFindings = applyReefToolFreshnessPolicy(rawFindings, freshnessPolicy, "finding");
    warnings.push(...filteredFindings.warnings);

    const allRuns = projectStore.queryReefDiagnosticRuns({
      projectId: project.projectId,
      limit: DIAGNOSTIC_RUN_SCAN_LIMIT,
    }).map((run) => ({
      ...run,
      cache: diagnosticRunCache(run, { checkedAt, checkedAtMs, staleAfterMs: cacheStalenessMs }),
    }));
    const fileRuns = allRuns.filter((run) => diagnosticRunTouchesFile(project.canonicalPath, run, filePath));
    const recentRuns = fileRuns.slice(0, diagnosticRunsLimit);
    const latestBySource = latestDiagnosticRunsBySource(fileRuns);
    const sourceNames = input.sources ?? [...latestBySource.keys()];
    const sourceStates = sourceNames.map((source) => verificationStateForSource(source, latestBySource.get(source)));
    const changedFile = changedFileForSourceRuns({
      projectId: project.projectId,
      filePath,
      projectStore,
      sourceStates,
    });
    const changedFiles = changedFile ? [changedFile] : [];
    const diagnosticsStatus = overallVerificationStatus(sourceStates, changedFiles);
    const staleSources = sourceStates.filter((state) => state.status === "stale").map((state) => state.source);
    const failedSources = sourceStates
      .filter((state) => state.status === "failed" || state.status === "unavailable")
      .map((state) => state.source);
    const unknownSources = sourceStates.filter((state) => state.status === "unknown").map((state) => state.source);

    if (sourceNames.length === 0) {
      warnings.push(`no Reef diagnostic runs were found for ${filePath}`);
    }

    const conventions = applicableConventionsForFile(
      collectProjectConventions(projectStore, project.projectId, { limit: 200 }),
      filePath,
    ).slice(0, conventionsLimit);

    const ackFilter = { projectId: project.projectId, filePath };
    const ackCount = projectStore.countFindingAcks(ackFilter);
    const ackHistory = projectStore.queryFindingAcks({ ...ackFilter, limit: ackLimit });
    if (ackCount > ackHistory.length) {
      warnings.push(`returning first ${ackHistory.length} of ${ackCount} finding acknowledgements for ${filePath}`);
    }

    const staleEvidenceLabeled = filteredFindings.staleEvidenceLabeled +
      sourceStates.filter((state) => state.status !== "fresh").length +
      changedFiles.length;
    const reefExecution = await buildReefToolExecution({
      toolName: "file_preflight",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy,
      staleEvidenceDropped: filteredFindings.staleEvidenceDropped,
      staleEvidenceLabeled,
      returnedCount: filteredFindings.items.length +
        sourceStates.length +
        recentRuns.length +
        conventions.length +
        ackHistory.length +
        changedFiles.length,
    });

    return {
      toolName: "file_preflight",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      filePath,
      findings: filteredFindings.items,
      diagnostics: {
        status: diagnosticsStatus,
        sources: sourceStates,
        staleSources,
        failedSources,
        unknownSources,
        ...(changedFile ? { changedFile } : {}),
        recentRuns,
        suggestedActions: verificationSuggestedActions(sourceStates, changedFiles),
      },
      conventions,
      ackHistory,
      summary: {
        findingCount: filteredFindings.items.length,
        activeFindingCount: filteredFindings.items.filter((finding) => finding.status === "active").length,
        acknowledgedFindingCount: filteredFindings.items.filter((finding) => finding.status === "acknowledged").length,
        staleFindingCount: filteredFindings.items.filter((finding) => finding.freshness.state !== "fresh").length,
        staleDiagnosticSourceCount: staleSources.length,
        failedDiagnosticSourceCount: failedSources.length,
        unknownDiagnosticSourceCount: unknownSources.length,
        conventionCount: conventions.length,
        recentDiagnosticRunCount: recentRuns.length,
        ackCount,
      },
      reefExecution,
      filters: {
        freshnessPolicy,
        cacheStalenessMs,
        ...(input.sources ? { sources: input.sources } : {}),
      },
      warnings,
    };
  });
}

function diagnosticRunTouchesFile(
  projectRoot: string,
  run: ReefDiagnosticRun,
  filePath: string,
): boolean {
  const requestedFiles = stringArrayMetadataValue(run.metadata, "requestedFiles");
  if (!requestedFiles) return true;
  const normalized = requestedFiles
    .map((requestedFile) => normalizeFileQuery(projectRoot, requestedFile))
    .filter((requestedFile) => requestedFile.length > 0);
  return normalized.length === 0 || normalized.includes(filePath);
}

function changedFileForSourceRuns(args: {
  projectId: string;
  filePath: string;
  projectStore: import("@mako-ai/store").ProjectStore;
  sourceStates: VerificationSourceState[];
}): VerificationChangedFile | undefined {
  const subjectFingerprint = args.projectStore.computeReefSubjectFingerprint({
    kind: "file",
    path: args.filePath,
  });
  const snapshot = args.projectStore.queryReefFacts({
    projectId: args.projectId,
    overlay: "working_tree",
    source: "working_tree_overlay",
    kind: "file_snapshot",
    subjectFingerprint,
    limit: 1,
  })[0];
  const lastModifiedAt = stringDataValue(snapshot?.data, "lastModifiedAt");
  if (!lastModifiedAt) return undefined;
  const modifiedMs = Date.parse(lastModifiedAt);
  if (!Number.isFinite(modifiedMs)) return undefined;

  const staleForSources = args.sourceStates
    .map((state) => [state.source, state.lastRun] as const)
    .filter((entry): entry is readonly [string, ReefDiagnosticRun] => Boolean(entry[1] && entry[1].status === "succeeded"))
    .filter(([, run]) => {
      const finishedAtMs = Date.parse(run.finishedAt);
      return Number.isFinite(finishedAtMs) && modifiedMs > finishedAtMs;
    })
    .map(([source]) => source);

  if (staleForSources.length === 0) return undefined;
  return {
    filePath: args.filePath,
    lastModifiedAt,
    staleForSources,
  };
}

export function applicableConventionsForFile(
  conventions: readonly ProjectConvention[],
  filePath: string,
): ProjectConvention[] {
  return conventions
    .map((convention) => ({ convention, score: conventionApplicabilityScore(convention, filePath) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.convention.confidence - a.convention.confidence || a.convention.id.localeCompare(b.convention.id))
    .map((entry) => entry.convention);
}

function conventionApplicabilityScore(convention: ProjectConvention, filePath: string): number {
  if (convention.filePath === filePath) return 100;
  if (convention.evidence.some((evidence) => evidence === filePath || evidence.includes(filePath))) return 90;
  if (!convention.filePath) return 70;
  if (convention.kind === "route_pattern" && isLikelyRouteFile(filePath)) return 55;
  if (convention.kind === "schema_pattern" && isLikelyAppCodeFile(filePath)) return 45;
  if (convention.kind === "generated_path" && isLikelyGeneratedPath(filePath)) return 45;
  return 0;
}

function isLikelyRouteFile(filePath: string): boolean {
  return /(^|\/)app\/.+\/(?:page|layout|route)\.[jt]sx?$/i.test(filePath);
}

function isLikelyAppCodeFile(filePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/i.test(filePath) && !isLikelyGeneratedPath(filePath);
}

function isLikelyGeneratedPath(filePath: string): boolean {
  return /(^|\/)(?:__generated__|generated|gen)\//i.test(filePath) ||
    /(?:^|[./-])generated\.[jt]sx?$/i.test(filePath) ||
    /(?:database|schema)\.types\.ts$/i.test(filePath);
}

function stringArrayMetadataValue(metadata: JsonObject | undefined, key: string): string[] | undefined {
  if (!metadata) return undefined;
  const value = metadata[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}
