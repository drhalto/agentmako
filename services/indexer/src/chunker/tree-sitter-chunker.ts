/**
 * Tree-sitter-based code chunker.
 *
 * Phase 3.6.0 Workstream B. Replaces the previous one-chunk-per-file strategy
 * (see `file-scan.ts` where this is called) with symbol-level chunks that
 * carry accurate `lineStart`/`lineEnd` ranges. Composers that search the FTS
 * index and want to cite `file.ts:247-253` depend on this.
 *
 * Design:
 *   - WASM-only (`web-tree-sitter`), no native builds - Windows 11 is the
 *     primary dev environment and we want zero node-gyp pain.
 *   - Two grammars: `typescript` for `.ts`/`.mts`/`.cts`/`.js`/`.mjs`/`.cjs`
 *     and `tsx` for `.tsx`/`.jsx`.
 *   - On parse error or unsupported extension, the caller falls back to the
 *     existing file-level chunk so the index never loses coverage.
 *   - Module-surface declarations become `chunkKind: "symbol"` rows.
 *   - Class members are walked recursively so methods get their own symbol
 *     chunks without exploding into local statement noise.
 *
 * The chunker is additive: we still emit a `chunkKind: "file"` chunk with the
 * full content so the existing FTS path keeps working. Composer callers that
 * want line-level precision read `chunkKind: "symbol"` rows; legacy callers
 * continue reading the whole-file chunk.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@mako-ai/logger";
import type { FileChunkRecord } from "@mako-ai/store";

const chunkerLogger = createLogger("mako-indexer-chunker");

type LanguageKind = "typescript" | "tsx";

let parserReady: Promise<void> | null = null;
let tsLanguage: unknown | null = null;
let tsxLanguage: unknown | null = null;
let ParserCtor: unknown | null = null;
let LanguageCtor: unknown | null = null;

const requireFromHere = createRequire(import.meta.url);
const localModuleDir = fileURLToPath(new URL(".", import.meta.url));

function resolveWasmPath(packageName: string, wasmFile: string): string {
  // Resolve the package's main entry, then walk up to the package root so we
  // can pin the wasm file regardless of how pnpm hoists the dependency graph.
  // When bundled into the CLI, the package metadata is no longer resolvable via
  // `require.resolve(...)`; in that case fall back to the directory of the
  // bundled module itself, where `apps/cli/tsup.config.ts` copies the wasm
  // assets during build.
  try {
    const entry = requireFromHere.resolve(`${packageName}/package.json`);
    return path.join(path.dirname(entry), wasmFile);
  } catch {
    return path.join(localModuleDir, wasmFile);
  }
}

async function ensureReady(): Promise<void> {
  if (parserReady) return parserReady;
  parserReady = (async () => {
    // Upfront existence check: the bundled `agentmako` CLI (esbuild IIFE) does
    // not ship web-tree-sitter's WASM or the grammar WASMs next to `dist/`,
    // which causes Emscripten to abort the process if we try to load. Detect
    // that case and fall through so the indexer emits file-level chunks. When
    // running from source (tsx / pnpm -r), `node_modules/` has everything.
    const tsPath = resolveWasmPath("tree-sitter-typescript", "tree-sitter-typescript.wasm");
    const tsxPath = resolveWasmPath("tree-sitter-typescript", "tree-sitter-tsx.wasm");
    if (!existsSync(tsPath) || !existsSync(tsxPath)) {
      throw new Error(
        `chunker/wasm-missing: expected tree-sitter grammar at ${tsPath} and ${tsxPath}. ` +
          "Symbol-level chunks unavailable; falling back to file-level chunks.",
      );
    }
    const mod = await import("web-tree-sitter");
    const tsMod = mod as unknown as {
      Parser: { init(opts?: unknown): Promise<void>; new (): unknown };
      Language: { load(pathOrBytes: string | Uint8Array): Promise<unknown> };
    };
    ParserCtor = tsMod.Parser;
    LanguageCtor = tsMod.Language;
    await tsMod.Parser.init();
    tsLanguage = await tsMod.Language.load(tsPath);
    tsxLanguage = await tsMod.Language.load(tsxPath);
  })().catch((error) => {
    chunkerLogger.info("chunker.init_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    parserReady = null;
    throw error;
  });
  return parserReady;
}

export function languageKindForPath(filePath: string): LanguageKind | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return "tsx";
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts") ||
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "typescript";
  }
  return null;
}

const MODULE_DECLARATION_NODE_KINDS: ReadonlySet<string> = new Set([
  "function_declaration",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "abstract_class_declaration",
  "lexical_declaration",
  "variable_statement",
  "variable_declaration",
  "namespace_declaration",
  "module_declaration",
]);

const CLASS_MEMBER_NODE_KINDS: ReadonlySet<string> = new Set([
  "method_definition",
]);

interface ChunkSpan {
  name: string;
  kind: string;
  startIndex: number;
  endIndex: number;
  startLine: number;
  endLine: number;
  content: string;
}

function nodeNameForDeclaration(node: any): string {
  // `node` is web-tree-sitter's Node. We don't strictly-type it here because
  // the d.ts uses a complex generic interface; we only need `.childForFieldName`
  // and `.children` + `.text` + `.type` at runtime.
  const nameField = node.childForFieldName?.("name");
  if (nameField) return nameField.text as string;
  // Arrow-function const: `export const foo = ...` — walk into the declarator.
  if (node.type === "export_statement" || node.type === "lexical_declaration" || node.type === "variable_statement") {
    for (const child of node.children ?? []) {
      const inner = child.childForFieldName?.("name");
      if (inner) return inner.text as string;
      if (child.type === "variable_declarator") {
        const declName = child.childForFieldName?.("name");
        if (declName) return declName.text as string;
      }
    }
  }
  return node.type ?? "anonymous";
}

function pushDeclarationChunk(
  out: ChunkSpan[],
  seen: Set<string>,
  node: any,
  source: string,
  nameOverride?: string,
): void {
  const name = nameOverride ?? nodeNameForDeclaration(node);
  const key = `${node.startIndex}:${node.endIndex}:${name}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  out.push({
    name,
    kind: node.type as string,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startLine: (node.startPosition?.row ?? 0) + 1,
    endLine: (node.endPosition?.row ?? 0) + 1,
    content: source.slice(node.startIndex, node.endIndex),
  });
}

function unwrapExportedDeclaration(node: any, allowedKinds: ReadonlySet<string>): any {
  if (node.type !== "export_statement") {
    return node;
  }
  for (const child of node.children ?? []) {
    if (allowedKinds.has(child.type)) {
      return child;
    }
  }
  return node;
}

function collectClassMembers(
  node: any,
  source: string,
  out: ChunkSpan[],
  seen: Set<string>,
  ownerName: string,
): void {
  for (const child of node.children ?? []) {
    if (CLASS_MEMBER_NODE_KINDS.has(child.type)) {
      const memberName = nodeNameForDeclaration(child);
      pushDeclarationChunk(out, seen, child, source, `${ownerName}.${memberName}`);
    }
    collectClassMembers(child, source, out, seen, ownerName);
  }
}

function collectModuleDeclarations(
  node: any,
  source: string,
  out: ChunkSpan[],
  seen: Set<string>,
): void {
  const resolved = unwrapExportedDeclaration(node, MODULE_DECLARATION_NODE_KINDS);
  if (MODULE_DECLARATION_NODE_KINDS.has(resolved.type)) {
    pushDeclarationChunk(out, seen, resolved, source);
    if (resolved.type === "class_declaration" || resolved.type === "abstract_class_declaration") {
      collectClassMembers(resolved, source, out, seen, nodeNameForDeclaration(resolved));
    }
    if (resolved.type === "namespace_declaration" || resolved.type === "module_declaration") {
      for (const child of resolved.children ?? []) {
        collectModuleDeclarations(child, source, out, seen);
      }
    }
    return;
  }
  for (const child of node.children ?? []) {
    collectModuleDeclarations(child, source, out, seen);
  }
}

function collectDeclarations(root: any, source: string): ChunkSpan[] {
  const out: ChunkSpan[] = [];
  const seen = new Set<string>();
  for (const node of root.children ?? []) {
    collectModuleDeclarations(node, source, out, seen);
  }
  return out;
}

function collectRelevantNodeRanges(root: any, source: string, relevantKinds: ReadonlySet<string>): ChunkSpan[] {
  const out: ChunkSpan[] = [];
  const seen = new Set<string>();
  const visit = (node: any): void => {
    if (relevantKinds.has(node.type)) {
      pushDeclarationChunk(out, seen, node, source);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return out;
}

export interface BuildChunksOptions {
  path: string;
  content: string;
  lineCount: number;
}

export interface DeclarationChangedRangeAnalysis {
  available: boolean;
  changedRangeCount: number;
  changedRangeKinds: string[];
  intersectsRelevantRange: boolean;
  reason?: string;
}

export async function buildChunks(options: BuildChunksOptions): Promise<FileChunkRecord[]> {
  const { path: filePath, content, lineCount } = options;
  const lang = languageKindForPath(filePath);
  if (!lang || content.length === 0) {
    return [fileChunk(filePath, content, lineCount)];
  }

  try {
    await ensureReady();
  } catch {
    return [fileChunk(filePath, content, lineCount)];
  }

  const ParserClass = ParserCtor as { new (): any };
  const language = lang === "tsx" ? tsxLanguage : tsLanguage;
  if (!ParserClass || !language) {
    return [fileChunk(filePath, content, lineCount)];
  }

  let declarations: ChunkSpan[];
  try {
    const parser = new ParserClass();
    parser.setLanguage(language);
    const tree = parser.parse(content);
    if (!tree || !tree.rootNode) {
      return [fileChunk(filePath, content, lineCount)];
    }
    declarations = collectDeclarations(tree.rootNode, content);
  } catch (error) {
    chunkerLogger.info("chunker.parse_failed", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return [fileChunk(filePath, content, lineCount)];
  }

  const chunks: FileChunkRecord[] = [fileChunk(filePath, content, lineCount)];
  for (const decl of declarations) {
    chunks.push({
      chunkKind: "symbol",
      name: decl.name,
      lineStart: decl.startLine,
      lineEnd: decl.endLine,
      content: decl.content.slice(0, 4000),
      startIndex: decl.startIndex,
      endIndex: decl.endIndex,
    });
  }
  return chunks;
}

export async function analyzeDeclarationChangedRanges(options: {
  path: string;
  priorContent: string;
  currentContent: string;
  relevantRangeKinds?: readonly string[];
}): Promise<DeclarationChangedRangeAnalysis> {
  const lang = languageKindForPath(options.path);
  if (!lang) {
    return changedRangeUnavailable("unsupported language");
  }
  if (options.priorContent === options.currentContent) {
    return {
      available: true,
      changedRangeCount: 0,
      changedRangeKinds: [],
      intersectsRelevantRange: false,
    };
  }

  try {
    await ensureReady();
  } catch {
    return changedRangeUnavailable("tree-sitter unavailable");
  }

  const ParserClass = ParserCtor as { new (): any };
  const language = lang === "tsx" ? tsxLanguage : tsLanguage;
  if (!ParserClass || !language) {
    return changedRangeUnavailable("tree-sitter language unavailable");
  }

  try {
    const parser = new ParserClass();
    parser.setLanguage(language);
    const priorTree = parser.parse(options.priorContent);
    if (!priorTree?.rootNode) {
      return changedRangeUnavailable("prior parse failed");
    }

    priorTree.edit(singleEdit(options.priorContent, options.currentContent));
    const currentTree = parser.parse(options.currentContent, priorTree);
    if (!currentTree?.rootNode) {
      return changedRangeUnavailable("current parse failed");
    }

    const ranges = priorTree.getChangedRanges(currentTree) as Array<{
      startIndex: number;
      endIndex: number;
    }>;
    const relevantKinds = new Set(options.relevantRangeKinds ?? [...MODULE_DECLARATION_NODE_KINDS]);
    const relevantRanges = collectRelevantNodeRanges(currentTree.rootNode, options.currentContent, relevantKinds);
    const changedRangeKinds = new Set<string>();
    let intersectsRelevantRange = false;
    for (const range of ranges) {
      for (const relevantRange of relevantRanges) {
        if (rangesIntersect(range.startIndex, range.endIndex, relevantRange.startIndex, relevantRange.endIndex)) {
          intersectsRelevantRange = true;
          changedRangeKinds.add(relevantRange.kind);
        }
      }
    }
    return {
      available: true,
      changedRangeCount: ranges.length,
      changedRangeKinds: [...changedRangeKinds].sort(),
      intersectsRelevantRange,
    };
  } catch (error) {
    return changedRangeUnavailable(error instanceof Error ? error.message : String(error));
  }
}

function changedRangeUnavailable(reason: string): DeclarationChangedRangeAnalysis {
  return {
    available: false,
    changedRangeCount: 0,
    changedRangeKinds: [],
    intersectsRelevantRange: true,
    reason,
  };
}

function singleEdit(priorContent: string, currentContent: string): {
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
} {
  let startIndex = 0;
  while (
    startIndex < priorContent.length &&
    startIndex < currentContent.length &&
    priorContent[startIndex] === currentContent[startIndex]
  ) {
    startIndex += 1;
  }

  let oldEndIndex = priorContent.length;
  let newEndIndex = currentContent.length;
  while (
    oldEndIndex > startIndex &&
    newEndIndex > startIndex &&
    priorContent[oldEndIndex - 1] === currentContent[newEndIndex - 1]
  ) {
    oldEndIndex -= 1;
    newEndIndex -= 1;
  }

  return {
    startIndex,
    oldEndIndex,
    newEndIndex,
    startPosition: pointForIndex(priorContent, startIndex),
    oldEndPosition: pointForIndex(priorContent, oldEndIndex),
    newEndPosition: pointForIndex(currentContent, newEndIndex),
  };
}

function pointForIndex(content: string, index: number): { row: number; column: number } {
  let row = 0;
  let lineStart = 0;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) {
      row += 1;
      lineStart = i + 1;
    }
  }
  return { row, column: index - lineStart };
}

function rangesIntersect(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  if (leftStart === leftEnd) {
    return leftStart >= rightStart && leftStart <= rightEnd;
  }
  return leftStart < rightEnd && rightStart < leftEnd;
}

function fileChunk(filePath: string, content: string, lineCount: number): FileChunkRecord {
  return {
    chunkKind: "file",
    name: filePath,
    lineStart: lineCount > 0 ? 1 : undefined,
    lineEnd: lineCount > 0 ? lineCount : undefined,
    content,
  };
}

// Exported for the smoke test to verify the chunker works end-to-end on a
// real TS file without a full indexer run.
export async function buildChunksForFile(filePath: string): Promise<FileChunkRecord[]> {
  const content = await readFile(filePath, "utf8");
  const lineCount = content.split(/\r?\n/).length;
  return buildChunks({ path: filePath, content, lineCount });
}
