/**
 * Dashboard home — projects-first.
 *
 * Two columns:
 *
 *   left  : Usage (tier/embedding/compaction) · Recent sessions
 *   right : Projects board with search + view toggle + Add New menu
 *
 * The Vercel projects view is the layout reference: every attached
 * project gets a card or row, the operator can toggle grid/list, and
 * one canonical "Add New" menu folds in attaching projects and
 * starting sessions. Selecting a project lifts that selection into the
 * shell-wide context so memory, search, and new-session creation all
 * scope to it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import type {
  ProviderEntry,
  SessionSummary,
  TierStatus,
} from "../api-types";
import { get, post } from "../lib/http";
import { ModelPicker } from "../components/ModelPicker";
import { ProjectCard } from "../components/ProjectCard";
import { AttachProjectModal } from "../components/AttachProjectModal";
import { useSelectedProject } from "../hooks/useSelectedProject";
import type { ModelPick } from "../lib/model-catalog";

type ProjectsView = "grid" | "list";

const VIEW_KEY = "mako.projectsView";

function readStoredView(): ProjectsView {
  if (typeof window === "undefined") return "grid";
  try {
    const value = window.localStorage.getItem(VIEW_KEY);
    return value === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function writeStoredView(view: ProjectsView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* noop */
  }
}

export function HomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    projects,
    isLoading: projectsLoading,
    isError: projectsError,
    error: projectsLoadError,
    selectedProjectId,
    selectedProject,
    selectProject,
    scopedPath,
  } = useSelectedProject();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<ProjectsView>(readStoredView);
  const [attachOpen, setAttachOpen] = useState(false);

  useEffect(() => {
    writeStoredView(view);
  }, [view]);

  const tier = useQuery({
    queryKey: ["tier"],
    queryFn: () => get<TierStatus>("/api/v1/tier"),
  });

  const sessions = useQuery({
    queryKey: ["sessions", "home", selectedProjectId ?? "all"],
    queryFn: () =>
      get<{ sessions: SessionSummary[] }>(
        selectedProjectId
          ? `/api/v1/sessions?project_id=${encodeURIComponent(selectedProjectId)}`
          : "/api/v1/sessions",
      ),
  });

  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => get<{ providers: ProviderEntry[] }>("/api/v1/providers"),
  });

  const createSession = useMutation({
    mutationFn: (input: {
      tier?: "no-agent" | "local-agent" | "cloud-agent";
      pick?: ModelPick | null;
    }) =>
      post<{ session: { id: string } }>("/api/v1/sessions", {
        projectId: selectedProjectId ?? undefined,
        tier: input.tier,
        provider: input.pick?.providerId,
        model: input.pick?.modelId,
        fallbackChain: input.pick
          ? [{ provider: input.pick.providerId, model: input.pick.modelId }]
          : undefined,
      }),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      if (created?.session?.id) {
        navigate(scopedPath(`/agent/${created.session.id}`));
      }
    },
  });

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return projects;
    return projects.filter((p) => {
      return (
        p.displayName.toLowerCase().includes(needle) ||
        p.projectId.toLowerCase().includes(needle) ||
        p.canonicalPath.toLowerCase().includes(needle)
      );
    });
  }, [projects, query]);

  const recent = (sessions.data?.sessions ?? []).slice(0, 5);
  const providerCount = (providers.data?.providers ?? []).length;

  return (
    <div className="mx-auto max-w-[1320px] px-8 py-8">
      <PageHeader
        title="Overview"
        scopeLabel={selectedProject ? selectedProject.displayName : "All projects"}
        onClearScope={
          selectedProjectId !== null ? () => selectProject(null) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* ---- Left rail ------------------------------------------------ */}
        <div className="space-y-6">
          <UsageCard
            tier={tier.data}
            tierLoading={tier.isLoading}
            providerCount={providerCount}
            createDisabled={createSession.isPending}
            onPick={(pick) => createSession.mutate({ pick })}
            onNoAgent={() => createSession.mutate({ tier: "no-agent" })}
          />

          <AlertsCard tier={tier.data} />

          <RecentSessionsCard
            sessions={recent}
            isLoading={sessions.isLoading}
            scopedTo={selectedProject?.displayName ?? null}
          />
        </div>

        {/* ---- Right rail ----------------------------------------------- */}
        <section>
          <ProjectsToolbar
            query={query}
            onQueryChange={setQuery}
            view={view}
            onViewChange={setView}
            onAttachProject={() => setAttachOpen(true)}
            onNewSession={() => createSession.mutate({ tier: "no-agent" })}
            createDisabled={createSession.isPending}
          />

          <h2 className="mt-6 mb-3 text-[13px] font-medium text-mk-crest">
            Projects
            <span className="ml-2 mk-label text-mk-tide">
              {filteredProjects.length} / {projects.length}
            </span>
          </h2>

          <ProjectsBoard
            projects={filteredProjects}
            isLoading={projectsLoading}
            isError={projectsError}
            error={projectsLoadError}
            selectedProjectId={selectedProjectId}
            view={view}
            onSelect={selectProject}
            onAttachProject={() => setAttachOpen(true)}
            hasAnyProject={projects.length > 0}
          />

          {createSession.isError ? (
            <div className="mt-4 font-mono text-[11px] text-mk-danger">
              {(createSession.error as Error).message}
            </div>
          ) : null}
        </section>
      </div>

      <AttachProjectModal
        open={attachOpen}
        onClose={() => setAttachOpen(false)}
        onAttached={(p) => selectProject(p.projectId)}
      />
    </div>
  );
}

