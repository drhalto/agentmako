/**
 * Session resume — Phase 3.4.
 *
 * Resume is pure event-replay: read `harness_session_events` in ordinal
 * order, derive state, emit a synthetic `resume.pending_approvals` event
 * when there are `permission.request` rows with no matching
 * `permission.decision`, and return the last-known ordinal so SSE clients
 * can pick up from there.
 *
 * Crucially, resume does NOT re-invoke tools. Pending approvals from before
 * the crash are *abandoned* — the live tool-call Promise that the parent
 * `streamText` loop was awaiting is gone with the process. The session is
 * still coherent (conversation state is in `harness_messages` + parts, all
 * persisted), but any mid-flight tool call is effectively cancelled. The
 * caller surface (UI / CLI) typically prompts the human to post a new user
 * message to continue.
 *
 * Version fencing: `harness_sessions.harness_version` is stamped at session
 * creation. If the stored major component differs from the running binary's
 * `HARNESS_VERSION` major, resume refuses with `resume/version-mismatch` —
 * event semantics may have shifted between majors in ways replay cannot
 * reconcile.
 */

import { createLogger } from "@mako-ai/logger";
import type { HarnessSessionEventRow, ProjectStore } from "@mako-ai/store";
import type { SessionEventBus } from "./event-bus.js";
import { HARNESS_VERSION } from "./harness.js";

const resumeLogger = createLogger("mako-harness-resume");

export interface ResumeInput {
  sessionId: string;
  store: ProjectStore;
  bus: SessionEventBus;
}

export interface PendingApprovalSnapshot {
  requestId: string;
  tool: string;
  /** Ordinal of the originating `permission.request` event. */
  requestOrdinal: number;
}

export interface ResumeResult {
  sessionId: string;
  /** Ordinal of the last event in `harness_session_events`. Clients should stream from here. */
  resumedFromOrdinal: number;
  /** Total event count replayed. */
  eventCount: number;
  /**
   * Approvals that were `permission.request`ed but never resolved. Their
   * in-memory `pendingBySession` Promises are gone; the UI should mark them
   * as abandoned unless it explicitly re-requests them by posting a new
   * user message that re-triggers the tool call.
   */
  pendingApprovals: PendingApprovalSnapshot[];
}

export class ResumeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "resume/session-not-found"
      | "resume/version-mismatch"
      | "resume/event-ordering-violation",
  ) {
    super(message);
    this.name = "ResumeError";
  }
}

export async function resumeSession(input: ResumeInput): Promise<ResumeResult> {
  const { sessionId, store, bus } = input;

  const session = store.getHarnessSession(sessionId);
  if (!session) {
    throw new ResumeError(
      `session not found: ${sessionId}`,
      "resume/session-not-found",
    );
  }

  // Version fence. NULL harnessVersion means the row was written by a
  // pre-3.4 build (the column defaulted NULL on migration); we treat that
  // as "legacy", equal to the current major so resume still works against
  // sessions created immediately before 3.4 ships.
  const storedMajor = extractMajor(session.harnessVersion);
  const runningMajor = extractMajor(HARNESS_VERSION);
  if (storedMajor !== null && storedMajor !== runningMajor) {
    throw new ResumeError(
      `session ${sessionId} was created under harness v${session.harnessVersion}; running binary is v${HARNESS_VERSION} (major ${runningMajor}). Refusing resume — event semantics may differ across majors.`,
      "resume/version-mismatch",
    );
  }

  const events = store.listHarnessSessionEvents(sessionId);
  assertOrdinalsMonotonic(events, sessionId);

  const pending = collectUnresolvedApprovals(events);
  const lastOrdinal = events.length > 0 ? events[events.length - 1]!.ordinal : -1;

  if (pending.length > 0) {
    bus.emit(sessionId, {
      kind: "resume.pending_approvals",
      requestIds: pending.map((p) => p.requestId),
      note:
        "Approvals listed here were outstanding when the previous harness process exited. Their tool-call Promises are no longer live — post a new user message to re-trigger the tool call if you want to proceed.",
    });
  }

  resumeLogger.info("resume.complete", {
    sessionId,
    resumedFromOrdinal: lastOrdinal,
    eventCount: events.length,
    pendingApprovals: pending.length,
  });

  return {
    sessionId,
    resumedFromOrdinal: lastOrdinal,
    eventCount: events.length,
    pendingApprovals: pending,
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function assertOrdinalsMonotonic(
  events: HarnessSessionEventRow[],
  sessionId: string,
): void {
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!;
    const curr = events[i]!;
    if (curr.ordinal !== prev.ordinal + 1) {
      throw new ResumeError(
        `session ${sessionId}: non-contiguous event ordinals at ${prev.ordinal} → ${curr.ordinal} (gap indicates corrupted row)`,
        "resume/event-ordering-violation",
      );
    }
  }
}

function collectUnresolvedApprovals(
  events: HarnessSessionEventRow[],
): PendingApprovalSnapshot[] {
  const requested = new Map<string, { tool: string; ordinal: number }>();
  const resolved = new Set<string>();

  for (const ev of events) {
    if (ev.kind === "permission.request") {
      const payload = ev.payload as { requestId?: string; tool?: string } | null;
      if (payload?.requestId) {
        requested.set(payload.requestId, {
          tool: payload.tool ?? "(unknown)",
          ordinal: ev.ordinal,
        });
      }
    } else if (ev.kind === "permission.decision") {
      const payload = ev.payload as { requestId?: string } | null;
      if (payload?.requestId) {
        resolved.add(payload.requestId);
      }
    }
  }

  const out: PendingApprovalSnapshot[] = [];
  for (const [requestId, info] of requested.entries()) {
    if (resolved.has(requestId)) continue;
    out.push({
      requestId,
      tool: info.tool,
      requestOrdinal: info.ordinal,
    });
  }
  return out;
}

function extractMajor(version: string | null): number | null {
  if (!version) return null;
  const match = /^(\d+)\./.exec(version.trim());
  if (!match) return null;
  return Number.parseInt(match[1]!, 10);
}
