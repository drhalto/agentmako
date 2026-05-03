import type {
  ProjectFact,
  ProjectFinding,
  ReefDiagnosticRun,
  VerificationChangedFile,
  VerificationSourceState,
  VerificationStateToolOutput,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import {
  confidenceFromFinding,
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
} from "./shared.js";

export interface ReefDiagnosticCoverageCalculationInput {
  projectStore: Pick<ProjectStore, "queryReefDiagnosticRuns" | "queryReefFacts">;
  projectId: string;
  projectRoot: string;
  requestedFileList: string[];
  sources?: string[];
  limit: number;
  checkedAt: string;
  checkedAtMs: number;
  cacheStalenessMs: number;
  normalizeFilePath: (projectRoot: string, filePath: string) => string;
}

export interface ReefDiagnosticCoverageCalculationOutput {
  status: VerificationStateToolOutput["status"];
  sources: VerificationSourceState[];
  recentRuns: ReefDiagnosticRun[];
  changedFiles: VerificationChangedFile[];
  suggestedActions: string[];
  newestRequestedFileModifiedAt?: string;
  warnings: string[];
}

export interface ReefActiveFindingStatusInput {
  projectStore: Pick<ProjectStore, "queryReefFindings">;
  projectId: string;
  limit: number;
}

export interface ReefActiveFindingStatusGroup {
  key: string;
  count: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  staleCount: number;
  latestCapturedAt?: string;
  sampleFilePaths: string[];
}

export interface ReefActiveFindingStatusOutput {
  totalActive: number;
  staleCount: number;
  bySeverity: Record<ProjectFinding["severity"], number>;
  bySource: ReefActiveFindingStatusGroup[];
  byRule: ReefActiveFindingStatusGroup[];
  byFile: ReefActiveFindingStatusGroup[];
}

export interface ReefDuplicateCandidate {
  candidateId: string;
  files: string[];
  ruleIds: string[];
  sources: string[];
  findingFingerprints: string[];
  confidence: number;
  reason: string;
}

export interface ReefDuplicateCandidatesInput {
  projectStore: Pick<ProjectStore, "queryReefFindings">;
  projectId: string;
  limit: number;
}

export interface ReefDuplicateCandidatesOutput {
  candidates: ReefDuplicateCandidate[];
  totalCandidateCount: number;
  warnings: string[];
}

export function calculateDiagnosticCoverage(
  input: ReefDiagnosticCoverageCalculationInput,
): ReefDiagnosticCoverageCalculationOutput {
  const requestedFiles = new Set(input.requestedFileList);
  const runs = input.projectStore.queryReefDiagnosticRuns({ projectId: input.projectId, limit: 100 }).map((run) => ({
    ...run,
    cache: diagnosticRunCache(run, {
      checkedAt: input.checkedAt,
      checkedAtMs: input.checkedAtMs,
      staleAfterMs: input.cacheStalenessMs,
    }),
  }));
  const relevantRuns = input.requestedFileList.length > 0
    ? runs.filter((run) => diagnosticRunTouchesAnyFile(input.projectRoot, run, input.requestedFileList, input.normalizeFilePath))
    : runs;
  const latestBySource = latestDiagnosticRunsBySource(relevantRuns);
  const sources = input.sources ?? [...latestBySource.keys()];
  const sourceStates = sources.map((source) => verificationStateForSource(source, latestBySource.get(source)));
  const recentRuns = relevantRuns.filter((run) => sources.includes(run.source)).slice(0, 20);
  const changedFiles: VerificationChangedFile[] = [];
  let newestRequestedFileModifiedAt: string | undefined;

  for (const fact of input.projectStore.queryReefFacts({
    projectId: input.projectId,
    overlay: "working_tree",
    source: "working_tree_overlay",
    kind: "file_snapshot",
    limit: 500,
  })) {
    const filePath = filePathFromFact(fact);
    if (!filePath || (requestedFiles.size > 0 && !requestedFiles.has(filePath))) {
      continue;
    }
    const lastModifiedAt = stringDataValue(fact.data, "lastModifiedAt");
    if (!lastModifiedAt) {
      continue;
    }
    const modifiedMs = Date.parse(lastModifiedAt);
    if (!Number.isFinite(modifiedMs)) {
      continue;
    }
    if (!newestRequestedFileModifiedAt || modifiedMs > Date.parse(newestRequestedFileModifiedAt)) {
      newestRequestedFileModifiedAt = lastModifiedAt;
    }
    const staleForSources = sources.filter((source) => {
      const latestRunForFile = latestDiagnosticRunsBySource(
        runs.filter((run) =>
          run.source === source &&
          run.status === "succeeded" &&
          diagnosticRunTouchesFile(input.projectRoot, run, filePath, input.normalizeFilePath)
        ),
      ).get(source);
      return !latestRunForFile || diagnosticRunCheckedBeforeFileModified(latestRunForFile, modifiedMs);
    });
    if (staleForSources.length > 0) {
      changedFiles.push({ filePath, lastModifiedAt, staleForSources });
    }
  }

  const returnedChangedFiles = changedFiles.slice(0, input.limit);
  const warnings = sources.length === 0
    ? ["no Reef diagnostic runs are available for this project"]
    : [];
  return {
    status: overallVerificationStatus(sourceStates, changedFiles),
    sources: sourceStates,
    recentRuns,
    changedFiles: returnedChangedFiles,
    suggestedActions: verificationSuggestedActions(sourceStates, changedFiles),
    ...(newestRequestedFileModifiedAt ? { newestRequestedFileModifiedAt } : {}),
    warnings,
  };
}

export function calculateActiveFindingStatus(
  input: ReefActiveFindingStatusInput,
): ReefActiveFindingStatusOutput {
  const findings = input.projectStore.queryReefFindings({
    projectId: input.projectId,
    status: "active",
    includeResolved: false,
    limit: input.limit,
  });
  const bySeverity: Record<ProjectFinding["severity"], number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  let staleCount = 0;
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    if (finding.freshness.state !== "fresh") {
      staleCount += 1;
    }
  }
  return {
    totalActive: findings.length,
    staleCount,
    bySeverity,
    bySource: groupFindings(findings, (finding) => finding.source),
    byRule: groupFindings(findings, (finding) => finding.ruleId ?? finding.source),
    byFile: groupFindings(findings.filter((finding) => finding.filePath), (finding) => finding.filePath ?? "unknown"),
  };
}