// =============================================================================
// Header
// =============================================================================

function PageHeader({
  title,
  scopeLabel,
  onClearScope,
}: {
  title: string;
  scopeLabel: string;
  onClearScope?: () => void;
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[20px] text-mk-crest">{title}</h1>
        <span className="mk-label text-mk-tide">scope · {scopeLabel}</span>
        {onClearScope ? (
          <button
            type="button"
            onClick={onClearScope}
            className="font-mono text-[11px] uppercase tracking-[0.08em] text-mk-tide hover:text-mk-surface"
          >
            clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

// =============================================================================
// Usage / Alerts / Recent sessions
// =============================================================================

function UsageCard({
  tier,
  tierLoading,
  providerCount,
  createDisabled,
  onPick,
  onNoAgent,
}: {
  tier: TierStatus | undefined;
  tierLoading: boolean;
  providerCount: number;
  createDisabled: boolean;
  onPick(pick: ModelPick): void;
  onNoAgent(): void;
}) {
  const { scopedPath } = useSelectedProject();
  return (
    <article className="mk-card overflow-hidden">
      <header className="flex items-center justify-between border-b border-mk-current px-4 py-2.5">
        <h3 className="text-[13px] font-medium text-mk-crest">Harness</h3>
        <Link to={scopedPath("/providers")} className="mk-label text-mk-tide hover:text-mk-surface">
          providers
        </Link>
      </header>
      <dl className="divide-y divide-mk-current text-[12px]">
        <UsageRow
          label="Tier"
          value={tier?.current ?? (tierLoading ? "—" : "offline")}
          hint={tier?.reason ?? undefined}
        />
        <UsageRow
          label="Embedding"
          value={
            tier?.embedding?.ok
              ? `${tier.embedding.providerId}/${tier.embedding.modelId}`
              : "fts-fallback"
          }
          hint={tier?.embedding?.reason ?? undefined}
          variant={tier?.embedding?.ok === false ? "warn" : "default"}
        />
        <UsageRow
          label="Compaction"
          value={
            tier?.compaction
              ? `${(tier.compaction.threshold * 100).toFixed(0)}% of context`
              : "—"
          }
          hint={`harness v${tier?.compaction?.harnessVersion ?? "—"}`}
        />
        <UsageRow
          label="Providers"
          value={providerCount > 0 ? `${providerCount} configured` : "none"}
        />
      </dl>
      <footer className="border-t border-mk-current px-4 py-3">
        <div className="mk-label mb-2">Start a session</div>
        <div className="flex flex-wrap items-center gap-2">
          <ModelPicker
            disabled={createDisabled}
            onSubmit={(pick) => pick && onPick(pick)}
          />
          <button
            type="button"
            onClick={onNoAgent}
            disabled={createDisabled}
            className="h-9 rounded-md border border-mk-current bg-mk-depth px-3 text-[12px] text-mk-crest transition-colors hover:bg-mk-ridge disabled:cursor-not-allowed disabled:opacity-40"
          >
            No-agent
          </button>
        </div>
      </footer>
    </article>
  );
}

function UsageRow({
  label,
  value,
  hint,
  variant = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: "default" | "warn" | "danger";
}) {
  const valueColor =
    variant === "warn"
      ? "text-mk-warn"
      : variant === "danger"
        ? "text-mk-danger"
        : "text-mk-crest";
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-3 px-4 py-2.5">
      <dt className="mk-label">{label}</dt>
      <dd className={`min-w-0 font-mono text-[12px] ${valueColor}`}>
        <div className="truncate">{value}</div>
        {hint ? (
          <div className="mt-0.5 truncate text-[11px] text-mk-tide" title={hint}>
            {hint}
          </div>
        ) : null}
      </dd>
    </div>
  );
}

function AlertsCard({ tier }: { tier: TierStatus | undefined }) {
  const { scopedPath } = useSelectedProject();
  const embeddingOk = tier?.embedding?.ok === true;
  const noProviders = (tier?.upgradePath ?? []).length > 0 && tier?.current === "no-agent";

  if (embeddingOk && !noProviders) {
    return (
      <article className="mk-card p-4">
        <h3 className="text-[13px] font-medium text-mk-crest">Alerts</h3>
        <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-mk-tide">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-mk-ok" aria-hidden />
          all clear
        </div>
      </article>
    );
  }

  return (
    <article className="mk-card p-4">
      <h3 className="text-[13px] font-medium text-mk-crest">Alerts</h3>
      <ul className="mt-3 space-y-2 text-[12px]" role="list">
        {!embeddingOk ? (
          <li className="flex items-start gap-2">
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-mk-warn" aria-hidden />
            <div>
              <div className="text-mk-crest">Embeddings on FTS-only fallback</div>
              <div className="mt-0.5 text-mk-tide">
                Configure an embedding provider to enable hybrid semantic recall.
              </div>
              <Link to={scopedPath("/providers")} className="mt-1 inline-block font-mono text-[11px] text-mk-signal-dim hover:text-mk-signal">
                open providers →
              </Link>
            </div>
          </li>
        ) : null}
        {noProviders ? (
          <li className="flex items-start gap-2">
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-mk-warn" aria-hidden />
            <div>
              <div className="text-mk-crest">Running on no-agent tier</div>
              <div className="mt-0.5 text-mk-tide">
                Add a BYOK provider to unlock {tier?.upgradePath?.join(" / ")}.
              </div>
            </div>
          </li>
        ) : null}
      </ul>
    </article>
  );
}

function RecentSessionsCard({
  sessions,
  isLoading,
  scopedTo,
}: {
  sessions: SessionSummary[];
  isLoading: boolean;
  scopedTo: string | null;
}) {
  const { scopedPath } = useSelectedProject();
  return (
    <article className="mk-card overflow-hidden">
      <header className="flex items-center justify-between border-b border-mk-current px-4 py-2.5">
        <div>
          <h3 className="text-[13px] font-medium text-mk-crest">Recent sessions</h3>
          {scopedTo ? (
            <div className="mk-label mt-0.5 text-mk-tide">scoped · {scopedTo}</div>
          ) : null}
        </div>
      </header>
      {isLoading && sessions.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-mk-tide">Reading sessions…</div>
      ) : sessions.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-mk-tide">
          No sessions yet for this scope.
        </div>
      ) : (
        <ul role="list" className="divide-y divide-mk-current">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                to={scopedPath(`/agent/${s.id}`)}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-mk-ridge"
              >
                <SessionStatusDot status={s.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-mk-crest">
                    {s.title ?? "untitled session"}
                  </div>
                  <div className="truncate font-mono text-[10.5px] text-mk-tide">
                    {relativeTime(s.updatedAt)} · {s.tier}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// =============================================================================
// Toolbar above the projects board
// =============================================================================

interface ProjectsToolbarProps {
  query: string;
  onQueryChange(value: string): void;
  view: ProjectsView;
  onViewChange(view: ProjectsView): void;
  onAttachProject(): void;
  onNewSession(): void;
  createDisabled: boolean;
}

function ProjectsToolbar({
  query,
  onQueryChange,
  view,
  onViewChange,
  onAttachProject,
  onNewSession,
  createDisabled,
}: ProjectsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[260px] flex-1">
        <SearchIcon />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search projects…"
          aria-label="Search projects"
          className="block h-9 w-full rounded-md border border-mk-current bg-mk-depth pl-8 pr-3 text-[13px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
        />
      </div>

      <ViewToggle view={view} onChange={onViewChange} />

      <AddNewMenu
        onAttachProject={onAttachProject}
        onNewSession={onNewSession}
        disabled={createDisabled}
      />
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ProjectsView;
  onChange(view: ProjectsView): void;
}) {
  return (
    <div
      role="group"
      aria-label="Projects view"
      className="flex h-9 items-center rounded-md border border-mk-current bg-mk-depth"
    >
      <ToggleButton active={view === "grid"} onClick={() => onChange("grid")} label="Grid view">
        <GridIcon />
      </ToggleButton>
      <div className="h-5 w-px bg-mk-current" aria-hidden />
      <ToggleButton active={view === "list"} onClick={() => onChange("list")} label="List view">
        <ListIcon />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick(): void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={[
        "flex h-9 w-9 items-center justify-center text-mk-tide transition-colors",
        active ? "text-mk-crest" : "hover:text-mk-surface",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

interface AddNewMenuProps {
  onAttachProject(): void;
  onNewSession(): void;
  disabled: boolean;
}

function AddNewMenu({ onAttachProject, onNewSession, disabled }: AddNewMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-md bg-mk-crest px-3.5 text-[13px] font-medium text-mk-abyss transition-opacity hover:opacity-90"
      >
        Add new
        <ChevronIcon />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-10 z-30 min-w-[220px] rounded-md border border-mk-current bg-mk-abyss p-1 shadow-lg"
        >
          <AddItem
            onClick={() => {
              setOpen(false);
              onAttachProject();
            }}
            label="Project"
            hint="Attach a repo"
          />
          <AddItem
            onClick={() => {
              setOpen(false);
              onNewSession();
            }}
            label="Session"
            hint="No-agent query"
            disabled={disabled}
          />
        </div>
      ) : null}
    </div>
  );
}

function AddItem({
  label,
  hint,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="block w-full rounded-xs px-2 py-1.5 text-left transition-colors hover:bg-mk-ridge disabled:opacity-40"
    >
      <div className="text-[12px] text-mk-crest">{label}</div>
      <div className="mt-0.5 font-mono text-[10.5px] text-mk-tide">{hint}</div>
    </button>
  );
}

// =============================================================================
// Projects board
// =============================================================================

function ProjectsBoard({
  projects,
  isLoading,
  isError,
  error,
  selectedProjectId,
  view,
  onSelect,
  onAttachProject,
  hasAnyProject,
}: {
  projects: ReturnType<typeof useSelectedProject>["projects"];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  selectedProjectId: string | null;
  view: ProjectsView;
  onSelect(id: string | null): void;
  onAttachProject(): void;
  hasAnyProject: boolean;
}) {
  if (isError && projects.length === 0) {
    return (
      <div className="mk-card px-6 py-10">
        <div className="text-[13px] font-medium text-mk-crest">
          Could not read attached projects.
        </div>
        <div className="mt-2 font-mono text-[11px] text-mk-danger">
          {error?.message ?? "Project API request failed."}
        </div>
        <div className="mt-3 text-[12px] text-mk-tide">
          The dashboard needs the local API service at 127.0.0.1:3017. Start
          it with <span className="font-mono text-mk-surface">agentmako dashboard</span>
          {" "}or run <span className="font-mono text-mk-surface">agentmako serve</span>.
        </div>
      </div>
    );
  }

  if (isLoading && projects.length === 0) {
    return (
      <div className="mk-card px-6 py-12 text-center text-[12px] text-mk-tide">
        Reading attached projects…
      </div>
    );
  }

  if (projects.length === 0) {
    if (!hasAnyProject) {
      return (
        <div className="mk-card flex flex-col items-center justify-center gap-4 px-8 py-14 text-center">
          <div className="mk-wordmark text-[22px]">mako</div>
          <div className="mk-rule w-24" />
          <p className="max-w-[360px] text-[12px] text-mk-tide">
            No projects attached yet. Point mako at a repo to start a session.
          </p>
          <button
            type="button"
            onClick={onAttachProject}
            className="h-8 rounded-md bg-mk-crest px-3 text-[12px] font-medium text-mk-abyss hover:opacity-90"
          >
            Attach a project
          </button>
        </div>
      );
    }
    return (
      <div className="mk-card px-6 py-10 text-center text-[12px] text-mk-tide">
        No projects match that filter.
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="mk-card overflow-hidden">
        {projects.map((p) => (
          <ProjectCard
            key={p.projectId}
            project={p}
            isSelected={p.projectId === selectedProjectId}
            view="list"
            onSelect={() => onSelect(p.projectId)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => (
        <ProjectCard
          key={p.projectId}
          project={p}
          isSelected={p.projectId === selectedProjectId}
          view="grid"
          onSelect={() => onSelect(p.projectId)}
        />
      ))}
    </div>
  );
}

// =============================================================================
// Tiny icons
// =============================================================================

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mk-tide"
      viewBox="0 0 16 16"
      aria-hidden
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="9" y="2" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="2" y="9" width="5" height="5" rx="1" fill="currentColor" />
      <rect x="9" y="9" width="5" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="3" width="12" height="2" rx="1" fill="currentColor" />
      <rect x="2" y="7" width="12" height="2" rx="1" fill="currentColor" />
      <rect x="2" y="11" width="12" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function SessionStatusDot({ status }: { status: SessionSummary["status"] }) {
  const bg =
    status === "active"
      ? "bg-mk-signal"
      : status === "error"
        ? "bg-mk-danger"
        : "bg-mk-tide";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${bg}`} aria-hidden />;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const delta = Date.now() - then;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}
