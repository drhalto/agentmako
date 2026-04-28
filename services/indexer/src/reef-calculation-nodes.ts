import type { JsonObject, JsonValue, ReefCalculationNode } from "@mako-ai/contracts";
import { ReefCalculationRegistry } from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import type {
  FileChunkRecord,
  ImportEdgeRecord,
  IndexedFileRecord,
  IndexSnapshot,
  ProjectStore,
  ReefArtifactTagRecord,
  RouteRecord,
  SymbolRecord,
} from "@mako-ai/store";
import { hashText } from "@mako-ai/store";
import { analyzeDeclarationChangedRanges } from "./chunker/index.js";

export const REEF_AST_SYMBOLS_ARTIFACT_KIND = "ast_symbols";
export const REEF_AST_SYMBOLS_EXTRACTOR_VERSION = "mako-ts-js-structure@1";
export const REEF_IMPORT_EDGES_ARTIFACT_KIND = "import_edges";
export const REEF_IMPORT_EDGES_EXTRACTOR_VERSION = "mako-ts-js-structure@1";
export const REEF_ROUTES_ARTIFACT_KIND = "routes";
export const REEF_ROUTES_EXTRACTOR_VERSION = "mako-ts-js-structure@1";

const reefCalculationLogger = createLogger("mako-indexer", { component: "reef-calculation-nodes" });

export const REEF_AST_SYMBOLS_CHANGED_RANGE_KINDS = [
  "function_declaration",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "abstract_class_declaration",
  "variable_declaration",
  "export_statement",
] as const;

export const REEF_IMPORT_EDGES_CHANGED_RANGE_KINDS = [
  "import_statement",
  "export_statement",
] as const;

