import { basename, extname, join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import type { ProjectFramework, ProjectOrm, ProjectProfile, SupportLevel } from "@mako-ai/contracts";
import { normalizePath, toRelativePath } from "@mako-ai/store";
import { createPathsMatcher, getTsconfig } from "get-tsconfig";
import { collectProjectFilePaths, readJsonObject } from "./fs-utils.js";

// Names that count as Next.js middleware/proxy entrypoints. `proxy` was added in
// Next.js 16 as the canonical name for what used to be called `middleware`. Both are
// still recognized by the framework.
const MIDDLEWARE_BASENAMES = new Set(["middleware", "proxy"]);
const MIDDLEWARE_CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const APP_ROUTER_ENTRY_BASENAMES = new Set([
  "apple-icon",
  "default",
  "error",
  "head",
  "icon",
  "layout",
  "loading",
  "manifest",
  "not-found",
  "opengraph-image",
  "page",
  "robots",
  "route",
  "sitemap",
  "template",
  "twitter-image",
]);
const NEXT_CONFIG_FILENAMES = ["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts"] as const;
const JSONC_CONFIG_FILENAMES = ["tsconfig.json", "jsconfig.json"] as const;
const PATH_ALIAS_PROBE = "__mako_path_alias_probe__";

// A candidate middleware file must export a `config` object AND declare a `matcher`
// field on it — that's how Next.js recognizes middleware. Filename alone is not
// enough; any file called `middleware.ts` anywhere in the repo used to get picked up
// by the old regex and polluted the profile. We validate body content to reject files
// that happen to share the filename but aren't actually middleware.
const MIDDLEWARE_CONFIG_EXPORT_PATTERN = /export\s+(?:const|default)\s+config\b/;
const MIDDLEWARE_MATCHER_PATTERN = /\bmatcher\s*:/;

const KNOWN_ENTRYPOINTS = [
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "app/page.tsx",
  "app/layout.tsx",
  "src/pages/index.tsx",
  "src/pages/index.ts",
  "pages/index.tsx",
  "pages/index.ts",
  "src/main.ts",
  "src/main.tsx",
  "src/index.ts",
  "src/index.tsx",
  "index.ts",
  "index.tsx",
] as const;

function isDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function isCodeEntrypoint(relativePath: string): boolean {
  return MIDDLEWARE_CODE_EXTENSIONS.has(extname(relativePath).toLowerCase());
}

function isAppRouterEntrypoint(relativePath: string, appPrefix: string): boolean {
  if (!relativePath.startsWith(appPrefix) || !isCodeEntrypoint(relativePath)) {
    return false;
  }

  return APP_ROUTER_ENTRY_BASENAMES.has(basename(relativePath, extname(relativePath)));
}

function isPagesRouterEntrypoint(relativePath: string, pagesPrefix: string): boolean {
  return relativePath.startsWith(pagesPrefix) && isCodeEntrypoint(relativePath);
}

function collectDependencies(packageJson: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(typeof packageJson.dependencies === "object" && packageJson.dependencies !== null
      ? packageJson.dependencies
      : {}),
    ...(typeof packageJson.devDependencies === "object" && packageJson.devDependencies !== null
      ? packageJson.devDependencies
      : {}),
  };
}

export function detectFrameworkFromPackageJson(packageJson: Record<string, unknown>): ProjectFramework {
  const deps = collectDependencies(packageJson);

  if ("next" in deps) {
    return "nextjs";
  }

  if ("vite" in deps && "react" in deps) {
    return "vite-react";
  }

  if ("typescript" in deps) {
    return "node-ts";
  }

  return "unknown";
}

export function detectOrmFromPackageJson(packageJson: Record<string, unknown>): ProjectOrm {
  const deps = collectDependencies(packageJson);

  if ("@supabase/supabase-js" in deps || "@supabase/ssr" in deps) {
    return "supabase";
  }

  if ("prisma" in deps || "@prisma/client" in deps) {
    return "prisma";
  }

  if ("drizzle-orm" in deps) {
    return "drizzle";
  }

  if ("pg" in deps || "postgres" in deps || "knex" in deps) {
    return "sql";
  }

  return "unknown";
}

