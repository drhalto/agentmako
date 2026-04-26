import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { post } from "../lib/http";
import { safeJson } from "../lib/safe-json";
import { useSelectedProject } from "../hooks/useSelectedProject";

type ArtifactToolName =
  | "implementation_handoff_artifact"
  | "verification_bundle_artifact"
  | "task_preflight_artifact"
  | "review_bundle_artifact";

type QueryKind =
  | "route_trace"
  | "schema_usage"
  | "auth_path"
  | "file_health"
  | "free_form"
  | "trace_file"
  | "preflight_table"
  | "cross_search"
  | "trace_edge"
  | "trace_error"
  | "trace_table"
  | "trace_rpc";

interface ArtifactToolOutput {
  toolName: ArtifactToolName;
  projectId: string;
  result: Artifact;
  exported?: { files: Array<{ format: string; path: string }> };
}

interface Artifact {
  artifactId: string;
  kind: string;
  projectId: string;
  title: string;
  generatedAt: string;
  basis: Array<{ basisRefId: string; kind: string; sourceId: string; label?: string }>;
  freshness: {
    state: "fresh" | "stale";
    staleBasisRefIds: string[];
    evaluatedAt: string;
  };
  consumerTargets: string[];
  payload: Record<string, unknown>;
  renderings: Array<{ format: "json" | "markdown" | "text"; body: string }>;
}

const QUERY_KINDS: QueryKind[] = [
  "free_form",
  "file_health",
  "route_trace",
  "schema_usage",
  "auth_path",
  "trace_file",
  "preflight_table",
  "cross_search",
  "trace_edge",
  "trace_error",
  "trace_table",
  "trace_rpc",
];

const ARTIFACT_TOOLS: ArtifactToolName[] = [
  "implementation_handoff_artifact",
  "verification_bundle_artifact",
  "task_preflight_artifact",
  "review_bundle_artifact",
];

