/**
 * Snapshot system for action-tool undo.
 *
 * Layout: `<projectRoot>/.mako/snapshots/<sessionId>/<messageOrdinal>/<files>`.
 *
 *   - One directory per (session, assistant-message) tuple.
 *   - Each file inside mirrors its project-relative path with `/` rewritten
 *     to `__` so the on-disk layout is flat and Windows-friendly.
 *   - Tombstone files (for deletes) are recorded as empty files paired with
 *     a sidecar `.deleted` marker so `applyUndo()` knows to recreate them.
 *
 * Snapshots are gitignored — both the project's own `.gitignore` and (for
 * the worktree's local CI runs) the user's. Phase 3.2 ships manual cleanup
 * via `agentmako session rm <id>`; automatic pruning is explicitly out of
 * scope per the phase doc.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ActionToolError } from "./types.js";

const SNAPSHOT_DIR_NAME = ".mako/snapshots";
const TOMBSTONE_SUFFIX = ".deleted";
const PATH_ENCODE_SEP = "__SLASH__";

function snapshotDir(projectRoot: string, sessionId: string, ordinal: number): string {
  return resolve(projectRoot, SNAPSHOT_DIR_NAME, sessionId, String(ordinal));
}

function encodePath(relativePosix: string): string {
  return relativePosix.replace(/\//g, PATH_ENCODE_SEP);
}

function decodePath(encoded: string): string {
  return encoded.split(PATH_ENCODE_SEP).join("/");
}

export interface SnapshotEntry {
  snapshotId: string;
  /** Absolute path of the snapshot file on disk. */
  snapshotPath: string;
  /** Project-relative path of the file the snapshot represents. */
  relativePath: string;
  /** True when the snapshot represents a "this file did not previously exist" tombstone. */
  tombstone: boolean;
}

export interface SnapshotPlan {
  snapshotId: string;
  entries: SnapshotEntry[];
}

export interface SnapshotInput {
  projectRoot: string;
  sessionId: string;
  messageOrdinal: number;
  /** Files to capture, project-relative. Files that don't exist become tombstones. */
  files: string[];
}

export function captureSnapshot(input: SnapshotInput): SnapshotPlan {
  const dir = snapshotDir(input.projectRoot, input.sessionId, input.messageOrdinal);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new ActionToolError(
      `failed to create snapshot directory \`${dir}\`: ${error instanceof Error ? error.message : String(error)}`,
      "action/snapshot-failed",
    );
  }

  const snapshotId = randomUUID();
  const entries: SnapshotEntry[] = [];

  for (const relativePath of input.files) {
    const sourceAbsolute = resolve(input.projectRoot, relativePath);
    const targetName = encodePath(relativePath);
    const targetAbsolute = join(dir, targetName);
    try {
      if (existsSync(sourceAbsolute) && statSync(sourceAbsolute).isFile()) {
        copyFileSync(sourceAbsolute, targetAbsolute);
        entries.push({
          snapshotId,
          snapshotPath: targetAbsolute,
          relativePath,
          tombstone: false,
        });
      } else {
        // Tombstone: file did not exist; create marker so undo knows to delete.
        writeFileSync(targetAbsolute + TOMBSTONE_SUFFIX, "");
        entries.push({
          snapshotId,
          snapshotPath: targetAbsolute + TOMBSTONE_SUFFIX,
          relativePath,
          tombstone: true,
        });
      }
    } catch (error) {
      throw new ActionToolError(
        `failed to write snapshot for \`${relativePath}\`: ${error instanceof Error ? error.message : String(error)}`,
        "action/snapshot-failed",
      );
    }
  }

  return { snapshotId, entries };
}

export interface UndoResult {
  filesRestored: number;
  filesDeleted: number;
}

/** Restore every file under a session+ordinal snapshot directory. */
export function applyUndo(
  projectRoot: string,
  sessionId: string,
  messageOrdinal: number,
): UndoResult {
  const dir = snapshotDir(projectRoot, sessionId, messageOrdinal);
  if (!existsSync(dir)) {
    throw new ActionToolError(
      `no snapshot found at \`${dir}\``,
      "action/file-not-found",
    );
  }

  let filesRestored = 0;
  let filesDeleted = 0;

  for (const entry of readdirSync(dir)) {
    const sourceAbsolute = join(dir, entry);
    const isTombstone = entry.endsWith(TOMBSTONE_SUFFIX);
    const encoded = isTombstone ? entry.slice(0, -TOMBSTONE_SUFFIX.length) : entry;
    const projectRelative = decodePath(encoded);
    const targetAbsolute = resolve(projectRoot, projectRelative);

    if (isTombstone) {
      // File didn't exist before; ensure it doesn't exist now.
      if (existsSync(targetAbsolute)) {
        rmSync(targetAbsolute);
        filesDeleted += 1;
      }
    } else {
      mkdirSync(dirname(targetAbsolute), { recursive: true });
      copyFileSync(sourceAbsolute, targetAbsolute);
      filesRestored += 1;
    }
  }

  return { filesRestored, filesDeleted };
}

/** Read the bytes of a single snapshot entry — used in tests and undo previews. */
export function readSnapshotBytes(entry: SnapshotEntry): Buffer | null {
  if (entry.tombstone) return null;
  return readFileSync(entry.snapshotPath);
}
