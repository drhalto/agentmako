import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  RuntimeUsefulnessDecisionKind,
  RuntimeUsefulnessGrade,
} from "@mako-ai/contracts";
import { RuntimeUsefulnessEventSchema } from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";
import type {
  QueryUsefulnessEventsOptions,
  UsefulnessEventAggregationFilter,
  UsefulnessEventDecisionKindCount,
  UsefulnessEventFamilyCount,
  UsefulnessEventGradeCount,
  UsefulnessEventInsert,
  UsefulnessEventRecord,
} from "./types.js";

interface UsefulnessEventRow {
  event_id: string;
  project_id: string;
  request_id: string;
  trace_id: string | null;
  captured_at: string;
  decision_kind: RuntimeUsefulnessDecisionKind;
  family: string;
  tool_name: string | null;
  grade: RuntimeUsefulnessGrade;
  reason_codes_json: string;
  observed_followup_linked: number | null;
  reason: string | null;
}

function mapUsefulnessEventRow(
  row: UsefulnessEventRow | undefined,
): UsefulnessEventRecord | null {
  if (!row) {
    return null;
  }

  const record: UsefulnessEventRecord = {
    eventId: row.event_id,
    projectId: row.project_id,
    requestId: row.request_id,
    capturedAt: row.captured_at,
    decisionKind: row.decision_kind,
    family: row.family,
    grade: row.grade,
    reasonCodes: parseJson<string[]>(row.reason_codes_json, []) ?? [],
  };

  if (row.trace_id !== null) {
    record.traceId = row.trace_id;
  }
  if (row.tool_name !== null) {
    record.toolName = row.tool_name;
  }
  if (row.observed_followup_linked !== null) {
    record.observedFollowupLinked = row.observed_followup_linked === 1;
  }
  if (row.reason !== null) {
    record.reason = row.reason;
  }

  return record;
}

