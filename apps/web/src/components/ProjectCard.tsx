/**
 * Project card — one tile per attached project on the dashboard.
 *
 * Inspired by the Vercel projects board: name + canonical path on top,
 * a short status row in the middle (last-indexed timestamp + support
 * level), and a kebab menu on the right with re-index / detach. The
 * card itself is the select affordance — clicking it sets the active
 * project for the whole shell.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../lib/http";
import type { AttachedProject } from "../api-types";
import { useSelectedProject } from "../hooks/useSelectedProject";
import { ProjectAvatar } from "./ProjectAvatar";

interface RevealResult {
  projectId: string;
  revealed: boolean;
  path: string;
}

interface ProjectCardProps {
  project: AttachedProject;
  isSelected: boolean;
  view: "grid" | "list";
  onSelect(): void;
}

export function ProjectCard({ project, isSelected, view, onSelect }: ProjectCardProps) {
  const qc = useQueryClient();
  const { slugByProjectId } = useSelectedProject();
  const slug = slugByProjectId.get(project.projectId) ?? null;
  const isDetached = project.status !== "active";

  const reindex = useMutation({
    mutationFn: () =>
      post<unknown>("/api/v1/projects/index", { projectRoot: project.canonicalPath }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const detach = useMutation({
    mutationFn: () =>
      post<unknown>("/api/v1/projects/detach", { projectRef: project.projectId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const reveal = useMutation({
    mutationFn: () =>
      post<RevealResult>(
        `/api/v1/projects/${encodeURIComponent(project.projectId)}/reveal`,
      ),
  });

  const handleSelect = () => {
    onSelect();
  };

  const handleNewSession = () => {
    onSelect();
  };

  const handleReindex = () => {
    reindex.mutate();
  };

  const handleDetach = () => {
    if (
      window.confirm(
        `Detach ${project.displayName}? Index data is preserved unless you re-attach with --purge.`,
      )
    ) {
      detach.mutate();
    }
  };

  const handleReveal = () => {
    reveal.mutate();
  };

  const lastIndexed = project.lastIndexedAt
    ? relativeTime(project.lastIndexedAt)
    : "never";

  if (view === "list") {
    return (
      <div
        role="button"
        tabIndex={0}
        data-project-id={project.projectId}
        data-selected={isSelected}
        onClick={handleSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSelect();
          }
        }}
        className={[
          "group relative flex items-center gap-4 border-b border-mk-current px-4 py-3 transition-colors last:border-b-0",
          isSelected
            ? "bg-mk-signal/5 shadow-[inset_3px_0_0_var(--color-mk-signal)]"
            : "hover:bg-mk-depth",
        ].join(" ")}
      >
        <ProjectAvatar project={project} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <div className="truncate text-[14px] text-mk-crest">{project.displayName}</div>
            {slug ? (
              <div className="shrink-0 font-mono text-[11px] text-mk-tide">
                /{slug}
              </div>
            ) : null}
            {isDetached ? (
              <span className="mk-label shrink-0 text-mk-warn">
                {labelForStatus(project.status)}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              reveal.mutate();
            }}
            disabled={reveal.isPending}
            title={`Open ${project.canonicalPath} in file explorer`}
            className="group/path mt-0.5 flex min-w-0 items-center gap-1 truncate rounded-xs text-left font-mono text-[11px] text-mk-surface transition-colors hover:text-mk-signal disabled:opacity-60"
          >
            <span className="truncate">{project.canonicalPath}</span>
            <OpenExternalIcon />
          </button>
        </div>
        {project.supportTarget ? (
          <span
            className="hidden shrink-0 rounded-xs border border-mk-current bg-mk-depth px-1.5 py-0.5 font-mono text-[10px] text-mk-surface lg:inline-block"
            title={`Support target: ${project.supportTarget}`}
          >
            {project.supportTarget}
          </span>
        ) : null}
        <div className="hidden shrink-0 text-right md:block">
          <div className="mk-label">indexed</div>
          <div className="font-mono text-[11px] text-mk-surface">{lastIndexed}</div>
        </div>
        <CardMenu
          reindexing={reindex.isPending}
          detaching={detach.isPending}
          revealing={reveal.isPending}
          onReindex={handleReindex}
          onDetach={handleDetach}
          onNewSession={handleNewSession}
          onReveal={handleReveal}
        />
      </div>
    );
  }

  return (
    <article
      role="button"
      tabIndex={0}
      data-project-id={project.projectId}
      data-selected={isSelected}
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSelect();
        }
      }}
      className={[
        "mk-card group relative flex flex-col overflow-hidden p-4 transition-all",
        isSelected
          ? "border-mk-signal/50 bg-mk-signal/5 shadow-[inset_3px_0_0_var(--color-mk-signal)]"
          : "hover:border-mk-tide/40 hover:shadow-md",
      ].join(" ")}
    >
      <header className="mb-3 flex items-start gap-3">
        <ProjectAvatar project={project} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-[14px] font-medium text-mk-crest">
              {project.displayName}
            </div>
            {isDetached ? (
              <span className="mk-label shrink-0 text-mk-warn">
                {labelForStatus(project.status)}
              </span>
            ) : null}
          </div>
          {slug ? (
            <div
              className="mt-0.5 truncate font-mono text-[11px] text-mk-tide"
              title="Deep-link slug"
            >
              /{slug}
            </div>
          ) : null}
        </div>
        <CardMenu
          reindexing={reindex.isPending}
          detaching={detach.isPending}
          revealing={reveal.isPending}
          onReindex={handleReindex}
          onDetach={handleDetach}
          onNewSession={handleNewSession}
          onReveal={handleReveal}
        />
      </header>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          reveal.mutate();
        }}
        disabled={reveal.isPending}
        title={`Open ${project.canonicalPath} in file explorer`}
        className="group/path mb-2 flex min-w-0 items-center gap-1.5 rounded-xs text-left text-[11px] text-mk-surface transition-colors hover:text-mk-signal disabled:opacity-60"
      >
        <FolderIcon />
        <span className="truncate font-mono">
          {formatPath(project.canonicalPath)}
        </span>
        <OpenExternalIcon />
      </button>

      {project.supportTarget ? (
        <div className="mb-3 flex flex-wrap items-center gap-1">
          <span
            className="rounded-xs border border-mk-current bg-mk-depth px-1.5 py-0.5 font-mono text-[10px] text-mk-surface"
            title={`Support target: ${project.supportTarget}`}
          >
            {project.supportTarget}
          </span>
        </div>
      ) : null}

      <footer className="mt-auto flex items-center justify-between border-t border-mk-current pt-3">
        <span className="font-mono text-[11px] text-mk-tide">
          indexed {lastIndexed}
        </span>
        {isSelected ? (
          <span className="mk-label text-mk-signal">current scope</span>
        ) : (
          <span
            aria-hidden
            className="font-mono text-[11px] text-mk-signal opacity-0 transition-opacity group-hover:opacity-100"
          >
            open →
          </span>
        )}
      </footer>

      {reindex.isError ? (
        <div className="mt-2 font-mono text-[11px] text-mk-danger">
          {(reindex.error as Error).message}
        </div>
      ) : null}
      {detach.isError ? (
        <div className="mt-2 font-mono text-[11px] text-mk-danger">
          {(detach.error as Error).message}
        </div>
      ) : null}
    </article>
  );
}

function OpenExternalIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      aria-hidden
      fill="none"
      className="shrink-0 opacity-0 transition-opacity group-hover/path:opacity-100"
    >
      <path
        d="M9.5 3h3.5v3.5M13 3L7 9M6 4H3.5A.5.5 0 0 0 3 4.5v8a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      aria-hidden
      className="shrink-0 text-mk-tide"
      fill="none"
    >
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Shorten a canonical path for display. Keeps the final two segments
 * plus a leading ellipsis so "c:/Users/Dustin/work/apps/forgebench"
 * renders as "…/apps/forgebench" when the raw form would overflow.
 */
function formatPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.length <= 48) return normalized;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 2) return normalized;
  return `…/${segments.slice(-2).join("/")}`;
}

interface CardMenuProps {
  reindexing: boolean;
  detaching: boolean;
  revealing: boolean;
  onReindex(): void;
  onDetach(): void;
  onNewSession(): void;
  onReveal(): void;
}

function CardMenu({
  reindexing,
  detaching,
  revealing,
  onReindex,
  onDetach,
  onNewSession,
  onReveal,
}: CardMenuProps) {
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

  const wrap = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Project actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-xs text-mk-tide transition-colors hover:bg-mk-ridge hover:text-mk-crest"
      >
        <KebabIcon />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-8 z-20 min-w-[180px] rounded-md border border-mk-current bg-mk-abyss py-1 shadow-lg"
        >
          <MenuItem onClick={wrap(onNewSession)}>New session here</MenuItem>
          <MenuItem onClick={wrap(onReveal)} disabled={revealing}>
            {revealing ? "Opening…" : "Open folder"}
          </MenuItem>
          <MenuItem onClick={wrap(onReindex)} disabled={reindexing}>
            {reindexing ? "Re-indexing…" : "Re-index"}
          </MenuItem>
          <MenuItem onClick={wrap(onDetach)} disabled={detaching} danger>
            {detaching ? "Detaching…" : "Detach"}
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick(e: React.MouseEvent): void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={[
        "block w-full px-3 py-1.5 text-left text-[12px] transition-colors disabled:opacity-40",
        danger ? "text-mk-danger hover:bg-mk-ridge" : "text-mk-crest hover:bg-mk-ridge",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function KebabIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="3.5" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="12.5" r="1.25" fill="currentColor" />
    </svg>
  );
}

function labelForStatus(status: AttachedProject["status"]): string {
  if (status === "active") return "active";
  if (status === "detached") return "detached";
  return status;
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
