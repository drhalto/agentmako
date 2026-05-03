import type {
  FactFreshness,
  JsonObject,
  JsonValue,
  ProjectOverlay,
} from "@mako-ai/contracts";
import type {
  CodeInteractionRecord,
  FileImportLink,
  FileSummaryRecord,
  ProjectStore,
  ReefArtifactRecord,
  ResolvedRouteRecord,
  ResolvedSchemaObjectRecord,
  SchemaUsageMatch,
  SymbolRecord,
} from "@mako-ai/store";

export interface ReefIndexedGraphFile {
  path: string;
  language: string;
  sizeBytes: number;
  lineCount: number;
  isGenerated: boolean;
  indexedAt: string;
  lastModifiedAt?: string;
}

export interface ReefIndexedGraphSymbol extends SymbolRecord {
  filePath: string;
}

export interface ReefIndexedGraphImport extends FileImportLink {}

export interface ReefIndexedGraphRoute extends ResolvedRouteRecord {}

export interface ReefIndexedGraphSchemaUsage {
  objectType: ResolvedSchemaObjectRecord["objectType"];
  schemaName: string;
  objectName: string;
  parentObjectName?: string;
  dataType?: string;
  definition?: JsonObject;
  filePath: string;
  usageKind: string;
  line?: number;
  excerpt?: string;
}

export interface ReefIndexedGraphInteraction extends CodeInteractionRecord {}

export interface ReefIndexedGraphEvidence {
  source: "project_index";
  overlay: ProjectOverlay;
  freshness: FactFreshness;
  files: ReefIndexedGraphFile[];
  symbols: ReefIndexedGraphSymbol[];
  imports: ReefIndexedGraphImport[];
  interactions: ReefIndexedGraphInteraction[];
  routes: ReefIndexedGraphRoute[];
  schemaUsages: ReefIndexedGraphSchemaUsage[];
  warnings: string[];
}

export interface CollectFocusedIndexedGraphEvidenceInput {
  projectStore: ProjectStore;
  projectId: string;
  root?: string;
  focusFiles: string[];
  focusDatabaseObjects: string[];
  freshness: FactFreshness;
  maxFocusFiles?: number;
  maxImportsPerFile?: number;
  maxDependentsPerFile?: number;
  maxInteractionsPerFile?: number;
  maxSymbolsPerFile?: number;
  maxRoutesPerFile?: number;
  maxSchemaObjects?: number;
  maxSchemaUsages?: number;
}

const DEFAULT_MAX_FOCUS_FILES = 24;
const DEFAULT_MAX_IMPORTS_PER_FILE = 24;
const DEFAULT_MAX_DEPENDENTS_PER_FILE = 24;
const DEFAULT_MAX_INTERACTIONS_PER_FILE = 80;
const DEFAULT_MAX_SYMBOLS_PER_FILE = 40;
const DEFAULT_MAX_ROUTES_PER_FILE = 12;
const DEFAULT_MAX_SCHEMA_OBJECTS = 500;
const DEFAULT_MAX_SCHEMA_USAGES = 240;
const CODE_INTERACTIONS_ARTIFACT_KIND = "code_interactions";
const CODE_INTERACTIONS_EXTRACTOR_VERSION = "mako-ts-js-structure@1";

