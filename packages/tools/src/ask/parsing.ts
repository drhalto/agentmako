import type { AskToolInput, JsonObject } from "@mako-ai/contracts";
import { type AskSelection, type AskToolSelection, projectLocatorArgs, toProjectScopedArgs } from "./types.js";

const QUESTION_TRAILING_PUNCT = new Set(["?", ".", "!"]);
const VALUE_TRAILING_PUNCT = new Set(["?", ".", "!", ",", ":", ";"]);

function trimTrailingFromSet(value: string, chars: Set<string>): string {
  let end = value.length;
  while (end > 0 && chars.has(value.charAt(end - 1))) {
    end--;
  }
  return value.slice(0, end);
}

export function normalizeQuestion(question: string): string {
  return trimTrailingFromSet(question.trim().replace(/\s+/g, " "), QUESTION_TRAILING_PUNCT);
}

export function trimTrailingPunctuation(value: string): string {
  return trimTrailingFromSet(value.trim(), VALUE_TRAILING_PUNCT);
}

export function extractRoutePath(question: string): string | null {
  const match = question.match(/\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]*/);
  return match?.[0] ?? null;
}

const FILE_EXTENSION_RE = /^[A-Za-z0-9_-]+$/;

export function extractFilePath(question: string): string | null {
  const normalized = question.replace(/\\/g, "/");
  for (const token of normalized.split(/[^A-Za-z0-9_./-]+/)) {
    if (!token.includes("/")) continue;
    const dot = token.lastIndexOf(".");
    if (dot <= 0 || dot >= token.length - 1) continue;
    if (FILE_EXTENSION_RE.test(token.slice(dot + 1))) {
      return token;
    }
  }
  return null;
}

export function extractDbIdentifier(value: string): string | null {
  const cleaned = trimTrailingPunctuation(value).replace(/^(?:the\s+)?(?:table\s+)?/i, "");
  const match = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)$/);
  return match?.[1] ?? null;
}

export function extractSchemaUsageSelector(value: string): { object: string; schema?: string } | null {
  const identifier = extractDbIdentifier(value);
  if (!identifier) {
    return null;
  }

  const segments = identifier.split(".");
  if (segments.length === 2) {
    return {
      schema: segments[0],
      object: segments[1],
    };
  }

  return { object: identifier };
}

export function extractRoutineSelector(value: string): { name: string; argTypes?: string[] } | null {
  const cleaned = trimTrailingPunctuation(value);
  const signatureMatch = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*\(([^)]*)\)$/);
  if (signatureMatch) {
    const [, name, rawArgTypes] = signatureMatch;
    const argTypes = rawArgTypes
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return {
      name,
      argTypes,
    };
  }

  const identifier = extractDbIdentifier(cleaned);
  return identifier ? { name: identifier } : null;
}

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "belong",
  "current",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "show",
  "showing",
  "that",
  "the",
  "their",
  "there",
  "this",
  "to",
  "valid",
  "what",
  "when",
  "where",
  "which",
  "why",
  "with",
]);

