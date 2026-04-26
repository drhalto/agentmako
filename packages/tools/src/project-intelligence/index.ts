import type {
  AnswerComparisonRecord,
  AnswerTrustEvaluationRecord,
  HealthTrendMetric,
  HealthTrendMetricDirection,
  HealthTrendMetricName,
  HealthTrendResult,
  HealthTrendToolInput,
  HealthTrendToolOutput,
  IssuesNextItem,
  IssuesNextResult,
  IssuesNextToolInput,
  IssuesNextToolOutput,
  ProjectHealthSnapshot,
  ProjectIntelligenceBasis,
  SessionHandoffCurrentFocus,
  SessionHandoffFocusReasonCode,
  SessionHandoffPrimaryReasonCode,
  SessionHandoffRecentQuery,
  SessionHandoffResult,
  SessionHandoffToolInput,
  SessionHandoffToolOutput,
} from "@mako-ai/contracts";
import type {
  AnswerTrustRunRecord,
  ProjectStore,
  SavedAnswerTraceRecord,
  WorkflowFollowupRecord,
} from "@mako-ai/store";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

const DEFAULT_PROJECT_INTELLIGENCE_SOURCE_TRACE_LIMIT = 8;
const MAX_PROJECT_INTELLIGENCE_SOURCE_TRACE_LIMIT = 32;
const MIN_HEALTH_TREND_HISTORY = 4;
const MAX_ISSUES_NEXT_QUEUED = 10;

interface RecentTraceState {
  trace: SavedAnswerTraceRecord;
  trustRun: AnswerTrustRunRecord | null;
  evaluation: AnswerTrustEvaluationRecord | null;
  comparison: AnswerComparisonRecord | null;
  followups: WorkflowFollowupRecord[];
}

interface RankedRecentTraceState {
  state: RecentTraceState;
  index: number;
  rank: {
    score: number;
    primaryReasonCode: SessionHandoffPrimaryReasonCode | null;
  };
}

const FOCUS_REASON_PRIORITY: Record<SessionHandoffPrimaryReasonCode, number> = {
  trust_contradicted: 700,
  trust_insufficient_evidence: 620,
  trust_stale: 560,
  trust_aging: 520,
  trust_changed: 480,
  comparison_changed: 420,
};

export async function sessionHandoffTool(
  input: SessionHandoffToolInput,
  options: ToolServiceOptions = {},
): Promise<SessionHandoffToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => ({
    toolName: "session_handoff",
    projectId: project.projectId,
    result: buildSessionHandoffResult(projectStore, {
      sourceTraceLimit: normalizeProjectIntelligenceSourceTraceLimit(input.limit),
    }),
  }));
}

export async function healthTrendTool(
  input: HealthTrendToolInput,
  options: ToolServiceOptions = {},
): Promise<HealthTrendToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => ({
    toolName: "health_trend",
    projectId: project.projectId,
    result: buildHealthTrendResult(projectStore, {
      sourceTraceLimit: normalizeProjectIntelligenceSourceTraceLimit(input.limit),
    }),
  }));
}

export async function issuesNextTool(
  input: IssuesNextToolInput,
  options: ToolServiceOptions = {},
): Promise<IssuesNextToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => ({
    toolName: "issues_next",
    projectId: project.projectId,
    result: buildIssuesNextResult(projectStore, {
      sourceTraceLimit: normalizeProjectIntelligenceSourceTraceLimit(input.limit),
    }),
  }));
}

export function buildSessionHandoffResult(
  projectStore: ProjectStore,
  options: {
    sourceTraceLimit?: number;
  } = {},
): SessionHandoffResult {
  const generatedAt = new Date().toISOString();
  const sourceTraceLimit = normalizeProjectIntelligenceSourceTraceLimit(options.sourceTraceLimit);
  const warnings: string[] = [];
  const recentStates = loadRecentTraceStates(projectStore, sourceTraceLimit);

  if (recentStates.length === 0) {
    warnings.push("session handoff has no recent answer traces for this project yet.");
  }

  const rankedFocuses = rankRecentTraceStates(recentStates);
  const currentFocus =
    rankedFocuses.length > 0
      ? createCurrentFocus(rankedFocuses[0].state, rankedFocuses[0].rank.primaryReasonCode!)
      : null;

  if (!currentFocus && recentStates.length > 0) {
    warnings.push(
      "session handoff found no unresolved current focus; recent traces are stable, superseded, or have no active change signal.",
    );
  }

  const recentQueries = recentStates.map((state) =>
    createRecentQuery(
      state,
      currentFocus != null && state.trace.traceId === currentFocus.traceId,
    ),
  );

  return {
    generatedAt,
    basis: buildProjectIntelligenceBasis(projectStore, sourceTraceLimit),
    summary: {
      recentQueryCount: recentQueries.length,
      unresolvedQueryCount: recentQueries.filter((entry) => hasUnresolvedSignals(entry.signalCodes)).length,
      changedQueryCount: recentQueries.filter(
        (entry) => entry.meaningfulChangeDetected || entry.trustState === "changed",
      ).length,
      queriesWithFollowups: recentQueries.filter((entry) => entry.followupCount > 0).length,
    },
    currentFocus,
    recentQueries,
    warnings,
  };
}