export function calculateDuplicateCandidates(
  input: ReefDuplicateCandidatesInput,
): ReefDuplicateCandidatesOutput {
  const findings = input.projectStore.queryReefFindings({
    projectId: input.projectId,
    status: "active",
    includeResolved: false,
    limit: Math.max(input.limit * 5, 100),
  });
  const candidateFindings = findings.filter((finding) => duplicateSignalText(finding).match(/\b(duplicate|duplicates|duplicated|duplication|near[- ]?twin|copy[- ]?paste|clone|drift|bypass)\b/iu));
  const groups = new Map<string, ProjectFinding[]>();
  for (const finding of candidateFindings) {
    const key = duplicateGroupingKey(finding);
    const group = groups.get(key) ?? [];
    group.push(finding);
    groups.set(key, group);
  }

  const candidates = [...groups.entries()]
    .map(([key, group]) => duplicateCandidateFromGroup(key, group))
    .filter((candidate): candidate is ReefDuplicateCandidate => candidate != null)
    .sort((left, right) =>
      right.confidence - left.confidence ||
      right.files.length - left.files.length ||
      left.candidateId.localeCompare(right.candidateId)
    );
  return {
    candidates: candidates.slice(0, input.limit),
    totalCandidateCount: candidates.length,
    warnings: candidates.length > input.limit
      ? [`duplicate candidates truncated ${candidates.length} entries to limit ${input.limit}.`]
      : [],
  };
}

function groupFindings(
  findings: readonly ProjectFinding[],
  keyFor: (finding: ProjectFinding) => string,
): ReefActiveFindingStatusGroup[] {
  const groups = new Map<string, ProjectFinding[]>();
  for (const finding of findings) {
    const key = keyFor(finding);
    const group = groups.get(key) ?? [];
    group.push(finding);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => findingGroup(key, group))
    .sort((left, right) =>
      right.errorCount - left.errorCount ||
      right.warningCount - left.warningCount ||
      right.count - left.count ||
      left.key.localeCompare(right.key)
    );
}

function findingGroup(key: string, findings: readonly ProjectFinding[]): ReefActiveFindingStatusGroup {
  const sampleFilePaths = [...new Set(findings.map((finding) => finding.filePath).filter((filePath): filePath is string => Boolean(filePath)))].slice(0, 5);
  return {
    key,
    count: findings.length,
    errorCount: findings.filter((finding) => finding.severity === "error").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
    infoCount: findings.filter((finding) => finding.severity === "info").length,
    staleCount: findings.filter((finding) => finding.freshness.state !== "fresh").length,
    latestCapturedAt: findings.map((finding) => finding.capturedAt).sort().at(-1),
    sampleFilePaths,
  };
}

function duplicateSignalText(finding: ProjectFinding): string {
  return [
    finding.source,
    finding.ruleId ?? "",
    finding.message,
    finding.filePath ?? "",
    ...(finding.evidenceRefs ?? []),
  ].join(" ").toLowerCase();
}

function duplicateGroupingKey(finding: ProjectFinding): string {
  const rule = finding.ruleId ?? finding.source;
  const normalizedMessage = finding.message
    .toLowerCase()
    .replace(/\b[\w./-]+\.[cm]?[jt]sx?\b/gu, "<file>")
    .replace(/\s+/gu, " ")
    .trim();
  return `${rule}\0${normalizedMessage}`;
}

function duplicateCandidateFromGroup(key: string, findings: readonly ProjectFinding[]): ReefDuplicateCandidate | undefined {
  const files = [...new Set(findings.flatMap((finding) => [
    finding.filePath,
    ...(finding.evidenceRefs ?? []).map((ref) => ref.split(":")[0]),
  ]).filter((filePath): filePath is string => Boolean(filePath && filePath.includes("."))))].sort();
  if (findings.length < 2 && files.length < 2) {
    return undefined;
  }
  const ruleIds = [...new Set(findings.map((finding) => finding.ruleId ?? finding.source))].sort();
  const sources = [...new Set(findings.map((finding) => finding.source))].sort();
  const confidence = Math.min(0.96, Math.max(...findings.map(confidenceFromFinding)) + Math.min(files.length, 4) * 0.03);
  return {
    candidateId: `duplicate:${key.replace(/\0/gu, ":")}`,
    files,
    ruleIds,
    sources,
    findingFingerprints: findings.map((finding) => finding.fingerprint),
    confidence,
    reason: `${findings.length} durable finding(s) point at ${files.length} file(s) with duplicate, drift, clone, or bypass wording.`,
  };
}
