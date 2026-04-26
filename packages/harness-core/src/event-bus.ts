/**
 * Session event bus.
 *
 * Every event both (1) persists into `harness_session_events` via the store
 * and (2) fans out to in-process subscribers so the HTTP SSE route and CLI can
 * stream deltas live. The persistence side is the spine — SSE clients can
 * resume from `?after=<ordinal>` after a reconnect or process restart by
 * reading the same table.
 */

import { EventEmitter } from "node:events";
import type { HarnessEvent } from "@mako-ai/harness-contracts";
import type { ProjectStore } from "@mako-ai/store";

export interface EmittedSessionEvent {
  sessionId: string;
  ordinal: number;
  event: HarnessEvent;
  createdAt: string;
}

export class SessionEventBus {
  private readonly emitter = new EventEmitter();

  constructor(private readonly store: ProjectStore) {
    this.emitter.setMaxListeners(128);
  }

  emit(sessionId: string, event: HarnessEvent): EmittedSessionEvent {
    const row = this.store.insertHarnessSessionEvent({
      sessionId,
      kind: event.kind,
      payload: event,
    });
    const emitted: EmittedSessionEvent = {
      sessionId,
      ordinal: row.ordinal,
      event,
      createdAt: row.createdAt,
    };
    this.emitter.emit(sessionId, emitted);
    this.emitter.emit("*", emitted);
    return emitted;
  }

  subscribe(sessionId: string, handler: (e: EmittedSessionEvent) => void): () => void {
    this.emitter.on(sessionId, handler);
    return () => this.emitter.off(sessionId, handler);
  }

  replay(sessionId: string, afterOrdinal?: number): EmittedSessionEvent[] {
    const rows = this.store.listHarnessSessionEvents(sessionId, afterOrdinal);
    return rows.map((row) => ({
      sessionId: row.sessionId,
      ordinal: row.ordinal,
      event: row.payload as HarnessEvent,
      createdAt: row.createdAt,
    }));
  }
}
