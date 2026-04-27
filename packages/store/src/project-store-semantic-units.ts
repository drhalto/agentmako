import { DatabaseSync } from "node:sqlite";
import type { JsonObject } from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";

export type SemanticUnitKind = "code_symbol" | "doc_chunk";

export interface SemanticUnitRecord {
  unitRowid: number;
  unitId: string;
  projectId: string;
  unitKind: SemanticUnitKind;
  title: string;
  text: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  ownerRef: string;
  metadata: JsonObject | null;
  sourceHash: string;
  indexedAt: string;
}

export interface SemanticUnitInput {
  unitId: string;
  projectId: string;
  unitKind: SemanticUnitKind;
  title: string;
  text: string;
  filePath?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  ownerRef: string;
  metadata?: JsonObject | null;
  sourceHash: string;
}

export interface ListSemanticUnitsOptions {
  projectId?: string | null;
  unitKinds?: SemanticUnitKind[];
  limit?: number;
}

export interface SemanticUnitFtsMatch extends SemanticUnitRecord {
  rank: number;
  excerpt: string;
}

interface SemanticUnitRow {
  unit_rowid: number;
  unit_id: string;
  project_id: string;
  unit_kind: SemanticUnitKind;
  title: string;
  text: string;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  owner_ref: string;
  metadata_json: string | null;
  source_hash: string;
  indexed_at: string;
}

interface SemanticUnitSearchRow extends SemanticUnitRow {
  rank: number;
  excerpt: string | null;
}

function mapSemanticUnitRow(row: SemanticUnitRow): SemanticUnitRecord {
  return {
    unitRowid: row.unit_rowid,
    unitId: row.unit_id,
    projectId: row.project_id,
    unitKind: row.unit_kind,
    title: row.title,
    text: row.text,
    filePath: row.file_path,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    ownerRef: row.owner_ref,
    metadata: row.metadata_json == null ? null : parseJson<JsonObject>(row.metadata_json, {}),
    sourceHash: row.source_hash,
    indexedAt: row.indexed_at,
  };
}

function buildKindClause(unitKinds: SemanticUnitKind[] | undefined): {
  sql: string;
  values: SemanticUnitKind[];
} {
  if (!unitKinds || unitKinds.length === 0) {
    return { sql: "", values: [] };
  }

  const placeholders = unitKinds.map(() => "?").join(", ");
  return {
    sql: ` AND harness_semantic_units.unit_kind IN (${placeholders})`,
    values: unitKinds,
  };
}

function buildProjectClause(projectId: string | null | undefined): {
  sql: string;
  values: Array<string | null>;
} {
  if (projectId === undefined) {
    return { sql: "", values: [] };
  }
  return {
    sql: " AND harness_semantic_units.project_id IS ?",
    values: [projectId],
  };
}

