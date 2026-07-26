import type {
  ContextPacketIntent,
  ContextPacketIntentFamily,
  ContextPacketToolInput,
} from "@mako-ai/contracts";

const STOP_WORDS = new Set([
  "the",
  "all",
  "and",
  "any",
  "for",
  "that",
  "this",
  "these",
  "those",
  "with",
  "from",
  "after",
  "before",
  "into",
  "when",
  "where",
  "why",
  "what",
  "who",
  "get",
  "set",
  "use",
  "does",
  "do",
  "it",
  "its",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "not",
  "but",
  "can",
  "cant",
  "cannot",
  "about",
  "broken",
  "issue",
  "bug",
  "fix",
  "understand",
  "file",
  "files",
  "source",
  "sources",
  "route",
  "routes",
  "boundary",
  "boundaries",
  "database",
  "databases",
  "db",
  "object",
  "objects",
  "matter",
  "matters",
  "change",
  "changes",
  "changing",
  "check",
  "checks",
  "identify",
  "concrete",
  "risk",
  "risks",
  "should",
  "verify",
  "editing",
  "edit",
  "scoped",
]);

const FILE_TOKEN = /(?:[A-Za-z]:)?(?:[\w.-]+[\\/])+[\w.[\]()-]+\.(?:tsx|ts|jsx|js|mjs|cjs|sql|md|json|scss|css|html|py|rs|go)/g;
const ROUTE_TOKEN = /(?:^|\s)(\/[A-Za-z0-9_./:{}[\]-]+)/g;
const IDENTIFIER = /\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g;
const DB_QUALIFIED_IDENTIFIER = /\b(?<schema>[a-z][a-z0-9_]*)\.(?<object>[a-z][a-z0-9_]*)\b/g;
const DB_DIRECT_CUE = /\b(?:database\s+object|db\s+object|table|relation|schema\s+object|rpc|function|procedure|index|foreign\s+key|fk|policy|trigger|cron|scheduled\s+job|job)\s+(?:named\s+|called\s+)?(?<object>[a-z][a-z0-9_]*)\b/gi;
const DB_RELATION_CUE = /\b(?:database\s+objects?|db\s+objects?|tables?|relations?|schemas?|rpcs?|functions?|procedures?|columns?|indexes?|foreign\s+keys?|fks?|rls|polic(?:y|ies)|triggers?|crons?|scheduled\s+jobs?|jobs?)\b[^?\r\n]{0,120}?\b(?:on|for|of)\s+(?<object>[a-z][a-z0-9_]*)\b/gi;
const FILE_EXTENSION_OBJECTS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "sql", "yml", "yaml", "css", "scss", "html", "py", "rs", "go"]);
const GENERIC_DATABASE_TARGETS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "this",
  "that",
  "all",
  "every",
  "which",
  "what",
  "matter",
  "matters",
  "change",
  "changes",
  "affect",
  "affects",
  "used",
  "usage",
  "design",
  "behavior",
  "implementation",
]);

const FAMILY_KEYWORDS: Record<ContextPacketIntentFamily, string[]> = {
  debug_route: ["route", "api", "endpoint", "callback", "handler", "page", "server action"],
  debug_type_contract: ["type", "interface", "contract", "schema", "prop", "props", "generic"],
  debug_auth_state: ["auth", "session", "login", "logout", "user", "jwt", "token", "permission", "role", "roles", "access"],
  debug_database_usage: ["db", "database", "table", "rpc", "rls", "sql", "migration", "schema", "policy"],
  debug_ui_behavior: ["ui", "component", "hydration", "render", "client", "useeffect", "state", "hook"],
  implement_feature: ["add", "build", "implement", "feature", "create", "support"],
  review_change: ["review", "audit", "regression", "diff", "risk"],
  find_precedent: ["similar", "precedent", "example", "pattern", "where else"],
  unknown: [],
};

