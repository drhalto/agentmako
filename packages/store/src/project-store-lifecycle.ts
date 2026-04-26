import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseJson, stringifyJson } from "./json.js";
import type {
  LifecycleEventInsert,
  LifecycleEventRecord,
  QueryLifecycleEventsOptions,
} from "./types.js";

interface LifecycleEventRow {
  event_id: string;
  project_id: string;
  event_type: LifecycleEventRecord["eventType"];
  outcome: LifecycleEventRecord["outcome"];
  started_at: string;
  finished_at: string;
  duration_ms: number;
  metadata_json: string;
  error_text: string | null;
}

function mapLifecycleEventRow(row: LifecycleEventRow | undefined): LifecycleEventRecord | null {
  if (!row) {
    return null;
  }

  return {
    eventId: row.event_id,
    projectId: row.project_id,
    eventType: row.event_type,
    outcome: row.outcome,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    metadata: parseJson(row.metadata_json, {}),
    errorText: row.error_text ?? undefined,
  };
}

export function insertLifecycleEventImpl(db: DatabaseSync, input: LifecycleEventInsert): LifecycleEventRecord {
  const eventId = randomUUID();

  db
    .prepare(`
      INSERT INTO lifecycle_events(
        event_id,
        project_id,
        event_type,
        outcome,
        started_at,
        finished_at,
        duration_ms,
        metadata_json,
        error_text
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      eventId,
      input.projectId,
      input.eventType,
      input.outcome,
      input.startedAt,
      input.finishedAt,
      input.durationMs,
      stringifyJson(input.metadata ?? {}),
      input.errorText ?? null,
    );

  const row = db
    .prepare(`
      SELECT
        event_id,
        project_id,
        event_type,
        outcome,
        started_at,
        finished_at,
        duration_ms,
        metadata_json,
        error_text
      FROM lifecycle_events
      WHERE event_id = ?
    `)
    .get(eventId) as LifecycleEventRow | undefined;

  return mapLifecycleEventRow(row) as LifecycleEventRecord;
}

export function queryLifecycleEventsImpl(
  db: DatabaseSync,
  options: QueryLifecycleEventsOptions = {},
): LifecycleEventRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (options.eventType) {
    clauses.push("event_type = ?");
    values.push(options.eventType);
  }

  if (options.outcome) {
    clauses.push("outcome = ?");
    values.push(options.outcome);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(`
      SELECT
        event_id,
        project_id,
        event_type,
        outcome,
        started_at,
        finished_at,
        duration_ms,
        metadata_json,
        error_text
      FROM lifecycle_events
      ${whereClause}
      ORDER BY finished_at DESC, started_at DESC, event_id DESC
      LIMIT ?
    `)
    .all(...values, limit) as unknown as LifecycleEventRow[];

  return rows
    .map((row) => mapLifecycleEventRow(row))
    .filter((row): row is LifecycleEventRecord => row !== null);
}
