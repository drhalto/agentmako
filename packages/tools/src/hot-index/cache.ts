import type { ProjectStore } from "@mako-ai/store";

export interface HotIndexEntry {
  kind: "file" | "symbol" | "route" | "database_object" | "jsx_text" | "string";
  term: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  symbolName?: string;
  symbolKind?: string;
  routeKey?: string;
  databaseObjectName?: string;
  databaseObjectType?: string;
  text?: string;
}

export interface HotIndex {
  projectId: string;
  projectRoot: string;
  indexRunId?: string;
  entries: HotIndexEntry[];
  builtAt: string;
}

export interface HotIndexBuildInput {
  projectId: string;
  projectRoot: string;
  projectStore: ProjectStore;
  indexRunId?: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_./\\:-]+/g, " ").replace(/\s+/g, " ").trim();
}

function addUnique(entries: HotIndexEntry[], seen: Set<string>, entry: HotIndexEntry): void {
  const key = `${entry.kind}|${entry.term}|${entry.path ?? ""}|${entry.lineStart ?? ""}|${entry.symbolName ?? ""}|${entry.routeKey ?? ""}|${entry.databaseObjectName ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push(entry);
}

function scanStrings(content: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const match of line.matchAll(/["'`]([^"'`]{3,120})["'`]/g)) {
      const text = match[1]?.trim();
      if (text) out.push({ text, line: index + 1 });
    }
  }
  return out;
}

function scanJsxText(content: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const match of line.matchAll(/>([^<>{}\n]{2,120})</g)) {
      const text = match[1]?.replace(/\s+/g, " ").trim();
      if (text) out.push({ text, line: index + 1 });
    }
  }
  return out;
}

function buildHotIndex(input: HotIndexBuildInput): HotIndex {
  const entries: HotIndexEntry[] = [];
  const seen = new Set<string>();
  for (const file of input.projectStore.listFiles()) {
    const fileTerm = normalize(file.path);
    addUnique(entries, seen, {
      kind: "file",
      term: fileTerm,
      path: file.path,
    });
    for (const part of file.path.split(/[\\/]/g)) {
      const term = normalize(part);
      if (term) {
        addUnique(entries, seen, {
          kind: "file",
          term,
          path: file.path,
        });
      }
    }

    for (const symbol of input.projectStore.listSymbolsForFile(file.path)) {
      addUnique(entries, seen, {
        kind: "symbol",
        term: normalize(`${symbol.name} ${symbol.exportName ?? ""}`),
        path: file.path,
        lineStart: symbol.lineStart,
        lineEnd: symbol.lineEnd,
        symbolName: symbol.name,
        symbolKind: symbol.kind,
      });
    }

    const content = input.projectStore.getFileContent(file.path);
    if (content) {
      for (const hit of scanStrings(content)) {
        addUnique(entries, seen, {
          kind: "string",
          term: normalize(hit.text),
          path: file.path,
          lineStart: hit.line,
          text: hit.text,
        });
      }
      if (file.language === "tsx" || file.language === "jsx") {
        for (const hit of scanJsxText(content)) {
          addUnique(entries, seen, {
            kind: "jsx_text",
            term: normalize(hit.text),
            path: file.path,
            lineStart: hit.line,
            text: hit.text,
          });
        }
      }
    }
  }

  for (const route of input.projectStore.listRoutes()) {
    addUnique(entries, seen, {
      kind: "route",
      term: normalize(`${route.routeKey} ${route.pattern} ${route.method ?? ""} ${route.handlerName ?? ""}`),
      path: route.filePath,
      routeKey: route.routeKey,
      text: route.pattern,
    });
  }

  for (const object of input.projectStore.listSchemaObjects()) {
    addUnique(entries, seen, {
      kind: "database_object",
      term: normalize(`${object.schemaName} ${object.objectName} ${object.parentObjectName ?? ""} ${object.objectType}`),
      databaseObjectName: `${object.schemaName}.${object.objectName}`,
      databaseObjectType: object.objectType,
      text: object.parentObjectName,
    });
  }

  return {
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    indexRunId: input.indexRunId,
    entries,
    builtAt: new Date().toISOString(),
  };
}

export class HotIndexCache {
  private readonly indexes = new Map<string, HotIndex>();

  // Cache key includes `indexRunId` so a new index run automatically
  // invalidates the cached entry: `getOrBuild` then misses and rebuilds.
  // Watch-driven dirty paths flow through Phase 4's path-scoped refresh,
  // which begins a new index run, so explicit dirty marking on the hot
  // index is redundant.
  getOrBuild(input: HotIndexBuildInput): HotIndex {
    const key = `${input.projectId}|${input.projectRoot}|${input.indexRunId ?? "no-run"}`;
    const existing = this.indexes.get(key);
    if (existing) return existing;
    const built = buildHotIndex(input);
    this.indexes.set(key, built);
    return built;
  }

  flush(): void {
    this.indexes.clear();
  }

  size(): number {
    return this.indexes.size;
  }
}

export function createHotIndexCache(): HotIndexCache {
  return new HotIndexCache();
}

const defaultHotIndexCache = new HotIndexCache();

export function getDefaultHotIndexCache(): HotIndexCache {
  return defaultHotIndexCache;
}

export function searchHotIndex(index: HotIndex, query: string, limit = 20): HotIndexEntry[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return index.entries
    .map((entry) => {
      let score = 0;
      if (entry.term === normalized) score += 100;
      if (entry.term.includes(normalized)) score += 60;
      for (const token of tokens) {
        if (entry.term.includes(token)) score += 10;
      }
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.entry);
}
