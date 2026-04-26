import type {
  EvidenceBlock,
  IndexFreshnessDetail,
  IndexFreshnessSummary,
  JsonValue,
} from "@mako-ai/contracts";
import {
  assessFileFreshness,
  summarizeIndexFreshnessDetails,
  summarizeProjectIndexFreshness,
  type AssessFileFreshnessInput,
  type ProjectIndexFreshnessInput,
} from "@mako-ai/indexer";
import type { ProjectStore } from "@mako-ai/store";

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

export function enrichEvidenceFreshness(input: EnrichEvidenceFreshnessInput): EnrichEvidenceFreshnessResult {
  const filesByPath = new Map(input.store.listFiles().map((file) => [file.path, file] as const));
  const detailsByPath = new Map<string, IndexFreshnessDetail>();

  for (const block of input.evidence) {
    if (!block.filePath || detailsByPath.has(block.filePath)) continue;
    detailsByPath.set(
      block.filePath,
      detailForFile(input.projectRoot, block.filePath, filesByPath.get(block.filePath)),
    );
  }

  const evidence = input.evidence.map((block) => {
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
