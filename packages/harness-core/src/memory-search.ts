/**
 * Hybrid FTS5 + vector-cosine memory search with Reciprocal Rank Fusion (RRF).
 *
 * Modes:
 *
 *   - `hybrid` — both FTS and the embedding provider returned results; ranks
 *     are fused via RRF with the standard `k=60` smoother.
 *   - `fts-fallback` — no embedding provider is configured, the provider is
 *     unreachable, or the provider threw during the recall call. FTS-only
 *     results are returned with a structured `reason` so callers can surface
 *     the degradation without treating it as an error.
 *
 * The vector side filters strictly by `(owner_kind, model)` so swapping
 * embedding models never surfaces dimension-mismatched vectors. Old vectors
 * remain on disk — they just stop showing up until the user's active
 * embedding model matches theirs again (or until a future `memory_reindex`
 * re-embeds them).
 *
 * This module does NOT own the memory-tool surface; `packages/harness-tools`
 * composes this with `memory_remember` / `memory_recall` / `memory_list`.
 */

import type { ProjectStore, HarnessMemoryRecord } from "@mako-ai/store";
import { createLogger } from "@mako-ai/logger";
import {
  cosineSimilarity,
  EmbeddingProviderError,
  type EmbeddingProvider,
} from "./embedding-provider.js";
import { RRF_K, sanitizeFtsQuery } from "./search-utils.js";

const searchLogger = createLogger("mako-harness-memory-search");

export type MemoryRecallMode = "hybrid" | "fts-fallback";

export interface MemoryRecallHit {
  memoryId: string;
  text: string;
  category: string | null;
  tags: string[];
  createdAt: string;
  score: number;
  ftsRank: number | null;
  vectorScore: number | null;
}

export interface MemoryRecallResult {
  mode: MemoryRecallMode;
  reason?: string;
  results: MemoryRecallHit[];
}

export interface MemoryRecallInput {
  store: ProjectStore;
  query: string;
  embeddingProvider?: EmbeddingProvider | null;
  projectId?: string | null;
  k?: number;
}

export async function recallMemories(
  input: MemoryRecallInput,
): Promise<MemoryRecallResult> {
  const k = input.k ?? 10;
  const ftsLimit = Math.max(k * 4, 50);

  const ftsMatches = input.store.ftsSearchHarnessMemories(sanitizeFtsQuery(input.query), {
    projectId: input.projectId,
    limit: ftsLimit,
  });

  if (!input.embeddingProvider) {
    return buildFtsOnly(input.store, ftsMatches, k, "no embedding provider configured");
  }

  let queryVector: Float32Array;
  try {
    queryVector = await input.embeddingProvider.embed(input.query);
  } catch (error) {
    const reason =
      error instanceof EmbeddingProviderError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    searchLogger.warn("memory.recall.embedding-failed.fts-fallback", { reason });
    return buildFtsOnly(input.store, ftsMatches, k, `embedding call failed: ${reason}`);
  }

  const model = input.embeddingProvider.modelId;
  const candidates = input.store.listEmbeddingsByModel({
    ownerKind: "memory",
    model,
  });

  if (candidates.length === 0) {
    return buildFtsOnly(
      input.store,
      ftsMatches,
      k,
      `no embeddings stored under model \`${model}\``,
    );
  }

  const vectorRanking = rankByCosine(
    input.store,
    candidates,
    queryVector,
    ftsLimit,
    input.projectId,
  );

  // Fuse by RRF. Each side contributes 1 / (RRF_K + rank).
  const fused = new Map<string, FusedEntry>();

  ftsMatches.forEach((match, idx) => {
    const rank = idx + 1;
    const entry = fused.get(match.memoryId) ?? emptyFused();
    entry.ftsRank = rank;
    entry.score += 1 / (RRF_K + rank);
    fused.set(match.memoryId, entry);
  });

  vectorRanking.forEach((hit, idx) => {
    const rank = idx + 1;
    const entry = fused.get(hit.memoryId) ?? emptyFused();
    entry.vectorScore = hit.similarity;
    entry.score += 1 / (RRF_K + rank);
    fused.set(hit.memoryId, entry);
  });

  const sortedIds = [...fused.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, k);

  const results = hydrateResults(input.store, sortedIds);

  return {
    mode: "hybrid",
    results,
  };
}

interface FusedEntry {
  score: number;
  ftsRank: number | null;
  vectorScore: number | null;
}

function emptyFused(): FusedEntry {
  return { score: 0, ftsRank: null, vectorScore: null };
}

interface VectorRankingHit {
  memoryId: string;
  similarity: number;
}

function rankByCosine(
  store: ProjectStore,
  candidates: Array<{ ownerId: string; vector: Float32Array }>,
  queryVector: Float32Array,
  limit: number,
  projectId: string | null | undefined,
): VectorRankingHit[] {
  const scored: VectorRankingHit[] = [];
  for (const entry of candidates) {
    if (entry.vector.length !== queryVector.length) continue;
    if (projectId !== undefined) {
      const row = store.getHarnessMemory(entry.ownerId);
      if (!row || row.projectId !== projectId) continue;
    }
    const similarity = cosineSimilarity(entry.vector, queryVector);
    scored.push({ memoryId: entry.ownerId, similarity });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

function buildFtsOnly(
  store: ProjectStore,
  ftsMatches: Array<{ memoryId: string; rank: number }>,
  k: number,
  reason: string,
): MemoryRecallResult {
  const top = ftsMatches.slice(0, k);
  const results = top.map((match, idx) => {
    const row = store.getHarnessMemory(match.memoryId);
    if (!row) return null;
    const hit: MemoryRecallHit = {
      memoryId: row.memoryId,
      text: row.text,
      category: row.category,
      tags: row.tags,
      createdAt: row.createdAt,
      score: 1 / (RRF_K + idx + 1),
      ftsRank: idx + 1,
      vectorScore: null,
    };
    return hit;
  });
  return {
    mode: "fts-fallback",
    reason,
    results: results.filter((r): r is MemoryRecallHit => r !== null),
  };
}

function hydrateResults(
  store: ProjectStore,
  sorted: Array<[string, FusedEntry]>,
): MemoryRecallHit[] {
  const hits: MemoryRecallHit[] = [];
  for (const [memoryId, entry] of sorted) {
    const row = store.getHarnessMemory(memoryId);
    if (!row) continue;
    hits.push({
      memoryId: row.memoryId,
      text: row.text,
      category: row.category,
      tags: row.tags,
      createdAt: row.createdAt,
      score: entry.score,
      ftsRank: entry.ftsRank,
      vectorScore: entry.vectorScore,
    });
  }
  return hits;
}

export const __internal = { sanitizeFtsQuery, RRF_K };