export function collectFocusedIndexedGraphEvidence(
  input: CollectFocusedIndexedGraphEvidenceInput,
): ReefIndexedGraphEvidence {
  const maxFocusFiles = input.maxFocusFiles ?? DEFAULT_MAX_FOCUS_FILES;
  const maxImportsPerFile = input.maxImportsPerFile ?? DEFAULT_MAX_IMPORTS_PER_FILE;
  const maxDependentsPerFile = input.maxDependentsPerFile ?? DEFAULT_MAX_DEPENDENTS_PER_FILE;
  const maxInteractionsPerFile = input.maxInteractionsPerFile ?? DEFAULT_MAX_INTERACTIONS_PER_FILE;
  const maxSymbolsPerFile = input.maxSymbolsPerFile ?? DEFAULT_MAX_SYMBOLS_PER_FILE;
  const maxRoutesPerFile = input.maxRoutesPerFile ?? DEFAULT_MAX_ROUTES_PER_FILE;
  const maxSchemaObjects = input.maxSchemaObjects ?? DEFAULT_MAX_SCHEMA_OBJECTS;
  const maxSchemaUsages = input.maxSchemaUsages ?? DEFAULT_MAX_SCHEMA_USAGES;
  const warnings: string[] = [];

  const fileByPath = new Map(input.projectStore.listFiles().map((file) => [file.path, file] as const));
  const focusFiles = unique(input.focusFiles).slice(0, maxFocusFiles);
  const focusFileSet = new Set(focusFiles);
  if (input.focusFiles.length > focusFiles.length) {
    warnings.push(`Focused graph enrichment used the first ${focusFiles.length} focus file(s).`);
  }

  const includedFilePaths = new Set(focusFiles);
  const importsByKey = new Map<string, ReefIndexedGraphImport>();
  const symbols: ReefIndexedGraphSymbol[] = [];
  const routes: ReefIndexedGraphRoute[] = [];

  for (const filePath of focusFiles) {
    const outbound = input.projectStore.listImportsForFile(filePath);
    if (outbound.length > maxImportsPerFile) {
      warnings.push(`Focused graph enrichment capped outbound imports for ${filePath} at ${maxImportsPerFile}.`);
    }
    for (const edge of outbound.slice(0, maxImportsPerFile)) {
      importsByKey.set(importKey(edge), edge);
      includedFilePaths.add(edge.sourcePath);
      includedFilePaths.add(edge.targetPath);
    }

    const inbound = input.projectStore.listDependentsForFile(filePath);
    if (inbound.length > maxDependentsPerFile) {
      warnings.push(`Focused graph enrichment capped inbound dependents for ${filePath} at ${maxDependentsPerFile}.`);
    }
    for (const edge of inbound.slice(0, maxDependentsPerFile)) {
      importsByKey.set(importKey(edge), edge);
      includedFilePaths.add(edge.sourcePath);
      includedFilePaths.add(edge.targetPath);
    }

    collectFileSymbolsAndRoutes({
      projectStore: input.projectStore,
      filePath,
      maxSymbolsPerFile,
      maxRoutesPerFile,
      symbols,
      routes,
      warnings,
    });
  }

  const schemaUsages = collectSchemaUsages({
    projectStore: input.projectStore,
    focusFilePaths: includedFilePaths,
    focusDatabaseObjects: input.focusDatabaseObjects,
    maxSchemaObjects,
    maxSchemaUsages,
    warnings,
  });
  for (const usage of schemaUsages) {
    includedFilePaths.add(usage.filePath);
  }
  for (const filePath of includedFilePaths) {
    if (focusFileSet.has(filePath)) continue;
    collectFileSymbolsAndRoutes({
      projectStore: input.projectStore,
      filePath,
      maxSymbolsPerFile,
      maxRoutesPerFile,
      symbols,
      routes,
      warnings,
    });
  }

  const interactions = collectCodeInteractions({
    projectStore: input.projectStore,
    projectId: input.projectId,
    root: input.root,
    filePaths: includedFilePaths,
    maxInteractionsPerFile,
    warnings,
  });
  for (const interaction of interactions) {
    if (interaction.targetPath) {
      includedFilePaths.add(interaction.targetPath);
    }
  }

  const files = [...includedFilePaths]
    .map((filePath) => fileByPath.get(filePath))
    .filter((file): file is FileSummaryRecord => file != null)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => ({
      path: file.path,
      language: file.language,
      sizeBytes: file.sizeBytes,
      lineCount: file.lineCount,
      isGenerated: file.isGenerated,
      indexedAt: file.indexedAt,
      ...(file.lastModifiedAt ? { lastModifiedAt: file.lastModifiedAt } : {}),
    }));

  return {
    source: "project_index",
    overlay: "indexed",
    freshness: input.freshness,
    files,
    symbols: symbols.sort((left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      (left.lineStart ?? 0) - (right.lineStart ?? 0) ||
      left.name.localeCompare(right.name)
    ),
    imports: [...importsByKey.values()].sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.targetPath.localeCompare(right.targetPath)
    ),
    interactions,
    routes: routes.sort((left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.routeKey.localeCompare(right.routeKey)
    ),
    schemaUsages,
    warnings,
  };
}

