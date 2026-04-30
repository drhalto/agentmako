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

import { Lang, parse, type NapiConfig } from "@ast-grep/napi";

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
  patternVariant: AstPatternVariant;
  patternContext?: string;
  patternSelector?: string;
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
  matchText: string;
  captures: Record<string, string>;
}

export type AstPatternVariant = "original" | "auto_anchored";

export interface AstPatternAttempt {
  variant: AstPatternVariant;
  pattern: string;
  context?: string;
  selector?: string;
  language: SupportedLang;
  matchCount: number;
}

export interface AstQuery {
  pattern: string;
  captures?: string[];
}

type AstMatcher = string | NapiConfig;

interface AstMatcherPlan {
  variant: AstPatternVariant;
  matcher: AstMatcher;
  pattern: string;
  context?: string;
  selector?: string;
}

function autoAnchoredMatcher(lang: SupportedLang, pattern: string): AstMatcherPlan | null {
  const trimmed = pattern.trim();
  if ((lang !== "tsx" && lang !== "jsx") || trimmed.length === 0) {
    return null;
  }

  const first = trimmed[0];
  if (first === "<") {
    const context = `const _ = ${trimmed}`;
    const selector = trimmed.endsWith("/>") ? "jsx_self_closing_element" : "jsx_element";
    return {
      variant: "auto_anchored",
      pattern,
      context,
      selector,
      matcher: {
        rule: {
          pattern: {
            context,
            selector,
          },
        },
      },
    };
  }
  if (first === "{") {
    const context = `const _ = ${trimmed}`;
    return {
      variant: "auto_anchored",
      pattern,
      context,
      selector: "object",
      matcher: {
        rule: {
          pattern: {
            context,
            selector: "object",
          },
        },
      },
    };
  }
  if (first === "[") {
    const context = `const _ = ${trimmed}`;
    return {
      variant: "auto_anchored",
      pattern,
      context,
      selector: "array",
      matcher: {
        rule: {
          pattern: {
            context,
            selector: "array",
          },
        },
      },
    };
  }

  return null;
}

function originalMatcher(pattern: string): AstMatcherPlan {
  return {
    variant: "original",
    pattern,
    matcher: pattern,
  };
}

function findNodes(root: ReturnType<ReturnType<typeof parse>["root"]>, matcher: AstMatcher) {
  try {
    return root.findAll(matcher);
  } catch {
    return [];
  }
}

export interface FindAstMatchesResult {
  hits: AstHit[];
  attempts: AstPatternAttempt[];
}

/**
 * Run one or more ast-grep patterns against a file's source text and return
 * every match with line-range evidence. Catches parse errors — a file that
 * doesn't parse as the given language yields zero hits, never throws.
 */
export function findAstMatchesDetailed(
  filePath: string,
  sourceText: string,
  queries: AstQuery[],
): FindAstMatchesResult {
  const lang = langFromPath(filePath);
  if (lang == null) return { hits: [], attempts: [] };

  let root;
  try {
    const parsed = parse(pickLang(lang), sourceText);
    root = parsed.root();
  } catch {
    return { hits: [], attempts: [] };
  }

  const hits: AstHit[] = [];
  const attempts: AstPatternAttempt[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const original = originalMatcher(query.pattern);
    const originalMatches = findNodes(root, original.matcher);
    attempts.push({
      variant: original.variant,
      pattern: original.pattern,
      language: lang,
      matchCount: originalMatches.length,
    });

    let selectedPlan = original;
    let selectedMatches = originalMatches;
    const autoAnchored = autoAnchoredMatcher(lang, query.pattern);
    if (autoAnchored) {
      const autoMatches = findNodes(root, autoAnchored.matcher);
      attempts.push({
        variant: autoAnchored.variant,
        pattern: autoAnchored.pattern,
        ...(autoAnchored.context ? { context: autoAnchored.context } : {}),
        ...(autoAnchored.selector ? { selector: autoAnchored.selector } : {}),
        language: lang,
        matchCount: autoMatches.length,
      });
      if (autoMatches.length > 0) {
        selectedPlan = autoAnchored;
        selectedMatches = autoMatches;
      }
    }

    for (const node of selectedMatches) {
      const range = node.range();
      const key = `${range.start.line}:${range.start.column}:${range.end.line}:${range.end.column}:${node.text()}`;
      if (seen.has(key)) continue;
      seen.add(key);
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
        patternVariant: selectedPlan.variant,
        ...(selectedPlan.context ? { patternContext: selectedPlan.context } : {}),
        ...(selectedPlan.selector ? { patternSelector: selectedPlan.selector } : {}),
        lineStart: range.start.line + 1,
        lineEnd: range.end.line + 1,
        columnStart: range.start.column,
        columnEnd: range.end.column,
        matchText: node.text(),
        captures,
      });
    }
  }
  return { hits, attempts };
}

export function findAstMatches(
  filePath: string,
  sourceText: string,
  queries: AstQuery[],
): AstHit[] {
  return findAstMatchesDetailed(filePath, sourceText, queries).hits;
}
