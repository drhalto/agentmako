/**
 * Session list — used by the shell on /agent routes.
 *
 * Each row is 44px tall (a hair bigger than the old 40px — easier click
 * target, easier to scan). The active row carries the depth-line accent.
 * Hovering a row reveals an × delete trigger on the right.
 */

import { Link } from "react-router-dom";
import type { SessionSummary } from "../api-types";
import { useSelectedProject } from "../hooks/useSelectedProject";

interface Props {
  sessions: SessionSummary[];
  isLoading: boolean;
  activeSessionId: string | null;
  onDelete(id: string): void;
  deletingSessionId: string | null;
}

export function SessionListNav({
  sessions,
  isLoading,
  activeSessionId,
  onDelete,
  deletingSessionId,
}: Props) {
  const { scopedPath } = useSelectedProject();
  if (isLoading && sessions.length === 0) {
    return (
      <div className="px-4 py-4 text-[12px] text-mk-tide">Loading sessions…</div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className="px-4 py-4 text-[12px] text-mk-tide">
        No sessions yet. Start one here.
      </div>
    );
  }

  // Phase 3.9: sort by latest user activity so the most-recently-touched
  // session rises to the top, regardless of raw API ordering. `updatedAt`
  // is written on every post/mark-active, so it's the closest shipped
  // signal for "where the user worked most recently."
  const sorted = [...sessions].sort((a, b) => {
    const ta = new Date(a.updatedAt).getTime();
    const tb = new Date(b.updatedAt).getTime();
    if (tb !== ta) return tb - ta;
    return a.id.localeCompare(b.id);
  });

  return (
    <ul className="overflow-y-auto px-2 pb-2" role="list">
      {sorted.map((s) => {
        const active = s.id === activeSessionId;
        const deleting = deletingSessionId === s.id;
        return (
          <li key={s.id} className="group relative">
            <Link
              to={scopedPath(`/agent/${s.id}`)}
              data-active={active}
              className={[
                "flex h-11 items-center gap-2 rounded-sm pl-2 pr-9 transition-colors",
                active ? "mk-active" : "hover:bg-mk-depth",
                deleting ? "opacity-40" : "",
              ].join(" ")}
            >
              <SessionStatusDot status={s.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-mk-crest">
                  {s.title ?? "untitled session"}
                </div>
                <div className="truncate font-mono text-[10.5px] uppercase tracking-[0.08em] text-mk-tide">
                  {sessionMeta(s)}
                </div>
              </div>
            </Link>

            <button
              type="button"
              disabled={deleting}
              aria-label={`Delete session ${s.title ?? s.id}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(s.id);
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-xs text-mk-tide opacity-0 transition-all hover:bg-mk-ridge hover:text-mk-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <CloseIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M3 3L9 9M9 3L3 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
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
  return (
    <span
      aria-label={`status: ${status}`}
      className={["inline-block h-1.5 w-1.5 shrink-0 rounded-full", bg].join(" ")}
    />
  );
}

function tierSlug(tier: SessionSummary["tier"]): string {
  if (tier === "no-agent") return "no-agent";
  if (tier === "local-agent") return "local";
  return "cloud";
}

function sessionMeta(session: SessionSummary): string {
  if (session.activeModel) return `${session.activeModel} · ${tierSlug(session.tier)}`;
  return `${tierSlug(session.tier)} · ${shorten(session.id)}`;
}

function shorten(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-2)}` : id;
}
