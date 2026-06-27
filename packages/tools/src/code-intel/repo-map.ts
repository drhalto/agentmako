import type {
  RepoMapFileEntry,
  RepoMapSymbolEntry,
  RepoMapToolInput,
  RepoMapToolOutput,
} from "@mako-ai/contracts";
import type { ProjectStore, SymbolRecord } from "@mako-ai/store";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { rankImportGraphFiles } from "./import-graph-ranking.js";
import { matchesPathGlob } from "./path-globs.js";

/**
 * `repo_map` — aider-style token-budgeted compact project outline.
 *
 * Algorithm:
 *
 * 1. Score each indexed file by import-graph PageRank. Import edges point
 *    from importer to imported dependency, so heavily reused dependencies
 *    rise naturally. When focus anchors are present, PageRank is personalized
 *    around their resolved files with bidirectional traversal so the map shows
 *    local dependencies and dependents before unrelated global hubs.
 *
 * 2. Apply focus boost so caller-named or resolved anchor files land at the
 *    top without dominating the raw centrality ordering for unrelated files.
 *
 * 3. Per file, rank symbols: exported > non-exported, then by kind priority
 *    (function/class/interface/type > variable), then by line position.
 *    Keep up to `maxSymbolsPerFile`.
 *
 * 4. Token-budget trimming:
 *    - char/4 approximation
 *    - emit ranked files one at a time; each file costs its header + its
 *      kept symbol lines
 *    - stop when the budget is hit; remaining files don't appear in output
 *
 * 5. Aider-style formatter: `filePath:` header then `⋮...│<signature>` lines
 *    for each kept symbol, separated by `⋮...` elisions.
 */

const DEFAULT_TOKEN_BUDGET = 1024;
const DEFAULT_MAX_FILES = 60;
const DEFAULT_MAX_SYMBOLS_PER_FILE = 6;
// Deterministic: every focused file must rank above every non-focused file,
// regardless of centrality. Additive with a large constant preserves the
// ordering among focused files (by their own base score) and among
// non-focused files separately.
const FOCUS_BOOST = 1_000_000;
const CHAR_PER_TOKEN = 4;

// Higher-ranked kinds come first in the per-file symbol ordering.
const KIND_PRIORITY: Record<string, number> = {
  class: 100,
  interface: 95,
  type: 90,
  function: 85,
  method: 80,
  arrow_function: 70,
  enum: 65,
  variable: 40,
  property: 20,
};

function kindPriority(kind: string): number {
  return KIND_PRIORITY[kind] ?? 10;
}

