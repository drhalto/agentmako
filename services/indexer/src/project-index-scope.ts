import path from "node:path";
import { isIgnoredDirectory, looksGeneratedFile, toRelativePath } from "@mako-ai/store";

export const MAX_INDEXED_FILE_SIZE_BYTES = 512 * 1024;

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

export function isIndexableProjectPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const ext = path.extname(normalized).toLowerCase();
  return (
    INDEXABLE_EXTENSIONS.has(ext) ||
    /(^|\/)(package\.json|tsconfig\.json|README\.md)$/i.test(normalized)
  );
}

export function isIgnoredProjectDirectory(name: string): boolean {
  return isIgnoredDirectory(name);
}

export function isIgnoredProjectRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "." || normalized === "") return false;
  if (looksGeneratedFile(normalized)) return true;
  return normalized.split("/").some((part) => isIgnoredProjectDirectory(part));
}

export function isWatchableProjectPath(relativePath: string): boolean {
  return (
    !isIgnoredProjectRelativePath(relativePath) &&
    isIndexableProjectPath(relativePath)
  );
}

export function toProjectIndexRelativePath(
  projectRoot: string,
  absolutePath: string,
): string | null {
  const relativePath = toRelativePath(projectRoot, absolutePath);
  if (relativePath === "." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    return null;
  }
  return relativePath.replace(/\\/g, "/");
}
