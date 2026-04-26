import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { get, post } from "../lib/http";
import { safeJson } from "../lib/safe-json";
import { useSelectedProject } from "../hooks/useSelectedProject";

interface ToolDefinitionSummary {
  name: string;
  category: string;
  description: string;
  annotations: {
    readOnlyHint?: true;
    mutation?: true;
    advisoryOnly?: true;
    derivedOnly?: true;
  };
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  searchHint?: string;
  alwaysLoad?: boolean;
}

type CategoryFilter = "all" | string;

export function ToolsPage() {
  const { selectedProject, selectedProjectId } = useSelectedProject();
  const [queryText, setQueryText] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [inputText, setInputText] = useState("{}");
  const [inputError, setInputError] = useState<string | null>(null);

  const tools = useQuery({
    queryKey: ["tools"],
    queryFn: () => get<ToolDefinitionSummary[]>("/api/v1/tools"),
  });

  const categories = useMemo(() => {
    const values = new Set((tools.data ?? []).map((tool) => tool.category));
    return ["all", ...Array.from(values).sort()];
  }, [tools.data]);

  const filtered = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    return (tools.data ?? []).filter((tool) => {
      const matchesCategory = category === "all" || tool.category === category;
      if (!matchesCategory) return false;
      if (needle.length === 0) return true;
      return (
        tool.name.toLowerCase().includes(needle) ||
        tool.category.toLowerCase().includes(needle) ||
        tool.description.toLowerCase().includes(needle) ||
        (tool.searchHint?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [tools.data, queryText, category]);

  const selectedTool = useMemo(() => {
    const list = tools.data ?? [];
    return list.find((tool) => tool.name === selectedName) ?? filtered[0] ?? list[0] ?? null;
  }, [tools.data, selectedName, filtered]);

  useEffect(() => {
    if (!selectedTool) return;
    if (selectedName !== selectedTool.name) {
      setSelectedName(selectedTool.name);
    }
  }, [selectedTool, selectedName]);

  useEffect(() => {
    if (!selectedTool) return;
    setInputText(safeJson(defaultInputFor(selectedTool.name, selectedProjectId)));
    setInputError(null);
  }, [selectedTool, selectedProjectId]);

  const runTool = useMutation({
    mutationFn: (input: { name: string; body: Record<string, unknown> }) =>
      post<unknown>(`/api/v1/tools/${encodeURIComponent(input.name)}`, input.body),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTool) return;
    setInputError(null);

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(inputText) as unknown;
      if (!isRecord(parsed)) throw new Error("Tool input must be a JSON object.");
      body = parsed;
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Invalid JSON.");
      return;
    }

    if (selectedProjectId && body.projectId == null && body.projectRef == null) {
      body = { ...body, projectId: selectedProjectId };
    }
    runTool.mutate({ name: selectedTool.name, body });
  };

  return (
    <div className="mx-auto max-w-[1320px] px-8 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[20px] text-mk-crest">Tools</h1>
          <span className="mk-label text-mk-tide">
            {tools.data?.length ?? 0} registered · scope {selectedProject?.displayName ?? "all projects"}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Search tools..."
              className="block h-9 min-w-0 flex-1 rounded-md border border-mk-current bg-mk-depth px-3 text-[13px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
            />
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-9 w-[132px] rounded-md border border-mk-current bg-mk-depth px-2 text-[12px] text-mk-crest focus:border-mk-signal-dim focus:outline-none"
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="mk-card max-h-[calc(100vh-190px)] overflow-y-auto">
            {tools.isLoading ? (
              <div className="px-4 py-8 text-center text-[12px] text-mk-tide">Reading tools...</div>
            ) : tools.isError ? (
              <div className="px-4 py-3 font-mono text-[11px] text-mk-danger">
                {(tools.error as Error).message}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-mk-tide">No tools match.</div>
            ) : (
              <ul className="divide-y divide-mk-current" role="list">
                {filtered.map((tool) => (
                  <li key={tool.name}>
                    <button
                      type="button"
                      onClick={() => setSelectedName(tool.name)}
                      className={[
                        "block w-full px-3 py-2.5 text-left transition-colors",
                        selectedTool?.name === tool.name ? "bg-mk-ridge" : "hover:bg-mk-ridge/70",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <StatusPill label={tool.category} />
                        {tool.annotations.mutation ? <StatusPill label="mutation" tone="warn" /> : null}
                      </div>
                      <div className="mt-1 truncate font-mono text-[12px] text-mk-crest">
                        {tool.name}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-mk-tide">
                        {tool.description}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <main className="space-y-6">
          {selectedTool ? (
            <>
              <ToolHeader tool={selectedTool} />
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                <form onSubmit={submit} className="mk-card overflow-hidden">
                  <header className="flex items-center justify-between border-b border-mk-current px-4 py-2.5">
                    <h3 className="text-[13px] font-medium text-mk-crest">Run</h3>
                    {selectedProjectId ? (
                      <span className="mk-label text-mk-tide">project injected if missing</span>
                    ) : (
                      <span className="mk-label text-mk-warn">no project selected</span>
                    )}
                  </header>
                  <div className="space-y-3 p-4">
                    <textarea
                      value={inputText}
                      onChange={(event) => setInputText(event.target.value)}
                      spellCheck={false}
                      rows={18}
                      className="block w-full resize-y rounded-md border border-mk-current bg-mk-abyss px-3 py-2 font-mono text-[11px] leading-relaxed text-mk-crest focus:border-mk-signal-dim focus:outline-none"
                    />
                    {inputError ? (
                      <div className="rounded-xs border border-mk-danger/40 bg-mk-abyss px-3 py-2 font-mono text-[11px] text-mk-danger">
                        {inputError}
                      </div>
                    ) : null}
                    <button
                      type="submit"
                      disabled={runTool.isPending}
                      className="h-9 rounded-md bg-mk-crest px-3 text-[12px] font-medium text-mk-abyss transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {runTool.isPending ? "Running..." : "Run tool"}
                    </button>
                  </div>
                </form>

                <section className="space-y-6">
                  <SchemaCard title="Input schema" schema={selectedTool.inputSchema} />
                  <SchemaCard title="Output schema" schema={selectedTool.outputSchema} />
                </section>
              </div>

              {runTool.isError ? (
                <div className="rounded-xs border border-mk-danger/40 bg-mk-depth px-3 py-2 font-mono text-[11px] text-mk-danger">
                  {(runTool.error as Error).message}
                </div>
              ) : runTool.isSuccess ? (
                <ResultCard value={runTool.data} />
              ) : null}
            </>
          ) : (
            <div className="mk-card px-6 py-12 text-center text-[12px] text-mk-tide">
              Select a tool to inspect its schema and run it.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ToolHeader({ tool }: { tool: ToolDefinitionSummary }) {
  return (
    <article className="mk-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusPill label={tool.category} />
        {tool.annotations.readOnlyHint ? <StatusPill label="read only" tone="ok" /> : null}
        {tool.annotations.mutation ? <StatusPill label="mutation" tone="warn" /> : null}
        {tool.annotations.advisoryOnly ? <StatusPill label="advisory" /> : null}
        {tool.alwaysLoad ? <StatusPill label="always load" /> : null}
      </div>
      <h2 className="font-mono text-[16px] text-mk-crest">{tool.name}</h2>
      <p className="mt-2 text-[12px] leading-relaxed text-mk-surface">{tool.description}</p>
      {tool.searchHint ? (
        <div className="mt-2 font-mono text-[10.5px] text-mk-tide">{tool.searchHint}</div>
      ) : null}
    </article>
  );
}

function SchemaCard({ title, schema }: { title: string; schema: Record<string, unknown> }) {
  return (
    <article className="mk-card overflow-hidden">
      <header className="border-b border-mk-current px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-mk-crest">{title}</h3>
      </header>
      <pre className="max-h-[360px] overflow-auto p-4 font-mono text-[10.5px] leading-relaxed text-mk-crest">
        {safeJson(schema)}
      </pre>
    </article>
  );
}

function ResultCard({ value }: { value: unknown }) {
  return (
    <article className="mk-card overflow-hidden">
      <header className="border-b border-mk-current px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-mk-crest">Result</h3>
      </header>
      <pre className="max-h-[620px] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-mk-crest">
        {safeJson(value)}
      </pre>
    </article>
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

function defaultInputFor(toolName: string, projectId: string | null): Record<string, unknown> {
  const project = projectId ? { projectId } : {};
  switch (toolName) {
    case "project_index_status":
      return { ...project, includeUnindexed: true };
    case "project_index_refresh":
      return { ...project, mode: "if_stale", reason: "manual run from tools page" };
    case "session_handoff":
    case "health_trend":
    case "issues_next":
      return { ...project, limit: 8 };
    case "runtime_telemetry_report":
    case "finding_acks_report":
    case "agent_feedback_report":
      return { ...project, limit: 25 };
    case "tenant_leak_audit":
      return { ...project, acknowledgeAdvisory: true };
    case "implementation_handoff_artifact":
      return {
        ...project,
        queryKind: "free_form",
        queryText: "Summarize the current implementation state and next steps.",
        sessionLimit: 8,
        followupLimit: 3,
      };
    case "verification_bundle_artifact":
      return {
        ...project,
        queryKind: "free_form",
        queryText: "Build a verification checklist for the current work.",
        includeSessionHandoff: true,
        includeIssuesNext: true,
        sessionLimit: 8,
        issuesLimit: 8,
      };
    case "ask":
    case "workflow_packet":
      return {
        ...project,
        queryKind: "free_form",
        queryText: "What should I inspect next?",
      };
    case "suggest":
    case "investigate":
      return {
        ...project,
        question: "What should I inspect next?",
        traversalDepth: 3,
        includeHeuristicEdges: true,
      };
    default:
      return project;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
