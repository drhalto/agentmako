import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  INDEX_FRESHNESS_MTIME_TOLERANCE_MS,
  type IndexFreshnessDetail,
  type IndexFreshnessSummary,
} from "@mako-ai/contracts";
import {
  normalizePath,
  toRelativePath,
  type FileSummaryRecord,
  type ProjectStore,
} from "@mako-ai/store";
import {
  isIgnoredProjectDirectory,
  isWatchableProjectPath,
  MAX_INDEXED_FILE_SIZE_BYTES,
} from "./project-index-scope.js";

const SUMMARY_SAMPLE_LIMIT = 20;

export interface AssessFileFreshnessInput {
  projectRoot: string;
  filePath: string;
  indexedAt?: string;
  indexedMtime?: string;
  indexedSizeBytes?: number;
}

export interface ProjectIndexFreshnessInput {
  projectRoot: string;
  store: ProjectStore;
  includeUnindexed?: boolean;
}

function toIsoFromMtimeMs(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString();
}

function compareIsoDescending(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function resolveProjectFile(projectRoot: string, filePath: string): { relativePath: string; absolutePath: string } | null {
  const normalizedRoot = normalizePath(projectRoot);
  const absolutePath = path.isAbsolute(filePath)
    ? normalizePath(filePath)
    : normalizePath(path.join(normalizedRoot, filePath));

  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(`${normalizedRoot}/`)) {
    return null;
  }

  const relativePath = toRelativePath(normalizedRoot, absolutePath);
  if (relativePath === "." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    return null;
  }

  return { relativePath, absolutePath };
}

export function assessFileFreshness(input: AssessFileFreshnessInput): IndexFreshnessDetail {
  const resolved = resolveProjectFile(input.projectRoot, input.filePath);
  if (!resolved) {
    return {
      state: "unknown",
      filePath: input.filePath,
      indexedAt: input.indexedAt,
      indexedMtime: input.indexedMtime,
      indexedSizeBytes: input.indexedSizeBytes,
      reason: "file path resolves outside the project root",
    };
  }

  if (!existsSync(resolved.absolutePath)) {
    return {
      state: input.indexedAt || input.indexedMtime ? "deleted" : "unknown",
      filePath: resolved.relativePath,
      indexedAt: input.indexedAt,
      indexedMtime: input.indexedMtime,
      indexedSizeBytes: input.indexedSizeBytes,
      reason: input.indexedAt || input.indexedMtime
        ? "indexed file no longer exists on disk"
        : "file does not exist on disk",
    };
  }

  try {
    const stat = statSync(resolved.absolutePath);
    const liveMtime = toIsoFromMtimeMs(stat.mtimeMs);
    const base = {
      filePath: resolved.relativePath,
      indexedAt: input.indexedAt,
      indexedMtime: input.indexedMtime,
      liveMtime,
      indexedSizeBytes: input.indexedSizeBytes,
      liveSizeBytes: stat.size,
    };

    if (!input.indexedAt && !input.indexedMtime && input.indexedSizeBytes == null) {
      return {
        ...base,
        state: "unindexed",
        reason: "file exists on disk but has no indexed row",
      };
    }

    if (input.indexedSizeBytes != null && input.indexedSizeBytes !== stat.size) {
      return {
        ...base,
        state: "stale",
        reason: "file size differs from indexed metadata",
      };
    }

    if (input.indexedMtime) {
      const indexedMtimeMs = Date.parse(input.indexedMtime);
      if (Number.isFinite(indexedMtimeMs)) {
        const deltaMs = Math.abs(stat.mtimeMs - indexedMtimeMs);
        if (deltaMs > INDEX_FRESHNESS_MTIME_TOLERANCE_MS) {
          return {
            ...base,
            state: "stale",
            reason: `file mtime differs from indexed metadata by ${Math.round(deltaMs)}ms`,
          };
        }
      }
    }

    return {
      ...base,
      state: "fresh",
      reason: "live file metadata matches indexed metadata",
    };
  } catch (error) {
    return {
      state: "unknown",
      filePath: resolved.relativePath,
      indexedAt: input.indexedAt,
      indexedMtime: input.indexedMtime,
      indexedSizeBytes: input.indexedSizeBytes,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function summarizeIndexFreshnessDetails(
  details: IndexFreshnessDetail[],
  checkedAt = new Date().toISOString(),
): IndexFreshnessSummary {
  let freshCount = 0;
  let staleCount = 0;
  let deletedCount = 0;
  let unindexedCount = 0;
  let unknownCount = 0;
  let newestIndexedAt: string | undefined;
  let newestLiveMtime: string | undefined;

  for (const detail of details) {
    switch (detail.state) {
      case "fresh":
        freshCount += 1;
        break;
      case "stale":
        staleCount += 1;
        break;
      case "deleted":
        deletedCount += 1;
        break;
      case "unindexed":
        unindexedCount += 1;
        break;
      case "unknown":
        unknownCount += 1;
        break;
    }
    newestIndexedAt = compareIsoDescending(newestIndexedAt, detail.indexedAt);
    newestLiveMtime = compareIsoDescending(newestLiveMtime, detail.liveMtime);
  }

  const dirtyCount = staleCount + deletedCount + unindexedCount;
  const state = dirtyCount > 0 ? "dirty" : unknownCount > 0 ? "unknown" : "fresh";
  // Show actionable rows first, then include fresh examples when the sample
  // budget has room so callers can still see representative live mtimes.
  const sample = details
    .filter((detail) => detail.state !== "fresh")
    .concat(details.filter((detail) => detail.state === "fresh"))
    .slice(0, SUMMARY_SAMPLE_LIMIT);

  return {
    checkedAt,
    state,
    freshCount,
    staleCount,
    deletedCount,
    unindexedCount,
    unknownCount,
    ...(newestIndexedAt ? { newestIndexedAt } : {}),
    ...(newestLiveMtime ? { newestLiveMtime } : {}),
    sample,
  };
}

function detailForFile(projectRoot: string, filePath: string, file?: FileSummaryRecord): IndexFreshnessDetail {
  return assessFileFreshness({
    projectRoot,
    filePath,
    indexedAt: file?.indexedAt,
    indexedMtime: file?.lastModifiedAt,
    indexedSizeBytes: file?.sizeBytes,
  });
}

function collectIndexableDiskFiles(projectRoot: string): string[] {
  const normalizedRoot = normalizePath(projectRoot);
  const out: string[] = [];

  function walk(currentPath: string): void {
    const entries = readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = toRelativePath(normalizedRoot, absolutePath);
      if (entry.isDirectory()) {
        if (isIgnoredProjectDirectory(entry.name)) continue;
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile() || !isWatchableProjectPath(relativePath)) continue;
      try {
        if (statSync(absolutePath).size > MAX_INDEXED_FILE_SIZE_BYTES) continue;
      } catch {
        continue;
      }
      out.push(relativePath);
    }
  }

  walk(normalizedRoot);
  return out;
}

export function summarizeProjectIndexFreshness(input: ProjectIndexFreshnessInput): IndexFreshnessSummary {
  const files = input.store.listFiles();
  const indexedByPath = new Map(files.map((file) => [file.path, file] as const));
  const details = files.map((file) => detailForFile(input.projectRoot, file.path, file));

  if (input.includeUnindexed) {
    for (const filePath of collectIndexableDiskFiles(input.projectRoot)) {
      if (indexedByPath.has(filePath)) continue;
      details.push(detailForFile(input.projectRoot, filePath));
    }
  }

  return summarizeIndexFreshnessDetails(details);
}
