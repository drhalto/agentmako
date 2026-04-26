import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { JsonValue } from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";
import type {
  QueryWorkflowFollowupsOptions,
  WorkflowFollowupInsert,
  WorkflowFollowupRecord,
} from "./types.js";

interface WorkflowFollowupRow {
  followup_id: string;
  project_id: string;
  origin_query_id: string;
  origin_action_id: string;
  origin_packet_id: string | null;
  origin_packet_family: WorkflowFollowupRecord["originPacketFamily"];
  origin_query_kind: WorkflowFollowupRecord["originQueryKind"];
  executed_tool_name: string;
  executed_input_json: string;
  result_packet_id: string;
  result_packet_family: WorkflowFollowupRecord["resultPacketFamily"];
  result_query_id: string;
  request_id: string | null;
  created_at: string;
}

function mapWorkflowFollowupRow(row: WorkflowFollowupRow | undefined): WorkflowFollowupRecord | null {
  if (!row) {
    return null;
  }

  return {
    followupId: row.followup_id,
    projectId: row.project_id,
    originQueryId: row.origin_query_id,
    originActionId: row.origin_action_id,
    originPacketId: row.origin_packet_id ?? undefined,
    originPacketFamily: row.origin_packet_family,
    originQueryKind: row.origin_query_kind,
    executedToolName: row.executed_tool_name,
    executedInput: parseJson<JsonValue>(row.executed_input_json, null) ?? {},
    resultPacketId: row.result_packet_id,
    resultPacketFamily: row.result_packet_family,
    resultQueryId: row.result_query_id,
    requestId: row.request_id ?? undefined,
    createdAt: row.created_at,
  };
}

export function insertWorkflowFollowupImpl(
  db: DatabaseSync,
  input: WorkflowFollowupInsert,
): WorkflowFollowupRecord {
  const followupId = randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();

  db.prepare(`
    INSERT INTO workflow_followups(
      followup_id,
      project_id,
      origin_query_id,
      origin_action_id,
      origin_packet_id,
      origin_packet_family,
      origin_query_kind,
      executed_tool_name,
      executed_input_json,
      result_packet_id,
      result_packet_family,
      result_query_id,
      request_id,
      created_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    followupId,
    input.projectId,
    input.originQueryId,
    input.originActionId,
    input.originPacketId ?? null,
    input.originPacketFamily,
    input.originQueryKind,
    input.executedToolName,
    stringifyJson(input.executedInput),
    input.resultPacketId,
    input.resultPacketFamily,
    input.resultQueryId,
    input.requestId ?? null,
    createdAt,
  );

  const row = db.prepare(`
    SELECT
      followup_id,
      project_id,
      origin_query_id,
      origin_action_id,
      origin_packet_id,
      origin_packet_family,
      origin_query_kind,
      executed_tool_name,
      executed_input_json,
      result_packet_id,
      result_packet_family,
      result_query_id,
      request_id,
      created_at
    FROM workflow_followups
    WHERE followup_id = ?
  `).get(followupId) as WorkflowFollowupRow | undefined;

  return mapWorkflowFollowupRow(row) as WorkflowFollowupRecord;
}

export function queryWorkflowFollowupsImpl(
  db: DatabaseSync,
  options: QueryWorkflowFollowupsOptions = {},
): WorkflowFollowupRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (options.originQueryId) {
    clauses.push("origin_query_id = ?");
    values.push(options.originQueryId);
  }

  if (options.originActionId) {
    clauses.push("origin_action_id = ?");
    values.push(options.originActionId);
  }

  if (options.requestId) {
    clauses.push("request_id = ?");
    values.push(options.requestId);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 50;
  const rows = db.prepare(`
    SELECT
      followup_id,
      project_id,
      origin_query_id,
      origin_action_id,
      origin_packet_id,
      origin_packet_family,
      origin_query_kind,
      executed_tool_name,
      executed_input_json,
      result_packet_id,
      result_packet_family,
      result_query_id,
      request_id,
      created_at
    FROM workflow_followups
    ${whereClause}
    ORDER BY created_at DESC, followup_id DESC
    LIMIT ?
  `).all(...values, limit) as unknown as WorkflowFollowupRow[];

  return rows
    .map((row) => mapWorkflowFollowupRow(row))
    .filter((row): row is WorkflowFollowupRecord => row != null);
}
