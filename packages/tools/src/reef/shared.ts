import type {
  EvidenceConfidenceItem,
  JsonObject,
  ProjectConvention,
  ProjectIndexWatchState,
  ProjectFact,
  ProjectFinding,
  ReefCandidate,
  ReefDiagnosticRun,
  ReefDiagnosticRunCache,
  ReefEvidenceConfidenceLabel,
  ReefRuleDescriptor,
  RuleMemoryEntry,
  VerificationChangedFile,
  VerificationSourceState,
  VerificationStateToolOutput,
} from "@mako-ai/contracts";

export function diagnosticRunCache(
  run: ReefDiagnosticRun,
  args: {
    checkedAt: string;
    checkedAtMs: number;
    staleAfterMs: number;
  },
): ReefDiagnosticRunCache {
  const finishedAtMs = Date.parse(run.finishedAt);
  if (!Number.isFinite(finishedAtMs)) {
    return {
      state: "unknown",
      checkedAt: args.checkedAt,
      staleAfterMs: args.staleAfterMs,
      reason: "diagnostic run finishedAt timestamp could not be parsed",
    };
  }

  const ageMs = Math.max(0, args.checkedAtMs - finishedAtMs);
  if (ageMs > args.staleAfterMs) {
    return {
      state: "stale",
      checkedAt: args.checkedAt,
      ageMs,
      staleAfterMs: args.staleAfterMs,
      reason: `diagnostic run is older than cacheStalenessMs (${args.staleAfterMs} ms)`,
    };
  }

  return {
    state: "fresh",
    checkedAt: args.checkedAt,
    ageMs,
    staleAfterMs: args.staleAfterMs,
    reason: `diagnostic run is within cacheStalenessMs (${args.staleAfterMs} ms)`,
  };
}

export function tokenizeQuery(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9_.$/-]+/).filter((token) => token.length >= 2))];
}

export function scoreText(text: string, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const haystack = text.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 2 : 0), 0);
}

export function addCandidate(candidates: Map<string, ReefCandidate>, candidate: ReefCandidate): void {
  const existing = candidates.get(candidate.id);
  if (!existing || candidate.score > existing.score) {
    candidates.set(candidate.id, candidate);
  }
}

export function factSearchText(fact: ProjectFact): string {
  return [
    fact.kind,
    fact.source,
    fact.overlay,
    fact.freshness.state,
    fact.freshness.reason,
    filePathFromFact(fact) ?? "",
    jsonString(fact.subject),
    jsonString(fact.data),
  ].join(" ");
}

export function findingSearchText(finding: ProjectFinding): string {
  return [
    finding.source,
    finding.ruleId ?? "",
    finding.severity,
    finding.status,
    finding.filePath ?? "",
    finding.message,
    finding.freshness.state,
    finding.freshness.reason,
  ].join(" ");
}

export function ruleSearchText(rule: ReefRuleDescriptor): string {
  return [
    rule.id,
    rule.source,
    rule.sourceNamespace,
    rule.severity,
    rule.title,
    rule.description,
    ...(rule.tags ?? []),
    ...(rule.factKinds ?? []),
  ].join(" ");
}

export function diagnosticRunSearchText(run: ReefDiagnosticRun): string {
  return [
    run.source,
    run.status,
    run.command ?? "",
    run.configPath ?? "",
    run.errorText ?? "",
    jsonString(run.metadata),
  ].join(" ");
}

export function filePathFromFact(fact: ProjectFact): string | undefined {
  switch (fact.subject.kind) {
    case "file":
    case "symbol":
    case "diagnostic":
      return fact.subject.path;
    case "import_edge":
      return fact.subject.sourcePath;
    case "route":
      return stringDataValue(fact.data, "filePath") ?? stringDataValue(fact.data, "path");
    case "schema_object":
      return stringDataValue(fact.data, "filePath") ?? stringDataValue(fact.data, "path");
  }
}

export function matchesFactScope(
  fact: ProjectFact,
  scope: { filePath?: string; subjectFingerprint?: string },
): boolean {
  if (scope.subjectFingerprint && fact.subjectFingerprint !== scope.subjectFingerprint) return false;
  if (scope.filePath && filePathFromFact(fact) !== scope.filePath) return false;
  return true;
}

