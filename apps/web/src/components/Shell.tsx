/**
 * App shell: top bar + left nav + main content.
 *
 * The left nav is always the primary app rail. On /agent routes, that
 * same rail grows a session section underneath the top-level navigation,
 * so the chat workspace keeps one sidebar instead of nesting a second one
 * inside the page.
 *
 * Visual language: very low-weight, no boxes around items, hover bg is
 * a single subtle tint, active row gets a left accent stripe + tinted bg.
 * Matches the Vercel "Projects / Deployments / Logs" sidebar density.
 */

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post } from "../lib/http";
import type { SessionSummary, TierStatus } from "../api-types";
import { useSelectedProject } from "../hooks/useSelectedProject";
import type { ModelPick } from "../lib/model-catalog";
import type { AxisShape } from "./AxisDefaultsCard";
import { SessionListNav } from "./SessionListNav";
import { TopBar } from "./TopBar";

interface DefaultsResponse {
  agent: AxisShape;
  embedding: AxisShape;
}

interface ShellProps {
  children: ReactNode;
}

interface NavEntry {
  to: string;
  label: string;
  icon: ReactNode;
}

export function Shell({ children }: ShellProps) {
  const location = useLocation();
  const { scopedPath } = useSelectedProject();
  const isAgentRoute = /\/agent(?:\/|$)/.test(location.pathname);

  const tier = useQuery({
    queryKey: ["tier"],
    queryFn: () => get<TierStatus>("/api/v1/tier"),
    refetchInterval: 15_000,
  });

  const defaults = useQuery({
    queryKey: ["defaults"],
    queryFn: () => get<DefaultsResponse>("/api/v1/defaults"),
    refetchInterval: 15_000,
  });

  const online = useMemo(() => tier.isSuccess, [tier.isSuccess]);

  const nav: NavEntry[] = [
    { to: scopedPath("/"), label: "Dashboard", icon: <DashboardIcon /> },
    { to: scopedPath("/health"), label: "Health", icon: <HealthIcon /> },
    { to: scopedPath("/agent"), label: "Agent", icon: <AgentIcon /> },
    { to: scopedPath("/artifacts"), label: "Artifacts", icon: <ArtifactsIcon /> },
    { to: scopedPath("/tools"), label: "Tools", icon: <ToolsIcon /> },
    { to: scopedPath("/search"), label: "Search", icon: <SearchIcon /> },
    { to: scopedPath("/memory"), label: "Memory", icon: <MemoryIcon /> },
    { to: scopedPath("/usage"), label: "Usage", icon: <UsageIcon /> },
    { to: scopedPath("/providers"), label: "Providers", icon: <ProvidersIcon /> },
  ];

  return (
    <div
      className={[
        "grid h-full bg-mk-abyss text-mk-crest",
        isAgentRoute ? "grid-cols-[304px_1fr]" : "grid-cols-[224px_1fr]",
      ].join(" ")}
    >
      <nav
        aria-label="Primary"
        className="flex h-full min-h-0 flex-col border-r border-mk-current bg-mk-abyss"
      >
        <div className="flex h-[52px] items-center px-5">
          <Link
            to={scopedPath("/")}
            className="group flex items-center gap-2"
            aria-label={isAgentRoute ? "Back to dashboard" : "Home"}
            title={isAgentRoute ? "Back to dashboard" : "Home"}
          >
            <BrandMark />
            <span className="mk-wordmark text-[14px]">mako</span>
            {isAgentRoute ? (
              <span
                aria-hidden
                className="ml-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mk-tide opacity-0 transition-opacity group-hover:opacity-100"
              >
                ← exit
              </span>
            ) : null}
          </Link>
        </div>
        {isAgentRoute ? null : (
          <div className="shrink-0 overflow-y-auto">
            <ul className="space-y-0.5 px-2 pt-3" role="list">
              {nav.map((entry) => (
                <li key={entry.to}>
                  <SidebarLink to={entry.to} icon={entry.icon}>
                    {entry.label}
                  </SidebarLink>
                </li>
              ))}
            </ul>
          </div>
        )}
        {isAgentRoute ? <AgentSidebarPanel defaultAgent={defaults.data?.agent ?? null} /> : null}
        <SidebarFooter compact={isAgentRoute} />
      </nav>

      <div className="grid h-full grid-rows-[52px_1fr] overflow-hidden">
        <TopBar
          tier={tier.data}
          agent={defaults.data?.agent ?? null}
          online={online}
          isLoading={tier.isLoading}
          pathname={location.pathname}
        />
        <main className="overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function AgentSidebarPanel({ defaultAgent }: { defaultAgent: AxisShape | null }) {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { selectedProjectId, selectedProject, scopedPath } = useSelectedProject();
  const [scopeToProject, setScopeToProject] = useState(false);

  const effectiveProjectId = scopeToProject ? selectedProjectId : null;

  const sessions = useQuery({
    queryKey: ["sessions", "agent-sidebar", effectiveProjectId ?? "all"],
    queryFn: () =>
      get<{ sessions: SessionSummary[] }>(
        effectiveProjectId
          ? `/api/v1/sessions?project_id=${encodeURIComponent(effectiveProjectId)}`
          : "/api/v1/sessions",
      ),
    refetchInterval: 10_000,
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
      if (created?.session?.id) navigate(scopedPath(`/agent/${created.session.id}`));
    },
  });

  const removeSession = useMutation({
    mutationFn: async (id: string) => {
      await del<unknown>(`/api/v1/sessions/${id}`);
      return id;
    },
    onSuccess: (deletedId) => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      if (sessionId === deletedId) {
        navigate(scopedPath("/agent"));
      }
    },
  });

  const allSessions = sessions.data?.sessions ?? [];
  const defaultPick = defaultAgent?.active
    ? {
        providerId: defaultAgent.active.providerId,
        modelId: defaultAgent.active.modelId,
      }
    : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="mk-label">Sessions</span>
            <span className="mk-label text-mk-tide">{allSessions.length}</span>
          </div>
          <div className="flex items-center gap-1">
            {selectedProjectId ? (
              <button
                type="button"
                onClick={() => setScopeToProject((v) => !v)}
                aria-pressed={scopeToProject}
                title={
                  scopeToProject
                    ? `Showing sessions for ${selectedProject?.displayName ?? "selected project"}`
                    : "Showing all sessions — click to scope to project"
                }
                className={[
                  "flex h-6 w-6 items-center justify-center rounded-xs transition-colors",
                  scopeToProject
                    ? "bg-mk-signal/15 text-mk-signal"
                    : "text-mk-tide hover:bg-mk-ridge hover:text-mk-surface",
                ].join(" ")}
              >
                <ScopeIcon />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() =>
                createSession.mutate(
                  defaultPick ? { pick: defaultPick } : { tier: "no-agent" },
                )
              }
              disabled={createSession.isPending}
              aria-label="New chat"
              title={
                defaultPick
                  ? `New chat on ${defaultPick.modelId}`
                  : "New chat (no-agent mode)"
              }
              className="flex h-6 w-6 items-center justify-center rounded-xs text-mk-surface transition-colors hover:bg-mk-ridge hover:text-mk-crest disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PlusIcon />
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <SessionListNav
          sessions={allSessions}
          isLoading={sessions.isLoading}
          activeSessionId={sessionId ?? null}
          onDelete={(id) => {
            if (
              window.confirm(
                "Delete this session? Event logs and tool runs are retained.",
              )
            ) {
              removeSession.mutate(id);
            }
          }}
          deletingSessionId={
            removeSession.isPending ? (removeSession.variables as string) : null
          }
        />
      </div>

      {createSession.isError ? (
        <div className="border-t border-mk-current px-3 py-2 font-mono text-[10.5px] text-mk-danger">
          {(createSession.error as Error).message}
        </div>
      ) : null}
    </section>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M8 3.5V12.5M3.5 8H12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ScopeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden fill="none">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    </svg>
  );
}

function BrandMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden
      className="text-mk-crest"
    >
      <path
        d="M2 12L8 3L14 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function SidebarFooter({ compact }: { compact: boolean }) {
  const qc = useQueryClient();
  const restartHarness = useMutation({
    mutationFn: () => post<{ restarted: boolean }>("/api/v1/dashboard/restart-harness"),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tier"] }),
        qc.invalidateQueries({ queryKey: ["defaults"] }),
        qc.invalidateQueries({ queryKey: ["providers"] }),
        qc.invalidateQueries({ queryKey: ["catalog-status"] }),
      ]);
    },
  });

  if (compact) {
    // On /agent the sidebar stays focused on sessions. Restart lives as
    // a single muted row at the bottom so it's reachable but doesn't
    // steal attention from the session list.
    return (
      <div className="mt-auto border-t border-mk-current px-2 py-2">
        <button
          type="button"
          onClick={() => restartHarness.mutate()}
          disabled={restartHarness.isPending}
          title="Recycle the local harness process and refresh provider discovery."
          className="flex h-7 w-full items-center gap-2 rounded-xs px-2 font-mono text-[11px] text-mk-tide transition-colors hover:bg-mk-ridge hover:text-mk-surface disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RestartIcon />
          <span>{restartHarness.isPending ? "restarting…" : "restart harness"}</span>
          {restartHarness.isError ? (
            <span className="ml-auto text-mk-danger">failed</span>
          ) : restartHarness.isSuccess ? (
            <span className="ml-auto text-mk-ok">ok</span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-auto border-t border-mk-current px-2 py-3">
      <div className="rounded-md border border-mk-current bg-mk-depth px-2.5 py-2">
        <div className="mk-label text-mk-tide">Harness</div>
        <button
          type="button"
          onClick={() => restartHarness.mutate()}
          disabled={restartHarness.isPending}
          className="mt-2 flex h-8 w-full items-center justify-center rounded-md border border-mk-current bg-mk-abyss px-2 font-mono text-[11px] uppercase tracking-[0.08em] text-mk-surface transition-colors hover:bg-mk-ridge hover:text-mk-crest disabled:cursor-not-allowed disabled:opacity-40"
        >
          {restartHarness.isPending ? "Restarting…" : "Restart Harness"}
        </button>
        {restartHarness.isError ? (
          <div className="mt-2 font-mono text-[11px] text-mk-danger">
            {(restartHarness.error as Error).message}
          </div>
        ) : restartHarness.isSuccess ? (
          <div className="mt-2 font-mono text-[11px] text-mk-ok">Harness restarted.</div>
        ) : (
          <div className="mt-2 text-[11px] text-mk-tide">
            Recycles the local harness process and refreshes provider discovery.
          </div>
        )}
      </div>
    </div>
  );
}

function RestartIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M13 3V6H10M3 13V10H6M4 6.5A5 5 0 0 1 12.5 6M12 9.5A5 5 0 0 1 3.5 10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SidebarLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const isAgentRoot = /\/agent$/.test(to);
  return (
    <NavLink
      to={to}
      end={!isAgentRoot}
      className={({ isActive }) =>
        [
          "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
          isActive
            ? "bg-mk-ridge text-mk-crest"
            : "text-mk-surface hover:bg-mk-ridge hover:text-mk-crest",
        ].join(" ")
      }
    >
      <span className="flex h-4 w-4 items-center justify-center text-current opacity-80">
        {icon}
      </span>
      <span>{children}</span>
    </NavLink>
  );
}

// =============================================================================
// Icons (16px, single-stroke, monochrome — match the topbar brand-mark vibe)
// =============================================================================

function DashboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 3v-3H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M2 9H4.5L5.8 5L8.2 12L10 7.5H14"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArtifactsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M4 2.5H9.5L12 5V13.5H4V2.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2.5V5H12M6 8H10M6 10.5H9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ToolsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M6.5 3.5L4 6L6.5 8.5M9.5 3.5L12 6L9.5 8.5M8.5 10.5L10.5 12.5M10.5 10.5L8.5 12.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 6.5h6M5 9.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function UsageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M2.5 12.5V5M6.5 12.5V8M10.5 12.5V3M14 12.5H2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ProvidersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <circle cx="8" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 6v2M6.5 10.5L7.5 8.5M9.5 10.5L8.5 8.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