function determineSupportLevel(framework: ProjectFramework, orm: ProjectOrm): SupportLevel {
  if (framework === "nextjs" && orm !== "unknown") {
    return "native";
  }

  if (framework !== "unknown" || orm !== "unknown") {
    return "adapted";
  }

  return "best_effort";
}

function detectProjectName(rootPath: string, packageJson: Record<string, unknown>): string {
  if (typeof packageJson.name === "string" && packageJson.name.trim() !== "") {
    return packageJson.name;
  }

  return basename(rootPath);
}

function detectSrcRoot(rootPath: string, framework: ProjectFramework): string {
  const srcPath = normalizePath(join(rootPath, "src"));
  if (!isDirectory(srcPath)) {
    return normalizePath(rootPath);
  }

  if (framework === "nextjs") {
    if (isDirectory(join(srcPath, "app")) || isDirectory(join(srcPath, "pages"))) {
      return srcPath;
    }

    return normalizePath(rootPath);
  }

  return srcPath;
}

function detectPathAliases(rootPath: string): Record<string, string> {
  for (const configName of JSONC_CONFIG_FILENAMES) {
    const configPath = join(rootPath, configName);
    if (!existsSync(configPath)) {
      continue;
    }

    const tsconfig = getTsconfig(configPath);
    if (!tsconfig) {
      continue;
    }

    const paths = tsconfig.config.compilerOptions?.paths;
    if (!paths || typeof paths !== "object") {
      continue;
    }

    const matchPath = createPathsMatcher(tsconfig);
    if (!matchPath) {
      continue;
    }

    const aliases: Record<string, string> = {};
    for (const [alias, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets) || targets.length === 0) {
        continue;
      }

      const wildcard = alias.endsWith("*");
      const aliasKey = wildcard ? alias.slice(0, -1) : alias;
      const specifier = wildcard ? `${aliasKey}${PATH_ALIAS_PROBE}` : aliasKey;
      const matches = matchPath(specifier);
      const firstMatch = matches.find((candidate) => candidate.trim() !== "");
      if (!firstMatch) {
        continue;
      }

      let resolved = normalizePath(firstMatch);
      if (wildcard) {
        resolved = resolved.replace(new RegExp(`(?:^|/)${PATH_ALIAS_PROBE}(?:\\.[^/]+)?$`), "");
      }

      aliases[aliasKey] = resolved;
    }

    if (Object.keys(aliases).length > 0) {
      return aliases;
    }
  }

  return {};
}

function collectEntrypoints(
  rootPath: string,
  srcRoot: string,
  relativeFiles: string[],
  middlewareFiles: string[],
): string[] {
  const sortedFiles = [...relativeFiles].sort();
  const available = new Set(sortedFiles);
  const entryPoints: string[] = [];
  const relativeSrcRoot = toRelativePath(rootPath, srcRoot);
  const sourcePrefix = relativeSrcRoot === "." ? "" : `${relativeSrcRoot}/`;
  const appPrefix = `${sourcePrefix}app/`;
  const pagesPrefix = `${sourcePrefix}pages/`;

  for (const relativePath of sortedFiles) {
    if (isAppRouterEntrypoint(relativePath, appPrefix) || isPagesRouterEntrypoint(relativePath, pagesPrefix)) {
      pushUnique(entryPoints, relativePath);
    }
  }

  for (const middlewareFile of [...middlewareFiles].sort()) {
    pushUnique(entryPoints, middlewareFile);
  }

  for (const nextConfig of NEXT_CONFIG_FILENAMES) {
    if (available.has(nextConfig)) {
      pushUnique(entryPoints, nextConfig);
    }
    if (sourcePrefix !== "") {
      const sourceConfig = `${sourcePrefix}${nextConfig}`;
      if (available.has(sourceConfig)) {
        pushUnique(entryPoints, sourceConfig);
      }
    }
  }

  for (const entrypoint of KNOWN_ENTRYPOINTS) {
    if (available.has(entrypoint)) {
      pushUnique(entryPoints, entrypoint);
    }
  }

  const packageJson = readJsonObject(`${rootPath}/package.json`);
  if (typeof packageJson.main === "string") {
    const packageMain = normalizeRelativePath(packageJson.main);
    if (available.has(packageMain)) {
      pushUnique(entryPoints, packageMain);
    }
  }

  for (const relativePath of sortedFiles) {
    if (/(index|main|server)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(relativePath)) {
      pushUnique(entryPoints, relativePath);
    }
  }

  return entryPoints;
}

