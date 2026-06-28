import type {
  ContextPacketGraphEdgeRelation,
  ContextPacketGraphSummary,
  ContextPacketGraphFileRelation,
  ContextPacketGraphPathEvidence,
  ContextPacketIntent,
  ContextPacketReadableCandidate,
  ContextPacketSource,
  ContextPacketStrategy,
  ContextPacketToolInput,
  JsonObject,
} from "@mako-ai/contracts";

const MAX_GRAPH_FILES = 16;
const MAX_GRAPH_EDGES = 32;
const MAX_REASONS_PER_FILE = 4;
const MAX_PATH_EVIDENCE_PER_FILE = 3;
const MAX_GRAPH_PATH_LENGTH = 8;

const CONTEXT_PACKET_SOURCES = new Set<ContextPacketSource>([
  "live_text_provider",
  "route_provider",
  "file_provider",
  "schema_provider",
  "symbol_provider",
  "import_graph_provider",
  "repo_map_provider",
  "hot_hint_index",
  "working_tree_overlay",
  "reef_convention",
]);

const CONTEXT_PACKET_STRATEGIES = new Set<ContextPacketStrategy>([
  "exact_match",
  "deterministic_graph",
  "symbol_reference",
  "schema_usage",
  "hot_hint",
  "centrality_rank",
  "overlay_fact",
  "convention_memory",
]);

interface FileAccumulator {
  filePath: string;
  relations: Set<ContextPacketGraphFileRelation>;
  distances: number[];
  sources: Set<ContextPacketSource>;
  strategies: Set<ContextPacketStrategy>;
  score: number;
  confidence: number;
  reasons: string[];
  pathEvidence: Map<string, ContextPacketGraphPathEvidence>;
}

interface CandidateSignal {
  filePath: string;
  source?: ContextPacketSource;
  strategy?: ContextPacketStrategy;
  score?: number;
  confidence?: number;
  whyIncluded?: string;
  metadata?: JsonObject;
}

