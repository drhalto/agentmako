import type {
  EmbeddingRecord,
  HarnessMemoryRecord,
  ProjectStore,
  SemanticUnitFtsMatch,
  SemanticUnitKind,
  SemanticUnitRecord,
} from "@mako-ai/store";
import { createLogger } from "@mako-ai/logger";
import {
  cosineSimilarity,
  EmbeddingProviderError,
  type EmbeddingProvider,
} from "./embedding-provider.js";
import { RRF_K, sanitizeFtsQuery } from "./search-utils.js";

const semanticLogger = createLogger("mako-harness-semantic-search");

export type SemanticSearchMode = "hybrid" | "fts-fallback";
export type SemanticSearchKind = "code" | "doc" | "memory";
export type EmbeddingReindexKind = "memory" | "semantic_unit";

export interface SemanticSearchHit {
  kind: SemanticSearchKind;
  sourceRef: string;
  title: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  excerpt: string;
  score: number;
  ftsRank: number | null;
  vectorScore: number | null;
}

export interface SemanticSearchResult {
  mode: SemanticSearchMode;
  reason?: string;
  results: SemanticSearchHit[];
}

export interface SemanticSearchInput {
  store: ProjectStore;
  query: string;
  embeddingProvider?: EmbeddingProvider | null;
  projectId?: string | null;
  k?: number;
  kinds?: SemanticSearchKind[];
  includeMemories?: boolean;
}

export interface EmbeddingReindexResult {
  providerId: string;
  modelId: string;
  scanned: number;
  embedded: number;
  skipped: number;
  failed: number;
  failures: Array<{
    ownerKind: EmbeddingReindexKind;
    ownerId: string;
    error: string;
  }>;
}

interface UnifiedFtsHit {
  sourceRef: string;
  kind: SemanticSearchKind;
  title: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  excerpt: string;
  rank: number;
}

interface UnifiedVectorHit extends Omit<UnifiedFtsHit, "rank" | "excerpt"> {
  excerpt: string;
  similarity: number;
}

interface FusedEntry {
  score: number;
  ftsRank: number | null;
  vectorScore: number | null;
  hit: Omit<SemanticSearchHit, "score" | "ftsRank" | "vectorScore">;
}

const ALL_KINDS: SemanticSearchKind[] = ["code", "doc", "memory"];

function uniqueKinds(kinds: SemanticSearchKind[]): SemanticSearchKind[] {
  return [...new Set(kinds)];
}

function resolveSearchKinds(input: SemanticSearchInput): SemanticSearchKind[] {
  if (input.kinds && input.kinds.length > 0) {
    return uniqueKinds(input.kinds);
  }
  if (input.includeMemories === false) {
    return ["code", "doc"];
  }
  return [...ALL_KINDS];
}

function toSemanticUnitKinds(kinds: SemanticSearchKind[]): SemanticUnitKind[] {
  const out: SemanticUnitKind[] = [];
  if (kinds.includes("code")) out.push("code_symbol");
  if (kinds.includes("doc")) out.push("doc_chunk");
  return out;
}

function semanticKindFromUnit(unitKind: SemanticUnitKind): SemanticSearchKind {
  return unitKind === "code_symbol" ? "code" : "doc";
}

