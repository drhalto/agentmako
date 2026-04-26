/**
 * Project-root path guard.
 *
 * Every action tool that touches the filesystem MUST resolve its input
 * through `assertInsideProject()`. This catches both relative `..` traversal
 * and absolute paths pointing outside the active project root.
 *
 * Default-deny patterns (`.env*`, `~/.ssh/*`, anything outside `projectRoot`)
 * are enforced here as a defense-in-depth check independent of the
 * permission evaluator. Even if a user mis-writes a permission rule that
 * matches `**`, this guard still blocks egress.
 */

import { realpathSync } from "node:fs";
import { resolve, relative, isAbsolute, basename } from "node:path";
import { ActionToolError } from "./types.js";

const DEFAULT_DENY_BASENAMES = [
  /^\.env(\.|$)/i, // .env, .env.local, .env.production, etc.
  /^id_rsa(\.|$)/i,
  /^id_ed25519(\.|$)/i,
  /^id_ecdsa(\.|$)/i,
];

const DEFAULT_DENY_DIR_SEGMENTS = new Set([".ssh", ".aws", ".gnupg", ".docker"]);

export interface PathGuardOptions {
  /** Allow writing to files matched by `DEFAULT_DENY_BASENAMES` (test-only escape hatch). */
  bypassDefaultDeny?: boolean;
}

export interface ValidatedPath {
  /** Absolute, normalized path inside the project root. */
  absolute: string;
  /** Path relative to the project root, with forward slashes. */
  relativePosix: string;
}

function realpathSafe(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // Path may not exist yet (e.g., file_write to a new file). Return as-is;
    // the absolute resolution above already normalized `..`/`.` segments.
    return path;
  }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

export function assertInsideProject(
  projectRoot: string,
  inputPath: string,
  options: PathGuardOptions = {},
): ValidatedPath {
  const absoluteRoot = realpathSafe(resolve(projectRoot));
  const candidate = isAbsolute(inputPath) ? inputPath : resolve(projectRoot, inputPath);
  const absolute = realpathSafe(resolve(candidate));

  const rel = relative(absoluteRoot, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new ActionToolError(
      `path \`${inputPath}\` resolves outside the active project root`,
      "action/path-outside-project",
    );
  }

  if (!options.bypassDefaultDeny) {
    const segments = toPosix(rel).split("/").filter(Boolean);
    for (const seg of segments) {
      if (DEFAULT_DENY_DIR_SEGMENTS.has(seg)) {
        throw new ActionToolError(
          `path \`${inputPath}\` traverses denied directory \`${seg}\``,
          "action/path-outside-project",
        );
      }
    }
    const base = basename(absolute);
    if (DEFAULT_DENY_BASENAMES.some((re) => re.test(base))) {
      throw new ActionToolError(
        `file \`${base}\` is denied by default (use a project permission rule to opt in)`,
        "action/path-outside-project",
      );
    }
  }

  return {
    absolute,
    relativePosix: toPosix(rel),
  };
}
