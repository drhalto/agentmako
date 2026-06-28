import type {
  ContextPacketIntent,
  ContextPacketReadableCandidate,
  ContextPacketSource,
  ContextPacketStrategy,
  IndexFreshnessDetail,
  JsonObject,
  JsonValue,
} from "@mako-ai/contracts";
import type { ContextPacketCandidateSeed } from "./types.js";

const CHAR_PER_TOKEN = 4;
const SUPPORTING_SIGNAL_LIMIT = 6;

const SOURCE_WEIGHT: Record<ContextPacketSource, number> = {
  live_text_provider: 34,
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

type RankingProfile = "default" | "anomaly_discovery";

const ANOMALY_DISCOVERY_TERMS = new Set([
  "dead",
  "diverge",
  "diverged",
  "divergence",
  "drift",
  "drifted",
  "duplicate",
  "duplicated",
  "duplicates",
  "duplication",
  "clone",
  "cloned",
  "clones",
  "orphan",
  "orphaned",
  "twin",
  "twins",
  "unreferenced",
  "unused",
]);

const ANOMALY_DISCOVERY_PHRASES = [
  "copy paste",
  "copy-paste",
  "copy/paste",
  "dead code",
  "near twin",
  "near-twin",
  "pattern drift",
];

interface RankOptions {
  maxPrimaryContext: number;
  maxRelatedContext: number;
  budgetTokens: number;
  freshnessPolicy: "report" | "prefer_fresh";
  freshnessByPath: Map<string, IndexFreshnessDetail>;
  focusFiles: Set<string>;
  changedFiles: Set<string>;
  focusSymbols: Set<string>;
  focusRoutes: Set<string>;
  focusDatabaseObjects: Set<string>;
  request?: string;
  intent?: ContextPacketIntent;
}

export interface RankedContextCandidates {
  primaryContext: ContextPacketReadableCandidate[];
  relatedContext: ContextPacketReadableCandidate[];
  /**
   * Selected candidates with their supporting signals always attached,
   * regardless of budget compaction. Request coverage / diagnostics derive
   * "what was retrieved" from this so a signal stripped only to fit budgetTokens
   * is not mis-reported as an uncovered anchor.
   */
  coverageContext: ContextPacketReadableCandidate[];
  candidatesConsidered: number;
  rankedCandidateCount: number;
  candidatesReturned: number;
  returnedTokenEstimate: number;
  supportingSignalsOmitted: number;
  selectionLimitHit: boolean;
  candidatesOmittedByLimit: number;
  requestedAnchorsOmitted: number;
  omittedRequestedAnchors: RankedOmittedRequestedAnchor[];
  budgetExhausted: boolean;
}

export interface RankedOmittedRequestedAnchor {
  kind: ContextPacketReadableCandidate["kind"];
  value: string;
  reason: "budget" | "selection_limit";
  candidateId: string;
  score: number;
  path?: string;
}

interface MergeEntry {
  candidate: ContextPacketCandidateSeed;
  score: number;
  supportingSignals: JsonObject[];
}

interface RankedCandidateItem {
  entry: MergeEntry;
  bonus: number;
  candidateSeed: ContextPacketCandidateSeed;
  candidate: ContextPacketReadableCandidate;
}

interface SelectedCandidateItem {
  item: RankedCandidateItem;
  candidate: ContextPacketReadableCandidate;
  tokenCost: number;
  slot: "primary" | "related";
}

interface RequestedAnchorIdentity {
  kind: ContextPacketReadableCandidate["kind"];
  value: string;
  priority: number;
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

function supportingSignalKey(signal: JsonObject): string {
  return [
    signal.source,
    signal.strategy,
    signal.path,
    signal.symbolName,
    signal.routeKey,
    signal.databaseObjectName,
    signal.lineStart,
    signal.whyIncluded,
  ].map((value) => String(value ?? "")).join("|");
}

function signalString(signal: JsonObject, key: string): string | undefined {
  const value = signal[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function corroborationBonus(entry: MergeEntry): number {
  if (entry.supportingSignals.length === 0) return 0;

  const sourceStrategyPairs = new Set<string>([`${entry.candidate.source}:${entry.candidate.strategy}`]);
  const sources = new Set<string>([entry.candidate.source]);
  for (const signal of entry.supportingSignals) {
    const source = signalString(signal, "source");
    const strategy = signalString(signal, "strategy");
    if (source) sources.add(source);
    if (source && strategy) sourceStrategyPairs.add(`${source}:${strategy}`);
  }

  const extraSourceCount = Math.max(0, sources.size - 1);
  const extraPairCount = Math.max(0, sourceStrategyPairs.size - 1);
  const sameSourcePairCount = Math.max(0, extraPairCount - extraSourceCount);
  return Math.min(18, extraSourceCount * 7 + sameSourcePairCount * 3);
}

function withRankScoreOverride(candidate: ContextPacketCandidateSeed, score: number): ContextPacketCandidateSeed {
  return {
    ...candidate,
    rankScoreOverride: Number(score.toFixed(4)),
  };
}

function compactSignalMetadata(metadata: JsonObject | undefined): JsonObject | undefined {
  if (!metadata) return undefined;
  const kept: JsonObject = {};
  const keys = [
    "query",
    "language",
    "schemaObject",
    "usageKind",
    "direction",
    "graphDepth",
    "graphPath",
    "graphRankMode",
    "graphRankDirection",
    "graphRankScore",
    "graphTraversalMode",
    "focusRelation",
    "focusDistance",
    "dependencyDistance",
    "dependentDistance",
    "graphPersonalizationSeedCount",
    "graphSeedSources",
    "seedPath",
    "queryKind",
    "from",
    "target",
    "specifier",
    "inboundCount",
    "outboundCount",
    "overlay",
    "conventionKind",
    "hintKind",
    "symbolKind",
    "chunkKind",
    "pattern",
    "method",
    "handlerName",
    "isApi",
  ];

  for (const key of keys) {
    const value = metadata[key];
    if (value !== undefined) kept[key] = value as JsonValue;
  }

  return Object.keys(kept).length > 0 ? kept : undefined;
}

function supportingSignal(candidate: ContextPacketCandidateSeed, score: number): JsonObject {
  const signal: JsonObject = {
    source: candidate.source,
    strategy: candidate.strategy,
    whyIncluded: candidate.whyIncluded,
    confidence: candidate.confidence,
    score,
  };
  if (candidate.path) signal.path = candidate.path;
  if (candidate.lineStart != null) signal.lineStart = candidate.lineStart;
  if (candidate.lineEnd != null) signal.lineEnd = candidate.lineEnd;
  if (candidate.symbolName) signal.symbolName = candidate.symbolName;
  if (candidate.routeKey) signal.routeKey = candidate.routeKey;
  if (candidate.databaseObjectName) signal.databaseObjectName = candidate.databaseObjectName;
  const compactMetadata = compactSignalMetadata(candidate.metadata);
  if (compactMetadata) signal.metadata = compactMetadata;
  return signal;
}

function attachSupportingSignals(
  candidate: ContextPacketCandidateSeed,
  supportingSignals: readonly JsonObject[],
  bonus: number,
): ContextPacketCandidateSeed {
  if (supportingSignals.length === 0 && bonus <= 0) return candidate;
  const seen = new Set<string>();
  const uniqueSignals: JsonObject[] = [];
  for (const signal of supportingSignals) {
    const key = supportingSignalKey(signal);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSignals.push(signal);
  }
  const sortedSignals = uniqueSignals
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .slice(0, SUPPORTING_SIGNAL_LIMIT);

  if (sortedSignals.length === 0 && bonus <= 0) return candidate;
  return {
    ...candidate,
    metadata: {
      ...(candidate.metadata ?? {}),
      ...(bonus > 0 ? {
        corroborationBonus: Number(bonus.toFixed(4)),
        corroboratedSignalCount: supportingSignals.length + 1,
      } : {}),
      ...(sortedSignals.length > 0 ? { supportingSignals: sortedSignals } : {}),
    },
  };
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

function detectRankingProfile(options: RankOptions): RankingProfile {
  const requestLower = options.request?.toLowerCase() ?? "";
  if (ANOMALY_DISCOVERY_PHRASES.some((phrase) => requestLower.includes(phrase))) {
    return "anomaly_discovery";
  }

  const terms = new Set<string>();
  for (const keyword of options.intent?.entities.keywords ?? []) {
    terms.add(keyword.toLowerCase());
  }
  for (const signal of options.intent?.families.flatMap((family) => family.signals) ?? []) {
    terms.add(signal.toLowerCase());
  }
  for (const word of requestLower.match(/\b[a-z][a-z0-9_-]{2,}\b/g) ?? []) {
    terms.add(word.replace(/^-+|-+$/g, ""));
  }

  return [...terms].some((term) => ANOMALY_DISCOVERY_TERMS.has(term))
    ? "anomaly_discovery"
    : "default";
}

function centralityProfileAdjustment(
  candidate: ContextPacketCandidateSeed,
  options: RankOptions,
  profile: RankingProfile,
): number {
  if (profile !== "anomaly_discovery" || candidate.strategy !== "centrality_rank") {
    return 0;
  }
  if (candidate.path && (options.focusFiles.has(candidate.path) || options.changedFiles.has(candidate.path))) {
    return 0;
  }

  // For duplicate/drift/dead-code discovery, centrality is supporting context:
  // useful if nothing else matches, but a poor primary ranking signal.
  return -85 - Math.max(0, candidate.baseScore ?? 0);
}

function scoreCandidate(
  candidate: ContextPacketCandidateSeed,
  options: RankOptions,
): number {
  if (candidate.rankScoreOverride != null) return candidate.rankScoreOverride;
  const rankingProfile = detectRankingProfile(options);
  let score = candidate.confidence * 100;
  score += SOURCE_WEIGHT[candidate.source] ?? 0;
  score += STRATEGY_WEIGHT[candidate.strategy] ?? 0;
  score += candidate.baseScore ?? 0;
  // Non-file anchors are injected as provider search terms and then preserved
  // during final selection, so they do not need a separate score boost here.
  if (candidate.path && options.focusFiles.has(candidate.path)) score += 70;
  if (candidate.path && options.changedFiles.has(candidate.path)) score += 55;
  if (candidate.lineStart != null) score += 4;
  score += freshnessPenalty(candidate, options);
  score += centralityProfileAdjustment(candidate, options, rankingProfile);
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

function candidateSupportingSignalCount(candidate: ContextPacketReadableCandidate): number {
  const signals = candidate.metadata?.supportingSignals;
  return Array.isArray(signals) ? signals.length : 0;
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeLoose(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRouteAnchor(value: string): string {
  return normalizeLoose(value)
    .replace(/^nextjs:/, "")
    .replace(/^(get|post|put|patch|delete|options|head):/, "$1 ")
    .replace(/\s+/g, " ");
}

function normalizeDatabaseObjectAnchor(value: string): string {
  return normalizeLoose(value).replace(/["'`]/g, "");
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function graphSeedPath(item: RankedCandidateItem): string | undefined {
  if (item.candidate.source !== "import_graph_provider" && item.candidate.strategy !== "deterministic_graph") {
    return undefined;
  }
  return metadataString(item.candidate.metadata?.seedPath);
}

function diversifyGraphSeededCandidates(
  ranked: readonly RankedCandidateItem[],
): RankedCandidateItem[] {
  const graphGroups = new Map<string, RankedCandidateItem[]>();
  const graphSeedOrder: string[] = [];
  for (const item of ranked) {
    const seedPath = graphSeedPath(item);
    if (!seedPath) continue;
    const group = graphGroups.get(seedPath);
    if (group) {
      group.push(item);
    } else {
      graphGroups.set(seedPath, [item]);
      graphSeedOrder.push(seedPath);
    }
  }

  if (graphGroups.size <= 1) return [...ranked];

  const diversifiedGraphItems: RankedCandidateItem[] = [];
  while ([...graphGroups.values()].some((group) => group.length > 0)) {
    const heads = graphSeedOrder
      .flatMap((seedPath) => {
        const group = graphGroups.get(seedPath) ?? [];
        const head = group[0];
        return head ? [{ seedPath, head }] : [];
      })
      .sort((left, right) =>
        right.head.candidate.score - left.head.candidate.score ||
        graphSeedOrder.indexOf(left.seedPath) - graphSeedOrder.indexOf(right.seedPath)
      );

    for (const { seedPath } of heads) {
      const group = graphGroups.get(seedPath);
      const next = group?.shift();
      if (next) diversifiedGraphItems.push(next);
    }
  }

  const graphQueue = [...diversifiedGraphItems];
  return ranked.map((item) => graphSeedPath(item) ? graphQueue.shift() ?? item : item);
}

function requestedFileAnchorIdentity(
  item: RankedCandidateItem,
  options: RankOptions,
): RequestedAnchorIdentity | undefined {
  const filePath = item.candidate.path;
  if (!filePath) return undefined;
  if (options.changedFiles.has(filePath)) return { kind: "file", value: filePath, priority: 0 };
  if (options.focusFiles.has(filePath)) return { kind: "file", value: filePath, priority: 1 };
  return undefined;
}

function symbolAnchorIdentity(
  candidate: ContextPacketReadableCandidate,
  options: RankOptions,
): RequestedAnchorIdentity | undefined {
  const symbolName = candidate.symbolName;
  if (!symbolName || !options.focusSymbols.has(normalizeLoose(symbolName))) return undefined;
  return { kind: "symbol", value: symbolName, priority: 2 };
}

function routeAnchorIdentity(
  candidate: ContextPacketReadableCandidate,
  options: RankOptions,
): RequestedAnchorIdentity | undefined {
  const routeValues = [
    candidate.routeKey,
    stringMetadata(candidate.metadata?.pattern),
  ].filter((value): value is string => Boolean(value));
  for (const raw of routeValues) {
    const route = normalizeRouteAnchor(raw);
    const matched = [...options.focusRoutes].find((focusRoute) =>
      route === focusRoute || route.includes(focusRoute) || focusRoute.includes(route)
    );
    if (matched) return { kind: "route", value: matched, priority: 3 };
  }
  return undefined;
}

function databaseObjectAnchorIdentity(
  candidate: ContextPacketReadableCandidate,
  options: RankOptions,
): RequestedAnchorIdentity | undefined {
  const objectValues = [
    candidate.databaseObjectName,
    stringMetadata(candidate.metadata?.schemaObject),
  ].filter((value): value is string => Boolean(value));
  for (const raw of objectValues) {
    const objectName = normalizeDatabaseObjectAnchor(raw);
    const matched = [...options.focusDatabaseObjects].find((focusObject) =>
      objectName === focusObject ||
      objectName.endsWith(`.${focusObject}`) ||
      focusObject.endsWith(`.${objectName}`)
    );
    if (matched) return { kind: "database_object", value: matched, priority: 4 };
  }
  return undefined;
}

function requestedAnchorIdentity(
  item: RankedCandidateItem,
  options: RankOptions,
): RequestedAnchorIdentity | undefined {
  return requestedFileAnchorIdentity(item, options) ??
    symbolAnchorIdentity(item.candidate, options) ??
    routeAnchorIdentity(item.candidate, options) ??
    databaseObjectAnchorIdentity(item.candidate, options);
}

function requestedAnchorIdentityKey(identity: RequestedAnchorIdentity): string {
  return `${identity.kind}:${normalizeLoose(identity.value)}`;
}

function requestedAnchorPriority(item: RankedCandidateItem, options: RankOptions): number {
  return requestedAnchorIdentity(item, options)?.priority ?? 5;
}

function prioritizeRequestedAnchors(
  ranked: readonly RankedCandidateItem[],
  options: RankOptions,
): RankedCandidateItem[] {
  return [...ranked].sort((left, right) =>
    requestedAnchorPriority(left, options) - requestedAnchorPriority(right, options)
  );
}

function omittedRequestedAnchors(args: {
  ranked: readonly RankedCandidateItem[];
  selected: readonly SelectedCandidateItem[];
  options: RankOptions;
  reason: RankedOmittedRequestedAnchor["reason"];
}): RankedOmittedRequestedAnchor[] {
  const selectedAnchors = new Set<string>();
  for (const selectedItem of args.selected) {
    const identity = requestedAnchorIdentity(selectedItem.item, args.options);
    if (identity) selectedAnchors.add(requestedAnchorIdentityKey(identity));
  }

  const omitted: RankedOmittedRequestedAnchor[] = [];
  const seen = new Set<string>();
  for (const item of args.ranked) {
    const identity = requestedAnchorIdentity(item, args.options);
    if (!identity) continue;
    const key = requestedAnchorIdentityKey(identity);
    if (selectedAnchors.has(key) || seen.has(key)) continue;
    seen.add(key);
    omitted.push({
      kind: identity.kind,
      value: identity.value,
      reason: args.reason,
      candidateId: item.candidate.id,
      score: item.candidate.score,
      ...(item.candidate.path ? { path: item.candidate.path } : {}),
    });
  }
  return omitted;
}

export function rankContextCandidates(
  candidates: readonly ContextPacketCandidateSeed[],
  options: RankOptions,
): RankedContextCandidates {
  const merged = new Map<string, MergeEntry>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const existing = merged.get(key);
    const score = scoreCandidate(candidate, options);
    if (!existing) {
      merged.set(key, { candidate, score, supportingSignals: [] });
      continue;
    }

    if (score > existing.score) {
      merged.set(key, {
        candidate,
        score,
        supportingSignals: [
          supportingSignal(existing.candidate, existing.score),
          ...existing.supportingSignals,
        ],
      });
      continue;
    }

    existing.supportingSignals.push(supportingSignal(candidate, score));
  }

  const scoreRanked = [...merged.values()]
    .map((entry) => {
      const bonus = corroborationBonus(entry);
      const candidate = bonus > 0
        ? withRankScoreOverride(entry.candidate, entry.score + bonus)
        : entry.candidate;
      return {
        entry,
        bonus,
        candidateSeed: candidate,
        candidate: normalizeCandidate(candidate, options),
      };
    })
    .filter((item): item is RankedCandidateItem => item.candidate != null)
    .sort((left, right) => right.candidate.score - left.candidate.score || left.candidate.id.localeCompare(right.candidate.id));
  const graphDiversified = diversifyGraphSeededCandidates(scoreRanked);
  const ranked = prioritizeRequestedAnchors(graphDiversified, options);

  const primaryContext: ContextPacketReadableCandidate[] = [];
  const relatedContext: ContextPacketReadableCandidate[] = [];
  const selected: SelectedCandidateItem[] = [];
  let usedTokens = 0;
  let budgetExhausted = false;
  let supportingSignalsOmitted = 0;

  for (const item of ranked) {
    const candidate = item.candidate;
    const tokenCost = estimateCandidateTokens(candidate);
    if (usedTokens + tokenCost > options.budgetTokens) {
      budgetExhausted = true;
      if (selected.length > 0) break;
    }

    if (primaryContext.length < options.maxPrimaryContext) {
      selected.push({ item, candidate, tokenCost, slot: "primary" });
      primaryContext.push(candidate);
      usedTokens += tokenCost;
      continue;
    }

    if (relatedContext.length < options.maxRelatedContext) {
      selected.push({ item, candidate, tokenCost, slot: "related" });
      relatedContext.push(candidate);
      usedTokens += tokenCost;
      continue;
    }

    break;
  }

  const maxSelectableCandidates = options.maxPrimaryContext + options.maxRelatedContext;
  const selectionLimitHit = selected.length >= maxSelectableCandidates && selected.length < ranked.length;
  const candidatesOmittedByLimit = selectionLimitHit ? ranked.length - selected.length : 0;
  const omittedAnchorReason: RankedOmittedRequestedAnchor["reason"] = budgetExhausted
    ? "budget"
    : "selection_limit";
  const omittedAnchors = omittedRequestedAnchors({
    ranked,
    selected,
    options,
    reason: omittedAnchorReason,
  });

  primaryContext.length = 0;
  relatedContext.length = 0;
  const coverageContext: ContextPacketReadableCandidate[] = [];
  for (const selectedItem of selected) {
    const candidateWithSupportingSignals = normalizeCandidate(
      attachSupportingSignals(
        selectedItem.item.candidateSeed,
        selectedItem.item.entry.supportingSignals,
        selectedItem.item.bonus,
      ),
      options,
    ) ?? selectedItem.candidate;
    // Coverage reflects retrieval, not the budget-trimmed payload, so always
    // record the enriched candidate even when its signals are omitted below.
    coverageContext.push(candidateWithSupportingSignals);
    const enrichedTokenCost = estimateCandidateTokens(candidateWithSupportingSignals);
    const extraTokenCost = enrichedTokenCost - selectedItem.tokenCost;
    const supportingSignalCount = candidateSupportingSignalCount(candidateWithSupportingSignals);
    const omitSupportingSignals =
      supportingSignalCount > 0 &&
      extraTokenCost > 0 &&
      usedTokens + extraTokenCost > options.budgetTokens;
    const finalCandidate = omitSupportingSignals ? selectedItem.candidate : candidateWithSupportingSignals;
    if (omitSupportingSignals) {
      supportingSignalsOmitted += supportingSignalCount;
    }
    if (finalCandidate === candidateWithSupportingSignals) {
      usedTokens += Math.max(0, extraTokenCost);
    }

    if (selectedItem.slot === "primary") {
      primaryContext.push(finalCandidate);
    } else {
      relatedContext.push(finalCandidate);
    }
  }

  return {
    primaryContext,
    relatedContext,
    coverageContext,
    candidatesConsidered: candidates.length,
    rankedCandidateCount: ranked.length,
    candidatesReturned: primaryContext.length + relatedContext.length,
    returnedTokenEstimate: usedTokens,
    supportingSignalsOmitted,
    selectionLimitHit,
    candidatesOmittedByLimit,
    requestedAnchorsOmitted: omittedAnchors.length,
    omittedRequestedAnchors: omittedAnchors,
    budgetExhausted,
  };
}