export function matchesFindingScope(
  finding: ProjectFinding,
  scope: { filePath?: string; subjectFingerprint?: string },
): boolean {
  if (scope.subjectFingerprint && finding.subjectFingerprint !== scope.subjectFingerprint) return false;
  if (scope.filePath && finding.filePath !== scope.filePath) return false;
  return true;
}

export function confidenceFromFinding(finding: ProjectFinding): number {
  const freshnessPenalty = finding.freshness.state === "fresh" ? 0 : finding.freshness.state === "stale" ? 0.25 : 0.4;
  const statusPenalty = finding.status === "active" ? 0 : finding.status === "acknowledged" ? 0.15 : 0.3;
  const severityBase = finding.severity === "error" ? 0.92 : finding.severity === "warning" ? 0.82 : 0.68;
  return Math.max(0.1, Math.min(1, severityBase - freshnessPenalty - statusPenalty));
}

export function confidenceLabelForFact(fact: ProjectFact): ReefEvidenceConfidenceLabel {
  if (factHasConflict(fact)) return "contradicted";
  if (isFuzzySource(fact.source)) return "fuzzy_semantic";
  if (isHistoricalSource(fact.source)) return "historical";
  if (fact.freshness.state === "stale") return "stale_indexed";
  if (fact.overlay === "working_tree" && fact.freshness.state === "fresh") return "verified_live";
  if (fact.overlay === "indexed" && fact.freshness.state === "fresh") return "fresh_indexed";
  return "unknown";
}

export function confidenceLabelForFinding(finding: ProjectFinding): ReefEvidenceConfidenceLabel {
  if (findingSignalsConflict(finding)) return "contradicted";
  if (isFuzzySource(finding.source)) return "fuzzy_semantic";
  if (isHistoricalSource(finding.source)) return "historical";
  if (finding.freshness.state === "stale") return "stale_indexed";
  if (finding.overlay === "working_tree" && finding.freshness.state === "fresh") return "verified_live";
  if (finding.overlay === "indexed" && finding.freshness.state === "fresh") return "fresh_indexed";
  return "unknown";
}

export function confidenceReason(label: ReefEvidenceConfidenceLabel, freshnessReason: string): string {
  switch (label) {
    case "verified_live":
      return `working-tree evidence is fresh: ${freshnessReason}`;
    case "fresh_indexed":
      return `indexed evidence is fresh: ${freshnessReason}`;
    case "stale_indexed":
      return `evidence is stale or indexed behind disk: ${freshnessReason}`;
    case "fuzzy_semantic":
      return `evidence came from a fuzzy or semantic source: ${freshnessReason}`;
    case "historical":
      return `evidence came from historical/runtime memory: ${freshnessReason}`;
    case "contradicted":
      return `evidence is marked as contradicted: ${freshnessReason}`;
    case "unknown":
      return `evidence confidence is unknown: ${freshnessReason}`;
  }
}

export function summarizeConfidenceLabels(items: readonly EvidenceConfidenceItem[]): Record<ReefEvidenceConfidenceLabel, number> {
  const summary: Record<ReefEvidenceConfidenceLabel, number> = {
    verified_live: 0,
    fresh_indexed: 0,
    stale_indexed: 0,
    fuzzy_semantic: 0,
    historical: 0,
    contradicted: 0,
    unknown: 0,
  };
  for (const item of items) {
    summary[item.confidenceLabel] += 1;
  }
  return summary;
}

export function confidenceLabelWeight(label: ReefEvidenceConfidenceLabel): number {
  switch (label) {
    case "verified_live":
      return 6;
    case "fresh_indexed":
      return 5;
    case "historical":
      return 4;
    case "fuzzy_semantic":
      return 3;
    case "unknown":
      return 2;
    case "stale_indexed":
      return 1;
    case "contradicted":
      return 0;
  }
}

export function severityWeight(severity: ProjectFinding["severity"]): number {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}

export function latestDiagnosticRunsBySource(runs: readonly ReefDiagnosticRun[]): Map<string, ReefDiagnosticRun> {
  const latest = new Map<string, ReefDiagnosticRun>();
  for (const run of runs) {
    const existing = latest.get(run.source);
    if (!existing || Date.parse(run.finishedAt) > Date.parse(existing.finishedAt)) {
      latest.set(run.source, run);
    }
  }
  return latest;
}