function rankSymbols(symbols: readonly SymbolRecord[]): SymbolRecord[] {
  return [...symbols].sort((left, right) => {
    const leftExported = left.exportName != null ? 1 : 0;
    const rightExported = right.exportName != null ? 1 : 0;
    if (leftExported !== rightExported) return rightExported - leftExported;
    const kindDelta = kindPriority(right.kind) - kindPriority(left.kind);
    if (kindDelta !== 0) return kindDelta;
    const leftLine = left.lineStart ?? Number.MAX_SAFE_INTEGER;
    const rightLine = right.lineStart ?? Number.MAX_SAFE_INTEGER;
    return leftLine - rightLine;
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHAR_PER_TOKEN);
}

// Try to pull a signature line from file content based on the symbol's
// `lineStart`. Falls back to `symbol.signatureText` if the store has it, or
// a synthesized `<kind> <name>` placeholder.
function resolveSymbolLine(
  symbol: SymbolRecord,
  fileContent: string | null,
): string {
  if (symbol.signatureText && symbol.signatureText.trim().length > 0) {
    return symbol.signatureText.trim();
  }
  if (fileContent && typeof symbol.lineStart === "number" && symbol.lineStart > 0) {
    const lines = fileContent.split(/\r?\n/);
    const line = lines[symbol.lineStart - 1];
    if (typeof line === "string" && line.trim().length > 0) {
      return line.trim();
    }
  }
  const exportedPrefix = symbol.exportName ? "export " : "";
  return `${exportedPrefix}${symbol.kind} ${symbol.name}`;
}

function buildSymbolEntry(
  symbol: SymbolRecord,
  fileContent: string | null,
): RepoMapSymbolEntry {
  return {
    name: symbol.name,
    kind: symbol.kind,
    exported: symbol.exportName != null,
    ...(typeof symbol.lineStart === "number" ? { lineStart: symbol.lineStart } : {}),
    ...(typeof symbol.lineEnd === "number" ? { lineEnd: symbol.lineEnd } : {}),
    signatureText: resolveSymbolLine(symbol, fileContent),
  };
}

interface ScoredFile {
  filePath: string;
  graphRank: number;
  graphRankScore: number;
  graphRankMode: "global" | "personalized";
  graphRankDirection: "outbound" | "inbound" | "bidirectional";
  focusRelation?: "self" | "dependency" | "dependent" | "bidirectional";
  focusDistance?: number;
  dependencyDistance?: number;
  dependentDistance?: number;
  inboundCount: number;
  outboundCount: number;
  score: number;
}

interface ScoredFilesResult {
  files: ScoredFile[];
  warnings: string[];
}

function scoreFiles(
  projectStore: ProjectStore,
  focusFiles: Set<string>,
): ScoredFilesResult {
  const ranks = rankImportGraphFiles(projectStore, {
    seedPaths: [...focusFiles],
    personalizationDirection: "bidirectional",
  });
  const personalized = focusFiles.size > 0;
  const reachableRanks = personalized
    ? ranks.filter((entry) => entry.pageRank > 0)
    : ranks;
  const omittedZeroRankCount = ranks.length - reachableRanks.length;
  const warnings = personalized && omittedZeroRankCount > 0
    ? [`personalized repo_map omitted ${omittedZeroRankCount} file(s) outside the focused import graph.`]
    : [];

  return {
    files: reachableRanks.map((entry) => ({
      filePath: entry.filePath,
      graphRank: entry.pageRank,
      graphRankScore: entry.score,
      graphRankMode: entry.mode,
      graphRankDirection: entry.rankDirection,
      ...(entry.focusRelation ? { focusRelation: entry.focusRelation } : {}),
      ...(entry.focusDistance != null ? { focusDistance: entry.focusDistance } : {}),
      ...(entry.dependencyDistance != null ? { dependencyDistance: entry.dependencyDistance } : {}),
      ...(entry.dependentDistance != null ? { dependentDistance: entry.dependentDistance } : {}),
      inboundCount: entry.inboundCount,
      outboundCount: entry.outboundCount,
      score: focusFiles.has(entry.filePath) ? entry.score + FOCUS_BOOST : entry.score,
    })),
    warnings,
  };
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values])];
}

function addFocusFile(focusFiles: Set<string>, filePath: string | undefined): void {
  if (!filePath?.trim()) return;
  focusFiles.add(filePath);
}

function normalizeFocusFileQuery(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "");
}

function uniqueFileMatch(matches: readonly { path: string }[]): string | undefined {
  if (matches.length !== 1) return undefined;
  return matches[0]?.path;
}

function resolveFocusFile(projectStore: ProjectStore, requestedPath: string): string | undefined {
  const direct = projectStore.findFile(requestedPath);
  if (direct) return direct.path;

  const normalized = normalizeFocusFileQuery(requestedPath);
  const normalizedMatch = projectStore.findFile(normalized);
  if (normalizedMatch) return normalizedMatch.path;

  const normalizedLower = normalized.toLowerCase();
  const files = projectStore.listFiles();
  const exactCaseInsensitive = uniqueFileMatch(files.filter((file) =>
    normalizeFocusFileQuery(file.path).toLowerCase() === normalizedLower
  ));
  if (exactCaseInsensitive) return exactCaseInsensitive;

  const suffixMatch = uniqueFileMatch(files.filter((file) => {
    const filePath = normalizeFocusFileQuery(file.path);
    return normalized.endsWith(`/${filePath}`) ||
      normalizedLower.endsWith(`/${filePath.toLowerCase()}`);
  }));
  return suffixMatch;
}

