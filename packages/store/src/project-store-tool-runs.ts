import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { JsonValue } from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";
import type { QueryToolRunsOptions, ToolRunInsert, ToolRunOutcome, ToolRunRecord } from "./types.js";

interface ToolRunRow {
  run_id: string;
  project_id: string | null;
  tool_name: string;
  input_summary_json: string;
  output_summary_json: string | null;
  payload_json: string | null;
  outcome: ToolRunOutcome;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  request_id: string | null;
  error_text: string | null;
}

function mapToolRunRow(row: ToolRunRow | undefined): ToolRunRecord | null {
  if (!row) {
    return null;
  }

  return {
    runId: row.run_id,
    projectId: row.project_id ?? undefined,
    toolName: row.tool_name,
    inputSummary: parseJson<JsonValue>(row.input_summary_json, null),
    outputSummary: row.output_summary_json == null ? undefined : parseJson<JsonValue>(row.output_summary_json, null),
    payload: row.payload_json == null ? undefined : parseJson<JsonValue>(row.payload_json, null),
    outcome: row.outcome,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    requestId: row.request_id ?? undefined,
    errorText: row.error_text ?? undefined,
  };
}

export function insertToolRunImpl(db: DatabaseSync, input: ToolRunInsert): ToolRunRecord {
  const runId = randomUUID();

  db
    .prepare(`
      INSERT INTO tool_runs(
        run_id,
        project_id,
        tool_name,
        input_summary_json,
        output_summary_json,
        payload_json,
        outcome,
        started_at,
        finished_at,
        duration_ms,
        request_id,
        error_text
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      runId,
      input.projectId ?? null,
      input.toolName,
      stringifyJson(input.inputSummary),
      input.outputSummary == null ? null : stringifyJson(input.outputSummary),
      input.payload == null ? null : stringifyJson(input.payload),
      input.outcome,
      input.startedAt,
      input.finishedAt,
      input.durationMs,
      input.requestId ?? null,
      input.errorText ?? null,
    );

  const row = db
    .prepare(`
      SELECT
        run_id,
        project_id,
        tool_name,
        input_summary_json,
        output_summary_json,
        payload_json,
        outcome,
        started_at,
        finished_at,
        duration_ms,
        request_id,
        error_text
      FROM tool_runs
      WHERE run_id = ?
    `)
    .get(runId) as ToolRunRow | undefined;

  return mapToolRunRow(row) as ToolRunRecord;
}

export function queryToolRunsImpl(db: DatabaseSync, options: QueryToolRunsOptions = {}): ToolRunRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (options.toolName) {
    clauses.push("tool_name = ?");
    values.push(options.toolName);
  }

  if (options.outcome) {
    clauses.push("outcome = ?");
    values.push(options.outcome);
  }

  if (options.requestId) {
    clauses.push("request_id = ?");
    values.push(options.requestId);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(`
      SELECT
        run_id,
        project_id,
        tool_name,
        input_summary_json,
        output_summary_json,
        payload_json,
        outcome,
        started_at,
        finished_at,
        duration_ms,
        request_id,
        error_text
      FROM tool_runs
      ${whereClause}
      ORDER BY finished_at DESC, started_at DESC, run_id DESC
      LIMIT ?
    `)
    .all(...values, limit) as unknown as ToolRunRow[];

  return rows
    .map((row) => mapToolRunRow(row))
    .filter((row): row is ToolRunRecord => row !== null);
}