export function diagnosticRunTouchesFile(
  projectRoot: string,
  run: ReefDiagnosticRun,
  filePath: string,
  normalizeFilePath: (projectRoot: string, filePath: string) => string,
): boolean {
  const requestedFiles = stringArrayValue(run.metadata, "requestedFiles");
  if (!requestedFiles) return true;
  const normalized = requestedFiles
    .map((requestedFile) => normalizeFilePath(projectRoot, requestedFile))
    .filter((requestedFile) => requestedFile.length > 0);
  return normalized.length === 0 || normalized.includes(filePath);
}

export function diagnosticRunTouchesAnyFile(
  projectRoot: string,
  run: ReefDiagnosticRun,
  filePaths: readonly string[],
  normalizeFilePath: (projectRoot: string, filePath: string) => string,
): boolean {
  return filePaths.length === 0 ||
    filePaths.some((filePath) => diagnosticRunTouchesFile(projectRoot, run, filePath, normalizeFilePath));
}

export function diagnosticRunCheckedBeforeFileModified(
  run: ReefDiagnosticRun,
  modifiedMs: number,
): boolean {
  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) return false;
  return modifiedMs > startedAtMs;
}

export function watcherDiagnosticWarnings(
  watcher: ProjectIndexWatchState | undefined,
  filePaths: readonly string[],
  lastModifiedAt?: string,
): string[] {
  if (!watcher) return [];
  const warnings: string[] = [];
  if (watcher.lastDiagnosticRefreshError) {
    warnings.push(`watcher diagnostic refresh failed: ${watcher.lastDiagnosticRefreshError}`);
  }
  if (watcher.lastDiagnosticRefreshSkippedReason) {
    warnings.push(`watcher diagnostic refresh skipped: ${watcher.lastDiagnosticRefreshSkippedReason}`);
  }
  if (lastModifiedAt && watcher.lastDiagnosticRefreshStartedAt) {
    const modifiedMs = Date.parse(lastModifiedAt);
    const diagnosticStartedMs = Date.parse(watcher.lastDiagnosticRefreshStartedAt);
    if (Number.isFinite(modifiedMs) && Number.isFinite(diagnosticStartedMs) && modifiedMs > diagnosticStartedMs) {
      warnings.push(`watcher has not completed a diagnostic refresh since ${filePaths.join(", ")} changed`);
    }
  }
  return warnings;
}

export function verificationStateForSource(source: string, run: ReefDiagnosticRun | undefined): VerificationSourceState {
  if (!run) {
    return {
      source,
      status: "unknown",
      reason: "no Reef diagnostic run exists for this source",
      suggestedActions: [`Run ${source} diagnostics before trusting no-finding results.`],
    };
  }
  if (run.status === "unavailable") {
    return {
      source,
      status: "unavailable",
      lastRun: run,
      reason: run.errorText ?? "diagnostic source was unavailable",
      suggestedActions: [`Install or configure ${source}, or disable this source for the project.`],
    };
  }
  if (run.status === "ran_with_error") {
    return {
      source,
      status: "failed",
      lastRun: run,
      reason: run.errorText ?? "diagnostic source ran with an error",
      suggestedActions: [`Fix the ${source} diagnostic command before trusting its findings.`],
    };
  }
  if (run.cache?.state === "stale") {
    return {
      source,
      status: "stale",
      lastRun: run,
      reason: run.cache.reason,
      suggestedActions: [`Re-run ${source} diagnostics; the cached result is stale.`],
    };
  }
  if (run.cache?.state === "unknown") {
    return {
      source,
      status: "unknown",
      lastRun: run,
      reason: run.cache.reason,
      suggestedActions: [`Re-run ${source} diagnostics; cache freshness is unknown.`],
    };
  }
  return {
    source,
    status: "fresh",
    lastRun: run,
    reason: run.cache?.reason ?? "latest diagnostic run succeeded",
    suggestedActions: [],
  };
}

export function overallVerificationStatus(
  sourceStates: readonly VerificationSourceState[],
  changedFiles: readonly VerificationChangedFile[],
): VerificationStateToolOutput["status"] {
  if (sourceStates.some((state) => state.status === "failed" || state.status === "unavailable")) return "failed";
  if (changedFiles.length > 0 || sourceStates.some((state) => state.status === "stale")) return "stale";
  if (sourceStates.length === 0 || sourceStates.some((state) => state.status === "unknown")) return "unknown";
  return "fresh";
}

