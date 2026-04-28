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
