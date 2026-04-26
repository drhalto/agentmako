import type {
  ContextPacketReadableCandidate,
  ContextPacketSource,
  ContextPacketStrategy,
  IndexFreshnessDetail,
} from "@mako-ai/contracts";
import type { ContextPacketCandidateSeed } from "./types.js";

const CHAR_PER_TOKEN = 4;

const SOURCE_WEIGHT: Record<ContextPacketSource, number> = {
  route_provider: 30,
  file_provider: 28,
  schema_provider: 26,
  symbol_provider: 25,
  import_graph_provider: 14,
  repo_map_provider: 8,
  hot_hint_index: 12,
  working_tree_overlay: 29,
  reef_convention: 18,
};

const STRATEGY_WEIGHT: Record<ContextPacketStrategy, number> = {
  exact_match: 28,
  deterministic_graph: 16,
  symbol_reference: 18,
  schema_usage: 18,
  hot_hint: 10,
  centrality_rank: 8,
  overlay_fact: 24,
  convention_memory: 16,
};

interface RankOptions {
  maxPrimaryContext: number;
  maxRelatedContext: number;
  budgetTokens: number;
  freshnessPolicy: "report" | "prefer_fresh";
  freshnessByPath: Map<string, IndexFreshnessDetail>;
  focusFiles: Set<string>;
  changedFiles: Set<string>;
}

export interface RankedContextCandidates {
  primaryContext: ContextPacketReadableCandidate[];
  relatedContext: ContextPacketReadableCandidate[];
  candidatesConsidered: number;
  candidatesReturned: number;
  budgetExhausted: boolean;
}

function candidateKey(candidate: ContextPacketCandidateSeed): string {
  const sourceScope = candidate.source === "working_tree_overlay" || candidate.source === "reef_convention"
    ? candidate.source
    : "";
  return [
    sourceScope,
    candidate.kind,
    candidate.path ?? "",
    candidate.symbolName ?? "",
    candidate.routeKey ?? "",
    candidate.databaseObjectName ?? "",
    candidate.lineStart ?? "",
  ].join("|");
}

function candidateId(candidate: ContextPacketCandidateSeed): string {
  const parts = [
    candidate.kind,
    candidate.path ?? candidate.routeKey ?? candidate.databaseObjectName ?? "unknown",
    candidate.symbolName ?? "",
    candidate.lineStart ?? "",
  ].filter(Boolean);
  return parts.join(":").replace(/[^A-Za-z0-9_.:/-]+/g, "_");
}

function freshnessPenalty(
  candidate: ContextPacketCandidateSeed,
  options: RankOptions,
): number {
  if (options.freshnessPolicy !== "prefer_fresh" || !candidate.path) return 0;
  const freshness = options.freshnessByPath.get(candidate.path);
  switch (freshness?.state) {
    case "stale":
      return -35;
    case "deleted":
      return -60;
    case "unknown":
      return -15;
    case "unindexed":
      return -10;
    case "fresh":
    default:
      return 0;
  }
}

function scoreCandidate(
  candidate: ContextPacketCandidateSeed,
  options: RankOptions,
): number {
  let score = candidate.confidence * 100;
  score += SOURCE_WEIGHT[candidate.source] ?? 0;
  score += STRATEGY_WEIGHT[candidate.strategy] ?? 0;
  score += candidate.baseScore ?? 0;
  // Only path-bearing focus signals get a ranking boost here. focusSymbols /
  // focusRoutes / focusDatabaseObjects are already injected as provider
  // search terms, so the symbol/route/schema providers will surface them as
  // exact_match candidates with their natural source/strategy weight — no
  // separate boost is needed.
  if (candidate.path && options.focusFiles.has(candidate.path)) score += 70;
  if (candidate.path && options.changedFiles.has(candidate.path)) score += 55;
  if (candidate.lineStart != null) score += 4;
  score += freshnessPenalty(candidate, options);
  return Number(score.toFixed(4));
}

function normalizeCandidate(
  candidate: ContextPacketCandidateSeed,
  options: RankOptions,
): ContextPacketReadableCandidate | null {
  if (candidate.kind !== "database_object" && !candidate.path && !candidate.routeKey && !candidate.symbolName) {
    return null;
  }
  if (candidate.kind === "database_object" && !candidate.databaseObjectName) {
    return null;
  }

  return {
    id: candidate.id ?? candidateId(candidate),
    kind: candidate.kind,
    ...(candidate.path ? { path: candidate.path } : {}),
    ...(candidate.lineStart != null ? { lineStart: candidate.lineStart } : {}),
    ...(candidate.lineEnd != null ? { lineEnd: candidate.lineEnd } : {}),
    ...(candidate.symbolName ? { symbolName: candidate.symbolName } : {}),
    ...(candidate.routeKey ? { routeKey: candidate.routeKey } : {}),
    ...(candidate.databaseObjectName ? { databaseObjectName: candidate.databaseObjectName } : {}),
    source: candidate.source,
    strategy: candidate.strategy,
    whyIncluded: candidate.whyIncluded,
    confidence: candidate.confidence,
    score: scoreCandidate(candidate, options),
    ...(candidate.path && options.freshnessByPath.has(candidate.path)
      ? { freshness: options.freshnessByPath.get(candidate.path) }
      : {}),
    ...(candidate.evidenceRef ? { evidenceRef: candidate.evidenceRef } : {}),
    ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
  };
}

function estimateCandidateTokens(candidate: ContextPacketReadableCandidate): number {
  return Math.max(1, Math.ceil(JSON.stringify(candidate).length / CHAR_PER_TOKEN));
}

export function rankContextCandidates(
  candidates: readonly ContextPacketCandidateSeed[],
  options: RankOptions,
): RankedContextCandidates {
  const merged = new Map<string, ContextPacketCandidateSeed>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const existing = merged.get(key);
    if (!existing || scoreCandidate(candidate, options) > scoreCandidate(existing, options)) {
      merged.set(key, candidate);
    }
  }

  const ranked = [...merged.values()]
    .map((candidate) => normalizeCandidate(candidate, options))
    .filter((candidate): candidate is ContextPacketReadableCandidate => candidate != null)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  const primaryContext: ContextPacketReadableCandidate[] = [];
  const relatedContext: ContextPacketReadableCandidate[] = [];
  let usedTokens = 0;
  let budgetExhausted = false;

  for (const candidate of ranked) {
    const tokenCost = estimateCandidateTokens(candidate);
    if (usedTokens + tokenCost > options.budgetTokens && primaryContext.length > 0) {
      budgetExhausted = true;
      break;
    }

    if (primaryContext.length < options.maxPrimaryContext) {
      primaryContext.push(candidate);
      usedTokens += tokenCost;
      continue;
    }

    if (relatedContext.length < options.maxRelatedContext) {
      relatedContext.push(candidate);
      usedTokens += tokenCost;
      continue;
    }

    break;
  }

  return {
    primaryContext,
    relatedContext,
    candidatesConsidered: candidates.length,
    candidatesReturned: primaryContext.length + relatedContext.length,
    budgetExhausted,
  };
}
