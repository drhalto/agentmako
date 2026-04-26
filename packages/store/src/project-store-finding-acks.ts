import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { FindingAckSchema } from "@mako-ai/contracts";
import type {
  FindingAckAggregationFilter,
  FindingAckCategoryFingerprintCount,
  FindingAckFilePathCount,
  FindingAckInsert,
  FindingAckRecord,
  FindingAckStatusCount,
  FindingAckSubjectKindCount,
  QueryFindingAcksOptions,
} from "./types.js";

interface FindingAckRow {
  ack_id: string;
  project_id: string;
  category: string;
  subject_kind: FindingAckRecord["subjectKind"];
  file_path: string | null;
  fingerprint: string;
  status: FindingAckRecord["status"];
  reason: string;
  acknowledged_by: string | null;
  acknowledged_at: string;
  snippet: string | null;
  source_tool_name: string | null;
  source_rule_id: string | null;
  source_identity_match_based_id: string | null;
}

function mapRow(row: FindingAckRow | undefined): FindingAckRecord | null {
  if (!row) return null;
  const record: FindingAckRecord = {
    ackId: row.ack_id,
    projectId: row.project_id,
    category: row.category,
    subjectKind: row.subject_kind,
    fingerprint: row.fingerprint,
    status: row.status,
    reason: row.reason,
    acknowledgedAt: row.acknowledged_at,
  };
  if (row.file_path !== null) record.filePath = row.file_path;
  if (row.acknowledged_by !== null) record.acknowledgedBy = row.acknowledged_by;
  if (row.snippet !== null) record.snippet = row.snippet;
  if (row.source_tool_name !== null) record.sourceToolName = row.source_tool_name;
  if (row.source_rule_id !== null) record.sourceRuleId = row.source_rule_id;
  if (row.source_identity_match_based_id !== null) {
    record.sourceIdentityMatchBasedId = row.source_identity_match_based_id;
  }
  return record;
}