export function extractQuotedTerm(question: string): string | null {
  const match = question.match(/["'`](.+?)["'`]/);
  return match?.[1]?.trim() || null;
}

export function extractDebugSearchTerm(question: string): string | null {
  const quoted = extractQuotedTerm(question);
  if (quoted) {
    return quoted;
  }

  if (/\bnot registered\b/i.test(question)) {
    return "not registered";
  }

  const tokens = normalizeQuestion(question)
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !SEARCH_STOP_WORDS.has(token));

  if (tokens.length === 0) {
    return null;
  }

  if (tokens.includes("attendance") && tokens.includes("window")) {
    return "attendance window";
  }

  const unknownIndex = tokens.indexOf("unknown");
  if (unknownIndex >= 0 && tokens[unknownIndex + 1]) {
    return `unknown ${tokens[unknownIndex + 1]}`;
  }

  if (tokens.includes("support") && tokens.includes("tickets")) {
    return "support tickets";
  }

  if (tokens.includes("admin") && tokens.includes("dashboard")) {
    return "admin dashboard";
  }

  if (tokens.includes("dashboard") && tokens.includes("sidebar")) {
    return "dashboard sidebar";
  }

  if (tokens.includes("access") && tokens.includes("checks")) {
    return "access checks";
  }

  return tokens.slice(0, Math.min(tokens.length, 2)).join(" ");
}

function selectDbQuestion(question: string, input: AskToolInput): AskToolSelection | null {
  if (/\b(?:database|db)\b.*\b(?:connected|connectivity|status|schemas)\b/i.test(question)) {
    return {
      mode: "tool",
      selectedFamily: "db",
      selectedTool: "db_ping",
      selectedArgs: toProjectScopedArgs(input, {}),
      confidence: 0.96,
    };
  }

  const columnMatch = question.match(/^(?:what columns(?: does)?|columns of|columns for|show (?:me )?columns of|show (?:me )?columns for) (.+?)(?: have)?$/i);
  if (columnMatch) {
    const table = extractDbIdentifier(columnMatch[1]);
    if (table) {
      return {
        mode: "tool",
        selectedFamily: "db",
        selectedTool: "db_columns",
        selectedArgs: toProjectScopedArgs(input, { table }),
        confidence: 0.97,
      };
    }
  }

  const schemaMatch = question.match(/^(?:schema for|show (?:me )?the schema for|show (?:me )?the table shape for|table shape for|shape for) (.+)$/i);
  if (schemaMatch) {
    const table = extractDbIdentifier(schemaMatch[1]);
    if (table) {
      return {
        mode: "tool",
        selectedFamily: "db",
        selectedTool: "db_table_schema",
        selectedArgs: toProjectScopedArgs(input, { table }),
        confidence: 0.96,
      };
    }
  }

  const fkMatch = question.match(/^(?:what foreign keys does|foreign keys for|fk for|what references) (.+?)(?: have)?$/i);
  if (fkMatch) {
    const table = extractDbIdentifier(fkMatch[1]);
    if (table) {
      return {
        mode: "tool",
        selectedFamily: "db",
        selectedTool: "db_fk",
        selectedArgs: toProjectScopedArgs(input, { table }),
        confidence: 0.95,
      };
    }
  }

  const rlsMatch = question.match(/^(?:is rls enabled on|show policies for|what policies protect|show rls for|rls for) (.+)$/i);
  if (rlsMatch) {
    const table = extractDbIdentifier(rlsMatch[1]);
    if (table) {
      return {
        mode: "tool",
        selectedFamily: "db",
        selectedTool: "db_rls",
        selectedArgs: toProjectScopedArgs(input, { table }),
        confidence: 0.96,
      };
    }
  }

  const rpcMatch =
    question.match(/^show rpc (.+)$/i) ??
    question.match(/^show (?:function|procedure) (.+)$/i) ??
    question.match(/^(?:arguments|args?) for (.+)$/i) ??
    question.match(/^what does (.+?) return$/i);
  if (rpcMatch) {
    const selector = extractRoutineSelector(rpcMatch[1]);
    if (selector) {
      const selectedArgs: JsonObject = { name: selector.name };
      if (selector.argTypes) {
        selectedArgs.argTypes = selector.argTypes;
      }
      if (/\b(source|definition|body|implementation)\b/i.test(question)) {
        selectedArgs.includeSource = true;
      }
      return {
        mode: "tool",
        selectedFamily: "db",
        selectedTool: "db_rpc",
        selectedArgs: toProjectScopedArgs(input, selectedArgs),
        confidence: selector.argTypes ? 0.97 : 0.94,
      };
    }
  }

  return null;
}

function selectAuthQuestion(question: string, input: AskToolInput): AskToolSelection | null {
  const authMatch =
    question.match(/^what auth protects (.+)$/i) ??
    question.match(/^auth path for (.+)$/i) ??
    question.match(/^how is (.+?) protected$/i);
  if (!authMatch) {
    return null;
  }

  const file = extractFilePath(authMatch[1]);
  if (file) {
    return {
      mode: "tool",
      selectedFamily: "answers",
      selectedTool: "auth_path",
      selectedArgs: toProjectScopedArgs(input, { file }),
      confidence: 0.95,
    };
  }

  const route = extractRoutePath(authMatch[1]);
  if (route) {
    return {
      mode: "tool",
      selectedFamily: "answers",
      selectedTool: "auth_path",
      selectedArgs: toProjectScopedArgs(input, { route }),
      confidence: 0.96,
    };
  }

  const feature = trimTrailingPunctuation(authMatch[1]);
  if (feature.length > 0) {
    return {
      mode: "tool",
      selectedFamily: "answers",
      selectedTool: "auth_path",
      selectedArgs: toProjectScopedArgs(input, { feature }),
      confidence: 0.88,
    };
  }

  return null;
}

function selectRouteQuestion(question: string, input: AskToolInput): AskToolSelection | null {
  const routeMatch =
    question.match(/^where is (.+?) handled$/i) ??
    question.match(/^what handles (.+)$/i) ??
    question.match(/^trace route (.+)$/i);
  if (!routeMatch) {
    return null;
  }

  const route = extractRoutePath(routeMatch[1]);
  if (!route) {
    return null;
  }

  return {
    mode: "tool",
    selectedFamily: "answers",
    selectedTool: "route_trace",
    selectedArgs: toProjectScopedArgs(input, { route }),
    confidence: 0.97,
  };
}

function selectImportOrSymbolQuestion(question: string, input: AskToolInput): AskToolSelection | null {
  if (/\bimport hotspots\b/i.test(question)) {
    return {
      mode: "tool",
      selectedFamily: "imports",
      selectedTool: "imports_hotspots",
      selectedArgs: toProjectScopedArgs(input, {}),
      confidence: 0.95,
    };
  }

  if (/\bimport cycles\b/i.test(question) || /^show import cycles$/i.test(question)) {
    return {
      mode: "tool",
      selectedFamily: "imports",
      selectedTool: "imports_cycles",
      selectedArgs: toProjectScopedArgs(input, {}),
      confidence: 0.95,
    };
  }

  const importsMatch = question.match(/^what does (.+) import$/i);
  if (importsMatch) {
    const file = extractFilePath(importsMatch[1]);
    if (file) {
      return {
        mode: "tool",
        selectedFamily: "imports",
        selectedTool: "imports_deps",
        selectedArgs: toProjectScopedArgs(input, { file }),
        confidence: 0.97,
      };
    }
  }

  const impactMatch = question.match(/^what depends on (.+)$/i);
  if (impactMatch) {
    const file = extractFilePath(impactMatch[1]);
    if (file) {
      return {
        mode: "tool",
        selectedFamily: "imports",
        selectedTool: "imports_impact",
        selectedArgs: toProjectScopedArgs(input, { file }),
        confidence: 0.97,
      };
    }
  }

  const symbolsMatch = question.match(/^symbols in (.+)$/i);
  if (symbolsMatch) {
    const file = extractFilePath(symbolsMatch[1]);
    if (file) {
      return {
        mode: "tool",
        selectedFamily: "symbols",
        selectedTool: "symbols_of",
        selectedArgs: toProjectScopedArgs(input, { file }),
        confidence: 0.96,
      };
    }
  }

  const exportsMatch =
    question.match(/^exports? of (.+)$/i) ??
    question.match(/^what does file (.+?) export$/i) ??
    question.match(/^what does (.+?) export$/i);
  if (exportsMatch) {
    const candidate = exportsMatch[1] ?? "";
    const file = extractFilePath(candidate);
    if (file) {
      return {
        mode: "tool",
        selectedFamily: "symbols",
        selectedTool: "exports_of",
        selectedArgs: toProjectScopedArgs(input, { file }),
        confidence: 0.96,
      };
    }
  }

  return null;
}

function selectComposerQuestion(question: string, input: AskToolInput): AskToolSelection | null {
  const traceFileMatch =
    question.match(/^trace file (.+)$/i) ??
    question.match(/^context for (.+\.[A-Za-z0-9_-]+)$/i);
  if (traceFileMatch) {
    const file = extractFilePath(traceFileMatch[1]);
    if (file) {
      return {
        mode: "tool",
        selectedFamily: "composer",
        selectedTool: "trace_file",
        selectedArgs: toProjectScopedArgs(input, { file }),
        confidence: 0.96,
      };
    }
  }

  const preflightTableMatch = question.match(/^preflight table (.+)$/i);
  if (preflightTableMatch) {
    const table = extractDbIdentifier(preflightTableMatch[1]);
    if (table) {
      return {
        mode: "tool",
        selectedFamily: "composer",
        selectedTool: "preflight_table",
        selectedArgs: toProjectScopedArgs(input, { table }),
        confidence: 0.96,
      };
    }
  }

  const traceTableMatch =
    question.match(/^trace table (.+)$/i) ??
    question.match(/^(?:where is|what uses) table (.+?)(?: used)?$/i);
  if (traceTableMatch) {
    const table = extractDbIdentifier(traceTableMatch[1]);
    if (table) {
      return {
        mode: "tool",
        selectedFamily: "composer",
        selectedTool: "trace_table",
        selectedArgs: toProjectScopedArgs(input, { table }),
        confidence: 0.94,
      };
    }
  }

  const traceRpcMatch =
    question.match(/^trace rpc (.+)$/i) ??
    question.match(/^who calls rpc (.+)$/i);
  if (traceRpcMatch) {
    const selector = extractRoutineSelector(traceRpcMatch[1]);
    if (selector) {
      const selectedArgs: JsonObject = { name: selector.name };
      if (selector.argTypes) {
        selectedArgs.argTypes = selector.argTypes;
      }
      return {
        mode: "tool",
        selectedFamily: "composer",
        selectedTool: "trace_rpc",
        selectedArgs: toProjectScopedArgs(input, selectedArgs),
        confidence: selector.argTypes ? 0.96 : 0.93,
      };
    }
  }

  const traceEdgeMatch = question.match(/^trace edge (.+)$/i);
  if (traceEdgeMatch) {
    const name = trimTrailingPunctuation(traceEdgeMatch[1]);
    if (name.length > 0) {
      return {
        mode: "tool",
        selectedFamily: "composer",
        selectedTool: "trace_edge",
        selectedArgs: toProjectScopedArgs(input, { name }),
        confidence: 0.95,
      };
    }
  }

  const traceErrorMatch = question.match(/^trace error (.+)$/i);
  if (traceErrorMatch) {
    const term = trimTrailingPunctuation(traceErrorMatch[1]);
    if (term.length > 0) {
      return {
        mode: "tool",
        selectedFamily: "composer",
        selectedTool: "trace_error",
        selectedArgs: toProjectScopedArgs(input, { term }),
        confidence: 0.95,
      };
    }
  }

  const debugLikeQuestion =
    /^why\b/i.test(question) ||
    /\b(?:missing|unknown|empty|disagree|mismatch|misaligned|align|aligned|sync|pattern|helper|rpc)\b/i.test(question);
  if (debugLikeQuestion) {
    const term = extractDebugSearchTerm(question);
    if (term) {
      return {
        mode: "tool",
        selectedFamily: "composer",
        selectedTool: "cross_search",
        selectedArgs: toProjectScopedArgs(input, { term }),
        confidence: 0.72,
      };
    }
  }

  return null;
}

function selectSchemaOrFileQuestion(question: string, input: AskToolInput): AskToolSelection | null {
  const schemaMatch =
    question.match(/^where is (.+?) used$/i) ??
    question.match(/^where is (.+?) referenced$/i) ??
    question.match(/^what code uses (.+)$/i);
  if (schemaMatch) {
    const selector = extractSchemaUsageSelector(schemaMatch[1]);
    if (selector) {
      return {
        mode: "tool",
        selectedFamily: "answers",
        selectedTool: "schema_usage",
        selectedArgs: toProjectScopedArgs(input, selector),
        confidence: 0.9,
      };
    }
  }

  const fileHealthMatch = question.match(/^file health for (.+)$/i) ?? question.match(/^what does (.+?) do$/i);
  if (fileHealthMatch) {
    const file = extractFilePath(fileHealthMatch[1]);
    if (file) {
      return {
        mode: "tool",
        selectedFamily: "answers",
        selectedTool: "file_health",
        selectedArgs: toProjectScopedArgs(input, { file }),
        confidence: 0.91,
      };
    }
  }

  return null;
}

export function routeAskQuestion(input: AskToolInput): AskSelection {
  const question = normalizeQuestion(input.question);

  return (
    selectDbQuestion(question, input) ??
    selectAuthQuestion(question, input) ??
    selectRouteQuestion(question, input) ??
    selectImportOrSymbolQuestion(question, input) ??
    selectComposerQuestion(question, input) ??
    selectSchemaOrFileQuestion(question, input) ?? {
      mode: "fallback",
      selectedFamily: "fallback",
      selectedTool: "free_form",
      selectedArgs: {
        ...projectLocatorArgs(input),
        queryKind: "free_form",
        queryText: question,
      },
      confidence: 0.2,
      fallbackReason: "No deterministic named-tool pattern matched the question.",
    }
  );
}
