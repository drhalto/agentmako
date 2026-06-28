/**
 * Flow — a force-directed view of which tools ran and which files they touched.
 *
 * Seeds from persisted history (`recall_tool_runs`) and overlays live activity
 * from the harness SSE stream for the chosen session, so the graph animates as
 * an agent works. File↔tool edges are reconstructed from the JSON the runs
 * carry (there's no normalized edge in the store) — see `lib/flow/extract-files`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [showOrigin, setShowOrigin] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
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

  // Label for the central origin core — the agent/session that invoked the
  // tools. Prefer the live session's title, falling back to the project name.
  const originLabel = useMemo(() => {
    if (liveOn && sessionId) {
      const s = sessions.find((x) => x.id === sessionId);
      if (s?.title) return s.title;
    }
    return selectedProject?.displayName ?? "agent";
  }, [liveOn, sessionId, sessions, selectedProject]);

  const graph = useMemo(
    () =>
      buildFlowGraph([...runInputs, ...liveInputs], {
        groupByDirectory,
        expandedDirs,
        maxFileNodes: 220,
        includeOrigin: showOrigin,
        originLabel,
      }),
    [runInputs, liveInputs, groupByDirectory, expandedDirs, showOrigin, originLabel],
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

  // Honest live indicator. We can't trust a session's stored `status` flag — the
  // harness sets it to "active" and never resets it to idle/closed — so a session
  // you closed hours ago still reads "active". Instead we judge liveness by real
  // event *recency*: only events timestamped within the last few seconds count as
  // live. Otherwise the drifting orbs are a *replay* of the recorded History
  // window, not an agent working now. A 2s tick lets "Live" decay back to
  // "Replay" once the events stop arriving.
  const [liveTick, setLiveTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setLiveTick((t) => (t + 1) % 1_000_000), 2000);
    return () => window.clearInterval(id);
  }, []);

  const lastEventAtMs = useMemo(() => {
    let max = 0;
    for (const e of stream.events) {
      const t = Date.parse(e.createdAt);
      if (Number.isFinite(t) && t > max) max = t;
    }
    return max;
  }, [stream.events]);

  const liveState = useMemo<{ word: string; tone: "live" | "replay"; title: string }>(() => {
    void liveTick; // re-evaluate periodically so liveness decays as events age
    const LIVE_WINDOW_MS = 25_000;
    const receivingLive =
      liveOn && !!sessionId && stream.status === "open" && lastEventAtMs > 0 && Date.now() - lastEventAtMs < LIVE_WINDOW_MS;
    if (receivingLive) {
      return { word: "Live", tone: "live", title: "An agent is working in this session right now — these are real-time events." };
    }
    if (liveOn && sessionId && (stream.status === "connecting" || stream.status === "reconnecting")) {
      return { word: "Sync", tone: "replay", title: "Connecting to the session stream…" };
    }
    return {
      word: "Replay",
      tone: "replay",
      title:
        liveOn && sessionId
          ? "No live agent activity. The drifting orbs replay the recorded History window — this flips to Live the moment an agent works in the watched session."
          : "The drifting orbs replay the recorded History window. Pick a session to watch for live agent activity.",
    };
  }, [liveOn, sessionId, stream.status, lastEventAtMs, liveTick]);

  return (
    <div className="mx-auto flex h-full max-w-[1480px] flex-col px-8 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[20px] tracking-tight text-mk-crest">Flow</h1>
          <span className="mk-label text-mk-tide">
            tools × files · {selectedProject?.displayName ?? "all projects"}
          </span>
        </div>
        <div className="relative flex items-center gap-3">
          <Metric value={graph.meta.toolCount} label="tools" dot="#93a8ff" />
          <Metric value={graph.meta.fileCount} label="files" dot="#7c87b8" />
          <Metric value={graph.meta.touchCount} label="touches" dot="#5fd0ff" />
          {graph.meta.hiddenFileCount > 0 ? (
            <Metric value={graph.meta.hiddenFileCount} label="hidden" dot="var(--color-mk-warn)" tone="warn" />
          ) : null}
          <button
            type="button"
            aria-label="How to read the flow"
            aria-expanded={showHelp}
            onClick={() => setShowHelp((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-mk-current text-[11px] text-mk-tide transition-colors hover:border-mk-signal-dim hover:text-mk-crest"
          >
            ?
          </button>
          {showHelp ? <HelpPopover onClose={() => setShowHelp(false)} /> : null}
        </div>
      </div>

      {!hasProject ? (
        <EmptyState>Select a project to see its tool activity.</EmptyState>
      ) : (
        <>
          {/* ---- controls ---- */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {/* --- the historical base picture --- */}
            <span className="mk-label text-mk-tide" title="Time range of past tool runs shown">
              History
            </span>
            <SegGroup
              value={windowKey}
              onChange={(v) => setWindowKey(v as WindowKey)}
              options={WINDOWS.map((w) => ({ value: w.key, label: w.label }))}
              ariaLabel="History time range"
            />
            <Select
              value={outcome}
              onChange={(v) => setOutcome(v as OutcomeFilter)}
              ariaLabel="Outcome filter"
              options={[
                { value: "all", label: "All outcomes" },
                { value: "success", label: "Success only" },
                { value: "failed", label: "Failed only" },
                { value: "error", label: "Errored only" },
              ]}
            />

            {/* --- how it's drawn --- */}
            <VDivider />
            <Toggle checked={groupByDirectory} onChange={setGroupByDirectory}>
              Group by folder
            </Toggle>
            <Toggle checked={showOrigin} onChange={setShowOrigin}>
              Agent core
            </Toggle>

            {/* --- live overlay: one dropdown, Off or a session to stream --- */}
            <div className="ml-auto flex items-center gap-2">
              <VDivider />
              <span className="flex items-center gap-1.5" title={liveState.title} aria-label={`Live status: ${liveState.word}`}>
                {liveState.tone === "live" ? (
                  <span className="mk-sonar" data-offline="false" aria-hidden />
                ) : (
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-mk-tide" aria-hidden />
                )}
                <span className={["mk-label", liveState.tone === "live" ? "text-mk-ok" : "text-mk-tide"].join(" ")}>
                  {liveState.word}
                </span>
              </span>
              <Select
                value={liveOn && sessionId ? sessionId : "__off"}
                onChange={(v) => {
                  if (v === "__off") {
                    setLiveOn(false);
                  } else {
                    setLiveOn(true);
                    setSessionId(v);
                  }
                }}
                ariaLabel="Live session to stream"
                options={[
                  { value: "__off", label: "Off" },
                  ...sessions.map((s) => ({
                    value: s.id,
                    label: `${s.title ?? "untitled"}${s.status === "active" ? " · active" : ""}`,
                  })),
                ]}
              />
            </div>
          </div>

          {/* ---- graph + details ---- */}
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-4">
            <div
              className="relative min-h-0 overflow-hidden rounded-md border border-[#1a2138]"
              style={{ background: "#05070f" }}
            >
              {runsQuery.isLoading ? (
                <StageScene>
                  <StagePulse />
                  <CenterNote>Reading tool runs…</CenterNote>
                </StageScene>
              ) : runsQuery.isError ? (
                <StageScene>
                  <CenterNote tone="danger">{(runsQuery.error as Error).message}</CenterNote>
                </StageScene>
              ) : graph.nodes.length === 0 ? (
                <StageScene>
                  <StagePulse />
                  <div className="relative z-10 flex max-w-[380px] flex-col items-center gap-2 text-center">
                    <p className="text-[13px] font-medium text-white/80">The reef is quiet</p>
                    <p className="text-[12px] leading-relaxed text-white/50">
                      No tool activity in this window. Run a search or let an agent work, then watch the
                      signals fire across the network.
                    </p>
                  </div>
                </StageScene>
              ) : (
                <ToolFileGraph graph={graph} selectedId={selectedLive?.id ?? null} onSelect={setSelected} />
              )}
              {graph.nodes.length > 0 && !runsQuery.isLoading ? <Legend /> : null}
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
  const kindLabel =
    node.kind === "origin" ? "Agent core" : node.kind === "tool" ? "Tool" : node.kind === "dir" ? "Directory" : "File";
  return (
    <>
      <header className="border-b border-mk-current px-4 py-3">
        <div className="mk-label text-mk-tide">{kindLabel}</div>
        <div className="mt-1 break-all font-mono text-[12px] text-mk-crest">{node.title}</div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mk-tide">
          <span>
            {node.runs} {node.kind === "tool" || node.kind === "origin" ? "calls" : "touches"}
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
          {node.kind === "origin" ? "Dispatches to" : node.kind === "tool" ? "Touched" : "Touched by"} ·{" "}
          {connections.length}
        </div>
        <ul className="space-y-0.5" role="list">
          {connections.map(({ other, weight, mutations }) => {
            const maxWeight = connections[0]?.weight ?? 1;
            const pct = Math.max(6, Math.round((weight / maxWeight) * 100));
            return (
              <li key={other.id}>
                <button
                  type="button"
                  onClick={() => onPickConnection(other)}
                  className="group relative flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-left transition-colors hover:bg-mk-ridge"
                >
                  {/* relative weight bar behind the row */}
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 rounded-md opacity-50 transition-opacity group-hover:opacity-80"
                    style={{
                      width: `${pct}%`,
                      background: mutations > 0
                        ? "color-mix(in oklch, var(--color-mk-warn) 16%, transparent)"
                        : "color-mix(in oklch, var(--color-mk-signal) 13%, transparent)",
                    }}
                    aria-hidden
                  />
                  <span
                    className="relative h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: other.kind === "tool" ? "var(--color-mk-signal)" : mutations > 0 ? "var(--color-mk-warn)" : "var(--color-mk-tide)" }}
                    aria-hidden
                  />
                  <span className="relative min-w-0 flex-1 truncate font-mono text-[11px] text-mk-surface">
                    {other.kind === "tool" ? other.label : other.title}
                  </span>
                  <span className="relative shrink-0 font-mono text-[10px] text-mk-tide">
                    ×{weight}
                    {mutations > 0 ? <span className="text-mk-warn"> ✎</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
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

/** Smoothly tween a displayed integer toward its target as data updates. */
function useCountUp(value: number, durationMs = 600): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    startRef.current = null;
    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const p = Math.min(1, (ts - startRef.current) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      const next = Math.round(from + (value - from) * eased);
      setDisplay(next);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return display;
}

function Metric({
  value,
  label,
  dot,
  tone,
}: {
  value: number;
  label: string;
  dot: string;
  tone?: "warn";
}) {
  const display = useCountUp(value);
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="h-1.5 w-1.5 self-center rounded-full" style={{ background: dot }} aria-hidden />
      <span className={["font-mono text-[13px] tabular-nums", tone === "warn" ? "text-mk-warn" : "text-mk-crest"].join(" ")}>
        {display.toLocaleString()}
      </span>
      <span className="mk-label text-mk-tide">{label}</span>
    </span>
  );
}

/** A dark stage backdrop for loading/empty states, matching the canvas. */
function StageScene({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center px-8"
      style={{ background: "radial-gradient(120% 90% at 50% 46%, #0c1226 0%, #04060d 78%)" }}
    >
      {children}
    </div>
  );
}

/** A slow breathing nucleus — the idle heartbeat of the reef. */
function StagePulse() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
      <span className="mk-breathe h-40 w-40 rounded-full" style={{ background: "radial-gradient(circle, rgba(147,168,255,0.22) 0%, rgba(147,168,255,0) 70%)" }} />
      <span className="mk-breathe absolute h-3 w-3 rounded-full bg-white/80 shadow-[0_0_18px_6px_rgba(147,168,255,0.55)]" style={{ animationDelay: "200ms" }} />
    </div>
  );
}

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
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={[
        "h-8 max-w-[200px] rounded-md border border-mk-current bg-mk-depth px-2 text-[12px] text-mk-crest focus:border-mk-signal-dim focus:outline-none",
        disabled ? "cursor-not-allowed opacity-40" : "",
      ].join(" ")}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** Thin vertical hairline that separates control groups. */
function VDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-mk-current" aria-hidden />;
}

/** Play/pause control for the live overlay — clearer than a labelled switch. */

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
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1.5 rounded-lg border border-white/10 bg-[#0a1024]/70 px-3 py-2.5 text-[10px] text-white/65 shadow-[0_8px_30px_-10px_rgba(0,0,0,0.8)] backdrop-blur-md">
      <LegendRow
        swatch={
          <span
            className="h-3 w-3 rounded-full border border-[#9fb0ff]"
            style={{ background: "radial-gradient(circle at 35% 30%, #fff, #9fb0ff)", boxShadow: "0 0 8px 2px rgba(147,168,255,0.9)" }}
          />
        }
      >
        agent core
      </LegendRow>
      <LegendRow swatch={<span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_7px_2px_rgba(147,168,255,0.85)]" />}>
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
      <LegendRow swatch={<PulseSwatch color="#5fd0ff" />}>read pulse →</LegendRow>
      <LegendRow swatch={<PulseSwatch color="#ffb24d" />}>write pulse →</LegendRow>
      <LegendRow swatch={<PingSwatch />}>live ping</LegendRow>
    </div>
  );
}

/** On-demand help — replaces the old wall of instructional text under the row. */
function HelpPopover({ onClose }: { onClose: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div
        role="dialog"
        aria-label="How to read the flow"
        className="mk-card absolute right-0 top-full z-30 mt-2 w-[280px] p-3 text-[11.5px] leading-relaxed text-mk-surface shadow-lg"
      >
        <div className="mb-1.5 mk-label text-mk-tide">Reading the flow</div>
        <ul className="space-y-1">
          <li>
            <b className="text-mk-crest">Agent core</b> → <b className="text-mk-crest">tools</b> →{" "}
            <b className="text-mk-crest">files</b>
          </li>
          <li>
            <span style={{ color: "#5fd0ff" }}>cyan</span> reads · <span style={{ color: "#ffb24d" }}>amber</span>{" "}
            writes
          </li>
          <li>
            Orbs <b className="text-mk-crest">replay</b> your History window; the badge reads{" "}
            <b className="text-mk-crest">Live</b> only during real-time agent activity.
          </li>
        </ul>
        <div className="my-2 mk-rule" />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mk-tide">
          <span>
            Click <span className="text-mk-surface">isolate</span>
          </span>
          <span>
            Scroll <span className="text-mk-surface">zoom</span>
          </span>
          <span>
            Drag <span className="text-mk-surface">pan</span>
          </span>
          <span>
            <kbd className="mk-kbd">F</kbd> fit
          </span>
          <span>
            <kbd className="mk-kbd">Esc</kbd> clear
          </span>
        </div>
      </div>
    </>
  );
}

function PingSwatch() {
  return (
    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
      <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-[#93a8ff]/60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#93a8ff]" />
    </span>
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
