import path from "node:path";
import { normalizePathForGlob } from "../code-intel/path-globs.js";

export function toProjectRelativePath(projectRoot: string, rgPathText: string): string | null {
  const absolutePath = path.isAbsolute(rgPathText)
    ? path.resolve(rgPathText)
    : path.resolve(projectRoot, rgPathText);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }
  return normalizePathForGlob(relativePath);
}
