/**
 * Memory browser.
 *
 * Left rail: list of every memory (append-only). Right rail: two small
 * forms — `remember` (commit a new fact) and `recall` (semantic+FTS
 * hybrid search). The list auto-refreshes after a remember; recall is
 * its own controlled mutation.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/http";
import type { MemoryHit } from "../api-types";
import { useSelectedProject } from "../hooks/useSelectedProject";

interface MemoryListResponse {
  count: number;
  memories: Array<{
    id: string;
    text: string;
    category: string | null;
    tags: string[];
    createdAt: string;
  }>;
}

interface RecallResponse {
  mode: "hybrid" | "fts-fallback";
  reason?: string;
  results: MemoryHit[];
}

export function MemoryPage() {
  const qc = useQueryClient();
  const { selectedProject, selectedProjectId, selectProject } = useSelectedProject();
  const [scopeToProject, setScopeToProject] = useState(true);
  const effectiveProjectId = scopeToProject ? selectedProjectId : null;

  const list = useQuery({
    queryKey: ["memory-all", effectiveProjectId ?? "all"],
    queryFn: () =>
      get<MemoryListResponse>(
        effectiveProjectId
          ? `/api/v1/memory?limit=100&project_id=${encodeURIComponent(effectiveProjectId)}`
          : "/api/v1/memory?limit=100",
      ),
    refetchInterval: 20_000,
  });

  return (
    <div className="mx-auto max-w-[1100px] px-10 py-12">
      <div className="mk-label mb-2">Memory</div>
      <div className="mb-2 flex items-baseline gap-3">
        <h1 className="text-[22px] text-mk-crest">
          {list.data?.count ?? 0} <span className="text-mk-surface">stored</span>
        </h1>
        <span className="mk-label text-mk-tide">
          scope · {effectiveProjectId ? selectedProject?.displayName : "all projects"}
        </span>
        {selectedProjectId ? (
          <label className="flex items-center gap-2 font-mono text-[11px] text-mk-tide">
            <input
              type="checkbox"
              checked={scopeToProject}
              onChange={(e) => setScopeToProject(e.target.checked)}
              className="accent-mk-signal"
            />
            scope to selected project
          </label>
        ) : (
          <button
            type="button"
            onClick={() => selectProject(null)}
            className="font-mono text-[11px] uppercase tracking-[0.08em] text-mk-tide hover:text-mk-surface"
          >
            no project selected
          </button>
        )}
      </div>
      <p className="mb-8 max-w-[640px] text-[13px] text-mk-tide">
        Append-only. Every memory is FTS5-indexed; when an embedding provider is
        reachable it also goes through Ollama, LM Studio, or OpenAI for semantic
        recall. Remember and recall here reach the same harness tools the agent
        uses.
      </p>

      <div className="grid grid-cols-[1.3fr_1fr] gap-8">
        <section>
          <h2 className="mb-3 text-[13px] font-medium text-mk-crest">Stored</h2>
          <MemoryList data={list.data} isLoading={list.isLoading} />
        </section>

        <div className="space-y-6">
          <RememberCard
            projectId={effectiveProjectId}
            onSaved={() => qc.invalidateQueries({ queryKey: ["memory-all"] })}
          />
          <RecallCard projectId={effectiveProjectId} />
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function MemoryList({
  data,
  isLoading,
}: {
  data: MemoryListResponse | undefined;
  isLoading: boolean;
}) {
  if (isLoading && !data) {
    return <div className="text-[13px] text-mk-tide">Reading memory…</div>;
  }
  if (!data || data.memories.length === 0) {
    return (
      <div className="rounded-md border border-mk-current bg-mk-depth px-6 py-12 text-center">
        <div className="mk-wordmark text-[22px]">mako</div>
        <div className="mk-rule mx-auto mt-4 w-24" />
        <p className="mt-4 text-[12px] text-mk-tide">
          No memories yet. Remember one on the right, or let the agent write via{" "}
          <span className="font-mono">memory_remember</span>.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2" role="list">
      {data.memories.map((m) => (
        <li
          key={m.id}
          className="rounded-md border border-mk-current bg-mk-depth p-4 transition-colors hover:bg-mk-ridge"
        >
          <div className="mb-1 flex items-center gap-2">
            {m.category ? (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-mk-signal">
                {m.category}
              </span>
            ) : null}
            <span className="mk-label">{new Date(m.createdAt).toLocaleString()}</span>
          </div>
          <div className="text-[13px] leading-relaxed text-mk-crest">{m.text}</div>
          {m.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {m.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-xs border border-mk-current px-1.5 py-0.5 font-mono text-[10.5px] text-mk-surface"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// -----------------------------------------------------------------------------

function RememberCard({
  projectId,
  onSaved,
}: {
  projectId: string | null;
  onSaved(): void;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");

  const mutation = useMutation({
    mutationFn: (input: {
      text: string;
      category?: string;
      tags?: string[];
      project_id?: string;
    }) =>
      post<{ id: string; embedded: boolean; embeddingModel: string | null }>(
        "/api/v1/memory/remember",
        input,
      ),
    onSuccess: () => {
      setText("");
      setCategory("");
      setTags("");
      onSaved();
    },
  });

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    mutation.mutate({
      text: trimmed,
      category: category.trim() || undefined,
      tags: tagList.length > 0 ? tagList : undefined,
      project_id: projectId ?? undefined,
    });
  };

  return (
    <article className="rounded-md border border-mk-current bg-mk-depth">
      <header className="border-b border-mk-current px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-mk-crest">Remember</h3>
      </header>
      <div className="space-y-3 p-4">
        <FieldLabel>Memory</FieldLabel>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="A durable fact about this project."
          className="block w-full resize-none rounded-xs border border-mk-current bg-mk-abyss px-3 py-2 text-[13px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Category</FieldLabel>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="architecture"
              className="block h-8 w-full rounded-xs border border-mk-current bg-mk-abyss px-2 font-mono text-[12px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
            />
          </div>
          <div>
            <FieldLabel>Tags (comma-sep)</FieldLabel>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="postgres, audit"
              className="block h-8 w-full rounded-xs border border-mk-current bg-mk-abyss px-2 font-mono text-[12px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="mk-label">
            {mutation.isSuccess ? (
              <span className="text-mk-ok">
                saved{mutation.data?.embedded ? " · embedded" : " · fts only"}
              </span>
            ) : mutation.isError ? (
              <span className="text-mk-danger">
                {(mutation.error as Error).message}
              </span>
            ) : (
              <span>append-only · emitted as `memory_remember`</span>
            )}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={mutation.isPending || text.trim().length === 0}
            className="h-8 rounded-md bg-mk-crest px-3 text-[12px] font-medium text-mk-abyss transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Remember
          </button>
        </div>
      </div>
    </article>
  );
}

// -----------------------------------------------------------------------------

function RecallCard({ projectId }: { projectId: string | null }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const recall = useQuery({
    queryKey: ["memory-recall", submitted, projectId ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ q: submitted ?? "", k: "6" });
      if (projectId) params.set("project_id", projectId);
      return get<RecallResponse>(`/api/v1/memory/recall?${params.toString()}`);
    },
    enabled: submitted !== null && submitted.length > 0,
    staleTime: 0,
  });

  return (
    <article className="rounded-md border border-mk-current bg-mk-depth">
      <header className="border-b border-mk-current px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-mk-crest">Recall</h3>
      </header>
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim().length > 0) {
                setSubmitted(query.trim());
              }
            }}
            placeholder="audit logs"
            className="h-8 flex-1 rounded-xs border border-mk-current bg-mk-abyss px-2 font-mono text-[12px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
          />
          <button
            type="button"
            onClick={() => query.trim() && setSubmitted(query.trim())}
            disabled={query.trim().length === 0}
            className="h-8 rounded-xs border border-mk-current bg-mk-depth px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-mk-crest hover:bg-mk-ridge disabled:opacity-40"
          >
            search
          </button>
        </div>

        {recall.data ? (
          <div className="space-y-2">
            <div className="mk-label">
              mode · <span className={recall.data.mode === "hybrid" ? "text-mk-ok" : "text-mk-warn"}>{recall.data.mode}</span>
              {recall.data.reason ? (
                <span className="text-mk-tide"> — {recall.data.reason}</span>
              ) : null}
            </div>
            {recall.data.results.length === 0 ? (
              <div className="text-[12px] text-mk-tide">no hits</div>
            ) : (
              <ul className="space-y-2" role="list">
                {recall.data.results.map((h) => (
                  <li
                    key={h.memoryId}
                    className="rounded-xs border border-mk-current bg-mk-abyss px-3 py-2"
                  >
                    <div className="mb-1 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.06em] text-mk-tide">
                      <span>{h.category ?? "—"}</span>
                      <span>rrf {h.score.toFixed(3)}</span>
                    </div>
                    <div className="text-[12.5px] leading-relaxed text-mk-crest">
                      {h.text}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : submitted ? (
          <div className="text-[12px] text-mk-tide">searching…</div>
        ) : (
          <div className="text-[12px] text-mk-tide">
            FTS5 + vector cosine, rank-fused. Falls back to FTS only when no embedding
            provider is reachable.
          </div>
        )}
      </div>
    </article>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mk-label mb-1">{children}</div>;
}
