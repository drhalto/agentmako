/**
 * Flow — a force-directed view of which tools ran and which files they touched.
 *
 * Seeds from persisted history (`recall_tool_runs`) and overlays live activity
 * from the harness SSE stream for the chosen session, so the graph animates as
 * an agent works. File↔tool edges are reconstructed from the JSON the runs
 * carry (there's no normalized edge in the store) — see `lib/flow/extract-files`.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "../lib/http";
import { useSelectedProject } from "../hooks/useSelectedProject";
import { useHarnessStream } from "../hooks/useHarnessStream";
import type { SessionSummary } from "../api-types";
import { ToolFileGraph } from "../components/flow/ToolFileGraph";
import {
  buildFlowGraph,
  liveEventsToFlowInputs,
  runToFlowInput,
  type FlowNode,
  type FlowRunInput,
} from "../lib/flow/graph-model";

interface RecalledRun {
  runId: string;
  toolName: string;
  inputSummary: unknown;
  outputSummary?: unknown;
  payload?: unknown;
  outcome: "success" | "failed" | "error";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

interface RecallToolRunsOutput {
  toolName: "recall_tool_runs";
  projectId: string;
  matchCount: number;
  truncated: boolean;
  toolRuns: RecalledRun[];
  warnings: string[];
}

type OutcomeFilter = "all" | "success" | "failed" | "error";

const WINDOWS = [
  { key: "1h", label: "1h", ms: 60 * 60 * 1000 },
  { key: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All", ms: null },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];

const EPOCH = "1970-01-01T00:00:00.000Z";

export function FlowPage() {
  const { selectedProject, selectedProjectId } = useSelectedProject();
  const hasProject = selectedProjectId !== null;

  const [windowKey, setWindowKey] = useState<WindowKey>("7d");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [groupByDirectory, setGroupByDirectory] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [liveOn, setLiveOn] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<FlowNode | null>(null);

  const since = useMemo(() => {
    const win = WINDOWS.find((w) => w.key === windowKey)!;
    return win.ms === null ? EPOCH : new Date(Date.now() - win.ms).toISOString();
  }, [windowKey]);

  // --- historical runs ------------------------------------------------------
  const runsQuery = useQuery({
    queryKey: ["flow-runs", selectedProjectId, since, outcome],
    enabled: hasProject,
    refetchInterval: 8000,
    // Keep the current graph on screen while a window/outcome change refetches,
    // so the canvas never flashes back to a loading note.
    placeholderData: (prev) => prev,
    queryFn: () =>
      post<RecallToolRunsOutput>("/api/v1/tools/recall_tool_runs", {
        projectId: selectedProjectId,
        limit: 500,
        includePayload: true,
        since,
        ...(outcome === "all" ? {} : { outcome }),
      }),
  });

  // --- sessions (for the live picker) --------------------------------------
  const sessionsQuery = useQuery({
    queryKey: ["flow-sessions", selectedProjectId],
    enabled: hasProject,
    refetchInterval: 10000,
    queryFn: () =>
      get<{ sessions: SessionSummary[] }>(
        `/api/v1/sessions?project_id=${encodeURIComponent(selectedProjectId!)}`,
      ),
  });

  const sessions = useMemo(() => sessionsQuery.data?.sessions ?? [], [sessionsQuery.data]);

  // Auto-pick the freshest session once, when none is chosen yet.
  useEffect(() => {
    if (sessionId || sessions.length === 0) return;
    const ranked = [...sessions].sort((a, b) => {
      const aActive = a.status === "active" ? 1 : 0;
      const bActive = b.status === "active" ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });
    setSessionId(ranked[0]?.id ?? null);
  }, [sessions, sessionId]);

  const stream = useHarnessStream({ sessionId: liveOn ? sessionId : null });

  // --- build the graph ------------------------------------------------------
  const runInputs = useMemo<FlowRunInput[]>(() => {
    const runs = runsQuery.data?.toolRuns ?? [];
    return runs.map((r) => runToFlowInput(r));
  }, [runsQuery.data]);

  const liveInputs = useMemo<FlowRunInput[]>(
    () => (liveOn ? liveEventsToFlowInputs(stream.events) : []),
    [stream.events, liveOn],
  );

  const graph = useMemo(
    () =>
      buildFlowGraph([...runInputs, ...liveInputs], {
        groupByDirectory,
        expandedDirs,
        maxFileNodes: 220,
      }),
    [runInputs, liveInputs, groupByDirectory, expandedDirs],
  );

  // Keep the selection's stats fresh as the graph updates.
  const selectedLive = useMemo(
    () => (selected ? graph.nodes.find((n) => n.id === selected.id) ?? null : null),
    [selected, graph.nodes],
  );

  const connections = useMemo(() => {
    if (!selectedLive) return [];
    return graph.edges
      .filter((e) => e.source === selectedLive.id || e.target === selectedLive.id)
      .map((e) => {
        const otherId = e.source === selectedLive.id ? e.target : e.source;
        const other = graph.nodes.find((n) => n.id === otherId);
        return { other, weight: e.weight, mutations: e.mutations };
      })
      .filter((c): c is { other: FlowNode; weight: number; mutations: number } => Boolean(c.other))
      .sort((a, b) => b.weight - a.weight);
  }, [selectedLive, graph]);

  const toggleDir = (dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const liveStatusLabel =
    !liveOn ? "paused" : !sessionId ? "no session" : stream.status === "open" ? "live" : stream.status;

  return (
    <div className="mx-auto flex h-full max-w-[1480px] flex-col px-8 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[20px] text-mk-crest">Flow</h1>
          <span className="mk-label text-mk-tide">
            tools × files · {selectedProject?.displayName ?? "all projects"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="mk-label text-mk-tide">{graph.meta.toolCount} tools</span>
          <span className="text-mk-current">·</span>
          <span className="mk-label text-mk-tide">{graph.meta.fileCount} files</span>
          <span className="text-mk-current">·</span>
          <span className="mk-label text-mk-tide">{graph.meta.touchCount} touches</span>
          {graph.meta.hiddenFileCount > 0 ? (
            <>
              <span className="text-mk-current">·</span>
              <span className="mk-label text-mk-warn">{graph.meta.hiddenFileCount} hidden</span>
            </>
          ) : null}
        </div>
      </div>

      {!hasProject ? (
        <EmptyState>Select a project to see its tool activity.</EmptyState>
      ) : (
        <>
          {/* ---- controls ---- */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SegGroup
              value={windowKey}
              onChange={(v) => setWindowKey(v as WindowKey)}
              options={WINDOWS.map((w) => ({ value: w.key, label: w.label }))}
              ariaLabel="Time window"
            />
            <Select
              value={outcome}
              onChange={(v) => setOutcome(v as OutcomeFilter)}
              ariaLabel="Outcome filter"
              options={[
                { value: "all", label: "All outcomes" },
                { value: "success", label: "Success" },
                { value: "failed", label: "Failed" },
                { value: "error", label: "Error" },
              ]}
            />
            <Toggle checked={groupByDirectory} onChange={setGroupByDirectory}>
              Group by folder
            </Toggle>

            <div className="ml-auto flex items-center gap-2">
              <span className="flex items-center gap-1.5">
                <span
                  className="mk-sonar"
                  data-offline={liveStatusLabel === "live" ? "false" : "true"}
                  aria-hidden
                />
                <span className="mk-label text-mk-tide">{liveStatusLabel}</span>
              </span>
              <Select
                value={sessionId ?? ""}
                onChange={(v) => setSessionId(v || null)}
                ariaLabel="Live session"
                options={[
                  { value: "", label: "No live session" },
                  ...sessions.map((s) => ({
                    value: s.id,
                    label: `${s.title ?? "untitled"}${s.status === "active" ? " ·active" : ""}`,
                  })),
                ]}
              />
              <Toggle checked={liveOn} onChange={setLiveOn}>
                Live
              </Toggle>
            </div>
          </div>

          <p className="mb-3 text-[11.5px] leading-relaxed text-mk-tide">
            A bright core <b className="text-mk-surface">tool</b> fires signals to the files it touches —{" "}
            <span style={{ color: "#36b6e6" }}>cyan pulses read</span>,{" "}
            <span style={{ color: "#d8901f" }}>amber pulses write</span>. Files cluster into colored{" "}
            <b className="text-mk-surface">folder</b> lobes. Click a node to isolate its circuit; scroll to zoom,
            drag to pan.
          </p>

          {/* ---- graph + details ---- */}
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-4">
            <div
              className="relative min-h-0 overflow-hidden rounded-md border border-[#1a2138]"
              style={{ background: "#05070f" }}
            >
              {runsQuery.isLoading ? (
                <CenterNote>Reading tool runs…</CenterNote>
              ) : runsQuery.isError ? (
                <CenterNote tone="danger">{(runsQuery.error as Error).message}</CenterNote>
              ) : graph.nodes.length === 0 ? (
                <CenterNote>
                  No tool activity in this window. Run a search or let an agent work, then watch the
                  signals fire.
                </CenterNote>
              ) : (
                <ToolFileGraph graph={graph} selectedId={selectedLive?.id ?? null} onSelect={setSelected} />
              )}
              <Legend />
            </div>

            <aside className="mk-card flex min-h-0 flex-col overflow-hidden">
              {selectedLive ? (
                <DetailsPanel
                  node={selectedLive}
                  connections={connections}
                  expanded={selectedLive.dir ? expandedDirs.has(selectedLive.dir) : false}
                  onToggleDir={selectedLive.kind === "dir" && selectedLive.dir ? () => toggleDir(selectedLive.dir!) : undefined}
                  onPickConnection={(n) => setSelected(n)}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center">
                  <span className="mk-label text-mk-tide">Details</span>
                  <p className="text-[12px] leading-relaxed text-mk-tide">
                    Click a node to see what it touched. Scroll to zoom, drag to pan.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// Details
// =============================================================================

function DetailsPanel({
  node,
  connections,
  expanded,
  onToggleDir,
  onPickConnection,
}: {
  node: FlowNode;
  connections: Array<{ other: FlowNode; weight: number; mutations: number }>;
  expanded: boolean;
  onToggleDir?: () => void;
  onPickConnection: (node: FlowNode) => void;
}) {
  const kindLabel = node.kind === "tool" ? "Tool" : node.kind === "dir" ? "Directory" : "File";
  return (
    <>
      <header className="border-b border-mk-current px-4 py-3">
        <div className="mk-label text-mk-tide">{kindLabel}</div>
        <div className="mt-1 break-all font-mono text-[12px] text-mk-crest">{node.title}</div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mk-tide">
          <span>
            {node.runs} {node.kind === "tool" ? "calls" : "touches"}
          </span>
          {node.errors > 0 ? <span className="text-mk-danger">{node.errors} failed</span> : null}
          {node.kind === "dir" && node.fileCount ? <span>{node.fileCount} files</span> : null}
          {node.lastActivityMs > 0 ? <span>last {relativeTime(node.lastActivityMs)}</span> : null}
        </div>
        {onToggleDir ? (
          <button
            type="button"
            onClick={onToggleDir}
            className="mt-2.5 h-7 rounded-md border border-mk-current bg-mk-abyss px-2.5 text-[11px] text-mk-surface transition-colors hover:bg-mk-ridge hover:text-mk-crest"
          >
            {expanded ? "Collapse folder" : "Expand folder"}
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="px-2 pb-1 mk-label text-mk-tide">
          {node.kind === "tool" ? "Touched" : "Touched by"} · {connections.length}
        </div>
        <ul className="space-y-0.5" role="list">
          {connections.map(({ other, weight, mutations }) => (
            <li key={other.id}>
              <button
                type="button"
                onClick={() => onPickConnection(other)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-mk-ridge"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: other.kind === "tool" ? "var(--color-mk-signal)" : mutations > 0 ? "var(--color-mk-warn)" : "var(--color-mk-tide)" }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mk-surface">
                  {other.kind === "tool" ? other.label : other.title}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-mk-tide">
                  ×{weight}
                  {mutations > 0 ? <span className="text-mk-warn"> ✎</span> : null}
                </span>
              </button>
            </li>
          ))}
          {connections.length === 0 ? (
            <li className="px-2 py-2 text-[11px] text-mk-tide">No file edges in this window.</li>
          ) : null}
        </ul>
      </div>
    </>
  );
}

// =============================================================================
// Small UI atoms (page-local, matching the other pages' inline-helper pattern)
// =============================================================================

function SegGroup({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex overflow-hidden rounded-md border border-mk-current">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={[
            "h-8 px-2.5 text-[12px] transition-colors",
            i > 0 ? "border-l border-mk-current" : "",
            value === opt.value ? "bg-mk-ridge text-mk-crest" : "bg-mk-depth text-mk-tide hover:text-mk-crest",
          ].join(" ")}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 max-w-[200px] rounded-md border border-mk-current bg-mk-depth px-2 text-[12px] text-mk-crest focus:border-mk-signal-dim focus:outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "flex h-8 items-center gap-2 rounded-md border px-2.5 text-[12px] transition-colors",
        checked
          ? "border-mk-signal-dim bg-mk-signal/10 text-mk-crest"
          : "border-mk-current bg-mk-depth text-mk-tide hover:text-mk-crest",
      ].join(" ")}
    >
      <span
        className={["inline-block h-2 w-2 rounded-full", checked ? "bg-mk-signal" : "bg-mk-tide"].join(" ")}
        aria-hidden
      />
      {children}
    </button>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1.5 rounded-md border border-white/10 bg-[#0c1226]/85 px-3 py-2.5 text-[10px] text-white/65 backdrop-blur">
      <LegendRow swatch={<span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_6px_2px_rgba(138,166,255,0.8)]" />}>
        tool nucleus
      </LegendRow>
      <LegendRow
        swatch={
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: "hsl(265,55%,58%)", boxShadow: "0 0 6px 1px hsla(265,75%,65%,0.7)" }}
          />
        }
      >
        folder lobe
      </LegendRow>
      <LegendRow swatch={<PulseSwatch color="#7fe7ff" />}>read pulse →</LegendRow>
      <LegendRow swatch={<PulseSwatch color="#ffc16b" />}>write pulse →</LegendRow>
    </div>
  );
}

function PulseSwatch({ color }: { color: string }) {
  return (
    <span className="flex items-center gap-[3px]">
      <span className="h-[2px] w-2 rounded-full" style={{ background: color, opacity: 0.4 }} />
      <span
        className="h-1.5 w-1.5 rounded-full bg-white"
        style={{ boxShadow: `0 0 5px 1.5px ${color}` }}
      />
    </span>
  );
}

function LegendRow({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex h-2.5 w-3.5 items-center justify-center" aria-hidden>
        {swatch}
      </span>
      {children}
    </span>
  );
}

function CenterNote({ children, tone }: { children: React.ReactNode; tone?: "danger" }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center px-8 text-center">
      <p className={["max-w-[360px] text-[12px] leading-relaxed", tone === "danger" ? "font-mono text-[#ff8b8b]" : "text-white/55"].join(" ")}>
        {children}
      </p>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk-card flex flex-1 items-center justify-center px-8 py-16 text-center">
      <p className="text-[12px] text-mk-tide">{children}</p>
    </div>
  );
}

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 0) return "just now";
  const sec = Math.round(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