function collectFileSymbolsAndRoutes(args: {
  projectStore: ProjectStore;
  filePath: string;
  maxSymbolsPerFile: number;
  maxRoutesPerFile: number;
  symbols: ReefIndexedGraphSymbol[];
  routes: ReefIndexedGraphRoute[];
  warnings: string[];
}): void {
  const fileSymbols = args.projectStore.listSymbolsForFile(args.filePath);
  if (fileSymbols.length > args.maxSymbolsPerFile) {
    args.warnings.push(`Focused graph enrichment capped symbols for ${args.filePath} at ${args.maxSymbolsPerFile}.`);
  }
  args.symbols.push(...fileSymbols.slice(0, args.maxSymbolsPerFile).map((symbol) => ({
    ...symbol,
    filePath: args.filePath,
  })));

  const fileRoutes = args.projectStore.listRoutesForFile(args.filePath);
  if (fileRoutes.length > args.maxRoutesPerFile) {
    args.warnings.push(`Focused graph enrichment capped routes for ${args.filePath} at ${args.maxRoutesPerFile}.`);
  }
  args.routes.push(...fileRoutes.slice(0, args.maxRoutesPerFile));
}

function collectCodeInteractions(args: {
  projectStore: ProjectStore;
  projectId: string;
  root?: string;
  filePaths: Set<string>;
  maxInteractionsPerFile: number;
  warnings: string[];
}): ReefIndexedGraphInteraction[] {
  const interactionsByKey = new Map<string, ReefIndexedGraphInteraction>();
  for (const filePath of [...args.filePaths].sort()) {
    const tags = args.projectStore.queryReefArtifactTags({
      projectId: args.projectId,
      ...(args.root ? { root: args.root } : {}),
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: filePath,
      artifactKind: CODE_INTERACTIONS_ARTIFACT_KIND,
      extractorVersion: CODE_INTERACTIONS_EXTRACTOR_VERSION,
      limit: 2,
    });
    const tag = tags[0];
    if (!tag) {
      continue;
    }
    const artifact = args.projectStore.queryReefArtifacts({ artifactId: tag.artifactId, limit: 1 })[0];
    if (!artifact) {
      args.warnings.push(`Focused graph enrichment found a code interaction tag without an artifact for ${filePath}.`);
      continue;
    }
    const artifactInteractions = codeInteractionsFromArtifact(artifact, filePath);
    if (artifactInteractions.length > args.maxInteractionsPerFile) {
      args.warnings.push(
        `Focused graph enrichment capped code interactions for ${filePath} at ${args.maxInteractionsPerFile}.`,
      );
    }
    for (const interaction of artifactInteractions.slice(0, args.maxInteractionsPerFile)) {
      interactionsByKey.set(interactionKey(interaction), interaction);
    }
  }
  return [...interactionsByKey.values()].sort(compareInteraction);
}

function codeInteractionsFromArtifact(
  artifact: ReefArtifactRecord,
  fallbackSourcePath: string,
): ReefIndexedGraphInteraction[] {
  const payload = artifact.payload;
  if (!isJsonObject(payload)) {
    return [];
  }
  const rawInteractions = payload.interactions;
  if (!Array.isArray(rawInteractions)) {
    return [];
  }
  const interactions: ReefIndexedGraphInteraction[] = [];
  for (const rawInteraction of rawInteractions) {
    const interaction = parseCodeInteraction(rawInteraction, fallbackSourcePath);
    if (interaction) {
      interactions.push(interaction);
    }
  }
  return interactions;
}

function parseCodeInteraction(
  value: JsonValue,
  fallbackSourcePath: string,
): ReefIndexedGraphInteraction | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const kind = value.kind;
  const targetName = value.targetName;
  if ((kind !== "call" && kind !== "render") || typeof targetName !== "string" || targetName.length === 0) {
    return undefined;
  }
  const sourcePath = typeof value.sourcePath === "string" && value.sourcePath.length > 0
    ? value.sourcePath
    : fallbackSourcePath;
  const sourceSymbolName = typeof value.sourceSymbolName === "string" && value.sourceSymbolName.length > 0
    ? value.sourceSymbolName
    : undefined;
  const targetPath = typeof value.targetPath === "string" && value.targetPath.length > 0
    ? value.targetPath
    : undefined;
  const importSpecifier = typeof value.importSpecifier === "string" && value.importSpecifier.length > 0
    ? value.importSpecifier
    : undefined;
  const line = typeof value.line === "number" && Number.isFinite(value.line)
    ? Math.max(1, Math.trunc(value.line))
    : undefined;
  const confidence = typeof value.confidence === "number" && Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : kind === "render"
      ? 0.8
      : 0.75;
  return {
    kind,
    sourcePath,
    ...(sourceSymbolName ? { sourceSymbolName } : {}),
    targetName,
    ...(targetPath ? { targetPath } : {}),
    ...(importSpecifier ? { importSpecifier } : {}),
    ...(line ? { line } : {}),
    confidence,
  };
}

