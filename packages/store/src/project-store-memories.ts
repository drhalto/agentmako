/**
 * Project-store accessors for the Roadmap 3 Phase 3.3 semantic-memory layer.
 *
 * Owns row shapes and `*Impl` helpers for `harness_memories` and the paired
 * `harness_memories_fts` virtual table. Keeps the same split-file pattern as
 * `project-store-harness.ts` and `project-store-embeddings.ts`.
 *
 * Memories are append-only. There is no update or delete path by design — the
 * Phase 3.3 spec defers `memory_forget` to a later phase.
 */

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseJson, stringifyJson } from "./json.js";
import { buildFtsPhraseMatchExpression } from "./project-store-queries.js";

export interface HarnessMemoryRecord {
  memoryId: string;
  memoryRowid: number;
  projectId: string | null;
  text: string;
  category: string | null;
  tags: string[];
  createdAt: string;
}

export interface InsertHarnessMemoryInput {
  projectId?: string | null;
  text: string;
  category?: string | null;
  tags?: string[];
}

export interface ListHarnessMemoriesOptions {
  projectId?: string | null;
  category?: string | null;
  tag?: string | null;
  since?: string | null;
  limit?: number;
}

export interface MemoryFtsMatch {
  memoryRowid: number;
  memoryId: string;
  rank: number;
}

interface HarnessMemoryRow {
  memory_rowid: number;
  memory_id: string;
  project_id: string | null;
  text: string;
  category: string | null;
  tags_json: string;
  created_at: string;
}

function mapMemoryRow(row: HarnessMemoryRow): HarnessMemoryRecord {
  return {
    memoryId: row.memory_id,
    memoryRowid: row.memory_rowid,
    projectId: row.project_id,
    text: row.text,
    category: row.category,
    tags: parseJson<string[]>(row.tags_json, []),
    createdAt: row.created_at,
  };
}

export function insertHarnessMemoryImpl(
  db: DatabaseSync,
  input: InsertHarnessMemoryInput,
): HarnessMemoryRecord {
  const memoryId = randomUUID();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO harness_memories(
         memory_id, project_id, text, category, tags_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      memoryId,
      input.projectId ?? null,
      input.text,
      input.category ?? null,
      stringifyJson(input.tags ?? []),
      now,
    );

  const memoryRowid = Number(result.lastInsertRowid);
  return {
    memoryId,
    memoryRowid,
    projectId: input.projectId ?? null,
    text: input.text,
    category: input.category ?? null,
    tags: input.tags ?? [],
    createdAt: now,
  };
}

export function getHarnessMemoryImpl(
  db: DatabaseSync,
  memoryId: string,
): HarnessMemoryRecord | null {
  const row = db
    .prepare(`SELECT * FROM harness_memories WHERE memory_id = ?`)
    .get(memoryId) as unknown as HarnessMemoryRow | undefined;
  return row ? mapMemoryRow(row) : null;
}

export function getHarnessMemoryByRowidImpl(
  db: DatabaseSync,
  memoryRowid: number,
): HarnessMemoryRecord | null {
  const row = db
    .prepare(`SELECT * FROM harness_memories WHERE memory_rowid = ?`)
    .get(memoryRowid) as unknown as HarnessMemoryRow | undefined;
  return row ? mapMemoryRow(row) : null;
}

export function listHarnessMemoriesImpl(
  db: DatabaseSync,
  options: ListHarnessMemoriesOptions = {},
): HarnessMemoryRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number | null> = [];

  if (options.projectId !== undefined) {
    clauses.push("project_id IS ?");
    values.push(options.projectId);
  }
  if (options.category !== undefined && options.category !== null) {
    clauses.push("category = ?");
    values.push(options.category);
  }
  if (options.tag) {
    // JSON array contains; works because tags_json is a JSON array of strings.
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(tags_json) WHERE json_each.value = ?)`,
    );
    values.push(options.tag);
  }
  if (options.since) {
    clauses.push("created_at >= ?");
    values.push(options.since);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 100;
  const rows = db
    .prepare(
      `SELECT * FROM harness_memories ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...values, limit) as unknown as HarnessMemoryRow[];
  return rows.map(mapMemoryRow);
}

/**
 * Full-text search against `harness_memories_fts`. Returns rowid + public id +
 * raw FTS rank (lower is better). The caller decides whether to look up full
 * rows or just fuse ranks with vector scores.
 *
 * When `rawUserInput` is true, the query is sanitized into an FTS5 phrase
 * expression so punctuation (`.`, `(`, `:`, `"`, etc.) cannot syntax-error
 * the MATCH clause. Pre-sanitized callers (memory-search / semantic-search)
 * leave it false and pass their already-built FTS expressions through.
 */
export function ftsSearchHarnessMemoriesImpl(
  db: DatabaseSync,
  query: string,
  options: { projectId?: string | null; limit?: number; rawUserInput?: boolean } = {},
): MemoryFtsMatch[] {
  const limit = options.limit ?? 50;
  const matchExpression = options.rawUserInput ? buildFtsPhraseMatchExpression(query) : query;
  if (matchExpression == null || matchExpression === "") {
    return [];
  }

  const clauses = ["harness_memories_fts MATCH ?"];
  const values: Array<string | number | null> = [matchExpression];

  if (options.projectId !== undefined) {
    clauses.push("harness_memories.project_id IS ?");
    values.push(options.projectId);
  }

  const rows = db
    .prepare(
      `SELECT harness_memories.memory_rowid AS memory_rowid,
              harness_memories.memory_id AS memory_id,
              harness_memories_fts.rank AS rank
       FROM harness_memories_fts
       JOIN harness_memories ON harness_memories.memory_rowid = harness_memories_fts.rowid
       WHERE ${clauses.join(" AND ")}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...values, limit) as unknown as Array<{
      memory_rowid: number;
      memory_id: string;
      rank: number;
    }>;

  return rows.map((r) => ({
    memoryRowid: r.memory_rowid,
    memoryId: r.memory_id,
    rank: r.rank,
  }));
}
