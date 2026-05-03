import type {
  EvidenceBlock,
  IndexFreshnessDetail,
  IndexFreshnessSummary,
  JsonValue,
  ReefFreshnessPolicy,
} from "@mako-ai/contracts";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  assessFileFreshness,
  summarizeIndexFreshnessDetails,
  summarizeProjectIndexFreshness,
  type AssessFileFreshnessInput,
  type ProjectIndexFreshnessInput,
} from "@mako-ai/indexer";
import { normalizePath, toRelativePath, type ProjectStore } from "@mako-ai/store";

export {
  assessFileFreshness,
  summarizeProjectIndexFreshness,
  type AssessFileFreshnessInput,
  type ProjectIndexFreshnessInput,
};

export interface EnrichEvidenceFreshnessInput {
  projectRoot: string;
  store: ProjectStore;
  evidence: EvidenceBlock[];
}

export interface EnrichEvidenceFreshnessResult {
  evidence: EvidenceBlock[];
  summary: IndexFreshnessSummary;
  stalenessFlags: string[];
}

export interface ReefFileEvidenceInput {
  projectRoot: string;
  filePath: string;
  indexedAt?: string;
  indexedMtime?: string;
  indexedSizeBytes?: number;
  freshnessPolicy: ReefFreshnessPolicy;
  lineStart?: number;
  lineEnd?: number;
}

export interface ReefFileEvidenceDecision {
  action: "return" | "drop" | "label";
  freshness: IndexFreshnessDetail;
  reason: string;
  impossibleLineRange?: boolean;
}

export type ReefLiveLineCountInput = Omit<ReefFileEvidenceInput, "lineStart" | "lineEnd">;

export interface ReefLiveLineCountDecision extends ReefFileEvidenceDecision {
  lineCount?: number;
}

function isLiveFilesystemEvidence(block: EvidenceBlock): boolean {
  return block.metadata?.evidenceMode === "live_filesystem";
}

function detailForFile(
  projectRoot: string,
  filePath: string,
  file?: ReturnType<ProjectStore["listFiles"]>[number],
): IndexFreshnessDetail {
  return assessFileFreshness({
    projectRoot,
    filePath,
    indexedAt: file?.indexedAt,
    indexedMtime: file?.lastModifiedAt,
    indexedSizeBytes: file?.sizeBytes,
  });
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

function countLiveLinesWithStableMetadata(
  projectRoot: string,
  filePath: string,
  freshness: IndexFreshnessDetail,
): { lineCount?: number; freshness?: IndexFreshnessDetail } {
  const resolved = resolveProjectFile(projectRoot, filePath);
  if (!resolved) {
    return {
      freshness: {
        ...freshness,
        state: "unknown",
        filePath,
        reason: "file path resolves outside the project root",
      },
    };
  }

  try {
    const before = statSync(resolved.absolutePath);
    const content = readFileSync(resolved.absolutePath, "utf8");
    const after = statSync(resolved.absolutePath);

    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      return {
        freshness: {
          ...freshness,
          state: "unknown",
          filePath: resolved.relativePath,
          liveMtime: after.mtime.toISOString(),
          liveSizeBytes: after.size,
          reason: "file metadata changed while validating live line count",
        },
      };
    }

    return {
      lineCount: content === "" ? 0 : content.split("\n").length,
    };
  } catch (error) {
    return {
      freshness: {
        ...freshness,
        state: "unknown",
        filePath: resolved.relativePath,
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function assessReefFileEvidence(input: ReefFileEvidenceInput): ReefFileEvidenceDecision {
  const freshness = assessFileFreshness({
    projectRoot: input.projectRoot,
    filePath: input.filePath,
    indexedAt: input.indexedAt,
    indexedMtime: input.indexedMtime,
    indexedSizeBytes: input.indexedSizeBytes,
  });

  if (freshness.state !== "fresh") {
    if (input.freshnessPolicy === "allow_stale_labeled") {
      return {
        action: "label",
        freshness,
        reason: freshness.reason,
      };
    }

    return {
      action: "drop",
      freshness,
      reason: freshness.reason,
    };
  }

  if (input.lineEnd != null) {
    const liveLines = countLiveLinesWithStableMetadata(input.projectRoot, input.filePath, freshness);
    if (liveLines.freshness) {
      return {
        action: "drop",
        freshness: liveLines.freshness,
        reason: liveLines.freshness.reason,
      };
    }

    const liveLineCount = liveLines.lineCount ?? 0;
    if ((input.lineStart != null && input.lineStart > liveLineCount) || input.lineEnd > liveLineCount) {
      const impossibleFreshness: IndexFreshnessDetail = {
        ...freshness,
        state: "stale",
        reason: `line range ${input.lineStart}-${input.lineEnd} exceeds live file line count ${liveLineCount}`,
      };
      return {
        action: input.freshnessPolicy === "allow_stale_labeled" ? "label" : "drop",
        freshness: impossibleFreshness,
        reason: impossibleFreshness.reason,
        impossibleLineRange: true,
      };
    }
  }

  return {
    action: "return",
    freshness,
    reason: freshness.reason,
  };
}

export function assessReefLiveLineCount(input: ReefLiveLineCountInput): ReefLiveLineCountDecision {
  const decision = assessReefFileEvidence(input);
  if (decision.action !== "return") {
    return decision;
  }

  const liveLines = countLiveLinesWithStableMetadata(input.projectRoot, input.filePath, decision.freshness);
  if (liveLines.freshness) {
    return {
      action: "drop",
      freshness: liveLines.freshness,
      reason: liveLines.freshness.reason,
    };
  }

  return {
    ...decision,
    lineCount: liveLines.lineCount ?? 0,
  };
}

export function enrichEvidenceFreshness(input: EnrichEvidenceFreshnessInput): EnrichEvidenceFreshnessResult {
  const filesByPath = new Map(input.store.listFiles().map((file) => [file.path, file] as const));
  const detailsByPath = new Map<string, IndexFreshnessDetail>();

  for (const block of input.evidence) {
    if (isLiveFilesystemEvidence(block)) continue;
    if (!block.filePath || detailsByPath.has(block.filePath)) continue;
    detailsByPath.set(
      block.filePath,
      detailForFile(input.projectRoot, block.filePath, filesByPath.get(block.filePath)),
    );
  }

  const evidence = input.evidence.map((block) => {
    if (isLiveFilesystemEvidence(block)) return block;
    if (!block.filePath) return block;
    const freshness = detailsByPath.get(block.filePath);
    if (!freshness) return block;
    const isStale = freshness.state !== "fresh";
    return {
      ...block,
      ...(isStale ? { stale: true as const } : {}),
      freshness,
      metadata: {
        ...(block.metadata ?? {}),
        indexFreshnessState: freshness.state as JsonValue,
        indexFreshnessReason: freshness.reason,
      },
    };
  });

  const summary = summarizeIndexFreshnessDetails([...detailsByPath.values()]);
  const stalenessFlags: string[] = [];
  if (summary.staleCount > 0) stalenessFlags.push(`index-stale:${summary.staleCount}`);
  if (summary.deletedCount > 0) stalenessFlags.push(`index-deleted:${summary.deletedCount}`);
  if (summary.unindexedCount > 0) stalenessFlags.push(`index-unindexed:${summary.unindexedCount}`);
  if (summary.unknownCount > 0) stalenessFlags.push(`index-freshness-unknown:${summary.unknownCount}`);

  return {
    evidence,
    summary,
    stalenessFlags,
  };
}
