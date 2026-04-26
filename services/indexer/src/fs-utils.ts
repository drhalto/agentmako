import { Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { toRelativePath } from "@mako-ai/store";
import { isIgnoredProjectDirectory } from "./project-index-scope.js";

function walkDirectory(
  rootPath: string,
  currentPath: string,
  predicate: (absolutePath: string, relativePath: string, entry: Dirent) => boolean,
  output: string[],
): void {
  const entries = readdirSync(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = toRelativePath(rootPath, absolutePath);

    if (entry.isDirectory()) {
      if (isIgnoredProjectDirectory(entry.name)) {
        continue;
      }

      walkDirectory(rootPath, absolutePath, predicate, output);
      continue;
    }

    if (entry.isFile() && predicate(absolutePath, relativePath, entry)) {
      output.push(absolutePath);
    }
  }
}

export function collectProjectFilePaths(
  rootPath: string,
  predicate: (absolutePath: string, relativePath: string, entry: Dirent) => boolean = () => true,
): string[] {
  const normalizedRoot = path.resolve(rootPath);
  const output: string[] = [];
  walkDirectory(normalizedRoot, normalizedRoot, predicate, output);
  return output;
}

export function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parsed != null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readTextFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