/**
 * Scan the source root (non-recursive, top-level only) for Next.js middleware
 * files. Matches basenames `middleware` and `proxy` (Next.js 16 renamed
 * `middleware.ts` to `proxy.ts` as the canonical name; both still work). Each
 * candidate must also contain both an `export (const|default) config` AND a
 * `matcher:` field, so a file that happens to share the name but isn't real
 * middleware will be rejected.
 *
 * Returned paths are relative to `rootPath` and use forward slashes.
 */
function collectMiddlewareFiles(srcRoot: string, rootPath: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(srcRoot, { withFileTypes: true, encoding: "utf8" }) as Dirent[];
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const stem = basename(entry.name, extname(entry.name));
    if (!MIDDLEWARE_BASENAMES.has(stem)) {
      continue;
    }
    const ext = extname(entry.name).toLowerCase();
    if (!MIDDLEWARE_CODE_EXTENSIONS.has(ext)) {
      continue;
    }

    const absolutePath = join(srcRoot, entry.name);
    let content: string;
    try {
      content = readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }
    if (!MIDDLEWARE_CONFIG_EXPORT_PATTERN.test(content)) {
      continue;
    }
    if (!MIDDLEWARE_MATCHER_PATTERN.test(content)) {
      continue;
    }

    found.push(toRelativePath(rootPath, absolutePath));
  }

  return found.sort();
}

// `serverOnlyModules` and `authGuardSymbols` are derived from the import graph
// and the exported-symbol table, neither of which exists until `indexProject`
// has run a scan. At attach time they start empty; the post-scan profile-depth
// step in `indexProject` computes them and writes them back to the manifest.
//
// Earlier revisions of these fields tried to heuristically guess server-only
// modules from path substrings (`app/api/`, `lib/server/`, …) and collected
// "auth guard symbols" by taking the filename stem of any file whose path
// contained `auth|guard|session|…`. Both approaches produced bad data: SQL
// migration filenames showed up as guard symbols, framework-reserved names
// like `layout`, `page`, `route` leaked in, and client-side files with
// "server" in the path were wrongly tagged server-only. Returning empty lists
// here — and letting the post-scan step fill them honestly — is more correct
// than shipping the old heuristics.
function collectInitialServerOnlyModules(): string[] {
  return [];
}

function collectInitialAuthGuardSymbols(): string[] {
  return [];
}

export function createEmptyProfile(rootPath: string, name = "unknown-project"): ProjectProfile {
  return {
    name,
    rootPath: normalizePath(rootPath),
    framework: "unknown",
    orm: "unknown",
    srcRoot: normalizePath(rootPath),
    entryPoints: [],
    pathAliases: {},
    middlewareFiles: [],
    serverOnlyModules: [],
    authGuardSymbols: [],
    supportLevel: "best_effort",
    detectedAt: new Date().toISOString(),
  };
}

export function detectProjectProfile(rootPath: string): ProjectProfile {
  const packageJson = readJsonObject(`${rootPath}/package.json`);
  const relativeFiles = collectProjectFilePaths(rootPath).map((absolutePath) =>
    toRelativePath(rootPath, absolutePath),
  );

  const framework = detectFrameworkFromPackageJson(packageJson);
  const orm = detectOrmFromPackageJson(packageJson);
  const srcRoot = detectSrcRoot(rootPath, framework);
  const middlewareFiles = collectMiddlewareFiles(srcRoot, rootPath);

  return {
    name: detectProjectName(rootPath, packageJson),
    rootPath: normalizePath(rootPath),
    framework,
    orm,
    srcRoot,
    entryPoints: collectEntrypoints(rootPath, srcRoot, relativeFiles, middlewareFiles),
    pathAliases: detectPathAliases(rootPath),
    middlewareFiles,
    serverOnlyModules: collectInitialServerOnlyModules(),
    authGuardSymbols: collectInitialAuthGuardSymbols(),
    supportLevel: determineSupportLevel(framework, orm),
    detectedAt: new Date().toISOString(),
  };
}
