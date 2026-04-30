import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const SHARED_SKILLS = path.join(REPO_ROOT, "plugins", "_shared", "skills");
const SKILL_TARGETS = [
  path.join(REPO_ROOT, "plugins", "claude-code", "skills"),
  path.join(REPO_ROOT, "plugins", "codex", "skills"),
  path.join(REPO_ROOT, "plugins", "cursor", "skills"),
  path.join(REPO_ROOT, "plugins", "gemini", "skills"),
  path.join(REPO_ROOT, "mako-ai-claude-plugin", "skills"),
];

function relativeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (stat.isFile()) {
        out.push(path.relative(root, fullPath).replace(/\\/g, "/"));
      }
    }
  };
  visit(root);
  return out.sort((left, right) => left.localeCompare(right));
}

function readNormalized(filePath: string): string {
  return readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function copySharedTo(target: string): void {
  const sourceFiles = relativeFiles(SHARED_SKILLS);
  const sourceSet = new Set(sourceFiles);
  mkdirSync(target, { recursive: true });

  for (const rel of sourceFiles) {
    const sourcePath = path.join(SHARED_SKILLS, rel);
    const targetPath = path.join(target, rel);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(sourcePath));
  }

  for (const rel of relativeFiles(target)) {
    if (!sourceSet.has(rel)) {
      rmSync(path.join(target, rel), { force: true });
    }
  }
}

function diffTarget(target: string): string[] {
  const sourceFiles = relativeFiles(SHARED_SKILLS);
  const targetFiles = relativeFiles(target);
  const all = new Set([...sourceFiles, ...targetFiles]);
  const errors: string[] = [];
  for (const rel of [...all].sort((left, right) => left.localeCompare(right))) {
    const sourcePath = path.join(SHARED_SKILLS, rel);
    const targetPath = path.join(target, rel);
    if (!existsSync(sourcePath)) {
      errors.push(`${path.relative(REPO_ROOT, target)} has extra ${rel}`);
      continue;
    }
    if (!existsSync(targetPath)) {
      errors.push(`${path.relative(REPO_ROOT, target)} is missing ${rel}`);
      continue;
    }
    if (readNormalized(sourcePath) !== readNormalized(targetPath)) {
      errors.push(`${path.relative(REPO_ROOT, target)} differs at ${rel}`);
    }
  }
  return errors;
}

function main(): void {
  const check = process.argv.includes("--check");
  if (!existsSync(SHARED_SKILLS)) {
    throw new Error(`Missing shared skills directory: ${path.relative(REPO_ROOT, SHARED_SKILLS)}`);
  }

  if (!check) {
    for (const target of SKILL_TARGETS) {
      copySharedTo(target);
    }
    console.log("sync-plugins: synced skills");
    return;
  }

  const errors = SKILL_TARGETS.flatMap(diffTarget);
  if (errors.length > 0) {
    throw new Error(`Plugin skill drift detected:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  console.log("sync-plugins: check passed");
}

main();
