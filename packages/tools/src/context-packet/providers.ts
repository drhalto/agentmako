import type {
  ContextPacketDatabaseObject,
  ContextPacketIntent,
  ContextPacketToolInput,
  JsonObject,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import type { HotIndex } from "../hot-index/index.js";
import { searchHotIndex } from "../hot-index/index.js";
import type { ContextPacketCandidateSeed } from "./types.js";

export interface ContextPacketProviderCollection {
  candidates: ContextPacketCandidateSeed[];
  providersRun: string[];
  providersFailed: string[];
  warnings: string[];
}

interface ProviderContext {
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
  projectStore: ProjectStore;
  hotIndex?: HotIndex;
}

type ProviderFn = (ctx: ProviderContext) => ContextPacketCandidateSeed[];

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
  const terms = unique([
    ...ctx.intent.entities.symbols,
    ...(ctx.input.focusSymbols ?? []),
    ...ctx.intent.entities.keywords.slice(0, 10),
  ]);

  for (const term of terms) {
    for (const hit of ctx.projectStore.searchCodeChunks(term, { limit: 8, symbolOnly: true })) {
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
          chunkKind: hit.chunkKind,
          snippet: hit.snippet,
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

function importGraphProvider(ctx: ProviderContext): ContextPacketCandidateSeed[] {
  const seedPaths = unique([
    ...(ctx.input.focusFiles ?? []),
    ...(ctx.input.changedFiles ?? []),
    ...ctx.intent.entities.files,
  ]);
  const candidates: ContextPacketCandidateSeed[] = [];

  for (const filePath of seedPaths.slice(0, 20)) {
    const file = ctx.projectStore.findFile(filePath);
    if (!file) continue;
    for (const edge of ctx.projectStore.listImportsForFile(file.path).slice(0, 8)) {
      if (!edge.targetExists) continue;
      candidates.push({
        kind: "file",
        path: edge.targetPath,
        source: "import_graph_provider",
        strategy: "deterministic_graph",
        whyIncluded: `${file.path} imports this file via ${edge.specifier}.`,
        confidence: 0.62,
        metadata: metadata({ from: file.path, specifier: edge.specifier, direction: "outbound" }),
      });
    }
    for (const edge of ctx.projectStore.listDependentsForFile(file.path).slice(0, 8)) {
      candidates.push({
        kind: "file",
        path: edge.sourcePath,
        source: "import_graph_provider",
        strategy: "deterministic_graph",
        whyIncluded: `This file imports focused file ${file.path}.`,
        confidence: 0.58,
        metadata: metadata({ target: file.path, specifier: edge.specifier, direction: "inbound" }),
      });
    }
  }

  return candidates;
}

function repoMapProvider(ctx: ProviderContext): ContextPacketCandidateSeed[] {
  const files = ctx.projectStore.listFiles();
  const inbound = new Map<string, number>(files.map((file) => [file.path, 0]));
  const outbound = new Map<string, number>(files.map((file) => [file.path, 0]));
  const seen = new Set<string>();

  for (const edge of ctx.projectStore.listAllImportEdges()) {
    if (!edge.targetExists) continue;
    const key = `${edge.sourcePath}->${edge.targetPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outbound.set(edge.sourcePath, (outbound.get(edge.sourcePath) ?? 0) + 1);
    inbound.set(edge.targetPath, (inbound.get(edge.targetPath) ?? 0) + 1);
  }

  return files
    .map((file) => {
      const fanIn = inbound.get(file.path) ?? 0;
      const fanOut = outbound.get(file.path) ?? 0;
      return {
        file,
        fanIn,
        fanOut,
        centrality: fanIn * 2 + fanOut + 0.1,
      };
    })
    .sort((left, right) => right.centrality - left.centrality || left.file.path.localeCompare(right.file.path))
    .slice(0, 8)
    .map((entry) => ({
      kind: "file" as const,
      path: entry.file.path,
      source: "repo_map_provider" as const,
      strategy: "centrality_rank" as const,
      whyIncluded: "High-centrality file in the import graph.",
      confidence: Math.min(0.62, 0.35 + entry.centrality / 30),
      baseScore: entry.centrality,
      metadata: metadata({ inboundCount: entry.fanIn, outboundCount: entry.fanOut }),
    }));
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

const PROVIDERS: Array<{ name: string; run: ProviderFn }> = [
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
  const providersFailed: string[] = [];
  const warnings: string[] = [];

  for (const provider of PROVIDERS) {
    providersRun.push(provider.name);
    try {
      candidates.push(...provider.run(ctx));
    } catch (error) {
      providersFailed.push(provider.name);
      warnings.push(`${provider.name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { candidates, providersRun, providersFailed, warnings };
}
