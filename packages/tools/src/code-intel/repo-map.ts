import type {
  RepoMapFileEntry,
  RepoMapSymbolEntry,
  RepoMapToolInput,
  RepoMapToolOutput,
} from "@mako-ai/contracts";
import type { ProjectStore, SymbolRecord } from "@mako-ai/store";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { matchesPathGlob } from "./path-globs.js";

/**
 * `repo_map` — aider-style token-budgeted compact project outline.
 *
 * Algorithm:
 *
 * 1. Score each indexed file by import-graph centrality:
 *    `score = fanIn * 2 + fanOut + 0.1`
 *    Rationale: inbound edges weight 2x (a file many others depend on is
 *    central — the dominant signal in aider's PageRank output too),
 *    outbound adds a mild bonus so integration hubs edge past pure leaves
 *    with equal inbound. The `+ 0.1` keeps isolated files above zero so
 *    they still land in the map and so `focusFiles` boosting works
 *    multiplicatively. Real PageRank stays deferred — this approximation
 *    preserves "inbound dominates" without iteration cost.
 *
 * 2. Apply `focusFiles` boost (multiplier) so caller-named files land at the
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
  inboundCount: number;
  outboundCount: number;
  score: number;
}

function scoreFiles(
  projectStore: ProjectStore,
  focusFiles: Set<string>,
): ScoredFile[] {
  const allFiles = projectStore.listFiles();
  const inbound = new Map<string, number>(allFiles.map((file) => [file.path, 0]));
  const outbound = new Map<string, number>(allFiles.map((file) => [file.path, 0]));

  const seenEdgeKeys = new Set<string>();
  for (const edge of projectStore.listAllImportEdges()) {
    if (!edge.targetExists) continue;
    const key = `${edge.sourcePath}->${edge.targetPath}`;
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);
    outbound.set(edge.sourcePath, (outbound.get(edge.sourcePath) ?? 0) + 1);
    inbound.set(edge.targetPath, (inbound.get(edge.targetPath) ?? 0) + 1);
  }

  return allFiles.map((file) => {
    const fanIn = inbound.get(file.path) ?? 0;
    const fanOut = outbound.get(file.path) ?? 0;
    // fanIn * 2 + fanOut + 0.1 — see module-level comment.
    const base = fanIn * 2 + fanOut + 0.1;
    const score = focusFiles.has(file.path) ? base + FOCUS_BOOST : base;
    return {
      filePath: file.path,
      inboundCount: fanIn,
      outboundCount: fanOut,
      score,
    };
  });
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
    const focusFiles = new Set(input.focusFiles ?? []);
    const glob = input.pathGlob;
    const warnings: string[] = [];

    const allFiles = projectStore.listFiles();
    const totalFilesIndexed = allFiles.length;

    const scored = scoreFiles(projectStore, focusFiles);
    const eligible = scored
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
        `truncated: token budget (${tokenBudget}) exceeded. Raise tokenBudget or narrow pathGlob / focusFiles.`,
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