function trimExcerpt(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function memoryToFtsHit(row: HarnessMemoryRecord, rank: number): UnifiedFtsHit {
  return {
    sourceRef: `memory:${row.memoryId}`,
    kind: "memory",
    title: row.category ?? "memory",
    filePath: null,
    lineStart: null,
    lineEnd: null,
    excerpt: trimExcerpt(row.text),
    rank,
  };
}

function memoryToVectorHit(
  row: HarnessMemoryRecord,
  similarity: number,
): UnifiedVectorHit {
  return {
    sourceRef: `memory:${row.memoryId}`,
    kind: "memory",
    title: row.category ?? "memory",
    filePath: null,
    lineStart: null,
    lineEnd: null,
    excerpt: trimExcerpt(row.text),
    similarity,
  };
}

function unitToFtsHit(hit: SemanticUnitFtsMatch): UnifiedFtsHit {
  return {
    sourceRef: `semantic:${hit.unitId}`,
    kind: semanticKindFromUnit(hit.unitKind),
    title: hit.title,
    filePath: hit.filePath,
    lineStart: hit.lineStart,
    lineEnd: hit.lineEnd,
    excerpt: trimExcerpt(hit.excerpt),
    rank: hit.rank,
  };
}

function unitToVectorHit(
  unit: SemanticUnitRecord,
  similarity: number,
): UnifiedVectorHit {
  return {
    sourceRef: `semantic:${unit.unitId}`,
    kind: semanticKindFromUnit(unit.unitKind),
    title: unit.title,
    filePath: unit.filePath,
    lineStart: unit.lineStart,
    lineEnd: unit.lineEnd,
    excerpt: trimExcerpt(unit.text),
    similarity,
  };
}

function emptyFused(hit: UnifiedFtsHit | UnifiedVectorHit): FusedEntry {
  return {
    score: 0,
    ftsRank: null,
    vectorScore: null,
    hit: {
      sourceRef: hit.sourceRef,
      kind: hit.kind,
      title: hit.title,
      filePath: hit.filePath,
      lineStart: hit.lineStart,
      lineEnd: hit.lineEnd,
      excerpt: hit.excerpt,
    },
  };
}

function hydrateResults(
  entries: Map<string, FusedEntry>,
  k: number,
): SemanticSearchHit[] {
  return [...entries.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((entry) => ({
      ...entry.hit,
      score: entry.score,
      ftsRank: entry.ftsRank,
      vectorScore: entry.vectorScore,
    }));
}

function collectFtsHits(
  store: ProjectStore,
  query: string,
  kinds: SemanticSearchKind[],
  projectId: string | null | undefined,
  limit: number,
): UnifiedFtsHit[] {
  const hits: UnifiedFtsHit[] = [];
  const semanticKinds = toSemanticUnitKinds(kinds);
  if (semanticKinds.length > 0) {
    const unitHits = store.searchSemanticUnits(query, {
      unitKinds: semanticKinds,
      projectId,
      limit,
    });
    hits.push(...unitHits.map(unitToFtsHit));
  }

  if (kinds.includes("memory")) {
    const memoryHits = store.ftsSearchHarnessMemories(query, {
      projectId,
      limit,
    });
    for (let i = 0; i < memoryHits.length; i += 1) {
      const row = store.getHarnessMemoryByRowid(memoryHits[i]!.memoryRowid);
      if (!row) continue;
      hits.push(memoryToFtsHit(row, i + 1));
    }
  }

  return hits;
}

function rankSemanticEmbeddings(
  unitMap: Map<string, SemanticUnitRecord>,
  candidates: EmbeddingRecord[],
  queryVector: Float32Array,
  limit: number,
): UnifiedVectorHit[] {
  const scored: UnifiedVectorHit[] = [];
  for (const candidate of candidates) {
    const unit = unitMap.get(candidate.ownerId);
    if (!unit) continue;
    if (candidate.vector.length !== queryVector.length) continue;
    scored.push(unitToVectorHit(unit, cosineSimilarity(candidate.vector, queryVector)));
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

function rankMemoryEmbeddings(
  store: ProjectStore,
  projectId: string | null | undefined,
  candidates: EmbeddingRecord[],
  queryVector: Float32Array,
  limit: number,
): UnifiedVectorHit[] {
  const scored: UnifiedVectorHit[] = [];
  for (const candidate of candidates) {
    if (candidate.vector.length !== queryVector.length) continue;
    const row = store.getHarnessMemory(candidate.ownerId);
    if (!row) continue;
    if (projectId !== undefined && row.projectId !== projectId) continue;
    scored.push(memoryToVectorHit(row, cosineSimilarity(candidate.vector, queryVector)));
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

function buildFtsOnlyResult(
  hits: UnifiedFtsHit[],
  k: number,
  reason: string,
): SemanticSearchResult {
  const fused = new Map<string, FusedEntry>();
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i]!;
    const rank = i + 1;
    const entry = fused.get(hit.sourceRef) ?? emptyFused(hit);
    entry.ftsRank = rank;
    entry.score += 1 / (RRF_K + rank);
    fused.set(hit.sourceRef, entry);
  }

  return {
    mode: "fts-fallback",
    reason,
    results: hydrateResults(fused, k),
  };
}

export async function searchSemantic(
  input: SemanticSearchInput,
): Promise<SemanticSearchResult> {
  const k = input.k ?? 10;
  const ftsLimit = Math.max(k * 4, 50);
  const kinds = resolveSearchKinds(input);
  const ftsQuery = sanitizeFtsQuery(input.query);
  const ftsHits = collectFtsHits(
    input.store,
    ftsQuery,
    kinds,
    input.projectId,
    ftsLimit,
  );

  if (!input.embeddingProvider) {
    return buildFtsOnlyResult(ftsHits, k, "no embedding provider configured");
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
    semanticLogger.warn("semantic.search.embedding-failed.fts-fallback", { reason });
    return buildFtsOnlyResult(ftsHits, k, `embedding call failed: ${reason}`);
  }

  const vectorHits: UnifiedVectorHit[] = [];
  const model = input.embeddingProvider.modelId;

  const semanticKinds = toSemanticUnitKinds(kinds);
  if (semanticKinds.length > 0) {
    const units = input.store.listSemanticUnits({
      unitKinds: semanticKinds,
      projectId: input.projectId,
    });
    const unitMap = new Map(units.map((unit) => [unit.unitId, unit]));
    const unitEmbeddings = input.store.listEmbeddingsByModel({
      ownerKind: "semantic_unit",
      model,
      limit: Math.max(unitMap.size * 2, 10_000),
    });
    vectorHits.push(...rankSemanticEmbeddings(unitMap, unitEmbeddings, queryVector, ftsLimit));
  }

  if (kinds.includes("memory")) {
    const memoryEmbeddings = input.store.listEmbeddingsByModel({
      ownerKind: "memory",
      model,
      limit: 10_000,
    });
    vectorHits.push(
      ...rankMemoryEmbeddings(input.store, input.projectId, memoryEmbeddings, queryVector, ftsLimit),
    );
  }

  if (vectorHits.length === 0) {
    return buildFtsOnlyResult(
      ftsHits,
      k,
      `no embeddings stored under model \`${model}\``,
    );
  }

  const fused = new Map<string, FusedEntry>();
  for (let i = 0; i < ftsHits.length; i += 1) {
    const hit = ftsHits[i]!;
    const rank = i + 1;
    const entry = fused.get(hit.sourceRef) ?? emptyFused(hit);
    entry.ftsRank = rank;
    entry.score += 1 / (RRF_K + rank);
    fused.set(hit.sourceRef, entry);
  }

  for (let i = 0; i < vectorHits.length; i += 1) {
    const hit = vectorHits[i]!;
    const rank = i + 1;
    const entry = fused.get(hit.sourceRef) ?? emptyFused(hit);
    entry.vectorScore = hit.similarity;
    entry.score += 1 / (RRF_K + rank);
    fused.set(hit.sourceRef, entry);
  }

  return {
    mode: "hybrid",
    results: hydrateResults(fused, k),
  };
}

export async function reindexEmbeddings(
  input: {
    store: ProjectStore;
    embeddingProvider: EmbeddingProvider;
    kinds?: EmbeddingReindexKind[];
    projectId?: string | null;
  },
): Promise<EmbeddingReindexResult> {
  const kinds = input.kinds && input.kinds.length > 0
    ? [...new Set(input.kinds)]
    : (["semantic_unit", "memory"] as EmbeddingReindexKind[]);
  const result: EmbeddingReindexResult = {
    providerId: input.embeddingProvider.providerId,
    modelId: input.embeddingProvider.modelId,
    scanned: 0,
    embedded: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  if (kinds.includes("semantic_unit")) {
    const units = input.store.listSemanticUnits({
      projectId: input.projectId,
    });
    result.scanned += units.length;
    for (const unit of units) {
      if (input.store.getEmbeddingForOwner("semantic_unit", unit.unitId, input.embeddingProvider.modelId)) {
        result.skipped += 1;
        continue;
      }
      try {
        const vector = await input.embeddingProvider.embed(unit.text);
        input.store.insertEmbedding({
          ownerKind: "semantic_unit",
          ownerId: unit.unitId,
          provider: input.embeddingProvider.providerId,
          model: input.embeddingProvider.modelId,
          vector,
        });
        result.embedded += 1;
      } catch (error) {
        result.failed += 1;
        if (result.failures.length < 10) {
          result.failures.push({
            ownerKind: "semantic_unit",
            ownerId: unit.unitId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  if (kinds.includes("memory")) {
    const memories = input.store.listHarnessMemories({
      projectId: input.projectId,
      limit: 100_000,
    });
    result.scanned += memories.length;
    for (const memory of memories) {
      if (input.store.getEmbeddingForOwner("memory", memory.memoryId, input.embeddingProvider.modelId)) {
        result.skipped += 1;
        continue;
      }
      try {
        const vector = await input.embeddingProvider.embed(memory.text);
        input.store.insertEmbedding({
          ownerKind: "memory",
          ownerId: memory.memoryId,
          provider: input.embeddingProvider.providerId,
          model: input.embeddingProvider.modelId,
          vector,
        });
        result.embedded += 1;
      } catch (error) {
        result.failed += 1;
        if (result.failures.length < 10) {
          result.failures.push({
            ownerKind: "memory",
            ownerId: memory.memoryId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  return result;
}
