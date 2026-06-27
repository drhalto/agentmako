import type { FileImportLink, FileSummaryRecord, ProjectStore } from "@mako-ai/store";

const DEFAULT_DAMPING = 0.85;
const DEFAULT_ITERATIONS = 18;
const PAGE_RANK_SCORE_SCALE = 24;

export type ImportGraphRankDirection = "outbound" | "inbound" | "bidirectional";
export type ImportGraphFocusRelation = "self" | "dependency" | "dependent" | "bidirectional";

export interface ImportGraphRankOptions {
  seedPaths?: readonly string[];
  damping?: number;
  iterations?: number;
  personalizationDirection?: ImportGraphRankDirection;
}

export interface ImportGraphFileRank {
  filePath: string;
  inboundCount: number;
  outboundCount: number;
  pageRank: number;
  score: number;
  mode: "global" | "personalized";
  rankDirection: ImportGraphRankDirection;
  focusRelation?: ImportGraphFocusRelation;
  focusDistance?: number;
  dependencyDistance?: number;
  dependentDistance?: number;
}

function uniqueKnownSeedPaths(
  seedPaths: readonly string[] | undefined,
  pathToIndex: ReadonlyMap<string, number>,
  files: readonly FileSummaryRecord[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seedPath of seedPaths ?? []) {
    const canonical = canonicalSeedPath(seedPath, pathToIndex, files);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

function normalizeSeedPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "");
}

function uniqueCanonicalMatch(matches: readonly FileSummaryRecord[]): string | undefined {
  if (matches.length !== 1) return undefined;
  return matches[0]?.path;
}

function canonicalSeedPath(
  seedPath: string,
  pathToIndex: ReadonlyMap<string, number>,
  files: readonly FileSummaryRecord[],
): string | undefined {
  if (pathToIndex.has(seedPath)) return seedPath;

  const normalized = normalizeSeedPath(seedPath);
  if (pathToIndex.has(normalized)) return normalized;

  const exactNormalizedMatches = files.filter((file) => normalizeSeedPath(file.path) === normalized);
  const exactNormalized = uniqueCanonicalMatch(exactNormalizedMatches);
  if (exactNormalized) return exactNormalized;

  const normalizedLower = normalized.toLowerCase();
  const exactCaseInsensitiveMatches = files.filter((file) =>
    normalizeSeedPath(file.path).toLowerCase() === normalizedLower
  );
  const exactCaseInsensitive = uniqueCanonicalMatch(exactCaseInsensitiveMatches);
  if (exactCaseInsensitive) return exactCaseInsensitive;

  const suffixMatches = files.filter((file) => {
    const filePath = normalizeSeedPath(file.path);
    return normalized.endsWith(`/${filePath}`) ||
      normalizedLower.endsWith(`/${filePath.toLowerCase()}`);
  });
  return uniqueCanonicalMatch(suffixMatches);
}

