/**
 * Project-store accessors for the Roadmap 3 Phase 3.3 embedding layer.
 *
 * Vectors are stored as raw little-endian Float32 bytes in a `BLOB` column.
 * Cosine similarity is computed in Node; this avoids the `sqlite-vec` native
 * extension (Windows x64 binding risk, platform-specific build concerns). The
 * Phase 3.3 spec explicitly allows this as the "Node-side cosine fallback over
 * BLOB columns" recovery path.
 *
 * Every row carries `provider` and `model`. Recall queries scope by `model`,
 * so changing the active embedding model never surfaces dimension-mismatched
 * results — old vectors remain on disk but are skipped.
 */

import { DatabaseSync } from "node:sqlite";

export type EmbeddingOwnerKind = "memory" | "file" | "symbol" | "semantic_unit";

export interface EmbeddingRecord {
  embeddingId: number;
  ownerKind: EmbeddingOwnerKind;
  ownerId: string;
  provider: string;
  model: string;
  dim: number;
  vector: Float32Array;
  createdAt: string;
}

export interface InsertEmbeddingInput {
  ownerKind: EmbeddingOwnerKind;
  ownerId: string;
  provider: string;
  model: string;
  vector: Float32Array;
}

export interface ListEmbeddingsByModelOptions {
  ownerKind: EmbeddingOwnerKind;
  model: string;
  limit?: number;
}

interface EmbeddingRow {
  embedding_id: number;
  owner_kind: EmbeddingOwnerKind;
  owner_id: string;
  provider: string;
  model: string;
  dim: number;
  vector: Buffer | Uint8Array;
  created_at: string;
}

function toFloat32Array(blob: Buffer | Uint8Array): Float32Array {
  // Copy into a freshly-allocated ArrayBuffer so the result is detached from
  // the underlying node Buffer pool (important because node-sqlite may reuse
  // buffers across statement steps).
  const buf = Buffer.isBuffer(blob)
    ? Uint8Array.from(blob)
    : new Uint8Array(blob);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
}

function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function mapRow(row: EmbeddingRow): EmbeddingRecord {
  return {
    embeddingId: row.embedding_id,
    ownerKind: row.owner_kind,
    ownerId: row.owner_id,
    provider: row.provider,
    model: row.model,
    dim: row.dim,
    vector: toFloat32Array(row.vector),
    createdAt: row.created_at,
  };
}

export function insertEmbeddingImpl(
  db: DatabaseSync,
  input: InsertEmbeddingInput,
): EmbeddingRecord {
  const result = db
    .prepare(
      `INSERT INTO harness_embeddings(
         owner_kind, owner_id, provider, model, dim, vector
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.ownerKind,
      input.ownerId,
      input.provider,
      input.model,
      input.vector.length,
      toBlob(input.vector),
    );

  const embeddingId = Number(result.lastInsertRowid);
  const row = db
    .prepare(`SELECT * FROM harness_embeddings WHERE embedding_id = ?`)
    .get(embeddingId) as unknown as EmbeddingRow;
  return mapRow(row);
}

/**
 * Returns every embedding for (ownerKind, model). Used by the Node-side cosine
 * search path — caller streams over the results and scores in memory. For
 * Phase 3.3's memory-only scope this is cheap; future phases that embed every
 * file in a large repo will need a smarter index.
 */
export function listEmbeddingsByModelImpl(
  db: DatabaseSync,
  options: ListEmbeddingsByModelOptions,
): EmbeddingRecord[] {
  const limit = options.limit ?? 10_000;
  const rows = db
    .prepare(
      `SELECT * FROM harness_embeddings
       WHERE owner_kind = ? AND model = ?
       ORDER BY embedding_id ASC
       LIMIT ?`,
    )
    .all(options.ownerKind, options.model, limit) as unknown as EmbeddingRow[];
  return rows.map(mapRow);
}

export function getEmbeddingForOwnerImpl(
  db: DatabaseSync,
  ownerKind: EmbeddingOwnerKind,
  ownerId: string,
  model: string,
): EmbeddingRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM harness_embeddings
       WHERE owner_kind = ? AND owner_id = ? AND model = ?
       ORDER BY embedding_id DESC LIMIT 1`,
    )
    .get(ownerKind, ownerId, model) as unknown as EmbeddingRow | undefined;
  return row ? mapRow(row) : null;
}

export function countEmbeddingsForModelImpl(
  db: DatabaseSync,
  ownerKind: EmbeddingOwnerKind,
  model: string,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM harness_embeddings
       WHERE owner_kind = ? AND model = ?`,
    )
    .get(ownerKind, model) as unknown as { n: number };
  return row.n;
}
