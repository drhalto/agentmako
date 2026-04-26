import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { post } from "../lib/http";
import { safeJson } from "../lib/safe-json";
import { useSelectedProject } from "../hooks/useSelectedProject";

type ToolOutput<T> = {
  toolName: string;
  projectId: string;
  result: T;
};

interface ProjectIndexStatusOutput {
  toolName: "project_index_status";
  projectId: string;
  projectRoot: string;
  latestRun?: {
    runId: string;
    triggerSource: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
    errorText?: string;
    stats?: Record<string, unknown>;
  };
  lastIndexedAt?: string;
  freshness: {
    checkedAt: string;
    state: "fresh" | "dirty" | "unknown";
    freshCount: number;
    staleCount: number;
    deletedCount: number;
    unindexedCount: number;
    unknownCount: number;
    sample: Array<{ state: string; filePath: string; reason: string }>;
  };
  watch?: {
    mode: "off" | "watch";
    status: string;
    dirtyPaths: string[];
    lastError?: string;
  };
  unindexedScan: {
    status: "included" | "skipped" | "watch_hint";
    message: string;
    count?: number;
    possibleCount?: number;
  };
  suggestedAction: "none" | "run_live_text_search" | "project_index_refresh";
  suggestedActionReason: string;
}

interface ProjectIndexRefreshOutput {
  skipped: boolean;
  reason: string;
  after?: ProjectIndexStatusOutput["freshness"];
  warnings: string[];
}

interface HealthTrendResult {
  generatedAt: string;
  summary: {
    traceCount: number;
    unresolvedQueryCount: number;
    stableQueryCount: number;
    changedQueryCount: number;
    contradictedQueryCount: number;
    insufficientEvidenceQueryCount: number;
    queriesWithFollowups: number;
    enoughHistory: boolean;
    recentWindowTraceCount: number;
    priorWindowTraceCount: number;
  };
  metrics: Array<{
    metric: string;
    recentCount: number;
    priorCount: number;
    direction: "up" | "down" | "flat" | "insufficient_history";
    interpretation: string;
  }>;
  warnings: string[];
}

interface ProjectIssue {
  traceId: string;
  queryKind: string;
  queryText: string;
  createdAt: string;
  supportLevel: string;
  evidenceStatus: string;
  trustState?: string | null;
  followupCount: number;
  reasonCode: string;
  reason: string;
  stopWhen: string[];
}

interface IssuesNextResult {
  generatedAt: string;
  summary: {
    recentQueryCount: number;
    candidateCount: number;
    activeCount: number;
    queuedCount: number;
    truncatedQueuedCount: number;
    suppressedStableCount: number;
    queriesWithFollowups: number;
  };
  currentIssue: ProjectIssue | null;
  queuedIssues: ProjectIssue[];
  warnings: string[];
}

interface SessionHandoffResult {
  generatedAt: string;
  summary: {
    recentQueryCount: number;
    unresolvedQueryCount: number;
    changedQueryCount: number;
    queriesWithFollowups: number;
  };
  currentFocus: (ProjectIssue & { isCurrentFocus: boolean }) | null;
  recentQueries: Array<{
    traceId: string;
    queryKind: string;
    queryText: string;
    createdAt: string;
    supportLevel: string;
    evidenceStatus: string;
    trustState?: string | null;
    followupCount: number;
    isCurrentFocus: boolean;
  }>;
  warnings: string[];
}

interface RuntimeTelemetryReport {
  eventsInWindow: number;
  byDecisionKind: Array<{ decisionKind: string; count: number }>;
  byFamily: Array<{ family: string; decisionKind: string; count: number }>;
  byGrade: Array<{ grade: string; count: number }>;
  truncated: boolean;
  warnings: string[];
}

interface FindingAcksReport {
  acksInWindow: number;
  byCategory: Array<{ category: string; distinctFingerprints: number; totalRows: number }>;
  byStatus: Array<{ status: string; count: number }>;
  bySubjectKind: Array<{ subjectKind: string; count: number }>;
  truncated: boolean;
  warnings: string[];
}