export function verificationSuggestedActions(
  sourceStates: readonly VerificationSourceState[],
  changedFiles: readonly VerificationChangedFile[],
): string[] {
  const actions = new Set<string>();
  for (const state of sourceStates) {
    for (const action of state.suggestedActions) actions.add(action);
  }
  if (changedFiles.length > 0) {
    actions.add("Re-run diagnostics for files changed after the latest successful diagnostic run.");
  }
  if (actions.size === 0) {
    actions.add("Proceed with normal harness verification after making edits.");
  }
  return [...actions];
}

export function addConvention(conventions: Map<string, ProjectConvention>, convention: ProjectConvention): void {
  const existing = conventions.get(convention.id);
  if (!existing || convention.confidence > existing.confidence) {
    conventions.set(convention.id, convention);
  }
}

export function conventionStatus(data: JsonObject | undefined): ProjectConvention["status"] {
  const status = stringDataValue(data, "status");
  return status === "accepted" || status === "deprecated" || status === "conflicting" ? status : "candidate";
}

export function inferConventionKind(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("auth") || lower.includes("session") || lower.includes("permission")) return "auth_guard";
  if (lower.includes("client") || lower.includes("server") || lower.includes("boundary")) return "runtime_boundary";
  if (lower.includes("generated") || lower.includes("codegen")) return "generated_path";
  if (lower.includes("route")) return "route_pattern";
  if (lower.includes("schema") || lower.includes("database") || lower.includes("supabase")) return "schema_pattern";
  return undefined;
}

export function emptyRuleMemoryEntry(rule: ReefRuleDescriptor): RuleMemoryEntry {
  return {
    ruleId: rule.id,
    source: rule.source,
    sourceNamespace: rule.sourceNamespace,
    title: rule.title,
    severity: rule.severity,
    counts: {
      total: 0,
      active: 0,
      acknowledged: 0,
      resolved: 0,
      suppressed: 0,
    },
    suggestedActions: [],
  };
}

export function ruleMemorySuggestedActions(entry: RuleMemoryEntry): string[] {
  if (entry.counts.active > 0) {
    return ["Inspect active findings before editing related code.", "Use finding_ack only for reviewed false positives or accepted tradeoffs."];
  }
  if (entry.counts.acknowledged > 0) {
    return ["Review acknowledged findings if the related convention or rule changed."];
  }
  return ["No immediate action; this rule has no active Reef findings."];
}

export function ruleMemoryKey(source: string, ruleId: string): string {
  return `${source}\u0000${ruleId}`;
}

export function namespaceFromSource(source: string): string {
  const separator = source.indexOf(":");
  return separator === -1 ? source : source.slice(0, separator);
}

export function newerTimestamp(a: string | undefined, b: string): string {
  if (!a) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

export function findingSignalsConflict(finding: ProjectFinding): boolean {
  const text = `${finding.source} ${finding.ruleId ?? ""} ${finding.message}`.toLowerCase();
  return text.includes("incorrect_evidence")
    || text.includes("contradict")
    || text.includes("conflict")
    || text.includes("phantom")
    || text.includes("stale evidence");
}

export function factHasConflict(fact: ProjectFact): boolean {
  return fact.kind.includes("conflict")
    || Boolean(stringDataValue(fact.data, "conflictKind"))
    || stringDataValue(fact.data, "status") === "conflicting";
}

export function isFuzzySource(source: string): boolean {
  const lower = source.toLowerCase();
  return lower.includes("semantic") || lower.includes("embedding") || lower.includes("vector") || lower.includes("fuzzy");
}

export function isHistoricalSource(source: string): boolean {
  const lower = source.toLowerCase();
  return lower.includes("telemetry") || lower.includes("agent_feedback") || lower.includes("tool_run") || lower.includes("history");
}

export function stringDataValue(data: JsonObject | undefined, key: string): string | undefined {
  if (!data) return undefined;
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function stringArrayValue(data: JsonObject | undefined, key: string): string[] | undefined {
  if (!data) return undefined;
  const value = data[key];
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export function jsonString(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