export const REEF_STRUCTURAL_SYMBOLS_NODE: ReefCalculationNode = {
  id: "reef.indexer.ast_symbols",
  kind: "artifact_writer",
  version: "1.0.0",
  description: "Materializes exported TS/JS symbol facts as content-addressed artifacts.",
  outputs: [{
    kind: "artifact",
    artifactKind: REEF_AST_SYMBOLS_ARTIFACT_KIND,
    extractorVersion: REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
  }],
  dependsOn: [{ kind: "glob", pattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}" }],
  refreshScope: "path_scoped",
  fallback: "drop",
  durability: "low",
  backdating: {
    strategy: "structural_changed_ranges",
    relevantRangeKinds: [...REEF_AST_SYMBOLS_CHANGED_RANGE_KINDS],
    equalityKeys: ["symbols"],
  },
};

export const REEF_IMPORT_EDGES_NODE: ReefCalculationNode = {
  id: "reef.indexer.import_edges",
  kind: "artifact_writer",
  version: "1.0.0",
  description: "Materializes resolved TS/JS import edges as content-addressed artifacts.",
  outputs: [{
    kind: "artifact",
    artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
    extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
  }],
  dependsOn: [
    { kind: "glob", pattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}" },
    { kind: "config", path: "tsconfig.json" },
    { kind: "config", path: "jsconfig.json" },
  ],
  refreshScope: "path_scoped",
  fallback: "full_refresh",
  durability: "low",
  backdating: {
    strategy: "structural_changed_ranges",
    relevantRangeKinds: [...REEF_IMPORT_EDGES_CHANGED_RANGE_KINDS],
    equalityKeys: ["imports"],
  },
};

export const REEF_ROUTES_NODE: ReefCalculationNode = {
  id: "reef.indexer.routes",
  kind: "artifact_writer",
  version: "1.0.0",
  description: "Materializes discovered route facts as content-addressed artifacts.",
  outputs: [{
    kind: "artifact",
    artifactKind: REEF_ROUTES_ARTIFACT_KIND,
    extractorVersion: REEF_ROUTES_EXTRACTOR_VERSION,
  }],
  dependsOn: [{ kind: "glob", pattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}" }],
  refreshScope: "path_scoped",
  fallback: "full_refresh",
  durability: "low",
  backdating: {
    strategy: "output_fingerprint",
    equalityKeys: ["routes"],
  },
};

export const REEF_INDEXER_CALCULATION_NODES = [
  REEF_STRUCTURAL_SYMBOLS_NODE,
  REEF_IMPORT_EDGES_NODE,
  REEF_ROUTES_NODE,
] as const;

export interface ReefStructuralArtifactProducerResult {
  nodeId: string;
  artifactKind: string;
  extractorVersion: string;
  payloadKey: string;
  scannedFileCount: number;
  materializedArtifactCount: number;
  backdatedArtifactCount: number;
  changedRangeBackdatedCount: number;
  outputFingerprintBackdatedCount: number;
  removedTagCount: number;
  prunedArtifactCount: number;
}

export interface ReefStructuralArtifactMaterializationResult {
  producerResults: ReefStructuralArtifactProducerResult[];
  scannedFileCount: number;
  materializedArtifactCount: number;
  backdatedArtifactCount: number;
  changedRangeBackdatedCount: number;
  outputFingerprintBackdatedCount: number;
  removedTagCount: number;
  prunedArtifactCount: number;
}

interface ReefPriorStructuralArtifact {
  tag: ReefArtifactTagRecord;
  outputFingerprint?: string;
  inputContentHash?: string;
}

interface ReefStructuralArtifactProducer {
  node: ReefCalculationNode;
  artifactKind: string;
  extractorVersion: string;
  payloadKey: string;
  changedRangeKinds?: readonly string[];
  selectPayload: (file: IndexedFileRecord) => JsonObject[];
  selectEqualityPayload: (file: IndexedFileRecord) => JsonObject[];
}

const STRUCTURAL_ARTIFACT_PRODUCERS: readonly ReefStructuralArtifactProducer[] = [
  {
    node: REEF_STRUCTURAL_SYMBOLS_NODE,
    artifactKind: REEF_AST_SYMBOLS_ARTIFACT_KIND,
    extractorVersion: REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
    payloadKey: "symbols",
    changedRangeKinds: REEF_AST_SYMBOLS_CHANGED_RANGE_KINDS,
    selectPayload: (file) => stableSymbols(file.symbols, { includeLocations: true }),
    selectEqualityPayload: (file) => stableSymbols(file.symbols, { includeLocations: false }),
  },
  {
    node: REEF_IMPORT_EDGES_NODE,
    artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
    extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
    payloadKey: "imports",
    changedRangeKinds: REEF_IMPORT_EDGES_CHANGED_RANGE_KINDS,
    selectPayload: (file) => stableImportEdges(file.imports, { includeLocations: true }),
    selectEqualityPayload: (file) => stableImportEdges(file.imports, { includeLocations: false }),
  },
  {
    node: REEF_ROUTES_NODE,
    artifactKind: REEF_ROUTES_ARTIFACT_KIND,
    extractorVersion: REEF_ROUTES_EXTRACTOR_VERSION,
    payloadKey: "routes",
    selectPayload: (file) => stableRoutes(file.routes, { includeLocations: true }),
    selectEqualityPayload: (file) => stableRoutes(file.routes, { includeLocations: false }),
  },
];

export function createReefIndexerCalculationRegistry(): ReefCalculationRegistry {
  return new ReefCalculationRegistry([...REEF_INDEXER_CALCULATION_NODES]);
}

export async function materializeReefIndexerStructuralArtifacts(
  projectStore: ProjectStore,
  input: {
    projectId: string;
    root: string;
    snapshot: IndexSnapshot;
    fullRefresh?: boolean;
    paths?: readonly string[];
    deletedPaths?: readonly string[];
    priorFileContents?: ReadonlyMap<string, string>;
    revision?: number;
  },
): Promise<ReefStructuralArtifactMaterializationResult> {
  const registry = createReefIndexerCalculationRegistry();
  const producerResults: ReefStructuralArtifactProducerResult[] = [];
  for (const producer of STRUCTURAL_ARTIFACT_PRODUCERS) {
    producerResults.push(await materializeReefStructuralArtifactProducer(projectStore, input, registry, producer));
  }

  const result = {
    producerResults,
    scannedFileCount: input.snapshot.files.length,
    materializedArtifactCount: sumProducerResults(producerResults, "materializedArtifactCount"),
    backdatedArtifactCount: sumProducerResults(producerResults, "backdatedArtifactCount"),
    changedRangeBackdatedCount: sumProducerResults(producerResults, "changedRangeBackdatedCount"),
    outputFingerprintBackdatedCount: sumProducerResults(producerResults, "outputFingerprintBackdatedCount"),
    removedTagCount: sumProducerResults(producerResults, "removedTagCount"),
    prunedArtifactCount: sumProducerResults(producerResults, "prunedArtifactCount"),
  };
  warnOnPrunedArtifactSpike(input, result);
  return result;
}

export async function materializeReefStructuralSymbolArtifacts(
  projectStore: ProjectStore,
  input: Parameters<typeof materializeReefIndexerStructuralArtifacts>[1],
): Promise<ReefStructuralArtifactMaterializationResult> {
  return materializeReefIndexerStructuralArtifacts(projectStore, input);
}

async function materializeReefStructuralArtifactProducer(
  projectStore: ProjectStore,
  input: Parameters<typeof materializeReefIndexerStructuralArtifacts>[1],
  registry: ReefCalculationRegistry,
  producer: ReefStructuralArtifactProducer,
): Promise<ReefStructuralArtifactProducerResult> {
  const node = registry.findProducer({
    kind: "artifact",
    artifactKind: producer.artifactKind,
    extractorVersion: producer.extractorVersion,
  });
  if (!node) {
    throw new Error(`Reef structural calculation node is not registered: ${producer.node.id}`);
  }

  const priorArtifactsByPath = priorStructuralArtifactsByPath(
    projectStore,
    input.projectId,
    input.root,
    producer,
  );
  const scannedPaths = new Set(input.snapshot.files.map((file) => file.path));
  let removedTagCount = 0;
  let prunedArtifactCount = 0;
  const removeTagsForPath = (path: string): void => {
    const result = projectStore.removeReefArtifactTags({
      projectId: input.projectId,
      root: input.root,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path,
      artifactKind: producer.artifactKind,
      extractorVersion: producer.extractorVersion,
      pruneArtifacts: true,
    });
    removedTagCount += result.removedTagCount;
    prunedArtifactCount += result.prunedArtifactCount;
  };

  if (input.fullRefresh) {
    for (const [path, priorArtifact] of priorArtifactsByPath) {
      if (!scannedPaths.has(path)) {
        removeTagsForPath(priorArtifact.tag.path);
      }
    }
  } else {
    for (const path of input.deletedPaths ?? []) {
      removeTagsForPath(path);
    }
  }

  let materializedArtifactCount = 0;
  let backdatedArtifactCount = 0;
  let changedRangeBackdatedCount = 0;
  let outputFingerprintBackdatedCount = 0;
  for (const file of input.snapshot.files) {
    const payload = producer.selectPayload(file);
    const equalityPayload = producer.selectEqualityPayload(file);
    const outputFingerprint = structuralOutputFingerprint(equalityPayload);
    const priorArtifact = priorArtifactsByPath.get(file.path);
    if (priorArtifact?.outputFingerprint === outputFingerprint) {
      if (priorArtifact.inputContentHash !== file.sha256) {
        backdatedArtifactCount += 1;
        const changedRangesProveBackdating = producer.changedRangeKinds
          ? await canBackdateFromChangedRanges(
            file.path,
            input.priorFileContents?.get(file.path),
            file.chunks,
            producer.changedRangeKinds,
          )
          : false;
        if (changedRangesProveBackdating) {
          changedRangeBackdatedCount += 1;
        } else {
          outputFingerprintBackdatedCount += 1;
        }
      }
      const artifact = projectStore.upsertReefArtifact({
        contentHash: outputFingerprint,
        artifactKind: producer.artifactKind,
        extractorVersion: producer.extractorVersion,
        payload: {
          schemaVersion: 1,
          [producer.payloadKey]: payload,
        },
        metadata: {
          source: node.id,
          nodeVersion: node.version ?? "",
          backdatingStrategy: node.backdating.strategy,
          outputFingerprint,
          inputContentHash: file.sha256,
        },
      });
      projectStore.addReefArtifactTag({
        artifactId: artifact.artifactId,
        projectId: input.projectId,
        root: input.root,
        overlay: "indexed",
        path: file.path,
        ...artifactTagRevisionFields(input.revision, priorArtifact.tag.lastChangedRevision),
      });
      continue;
    }

    if (priorArtifact) {
      removeTagsForPath(file.path);
    }

    if (payload.length === 0) {
      continue;
    }
    const artifact = projectStore.upsertReefArtifact({
      contentHash: outputFingerprint,
      artifactKind: producer.artifactKind,
      extractorVersion: producer.extractorVersion,
      payload: {
        schemaVersion: 1,
        [producer.payloadKey]: payload,
      },
      metadata: {
        source: node.id,
        nodeVersion: node.version ?? "",
        backdatingStrategy: node.backdating.strategy,
        outputFingerprint,
        inputContentHash: file.sha256,
      },
    });
    projectStore.addReefArtifactTag({
      artifactId: artifact.artifactId,
      projectId: input.projectId,
      root: input.root,
      overlay: "indexed",
      path: file.path,
      ...artifactTagRevisionFields(input.revision),
    });
    materializedArtifactCount += 1;
  }

  return {
    nodeId: node.id,
    artifactKind: producer.artifactKind,
    extractorVersion: producer.extractorVersion,
    payloadKey: producer.payloadKey,
    scannedFileCount: input.snapshot.files.length,
    materializedArtifactCount,
    backdatedArtifactCount,
    changedRangeBackdatedCount,
    outputFingerprintBackdatedCount,
    removedTagCount,
    prunedArtifactCount,
  };
}

function artifactTagRevisionFields(
  revision: number | undefined,
  lastChangedRevision?: number,
): { lastVerifiedRevision?: number; lastChangedRevision?: number } {
  if (revision === undefined) {
    return {};
  }
  return {
    lastVerifiedRevision: revision,
    lastChangedRevision: lastChangedRevision ?? revision,
  };
}

function warnOnPrunedArtifactSpike(
  input: Parameters<typeof materializeReefIndexerStructuralArtifacts>[1],
  result: ReefStructuralArtifactMaterializationResult,
): void {
  if (!input.fullRefresh || result.prunedArtifactCount === 0) {
    return;
  }
  const warningThreshold = Math.max(20, Math.ceil(result.scannedFileCount * 0.5));
  if (result.prunedArtifactCount <= warningThreshold) {
    return;
  }
  reefCalculationLogger.warn("structural-artifact-prune-spike", {
    root: input.root,
    scannedFileCount: result.scannedFileCount,
    prunedArtifactCount: result.prunedArtifactCount,
    removedTagCount: result.removedTagCount,
  });
}

async function canBackdateFromChangedRanges(
  filePath: string,
  priorContent: string | undefined,
  chunks: readonly FileChunkRecord[],
  relevantRangeKinds: readonly string[],
): Promise<boolean> {
  const currentContent = fileContentFromChunks(chunks);
  if (!priorContent || !currentContent) {
    return false;
  }
  const analysis = await analyzeDeclarationChangedRanges({
    path: filePath,
    priorContent,
    currentContent,
    relevantRangeKinds,
  });
  return analysis.available && !analysis.intersectsRelevantRange;
}

function fileContentFromChunks(chunks: readonly FileChunkRecord[]): string | undefined {
  return chunks.find((chunk) => chunk.chunkKind === "file")?.content;
}

function priorStructuralArtifactsByPath(
  projectStore: ProjectStore,
  projectId: string,
  root: string,
  producer: ReefStructuralArtifactProducer,
): Map<string, ReefPriorStructuralArtifact> {
  const artifactsByPath = new Map<string, ReefPriorStructuralArtifact>();
  const tags = projectStore.queryReefArtifactTags({
    projectId,
    root,
    branch: "",
    worktree: "",
    overlay: "indexed",
    artifactKind: producer.artifactKind,
    extractorVersion: producer.extractorVersion,
    limit: 100_000,
  });
  for (const tag of tags) {
    const artifact = projectStore.queryReefArtifacts({ artifactId: tag.artifactId, limit: 1 })[0];
    artifactsByPath.set(tag.path, {
      tag,
      ...(artifact ? { outputFingerprint: artifactOutputFingerprint(artifact, producer.payloadKey) } : {}),
      ...(artifact ? { inputContentHash: artifactInputContentHash(artifact) } : {}),
    });
  }
  return artifactsByPath;
}

function artifactOutputFingerprint(
  artifact: { contentHash: string; payload: JsonValue; metadata?: JsonObject },
  payloadKey: string,
): string | undefined {
  const metadataFingerprint = artifact.metadata?.outputFingerprint;
  if (typeof metadataFingerprint === "string" && metadataFingerprint.length > 0) {
    return metadataFingerprint;
  }
  if (artifact.contentHash.length > 0) {
    return artifact.contentHash;
  }
  const payload = artifact.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const records = (payload as Record<string, unknown>)[payloadKey];
  return Array.isArray(records)
    ? hashText(stableJson(records))
    : undefined;
}

function artifactInputContentHash(artifact: { metadata?: JsonObject }): string | undefined {
  const value = artifact.metadata?.inputContentHash;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function structuralOutputFingerprint(records: readonly JsonObject[]): string {
  return hashText(stableJson(records));
}

function stableSymbols(
  symbols: readonly SymbolRecord[],
  options: { includeLocations: boolean },
): JsonObject[] {
  return symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    ...(symbol.exportName ? { exportName: symbol.exportName } : {}),
    ...(options.includeLocations && symbol.lineStart != null ? { lineStart: symbol.lineStart } : {}),
    ...(options.includeLocations && symbol.lineEnd != null ? { lineEnd: symbol.lineEnd } : {}),
    ...(symbol.signatureText ? { signatureText: symbol.signatureText } : {}),
    ...(symbol.metadata ? { metadata: symbol.metadata } : {}),
  }));
}

