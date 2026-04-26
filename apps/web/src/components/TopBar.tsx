/**
 * Top bar — 52px. Three zones, no dividers, very low visual weight:
 *
 *   [ project popover ]   [ centered breadcrumb ]   [ agent chip · theme toggle · sonar ]
 *
 * The sonar is the only motion. It stops when the harness is unreachable.
 * The wordmark lives at the top of the sidebar.
 *
 * The project popover writes to the URL (`/:slug/…`) — changing scope
 * navigates to the same sub-path under the new slug.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { TierStatus } from "../api-types";
import { useTheme, type ResolvedTheme } from "../hooks/useTheme";
import { useSelectedProject } from "../hooks/useSelectedProject";
import type { AxisShape } from "./AxisDefaultsCard";
import { ProjectAvatar } from "./ProjectAvatar";
import { ProviderIcon } from "./ProviderIcon";

interface TopBarProps {
  tier: TierStatus | undefined;
  agent: AxisShape | null;
  online: boolean;
  isLoading: boolean;
  pathname: string;
}

export function TopBar({
  tier,
  agent,
  online,
  isLoading,
  pathname,
}: TopBarProps) {
  const { resolved, toggle } = useTheme();
  const { scopedPath } = useSelectedProject();
  const breadcrumb = renderBreadcrumb(pathname);
  const harnessVersion = tier?.compaction?.harnessVersion ?? null;
  const providersPath = scopedPath("/providers");

  return (
    <header className="flex h-[52px] items-center gap-4 border-b border-mk-current bg-mk-abyss px-5">
      {/* ---- Left: project popover ---------------------------------------- */}
      <div className="flex items-center gap-2.5">
        <ProjectPicker />
      </div>

      {/* ---- Center: breadcrumb -------------------------------------------- */}
      <div className="flex flex-1 items-center justify-center">
        <span className="text-[13px] font-medium text-mk-crest">{breadcrumb}</span>
      </div>

      {/* ---- Right: agent · theme toggle · sonar -------------------------- */}
      <div className="flex items-center gap-2">
        <AgentChip
          agent={agent}
          isLoading={isLoading}
          providersPath={providersPath}
        />
        <ThemeToggle resolved={resolved} onClick={toggle} />
        <div
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-mk-tide"
          title={`harness${harnessVersion ? ` · v${harnessVersion}` : ""}`}
        >
          <span
            className="mk-sonar"
            data-offline={online ? "false" : "true"}
            aria-hidden
          />
          {harnessVersion ? (
            <span className="font-mono">v{harnessVersion}</span>
          ) : (
            <span className="font-mono">{online ? "online" : "offline"}</span>
          )}
        </div>
      </div>
    </header>
  );
}