function symbolFocusHits(projectStore: ProjectStore, term: string, limit: number): string[] {
  const filePaths = new Set<string>();
  for (const hit of projectStore.searchCodeChunks(term, { limit, symbolOnly: true })) {
    addFocusFile(filePaths, hit.filePath);
    if (filePaths.size >= limit) return [...filePaths];
  }

  const normalizedTerm = term.toLowerCase();
  for (const file of projectStore.listFiles()) {
    for (const symbol of projectStore.listSymbolsForFile(file.path)) {
      if (symbol.name.toLowerCase() !== normalizedTerm && symbol.exportName?.toLowerCase() !== normalizedTerm) {
        continue;
      }
      addFocusFile(filePaths, file.path);
      if (filePaths.size >= limit) return [...filePaths];
    }
  }

  return [...filePaths];
}

function resolveFocusAnchors(
  projectStore: ProjectStore,
  input: RepoMapToolInput,
): { focusFiles: Set<string>; warnings: string[] } {
  const focusFiles = new Set<string>();
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const requestedPath of input.focusFiles ?? []) {
    if (seen.has(requestedPath)) continue;
    seen.add(requestedPath);
    const resolved = resolveFocusFile(projectStore, requestedPath);
    if (!resolved) {
      warnings.push(`focus file is not indexed: ${requestedPath}`);
      continue;
    }
    addFocusFile(focusFiles, resolved);
  }

  for (const routeTerm of input.focusRoutes ?? []) {
    const routes = projectStore.searchRoutes(routeTerm, 5);
    if (routes.length === 0) {
      warnings.push(`focus route did not resolve to an indexed route handler: ${routeTerm}`);
      continue;
    }
    for (const route of routes) {
      addFocusFile(focusFiles, route.filePath);
    }
  }

  for (const symbolTerm of input.focusSymbols ?? []) {
    const filePaths = symbolFocusHits(projectStore, symbolTerm, 8);
    if (filePaths.length === 0) {
      warnings.push(`focus symbol did not resolve to an indexed symbol: ${symbolTerm}`);
      continue;
    }
    for (const filePath of filePaths) {
      addFocusFile(focusFiles, filePath);
    }
  }

  for (const objectTerm of input.focusDatabaseObjects ?? []) {
    let usageMatched = false;
    for (const object of projectStore.searchSchemaObjects(objectTerm, 5)) {
      for (const usage of projectStore.listSchemaUsages(object.objectId).slice(0, 8)) {
        usageMatched = true;
        addFocusFile(focusFiles, usage.filePath);
      }
    }
    if (!usageMatched) {
      warnings.push(`focus database object did not resolve to indexed schema usage: ${objectTerm}`);
    }
  }

  return { focusFiles, warnings: uniqueStrings(warnings) };
}

function renderFileBlock(file: RepoMapFileEntry): string {
  const lines: string[] = [];
  lines.push(`${file.filePath}:`);
  if (file.symbolsIncluded.length === 0) {
    lines.push("⋮... (no indexed symbols)");
    return `${lines.join("\n")}\n`;
  }
  lines.push("⋮...");
  for (const symbol of file.symbolsIncluded) {
    const signature = symbol.signatureText ?? `${symbol.exported ? "export " : ""}${symbol.kind} ${symbol.name}`;
    lines.push(`│${signature}`);
    lines.push("⋮...");
  }
  if (file.truncatedSymbols) {
    lines.push(`(+${file.symbolsTotal - file.symbolsIncluded.length} more symbol(s) elided)`);
  }
  return `${lines.join("\n")}\n`;
}