function unique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^[("'`]+|[)"'`,.;:]+$/g, "");
}

// A quoted span only counts as a searchable code literal when it can
// plausibly appear verbatim in the tree: a single token, something with code
// punctuation/casing, or a '/" string (often an error message worth grepping).
// Prose emphasized with backticks ("the `authentication middleware` flow")
// otherwise becomes a phantom "literal not found on the filesystem" gap that
// downgrades coverage for a perfectly good packet.
function looksLikeSearchableLiteral(value: string, quoteChar: string): boolean {
  if (!/\s/.test(value)) return true;
  if (/[_./\\(){}[\]<>=:;$]|[a-z][A-Z]/.test(value)) return true;
  return quoteChar !== "`";
}

function extractQuotedText(request: string): string[] {
  const quoted: string[] = [];
  for (const match of request.matchAll(/(["'`])([^"'`]{2,160})\1/g)) {
    const value = match[2]?.trim();
    if (value && looksLikeSearchableLiteral(value, match[1] ?? "")) quoted.push(value);
  }
  return unique(quoted).slice(0, 20);
}

function extractFiles(request: string, input: ContextPacketToolInput): string[] {
  const files = new Set<string>(input.focusFiles ?? []);
  for (const match of request.matchAll(FILE_TOKEN)) {
    files.add(normalizePath(match[0]));
  }
  for (const changed of input.changedFiles ?? []) {
    files.add(normalizePath(changed));
  }
  return unique(files).slice(0, 80);
}

function extractRoutes(request: string, input: ContextPacketToolInput): string[] {
  const routes = new Set<string>(input.focusRoutes ?? []);
  for (const match of request.matchAll(ROUTE_TOKEN)) {
    const value = match[1]?.replace(/[.,;:]+$/g, "");
    if (value && value.length > 1) routes.add(value);
  }
  return unique(routes).slice(0, 50);
}

function isSentenceStart(request: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    const ch = request[i];
    if (ch === " " || ch === "\t") continue;
    return ch === "." || ch === "!" || ch === "?" || ch === ";" || ch === ":" || ch === "\n" || ch === "\r";
  }
  return true;
}

function extractSymbols(request: string, input: ContextPacketToolInput): string[] {
  const symbols = new Set<string>(input.focusSymbols ?? []);
  for (const match of request.matchAll(IDENTIFIER)) {
    const value = match[0];
    if (STOP_WORDS.has(value.toLowerCase())) continue;
    const codeLike =
      /[a-z][A-Z]/.test(value) ||
      /^use[A-Z0-9_]/.test(value) ||
      /[_$0-9]/.test(value) ||
      /^[A-Z]{2,}/.test(value);
    if (codeLike) {
      symbols.add(value);
      continue;
    }
    // A plain Capitalized word only counts as a symbol when it is not just
    // sentence capitalization — "Explain how the flow works" must not create
    // an uncoverable `Explain` anchor that sinks request coverage to
    // missing/weak for an otherwise good packet.
    if (/^[A-Z][a-z]+$/.test(value) && !isSentenceStart(request, match.index ?? 0)) {
      symbols.add(value);
    }
  }
  return unique(symbols).slice(0, 60);
}

function extractDatabaseObjects(request: string, input: ContextPacketToolInput): string[] {
  const objects = new Set<string>(input.focusDatabaseObjects ?? []);
  for (const match of request.matchAll(DB_QUALIFIED_IDENTIFIER)) {
    const schema = match.groups?.schema;
    const object = match.groups?.object;
    if (!schema || !object || FILE_EXTENSION_OBJECTS.has(object)) continue;
    objects.add(`${schema}.${object}`);
  }
  for (const pattern of [DB_DIRECT_CUE, DB_RELATION_CUE]) {
    for (const match of request.matchAll(pattern)) {
      const object = match.groups?.object;
      if (!object || GENERIC_DATABASE_TARGETS.has(object.toLowerCase())) continue;
      objects.add(object);
    }
  }
  return unique(objects).slice(0, 60);
}

function keywordCandidate(value: string): string | undefined {
  const keyword = value.toLowerCase().replace(/^[./_-]+|[./_-]+$/g, "");
  return keyword.length >= 3 && !STOP_WORDS.has(keyword) ? keyword : undefined;
}

function splitCompoundTerms(value: string): string[] {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(/\s+/)
    .map((word) => keywordCandidate(word))
    .filter((word): word is string => Boolean(word));
}

function extractKeywords(request: string, entityTerms: readonly string[]): string[] {
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .map((word) => keywordCandidate(word))
    .filter((word): word is string => Boolean(word));
  const expandedTerms = unique([
    ...(request.match(/[A-Za-z0-9_$./-]{3,}/g) ?? []),
    ...entityTerms,
  ].flatMap(splitCompoundTerms));
  return unique([...words, ...expandedTerms]).slice(0, 40);
}

function scoreFamily(requestLower: string, keywords: readonly string[], family: ContextPacketIntentFamily): {
  confidence: number;
  signals: string[];
} {
  const signals = FAMILY_KEYWORDS[family].filter((keyword) => {
    if (keyword.includes(" ")) return requestLower.includes(keyword);
    return keywords.includes(keyword) || requestLower.includes(keyword);
  });
  if (signals.length === 0) return { confidence: 0, signals: [] };
  return {
    confidence: Math.min(0.95, 0.4 + signals.length * 0.13),
    signals,
  };
}

export function detectContextPacketIntent(input: ContextPacketToolInput): ContextPacketIntent {
  const request = input.request.trim();
  const requestLower = request.toLowerCase();
  const files = extractFiles(request, input);
  const symbols = extractSymbols(request, input);
  const routes = extractRoutes(request, input);
  const databaseObjects = extractDatabaseObjects(request, input);
  const quotedText = extractQuotedText(request);
  const keywords = extractKeywords(request, [
    ...symbols,
    ...routes,
    ...databaseObjects,
    ...quotedText,
  ]);
  const families: ContextPacketIntent["families"] = (Object.keys(FAMILY_KEYWORDS) as ContextPacketIntentFamily[])
    .filter((family) => family !== "unknown")
    .map((family) => ({
      family,
      ...scoreFamily(requestLower, keywords, family),
    }))
    .filter((entry) => entry.confidence > 0)
    .sort((left, right) => right.confidence - left.confidence);

  if (families.length === 0) {
    families.push({
      family: "unknown",
      confidence: 0.35,
      signals: ["no_strong_family_match"],
    });
  }

  return {
    primaryFamily: families[0]?.family ?? "unknown",
    families,
    entities: {
      files,
      symbols,
      routes,
      databaseObjects,
      quotedText,
      keywords,
    },
  };
}