export function replaceSemanticUnitsImpl(
  db: DatabaseSync,
  units: SemanticUnitInput[],
): number {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO harness_semantic_units(
      unit_id,
      project_id,
      unit_kind,
      title,
      text,
      file_path,
      line_start,
      line_end,
      owner_ref,
      metadata_json,
      source_hash,
      indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const indexedAt = new Date().toISOString();

  db.exec("BEGIN");
  try {
    // Semantic units are derived from the just-built snapshot, so replace
    // them wholesale to avoid stale code/doc units after a refresh.
    db.exec(`DELETE FROM harness_semantic_units`);
    for (const unit of units) {
      insert.run(
        unit.unitId,
        unit.projectId,
        unit.unitKind,
        unit.title,
        unit.text,
        unit.filePath ?? null,
        unit.lineStart ?? null,
        unit.lineEnd ?? null,
        unit.ownerRef,
        unit.metadata == null ? null : stringifyJson(unit.metadata),
        unit.sourceHash,
        indexedAt,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return units.length;
}

export function replaceSemanticUnitsForFilesImpl(
  db: DatabaseSync,
  filePaths: string[],
  units: SemanticUnitInput[],
): number {
  const uniquePaths = [...new Set(filePaths)].filter((filePath) => filePath.length > 0);
  if (uniquePaths.length === 0 && units.length === 0) {
    return 0;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO harness_semantic_units(
      unit_id,
      project_id,
      unit_kind,
      title,
      text,
      file_path,
      line_start,
      line_end,
      owner_ref,
      metadata_json,
      source_hash,
      indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const indexedAt = new Date().toISOString();

  db.exec("BEGIN");
  try {
    if (uniquePaths.length > 0) {
      const placeholders = uniquePaths.map(() => "?").join(", ");
      db.prepare(`DELETE FROM harness_semantic_units WHERE file_path IN (${placeholders})`).run(...uniquePaths);
    }
    for (const unit of units) {
      insert.run(
        unit.unitId,
        unit.projectId,
        unit.unitKind,
        unit.title,
        unit.text,
        unit.filePath ?? null,
        unit.lineStart ?? null,
        unit.lineEnd ?? null,
        unit.ownerRef,
        unit.metadata == null ? null : stringifyJson(unit.metadata),
        unit.sourceHash,
        indexedAt,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return units.length;
}

export function getSemanticUnitImpl(
  db: DatabaseSync,
  unitId: string,
): SemanticUnitRecord | null {
  const row = db
    .prepare(`SELECT * FROM harness_semantic_units WHERE unit_id = ?`)
    .get(unitId) as SemanticUnitRow | undefined;
  return row ? mapSemanticUnitRow(row) : null;
}

export function listSemanticUnitsImpl(
  db: DatabaseSync,
  options: ListSemanticUnitsOptions = {},
): SemanticUnitRecord[] {
  const limit = options.limit ?? 10_000;
  const projectClause = buildProjectClause(options.projectId);
  const kindClause = buildKindClause(options.unitKinds);
  const rows = db
    .prepare(`
      SELECT *
      FROM harness_semantic_units
      WHERE 1 = 1${projectClause.sql}${kindClause.sql}
      ORDER BY unit_kind ASC, file_path ASC, line_start ASC, unit_rowid ASC
      LIMIT ?
    `)
    .all(...projectClause.values, ...kindClause.values, limit) as unknown as SemanticUnitRow[];
  return rows.map(mapSemanticUnitRow);
}

export function countSemanticUnitsImpl(
  db: DatabaseSync,
  unitKinds?: SemanticUnitKind[],
): number {
  const kindClause = buildKindClause(unitKinds);
  const row = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM harness_semantic_units
      WHERE 1 = 1${kindClause.sql}
    `)
    .get(...kindClause.values) as { n: number };
  return row.n;
}

export function searchSemanticUnitsImpl(
  db: DatabaseSync,
  query: string,
  options: ListSemanticUnitsOptions = {},
): SemanticUnitFtsMatch[] {
  const limit = options.limit ?? 50;
  const projectClause = buildProjectClause(options.projectId);
  const kindClause = buildKindClause(options.unitKinds);
  const rows = db
    .prepare(`
      SELECT harness_semantic_units.*,
             harness_semantic_units_fts.rank AS rank,
             snippet(harness_semantic_units_fts, 1, '', '', ' … ', 16) AS excerpt
      FROM harness_semantic_units_fts
      JOIN harness_semantic_units
        ON harness_semantic_units.unit_rowid = harness_semantic_units_fts.rowid
      WHERE harness_semantic_units_fts MATCH ?${projectClause.sql}${kindClause.sql}
      ORDER BY rank
      LIMIT ?
    `)
    .all(query, ...projectClause.values, ...kindClause.values, limit) as unknown as SemanticUnitSearchRow[];

  return rows.map((row) => ({
    ...mapSemanticUnitRow(row),
    rank: row.rank,
    excerpt: row.excerpt ?? row.text,
  }));
}
