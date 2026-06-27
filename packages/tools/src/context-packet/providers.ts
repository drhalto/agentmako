import type {
  ContextPacketDatabaseObject,
  ContextPacketIntent,
  ContextPacketProviderRunDetail,
  ContextPacketToolInput,
  JsonObject,
} from "@mako-ai/contracts";
import type { FileImportLink, ProjectStore } from "@mako-ai/store";
import type { HotIndex } from "../hot-index/index.js";
import { searchHotIndex } from "../hot-index/index.js";
import { rankImportGraphFiles } from "../code-intel/import-graph-ranking.js";
import type { ContextPacketProviderName } from "./modes.js";
import type { ContextPacketCandidateSeed } from "./types.js";

const IMPORT_GRAPH_SEED_LIMIT = 20;
const IMPORT_GRAPH_MAX_DEPTH = 2;
const IMPORT_GRAPH_EDGE_LIMIT_PER_NODE = 8;
const IMPORT_GRAPH_CANDIDATE_LIMIT = 80;
const EXACT_SYMBOL_SCAN_LIMIT = 32;

export interface ContextPacketProviderCollection {
  candidates: ContextPacketCandidateSeed[];
  providersRun: string[];
  providersRunDetail: ContextPacketProviderRunDetail[];
  providersSkipped: string[];
  providersFailed: string[];
  warnings: string[];
}

export interface ProviderContext {
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
  projectStore: ProjectStore;
  hotIndex?: HotIndex;
  enabledProviders?: ReadonlySet<ContextPacketProviderName>;
  cachedGraphSeeds?: GraphSeed[];
  cachedGraphSeedWarnings?: string[];
  cachedExactSymbolHits?: Map<string, SymbolSeedHit[]>;
}

type ProviderFn = (ctx: ProviderContext) => ContextPacketCandidateSeed[];
type SymbolSeedHit = {
  filePath: string;
  name?: string;
  kind?: string;
  lineStart?: number;
  lineEnd?: number;
  chunkKind?: string;
  snippet?: string;
};

interface SymbolHitOptions {
  exactScan?: boolean;
}
type GraphSeedSource =
  | "focus_file"
  | "changed_file"
  | "intent_file"
  | "focus_route"
  | "intent_route"
  | "focus_symbol"
  | "intent_symbol"
  | "focus_database_object"
  | "intent_database_object";

