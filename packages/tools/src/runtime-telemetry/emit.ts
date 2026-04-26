import type { RuntimeUsefulnessEvent } from "@mako-ai/contracts";
import type {
  UsefulnessEventInsert,
  UsefulnessEventRecord,
} from "@mako-ai/store";

/**
 * Phase 8.1a: runtime telemetry emitter.
 *
 * Thin write-path adapter so 8.1b decision sites can emit usefulness
 * events without depending on `ProjectStore` directly or handling write
 * errors themselves.
 *
 * Invariants:
 *
 * - write failures are logged but never thrown to the caller — a failed
 *   telemetry row must not fail the user-facing answer / tool call
 * - the emitter is fire-and-forget from the caller's perspective; the
 *   store's append-only triggers are the real durability guarantee
 * - the emitter is a function, not a class, so it can be bound once per
 *   call site and passed through as a plain value
 */

export interface RuntimeTelemetryEmitterOptions {
  /**
   * Insert path. Typically `projectStore.insertUsefulnessEvent.bind(projectStore)`.
   * Decoupled from `ProjectStore` so tests and alternate backends can
   * swap the writer without changing every call site.
   */
  insert: (input: UsefulnessEventInsert) => UsefulnessEventRecord;
  /**
   * Optional logger for write failures. Defaults to a no-op so silencing
   * the emitter is one option away — keep the happy path quiet.
   */
  logger?: (message: string, error?: unknown) => void;
}

export type RuntimeTelemetryEmitter = (event: RuntimeUsefulnessEvent) => void;

export function createRuntimeTelemetryEmitter(
  options: RuntimeTelemetryEmitterOptions,
): RuntimeTelemetryEmitter {
  const { insert, logger } = options;
  return (event) => {
    try {
      insert({
        eventId: event.eventId,
        projectId: event.projectId,
        requestId: event.requestId,
        traceId: event.traceId,
        capturedAt: event.capturedAt,
        decisionKind: event.decisionKind,
        family: event.family,
        toolName: event.toolName,
        grade: event.grade,
        reasonCodes: event.reasonCodes,
        observedFollowupLinked: event.observedFollowupLinked,
        reason: event.reason,
      });
    } catch (err) {
      logger?.("[runtime-telemetry] write failed", err);
    }
  };
}

/**
 * A silent emitter that drops every event. Use when telemetry is
 * explicitly disabled for a call site — exposed so the wiring shape
 * stays identical in the "silenced" case.
 */
export const NOOP_RUNTIME_TELEMETRY_EMITTER: RuntimeTelemetryEmitter = () => {};