export function buildHealthTrendResult(
  projectStore: ProjectStore,
  options: {
    sourceTraceLimit?: number;
  } = {},
): HealthTrendResult {
  const generatedAt = new Date().toISOString();
  const sourceTraceLimit = normalizeProjectIntelligenceSourceTraceLimit(options.sourceTraceLimit);
  const warnings: string[] = [];
  const recentStates = loadRecentTraceStates(projectStore, sourceTraceLimit);

  if (recentStates.length === 0) {
    warnings.push("health trend has no recent answer traces for this project yet.");
  }

  const recentWindowTraceCount = Math.ceil(recentStates.length / 2);
  const recentWindowStates = recentStates.slice(0, recentWindowTraceCount);
  const priorWindowStates =
    recentStates.length >= MIN_HEALTH_TREND_HISTORY
      ? recentStates.slice(recentWindowTraceCount)
      : [];
  const enoughHistory =
    recentStates.length >= MIN_HEALTH_TREND_HISTORY && priorWindowStates.length > 0;

  if (!enoughHistory) {
    warnings.push(
      "health trend has insufficient history; at least four recent traces are needed to compare a recent window against a prior window.",
    );
  }

  const fullSummary = summarizeProjectHealthSnapshot(recentStates);
  const recentWindow = summarizeProjectHealthSnapshot(recentWindowStates);
  const priorWindow = enoughHistory ? summarizeProjectHealthSnapshot(priorWindowStates) : null;

  return {
    generatedAt,
    basis: buildProjectIntelligenceBasis(projectStore, sourceTraceLimit),
    summary: {
      ...fullSummary,
      enoughHistory,
      recentWindowTraceCount: recentWindow.traceCount,
      priorWindowTraceCount: priorWindow?.traceCount ?? 0,
    },
    recentWindow,
    priorWindow,
    metrics: buildHealthTrendMetrics(recentWindow, priorWindow),
    warnings,
  };
}

export function buildIssuesNextResult(
  projectStore: ProjectStore,
  options: {
    sourceTraceLimit?: number;
  } = {},
): IssuesNextResult {
  const generatedAt = new Date().toISOString();
  const sourceTraceLimit = normalizeProjectIntelligenceSourceTraceLimit(options.sourceTraceLimit);
  const warnings: string[] = [];
  const recentStates = loadRecentTraceStates(projectStore, sourceTraceLimit);

  if (recentStates.length === 0) {
    warnings.push("issues next has no recent answer traces for this project yet.");
  }

  const rankedFocuses = rankRecentTraceStates(recentStates);
  const rankedItems = rankedFocuses.map((entry) =>
    createIssuesNextItem(entry.state, entry.rank.primaryReasonCode!),
  );
  const currentIssue = rankedItems[0] ?? null;
  const totalQueuedCount = Math.max(rankedItems.length - 1, 0);
  const queuedIssues = rankedItems.slice(1, 1 + MAX_ISSUES_NEXT_QUEUED);
  const truncatedQueuedCount = Math.max(totalQueuedCount - queuedIssues.length, 0);

  if (!currentIssue && recentStates.length > 0) {
    warnings.push(
      "issues next found no unresolved recommendations; recent traces are stable, superseded, or have no active change signal.",
    );
  }

  if (truncatedQueuedCount > 0) {
    warnings.push(
      `issues next truncated queued recommendations to ${MAX_ISSUES_NEXT_QUEUED} items; narrow the recent-trace window for a smaller queue.`,
    );
  }

  return {
    generatedAt,
    basis: buildProjectIntelligenceBasis(projectStore, sourceTraceLimit),
    summary: {
      recentQueryCount: recentStates.length,
      candidateCount: rankedItems.length,
      activeCount: currentIssue == null ? 0 : 1,
      queuedCount: queuedIssues.length,
      truncatedQueuedCount,
      suppressedStableCount: Math.max(recentStates.length - rankedItems.length, 0),
      queriesWithFollowups: rankedItems.filter((item) => item.followupCount > 0).length,
    },
    currentIssue,
    queuedIssues,
    warnings,
  };
}