interface GraphSeed {
  path: string;
  source: GraphSeedSource;
  term: string;
  reason: string;
  routeKey?: string;
  symbolName?: string;
  databaseObjectName?: string;
  usageKind?: string;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function metadata(value: JsonObject): JsonObject {
  return value;
}

function objectType(value: string | undefined): ContextPacketDatabaseObject["objectType"] {
  switch (value) {
    case "schema":
    case "table":
    case "view":
    case "rpc":
    case "function":
    case "policy":
    case "trigger":
    case "column":
    case "enum":
      return value;
    default:
      return "unknown";
  }
}

function exactSymbolScan(ctx: ProviderContext, term: string): SymbolSeedHit[] {
  const normalizedTerm = term.toLowerCase();
  ctx.cachedExactSymbolHits ??= new Map<string, SymbolSeedHit[]>();
  const cached = ctx.cachedExactSymbolHits.get(normalizedTerm);
  if (cached) return cached;

  const hits: SymbolSeedHit[] = [];
  const seen = new Set<string>();
  for (const file of ctx.projectStore.listFiles()) {
    for (const symbol of ctx.projectStore.listSymbolsForFile(file.path)) {
      if (symbol.name.toLowerCase() !== normalizedTerm && symbol.exportName?.toLowerCase() !== normalizedTerm) {
        continue;
      }
      const key = `${file.path}:${symbol.name}:${symbol.lineStart ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        filePath: file.path,
        name: symbol.name,
        kind: symbol.kind,
        lineStart: symbol.lineStart,
        lineEnd: symbol.lineEnd,
        chunkKind: symbol.kind,
        snippet: symbol.signatureText,
      });
      if (hits.length >= EXACT_SYMBOL_SCAN_LIMIT) {
        ctx.cachedExactSymbolHits.set(normalizedTerm, hits);
        return hits;
      }
    }
  }

  ctx.cachedExactSymbolHits.set(normalizedTerm, hits);
  return hits;
}

function symbolHits(
  ctx: ProviderContext,
  term: string,
  limit: number,
  options: SymbolHitOptions = {},
): SymbolSeedHit[] {
  const byKey = new Map<string, SymbolSeedHit>();
  for (const hit of ctx.projectStore.searchCodeChunks(term, { limit, symbolOnly: true })) {
    const key = `${hit.filePath}:${hit.name ?? ""}:${hit.lineStart ?? ""}`;
    byKey.set(key, {
      filePath: hit.filePath,
      name: hit.name,
      kind: hit.chunkKind,
      lineStart: hit.lineStart,
      lineEnd: hit.lineEnd,
      chunkKind: hit.chunkKind,
      snippet: hit.snippet,
    });
  }

  if (byKey.size >= limit || !options.exactScan) {
    return [...byKey.values()].slice(0, limit);
  }

  for (const hit of exactSymbolScan(ctx, term)) {
    const key = `${hit.filePath}:${hit.name ?? ""}:${hit.lineStart ?? ""}`;
    if (byKey.has(key)) continue;
    byKey.set(key, hit);
    if (byKey.size >= limit) return [...byKey.values()].slice(0, limit);
  }

  return [...byKey.values()].slice(0, limit);
}

function fileProvider(ctx: ProviderContext): ContextPacketCandidateSeed[] {
  const candidates: ContextPacketCandidateSeed[] = [];
  const terms = unique([
    ...ctx.intent.entities.files,
    ...(ctx.input.changedFiles ?? []),
    ...(ctx.input.focusFiles ?? []),
    ...ctx.intent.entities.quotedText,
    ...ctx.intent.entities.keywords.slice(0, 8),
  ]);

  for (const term of terms) {
    const exact = ctx.projectStore.findFile(term);
    if (exact) {
      candidates.push({
        kind: "file",
        path: exact.path,
        source: "file_provider",
        strategy: "exact_match",
        whyIncluded: `File matched request term "${term}".`,
        confidence: 0.92,
        metadata: metadata({ query: term, language: exact.language }),
      });
    }

    for (const match of ctx.projectStore.searchFiles(term, 5)) {
      candidates.push({
        kind: "file",
        path: match.path,
        source: "file_provider",
        strategy: "deterministic_graph",
        whyIncluded: `Indexed file or content matched request term "${term}".`,
        confidence: exact?.path === match.path ? 0.86 : 0.72,
        metadata: metadata({
          query: term,
          language: match.language,
          snippet: match.snippet ?? "",
        }),
      });
    }
  }

  return candidates;
}

function routeProvider(ctx: ProviderContext): ContextPacketCandidateSeed[] {
  const candidates: ContextPacketCandidateSeed[] = [];
  const terms = unique([
    ...ctx.intent.entities.routes,
    ...(ctx.input.focusRoutes ?? []),
    ...ctx.intent.entities.files.filter((file) => file.endsWith("/route.ts") || file.endsWith("/route.tsx")),
    ...ctx.intent.entities.keywords.slice(0, 8),
  ]);

  for (const term of terms) {
    for (const route of ctx.projectStore.searchRoutes(term, 5)) {
      candidates.push({
        kind: "route",
        path: route.filePath,
        routeKey: route.routeKey,
        source: "route_provider",
        strategy: route.pattern === term || route.routeKey === term ? "exact_match" : "deterministic_graph",
        whyIncluded: `Route matched request term "${term}".`,
        confidence: route.pattern === term || route.routeKey === term ? 0.95 : 0.78,
        method: route.method,
        metadata: metadata({
          pattern: route.pattern,
          method: route.method ?? "",
          handlerName: route.handlerName ?? "",
          isApi: route.isApi === true,
        }),
      });
    }
  }

  return candidates;
}

function symbolProvider(ctx: ProviderContext): ContextPacketCandidateSeed[] {
  const candidates: ContextPacketCandidateSeed[] = [];
  const exactTerms = unique([
    ...ctx.intent.entities.symbols,
    ...(ctx.input.focusSymbols ?? []),
  ]);
  const keywordTerms = unique([
    ...ctx.intent.entities.keywords.slice(0, 10),
  ]).filter((term) => !exactTerms.includes(term));

  for (const term of exactTerms) {
    for (const hit of symbolHits(ctx, term, 8, { exactScan: true })) {
      candidates.push({
        kind: "symbol",
        path: hit.filePath,
        lineStart: hit.lineStart,
        lineEnd: hit.lineEnd,
        symbolName: hit.name ?? term,
        source: "symbol_provider",
        strategy: "symbol_reference",
        whyIncluded: `Symbol index matched request term "${term}".`,
        confidence: hit.name?.toLowerCase() === term.toLowerCase() ? 0.9 : 0.7,
        metadata: metadata({
          query: term,
          ...(hit.chunkKind ? { chunkKind: hit.chunkKind } : {}),
          ...(hit.snippet ? { snippet: hit.snippet } : {}),
        }),
      });
    }
  }

  for (const term of keywordTerms) {
    for (const hit of symbolHits(ctx, term, 8)) {
      candidates.push({
        kind: "symbol",
        path: hit.filePath,
        lineStart: hit.lineStart,
        lineEnd: hit.lineEnd,
        symbolName: hit.name ?? term,
        source: "symbol_provider",
        strategy: "symbol_reference",
        whyIncluded: `Symbol index matched request term "${term}".`,
        confidence: hit.name?.toLowerCase() === term.toLowerCase() ? 0.9 : 0.7,
        metadata: metadata({
          query: term,
          ...(hit.chunkKind ? { chunkKind: hit.chunkKind } : {}),
          ...(hit.snippet ? { snippet: hit.snippet } : {}),
        }),
      });
    }
  }

  return candidates;
}

function schemaProvider(ctx: ProviderContext): ContextPacketCandidateSeed[] {
  const candidates: ContextPacketCandidateSeed[] = [];
  const terms = unique([
    ...ctx.intent.entities.databaseObjects,
    ...(ctx.input.focusDatabaseObjects ?? []),
    ...ctx.intent.entities.keywords.slice(0, 10),
  ]);

  for (const term of terms) {
    for (const object of ctx.projectStore.searchSchemaObjects(term, 5)) {
      const objectName = `${object.schemaName}.${object.objectName}`;
      candidates.push({
        kind: "database_object",
        databaseObjectName: objectName,
        objectType: objectType(object.objectType),
        schemaName: object.schemaName,
        source: "schema_provider",
        strategy: "schema_usage",
        whyIncluded: `Schema object matched request term "${term}".`,
        confidence: objectName.toLowerCase() === term.toLowerCase() ? 0.92 : 0.72,
        metadata: metadata({
          query: term,
          objectType: object.objectType,
          schemaName: object.schemaName,
          parentObjectName: object.parentObjectName ?? "",
          dataType: object.dataType ?? "",
        }),
      });

      for (const usage of ctx.projectStore.listSchemaUsages(object.objectId).slice(0, 5)) {
        candidates.push({
          kind: "file",
          path: usage.filePath,
          lineStart: usage.line,
          source: "schema_provider",
          strategy: "schema_usage",
          whyIncluded: `File references schema object ${objectName}.`,
          confidence: usage.usageKind === "definition" ? 0.84 : 0.68,
          metadata: metadata({
            schemaObject: objectName,
            usageKind: usage.usageKind,
            excerpt: usage.excerpt ?? "",
          }),
        });
      }
    }
  }

  return candidates;
}

function addGraphSeed(seeds: GraphSeed[], seed: GraphSeed | undefined): void {
  if (!seed) return;
  if (!seed.path.trim()) return;
  seeds.push(seed);
}

function fileGraphSeed(ctx: ProviderContext, path: string, source: GraphSeedSource, reason: string): GraphSeed | undefined {
  const resolved = ctx.projectStore.findFile(path);
  if (!resolved) return undefined;
  return {
    path: resolved.path,
    source,
    term: path,
    reason,
  };
}

function graphSeedResolutionWarning(source: GraphSeedSource, term: string): string | undefined {
  switch (source) {
    case "focus_file":
      return `focus file is not indexed: ${term}`;
    case "focus_route":
      return `focus route did not resolve to an indexed route handler: ${term}`;
    case "focus_symbol":
      return `focus symbol did not resolve to an indexed symbol: ${term}`;
    case "focus_database_object":
      return `focus database object did not resolve to indexed schema usage: ${term}`;
    default:
      return undefined;
  }
}

function uniqueGraphSeeds(seeds: readonly GraphSeed[]): GraphSeed[] {
  const seen = new Set<string>();
  const out: GraphSeed[] = [];
  for (const seed of seeds) {
    const key = [
      seed.path,
      seed.source,
      seed.term,
      seed.routeKey ?? "",
      seed.symbolName ?? "",
      seed.databaseObjectName ?? "",
      seed.usageKind ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seed);
  }
  return out;
}

function graphSeeds(ctx: ProviderContext): GraphSeed[] {
  if (ctx.cachedGraphSeeds) return ctx.cachedGraphSeeds;

  const seeds: GraphSeed[] = [];
  const warnings: string[] = [];
  for (const filePath of ctx.input.focusFiles ?? []) {
    const seed = fileGraphSeed(ctx, filePath, "focus_file", "focusFiles named this file.");
    if (!seed) {
      const warning = graphSeedResolutionWarning("focus_file", filePath);
      if (warning) warnings.push(warning);
    }
    addGraphSeed(seeds, seed);
  }
  for (const filePath of ctx.input.changedFiles ?? []) {
    addGraphSeed(seeds, fileGraphSeed(ctx, filePath, "changed_file", "changedFiles named this file."));
  }
  for (const filePath of ctx.intent.entities.files) {
    addGraphSeed(seeds, fileGraphSeed(ctx, filePath, "intent_file", "request text mentioned this file."));
  }

  const routeTerms = unique([
    ...(ctx.input.focusRoutes ?? []).map((term) => `focus:${term}`),
    ...ctx.intent.entities.routes.map((term) => `intent:${term}`),
  ]);
  for (const term of routeTerms.slice(0, 12)) {
    const [sourcePrefix, ...termParts] = term.split(":");
    const routeTerm = termParts.join(":");
    const source: GraphSeedSource = sourcePrefix === "focus" ? "focus_route" : "intent_route";
    const before = seeds.length;
    for (const route of ctx.projectStore.searchRoutes(routeTerm, 5)) {
      addGraphSeed(seeds, {
        path: route.filePath,
        source,
        term: routeTerm,
        reason: `${source === "focus_route" ? "focusRoutes" : "request route text"} resolved to this route handler.`,
        routeKey: route.routeKey,
      });
    }
    if (source === "focus_route" && seeds.length === before) {
      const warning = graphSeedResolutionWarning(source, routeTerm);
      if (warning) warnings.push(warning);
    }
  }

  const symbolTerms = unique([
    ...(ctx.input.focusSymbols ?? []).map((term) => `focus:${term}`),
    ...ctx.intent.entities.symbols.map((term) => `intent:${term}`),
  ]);
  for (const term of symbolTerms.slice(0, 12)) {
    const [sourcePrefix, ...termParts] = term.split(":");
    const symbolTerm = termParts.join(":");
    const source: GraphSeedSource = sourcePrefix === "focus" ? "focus_symbol" : "intent_symbol";
    const before = seeds.length;
    for (const hit of symbolHits(ctx, symbolTerm, 5, { exactScan: true })) {
      addGraphSeed(seeds, {
        path: hit.filePath,
        source,
        term: symbolTerm,
        reason: `${source === "focus_symbol" ? "focusSymbols" : "request symbol text"} resolved to this symbol file.`,
        symbolName: hit.name ?? symbolTerm,
      });
    }
    if (source === "focus_symbol" && seeds.length === before) {
      const warning = graphSeedResolutionWarning(source, symbolTerm);
      if (warning) warnings.push(warning);
    }
  }

  const databaseObjectTerms = unique([
    ...(ctx.input.focusDatabaseObjects ?? []).map((term) => `focus:${term}`),
    ...ctx.intent.entities.databaseObjects.map((term) => `intent:${term}`),
  ]);
  for (const term of databaseObjectTerms.slice(0, 12)) {
    const [sourcePrefix, ...termParts] = term.split(":");
    const objectTerm = termParts.join(":");
    const source: GraphSeedSource = sourcePrefix === "focus" ? "focus_database_object" : "intent_database_object";
    const before = seeds.length;
    for (const object of ctx.projectStore.searchSchemaObjects(objectTerm, 5)) {
      const objectName = `${object.schemaName}.${object.objectName}`;
      for (const usage of ctx.projectStore.listSchemaUsages(object.objectId).slice(0, 5)) {
        addGraphSeed(seeds, {
          path: usage.filePath,
          source,
          term: objectTerm,
          reason: `${source === "focus_database_object" ? "focusDatabaseObjects" : "request schema text"} resolved to this schema usage file.`,
          databaseObjectName: objectName,
          usageKind: usage.usageKind,
        });
      }
    }
    if (source === "focus_database_object" && seeds.length === before) {
      const warning = graphSeedResolutionWarning(source, objectTerm);
      if (warning) warnings.push(warning);
    }
  }

  ctx.cachedGraphSeeds = uniqueGraphSeeds(seeds);
  ctx.cachedGraphSeedWarnings = unique(warnings);
  return ctx.cachedGraphSeeds;
}

function graphSeedPaths(ctx: ProviderContext): string[] {
  return unique(graphSeeds(ctx).map((seed) => seed.path));
}

function graphSeedSourcesForPath(ctx: ProviderContext, path: string): JsonObject[] {
  return graphSeeds(ctx)
    .filter((seed) => seed.path === path)
    .slice(0, 6)
    .map((seed) => {
      const out: JsonObject = {
        source: seed.source,
        term: seed.term,
        reason: seed.reason,
      };
      if (seed.routeKey) out.routeKey = seed.routeKey;
      if (seed.symbolName) out.symbolName = seed.symbolName;
      if (seed.databaseObjectName) out.databaseObjectName = seed.databaseObjectName;
      if (seed.usageKind) out.usageKind = seed.usageKind;
      return out;
    });
}

type ImportGraphDirection = "outbound" | "inbound";

interface ImportGraphQueueItem {
  filePath: string;
  depth: number;
  graphPath: string[];
}

function uniqueInternalEdges(edges: readonly FileImportLink[]): FileImportLink[] {
  const seen = new Set<string>();
  const out: FileImportLink[] = [];
  for (const edge of edges) {
    if (!edge.targetExists) continue;
    const key = `${edge.sourcePath}->${edge.targetPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

function importGraphConfidence(direction: ImportGraphDirection, depth: number): number {
  const base = direction === "outbound" ? 0.62 : 0.58;
  return Math.max(0.46, Number((base - (depth - 1) * 0.1).toFixed(2)));
}

function importGraphBaseScore(direction: ImportGraphDirection, depth: number): number {
  const base = direction === "outbound" ? 120 : 108;
  return Math.max(30, base - depth * 18);
}

function importGraphWhy(args: {
  seedPath: string;
  currentPath: string;
  direction: ImportGraphDirection;
  depth: number;
  specifier: string;
}): string {
  if (args.direction === "outbound") {
    return args.depth === 1
      ? `${args.seedPath} imports this file via ${args.specifier}.`
      : `${args.seedPath} reaches this transitive import through ${args.currentPath} via ${args.specifier}.`;
  }

  return args.depth === 1
    ? `This file imports focused file ${args.seedPath} via ${args.specifier}.`
    : `This transitive dependent reaches ${args.seedPath} through ${args.currentPath} via ${args.specifier}.`;
}

function walkImportGraph(args: {
  ctx: ProviderContext;
  seedPath: string;
  direction: ImportGraphDirection;
  candidates: ContextPacketCandidateSeed[];
}): void {
  const visited = new Set<string>([args.seedPath]);
  const queue: ImportGraphQueueItem[] = [{
    filePath: args.seedPath,
    depth: 0,
    graphPath: [args.seedPath],
  }];

  while (queue.length > 0 && args.candidates.length < IMPORT_GRAPH_CANDIDATE_LIMIT) {
    const current = queue.shift() as ImportGraphQueueItem;
    if (current.depth >= IMPORT_GRAPH_MAX_DEPTH) continue;

    const edges = uniqueInternalEdges(
      args.direction === "outbound"
        ? args.ctx.projectStore.listImportsForFile(current.filePath)
        : args.ctx.projectStore.listDependentsForFile(current.filePath),
    ).slice(0, IMPORT_GRAPH_EDGE_LIMIT_PER_NODE);

    for (const edge of edges) {
      const candidatePath = args.direction === "outbound" ? edge.targetPath : edge.sourcePath;
      if (visited.has(candidatePath)) continue;
      visited.add(candidatePath);

      const depth = current.depth + 1;
      const graphPath = [...current.graphPath, candidatePath];
      args.candidates.push({
        kind: "file",
        path: candidatePath,
        source: "import_graph_provider",
        strategy: "deterministic_graph",
        whyIncluded: importGraphWhy({
          seedPath: args.seedPath,
          currentPath: current.filePath,
          direction: args.direction,
          depth,
          specifier: edge.specifier,
        }),
        confidence: importGraphConfidence(args.direction, depth),
        baseScore: importGraphBaseScore(args.direction, depth),
        metadata: metadata({
          seedPath: args.seedPath,
          graphSeedSources: graphSeedSourcesForPath(args.ctx, args.seedPath),
          from: edge.sourcePath,
          target: edge.targetPath,
          specifier: edge.specifier,
          direction: args.direction,
          graphDepth: depth,
          graphPath,
        }),
      });

      if (depth < IMPORT_GRAPH_MAX_DEPTH) {
        queue.push({ filePath: candidatePath, depth, graphPath });
      }

      if (args.candidates.length >= IMPORT_GRAPH_CANDIDATE_LIMIT) break;
    }
  }
}

function importGraphProvider(ctx: ProviderContext): ContextPacketCandidateSeed[] {
  const seedPaths = graphSeedPaths(ctx);
  const candidates: ContextPacketCandidateSeed[] = [];

  for (const filePath of seedPaths.slice(0, IMPORT_GRAPH_SEED_LIMIT)) {
    const file = ctx.projectStore.findFile(filePath);
    if (!file) continue;
    walkImportGraph({ ctx, seedPath: file.path, direction: "outbound", candidates });
    walkImportGraph({ ctx, seedPath: file.path, direction: "inbound", candidates });
    if (candidates.length >= IMPORT_GRAPH_CANDIDATE_LIMIT) break;
  }

  return candidates;
}

function repoMapProvider(ctx: ProviderContext): ContextPacketCandidateSeed[] {
  const seedPaths = graphSeedPaths(ctx);
  const graphSeedCount = seedPaths.length;
  const ranks = rankImportGraphFiles(ctx.projectStore, {
    seedPaths,
    personalizationDirection: "bidirectional",
  });
  const personalized = graphSeedCount > 0;
  const entries = personalized
    ? ranks.filter((entry) => entry.pageRank > 0)
    : ranks;

  return entries
    .slice(0, 8)
    .map((entry) => {
      const contextScore = Math.min(42, entry.score / 8);
      return {
        kind: "file" as const,
        path: entry.filePath,
        source: "repo_map_provider" as const,
        strategy: "centrality_rank" as const,
        whyIncluded: entry.mode === "personalized"
          ? "High graph-rank file near focused request files in the import graph."
          : "High PageRank file in the import graph.",
        confidence: Math.min(0.66, 0.36 + contextScore / 80),
        baseScore: contextScore,
        metadata: metadata({
          inboundCount: entry.inboundCount,
          outboundCount: entry.outboundCount,
          graphRank: Number(entry.pageRank.toFixed(8)),
          graphRankScore: entry.score,
          graphRankMode: entry.mode,
          graphRankDirection: entry.rankDirection,
          ...(entry.focusRelation ? { focusRelation: entry.focusRelation } : {}),
          ...(entry.focusDistance != null ? { focusDistance: entry.focusDistance } : {}),
          ...(entry.dependencyDistance != null ? { dependencyDistance: entry.dependencyDistance } : {}),
          ...(entry.dependentDistance != null ? { dependentDistance: entry.dependentDistance } : {}),
          graphPersonalizationSeedCount: graphSeedCount,
          graphSeedSources: graphSeedSourcesForPath(ctx, entry.filePath),
        }),
      };
    });
}

function hotHintProvider(ctx: ProviderContext): ContextPacketCandidateSeed[] {
  if (!ctx.hotIndex || ctx.input.includeLiveHints === false) return [];
  return searchHotIndex(ctx.hotIndex, ctx.input.request, 20).flatMap((entry): ContextPacketCandidateSeed[] => {
    switch (entry.kind) {
      case "file":
      case "jsx_text":
      case "string":
        return entry.path
          ? [{
              kind: "file",
              path: entry.path,
              lineStart: entry.lineStart,
              lineEnd: entry.lineEnd,
              source: "hot_hint_index",
              strategy: "hot_hint",
              whyIncluded: `Hot hint matched "${entry.text ?? entry.term}".`,
              confidence: entry.kind === "file" ? 0.68 : 0.56,
              metadata: metadata({ hintKind: entry.kind, text: entry.text ?? "" }),
            }]
          : [];
      case "symbol":
        return entry.path
          ? [{
              kind: "symbol",
              path: entry.path,
              lineStart: entry.lineStart,
              lineEnd: entry.lineEnd,
              symbolName: entry.symbolName,
              source: "hot_hint_index",
              strategy: "hot_hint",
              whyIncluded: `Hot symbol hint matched "${entry.symbolName ?? entry.term}".`,
              confidence: 0.65,
              metadata: metadata({ symbolKind: entry.symbolKind ?? "" }),
            }]
          : [];
      case "route":
        return [{
          kind: "route",
          path: entry.path,
          routeKey: entry.routeKey,
          source: "hot_hint_index",
          strategy: "hot_hint",
          whyIncluded: `Hot route hint matched "${entry.routeKey ?? entry.term}".`,
          confidence: 0.66,
          metadata: metadata({ pattern: entry.text ?? "" }),
        }];
      case "database_object":
        return [{
          kind: "database_object",
          databaseObjectName: entry.databaseObjectName,
          objectType: objectType(entry.databaseObjectType),
          source: "hot_hint_index",
          strategy: "hot_hint",
          whyIncluded: `Hot schema hint matched "${entry.databaseObjectName ?? entry.term}".`,
          confidence: 0.62,
          metadata: metadata({ objectType: entry.databaseObjectType ?? "" }),
        }];
    }
  });
}

function elapsedMs(startMs: number): number {
  return Math.max(0, Date.now() - startMs);
}

const PROVIDERS: Array<{ name: ContextPacketProviderName; run: ProviderFn }> = [
  { name: "file_provider", run: fileProvider },
  { name: "route_provider", run: routeProvider },
  { name: "schema_provider", run: schemaProvider },
  { name: "symbol_provider", run: symbolProvider },
  { name: "import_graph_provider", run: importGraphProvider },
  { name: "repo_map_provider", run: repoMapProvider },
  { name: "hot_hint_index", run: hotHintProvider },
];

// Providers run sequentially. They all execute SQLite reads against one
// `ProjectStore` handle; node-sqlite serializes statements anyway, so
// fanning out with Promise.all would not parallelize the work and would
// make per-provider failure isolation harder to read.
export function collectContextPacketProviders(ctx: ProviderContext): ContextPacketProviderCollection {
  const candidates: ContextPacketCandidateSeed[] = [];
  const providersRun: string[] = [];
  const providersRunDetail: ContextPacketProviderRunDetail[] = [];
  const providersSkipped: string[] = [];
  const providersFailed: string[] = [];
  const warnings: string[] = [];

  for (const provider of PROVIDERS) {
    if (ctx.enabledProviders && !ctx.enabledProviders.has(provider.name)) {
      providersSkipped.push(provider.name);
      continue;
    }
    providersRun.push(provider.name);
    const startedAtMs = Date.now();
    try {
      const providerCandidates = provider.run(ctx);
      candidates.push(...providerCandidates);
      providersRunDetail.push({
        provider: provider.name,
        status: "success",
        candidateCount: providerCandidates.length,
        durationMs: elapsedMs(startedAtMs),
      });
    } catch (error) {
      providersFailed.push(provider.name);
      providersRunDetail.push({
        provider: provider.name,
        status: "failed",
        candidateCount: 0,
        durationMs: elapsedMs(startedAtMs),
      });
      warnings.push(`${provider.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    candidates,
    providersRun,
    providersRunDetail,
    providersSkipped,
    providersFailed,
    warnings: unique([...warnings, ...(ctx.cachedGraphSeedWarnings ?? [])]),
  };
}