type GraphFileSummary = ContextPacketGraphSummary["files"][number];
type GraphEdgeSummary = ContextPacketGraphSummary["edges"][number];

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = normalizePath(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function jsonRecord(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return jsonArray(value)
    .map(stringValue)
    .filter((entry): entry is string => Boolean(entry))
    .map(normalizePath)
    .filter(Boolean);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sourceValue(value: unknown): ContextPacketSource | undefined {
  return typeof value === "string" && CONTEXT_PACKET_SOURCES.has(value as ContextPacketSource)
    ? value as ContextPacketSource
    : undefined;
}

function strategyValue(value: unknown): ContextPacketStrategy | undefined {
  return typeof value === "string" && CONTEXT_PACKET_STRATEGIES.has(value as ContextPacketStrategy)
    ? value as ContextPacketStrategy
    : undefined;
}

function addReason(reasons: string[], reason: string | undefined): void {
  if (!reason) return;
  const normalized = reason.trim();
  if (!normalized || reasons.includes(normalized)) return;
  reasons.push(normalized);
}

function relationFromFocus(value: unknown): ContextPacketGraphFileRelation | undefined {
  switch (value) {
    case "self":
      return "anchor";
    case "dependency":
    case "dependent":
    case "bidirectional":
      return value;
    default:
      return undefined;
  }
}

function inferSignalRelation(
  signal: CandidateSignal,
  anchorFiles: ReadonlySet<string>,
): { relation: ContextPacketGraphFileRelation; distance?: number } {
  if (anchorFiles.has(signal.filePath)) {
    return { relation: "anchor", distance: 0 };
  }

  const metadata = signal.metadata;
  const focusRelation = relationFromFocus(metadata?.focusRelation);
  if (focusRelation) {
    const focusDistance = numberValue(metadata?.focusDistance);
    return {
      relation: focusRelation,
      ...(focusDistance != null ? { distance: Math.max(0, Math.round(focusDistance)) } : {}),
    };
  }

  const direction = stringValue(metadata?.direction);
  if (direction === "outbound" || direction === "inbound") {
    const graphDepth = numberValue(metadata?.graphDepth);
    return {
      relation: direction === "outbound" ? "dependency" : "dependent",
      ...(graphDepth != null ? { distance: Math.max(0, Math.round(graphDepth)) } : {}),
    };
  }

  if (signal.source === "repo_map_provider" || signal.strategy === "centrality_rank") {
    return { relation: "central" };
  }

  return { relation: "unknown" };
}

function pathEvidenceKey(evidence: ContextPacketGraphPathEvidence): string {
  return [
    evidence.anchorFile,
    evidence.targetFile,
    evidence.relation,
    evidence.source,
    evidence.strategy,
    evidence.path.join(">"),
  ].join("|");
}

function boundedGraphPath(path: readonly string[], targetFile: string): string[] {
  const normalized = path.map(normalizePath).filter(Boolean);
  if (normalized.length === 0) return [targetFile];
  const targetIndex = normalized.lastIndexOf(targetFile);
  const targetBounded = targetIndex >= 0
    ? normalized.slice(0, targetIndex + 1)
    : [...normalized, targetFile];
  return targetBounded.slice(0, MAX_GRAPH_PATH_LENGTH);
}

function graphPathEvidence(args: {
  signal: CandidateSignal;
  relation: ContextPacketGraphFileRelation;
  distance?: number;
  anchorFiles: ReadonlySet<string>;
}): ContextPacketGraphPathEvidence | undefined {
  if (!args.signal.source || !args.signal.strategy) return undefined;

  const targetFile = normalizePath(args.signal.filePath);
  const metadata = args.signal.metadata;
  const rawGraphPath = stringArray(metadata?.graphPath);
  const seedPath = stringValue(metadata?.seedPath);
  const path = rawGraphPath.length > 0
    ? boundedGraphPath(rawGraphPath, targetFile)
    : args.anchorFiles.has(targetFile)
      ? [targetFile]
      : [];
  if (path.length === 0) return undefined;

  const normalizedSeedPath = seedPath ? normalizePath(seedPath) : undefined;
  const anchorFile = normalizedSeedPath && path.includes(normalizedSeedPath)
    ? normalizedSeedPath
    : path.find((filePath) => args.anchorFiles.has(filePath)) ?? path[0];
  if (!anchorFile) return undefined;

  const distance = args.distance != null
    ? args.distance
    : Math.max(0, path.length - 1);

  return {
    anchorFile,
    targetFile,
    relation: args.relation,
    distance: Math.max(0, Math.round(distance)),
    path,
    source: args.signal.source,
    strategy: args.signal.strategy,
    reason: args.signal.whyIncluded ?? `Graph path from ${anchorFile} to ${targetFile}.`,
  };
}

function addPathEvidence(
  accumulator: FileAccumulator,
  evidence: ContextPacketGraphPathEvidence | undefined,
): void {
  if (!evidence) return;
  accumulator.pathEvidence.set(pathEvidenceKey(evidence), evidence);
}

function mergedRelation(relations: ReadonlySet<ContextPacketGraphFileRelation>): ContextPacketGraphFileRelation {
  if (relations.has("anchor")) return "anchor";
  if (relations.has("bidirectional") || (relations.has("dependency") && relations.has("dependent"))) {
    return "bidirectional";
  }
  if (relations.has("dependency")) return "dependency";
  if (relations.has("dependent")) return "dependent";
  if (relations.has("central")) return "central";
  return "unknown";
}

function relationRank(relation: ContextPacketGraphFileRelation): number {
  switch (relation) {
    case "anchor":
      return 0;
    case "bidirectional":
      return 1;
    case "dependency":
      return 2;
    case "dependent":
      return 3;
    case "central":
      return 4;
    case "unknown":
      return 5;
  }
  return 5;
}

function signalFromCandidate(candidate: ContextPacketReadableCandidate): CandidateSignal | undefined {
  if (!candidate.path) return undefined;
  return {
    filePath: normalizePath(candidate.path),
    source: candidate.source,
    strategy: candidate.strategy,
    score: candidate.score,
    confidence: candidate.confidence,
    whyIncluded: candidate.whyIncluded,
    metadata: candidate.metadata,
  };
}

function supportingSignals(candidate: ContextPacketReadableCandidate): CandidateSignal[] {
  if (!candidate.path) return [];
  const out: CandidateSignal[] = [];
  for (const raw of jsonArray(candidate.metadata?.supportingSignals)) {
    const signal = jsonRecord(raw);
    if (!signal) continue;
    const signalPath = stringValue(signal.path) ?? candidate.path;
    out.push({
      filePath: normalizePath(signalPath),
      source: sourceValue(signal.source),
      strategy: strategyValue(signal.strategy),
      score: numberValue(signal.score),
      confidence: numberValue(signal.confidence),
      whyIncluded: stringValue(signal.whyIncluded),
      metadata: jsonRecord(signal.metadata),
    });
  }
  return out;
}

function collectAnchorFiles(args: {
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
  candidates: readonly ContextPacketReadableCandidate[];
}): string[] {
  const anchors = [
    ...(args.input.focusFiles ?? []),
    ...(args.input.changedFiles ?? []),
    ...args.intent.entities.files,
  ];

  for (const candidate of args.candidates) {
    const seedPath = stringValue(candidate.metadata?.seedPath);
    if (seedPath) anchors.push(seedPath);
    for (const signal of supportingSignals(candidate)) {
      const signalSeedPath = stringValue(signal.metadata?.seedPath);
      if (signalSeedPath) anchors.push(signalSeedPath);
    }
  }

  return uniqueStrings(anchors);
}

function updateAccumulator(
  accumulators: Map<string, FileAccumulator>,
  signal: CandidateSignal,
  anchorFiles: ReadonlySet<string>,
): void {
  const filePath = normalizePath(signal.filePath);
  if (!filePath) return;
  const relation = inferSignalRelation({ ...signal, filePath }, anchorFiles);
  const current = accumulators.get(filePath) ?? {
    filePath,
    relations: new Set<ContextPacketGraphFileRelation>(),
    distances: [],
    sources: new Set<ContextPacketSource>(),
    strategies: new Set<ContextPacketStrategy>(),
    score: Number.NEGATIVE_INFINITY,
    confidence: 0,
    reasons: [],
    pathEvidence: new Map<string, ContextPacketGraphPathEvidence>(),
  };
  current.relations.add(relation.relation);
  if (relation.distance != null) current.distances.push(relation.distance);
  if (signal.source) current.sources.add(signal.source);
  if (signal.strategy) current.strategies.add(signal.strategy);
  if (signal.score != null) current.score = Math.max(current.score, signal.score);
  if (signal.confidence != null) current.confidence = Math.max(current.confidence, signal.confidence);
  addReason(current.reasons, signal.whyIncluded);
  addPathEvidence(current, graphPathEvidence({
    signal: { ...signal, filePath },
    relation: relation.relation,
    distance: relation.distance,
    anchorFiles,
  }));
  accumulators.set(filePath, current);
}

function buildFileSummaries(args: {
  candidates: readonly ContextPacketReadableCandidate[];
  anchorFiles: ReadonlySet<string>;
}): GraphFileSummary[] {
  const accumulators = new Map<string, FileAccumulator>();
  for (const candidate of args.candidates) {
    const primarySignal = signalFromCandidate(candidate);
    if (primarySignal) updateAccumulator(accumulators, primarySignal, args.anchorFiles);
    for (const signal of supportingSignals(candidate)) {
      updateAccumulator(accumulators, signal, args.anchorFiles);
    }
  }

  return [...accumulators.values()]
    .map((entry) => {
      const relation = mergedRelation(entry.relations);
      const distance = relation === "anchor"
        ? 0
        : entry.distances.length > 0
          ? Math.min(...entry.distances)
          : undefined;
      const pathEvidence = [...entry.pathEvidence.values()]
        .sort((left, right) =>
          left.distance - right.distance ||
          left.anchorFile.localeCompare(right.anchorFile) ||
          left.targetFile.localeCompare(right.targetFile) ||
          left.source.localeCompare(right.source)
        );
      return {
        filePath: entry.filePath,
        relation,
        ...(distance != null ? { distance } : {}),
        sourceCount: entry.sources.size,
        sources: [...entry.sources].sort(),
        strategies: [...entry.strategies].sort(),
        score: Number((entry.score === Number.NEGATIVE_INFINITY ? 0 : entry.score).toFixed(4)),
        confidence: Number(entry.confidence.toFixed(4)),
        reasons: entry.reasons.slice(0, MAX_REASONS_PER_FILE),
        ...(pathEvidence.length > 0
          ? {
              pathEvidenceCount: pathEvidence.length,
              pathEvidence: pathEvidence.slice(0, MAX_PATH_EVIDENCE_PER_FILE),
            }
          : {}),
      } satisfies GraphFileSummary;
    })
    .sort((left: GraphFileSummary, right: GraphFileSummary) =>
      relationRank(left.relation) - relationRank(right.relation) ||
      right.score - left.score ||
      left.filePath.localeCompare(right.filePath)
    );
}

function edgeRelation(from: string, to: string, anchorFiles: ReadonlySet<string>): ContextPacketGraphEdgeRelation {
  const sourceIsAnchor = anchorFiles.has(normalizePath(from));
  const targetIsAnchor = anchorFiles.has(normalizePath(to));
  if (sourceIsAnchor && targetIsAnchor) return "anchor_link";
  if (sourceIsAnchor) return "anchor_dependency";
  if (targetIsAnchor) return "anchor_dependent";
  return "context_import";
}

function edgeRank(edge: GraphEdgeSummary): number {
  switch (edge.relation) {
    case "anchor_link":
      return 0;
    case "anchor_dependency":
      return 1;
    case "anchor_dependent":
      return 2;
    case "context_import":
      return 3;
  }
  return 3;
}

function buildEdgeSummaries(args: {
  candidates: readonly ContextPacketReadableCandidate[];
  anchorFiles: ReadonlySet<string>;
  returnedFiles: ReadonlySet<string>;
}): GraphEdgeSummary[] {
  const graphFiles = new Set<string>([...args.anchorFiles, ...args.returnedFiles]);
  const seen = new Set<string>();
  const edges: GraphEdgeSummary[] = [];
  for (const candidate of args.candidates) {
    const signals = [
      signalFromCandidate(candidate),
      ...supportingSignals(candidate),
    ].filter((signal): signal is CandidateSignal => Boolean(signal));
    for (const signal of signals) {
      const from = normalizePath(stringValue(signal.metadata?.from) ?? "");
      const to = normalizePath(stringValue(signal.metadata?.target) ?? "");
      if (!from || !to) continue;
      if (!graphFiles.has(from) || !graphFiles.has(to)) continue;
      if (!args.returnedFiles.has(from) && !args.returnedFiles.has(to)) continue;
      const specifier = stringValue(signal.metadata?.specifier) ?? "";
      const line = numberValue(signal.metadata?.line);
      const key = `${from}->${to}:${specifier}:${line ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from,
        to,
        relation: edgeRelation(from, to, args.anchorFiles),
        specifier,
        importKind: stringValue(signal.metadata?.importKind) ?? "",
        isTypeOnly: signal.metadata?.isTypeOnly === true,
        ...(line != null ? { line: Math.max(1, Math.round(line)) } : {}),
      });
    }
  }

  return edges.sort((left: GraphEdgeSummary, right: GraphEdgeSummary) =>
    edgeRank(left) - edgeRank(right) ||
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to)
  );
}

function countRelation(
  files: readonly GraphFileSummary[],
  relation: ContextPacketGraphFileRelation,
): number {
  return files.filter((file) => file.relation === relation).length;
}

export function buildContextPacketGraphSummary(args: {
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
  candidates: readonly ContextPacketReadableCandidate[];
  graphProvidersRan: boolean;
  providerWarnings?: readonly string[];
}): ContextPacketGraphSummary {
  const anchorFileList = collectAnchorFiles({
    input: args.input,
    intent: args.intent,
    candidates: args.candidates,
  });
  const anchorFiles = new Set<string>(anchorFileList);
  const allFiles = buildFileSummaries({
    candidates: args.candidates,
    anchorFiles,
  });
  const returnedFiles = new Set<string>(allFiles.map((file: GraphFileSummary) => file.filePath));
  const allEdges = buildEdgeSummaries({
    candidates: args.candidates,
    anchorFiles,
    returnedFiles,
  });
  const warnings: string[] = [];
  if (anchorFiles.size === 0) {
    warnings.push("No explicit graph anchors were available; graph relations are based on provider metadata only.");
  }
  const missingAnchors = anchorFileList.filter((filePath) => !returnedFiles.has(filePath));
  if (missingAnchors.length > 0) {
    warnings.push(`${missingAnchors.length} graph anchor file(s) were not returned as context candidates.`);
  }
  if (!args.graphProvidersRan && allFiles.length > 1) {
    warnings.push("Graph providers did not run for this packet; graph edges are limited to returned provider metadata.");
  } else if (args.graphProvidersRan && allFiles.length > 1 && allEdges.length === 0) {
    warnings.push("No provider import-edge metadata connects the returned context files.");
  }
  for (const warning of args.providerWarnings ?? []) {
    if (!warning.includes("import_graph_provider") && !warning.includes("repo_map_provider")) continue;
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  return {
    anchorFiles: anchorFileList,
    returnedFileCount: allFiles.length,
    edgeCount: allEdges.length,
    dependencyFileCount: countRelation(allFiles, "dependency"),
    dependentFileCount: countRelation(allFiles, "dependent"),
    bidirectionalFileCount: countRelation(allFiles, "bidirectional"),
    centralFileCount: countRelation(allFiles, "central"),
    unknownRelationFileCount: countRelation(allFiles, "unknown"),
    files: allFiles.slice(0, MAX_GRAPH_FILES),
    edges: allEdges.slice(0, MAX_GRAPH_EDGES),
    truncated: allFiles.length > MAX_GRAPH_FILES || allEdges.length > MAX_GRAPH_EDGES,
    warnings,
  };
}
