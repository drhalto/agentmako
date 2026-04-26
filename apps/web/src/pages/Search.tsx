/**
 * Semantic search surface — Phase 3.7 retrieval over the browser.
 *
 * Reaches the shipped harness routes directly: `GET /api/v1/semantic/search`
 * and `POST /api/v1/embeddings/reindex`. No new aggregation layer.
 *
 * Layout:
 *   left  : query box · kind chips · scope toggle · result list
 *   right : embeddings maintenance card (reindex memory / units / all)
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/http";
import { useSelectedProject } from "../hooks/useSelectedProject";

type SemanticKind = "code" | "doc" | "memory";
type ReindexKind = "memory" | "semantic-unit" | "all";

interface SemanticSearchHit {
  kind: SemanticKind;
  sourceRef: string;
  title: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  excerpt: string;
  score: number;
  ftsRank: number | null;
  vectorScore: number | null;
}

interface SemanticSearchResponse {
  mode: "hybrid" | "fts-fallback";
  reason?: string;
  results: SemanticSearchHit[];
}

interface ReindexResponse {
  providerId: string;
  modelId: string;
  scanned: number;
  embedded: number;
  skipped: number;
  failed: number;
  failures: Array<{
    ownerKind: "memory" | "semantic_unit";
    ownerId: string;
    error: string;
  }>;
}

const ALL_KINDS: SemanticKind[] = ["code", "doc", "memory"];

export function SearchPage() {
  const { selectedProject, selectedProjectId } = useSelectedProject();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [activeKinds, setActiveKinds] = useState<Set<SemanticKind>>(
    new Set(ALL_KINDS),
  );
  const [scopeToProject, setScopeToProject] = useState(true);

  const url = useMemo(() => {
    if (submitted === null || submitted.length === 0) return null;
    const params = new URLSearchParams();
    params.set("q", submitted);
    params.set("k", "20");
    for (const kind of activeKinds) params.append("kind", kind);
    if (scopeToProject && selectedProjectId) {
      params.set("project_id", selectedProjectId);
    }
    return `/api/v1/semantic/search?${params.toString()}`;
  }, [submitted, activeKinds, scopeToProject, selectedProjectId]);

  const search = useQuery({
    queryKey: ["semantic-search", url],
    queryFn: () => get<SemanticSearchResponse>(url!),
    enabled: url !== null,
    staleTime: 0,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    setSubmitted(trimmed);
  };

  const toggleKind = (kind: SemanticKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        if (next.size > 1) next.delete(kind);
      } else {
        next.add(kind);
      }
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-8">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-[20px] text-mk-crest">Semantic search</h1>
        <span className="mk-label text-mk-tide">
          scope · {selectedProject?.displayName ?? "all projects"}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ---- Left: query + results ----------------------------------- */}
        <section>
          <form onSubmit={submit} className="mb-4 flex items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code, docs, and memories…"
              aria-label="Semantic query"
              className="block h-10 flex-1 rounded-md border border-mk-current bg-mk-depth px-3 text-[14px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
            />
            <button
              type="submit"
              disabled={query.trim().length === 0 || search.isFetching}
              className="h-10 rounded-md bg-mk-crest px-4 text-[13px] font-medium text-mk-abyss transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {search.isFetching ? "Searching…" : "Search"}
            </button>
          </form>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="mk-label">Filters</div>
            {ALL_KINDS.map((kind) => {
              const active = activeKinds.has(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  data-kind={kind}
                  data-active={active}
                  onClick={() => toggleKind(kind)}
                  className={[
                    "h-7 rounded-xs border px-2 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors",
                    active
                      ? "border-mk-signal-dim bg-mk-depth text-mk-crest"
                      : "border-mk-current bg-mk-abyss text-mk-tide hover:text-mk-surface",
                  ].join(" ")}
                >
                  {kind}
                </button>
              );
            })}

            {selectedProjectId ? (
              <label className="ml-auto flex items-center gap-2 font-mono text-[11px] text-mk-tide">
                <input
                  type="checkbox"
                  checked={scopeToProject}
                  onChange={(e) => setScopeToProject(e.target.checked)}
                  className="accent-mk-signal"
                />
                scope to {selectedProject?.displayName}
              </label>
            ) : null}
          </div>

          <ResultsList query={search} submitted={submitted} />
        </section>

        {/* ---- Right: embeddings maintenance --------------------------- */}
        <aside>
          <ReindexCard projectId={scopeToProject ? selectedProjectId : null} />
        </aside>
      </div>
    </div>
  );
}

