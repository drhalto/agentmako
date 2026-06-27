/**
 * Tool-run → touched-files extraction.
 *
 * There is no normalized "tool touched file X" edge in the store — file paths
 * live inside the JSON summary columns of `tool_runs` (and inside the live SSE
 * `argsPreview`/`resultPreview` blobs, which share field shapes). This module
 * pulls those paths back out so the Flow graph can draw tool↔file edges.
 *
 * Strategy (best-effort, since the shapes are per-tool):
 *   1. Trust well-known path keys (`path`, `filePath`, `files`, `filesAffected`,
 *      …) wherever they appear in the tree.
 *   2. Backstop with an extension-anchored sniff over every other string, so
 *      search/diagnostic results that nest paths under arbitrary keys are still
 *      captured.
 *   3. Recover paths from truncated previews (`{ truncated, preview }`) by
 *      scanning the preview text for slash-bearing path tokens.
 *
 * Everything here is framework-free and pure so it can be unit-tested under
 * tsx without a DOM.
 */

/** Minimal shape of a recalled tool run (subset of `RecalledToolRun`). */
export interface ToolRunLike {
  toolName: string;
  inputSummary?: unknown;
  outputSummary?: unknown;
  payload?: unknown;
  outcome?: "success" | "failed" | "error";
}

/** Minimal shape of a live `tool.call` / `tool.result` event pair payload. */
export interface ToolEventLike {
  tool: string;
  argsPreview?: unknown;
  resultPreview?: unknown;
}

/** Keys whose string value is taken as a file path even without an extension. */
const PATH_KEYS = new Set([
  "path",
  "filepath",
  "file",
  "relativepath",
  "sourcepath",
  "targetpath",
  "oldpath",
  "newpath",
  "fromfile",
  "tofile",
]);

/** Keys whose value is an array of file-path strings. */
const PATH_ARRAY_KEYS = new Set([
  "files",
  "paths",
  "filepaths",
  "filesaffected",
  "touchedfiles",
  "affectedfiles",
  "changedfiles",
  "matchedfiles",
]);

/** Tool names known to mutate files on disk. */
const MUTATION_TOOLS = new Set([
  "file_write",
  "file_edit",
  "create_file",
  "delete_file",
  "apply_patch",
  "write_file",
  "edit_file",
]);

/**
 * Extensions we accept on a *bare* filename (no directory). With a directory
 * segment present we accept any alphabetic extension, since the slash already
 * signals "this is a path".
 */
const KNOWN_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc",
  "md", "mdx", "txt", "css", "scss", "less", "html", "htm",
  "py", "go", "rs", "java", "kt", "rb", "php", "c", "cc", "cpp",
  "h", "hpp", "cs", "swift", "sql", "yaml", "yml", "toml", "ini",
  "sh", "bash", "zsh", "vue", "svelte", "astro", "lock", "xml",
  "env", "prisma", "graphql", "gql", "proto", "lua", "dart", "ex", "exs",
]);

const MAX_DEPTH = 8;
const MAX_FILES = 400;

/**
 * Normalize a raw path-ish string to a project-relative POSIX path, or `null`
 * if it clearly isn't usable. Strips Windows drive letters, backslashes, and a
 * leading `./`. Does not attempt to resolve absolute roots — mako tools emit
 * project-relative paths.
 */