function interactionKey(interaction: ReefIndexedGraphInteraction): string {
  return [
    interaction.kind,
    interaction.sourcePath,
    interaction.sourceSymbolName ?? "",
    interaction.targetPath ?? "",
    interaction.targetName,
    interaction.importSpecifier ?? "",
    interaction.line ?? 0,
  ].join("\0");
}

function compareInteraction(
  left: ReefIndexedGraphInteraction,
  right: ReefIndexedGraphInteraction,
): number {
  return left.sourcePath.localeCompare(right.sourcePath) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.kind.localeCompare(right.kind) ||
    (left.targetPath ?? "").localeCompare(right.targetPath ?? "") ||
    left.targetName.localeCompare(right.targetName);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function collectSchemaUsages(args: {
  projectStore: ProjectStore;
  focusFilePaths: Set<string>;
  focusDatabaseObjects: string[];
  maxSchemaObjects: number;
  maxSchemaUsages: number;
  warnings: string[];
}): ReefIndexedGraphSchemaUsage[] {
  const objectQueries = new Set(args.focusDatabaseObjects.map(normalizeObjectQuery));
  const usages: ReefIndexedGraphSchemaUsage[] = [];
  const objects = args.projectStore.listSchemaObjects();
  if (objects.length > args.maxSchemaObjects) {
    args.warnings.push(
      `Focused graph enrichment scanned the first ${args.maxSchemaObjects} schema object(s); schema usage edges may be incomplete.`,
    );
  }

  for (const object of objects.slice(0, args.maxSchemaObjects)) {
    const objectMatched = matchesObjectQuery(object, objectQueries);
    const objectUsages = args.projectStore.listSchemaUsages(object.objectId);
    for (const usage of objectUsages) {
      if (!objectMatched && !args.focusFilePaths.has(usage.filePath)) {
        continue;
      }
      usages.push(toSchemaUsage(object, usage));
      if (usages.length >= args.maxSchemaUsages) {
        args.warnings.push(`Focused graph enrichment capped schema usage edges at ${args.maxSchemaUsages}.`);
        return usages.sort(compareSchemaUsage);
      }
    }
  }
  return usages.sort(compareSchemaUsage);
}

function toSchemaUsage(
  object: ResolvedSchemaObjectRecord,
  usage: SchemaUsageMatch,
): ReefIndexedGraphSchemaUsage {
  return {
    objectType: object.objectType,
    schemaName: object.schemaName,
    objectName: object.objectName,
    ...(object.parentObjectName ? { parentObjectName: object.parentObjectName } : {}),
    ...(object.dataType ? { dataType: object.dataType } : {}),
    ...(object.definition ? { definition: object.definition } : {}),
    filePath: usage.filePath,
    usageKind: usage.usageKind,
    ...(usage.line ? { line: usage.line } : {}),
    ...(usage.excerpt ? { excerpt: usage.excerpt } : {}),
  };
}

function compareSchemaUsage(
  left: ReefIndexedGraphSchemaUsage,
  right: ReefIndexedGraphSchemaUsage,
): number {
  return left.filePath.localeCompare(right.filePath) ||
    left.schemaName.localeCompare(right.schemaName) ||
    left.objectName.localeCompare(right.objectName) ||
    (left.line ?? 0) - (right.line ?? 0);
}

function matchesObjectQuery(
  object: ResolvedSchemaObjectRecord,
  queries: Set<string>,
): boolean {
  if (queries.size === 0) return false;
  const names = [
    object.objectName,
    `${object.schemaName}.${object.objectName}`,
    `${object.objectType}:${object.schemaName}.${object.objectName}`,
    ...(object.parentObjectName
      ? [
          `${object.parentObjectName}.${object.objectName}`,
          `${object.schemaName}.${object.parentObjectName}.${object.objectName}`,
        ]
      : []),
  ].map(normalizeObjectQuery);
  return names.some((name) => queries.has(name));
}

function importKey(edge: ReefIndexedGraphImport): string {
  return [
    edge.sourcePath,
    edge.targetPath,
    edge.specifier,
    edge.importKind,
    edge.line ?? 0,
  ].join("\0");
}

function normalizeObjectQuery(value: string): string {
  return value.trim().toLowerCase().replace(/^table:|^view:|^rpc:|^function:|^column:/, "");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
