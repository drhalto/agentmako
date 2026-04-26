import type { DatabaseSync } from "node:sqlite";
import type {
  AnswerTrustState,
  JsonObject,
  JsonValue,
  QueryKind,
  SupportLevel,
} from "@mako-ai/contracts";
import { parseJson } from "./json.js";
import type {
  RecallAnswersOptions,
  RecallAnswersResult,
  RecallToolRunsOptions,
  RecallToolRunsResult,
  RecalledAnswerPacketSummary,
  RecalledAnswerRecord,
  ToolRunOutcome,
  ToolRunRecord,
} from "./types.js";

type SqlValue = string | number | null;

interface RecallAnswerRow {
  trace_id: string;
  query_kind: QueryKind;
  query_text: string;
  support_level: SupportLevel;
  answer_confidence: number | null;
  packet_json: string;
  answer_markdown: string | null;
  created_at: string;
  trust_state: AnswerTrustState | null;
}

interface RecallAnswerQueryResult {
  rows: RecallAnswerRow[];
  matchCount: number;
}

interface AnswerMatchSql {
  sql: string;
  values: SqlValue[];
}

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

const LATEST_TRUST_STATE_SQL = `(
  SELECT evaluations.state
  FROM answer_trust_evaluations evaluations
  WHERE evaluations.trace_id = a.trace_id
  ORDER BY evaluations.created_at DESC, evaluations.evaluation_id DESC
  LIMIT 1
)`;

const ANSWER_SELECT_SQL = `
  SELECT
    a.trace_id,
    a.query_kind,
    a.query_text,
    a.support_level,
    a.answer_confidence,
    a.packet_json,
    a.answer_markdown,
    a.created_at,
    ${LATEST_TRUST_STATE_SQL} AS trust_state
`;