export function normalizeFilePath(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/\\/g, "/");
  s = s.replace(/^[A-Za-z]:\//, "");
  s = s.replace(/^\.\//, "");
  s = s.replace(/^\/+/, "");
  s = s.replace(/\/+$/, "");
  return s.length > 0 ? s : null;
}

const EXT_RE = /^[a-z][a-z0-9]{0,7}$/;

/**
 * Whether a normalized string is confidently a concrete file path. Requires a
 * filename with an alphabetic-led extension; bare filenames must carry a
 * recognized extension. Rejects URLs, schemes (`node:fs`), and globs.
 */
export function looksLikeFilePath(normalized: string): boolean {
  const s = normalized;
  if (!s || s.length > 400) return false;
  if (/\s/.test(s)) return false;
  if (s.includes("*")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return false; // http://, file://
  if (/:/.test(s)) return false; // node:fs, c:foo, urls — drive already stripped
  const base = s.slice(s.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  if (!EXT_RE.test(ext)) return false;
  if (!s.includes("/") && !KNOWN_EXTENSIONS.has(ext)) return false;
  return true;
}

/** Trust a path-keyed string: reject only obvious non-paths (urls, globs). */
function trustedPath(raw: string): string | null {
  const norm = normalizeFilePath(raw);
  if (!norm) return null;
  if (norm.includes("*") || /\s/.test(norm)) return null;
  if (/:/.test(norm)) return null;
  // Trusted keys may legitimately point at a directory, but for a *file* graph
  // we only keep things that have an extension somewhere in the basename.
  return looksLikeFilePath(norm) ? norm : null;
}

const GLOBAL_PATH_RE =
  /(?:[A-Za-z0-9._@$~+-]+\/)+[A-Za-z0-9._@$~+-]+\.[A-Za-z][A-Za-z0-9]{0,7}/g;

function collectFromPreview(preview: string, into: Set<string>): void {
  const cleaned = preview
    // Neutralize JSON escape sequences so a literal `\n` before a path doesn't
    // leak its `n` into a phantom `ncomponents/…` token. Recall summaries can be
    // multiply-escaped (JSON-in-JSON), so a single newline arrives as a run of
    // backslashes + `n`; collapse the whole run plus its escape letter.
    .replace(/\\+[nrtbfv0"'\\/]?/g, " ")
    // Drop whole URLs so their path component (`example.com/skip.ts`)
    // isn't mined as a repo file.
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ");
  const matches = cleaned.match(GLOBAL_PATH_RE);
  if (!matches) return;
  for (const m of matches) {
    if (into.size >= MAX_FILES) return;
    const norm = normalizeFilePath(m);
    if (norm && looksLikeFilePath(norm)) into.add(norm);
  }
}

function walk(value: unknown, into: Set<string>, depth: number): void {
  if (value == null || depth > MAX_DEPTH || into.size >= MAX_FILES) return;

  if (typeof value === "string") {
    const norm = normalizeFilePath(value);
    if (norm && looksLikeFilePath(norm)) into.add(norm);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) walk(item, into, depth + 1);
    return;
  }

  if (typeof value !== "object") return;

  const obj = value as Record<string, unknown>;

  // Truncated summary form: `{ truncated, preview, originalLength }`.
  if (obj.truncated === true && typeof obj.preview === "string") {
    collectFromPreview(obj.preview, into);
  }

  for (const [key, child] of Object.entries(obj)) {
    if (into.size >= MAX_FILES) return;
    const lower = key.toLowerCase();

    if (typeof child === "string" && PATH_KEYS.has(lower)) {
      const p = trustedPath(child);
      if (p) into.add(p);
      continue;
    }

    if (Array.isArray(child) && PATH_ARRAY_KEYS.has(lower)) {
      for (const item of child) {
        if (typeof item === "string") {
          const p = trustedPath(item);
          if (p) into.add(p);
        } else {
          walk(item, into, depth + 1);
        }
      }
      continue;
    }

    walk(child, into, depth + 1);
  }
}

/** Pull every distinct file path out of one arbitrary JSON value. */
export function extractFilesFromValue(value: unknown): string[] {
  const into = new Set<string>();
  walk(value, into, 0);
  return [...into];
}

function isRunLike(source: ToolRunLike | ToolEventLike): source is ToolRunLike {
  return "toolName" in source;
}

/** The tool name regardless of which source shape was passed. */
export function toolNameOf(source: ToolRunLike | ToolEventLike): string {
  return isRunLike(source) ? source.toolName : source.tool;
}

/**
 * Extract the normalized set of files a tool run / live event touched, scanning
 * input, output, and payload blobs.
 */
export function extractTouchedFiles(source: ToolRunLike | ToolEventLike): string[] {
  const into = new Set<string>();
  if (isRunLike(source)) {
    walk(source.inputSummary, into, 0);
    walk(source.outputSummary, into, 0);
    walk(source.payload, into, 0);
  } else {
    walk(source.argsPreview, into, 0);
    walk(source.resultPreview, into, 0);
  }
  return [...into];
}

/**
 * Whether a run mutated files: an explicit `filesAffected` in the output, or a
 * known file-writing tool. Drives read-vs-write edge styling in the graph.
 */
export function isMutationRun(source: ToolRunLike | ToolEventLike): boolean {
  if (MUTATION_TOOLS.has(toolNameOf(source).toLowerCase())) return true;
  const output = isRunLike(source) ? source.outputSummary : source.resultPreview;
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const affected = (output as Record<string, unknown>).filesAffected;
    if (Array.isArray(affected) && affected.length > 0) return true;
  }
  return false;
}
