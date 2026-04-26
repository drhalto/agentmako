/**
 * Subscribes to the harness SSE stream for a session.
 *
 * Contract:
 *   - Opens `/api/v1/sessions/:id/stream?after=<lastOrdinal>` so reconnects
 *     resume from the last seen ordinal rather than replaying from scratch.
 *   - Each SSE frame is a JSON envelope: `{ sessionId, ordinal, event, createdAt }`
 *     where `event` is a discriminated `HarnessEvent`.
 *   - `EventSource` handles basic reconnects itself, but we hold the `lastOrdinal`
 *     in a ref so a manual `reconnect()` (e.g. after a visibility change) picks
 *     up from the right place.
 *
 * Callers get `events[]` (accumulated for this session) and `status`:
 *   - `connecting`     — the initial open
 *   - `open`           — receiving frames
 *   - `reconnecting`   — the browser is retrying
 *   - `error`          — unrecoverable; caller should surface it
 *   - `closed`         — intentional shutdown (unmount, manual close)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { HarnessEvent } from "../api-types";

export interface HarnessStreamEvent {
  sessionId: string;
  ordinal: number;
  event: HarnessEvent;
  createdAt: string;
}

export type HarnessStreamStatus = "connecting" | "open" | "reconnecting" | "error" | "closed";

export interface UseHarnessStreamOptions {
  sessionId: string | null | undefined;
  /**
   * If true, the stream stays open indefinitely. If false, we close the
   * connection as soon as we see `turn.done` or `error` — useful for one-shot
   * request/response clients. Default: true (the dashboard watches
   * continuously).
   */
  persistent?: boolean;
}

export interface UseHarnessStreamResult {
  events: HarnessStreamEvent[];
  status: HarnessStreamStatus;
  lastOrdinal: number;
  reconnect(): void;
  close(): void;
}

export function useHarnessStream(
  options: UseHarnessStreamOptions,
): UseHarnessStreamResult {
  const { sessionId, persistent = true } = options;
  const [events, setEvents] = useState<HarnessStreamEvent[]>([]);
  const [status, setStatus] = useState<HarnessStreamStatus>("connecting");
  const lastOrdinalRef = useRef<number>(-1);
  const sourceRef = useRef<EventSource | null>(null);
  const closedByUserRef = useRef<boolean>(false);

  const open = useCallback(
    (sid: string, options: { silent?: boolean } = {}) => {
      closedByUserRef.current = false;
      const after = lastOrdinalRef.current;
      const query = after >= 0 ? `?after=${after}` : "";
      const es = new EventSource(`/api/v1/sessions/${sid}/stream${query}`);
      sourceRef.current = es;
      if (!options.silent) setStatus("connecting");

      es.onopen = () => {
        setStatus("open");
      };

      es.onerror = () => {
        if (closedByUserRef.current) {
          setStatus("closed");
          return;
        }
        // Server closes the stream cleanly after each `turn.done` (useful
        // for curl / CLI clients that expect one-shot requests). For the
        // dashboard we want continuous observation: silently reopen from
        // the next ordinal so the user never sees a "reconnecting" flicker.
        if (persistent && es.readyState === EventSource.CLOSED) {
          try {
            es.close();
          } catch {
            /* swallow */
          }
          // Defer so we don't recurse inside the event handler.
          setTimeout(() => {
            if (closedByUserRef.current) return;
            open(sid, { silent: true });
          }, 50);
          return;
        }
        setStatus(es.readyState === EventSource.CLOSED ? "error" : "reconnecting");
      };

      es.onmessage = (raw: MessageEvent<string>) => {
        try {
          const frame = JSON.parse(raw.data) as HarnessStreamEvent;
          // Defensive: reject frames for a different session id.
          if (frame.sessionId !== sid) return;
          lastOrdinalRef.current = Math.max(lastOrdinalRef.current, frame.ordinal);
          setEvents((prev) => [...prev, frame]);

          if (!persistent) {
            const kind = frame.event.kind;
            if (kind === "turn.done" || kind === "error") {
              closedByUserRef.current = true;
              es.close();
              setStatus("closed");
            }
          }
        } catch {
          // Skip malformed frames rather than tearing down the connection.
        }
      };
    },
    [persistent],
  );

  const close = useCallback(() => {
    closedByUserRef.current = true;
    sourceRef.current?.close();
    setStatus("closed");
  }, []);

  const reconnect = useCallback(() => {
    sourceRef.current?.close();
    if (sessionId) open(sessionId);
  }, [open, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setEvents([]);
      lastOrdinalRef.current = -1;
      return;
    }
    // Fresh session → reset state.
    setEvents([]);
    lastOrdinalRef.current = -1;
    open(sessionId);

    return () => {
      closedByUserRef.current = true;
      sourceRef.current?.close();
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return {
    events,
    status,
    lastOrdinal: lastOrdinalRef.current,
    reconnect,
    close,
  };
}
