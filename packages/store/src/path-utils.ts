import path from "node:path";

function normalizeDriveLetter(value: string): string {
  return value.replace(/^([A-Z]):/, (_, driveLetter: string) => `${driveLetter.toLowerCase()}:`);
}

export function normalizePath(value: string): string {
  const resolved = path.resolve(value).replace(/\\/g, "/");
  return normalizeDriveLetter(resolved);
}

export function toRelativePath(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" ? "." : relative.replace(/\\/g, "/");
}

export const INDEXABLE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);

export interface ImportEdgeResolution {
  importKind: string;
  targetExists: boolean;
  specifier: string;
}

// Import edges resolve against the indexed file set only, so `targetExists`
// is false for every npm package, node builtin, and asset import even though
// nothing is broken. An edge is only unresolved in the "broken import" sense
// when it points inside the repo at something the indexer could have indexed
// and still found no target.
export function isUnresolvedInternalImport(edge: ImportEdgeResolution): boolean {
  if (edge.targetExists) {
    return false;
  }
  if (edge.importKind !== "relative" && edge.importKind !== "re-export") {
    return false;
  }

  // Bundler suffixes like `./logo.svg?url` never change what the extension is.
  const specifier = edge.specifier.split("?")[0].split("#")[0];
  const lastSegment = specifier.split("/").at(-1) ?? specifier;
  const dot = lastSegment.lastIndexOf(".");
  if (dot <= 0) {
    return true;
  }
  return INDEXABLE_EXTENSIONS.has(lastSegment.slice(dot).toLowerCase());
}

export function looksGeneratedFile(relativePath: string): boolean {
  return (
    relativePath.endsWith(".d.ts") ||
    relativePath.includes("/generated/") ||
    relativePath.includes("/__generated__/") ||
    relativePath.includes("/coverage/")
  );
}

export function isIgnoredDirectory(name: string): boolean {
  if (name === ".mako-ai" || name.startsWith(".mako-ai-")) {
    return true;
  }

  return [
    ".claude",
    ".git",
    ".idea",
    ".mako",
    ".playwright",
    ".vscode",
    ".next",
    ".turbo",
    "coverage",
    "dist",
    "build",
    "node_modules",
    "obj",
  ].includes(name);
}