function buildAnswerFilterSql(options: RecallAnswersOptions): {
  sql: string;
  values: SqlValue[];
} {
  const clauses = ["a.project_id = ?"];
  const values: SqlValue[] = [options.projectId];

  if (options.queryKind) {
    clauses.push("a.query_kind = ?");
    values.push(options.queryKind);
  }
  if (options.supportLevel) {
    clauses.push("a.support_level = ?");
    values.push(options.supportLevel);
  }
  if (options.trustState) {
    clauses.push(`${LATEST_TRUST_STATE_SQL} = ?`);
    values.push(options.trustState);
  }
  if (options.since) {
    clauses.push("a.created_at >= ?");
    values.push(options.since);
  }
  if (options.until) {
    clauses.push("a.created_at <= ?");
    values.push(options.until);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

function appendAnswerFilter(filter: { sql: string }, clause: string): string {
  return `${filter.sql ? `${filter.sql} AND` : "WHERE"} ${clause}`;
}

function escapeLikeQuery(query: string): string {
  return query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function buildFtsMatchQuery(query: string): string | null {
  const tokens = query.match(/[^\s"]+/g)?.slice(0, 16) ?? [];
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((token) => `"${token.replace(/"/g, "\"\"")}"`).join(" AND ");
}

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function arrayLength(value: JsonValue | undefined): number | null {
  return Array.isArray(value) ? value.length : null;
}

function summarizePacket(packet: JsonValue, queryKind: QueryKind): RecalledAnswerPacketSummary {
  if (!isRecord(packet)) {
    return {
      family: queryKind,
      basisCount: 0,
      evidenceRefCount: 0,
    };
  }

  const family =
    typeof packet.family === "string"
      ? packet.family
      : typeof packet.packetFamily === "string"
        ? packet.packetFamily
        : typeof packet.queryKind === "string"
          ? packet.queryKind
          : queryKind;

  const basisCount =
    arrayLength(packet.basis) ??
    arrayLength(packet.basisRefs) ??
    arrayLength(packet.basisRefIds) ??
    0;
  const evidenceRefCount =
    arrayLength(packet.evidenceRefs) ??
    arrayLength(packet.evidenceRefIds) ??
    arrayLength(packet.evidence) ??
    0;

  return {
    family,
    basisCount,
    evidenceRefCount,
  };
}

function mapAnswerRow(row: RecallAnswerRow): RecalledAnswerRecord {
  const packet = parseJson<JsonValue>(row.packet_json, {});
  const record: RecalledAnswerRecord = {
    traceId: row.trace_id,
    queryKind: row.query_kind,
    queryText: row.query_text,
    createdAt: row.created_at,
    supportLevel: row.support_level,
    packetSummary: summarizePacket(packet, row.query_kind),
  };

  if (row.trust_state !== null) {
    record.trustState = row.trust_state;
  }
  if (row.answer_confidence !== null) {
    record.answerConfidence = row.answer_confidence;
  }
  if (row.answer_markdown !== null) {
    record.answerMarkdown = row.answer_markdown;
  }

  return record;
}

function queryMatchedAnswerRows(
  db: DatabaseSync,
  match: AnswerMatchSql,
  limit: number,
): RecallAnswerQueryResult {
  const countRow = db
    .prepare(`
      WITH matched(rowid) AS (
        ${match.sql}
      )
      SELECT COUNT(*) AS count FROM matched
    `)
    .get(...match.values) as { count: number } | undefined;

  const rows = db
    .prepare(`
      WITH matched(rowid) AS (
        ${match.sql}
      )
      ${ANSWER_SELECT_SQL}
      FROM matched
      INNER JOIN answer_traces a ON a.rowid = matched.rowid
      ORDER BY a.created_at DESC, a.trace_id DESC
      LIMIT ?
    `)
    .all(...match.values, limit) as unknown as RecallAnswerRow[];

  return {
    rows,
    matchCount: countRow?.count ?? 0,
  };
}

function buildLikeAnswerMatchSql(
  base: { sql: string; values: SqlValue[] },
  query: string,
): AnswerMatchSql {
  const likeQuery = `%${escapeLikeQuery(query)}%`;
  return {
    sql: `
      SELECT a.rowid
      FROM answer_traces a
      ${appendAnswerFilter(base, `(
        a.query_text LIKE ? ESCAPE '\\'
        OR COALESCE(a.answer_markdown, '') LIKE ? ESCAPE '\\'
      )`)}
    `,
    values: [...base.values, likeQuery, likeQuery],
  };
}

function buildFtsAnswerMatchSql(
  base: { sql: string; values: SqlValue[] },
  ftsQuery: string,
): AnswerMatchSql {
  return {
    sql: `
      SELECT a.rowid
      FROM answer_traces_fts
      INNER JOIN answer_traces a ON a.rowid = answer_traces_fts.rowid
      ${appendAnswerFilter(base, "answer_traces_fts MATCH ?")}
    `,
    values: [...base.values, ftsQuery],
  };
}

function queryAnswerRows(
  db: DatabaseSync,
  options: RecallAnswersOptions,
  limit: number,
): RecallAnswerQueryResult {
  const query = options.query?.trim();
  const base = buildAnswerFilterSql(options);

  if (!query) {
    const countRow = db
      .prepare(`SELECT COUNT(*) AS count FROM answer_traces a ${base.sql}`)
      .get(...base.values) as { count: number } | undefined;
    const rows = db
      .prepare(`
        ${ANSWER_SELECT_SQL}
        FROM answer_traces a
        ${base.sql}
        ORDER BY a.created_at DESC, a.trace_id DESC
        LIMIT ?
      `)
      .all(...base.values, limit) as unknown as RecallAnswerRow[];
    return {
      rows,
      matchCount: countRow?.count ?? 0,
    };
  }

  const likeMatch = buildLikeAnswerMatchSql(base, query);
  const ftsQuery = buildFtsMatchQuery(query);
  if (ftsQuery) {
    const ftsMatch = buildFtsAnswerMatchSql(base, ftsQuery);
    try {
      return queryMatchedAnswerRows(
        db,
        {
          sql: `${ftsMatch.sql}\nUNION\n${likeMatch.sql}`,
          values: [...ftsMatch.values, ...likeMatch.values],
        },
        limit,
      );
    } catch {
      // Migration-created FTS is an accelerator. LIKE below is the correctness path
      // for legacy DBs and exact identifiers that tokenizers may split differently.
    }
  }

  return queryMatchedAnswerRows(db, likeMatch, limit);
}

export function recallAnswersImpl(
  db: DatabaseSync,
  options: RecallAnswersOptions,
): RecallAnswersResult {
  const limit = options.limit ?? 5;
  const result = queryAnswerRows(db, options, limit);
  return {
    answers: result.rows.map((row) => mapAnswerRow(row)),
    matchCount: result.matchCount,
  };
}

function buildToolRunFilterSql(options: RecallToolRunsOptions): {
  sql: string;
  values: SqlValue[];
} {
  const clauses = ["project_id = ?"];
  const values: SqlValue[] = [options.projectId];

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
  if (options.since) {
    clauses.push("finished_at >= ?");
    values.push(options.since);
  }
  if (options.until) {
    clauses.push("finished_at <= ?");
    values.push(options.until);
  }

  return {
    sql: `WHERE ${clauses.join(" AND ")}`,
    values,
  };
}

function mapToolRunRow(row: ToolRunRow, includePayload: boolean): ToolRunRecord {
  const record: ToolRunRecord = {
    runId: row.run_id,
    toolName: row.tool_name,
    inputSummary: parseJson<JsonValue>(row.input_summary_json, null),
    outcome: row.outcome,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
  };

  if (row.project_id !== null) {
    record.projectId = row.project_id;
  }
  if (row.output_summary_json !== null) {
    record.outputSummary = parseJson<JsonValue>(row.output_summary_json, null);
  }
  if (includePayload && row.payload_json !== null) {
    record.payload = parseJson<JsonValue>(row.payload_json, null);
  }
  if (row.request_id !== null) {
    record.requestId = row.request_id;
  }
  if (row.error_text !== null) {
    record.errorText = row.error_text;
  }

  return record;
}

export function recallToolRunsImpl(
  db: DatabaseSync,
  options: RecallToolRunsOptions,
): RecallToolRunsResult {
  const filter = buildToolRunFilterSql(options);
  const limit = options.limit ?? 50;
  const includePayload = options.includePayload === true;
  const payloadSelect = includePayload ? "payload_json" : "NULL AS payload_json";
  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM tool_runs ${filter.sql}`)
    .get(...filter.values) as { count: number } | undefined;
  const rows = db
    .prepare(`
      SELECT
        run_id,
        project_id,
        tool_name,
        input_summary_json,
        output_summary_json,
        ${payloadSelect},
        outcome,
        started_at,
        finished_at,
        duration_ms,
        request_id,
        error_text
      FROM tool_runs
      ${filter.sql}
      ORDER BY finished_at DESC, started_at DESC, run_id DESC
      LIMIT ?
    `)
    .all(...filter.values, limit) as unknown as ToolRunRow[];

  return {
    toolRuns: rows.map((row) => mapToolRunRow(row, includePayload)),
    matchCount: countRow?.count ?? 0,
  };
}