// =============================================================================
// Results
// =============================================================================

function ResultsList({
  query,
  submitted,
}: {
  query: ReturnType<typeof useQuery<SemanticSearchResponse, Error>>;
  submitted: string | null;
}) {
  if (submitted === null) {
    return (
      <div className="rounded-md border border-mk-current bg-mk-depth px-6 py-12 text-center text-[12px] text-mk-tide">
        Type a query and hit search. Hybrid retrieval combines FTS5 and vector
        cosine; FTS-only mode kicks in automatically when no embedding provider
        is reachable.
      </div>
    );
  }

  if (query.isLoading || query.isFetching) {
    return <div className="text-[12px] text-mk-tide">Searching…</div>;
  }

  if (query.isError) {
    return (
      <div className="rounded-md border border-mk-danger/40 bg-mk-depth px-4 py-3 font-mono text-[11px] text-mk-danger">
        {(query.error as Error).message}
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;

  return (
    <div>
      <ModeBanner mode={data.mode} reason={data.reason} count={data.results.length} />
      {data.results.length === 0 ? (
        <div className="rounded-md border border-mk-current bg-mk-depth px-6 py-10 text-center text-[12px] text-mk-tide">
          No hits.
        </div>
      ) : (
        <ul className="space-y-3" role="list" data-testid="search-results">
          {data.results.map((hit) => (
            <ResultCard key={hit.sourceRef} hit={hit} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ModeBanner({
  mode,
  reason,
  count,
}: {
  mode: "hybrid" | "fts-fallback";
  reason?: string;
  count: number;
}) {
  return (
    <div
      data-testid="search-mode-banner"
      className="mb-3 flex items-center gap-3 rounded-xs border border-mk-current bg-mk-depth px-3 py-2"
    >
      <span
        className={[
          "rounded-xs px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em]",
          mode === "hybrid"
            ? "border border-mk-signal-dim text-mk-signal"
            : "border border-mk-warn/40 text-mk-warn",
        ].join(" ")}
      >
        {mode}
      </span>
      <span className="mk-label">{count} hits</span>
      {reason ? (
        <span className="truncate font-mono text-[11px] text-mk-tide" title={reason}>
          — {reason}
        </span>
      ) : null}
    </div>
  );
}

function ResultCard({ hit }: { hit: SemanticSearchHit }) {
  return (
    <li className="rounded-md border border-mk-current bg-mk-depth p-4 transition-colors hover:bg-mk-ridge">
      <header className="mb-2 flex items-baseline gap-3">
        <span className="rounded-xs border border-mk-current px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-mk-signal">
          {hit.kind}
        </span>
        <div className="min-w-0 flex-1 truncate text-[13px] text-mk-crest">
          {hit.title || "(untitled)"}
        </div>
        <span className="font-mono text-[10.5px] text-mk-tide">
          rrf {hit.score.toFixed(3)}
        </span>
      </header>
      {hit.filePath ? (
        <div className="mb-2 truncate font-mono text-[11px] text-mk-surface">
          {hit.filePath}
          {hit.lineStart != null
            ? `:${hit.lineStart}${hit.lineEnd != null && hit.lineEnd !== hit.lineStart ? `–${hit.lineEnd}` : ""}`
            : ""}
        </div>
      ) : null}
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-mk-crest">
        {hit.excerpt}
      </pre>
      <footer className="mt-2 flex items-center gap-3 font-mono text-[10.5px] text-mk-tide">
        {hit.ftsRank != null ? <span>fts #{hit.ftsRank}</span> : null}
        {hit.vectorScore != null ? <span>vec {hit.vectorScore.toFixed(3)}</span> : null}
      </footer>
    </li>
  );
}

// =============================================================================
// Reindex card
// =============================================================================

function ReindexCard({ projectId }: { projectId: string | null }) {
  const qc = useQueryClient();
  const [lastKind, setLastKind] = useState<ReindexKind | null>(null);

  const reindex = useMutation({
    mutationFn: (kind: ReindexKind) => {
      setLastKind(kind);
      return post<ReindexResponse>("/api/v1/embeddings/reindex", {
        kind,
        project_id: projectId ?? undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["semantic-search"] });
    },
  });

  return (
    <article className="rounded-md border border-mk-current bg-mk-depth">
      <header className="border-b border-mk-current px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-mk-crest">Embeddings</h3>
        <p className="mt-0.5 text-[11px] text-mk-tide">
          Rebuild vectors under the active embedding model. Use after changing
          providers or pulling new docs.
        </p>
      </header>
      <div className="space-y-2 p-4">
        <ReindexButton
          label="Re-index semantic units"
          hint="symbol chunks + markdown headings"
          disabled={reindex.isPending}
          loading={reindex.isPending && lastKind === "semantic-unit"}
          onClick={() => reindex.mutate("semantic-unit")}
        />
        <ReindexButton
          label="Re-index memories"
          hint="harness_memories"
          disabled={reindex.isPending}
          loading={reindex.isPending && lastKind === "memory"}
          onClick={() => reindex.mutate("memory")}
        />
        <ReindexButton
          label="Re-index all"
          hint="memory + semantic units"
          disabled={reindex.isPending}
          loading={reindex.isPending && lastKind === "all"}
          onClick={() => reindex.mutate("all")}
          primary
        />

        {projectId ? (
          <div className="mt-3 mk-label text-mk-tide">
            scoped · project {shortenId(projectId)}
          </div>
        ) : (
          <div className="mt-3 mk-label text-mk-tide">scope · all projects</div>
        )}

        {reindex.isError ? (
          <div className="mt-3 rounded-xs border border-mk-danger/40 bg-mk-abyss px-3 py-2 font-mono text-[11px] text-mk-danger">
            {(reindex.error as Error).message}
          </div>
        ) : null}

        {reindex.isSuccess && reindex.data ? (
          <ReindexSummary data={reindex.data} />
        ) : null}
      </div>
    </article>
  );
}

function ReindexButton({
  label,
  hint,
  disabled,
  loading,
  onClick,
  primary,
}: {
  label: string;
  hint: string;
  disabled: boolean;
  loading: boolean;
  onClick(): void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "block w-full rounded-xs border px-3 py-2 text-left transition-colors disabled:opacity-40",
        primary
          ? "border-mk-signal-dim bg-mk-depth text-mk-crest hover:bg-mk-ridge"
          : "border-mk-current bg-mk-abyss text-mk-crest hover:bg-mk-ridge",
      ].join(" ")}
    >
      <div className="text-[12px]">{loading ? `${label}…` : label}</div>
      <div className="mt-0.5 font-mono text-[10.5px] text-mk-tide">{hint}</div>
    </button>
  );
}

function ReindexSummary({ data }: { data: ReindexResponse }) {
  return (
    <div className="mt-3 rounded-xs border border-mk-current bg-mk-abyss p-3" data-testid="reindex-summary">
      <div className="mk-label mb-2">last run</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
        <div className="text-mk-tide">provider</div>
        <div className="truncate text-mk-crest" title={`${data.providerId}/${data.modelId}`}>
          {data.providerId}/{data.modelId}
        </div>
        <div className="text-mk-tide">scanned</div>
        <div className="text-mk-crest">{data.scanned}</div>
        <div className="text-mk-tide">embedded</div>
        <div className="text-mk-ok">{data.embedded}</div>
        <div className="text-mk-tide">skipped</div>
        <div className="text-mk-surface">{data.skipped}</div>
        <div className="text-mk-tide">failed</div>
        <div className={data.failed > 0 ? "text-mk-danger" : "text-mk-surface"}>{data.failed}</div>
      </div>
    </div>
  );
}

function shortenId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