function buildProjectIntelligenceBasis(
  projectStore: ProjectStore,
  sourceTraceLimit: number,
): ProjectIntelligenceBasis {
  const latestIndexRun = projectStore.getLatestIndexRun();
  const snapshot = projectStore.loadSchemaSnapshot();
  return {
    latestIndexRunId: latestIndexRun?.runId ?? null,
    schemaSnapshotId: snapshot?.snapshotId ?? null,
    schemaFingerprint: snapshot?.fingerprint ?? null,
    sourceTraceLimit,
  };
}

function loadRecentTraceStates(
  projectStore: ProjectStore,
  sourceTraceLimit: number,
): RecentTraceState[] {
  return projectStore
    .listRecentAnswerTraces({ limit: sourceTraceLimit })
    .map((trace) => loadRecentTraceState(projectStore, trace));
}

function loadRecentTraceState(projectStore: ProjectStore, trace: SavedAnswerTraceRecord): RecentTraceState {
  const trustRun = projectStore.getAnswerTrustRun(trace.traceId);
  const evaluation = projectStore.getLatestAnswerTrustEvaluationForTrace(trace.traceId);
  const comparison = evaluation?.comparisonId != null
    ? projectStore.getAnswerComparison(evaluation.comparisonId)
    : null;
  const followups = projectStore.queryWorkflowFollowups({
    originQueryId: trace.traceId,
    limit: 20,
  });

  return {
    trace,
    trustRun,
    evaluation,
    comparison,
    followups,
  };
}

function rankRecentTraceStates(recentStates: RecentTraceState[]): RankedRecentTraceState[] {
  return recentStates
    .map((state, index) => ({ state, index, rank: rankRecentTraceState(state, index) }))
    .filter((entry) => entry.rank.primaryReasonCode != null)
    .sort((left, right) => {
      if (right.rank.score !== left.rank.score) {
        return right.rank.score - left.rank.score;
      }
      if (left.state.trace.createdAt !== right.state.trace.createdAt) {
        return right.state.trace.createdAt.localeCompare(left.state.trace.createdAt);
      }
      return left.state.trace.traceId.localeCompare(right.state.trace.traceId);
    });
}

function createRecentQuery(state: RecentTraceState, isCurrentFocus: boolean): SessionHandoffRecentQuery {
  const signalCodes = collectSignalCodes(state);
  return {
    traceId: state.trace.traceId,
    targetId: state.trustRun?.targetId ?? null,
    comparisonId: state.comparison?.comparisonId ?? null,
    queryKind: state.trace.queryKind,
    queryText: state.trace.queryText,
    createdAt: state.trace.createdAt,
    supportLevel: state.trace.supportLevel,
    evidenceStatus: state.trace.evidenceStatus,
    trustState: state.evaluation?.state ?? null,
    meaningfulChangeDetected: state.comparison?.meaningfulChangeDetected ?? false,
    followupCount: state.followups.length,
    lastFollowupAt: state.followups[0]?.createdAt ?? null,
    signalCodes,
    isCurrentFocus,
  };
}

function createCurrentFocus(
  state: RecentTraceState,
  reasonCode: SessionHandoffPrimaryReasonCode,
): SessionHandoffCurrentFocus {
  const base = createRecentQuery(state, true);
  return {
    ...base,
    reasonCode,
    reason: buildFocusReason(state, reasonCode),
    stopWhen: buildStopConditions(state),
  };
}

function createIssuesNextItem(
  state: RecentTraceState,
  reasonCode: SessionHandoffPrimaryReasonCode,
): IssuesNextItem {
  const base = createRecentQuery(state, false);
  return {
    traceId: base.traceId,
    targetId: base.targetId,
    comparisonId: base.comparisonId,
    queryKind: base.queryKind,
    queryText: base.queryText,
    createdAt: base.createdAt,
    supportLevel: base.supportLevel,
    evidenceStatus: base.evidenceStatus,
    trustState: base.trustState,
    meaningfulChangeDetected: base.meaningfulChangeDetected,
    followupCount: base.followupCount,
    lastFollowupAt: base.lastFollowupAt,
    signalCodes: base.signalCodes,
    reasonCode,
    reason: buildFocusReason(state, reasonCode),
    stopWhen: buildStopConditions(state),
  };
}