export function insertFindingAckImpl(
  db: DatabaseSync,
  input: FindingAckInsert,
): FindingAckRecord {
  const ackId = input.ackId ?? `ack_${randomUUID()}`;
  const acknowledgedAt = input.acknowledgedAt ?? new Date().toISOString();

  // Parse at the store boundary so empty-string fields and unknown enums
  // get rejected consistently, not just by the SQL CHECK constraints.
  const parsed = FindingAckSchema.parse({
    ackId,
    projectId: input.projectId,
    category: input.category,
    subjectKind: input.subjectKind,
    filePath: input.filePath,
    fingerprint: input.fingerprint,
    status: input.status,
    reason: input.reason,
    acknowledgedBy: input.acknowledgedBy,
    acknowledgedAt,
    snippet: input.snippet,
    sourceToolName: input.sourceToolName,
    sourceRuleId: input.sourceRuleId,
    sourceIdentityMatchBasedId: input.sourceIdentityMatchBasedId,
  });

  db.prepare(`
    INSERT INTO finding_acks(
      ack_id,
      project_id,
      category,
      subject_kind,
      file_path,
      fingerprint,
      status,
      reason,
      acknowledged_by,
      acknowledged_at,
      snippet,
      source_tool_name,
      source_rule_id,
      source_identity_match_based_id
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    parsed.ackId,
    parsed.projectId,
    parsed.category,
    parsed.subjectKind,
    parsed.filePath ?? null,
    parsed.fingerprint,
    parsed.status,
    parsed.reason,
    parsed.acknowledgedBy ?? null,
    parsed.acknowledgedAt,
    parsed.snippet ?? null,
    parsed.sourceToolName ?? null,
    parsed.sourceRuleId ?? null,
    parsed.sourceIdentityMatchBasedId ?? null,
  );

  const row = db
    .prepare(`
      SELECT
        ack_id, project_id, category, subject_kind, file_path, fingerprint,
        status, reason, acknowledged_by, acknowledged_at, snippet,
        source_tool_name, source_rule_id, source_identity_match_based_id
      FROM finding_acks
      WHERE ack_id = ?
    `)
    .get(parsed.ackId) as FindingAckRow | undefined;
  return mapRow(row) as FindingAckRecord;
}

function buildWhereClause(filter: FindingAckAggregationFilter): {
  sql: string;
  values: Array<string | number>;
} {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (filter.projectId) {
    clauses.push("project_id = ?");
    values.push(filter.projectId);
  }
  if (filter.category) {
    clauses.push("category = ?");
    values.push(filter.category);
  }
  if (filter.subjectKind) {
    clauses.push("subject_kind = ?");
    values.push(filter.subjectKind);
  }
  if (filter.filePath) {
    clauses.push("file_path = ?");
    values.push(filter.filePath);
  }
  if (filter.status) {
    clauses.push("status = ?");
    values.push(filter.status);
  }
  if (filter.since) {
    clauses.push("acknowledged_at >= ?");
    values.push(filter.since);
  }
  if (filter.until) {
    clauses.push("acknowledged_at <= ?");
    values.push(filter.until);
  }
  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

export function queryFindingAcksImpl(
  db: DatabaseSync,
  options: QueryFindingAcksOptions = {},
): FindingAckRecord[] {
  const { sql, values } = buildWhereClause(options);
  const limit = options.limit ?? 100;
  const rows = db
    .prepare(`
      SELECT
        ack_id, project_id, category, subject_kind, file_path, fingerprint,
        status, reason, acknowledged_by, acknowledged_at, snippet,
        source_tool_name, source_rule_id, source_identity_match_based_id
      FROM finding_acks
      ${sql}
      ORDER BY acknowledged_at DESC, ack_id DESC
      LIMIT ?
    `)
    .all(...values, limit) as unknown as FindingAckRow[];
  return rows
    .map(mapRow)
    .filter((row): row is FindingAckRecord => row !== null);
}

export function countFindingAcksImpl(
  db: DatabaseSync,
  filter: FindingAckAggregationFilter = {},
): number {
  const { sql, values } = buildWhereClause(filter);
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM finding_acks ${sql}`)
    .get(...values) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * Batch-load acknowledged fingerprints for a single (projectId, category)
 * pair into an in-memory Set. Used by the query-time filter in
 * `ast_find_pattern` and `lint_files` so each tool call runs one SQL
 * query, not one per candidate match.
 *
 * Filter is status-agnostic — both `ignored` and `accepted` acks exclude
 * the matching fingerprint. Callers who need status-aware behavior should
 * use `queryFindingAcksImpl` directly.
 */
export function loadAcknowledgedFingerprintsImpl(
  db: DatabaseSync,
  projectId: string,
  category: string,
): Set<string> {
  const rows = db
    .prepare(`
      SELECT DISTINCT fingerprint
      FROM finding_acks
      WHERE project_id = ? AND category = ?
    `)
    .all(projectId, category) as unknown as Array<{ fingerprint: string }>;
  return new Set(rows.map((row) => row.fingerprint));
}

export function aggregateFindingAcksByCategoryImpl(
  db: DatabaseSync,
  filter: FindingAckAggregationFilter = {},
): FindingAckCategoryFingerprintCount[] {
  const { sql, values } = buildWhereClause(filter);
  const rows = db
    .prepare(`
      SELECT
        category,
        COUNT(DISTINCT fingerprint) AS distinct_fingerprints,
        COUNT(*) AS total_rows
      FROM finding_acks
      ${sql}
      GROUP BY category
      ORDER BY total_rows DESC, category ASC
    `)
    .all(...values) as unknown as Array<{
      category: string;
      distinct_fingerprints: number;
      total_rows: number;
    }>;
  return rows.map((row) => ({
    category: row.category,
    distinctFingerprints: row.distinct_fingerprints,
    totalRows: row.total_rows,
  }));
}

export function aggregateFindingAcksByStatusImpl(
  db: DatabaseSync,
  filter: FindingAckAggregationFilter = {},
): FindingAckStatusCount[] {
  const { sql, values } = buildWhereClause(filter);
  const rows = db
    .prepare(`
      SELECT status, COUNT(*) AS count
      FROM finding_acks
      ${sql}
      GROUP BY status
      ORDER BY count DESC, status ASC
    `)
    .all(...values) as unknown as Array<{
      status: FindingAckRecord["status"];
      count: number;
    }>;
  return rows.map((row) => ({ status: row.status, count: row.count }));
}

export function aggregateFindingAcksBySubjectKindImpl(
  db: DatabaseSync,
  filter: FindingAckAggregationFilter = {},
): FindingAckSubjectKindCount[] {
  const { sql, values } = buildWhereClause(filter);
  const rows = db
    .prepare(`
      SELECT subject_kind, COUNT(*) AS count
      FROM finding_acks
      ${sql}
      GROUP BY subject_kind
      ORDER BY count DESC, subject_kind ASC
    `)
    .all(...values) as unknown as Array<{
      subject_kind: FindingAckRecord["subjectKind"];
      count: number;
    }>;
  return rows.map((row) => ({
    subjectKind: row.subject_kind,
    count: row.count,
  }));
}

export function aggregateFindingAcksByFilePathImpl(
  db: DatabaseSync,
  filter: FindingAckAggregationFilter = {},
): FindingAckFilePathCount[] {
  const { sql, values } = buildWhereClause(filter);
  const rows = db
    .prepare(`
      SELECT file_path, COUNT(*) AS count
      FROM finding_acks
      ${sql}
      GROUP BY file_path
      ORDER BY count DESC, file_path ASC
    `)
    .all(...values) as unknown as Array<{
      file_path: string | null;
      count: number;
    }>;
  return rows.map((row) => ({ filePath: row.file_path, count: row.count }));
}