export function insertUsefulnessEventImpl(
  db: DatabaseSync,
  input: UsefulnessEventInsert,
): UsefulnessEventRecord {
  const eventId = input.eventId ?? randomUUID();
  const capturedAt = input.capturedAt ?? new Date().toISOString();

  // Phase-8.0 contract boundary. The schema enforces ISO-8601 capturedAt,
  // non-empty projectId / requestId / family, grade / decisionKind enums,
  // and non-empty reasonCodes entries — SQL CHECK constraints only cover
  // the enum fields, so we parse the fully-formed event here so direct
  // store callers and emitter callers alike get the same rejection.
  const parsed = RuntimeUsefulnessEventSchema.parse({
    eventId,
    projectId: input.projectId,
    requestId: input.requestId,
    traceId: input.traceId,
    capturedAt,
    decisionKind: input.decisionKind,
    family: input.family,
    toolName: input.toolName,
    grade: input.grade,
    reasonCodes: input.reasonCodes,
    observedFollowupLinked: input.observedFollowupLinked,
    reason: input.reason,
  });

  const observedFollowupLinked =
    typeof parsed.observedFollowupLinked === "boolean"
      ? parsed.observedFollowupLinked
        ? 1
        : 0
      : null;

  db.prepare(`
    INSERT INTO mako_usefulness_events(
      event_id,
      project_id,
      request_id,
      trace_id,
      captured_at,
      decision_kind,
      family,
      tool_name,
      grade,
      reason_codes_json,
      observed_followup_linked,
      reason
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    parsed.eventId,
    parsed.projectId,
    parsed.requestId,
    parsed.traceId ?? null,
    parsed.capturedAt,
    parsed.decisionKind,
    parsed.family,
    parsed.toolName ?? null,
    parsed.grade,
    stringifyJson(parsed.reasonCodes),
    observedFollowupLinked,
    parsed.reason ?? null,
  );

  const row = db
    .prepare(`
      SELECT
        event_id,
        project_id,
        request_id,
        trace_id,
        captured_at,
        decision_kind,
        family,
        tool_name,
        grade,
        reason_codes_json,
        observed_followup_linked,
        reason
      FROM mako_usefulness_events
      WHERE event_id = ?
    `)
    .get(eventId) as UsefulnessEventRow | undefined;

  return mapUsefulnessEventRow(row) as UsefulnessEventRecord;
}

export function queryUsefulnessEventsImpl(
  db: DatabaseSync,
  options: QueryUsefulnessEventsOptions = {},
): UsefulnessEventRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (options.projectId) {
    clauses.push("project_id = ?");
    values.push(options.projectId);
  }
  if (options.decisionKind) {
    clauses.push("decision_kind = ?");
    values.push(options.decisionKind);
  }
  if (options.family) {
    clauses.push("family = ?");
    values.push(options.family);
  }
  if (options.requestId) {
    clauses.push("request_id = ?");
    values.push(options.requestId);
  }
  if (options.since) {
    clauses.push("captured_at >= ?");
    values.push(options.since);
  }
  if (options.until) {
    clauses.push("captured_at <= ?");
    values.push(options.until);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 100;

  const rows = db
    .prepare(`
      SELECT
        event_id,
        project_id,
        request_id,
        trace_id,
        captured_at,
        decision_kind,
        family,
        tool_name,
        grade,
        reason_codes_json,
        observed_followup_linked,
        reason
      FROM mako_usefulness_events
      ${whereClause}
      ORDER BY captured_at DESC, event_id DESC
      LIMIT ?
    `)
    .all(...values, limit) as unknown as UsefulnessEventRow[];

  return rows
    .map((row) => mapUsefulnessEventRow(row))
    .filter((record): record is UsefulnessEventRecord => record != null);
}

// ===== Aggregates =====
//
// SQL-level GROUP BY so aggregates stay accurate regardless of table size.
// The report tool previously aggregated in process over a capped slice,
// which silently lost history once matching rows exceeded the cap.

function buildWhereClause(filter: UsefulnessEventAggregationFilter): {
  sql: string;
  values: Array<string | number>;
} {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (filter.projectId) {
    clauses.push("project_id = ?");
    values.push(filter.projectId);
  }
  if (filter.decisionKind) {
    clauses.push("decision_kind = ?");
    values.push(filter.decisionKind);
  }
  if (filter.family) {
    clauses.push("family = ?");
    values.push(filter.family);
  }
  if (filter.requestId) {
    clauses.push("request_id = ?");
    values.push(filter.requestId);
  }
  if (filter.since) {
    clauses.push("captured_at >= ?");
    values.push(filter.since);
  }
  if (filter.until) {
    clauses.push("captured_at <= ?");
    values.push(filter.until);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

export function countUsefulnessEventsImpl(
  db: DatabaseSync,
  filter: UsefulnessEventAggregationFilter = {},
): number {
  const { sql, values } = buildWhereClause(filter);
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM mako_usefulness_events ${sql}`)
    .get(...values) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function aggregateUsefulnessEventsByDecisionKindImpl(
  db: DatabaseSync,
  filter: UsefulnessEventAggregationFilter = {},
): UsefulnessEventDecisionKindCount[] {
  const { sql, values } = buildWhereClause(filter);
  const rows = db
    .prepare(`
      SELECT decision_kind, COUNT(*) AS count
      FROM mako_usefulness_events
      ${sql}
      GROUP BY decision_kind
      ORDER BY count DESC, decision_kind ASC
    `)
    .all(...values) as unknown as Array<{
      decision_kind: RuntimeUsefulnessDecisionKind;
      count: number;
    }>;
  return rows.map((row) => ({
    decisionKind: row.decision_kind,
    count: row.count,
  }));
}

export function aggregateUsefulnessEventsByFamilyImpl(
  db: DatabaseSync,
  filter: UsefulnessEventAggregationFilter = {},
): UsefulnessEventFamilyCount[] {
  const { sql, values } = buildWhereClause(filter);
  const rows = db
    .prepare(`
      SELECT decision_kind, family, COUNT(*) AS count
      FROM mako_usefulness_events
      ${sql}
      GROUP BY decision_kind, family
      ORDER BY count DESC, decision_kind ASC, family ASC
    `)
    .all(...values) as unknown as Array<{
      decision_kind: RuntimeUsefulnessDecisionKind;
      family: string;
      count: number;
    }>;
  return rows.map((row) => ({
    decisionKind: row.decision_kind,
    family: row.family,
    count: row.count,
  }));
}

export function aggregateUsefulnessEventsByGradeImpl(
  db: DatabaseSync,
  filter: UsefulnessEventAggregationFilter = {},
): UsefulnessEventGradeCount[] {
  const { sql, values } = buildWhereClause(filter);
  const rows = db
    .prepare(`
      SELECT grade, COUNT(*) AS count
      FROM mako_usefulness_events
      ${sql}
      GROUP BY grade
      ORDER BY count DESC, grade ASC
    `)
    .all(...values) as unknown as Array<{
      grade: UsefulnessEventGradeCount["grade"];
      count: number;
    }>;
  return rows.map((row) => ({ grade: row.grade, count: row.count }));
}
