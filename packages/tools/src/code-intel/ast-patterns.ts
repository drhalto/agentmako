/**
 * ast-grep wrapper — lightweight structural search primitive.
 *
 * This module is the shared code-intel layer for structural pattern matching
 * across the tools package. Composers use it for evidence proof (e.g.,
 * `.from('$TABLE')`, `throw new Error($MSG)`). Diagnostics use it to detect
 * syntactic shapes without re-walking TS ASTs by hand.
 *
 * Previously lived under `composers/_shared/` and was importable only from
 * composer code. It was lifted here so the diagnostic layer (and any future
 * code-intel consumer) can reach it without crossing a nominal layer
 * boundary.
 *
 * Windows 11 note: `@ast-grep/napi` ships prebuilt `win32-x64-msvc` binaries
 * via NAPI-RS optional deps. No Rust toolchain, no build step on install.
 *
 * Supported languages: TypeScript, TSX, JavaScript, JSX. SQL/PL-pgSQL is NOT
 * supported by ast-grep — consumers that need SQL structural matching use the
 * home-grown extractor/parser paths in the composer layer.
 */

import { Lang, parse } from "@ast-grep/napi";

export type SupportedLang = "ts" | "tsx" | "js" | "jsx";

function pickLang(lang: SupportedLang): Lang {
  switch (lang) {
    case "ts":
      return Lang.TypeScript;
    case "tsx":
      return Lang.Tsx;
    case "js":
      return Lang.JavaScript;
    case "jsx":
      return Lang.Tsx;
  }
}

export function langFromPath(filePath: string): SupportedLang | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "js";
  return null;
}

export interface AstHit {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
  matchText: string;
  captures: Record<string, string>;
}

export interface AstQuery {
  pattern: string;
  captures?: string[];
}

/**
 * Run one or more ast-grep patterns against a file's source text and return
 * every match with line-range evidence. Catches parse errors — a file that
 * doesn't parse as the given language yields zero hits, never throws.
 */
export function findAstMatches(
  filePath: string,
  sourceText: string,
  queries: AstQuery[],
): AstHit[] {
  const lang = langFromPath(filePath);
  if (lang == null) return [];

  let root;
  try {
    const parsed = parse(pickLang(lang), sourceText);
    root = parsed.root();
  } catch {
    return [];
  }

  const hits: AstHit[] = [];
  for (const query of queries) {
    let matches;
    try {
      matches = root.findAll(query.pattern);
    } catch {
      continue;
    }
    for (const node of matches) {
      const range = node.range();
      const captures: Record<string, string> = {};
      if (query.captures) {
        for (const name of query.captures) {
          const captured = node.getMatch(name);
          if (captured) {
            captures[name] = captured.text();
          }
        }
      }
      hits.push({
        filePath,
        lineStart: range.start.line + 1,
        lineEnd: range.end.line + 1,
        columnStart: range.start.column,
        columnEnd: range.end.column,
        matchText: node.text(),
        captures,
      });
    }
  }
  return hits;
}
