import { basename, extname } from "node:path";
import type { ProjectStore } from "@mako-ai/store";

// Framework server primitive markers. A file that contains any of these counts as
// a server-only seed — they're the Next.js building blocks that only run on the
// server side. Server-only-ness then flows transitively through reverse imports.
const FRAMEWORK_SERVER_MARKERS: RegExp[] = [
  /from\s+['"]next\/headers['"]/,
  /from\s+['"]next\/cache['"]/,
  /['"]use server['"]/,
  /\bunstable_cache\s*\(/,
  /\brevalidatePath\s*\(/,
  /\brevalidateTag\s*\(/,
  /\bcookies\s*\(\s*\)/,
  /\bheaders\s*\(\s*\)/,
];

// Auth guard exports follow a naming convention: one of a small set of verb
// prefixes combined with one of a small set of auth-related substrings. This is
// the same pattern Fenrir uses for its project profile. It's tight enough to
// filter out incidental names and loose enough to catch things like `withAuth`,
// `requireSession`, `verifyRole`, `ensureAccess`, `checkPermission`, etc.
const AUTH_VERB_PREFIXES = [
  "with",
  "require",
  "verify",
  "ensure",
  "check",
  "get",
  "assert",
  "enforce",
] as const;

const AUTH_SUBSTRINGS = [
  "Auth",
  "Session",
  "Role",
  "Permission",
  "Access",
  "User",
  "Guard",
  "Login",
] as const;

// Only the following extensions are considered for profile depth detection.
// SQL, Markdown, JSON, etc. are indexed for other reasons but they can't be
// server-only modules or carry auth guard exports.
const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

// Symbol kinds that qualify as guard candidates. Anything else (type aliases,
// interfaces, classes) is rejected regardless of name.
const GUARD_SYMBOL_KINDS = new Set(["function", "variable"]);

// Files whose basename-without-extension matches one of these names are
// part of the Next.js framework contract (pages, layouts, error boundaries,
// etc.). Their exports are Next's own surface, not user-defined guards — we
// skip their symbols entirely during the auth-guard pass. A framework file
// can still propagate server-only-ness through the import graph; it just
// never contributes a symbol name to `authGuardSymbols`.
const FRAMEWORK_RESERVED_BASENAMES = new Set([
  "layout",
  "page",
  "route",
  "default",
  "error",
  "loading",
  "not-found",
  "template",
  "middleware",
  "proxy",
  "head",
  "icon",
  "apple-icon",
  "opengraph-image",
  "twitter-image",
  "robots",
  "sitemap",
  "manifest",
]);

export interface ProfileDepthResult {
  serverOnlyModules: string[];
  authGuardSymbols: string[];
}

function isSourceFile(relativePath: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(relativePath).toLowerCase());
}

function hasFrameworkReservedBasename(relativePath: string): boolean {
  const ext = extname(relativePath);
  const stem = basename(relativePath, ext).toLowerCase();
  return FRAMEWORK_RESERVED_BASENAMES.has(stem);
}

function nameMatchesAuthGuardConvention(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  const matchesPrefix = AUTH_VERB_PREFIXES.some((prefix) => name.startsWith(prefix));
  if (!matchesPrefix) {
    return false;
  }
  return AUTH_SUBSTRINGS.some((substring) => name.includes(substring));
}

/**
 * Re-derive `serverOnlyModules` and `authGuardSymbols` after a project scan has
 * populated the store with files, imports, and exported symbols.
 *
 * The algorithm mirrors Fenrir's three-layer detection model:
 *
 *   1. Seed set — files containing any Next.js server primitive marker
 *      (`next/headers`, `"use server"`, `cookies()`, …).
 *   2. Closure — reverse-import-graph walk from the seeds. Any file that
 *      transitively imports a seed is itself server-only.
 *   3. Symbols — for each server-only file, pull its exported symbols and keep
 *      the ones whose name matches the auth verb-prefix × auth-substring
 *      naming convention. Framework-reserved basenames (page, layout, route,
 *      …) are skipped entirely — their exports belong to the framework, not
 *      to user-defined guards.
 *
 * Cycles in the import graph are handled by the visited set on the BFS walk.
 * Files missing from the store are skipped silently — profile depth must
 * never abort the index run.
 *
 * Content for the seed pass is read from the store's `chunks` table via
 * `getFileContent`, not from disk. The scan already paid the file-read cost
 * once; re-walking the filesystem during profile depth would double that
 * cost on large repos and is explicitly called out as a risk in the phase
 * spec.
 */
export function collectProfileDepth(projectStore: ProjectStore): ProfileDepthResult {
  const files = projectStore.listFiles();

  // Step 1: seed set from store-backed content. Only source files are
  // considered. Files with no stored content are skipped — they'll simply
  // not be seeds, which is the correct degenerate behavior.
  const seeds = new Set<string>();
  for (const file of files) {
    if (!isSourceFile(file.path)) {
      continue;
    }
    const content = projectStore.getFileContent(file.path);
    if (content == null || content === "") {
      continue;
    }
    for (const pattern of FRAMEWORK_SERVER_MARKERS) {
      if (pattern.test(content)) {
        seeds.add(file.path);
        break;
      }
    }
  }

  // Step 2: reverse-import-graph closure. Build a target-path → [importer-paths]
  // map once from the full edge list, then BFS from the seeds. Tracking visited
  // keeps cycles from looping.
  const edges = projectStore.listAllImportEdges();
  const reverseMap = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!edge.targetExists || edge.isTypeOnly) {
      continue;
    }
    let importers = reverseMap.get(edge.targetPath);
    if (!importers) {
      importers = new Set();
      reverseMap.set(edge.targetPath, importers);
    }
    importers.add(edge.sourcePath);
  }

  const serverOnly = new Set<string>(seeds);
  const queue: string[] = [...seeds];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      break;
    }
    const importers = reverseMap.get(node);
    if (!importers) {
      continue;
    }
    for (const importer of importers) {
      if (!serverOnly.has(importer)) {
        serverOnly.add(importer);
        queue.push(importer);
      }
    }
  }

  // Step 3: auth guard symbol extraction. For each server-only file, pull its
  // exported function/variable symbols and keep the ones matching the naming
  // convention. Files that aren't source code are skipped by extension, and
  // files whose basename matches a Next.js framework-reserved name are
  // skipped entirely — those are pages, layouts, route handlers, etc., and
  // their exports belong to the framework contract rather than to user
  // guard code.
  const authGuardSymbols = new Set<string>();
  for (const filePath of serverOnly) {
    if (!isSourceFile(filePath)) {
      continue;
    }
    if (hasFrameworkReservedBasename(filePath)) {
      continue;
    }
    const symbols = projectStore.listSymbolsForFile(filePath);
    for (const symbol of symbols) {
      if (!GUARD_SYMBOL_KINDS.has(symbol.kind)) {
        continue;
      }
      const name = symbol.name;
      if (!nameMatchesAuthGuardConvention(name)) {
        continue;
      }
      authGuardSymbols.add(name);
    }
  }

  return {
    serverOnlyModules: [...serverOnly].sort(),
    authGuardSymbols: [...authGuardSymbols].sort(),
  };
}
