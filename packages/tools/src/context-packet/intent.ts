import type {
  ContextPacketIntent,
  ContextPacketIntentFamily,
  ContextPacketToolInput,
} from "@mako-ai/contracts";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "after",
  "before",
  "into",
  "when",
  "where",
  "why",
  "what",
  "does",
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
]);

const FILE_TOKEN = /(?:[A-Za-z]:)?(?:[\w.-]+[\\/])+[\w.[\]()-]+\.(?:ts|tsx|js|jsx|mjs|cjs|sql|md|json|css|scss|html|py|rs|go)/g;
const ROUTE_TOKEN = /(?:^|\s)(\/[A-Za-z0-9_./:{}[\]-]+)/g;
const IDENTIFIER = /\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g;
const DB_IDENTIFIER = /\b(?:[a-z][a-z0-9]*_+[a-z0-9_]+|[a-z][a-z0-9]*\.[a-z][a-z0-9_]+)\b/g;

const FAMILY_KEYWORDS: Record<ContextPacketIntentFamily, string[]> = {
  debug_route: ["route", "api", "endpoint", "callback", "handler", "page", "server action"],
  debug_type_contract: ["type", "interface", "contract", "schema", "prop", "props", "generic"],
  debug_auth_state: ["auth", "session", "login", "logout", "user", "jwt", "token", "permission"],
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

function extractQuotedText(request: string): string[] {
  const quoted: string[] = [];
  for (const match of request.matchAll(/["'`]([^"'`]{2,160})["'`]/g)) {
    const value = match[1]?.trim();
    if (value) quoted.push(value);
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

function extractSymbols(request: string, input: ContextPacketToolInput): string[] {
  const symbols = new Set<string>(input.focusSymbols ?? []);
  for (const match of request.matchAll(IDENTIFIER)) {
    const value = match[0];
    if (/^[A-Z]/.test(value) || /[a-z][A-Z]/.test(value) || value.startsWith("use")) {
      symbols.add(value);
    }
  }
  return unique(symbols).slice(0, 60);
}

function extractDatabaseObjects(request: string, input: ContextPacketToolInput): string[] {
  const objects = new Set<string>(input.focusDatabaseObjects ?? []);
  for (const match of request.matchAll(DB_IDENTIFIER)) {
    objects.add(match[0]);
  }
  return unique(objects).slice(0, 60);
}

function extractKeywords(request: string): string[] {
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return unique(words).slice(0, 40);
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
  const keywords = extractKeywords(request);
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
      files: extractFiles(request, input),
      symbols: extractSymbols(request, input),
      routes: extractRoutes(request, input),
      databaseObjects: extractDatabaseObjects(request, input),
      quotedText: extractQuotedText(request),
      keywords,
    },
  };
}
