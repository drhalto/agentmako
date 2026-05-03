import type { JsonObject, JsonValue, ReefCalculationNode } from "@mako-ai/contracts";
import type { ProjectStore, ReefArtifactRecord } from "@mako-ai/store";
import { hashText } from "@mako-ai/store";
import { REEF_QUERY_CALCULATION_EXTRACTOR_VERSION } from "./calculation-nodes.js";

export interface ReefCachedCalculationInput<T> {
  projectStore: ProjectStore;
  projectId: string;
  root: string;
  node: ReefCalculationNode;
  queryKind: string;
  input: JsonObject;
  sourceRevision?: number;
  compute: () => T;
  toJson: (value: T) => JsonValue;
  fromJson: (value: JsonValue) => T | undefined;
}

export interface ReefCachedCalculationResult<T> {
  value: T;
  cache: {
    enabled: boolean;
    hit: boolean;
    artifactId?: string;
    contentHash?: string;
    path?: string;
  };
}

export function runCachedReefCalculation<T>(
  input: ReefCachedCalculationInput<T>,
): ReefCachedCalculationResult<T> {
  if (input.sourceRevision === undefined) {
    return {
      value: input.compute(),
      cache: { enabled: false, hit: false },
    };
  }

  const path = cachePath(input.queryKind, input.input);
  const artifactKind = queryArtifactKind(input.queryKind);
  const cached = readCachedValue(input, { artifactKind, path });
  if (cached) {
    return {
      value: cached.value,
      cache: {
        enabled: true,
        hit: true,
        artifactId: cached.artifact.artifactId,
        contentHash: cached.artifact.contentHash,
        path,
      },
    };
  }

  const value = input.compute();
  const payload = input.toJson(value);
  const contentHash = hashText(stableJson({
    nodeId: input.node.id,
    nodeVersion: input.node.version ?? "",
    sourceRevision: input.sourceRevision,
    input: input.input,
    payload,
  }));
  const artifact = input.projectStore.upsertReefArtifact({
    contentHash,
    artifactKind,
    extractorVersion: REEF_QUERY_CALCULATION_EXTRACTOR_VERSION,
    payload,
    metadata: {
      source: input.node.id,
      nodeVersion: input.node.version ?? "",
      queryKind: input.queryKind,
      sourceRevision: input.sourceRevision,
      inputFingerprint: hashText(stableJson(input.input)),
    },
  });
  input.projectStore.addReefArtifactTag({
    artifactId: artifact.artifactId,
    projectId: input.projectId,
    root: input.root,
    branch: "",
    worktree: "",
    overlay: "indexed",
    path,
    lastVerifiedRevision: input.sourceRevision,
    lastChangedRevision: input.sourceRevision,
  });

  return {
    value,
    cache: {
      enabled: true,
      hit: false,
      artifactId: artifact.artifactId,
      contentHash,
      path,
    },
  };
}

function readCachedValue<T>(
  input: ReefCachedCalculationInput<T>,
  cacheKey: { artifactKind: string; path: string },
): { value: T; artifact: ReefArtifactRecord } | undefined {
  const tag = input.projectStore.queryReefArtifactTags({
    projectId: input.projectId,
    root: input.root,
    branch: "",
    worktree: "",
    overlay: "indexed",
    path: cacheKey.path,
    artifactKind: cacheKey.artifactKind,
    extractorVersion: REEF_QUERY_CALCULATION_EXTRACTOR_VERSION,
    limit: 1,
  })[0];
  if (!tag) {
    return undefined;
  }
  if (tag.lastVerifiedRevision !== input.sourceRevision) {
    return undefined;
  }
  const artifact = input.projectStore.queryReefArtifacts({ artifactId: tag.artifactId, limit: 1 })[0];
  if (!artifact) {
    return undefined;
  }
  if (artifact.metadata?.source !== input.node.id) {
    return undefined;
  }
  if (artifact.metadata?.nodeVersion !== (input.node.version ?? "")) {
    return undefined;
  }
  if (artifact.metadata?.sourceRevision !== input.sourceRevision) {
    return undefined;
  }
  const value = input.fromJson(artifact.payload);
  return value === undefined ? undefined : { value, artifact };
}

function cachePath(queryKind: string, input: JsonObject): string {
  return `query/${queryKind}/${hashText(stableJson(input))}`;
}

function queryArtifactKind(queryKind: string): string {
  return `derived_query:${queryKind}`;
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