function summarizeProjectHealthSnapshot(recentStates: RecentTraceState[]): ProjectHealthSnapshot {
  return {
    traceCount: recentStates.length,
    unresolvedQueryCount: recentStates.filter((state) =>
      hasUnresolvedSignals(collectSignalCodes(state))
    ).length,
    stableQueryCount: recentStates.filter((state) =>
      state.evaluation?.state === "stable" && !(state.comparison?.meaningfulChangeDetected ?? false)
    ).length,
    changedQueryCount: recentStates.filter((state) =>
      state.evaluation?.state === "changed" || (state.comparison?.meaningfulChangeDetected ?? false)
    ).length,
    contradictedQueryCount: recentStates.filter((state) => state.evaluation?.state === "contradicted").length,
    insufficientEvidenceQueryCount: recentStates.filter(
      (state) => state.evaluation?.state === "insufficient_evidence",
    ).length,
    queriesWithFollowups: recentStates.filter((state) => state.followups.length > 0).length,
  };
}

function buildHealthTrendMetrics(
  recentWindow: ProjectHealthSnapshot,
  priorWindow: ProjectHealthSnapshot | null,
): HealthTrendMetric[] {
  if (priorWindow == null) {
    return [
      createHealthTrendMetric("unresolved_queries", recentWindow.unresolvedQueryCount, 0),
      createHealthTrendMetric("stable_queries", recentWindow.stableQueryCount, 0),
      createHealthTrendMetric("changed_queries", recentWindow.changedQueryCount, 0),
      createHealthTrendMetric("contradicted_queries", recentWindow.contradictedQueryCount, 0),
      createHealthTrendMetric(
        "insufficient_evidence_queries",
        recentWindow.insufficientEvidenceQueryCount,
        0,
      ),
      createHealthTrendMetric("queries_with_followups", recentWindow.queriesWithFollowups, 0),
    ].map((metric) => ({
      ...metric,
      direction: "insufficient_history" as const,
      interpretation: buildHealthTrendInterpretation(
        metric.metric,
        "insufficient_history",
        metric.recentCount,
        metric.priorCount,
      ),
    }));
  }

  return [
    createHealthTrendMetric("unresolved_queries", recentWindow.unresolvedQueryCount, priorWindow?.unresolvedQueryCount ?? 0),
    createHealthTrendMetric("stable_queries", recentWindow.stableQueryCount, priorWindow?.stableQueryCount ?? 0),
    createHealthTrendMetric("changed_queries", recentWindow.changedQueryCount, priorWindow?.changedQueryCount ?? 0),
    createHealthTrendMetric(
      "contradicted_queries",
      recentWindow.contradictedQueryCount,
      priorWindow?.contradictedQueryCount ?? 0,
    ),
    createHealthTrendMetric(
      "insufficient_evidence_queries",
      recentWindow.insufficientEvidenceQueryCount,
      priorWindow?.insufficientEvidenceQueryCount ?? 0,
    ),
    createHealthTrendMetric(
      "queries_with_followups",
      recentWindow.queriesWithFollowups,
      priorWindow.queriesWithFollowups,
    ),
  ];
}

function createHealthTrendMetric(
  metric: HealthTrendMetricName,
  recentCount: number,
  priorCount: number,
): HealthTrendMetric {
  const direction: HealthTrendMetricDirection =
    recentCount > priorCount ? "up" : recentCount < priorCount ? "down" : "flat";
  return {
    metric,
    recentCount,
    priorCount,
    direction,
    interpretation: buildHealthTrendInterpretation(metric, direction, recentCount, priorCount),
  };
}

function buildHealthTrendInterpretation(
  metric: HealthTrendMetricName,
  direction: HealthTrendMetricDirection,
  recentCount: number,
  priorCount: number,
): string {
  const label = describeHealthTrendMetric(metric);
  if (direction === "insufficient_history") {
    return `not enough recent history exists yet to compare ${label} against a prior window`;
  }
  if (direction === "flat") {
    return `${label} stayed flat (${recentCount} recent vs ${priorCount} prior)`;
  }
  const verb = direction === "up" ? "rose" : "fell";
  return `${label} ${verb} (${recentCount} recent vs ${priorCount} prior)`;
}

function describeHealthTrendMetric(metric: HealthTrendMetricName): string {
  switch (metric) {
    case "unresolved_queries":
      return "unresolved queries";
    case "stable_queries":
      return "stable queries";
    case "changed_queries":
      return "changed queries";
    case "contradicted_queries":
      return "contradicted queries";
    case "insufficient_evidence_queries":
      return "insufficient-evidence queries";
    case "queries_with_followups":
      return "queries with recorded follow-ups";
  }
}