function buildGraph(args: {
  files: readonly FileSummaryRecord[];
  edges: readonly FileImportLink[];
}): {
  pathToIndex: Map<string, number>;
  outbound: Array<Set<number>>;
  inbound: Array<Set<number>>;
  inboundCount: number[];
  outboundCount: number[];
} {
  const pathToIndex = new Map(args.files.map((file, index) => [file.path, index] as const));
  const outbound = args.files.map(() => new Set<number>());
  const inbound = args.files.map(() => new Set<number>());
  const inboundCount = args.files.map(() => 0);
  const outboundCount = args.files.map(() => 0);
  const seenEdges = new Set<string>();

  for (const edge of args.edges) {
    if (!edge.targetExists) continue;
    const sourceIndex = pathToIndex.get(edge.sourcePath);
    const targetIndex = pathToIndex.get(edge.targetPath);
    if (sourceIndex == null || targetIndex == null) continue;
    const key = `${sourceIndex}->${targetIndex}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    outbound[sourceIndex]?.add(targetIndex);
    inbound[targetIndex]?.add(sourceIndex);
    outboundCount[sourceIndex] += 1;
    inboundCount[targetIndex] += 1;
  }

  return { pathToIndex, outbound, inbound, inboundCount, outboundCount };
}

function rankAdjacency(args: {
  outbound: ReadonlyArray<ReadonlySet<number>>;
  inbound: ReadonlyArray<ReadonlySet<number>>;
  direction: ImportGraphRankDirection;
}): Array<Set<number>> {
  if (args.direction === "outbound") {
    return args.outbound.map((edges) => new Set(edges));
  }
  if (args.direction === "inbound") {
    return args.inbound.map((edges) => new Set(edges));
  }

  return args.outbound.map((edges, index) => {
    const merged = new Set(edges);
    for (const sourceIndex of args.inbound[index] ?? []) {
      merged.add(sourceIndex);
    }
    return merged;
  });
}

function shortestDistancesFromSeeds(args: {
  adjacency: ReadonlyArray<ReadonlySet<number>>;
  seedPaths: readonly string[];
  pathToIndex: ReadonlyMap<string, number>;
}): number[] {
  const distances = Array.from({ length: args.adjacency.length }, () => Number.POSITIVE_INFINITY);
  const queue: number[] = [];

  for (const seedPath of args.seedPaths) {
    const seedIndex = args.pathToIndex.get(seedPath);
    if (seedIndex == null || distances[seedIndex] === 0) continue;
    distances[seedIndex] = 0;
    queue.push(seedIndex);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor] as number;
    const nextDistance = distances[current] + 1;
    for (const next of args.adjacency[current] ?? []) {
      if (distances[next] <= nextDistance) continue;
      distances[next] = nextDistance;
      queue.push(next);
    }
  }

  return distances;
}

function focusRelationFor(args: {
  dependencyDistance: number;
  dependentDistance: number;
}): {
  focusRelation?: ImportGraphFocusRelation;
  focusDistance?: number;
  dependencyDistance?: number;
  dependentDistance?: number;
} {
  const hasDependencyPath = Number.isFinite(args.dependencyDistance);
  const hasDependentPath = Number.isFinite(args.dependentDistance);
  if (!hasDependencyPath && !hasDependentPath) return {};
  if (args.dependencyDistance === 0 || args.dependentDistance === 0) {
    return {
      focusRelation: "self",
      focusDistance: 0,
      dependencyDistance: 0,
      dependentDistance: 0,
    };
  }
  if (hasDependencyPath && hasDependentPath) {
    return {
      focusRelation: "bidirectional",
      focusDistance: Math.min(args.dependencyDistance, args.dependentDistance),
      dependencyDistance: args.dependencyDistance,
      dependentDistance: args.dependentDistance,
    };
  }
  if (hasDependencyPath) {
    return {
      focusRelation: "dependency",
      focusDistance: args.dependencyDistance,
      dependencyDistance: args.dependencyDistance,
    };
  }
  return {
    focusRelation: "dependent",
    focusDistance: args.dependentDistance,
    dependentDistance: args.dependentDistance,
  };
}

function personalizationVector(args: {
  fileCount: number;
  seedPaths: readonly string[];
  pathToIndex: ReadonlyMap<string, number>;
}): number[] {
  const vector = Array.from({ length: args.fileCount }, () => 0);
  if (args.seedPaths.length === 0) {
    const uniform = 1 / args.fileCount;
    return vector.map(() => uniform);
  }

  const seedMass = 1 / args.seedPaths.length;
  for (const seedPath of args.seedPaths) {
    const index = args.pathToIndex.get(seedPath);
    if (index == null) continue;
    vector[index] = seedMass;
  }
  return vector;
}

function runPageRank(args: {
  outbound: ReadonlyArray<ReadonlySet<number>>;
  personalization: readonly number[];
  damping: number;
  iterations: number;
}): number[] {
  const fileCount = args.outbound.length;
  let ranks = [...args.personalization];

  for (let iteration = 0; iteration < args.iterations; iteration += 1) {
    const next = args.personalization.map((value) => (1 - args.damping) * value);
    let danglingMass = 0;

    for (let sourceIndex = 0; sourceIndex < fileCount; sourceIndex += 1) {
      const targets = args.outbound[sourceIndex];
      const rank = ranks[sourceIndex] ?? 0;
      if (!targets || targets.size === 0) {
        danglingMass += rank;
        continue;
      }
      const share = (args.damping * rank) / targets.size;
      for (const targetIndex of targets) {
        next[targetIndex] = (next[targetIndex] ?? 0) + share;
      }
    }

    if (danglingMass > 0) {
      for (let index = 0; index < fileCount; index += 1) {
        next[index] = (next[index] ?? 0) + args.damping * danglingMass * (args.personalization[index] ?? 0);
      }
    }

    ranks = next;
  }

  return ranks;
}

function scaledStructuralScore(args: {
  pageRank: number;
  fileCount: number;
  inboundCount: number;
  outboundCount: number;
  mode: "global" | "personalized";
}): number {
  const normalizedPageRank = args.pageRank * args.fileCount;
  const countBonus =
    Math.log2(args.inboundCount + 1) * 6 +
    Math.log2(args.outboundCount + 1) * 2;
  const personalizedCountMultiplier = Math.min(1, normalizedPageRank * 3);
  return Number((
    normalizedPageRank * PAGE_RANK_SCORE_SCALE +
    (args.mode === "personalized" ? countBonus * personalizedCountMultiplier : countBonus) +
    0.1
  ).toFixed(4));
}

export function rankImportGraphFiles(
  projectStore: ProjectStore,
  options: ImportGraphRankOptions = {},
): ImportGraphFileRank[] {
  const files = projectStore.listFiles();
  if (files.length === 0) return [];

  const graph = buildGraph({
    files,
    edges: projectStore.listAllImportEdges(),
  });
  const seedPaths = uniqueKnownSeedPaths(options.seedPaths, graph.pathToIndex, files);
  const rankDirection = seedPaths.length > 0
    ? options.personalizationDirection ?? "outbound"
    : "outbound";
  const rankEdges = rankAdjacency({
    outbound: graph.outbound,
    inbound: graph.inbound,
    direction: rankDirection,
  });
  const personalization = personalizationVector({
    fileCount: files.length,
    seedPaths,
    pathToIndex: graph.pathToIndex,
  });
  const pageRanks = runPageRank({
    outbound: rankEdges,
    personalization,
    damping: options.damping ?? DEFAULT_DAMPING,
    iterations: options.iterations ?? DEFAULT_ITERATIONS,
  });
  const mode: ImportGraphFileRank["mode"] = seedPaths.length > 0 ? "personalized" : "global";
  const dependencyDistances = mode === "personalized"
    ? shortestDistancesFromSeeds({
        adjacency: graph.outbound,
        seedPaths,
        pathToIndex: graph.pathToIndex,
      })
    : [];
  const dependentDistances = mode === "personalized"
    ? shortestDistancesFromSeeds({
        adjacency: graph.inbound,
        seedPaths,
        pathToIndex: graph.pathToIndex,
      })
    : [];

  return files
    .map((file, index) => {
      const pageRank = pageRanks[index] ?? 0;
      const inboundCount = graph.inboundCount[index] ?? 0;
      const outboundCount = graph.outboundCount[index] ?? 0;
      const focusRelation = mode === "personalized"
        ? focusRelationFor({
            dependencyDistance: dependencyDistances[index] ?? Number.POSITIVE_INFINITY,
            dependentDistance: dependentDistances[index] ?? Number.POSITIVE_INFINITY,
          })
        : {};
      return {
        filePath: file.path,
        inboundCount,
        outboundCount,
        pageRank,
        score: scaledStructuralScore({
          pageRank,
          fileCount: files.length,
          inboundCount,
          outboundCount,
          mode,
        }),
        mode,
        rankDirection,
        ...focusRelation,
      };
    })
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));
}
