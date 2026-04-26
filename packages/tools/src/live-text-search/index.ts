import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  LiveTextSearchMatch,
  LiveTextSearchToolInput,
  LiveTextSearchToolOutput,
} from "@mako-ai/contracts";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { matchesPathGlob, normalizePathForGlob } from "../code-intel/path-globs.js";
import { toProjectRelativePath } from "./paths.js";

const DEFAULT_MAX_MATCHES = 500;
const DEFAULT_MAX_FILES = 200;
const RIPGREP_TIMEOUT_MS = 15_000;
const requireFromHere = createRequire(import.meta.url);
const GLOB_META_PATTERN = /[*?\[]/;

interface RipgrepSubmatch {
  match?: {
    text?: string;
  };
  start?: number;
  end?: number;
}

interface RipgrepMatchEvent {
  type?: string;
  data?: {
    path?: {
      text?: string;
    };
    lines?: {
      text?: string;
    };
    line_number?: number;
    submatches?: RipgrepSubmatch[];
  };
}

function parseMatchEvent(
  projectRoot: string,
  value: RipgrepMatchEvent,
): LiveTextSearchMatch | null {
  if (value.type !== "match") {
    return null;
  }
  const data = value.data;
  const pathText = data?.path?.text;
  const line = data?.line_number;
  if (!pathText || typeof line !== "number") {
    return null;
  }
  const filePath = toProjectRelativePath(projectRoot, pathText);
  if (filePath == null) {
    return null;
  }
  const submatches = (data?.submatches ?? []).flatMap((submatch) => {
    if (typeof submatch.start !== "number" || typeof submatch.end !== "number") {
      return [];
    }
    return [{
      text: submatch.match?.text ?? "",
      start: submatch.start,
      end: submatch.end,
    }];
  });
  return {
    filePath,
    line,
    column: (submatches[0]?.start ?? 0) + 1,
    text: data?.lines?.text?.replace(/\r?\n$/, "") ?? "",
    submatches,
  };
}

function searchRootsForPathGlob(projectRoot: string, pathGlob: string | undefined): string[] {
  if (!pathGlob) {
    return ["."];
  }

  const normalizedGlob = normalizePathForGlob(pathGlob);
  const metaIndex = normalizedGlob.search(GLOB_META_PATTERN);
  if (metaIndex === -1) {
    return existsSync(path.resolve(projectRoot, normalizedGlob)) ? [normalizedGlob] : ["."];
  }

  const prefix = normalizedGlob.slice(0, metaIndex);
  const slashIndex = prefix.lastIndexOf("/");
  const root = slashIndex >= 0 ? prefix.slice(0, slashIndex) || "." : ".";
  return root !== "." && existsSync(path.resolve(projectRoot, root)) ? [root] : ["."];
}

function buildRipgrepArgs(projectRoot: string, input: LiveTextSearchToolInput): string[] {
  const args = [
    "--json",
    "--line-number",
    "--column",
    "--color=never",
    "--no-messages",
    "--max-columns=1000",
    "--glob",
    "!.git/**",
  ];

  if (input.fixedStrings !== false) {
    args.push("--fixed-strings");
  }
  if (input.caseSensitive !== true) {
    args.push("--ignore-case");
  }
  if (input.includeHidden === true) {
    args.push("--hidden");
  }

  args.push("--", input.query, ...searchRootsForPathGlob(projectRoot, input.pathGlob));
  return args;
}

function resolvePackagedRipgrepPath(): string | null {
  try {
    // Keep this runtime-resolved. The published CLI bundles workspace
    // packages into one ESM file, and statically bundling @vscode/ripgrep's
    // CommonJS entry breaks because it depends on its own __dirname.
    const packageName = "@vscode/" + "ripgrep";
    const ripgrep = requireFromHere(packageName) as { rgPath?: unknown };
    return typeof ripgrep.rgPath === "string" ? ripgrep.rgPath : null;
  } catch {
    return null;
  }
}

function resolveRipgrepExecutable(warnings: string[]): string {
  const packagedPath = resolvePackagedRipgrepPath();
  if (packagedPath && existsSync(packagedPath)) {
    return packagedPath;
  }
  warnings.push("@vscode/ripgrep binary is not installed; falling back to `rg` on PATH.");
  return "rg";
}

function runRipgrepSearch(
  projectRoot: string,
  input: LiveTextSearchToolInput,
): Promise<Pick<LiveTextSearchToolOutput, "matches" | "filesMatched" | "truncated" | "warnings">> {
  const maxMatches = input.maxMatches ?? DEFAULT_MAX_MATCHES;
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
  const warnings: string[] = [];

  return new Promise((resolve, reject) => {
    const child = spawn(resolveRipgrepExecutable(warnings), buildRipgrepArgs(projectRoot, input), {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const matches: LiveTextSearchMatch[] = [];
    const filesMatched = new Set<string>();
    let stdoutRemainder = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      truncated = true;
      warnings.push(`truncated: ripgrep timed out after ${RIPGREP_TIMEOUT_MS}ms.`);
      child.kill();
    }, RIPGREP_TIMEOUT_MS);

    const processLine = (line: string): void => {
      if (line.trim() === "" || truncated) {
        return;
      }
      let parsed: RipgrepMatchEvent;
      try {
        parsed = JSON.parse(line) as RipgrepMatchEvent;
      } catch {
        return;
      }
      const match = parseMatchEvent(projectRoot, parsed);
      if (match == null) {
        return;
      }
      if (input.pathGlob && !matchesPathGlob(match.filePath, input.pathGlob)) {
        return;
      }
      const isNewFile = !filesMatched.has(match.filePath);
      if (isNewFile && filesMatched.size >= maxFiles) {
        truncated = true;
        warnings.push(`truncated: matched files capped at ${maxFiles}. Narrow pathGlob or raise maxFiles.`);
        child.kill();
        return;
      }
      if (matches.length >= maxMatches) {
        truncated = true;
        warnings.push(`truncated: matches capped at ${maxMatches}. Narrow query/pathGlob or raise maxMatches.`);
        child.kill();
        return;
      }
      filesMatched.add(match.filePath);
      matches.push(match);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutRemainder += chunk;
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (stdoutRemainder.trim() !== "" && !truncated) {
        processLine(stdoutRemainder);
      }
      if (code != null && code !== 0 && code !== 1 && !truncated && !timedOut) {
        reject(new Error(`ripgrep failed with exit code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve({
        matches,
        filesMatched: [...filesMatched].sort(),
        truncated,
        warnings,
      });
    });
  });
}

export async function liveTextSearchTool(
  input: LiveTextSearchToolInput,
  options: ToolServiceOptions = {},
): Promise<LiveTextSearchToolOutput> {
  return withProjectContext(input, options, async ({ project }) => {
    const result = await runRipgrepSearch(project.canonicalPath, input);
    return {
      toolName: "live_text_search",
      projectId: project.projectId,
      query: input.query,
      evidenceMode: "live_filesystem",
      ...result,
    };
  });
}