function buildFocusReason(
  state: RecentTraceState,
  reasonCode: SessionHandoffPrimaryReasonCode,
): string {
  const prefix =
    state.followups.length > 0
      ? "Recorded follow-up work exists, but "
      : "";
  const queryLabel = `\`${state.trace.queryText}\``;

  switch (reasonCode) {
    case "trust_contradicted":
      return `${prefix}the latest trust state for ${queryLabel} is contradicted and should be rechecked first.`;
    case "trust_insufficient_evidence":
      return `${prefix}${queryLabel} still has insufficient evidence and needs a more grounded rerun or verification pass.`;
    case "trust_stale":
      return `${prefix}${queryLabel} is stale against the current project state and should be refreshed before deeper work continues.`;
    case "trust_aging":
      return `${prefix}${queryLabel} is aging and should be refreshed before its assumptions drift further.`;
    case "trust_changed":
      return `${prefix}the latest rerun for ${queryLabel} changed materially and needs review.`;
    case "comparison_changed":
      return `${prefix}the latest comparison for ${queryLabel} shows meaningful change that has not been cleared yet.`;
  }

  return `${prefix}${queryLabel} remains the highest-priority unresolved focus.`;
}

function buildStopConditions(state: RecentTraceState): string[] {
  const out: string[] = [];

  if (
    state.evaluation?.state &&
    state.evaluation.state !== "stable" &&
    state.evaluation.state !== "superseded"
  ) {
    out.push("the latest trust state for this target becomes stable or is superseded by a newer run");
  }

  if (state.comparison?.meaningfulChangeDetected) {
    out.push("the latest comparison for this target no longer reports meaningful change");
  }

  if (state.followups.length === 0) {
    out.push("a follow-up rerun or verification has been recorded for this query");
  } else if (out.length === 0) {
    out.push("the recorded follow-up work for this query no longer leaves unresolved trust or change signals");
  }

  return Array.from(new Set(out));
}

function collectSignalCodes(state: RecentTraceState): SessionHandoffFocusReasonCode[] {
  const out: SessionHandoffFocusReasonCode[] = [];

  switch (state.evaluation?.state) {
    case "contradicted":
      out.push("trust_contradicted");
      break;
    case "insufficient_evidence":
      out.push("trust_insufficient_evidence");
      break;
    case "stale":
      out.push("trust_stale");
      break;
    case "aging":
      out.push("trust_aging");
      break;
    case "changed":
      out.push("trust_changed");
      break;
    default:
      break;
  }

  if (state.comparison?.meaningfulChangeDetected) {
    out.push("comparison_changed");
  }

  if (state.followups.length > 0 && out.length > 0) {
    out.push("followup_in_progress");
  }

  return Array.from(new Set(out));
}

function hasUnresolvedSignals(signalCodes: SessionHandoffFocusReasonCode[]): boolean {
  return signalCodes.some((code) => code !== "followup_in_progress");
}

function rankRecentTraceState(
  state: RecentTraceState,
  index: number,
): {
  score: number;
  primaryReasonCode: SessionHandoffPrimaryReasonCode | null;
} {
  const signalCodes = collectSignalCodes(state).filter(
    (code): code is SessionHandoffPrimaryReasonCode => code !== "followup_in_progress",
  );

  if (signalCodes.length === 0) {
    return { score: -index, primaryReasonCode: null };
  }

  const primaryReasonCode = [...signalCodes].sort(
    (left, right) => FOCUS_REASON_PRIORITY[right] - FOCUS_REASON_PRIORITY[left],
  )[0]!;
  // Bias slightly toward resuming unresolved work that already has recorded follow-up
  // momentum. This is a handoff-oriented completion bias, not a generic queue policy.
  const score =
    FOCUS_REASON_PRIORITY[primaryReasonCode] +
    (state.followups.length > 0 ? 25 : 0) -
    index;

  return { score, primaryReasonCode };
}

function normalizeProjectIntelligenceSourceTraceLimit(limit?: number): number {
  if (!Number.isInteger(limit) || limit == null) {
    return DEFAULT_PROJECT_INTELLIGENCE_SOURCE_TRACE_LIMIT;
  }
  return Math.max(1, Math.min(MAX_PROJECT_INTELLIGENCE_SOURCE_TRACE_LIMIT, limit));
}