function ProjectPicker() {
  const {
    projects,
    selectedProject,
    selectedProjectId,
    selectProject,
    effectiveSlug,
  } = useSelectedProject();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<
    { left: number; top: number; width: number } | null
  >(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isAll = effectiveSlug === "all";
  const label = selectedProject?.displayName ?? (isAll ? "All Projects" : "—");

  const items: ProjectPickerItem[] = [
    { kind: "all" },
    ...projects.map(
      (p) =>
        ({ kind: "project", projectId: p.projectId, name: p.displayName }) as const,
    ),
  ];

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return undefined;
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        left: rect.left,
        top: rect.bottom + 4,
        width: Math.max(rect.width, 220),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Default the highlighted row to the currently-selected project
    // so Enter picks the obvious thing first.
    const initial = items.findIndex((item) =>
      item.kind === "all"
        ? isAll
        : item.projectId === selectedProjectId,
    );
    setActiveIdx(initial >= 0 ? initial : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (idx: number) => {
    const item = items[idx];
    if (!item) return;
    selectProject(item.kind === "all" ? null : item.projectId);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(activeIdx);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="topbar-project"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isAll ? "All attached projects" : label}
        className={[
          "flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors",
          open
            ? "bg-mk-ridge text-mk-crest"
            : "text-mk-surface hover:bg-mk-ridge hover:text-mk-crest",
        ].join(" ")}
      >
        {selectedProject ? (
          <ProjectAvatar
            project={selectedProject}
            size={16}
            className="rounded-[4px]"
          />
        ) : null}
        <span className="max-w-[200px] truncate">{label}</span>
        <Chevron />
      </button>

      {open && anchor
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                left: anchor.left,
                top: anchor.top,
                width: anchor.width,
              }}
              className="z-50 rounded-md border border-mk-current bg-mk-depth shadow-xl"
            >
              <div
                role="listbox"
                className="max-h-[320px] overflow-y-auto py-1"
              >
                {items.map((item, idx) => {
                  const active = idx === activeIdx;
                  const isSelected =
                    item.kind === "all"
                      ? isAll
                      : item.projectId === selectedProjectId;
                  return (
                    <div
                      key={item.kind === "all" ? "__all__" : item.projectId}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(idx);
                      }}
                      className={[
                        "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px]",
                        active ? "bg-mk-ridge/70" : "",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex-1 truncate",
                          item.kind === "all"
                            ? "italic text-mk-tide"
                            : "text-mk-crest",
                        ].join(" ")}
                      >
                        {item.kind === "all" ? "All Projects" : item.name}
                      </span>
                      {isSelected ? (
                        <span className="mk-label text-mk-ok">selected</span>
                      ) : null}
                    </div>
                  );
                })}
                {projects.length === 0 ? (
                  <div className="px-2.5 py-2 text-[12.5px] text-mk-tide">
                    No attached projects.
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

type ProjectPickerItem =
  | { kind: "all" }
  | { kind: "project"; projectId: string; name: string };

function AgentChip({
  agent,
  isLoading,
  providersPath,
}: {
  agent: AxisShape | null;
  isLoading: boolean;
  providersPath: string;
}) {
  if (!agent) {
    return (
      <Link
        to={providersPath}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-mk-tide transition-colors hover:bg-mk-ridge hover:text-mk-crest"
        title={isLoading ? "Reading defaults…" : "Configure agent in Providers"}
      >
        <AgentDot tone="muted" />
        <span>{isLoading ? "loading…" : "no agent"}</span>
      </Link>
    );
  }

  if (!agent.active) {
    return (
      <Link
        to={providersPath}
        className="flex h-7 items-center gap-1.5 rounded-md border border-dashed border-mk-current px-2 text-[12px] text-mk-warn transition-colors hover:bg-mk-ridge"
        title={agent.reason ?? "No usable agent — configure cloud or local in Providers."}
      >
        <AgentDot tone="warn" />
        <span>no agent</span>
      </Link>
    );
  }

  const label = `${agent.active.providerId}/${agent.active.modelId}`;
  const tooltip =
    agent.source === "fallback" && agent.reason
      ? `${label} · fallback — ${agent.reason}`
      : label;

  return (
    <Link
      to={providersPath}
      className="flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[12px] text-mk-surface transition-colors hover:bg-mk-ridge hover:text-mk-crest"
      title={tooltip}
    >
      <ProviderIcon providerId={agent.active.providerId} size={14} />
      <span className="max-w-[220px] truncate">{agent.active.modelId}</span>
      {agent.source === "fallback" ? (
        <span className="rounded-xs border border-mk-warn/40 px-1 text-[9.5px] uppercase tracking-[0.06em] text-mk-warn">
          fallback
        </span>
      ) : null}
    </Link>
  );
}

function AgentDot({ tone }: { tone: "ok" | "warn" | "muted" }) {
  const bg =
    tone === "ok" ? "bg-mk-ok" : tone === "warn" ? "bg-mk-warn" : "bg-mk-tide";
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${bg}`} />;
}

function ThemeToggle({
  resolved,
  onClick,
}: {
  resolved: ResolvedTheme;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-mk-tide transition-colors hover:bg-mk-ridge hover:text-mk-crest"
    >
      {resolved === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function Chevron() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M3 5L6 8L9 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 1V3M8 13V15M15 8H13M3 8H1M12.95 3.05L11.54 4.46M4.46 11.54L3.05 12.95M12.95 12.95L11.54 11.54M4.46 4.46L3.05 3.05"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M14 9.5A6 6 0 1 1 6.5 2a5 5 0 0 0 7.5 7.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const GLOBAL_TOP_LEVEL = new Set(["providers", "usage"]);

function renderBreadcrumb(pathname: string): string {
  // Global routes (`/providers`, `/usage`) aren't under a slug, so the
  // first segment IS the page. Scoped routes (`/:slug/agent`) carry a
  // slug the picker already shows, so strip it here.
  const segments = pathname.split("/").filter(Boolean);
  const withoutSlug =
    segments.length > 0 && GLOBAL_TOP_LEVEL.has(segments[0]!)
      ? "/" + segments.join("/")
      : "/" + segments.slice(1).join("/");

  if (withoutSlug === "/") return "Overview";
  const sessionMatch = /^\/agent\/([^/]+)/.exec(withoutSlug);
  if (sessionMatch) return `Agent · ${shorten(sessionMatch[1]!)}`;
  if (withoutSlug === "/agent") return "Agent";
  if (withoutSlug === "/health") return "Health";
  if (withoutSlug === "/artifacts") return "Artifacts";
  if (withoutSlug === "/tools") return "Tools";
  if (withoutSlug === "/search") return "Search";
  if (withoutSlug === "/memory") return "Memory";
  if (withoutSlug === "/providers") return "Providers";
  if (withoutSlug === "/usage") return "Usage";
  return withoutSlug.replace(/^\//, "");
}

function shorten(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}