function stableImportEdges(
  imports: readonly ImportEdgeRecord[],
  options: { includeLocations: boolean },
): JsonObject[] {
  return imports.map((importEdge) => ({
    targetPath: importEdge.targetPath,
    specifier: importEdge.specifier,
    importKind: importEdge.importKind,
    isTypeOnly: importEdge.isTypeOnly === true,
    ...(options.includeLocations && importEdge.line != null ? { line: importEdge.line } : {}),
  }));
}

function stableRoutes(
  routes: readonly RouteRecord[],
  options: { includeLocations: boolean },
): JsonObject[] {
  return routes.map((route) => ({
    routeKey: route.routeKey,
    framework: route.framework,
    pattern: route.pattern,
    ...(route.method ? { method: route.method } : {}),
    ...(route.handlerName ? { handlerName: route.handlerName } : {}),
    isApi: route.isApi === true,
    ...(route.metadata ? { metadata: stableRouteMetadata(route.metadata, options) } : {}),
  }));
}

function stableRouteMetadata(
  metadata: JsonObject,
  options: { includeLocations: boolean },
): JsonObject {
  if (options.includeLocations) {
    return metadata;
  }
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "definitionLine") {
      continue;
    }
    out[key] = value;
  }
  return out;
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

function sumProducerResults(
  producerResults: readonly ReefStructuralArtifactProducerResult[],
  key: keyof Pick<
    ReefStructuralArtifactProducerResult,
    | "materializedArtifactCount"
    | "backdatedArtifactCount"
    | "changedRangeBackdatedCount"
    | "outputFingerprintBackdatedCount"
    | "removedTagCount"
    | "prunedArtifactCount"
  >,
): number {
  return producerResults.reduce((sum, result) => sum + result[key], 0);
}
