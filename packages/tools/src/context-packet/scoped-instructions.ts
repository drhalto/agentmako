import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ContextPacketInstruction, ContextPacketReadableCandidate } from "@mako-ai/contracts";

const MAX_INSTRUCTION_EXCERPT_CHARS = 1600;

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isWithinRoot(projectRoot: string, candidatePath: string): boolean {
  const relativePath = path.relative(projectRoot, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function readExcerpt(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf8").trim();
    return content.length > MAX_INSTRUCTION_EXCERPT_CHARS
      ? `${content.slice(0, MAX_INSTRUCTION_EXCERPT_CHARS).trimEnd()}\n...`
      : content;
  } catch {
    return null;
  }
}

function candidatePaths(candidates: readonly ContextPacketReadableCandidate[]): string[] {
  return [...new Set(
    candidates
      .map((candidate) => candidate.path)
      .filter((candidatePath): candidatePath is string => typeof candidatePath === "string" && candidatePath.length > 0)
      .map(normalizeRelativePath),
  )];
}

function ancestorDirectories(filePath: string): string[] {
  const normalized = normalizeRelativePath(filePath);
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  const out: string[] = [];
  for (let index = 1; index <= parts.length; index += 1) {
    out.push(parts.slice(0, index).join("/"));
  }
  return out;
}

function appliesToScope(scope: string, files: readonly string[]): string[] {
  if (scope === "") return [...files];
  const prefix = `${scope}/`;
  return files.filter((filePath) => filePath === scope || filePath.startsWith(prefix));
}

function pushInstruction(args: {
  out: ContextPacketInstruction[];
  projectRoot: string;
  relativePath: string;
  appliesTo: string[];
  precedence: number;
  reason: string;
}): void {
  if (args.appliesTo.length === 0) return;
  const absolutePath = path.resolve(args.projectRoot, args.relativePath);
  if (!isWithinRoot(args.projectRoot, absolutePath) || !existsSync(absolutePath)) return;
  const excerpt = readExcerpt(absolutePath);
  if (excerpt == null) return;
  args.out.push({
    path: normalizeRelativePath(args.relativePath),
    appliesTo: args.appliesTo,
    precedence: args.precedence,
    reason: args.reason,
    excerpt,
  });
}

export function loadScopedInstructions(args: {
  projectRoot: string;
  candidates: readonly ContextPacketReadableCandidate[];
}): ContextPacketInstruction[] {
  const files = candidatePaths(args.candidates);
  if (files.length === 0) return [];

  const out: ContextPacketInstruction[] = [];
  pushInstruction({
    out,
    projectRoot: args.projectRoot,
    relativePath: ".mako/instructions.md",
    appliesTo: files,
    precedence: 0,
    reason: "Project baseline Mako instructions.",
  });
  pushInstruction({
    out,
    projectRoot: args.projectRoot,
    relativePath: "AGENTS.md",
    appliesTo: files,
    precedence: 10,
    reason: "Root-scoped agent instructions.",
  });

  const scopes = new Set<string>();
  for (const filePath of files) {
    for (const directory of ancestorDirectories(filePath)) {
      scopes.add(directory);
    }
  }

  for (const scope of [...scopes].sort((left, right) => left.localeCompare(right))) {
    const depth = scope.split("/").filter(Boolean).length;
    pushInstruction({
      out,
      projectRoot: args.projectRoot,
      relativePath: `${scope}/AGENTS.md`,
      appliesTo: appliesToScope(scope, files),
      precedence: 20 + depth,
      reason: `Directory-scoped agent instructions for ${scope}.`,
    });
  }

  return out.sort((left, right) => left.precedence - right.precedence || left.path.localeCompare(right.path));
}
