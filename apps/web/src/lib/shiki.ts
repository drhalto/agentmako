/**
 * Singleton Shiki highlighter. Created lazily on first use; preloads just the
 * languages + theme mako actually uses so the initial bundle stays small.
 *
 * Keep the `shiki` dependency behind a dynamic import so AnswerPacketCard does
 * not pull the highlighter into the main application chunk on first paint.
 */

import type { Highlighter } from "shiki";

let cached: Promise<Highlighter> | null = null;

const LANGS = ["typescript", "tsx", "javascript", "sql", "python", "json", "bash"] as const;
const THEME = "github-dark-dimmed";

export async function getHighlighter(): Promise<Highlighter> {
  if (!cached) {
    cached = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: [THEME],
        langs: [...LANGS],
      }),
    );
  }
  return cached;
}

export function langForPath(filePath?: string): string {
  if (!filePath) return "typescript";
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts") || lower.endsWith(".mts") || lower.endsWith(".cts")) return "typescript";
  if (lower.endsWith(".jsx")) return "tsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "javascript";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "bash";
  return "typescript";
}

export async function highlightToHtml(code: string, filePath?: string): Promise<string> {
  const hl = await getHighlighter();
  return hl.codeToHtml(code, {
    lang: langForPath(filePath),
    theme: THEME,
  });
}