export function ArtifactsPage() {
  const { selectedProject, selectedProjectId, isLoading } = useSelectedProject();
  const [queryKind, setQueryKind] = useState<QueryKind>("free_form");
  const [queryText, setQueryText] = useState("Summarize the current implementation state and what should happen next.");
  const [lastTool, setLastTool] = useState<ArtifactToolName | null>(null);
  const [advancedTool, setAdvancedTool] = useState<ArtifactToolName>("implementation_handoff_artifact");
  const [advancedText, setAdvancedText] = useState("");
  const [advancedError, setAdvancedError] = useState<string | null>(null);

  const defaultAdvancedText = useMemo(
    () => safeJson(defaultInputFor(advancedTool, selectedProjectId, queryKind, queryText)),
    [advancedTool, selectedProjectId, queryKind, queryText],
  );

  useEffect(() => {
    setAdvancedText(defaultAdvancedText);
  }, [defaultAdvancedText]);

  const generate = useMutation({
    mutationFn: (toolName: ArtifactToolName) => {
      setLastTool(toolName);
      return callArtifact(toolName, quickInputFor(toolName, selectedProjectId, queryKind, queryText));
    },
  });

  const runAdvanced = useMutation({
    mutationFn: (input: { toolName: ArtifactToolName; body: Record<string, unknown> }) => {
      setLastTool(input.toolName);
      return callArtifact(input.toolName, input.body);
    },
  });

  const submitAdvanced = (event: React.FormEvent) => {
    event.preventDefault();
    setAdvancedError(null);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(advancedText) as unknown;
      if (!isRecord(parsed)) throw new Error("Artifact input must be a JSON object.");
      body = parsed;
    } catch (error) {
      setAdvancedError(error instanceof Error ? error.message : "Invalid JSON.");
      return;
    }

    if (selectedProjectId && body.projectId == null && body.projectRef == null) {
      body = { ...body, projectId: selectedProjectId };
    }
    runAdvanced.mutate({ toolName: advancedTool, body });
  };

  const output = runAdvanced.data ?? generate.data ?? null;
  const pending = generate.isPending || runAdvanced.isPending;
  const error = generate.error ?? runAdvanced.error;

  return (
    <div className="mx-auto max-w-[1320px] px-8 py-8">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-[20px] text-mk-crest">Artifacts</h1>
        <span className="mk-label text-mk-tide">
          scope · {selectedProject?.displayName ?? "select one project"}
        </span>
      </div>

      {isLoading ? (
        <div className="mk-card px-6 py-12 text-center text-[12px] text-mk-tide">
          Reading projects...
        </div>
      ) : !selectedProjectId ? (
        <div className="mk-card px-6 py-12 text-center text-[12px] text-mk-tide">
          Choose a single project from the picker before generating artifacts.
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="space-y-6">
            <article className="mk-card overflow-hidden">
              <header className="border-b border-mk-current px-4 py-2.5">
                <h3 className="text-[13px] font-medium text-mk-crest">Quick generate</h3>
                <p className="mt-0.5 text-[11px] text-mk-tide">
                  Handoff and verification bundles work without graph entity locators.
                </p>
              </header>
              <div className="space-y-4 p-4">
                <label className="block">
                  <span className="mk-label mb-1 block text-mk-tide">query kind</span>
                  <select
                    value={queryKind}
                    onChange={(event) => setQueryKind(event.target.value as QueryKind)}
                    className="block h-9 w-full rounded-md border border-mk-current bg-mk-depth px-3 text-[13px] text-mk-crest focus:border-mk-signal-dim focus:outline-none"
                  >
                    {QUERY_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mk-label mb-1 block text-mk-tide">query text</span>
                  <textarea
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    rows={5}
                    className="block w-full resize-y rounded-md border border-mk-current bg-mk-depth px-3 py-2 font-mono text-[12px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
                  />
                </label>
                <div className="grid gap-2">
                  <ArtifactButton
                    title="Implementation handoff"
                    hint="current focus, key context, active risks, follow-ups"
                    loading={pending && lastTool === "implementation_handoff_artifact"}
                    disabled={pending || queryText.trim().length === 0}
                    onClick={() => generate.mutate("implementation_handoff_artifact")}
                  />
                  <ArtifactButton
                    title="Verification bundle"
                    hint="checks, stop conditions, issues_next, session_handoff"
                    loading={pending && lastTool === "verification_bundle_artifact"}
                    disabled={pending || queryText.trim().length === 0}
                    onClick={() => generate.mutate("verification_bundle_artifact")}
                    primary
                  />
                </div>
              </div>
            </article>

            <article className="mk-card overflow-hidden">
              <header className="border-b border-mk-current px-4 py-2.5">
                <h3 className="text-[13px] font-medium text-mk-crest">Advanced runner</h3>
                <p className="mt-0.5 text-[11px] text-mk-tide">
                  Use this for graph-backed preflight and review bundles.
                </p>
              </header>
              <form onSubmit={submitAdvanced} className="space-y-4 p-4">
                <label className="block">
                  <span className="mk-label mb-1 block text-mk-tide">tool</span>
                  <select
                    value={advancedTool}
                    onChange={(event) => setAdvancedTool(event.target.value as ArtifactToolName)}
                    className="block h-9 w-full rounded-md border border-mk-current bg-mk-depth px-3 text-[13px] text-mk-crest focus:border-mk-signal-dim focus:outline-none"
                  >
                    {ARTIFACT_TOOLS.map((tool) => (
                      <option key={tool} value={tool}>
                        {tool}
                      </option>
                    ))}
                  </select>
                </label>
                <textarea
                  value={advancedText}
                  onChange={(event) => setAdvancedText(event.target.value)}
                  rows={12}
                  spellCheck={false}
                  className="block w-full resize-y rounded-md border border-mk-current bg-mk-abyss px-3 py-2 font-mono text-[11px] leading-relaxed text-mk-crest focus:border-mk-signal-dim focus:outline-none"
                />
                {advancedError ? (
                  <div className="rounded-xs border border-mk-danger/40 bg-mk-abyss px-3 py-2 font-mono text-[11px] text-mk-danger">
                    {advancedError}
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={pending}
                  className="h-9 rounded-md bg-mk-crest px-3 text-[12px] font-medium text-mk-abyss transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {runAdvanced.isPending ? "Running..." : "Run artifact tool"}
                </button>
              </form>
            </article>
          </section>

          <section>
            {error ? (
              <div className="rounded-xs border border-mk-danger/40 bg-mk-depth px-3 py-2 font-mono text-[11px] text-mk-danger">
                {error instanceof Error ? error.message : safeJson(error)}
              </div>
            ) : output ? (
              <ArtifactResultView output={output} />
            ) : (
              <div className="mk-card px-6 py-12 text-center text-[12px] text-mk-tide">
                Generate an artifact to inspect its typed payload, freshness, basis refs, and rendering.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ArtifactButton({
  title,
  hint,
  loading,
  disabled,
  onClick,
  primary,
}: {
  title: string;
  hint: string;
  loading: boolean;
  disabled: boolean;
  onClick(): void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "block w-full rounded-xs border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        primary
          ? "border-mk-signal-dim bg-mk-depth text-mk-crest hover:bg-mk-ridge"
          : "border-mk-current bg-mk-abyss text-mk-crest hover:bg-mk-ridge",
      ].join(" ")}
    >
      <div className="text-[12px]">{loading ? `${title}...` : title}</div>
      <div className="mt-0.5 font-mono text-[10.5px] text-mk-tide">{hint}</div>
    </button>
  );
}

function ArtifactResultView({ output }: { output: ArtifactToolOutput }) {
  const artifact = output.result;
  const rendering =
    artifact.renderings.find((item) => item.format === "markdown") ??
    artifact.renderings.find((item) => item.format === "text") ??
    artifact.renderings[0] ??
    null;

  return (
    <article className="mk-card overflow-hidden">
      <header className="border-b border-mk-current px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={artifact.kind} />
          <StatusPill label={artifact.freshness.state} tone={artifact.freshness.state === "fresh" ? "ok" : "warn"} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-mk-crest">
            {artifact.title}
          </span>
        </div>
        <div className="mt-2 font-mono text-[10.5px] text-mk-tide">
          {shortenId(artifact.artifactId)} · generated {formatDate(artifact.generatedAt)} · basis {artifact.basis.length}
        </div>
      </header>

      <div className="grid border-b border-mk-current md:grid-cols-4">
        <MetaCell label="tool" value={output.toolName} />
        <MetaCell label="targets" value={artifact.consumerTargets.join(", ")} />
        <MetaCell label="stale refs" value={artifact.freshness.staleBasisRefIds.length} />
        <MetaCell label="renderings" value={artifact.renderings.map((item) => item.format).join(", ")} />
      </div>

      <div className="grid gap-6 p-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <PayloadSummary payload={artifact.payload} />
          {rendering ? (
            <section>
              <div className="mk-label mb-2 text-mk-tide">rendering · {rendering.format}</div>
              <pre className="max-h-[520px] overflow-auto rounded-xs border border-mk-current bg-mk-abyss p-3 font-mono text-[11px] leading-relaxed text-mk-crest">
                {rendering.body}
              </pre>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <section>
            <div className="mk-label mb-2 text-mk-tide">basis</div>
            <ul className="divide-y divide-mk-current rounded-xs border border-mk-current bg-mk-abyss" role="list">
              {artifact.basis.slice(0, 8).map((basis) => (
                <li key={basis.basisRefId} className="px-3 py-2">
                  <div className="font-mono text-[11px] text-mk-surface">{basis.kind}</div>
                  <div className="mt-0.5 truncate text-[11px] text-mk-tide" title={basis.label ?? basis.sourceId}>
                    {basis.label ?? basis.sourceId}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {output.exported?.files.length ? (
            <section>
              <div className="mk-label mb-2 text-mk-tide">exports</div>
              <ul className="space-y-2" role="list">
                {output.exported.files.map((file) => (
                  <li key={`${file.format}:${file.path}`} className="rounded-xs border border-mk-current bg-mk-abyss px-3 py-2">
                    <div className="font-mono text-[11px] text-mk-surface">{file.format}</div>
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-mk-tide" title={file.path}>
                      {file.path}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <details className="rounded-xs border border-mk-current bg-mk-abyss">
            <summary className="cursor-pointer px-3 py-2 font-mono text-[11px] text-mk-tide">
              raw output
            </summary>
            <pre className="max-h-[420px] overflow-auto border-t border-mk-current p-3 font-mono text-[10.5px] leading-relaxed text-mk-crest">
              {safeJson(output)}
            </pre>
          </details>
        </aside>
      </div>
    </article>
  );
}

function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const summary = typeof payload.summary === "string" ? payload.summary : null;
  const sections = [
    "keyContext",
    "activeRisks",
    "followUps",
    "priorFollowups",
    "baselineChecks",
    "requiredChecks",
    "stopConditions",
    "changeManagementChecks",
    "directOperatorFindings",
    "weakOperatorSignals",
  ];

  return (
    <section className="rounded-xs border border-mk-current bg-mk-abyss p-3">
      <div className="mk-label mb-2 text-mk-tide">payload</div>
      {summary ? <p className="text-[12px] leading-relaxed text-mk-crest">{summary}</p> : null}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {sections.map((key) => {
          const value = payload[key];
          if (!Array.isArray(value)) return null;
          return (
            <div key={key} className="rounded-xs border border-mk-current bg-mk-depth px-3 py-2">
              <div className="mk-label text-mk-tide">{key}</div>
              <div className="mt-1 font-mono text-[15px] text-mk-crest">{value.length}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MetaCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-b border-mk-current px-4 py-3 md:border-b-0 md:border-r md:last:border-r-0">
      <div className="mk-label text-mk-tide">{label}</div>
      <div className="mt-1 truncate font-mono text-[11px] text-mk-crest" title={String(value)}>
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

function defaultInputFor(
  toolName: ArtifactToolName,
  projectId: string | null,
  queryKind: QueryKind,
  queryText: string,
): Record<string, unknown> {
  return quickInputFor(toolName, projectId, queryKind, queryText);
}

function quickInputFor(
  toolName: ArtifactToolName,
  projectId: string | null,
  queryKind: QueryKind,
  queryText: string,
): Record<string, unknown> {
  const base = {
    ...(projectId ? { projectId } : {}),
    queryKind,
    queryText,
  };

  if (toolName === "implementation_handoff_artifact") {
    return {
      ...base,
      sessionLimit: 8,
      followupLimit: 3,
    };
  }
  if (toolName === "verification_bundle_artifact") {
    return {
      ...base,
      includeSessionHandoff: true,
      includeIssuesNext: true,
      sessionLimit: 8,
      issuesLimit: 8,
    };
  }
  return {
    ...base,
    startEntity: { kind: "file", id: "src/index.ts" },
    targetEntity: { kind: "file", id: "src/index.ts" },
    traversalDepth: 3,
    includeHeuristicEdges: true,
  };
}

function callArtifact(toolName: ArtifactToolName, body: Record<string, unknown>): Promise<ArtifactToolOutput> {
  return post<ArtifactToolOutput>(`/api/v1/tools/${encodeURIComponent(toolName)}`, body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString();
}

function shortenId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}