export function HealthPage() {
  const qc = useQueryClient();
  const { selectedProject, selectedProjectId, isLoading } = useSelectedProject();
  const hasProject = selectedProjectId !== null;

  const indexStatus = useQuery({
    queryKey: ["tool", "project_index_status", selectedProjectId],
    queryFn: () =>
      callTool<ProjectIndexStatusOutput>("project_index_status", {
        projectId: selectedProjectId,
        includeUnindexed: true,
      }),
    enabled: hasProject,
    refetchInterval: 20_000,
  });

  const healthTrend = useQuery({
    queryKey: ["tool", "health_trend", selectedProjectId],
    queryFn: () =>
      callTool<ToolOutput<HealthTrendResult>>("health_trend", {
        projectId: selectedProjectId,
        limit: 16,
      }),
    enabled: hasProject,
    refetchInterval: 30_000,
  });

  const issuesNext = useQuery({
    queryKey: ["tool", "issues_next", selectedProjectId],
    queryFn: () =>
      callTool<ToolOutput<IssuesNextResult>>("issues_next", {
        projectId: selectedProjectId,
        limit: 8,
      }),
    enabled: hasProject,
    refetchInterval: 30_000,
  });

  const sessionHandoff = useQuery({
    queryKey: ["tool", "session_handoff", selectedProjectId],
    queryFn: () =>
      callTool<ToolOutput<SessionHandoffResult>>("session_handoff", {
        projectId: selectedProjectId,
        limit: 8,
      }),
    enabled: hasProject,
    refetchInterval: 30_000,
  });

  const telemetry = useQuery({
    queryKey: ["tool", "runtime_telemetry_report", selectedProjectId],
    queryFn: () =>
      callTool<RuntimeTelemetryReport>("runtime_telemetry_report", {
        projectId: selectedProjectId,
        limit: 25,
      }),
    enabled: hasProject,
    refetchInterval: 45_000,
  });

  const findingAcks = useQuery({
    queryKey: ["tool", "finding_acks_report", selectedProjectId],
    queryFn: () =>
      callTool<FindingAcksReport>("finding_acks_report", {
        projectId: selectedProjectId,
        limit: 25,
      }),
    enabled: hasProject,
    refetchInterval: 45_000,
  });

  const refreshIndex = useMutation({
    mutationFn: () =>
      callTool<ProjectIndexRefreshOutput>("project_index_refresh", {
        projectId: selectedProjectId,
        mode: "if_stale",
        reason: "manual refresh from health page",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tool"] });
    },
  });

  return (
    <div className="mx-auto max-w-[1320px] px-8 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[20px] text-mk-crest">Project health</h1>
          <span className="mk-label text-mk-tide">
            scope · {selectedProject?.displayName ?? "select one project"}
          </span>
        </div>
        {hasProject ? (
          <button
            type="button"
            onClick={() => refreshIndex.mutate()}
            disabled={refreshIndex.isPending}
            className="h-9 rounded-md bg-mk-crest px-3 text-[12px] font-medium text-mk-abyss transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {refreshIndex.isPending ? "Refreshing..." : "Refresh index"}
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mk-card px-6 py-12 text-center text-[12px] text-mk-tide">
          Reading projects...
        </div>
      ) : !hasProject ? (
        <div className="mk-card px-6 py-12 text-center text-[12px] text-mk-tide">
          Choose a single project from the picker to run operator health tools.
        </div>
      ) : (
        <>
          {refreshIndex.isError ? (
            <ErrorBanner error={refreshIndex.error} />
          ) : refreshIndex.isSuccess ? (
            <div className="mb-4 rounded-xs border border-mk-current bg-mk-depth px-3 py-2 font-mono text-[11px] text-mk-surface">
              Index refresh: {refreshIndex.data.skipped ? "skipped" : "ran"} · {refreshIndex.data.reason}
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <section className="space-y-6">
              <IndexStatusCard query={indexStatus} onRefresh={() => refreshIndex.mutate()} />
              <HealthTrendCard query={healthTrend} />
              <SessionHandoffCard query={sessionHandoff} />
            </section>

            <aside className="space-y-6">
              <IssuesNextCard query={issuesNext} />
              <RuntimeTelemetryCard query={telemetry} />
              <FindingAcksCard query={findingAcks} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function IndexStatusCard({
  query,
  onRefresh,
}: {
  query: UseQueryResult<ProjectIndexStatusOutput, Error>;
  onRefresh(): void;
}) {
  return (
    <QueryCard title="Index freshness" query={query}>
      {(data) => {
        const dirty =
          data.freshness.staleCount +
          data.freshness.deletedCount +
          data.freshness.unindexedCount +
          data.freshness.unknownCount;
        return (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <StatTile label="state" value={data.freshness.state} tone={data.freshness.state === "fresh" ? "ok" : "warn"} />
              <StatTile label="fresh" value={data.freshness.freshCount} tone="ok" />
              <StatTile label="needs attention" value={dirty} tone={dirty > 0 ? "warn" : "default"} />
              <StatTile label="watch" value={data.watch ? data.watch.status : "off"} />
            </div>
            <div className="mt-4 rounded-xs border border-mk-current bg-mk-abyss px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] text-mk-crest">{data.suggestedActionReason}</div>
                  <div className="mt-1 font-mono text-[10.5px] text-mk-tide">
                    checked {formatDate(data.freshness.checkedAt)} · indexed {formatDate(data.lastIndexedAt)}
                  </div>
                </div>
                {data.suggestedAction === "project_index_refresh" ? (
                  <button
                    type="button"
                    onClick={onRefresh}
                    className="shrink-0 rounded-xs border border-mk-signal-dim px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-mk-signal hover:bg-mk-ridge"
                  >
                    run
                  </button>
                ) : null}
              </div>
            </div>
            {data.freshness.sample.length > 0 ? (
              <ul className="mt-3 divide-y divide-mk-current rounded-xs border border-mk-current bg-mk-depth" role="list">
                {data.freshness.sample.slice(0, 5).map((item) => (
                  <li key={`${item.state}:${item.filePath}`} className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <StatusPill label={item.state} tone={item.state === "fresh" ? "ok" : "warn"} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mk-surface">
                        {item.filePath}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-mk-tide">{item.reason}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        );
      }}
    </QueryCard>
  );
}

function HealthTrendCard({
  query,
}: {
  query: UseQueryResult<ToolOutput<HealthTrendResult>, Error>;
}) {
  return (
    <QueryCard title="Trend" query={query}>
      {(data) => {
        const result = data.result;
        return (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <StatTile label="traces" value={result.summary.traceCount} />
              <StatTile label="unresolved" value={result.summary.unresolvedQueryCount} tone={result.summary.unresolvedQueryCount > 0 ? "warn" : "default"} />
              <StatTile label="changed" value={result.summary.changedQueryCount} tone={result.summary.changedQueryCount > 0 ? "warn" : "default"} />
              <StatTile label="followups" value={result.summary.queriesWithFollowups} />
            </div>
            <div className="mt-4 overflow-hidden rounded-xs border border-mk-current">
              {result.metrics.map((metric) => (
                <div key={metric.metric} className="grid grid-cols-[150px_70px_1fr] gap-3 border-b border-mk-current px-3 py-2 last:border-b-0">
                  <div className="font-mono text-[11px] text-mk-surface">{metric.metric}</div>
                  <div className="font-mono text-[11px] text-mk-crest">
                    {metric.recentCount}/{metric.priorCount}
                  </div>
                  <div className="min-w-0 truncate text-[11px] text-mk-tide" title={metric.interpretation}>
                    {metric.direction} · {metric.interpretation}
                  </div>
                </div>
              ))}
            </div>
            <Warnings warnings={result.warnings} />
          </>
        );
      }}
    </QueryCard>
  );
}

function IssuesNextCard({
  query,
}: {
  query: UseQueryResult<ToolOutput<IssuesNextResult>, Error>;
}) {
  return (
    <QueryCard title="Next issues" query={query}>
      {(data) => {
        const result = data.result;
        return (
          <>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="active" value={result.summary.activeCount} tone={result.summary.activeCount > 0 ? "warn" : "default"} />
              <StatTile label="queued" value={result.summary.queuedCount} />
              <StatTile label="stable" value={result.summary.suppressedStableCount} />
            </div>
            {result.currentIssue ? (
              <IssueCard issue={result.currentIssue} featured />
            ) : (
              <div className="mt-3 rounded-xs border border-mk-current bg-mk-abyss px-3 py-3 text-[12px] text-mk-tide">
                No active issue selected by the operator signals.
              </div>
            )}
            {result.queuedIssues.length > 0 ? (
              <ul className="mt-3 space-y-2" role="list">
                {result.queuedIssues.slice(0, 4).map((issue) => (
                  <li key={issue.traceId}>
                    <IssueCard issue={issue} />
                  </li>
                ))}
              </ul>
            ) : null}
            <Warnings warnings={result.warnings} />
          </>
        );
      }}
    </QueryCard>
  );
}

function SessionHandoffCard({
  query,
}: {
  query: UseQueryResult<ToolOutput<SessionHandoffResult>, Error>;
}) {
  return (
    <QueryCard title="Session handoff" query={query}>
      {(data) => {
        const result = data.result;
        return (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <StatTile label="recent" value={result.summary.recentQueryCount} />
              <StatTile label="unresolved" value={result.summary.unresolvedQueryCount} tone={result.summary.unresolvedQueryCount > 0 ? "warn" : "default"} />
              <StatTile label="changed" value={result.summary.changedQueryCount} tone={result.summary.changedQueryCount > 0 ? "warn" : "default"} />
              <StatTile label="followups" value={result.summary.queriesWithFollowups} />
            </div>
            {result.currentFocus ? (
              <div className="mt-4">
                <div className="mk-label mb-2 text-mk-tide">current focus</div>
                <IssueCard issue={result.currentFocus} featured />
              </div>
            ) : null}
            {result.recentQueries.length > 0 ? (
              <ul className="mt-4 divide-y divide-mk-current rounded-xs border border-mk-current bg-mk-depth" role="list">
                {result.recentQueries.slice(0, 6).map((item) => (
                  <li key={item.traceId} className="px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <StatusPill label={item.queryKind} />
                      {item.trustState ? <StatusPill label={item.trustState} tone={trustTone(item.trustState)} /> : null}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-mk-crest">
                        {item.queryText}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-mk-tide">
                      {shortenId(item.traceId)} · {formatDate(item.createdAt)} · followups {item.followupCount}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            <Warnings warnings={result.warnings} />
          </>
        );
      }}
    </QueryCard>
  );
}

function RuntimeTelemetryCard({
  query,
}: {
  query: UseQueryResult<RuntimeTelemetryReport, Error>;
}) {
  return (
    <QueryCard title="Runtime telemetry" query={query}>
      {(data) => (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="events" value={data.eventsInWindow} />
            <StatTile label="truncated" value={data.truncated ? "yes" : "no"} tone={data.truncated ? "warn" : "default"} />
          </div>
          <MiniCounts
            rows={data.byDecisionKind.map((row) => ({
              label: row.decisionKind,
              value: row.count,
            }))}
          />
          <Warnings warnings={data.warnings} />
        </>
      )}
    </QueryCard>
  );
}

function FindingAcksCard({
  query,
}: {
  query: UseQueryResult<FindingAcksReport, Error>;
}) {
  return (
    <QueryCard title="Finding acks" query={query}>
      {(data) => (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="acks" value={data.acksInWindow} />
            <StatTile label="categories" value={data.byCategory.length} />
          </div>
          <MiniCounts
            rows={data.byStatus.map((row) => ({
              label: row.status,
              value: row.count,
            }))}
          />
          <Warnings warnings={data.warnings} />
        </>
      )}
    </QueryCard>
  );
}

function QueryCard<T>({
  title,
  query,
  children,
}: {
  title: string;
  query: UseQueryResult<T, Error>;
  children(data: T): React.ReactNode;
}) {
  return (
    <article className="mk-card overflow-hidden">
      <header className="flex items-center justify-between border-b border-mk-current px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-mk-crest">{title}</h3>
        {query.isFetching ? <span className="mk-label text-mk-tide">refreshing</span> : null}
      </header>
      <div className="p-4">
        {query.isLoading ? (
          <div className="text-[12px] text-mk-tide">Running tool...</div>
        ) : query.isError ? (
          <div className="rounded-xs border border-mk-danger/40 bg-mk-abyss px-3 py-2 font-mono text-[11px] text-mk-danger">
            {query.error.message}
          </div>
        ) : query.data ? (
          children(query.data)
        ) : (
          <div className="text-[12px] text-mk-tide">No data.</div>
        )}
      </div>
    </article>
  );
}

function IssueCard({
  issue,
  featured,
}: {
  issue: ProjectIssue;
  featured?: boolean;
}) {
  return (
    <div className={["rounded-xs border border-mk-current bg-mk-abyss px-3 py-3", featured ? "border-mk-signal-dim" : ""].join(" ")}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <StatusPill label={issue.queryKind} />
        <StatusPill label={issue.reasonCode} tone="warn" />
        {issue.trustState ? <StatusPill label={issue.trustState} tone={trustTone(issue.trustState)} /> : null}
      </div>
      <div className="text-[12px] leading-relaxed text-mk-crest">{issue.queryText}</div>
      <div className="mt-2 text-[11px] leading-relaxed text-mk-tide">{issue.reason}</div>
      {issue.stopWhen.length > 0 ? (
        <ul className="mt-2 space-y-1" role="list">
          {issue.stopWhen.slice(0, 3).map((item) => (
            <li key={item} className="font-mono text-[10.5px] text-mk-surface">
              - {item}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 font-mono text-[10.5px] text-mk-tide">
        {shortenId(issue.traceId)} · {formatDate(issue.createdAt)} · followups {issue.followupCount}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const valueColor =
    tone === "ok"
      ? "text-mk-ok"
      : tone === "warn"
        ? "text-mk-warn"
        : tone === "danger"
          ? "text-mk-danger"
          : "text-mk-crest";
  return (
    <div className="rounded-xs border border-mk-current bg-mk-abyss px-3 py-2">
      <div className="mk-label text-mk-tide">{label}</div>
      <div className={`mt-1 truncate font-mono text-[15px] ${valueColor}`} title={String(value)}>
        {value}
      </div>
    </div>
  );
}

function StatusPill({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const color =
    tone === "ok"
      ? "border-mk-ok/40 text-mk-ok"
      : tone === "warn"
        ? "border-mk-warn/40 text-mk-warn"
        : tone === "danger"
          ? "border-mk-danger/40 text-mk-danger"
          : "border-mk-current text-mk-tide";
  return (
    <span className={`rounded-xs border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${color}`}>
      {label}
    </span>
  );
}

function MiniCounts({ rows }: { rows: Array<{ label: string; value: number }> }) {
  if (rows.length === 0) {
    return <div className="mt-3 text-[12px] text-mk-tide">No counts in this window.</div>;
  }
  return (
    <div className="mt-3 divide-y divide-mk-current rounded-xs border border-mk-current bg-mk-abyss">
      {rows.slice(0, 6).map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="min-w-0 truncate font-mono text-[11px] text-mk-surface">{row.label}</span>
          <span className="font-mono text-[11px] text-mk-crest">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mt-3 rounded-xs border border-mk-warn/40 bg-mk-abyss px-3 py-2">
      {warnings.map((warning) => (
        <div key={warning} className="text-[11px] text-mk-warn">
          {warning}
        </div>
      ))}
    </div>
  );
}

function ErrorBanner({ error }: { error: unknown }) {
  return (
    <div className="mb-4 rounded-xs border border-mk-danger/40 bg-mk-depth px-3 py-2 font-mono text-[11px] text-mk-danger">
      {error instanceof Error ? error.message : safeJson(error)}
    </div>
  );
}

function trustTone(trustState: string): "default" | "ok" | "warn" | "danger" {
  if (trustState === "stable") return "ok";
  if (trustState === "contradicted" || trustState === "insufficient_evidence") return "danger";
  if (trustState === "changed" || trustState === "aging" || trustState === "stale") return "warn";
  return "default";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "none";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString();
}

function shortenId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function callTool<T>(name: string, input: Record<string, unknown>): Promise<T> {
  return post<T>(`/api/v1/tools/${encodeURIComponent(name)}`, input);
}