export async function repoMapTool(
  input: RepoMapToolInput,
  options: ToolServiceOptions = {},
): Promise<RepoMapToolOutput> {
  return withProjectContext(input, options, ({ project, projectStore }) => {
    const tokenBudget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
    const maxSymbolsPerFile = input.maxSymbolsPerFile ?? DEFAULT_MAX_SYMBOLS_PER_FILE;
    const resolvedFocus = resolveFocusAnchors(projectStore, input);
    const focusFiles = resolvedFocus.focusFiles;
    const glob = input.pathGlob;
    const warnings: string[] = [...resolvedFocus.warnings];

    const allFiles = projectStore.listFiles();
    const totalFilesIndexed = allFiles.length;

    const scored = scoreFiles(projectStore, focusFiles);
    warnings.push(...scored.warnings);
    const eligible = scored
      .files
      .filter((entry) => (glob ? matchesPathGlob(entry.filePath, glob) : true))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.filePath.localeCompare(right.filePath);
      });
    const totalFilesEligible = eligible.length;

    if (totalFilesEligible === 0) {
      warnings.push("no indexed files matched the filter — repo_map returned nothing to rank.");
      return {
        toolName: "repo_map",
        projectId: project.projectId,
        rendered: "",
        files: [],
        tokenBudget,
        estimatedTokens: 0,
        totalFilesIndexed,
        totalFilesEligible,
        truncatedByBudget: false,
        truncatedByMaxFiles: false,
        warnings,
      } satisfies RepoMapToolOutput;
    }

    const renderedFileBlocks: string[] = [];
    const files: RepoMapFileEntry[] = [];
    let estimatedTokens = 0;
    let truncatedByBudget = false;
    let truncatedByMaxFiles = false;

    for (const entry of eligible) {
      if (files.length >= maxFiles) {
        truncatedByMaxFiles = true;
        break;
      }

      const allSymbols = projectStore.listSymbolsForFile(entry.filePath);
      const ranked = rankSymbols(allSymbols);
      const kept = ranked.slice(0, maxSymbolsPerFile);
      const fileContent = kept.length > 0 ? projectStore.getFileContent(entry.filePath) : null;
      const symbolsIncluded = kept.map((symbol) => buildSymbolEntry(symbol, fileContent));

      const fileEntry: RepoMapFileEntry = {
        filePath: entry.filePath,
        graphRank: Number(entry.graphRank.toFixed(8)),
        graphRankScore: Number(entry.graphRankScore.toFixed(4)),
        graphRankMode: entry.graphRankMode,
        graphRankDirection: entry.graphRankDirection,
        ...(entry.focusRelation ? { focusRelation: entry.focusRelation } : {}),
        ...(entry.focusDistance != null ? { focusDistance: entry.focusDistance } : {}),
        ...(entry.dependencyDistance != null ? { dependencyDistance: entry.dependencyDistance } : {}),
        ...(entry.dependentDistance != null ? { dependentDistance: entry.dependentDistance } : {}),
        score: Number(entry.score.toFixed(4)),
        inboundCount: entry.inboundCount,
        outboundCount: entry.outboundCount,
        symbolsIncluded,
        symbolsTotal: allSymbols.length,
        truncatedSymbols: allSymbols.length > kept.length,
      };

      const block = renderFileBlock(fileEntry);
      const blockTokens = estimateTokens(block);

      if (estimatedTokens + blockTokens > tokenBudget && files.length > 0) {
        // Try the cheaper header-only variant so at least the file path
        // shows up in the map instead of dropping it entirely.
        const headerOnlyEntry: RepoMapFileEntry = {
          ...fileEntry,
          symbolsIncluded: [],
          truncatedSymbols: fileEntry.symbolsTotal > 0,
        };
        const headerBlock = renderFileBlock(headerOnlyEntry);
        const headerTokens = estimateTokens(headerBlock);
        if (estimatedTokens + headerTokens <= tokenBudget) {
          renderedFileBlocks.push(headerBlock);
          files.push(headerOnlyEntry);
          estimatedTokens += headerTokens;
          continue;
        }
        truncatedByBudget = true;
        break;
      }

      renderedFileBlocks.push(block);
      files.push(fileEntry);
      estimatedTokens += blockTokens;
    }

    if (truncatedByBudget) {
      warnings.push(
        `truncated: token budget (${tokenBudget}) exceeded. Raise tokenBudget or narrow pathGlob / focus anchors.`,
      );
    }
    if (truncatedByMaxFiles) {
      warnings.push(`truncated: file cap of ${maxFiles} reached. Raise maxFiles or narrow pathGlob.`);
    }
    if (files.length > 0 && files.every((entry) => entry.symbolsTotal === 0)) {
      warnings.push(
        "no indexed symbols found across any included file — verify tree-sitter chunker coverage.",
      );
    }

    const rendered = renderedFileBlocks.join("\n");

    return {
      toolName: "repo_map",
      projectId: project.projectId,
      rendered,
      files,
      tokenBudget,
      estimatedTokens,
      totalFilesIndexed,
      totalFilesEligible,
      truncatedByBudget,
      truncatedByMaxFiles,
      warnings,
    } satisfies RepoMapToolOutput;
  });
}
