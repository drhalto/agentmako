import { statSync, type Stats } from "node:fs";
import path from "node:path";
import type {
  IndexedFileRecord,
  IndexSnapshot,
  ProjectScanStats,
  RouteRecord,
  SchemaObjectRecord,
  SchemaUsageRecord,
} from "@mako-ai/store";
import { hashText, looksGeneratedFile, toRelativePath } from "@mako-ai/store";
import type { ProjectProfile } from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import pLimit from "p-limit";

const scanLogger = createLogger("mako-indexer", { component: "file-scan" });
import { buildChunks } from "./chunker/index.js";
import { collectProjectFilePaths, readTextFile } from "./fs-utils.js";
import { isIndexableProjectPath, MAX_INDEXED_FILE_SIZE_BYTES } from "./project-index-scope.js";
import { collectSchemaUsages, extractSchemaObjectsFromSql } from "./schema-scan.js";
import {
  buildNamedRouteDefinitionIndex,
  collectCodeInteractionsFromAst,
  collectExportedSymbolsFromAst,
  collectImportEdgesFromAst,
  collectRoutesFromAst,
  type CollectedRoute,
} from "./ts-js-structure.js";

const MAX_CHUNK_CONTENT_LENGTH = 20_000;
const CHUNK_BUILD_CONCURRENCY = 8;

interface ScannableFile {
  relativePath: string;
  stat: Stats;
  content: string;
}

export interface ScanProjectPathsOptions {
  knownRelativePaths?: Set<string>;
  schemaObjects?: SchemaObjectRecord[];
}

function detectLanguage(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();

  switch (ext) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
      return "javascript";
    case ".jsx":
      return "jsx";
    case ".mjs":
      return "esm";
    case ".cjs":
      return "commonjs";
    case ".sql":
      return "sql";
    case ".json":
      return "json";
    case ".md":
      return "markdown";
    case ".css":
      return "css";
    case ".yml":
    case ".yaml":
      return "yaml";
    default:
      return ext.replace(/^\./, "") || "text";
  }
}

function selectRoutesByFile(collectedRoutes: CollectedRoute[]): Map<string, RouteRecord[]> {
  const routesByKey = new Map<string, CollectedRoute>();

  for (const collectedRoute of collectedRoutes) {
    const existing = routesByKey.get(collectedRoute.route.routeKey);

    if (!existing || collectedRoute.priority > existing.priority) {
      routesByKey.set(collectedRoute.route.routeKey, collectedRoute);
    }
  }

  const routesByFile = new Map<string, RouteRecord[]>();

  for (const collectedRoute of routesByKey.values()) {
    const routes = routesByFile.get(collectedRoute.filePath) ?? [];
    routes.push(collectedRoute.route);
    routesByFile.set(collectedRoute.filePath, routes);
  }

  for (const routes of routesByFile.values()) {
    routes.sort((left, right) => {
      if (left.pattern !== right.pattern) {
        return left.pattern.localeCompare(right.pattern);
      }

      return (left.method ?? "ANY").localeCompare(right.method ?? "ANY");
    });
  }

  return routesByFile;
}

export async function scanProject(rootPath: string, profile: ProjectProfile): Promise<{
  snapshot: IndexSnapshot;
  stats: ProjectScanStats;
}> {
  const startedAt = Date.now();
  scanLogger.info("scan.start", { rootPath });
  try {
    const result = await runScanProject(rootPath, profile);
    scanLogger.info("scan.complete", {
      rootPath,
      files: result.stats.files,
      chunks: result.stats.chunks,
      symbols: result.stats.symbols,
      importEdges: result.stats.importEdges,
      codeInteractions: result.stats.codeInteractions,
      routes: result.stats.routes,
      schemaObjects: result.stats.schemaObjects,
      schemaUsages: result.stats.schemaUsages,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    scanLogger.error("scan.fail", {
      rootPath,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

async function runScanProject(rootPath: string, profile: ProjectProfile): Promise<{
  snapshot: IndexSnapshot;
  stats: ProjectScanStats;
}> {
  const absolutePaths = collectProjectFilePaths(rootPath, (_absolutePath, relativePath) => isIndexableProjectPath(relativePath));
  const scannableFiles: ScannableFile[] = [];
  const schemaObjects: SchemaObjectRecord[] = [];

  for (const absolutePath of absolutePaths) {
    const relativePath = toRelativePath(rootPath, absolutePath);
    let stat: Stats;
    try {
      stat = statSync(absolutePath);
    } catch {
      continue;
    }

    if (stat.size > MAX_INDEXED_FILE_SIZE_BYTES) {
      continue;
    }

    const content = readTextFile(absolutePath);
    if (content == null) {
      continue;
    }

    scannableFiles.push({
      relativePath,
      stat,
      content,
    });

    if (detectLanguage(relativePath) === "sql") {
      schemaObjects.push(...await extractSchemaObjectsFromSql(relativePath, content));
    }
  }

  return scanScannableFiles({
    rootPath,
    profile,
    scannableFiles,
    knownRelativePaths: new Set(scannableFiles.map((file) => file.relativePath)),
    schemaObjects,
    schemaObjectsIndexed: schemaObjects.length,
  });
}

export async function scanProjectPaths(
  rootPath: string,
  profile: ProjectProfile,
  relativePaths: readonly string[],
  options: ScanProjectPathsOptions = {},
): Promise<{
  snapshot: IndexSnapshot;
  stats: ProjectScanStats;
}> {
  const scannableFiles: ScannableFile[] = [];
  const seen = new Set<string>();

  for (const inputPath of relativePaths) {
    const relativePath = inputPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (seen.has(relativePath) || !isIndexableProjectPath(relativePath)) {
      continue;
    }
    seen.add(relativePath);
    const absolutePath = path.resolve(rootPath, relativePath);
    const resolvedRelativePath = toRelativePath(rootPath, absolutePath);
    if (resolvedRelativePath === "." || resolvedRelativePath.startsWith("../") || path.isAbsolute(resolvedRelativePath)) {
      continue;
    }

    let stat: Stats;
    try {
      stat = statSync(absolutePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_INDEXED_FILE_SIZE_BYTES) {
      continue;
    }

    const content = readTextFile(absolutePath);
    if (content == null) {
      continue;
    }

    scannableFiles.push({
      relativePath,
      stat,
      content,
    });
  }

  return scanScannableFiles({
    rootPath,
    profile,
    scannableFiles,
    knownRelativePaths: options.knownRelativePaths ?? new Set(scannableFiles.map((file) => file.relativePath)),
    schemaObjects: options.schemaObjects ?? [],
    schemaObjectsIndexed: 0,
  });
}

async function scanScannableFiles(args: {
  rootPath: string;
  profile: ProjectProfile;
  scannableFiles: ScannableFile[];
  knownRelativePaths: Set<string>;
  schemaObjects: SchemaObjectRecord[];
  schemaObjectsIndexed: number;
}): Promise<{
  snapshot: IndexSnapshot;
  stats: ProjectScanStats;
}> {
  const {
    rootPath,
    profile,
    scannableFiles,
    knownRelativePaths,
    schemaObjects,
    schemaObjectsIndexed,
  } = args;
  const routeDefinitions = buildNamedRouteDefinitionIndex(scannableFiles);
  const referencedDefinitionIds = new Set<string>();
  const collectedRoutes = scannableFiles.flatMap((file) =>
    collectRoutesFromAst(file.relativePath, profile, file.content, routeDefinitions, referencedDefinitionIds),
  );
  const routesByFile = selectRoutesByFile(collectedRoutes);
  const indexedFiles: IndexedFileRecord[] = [];

  // Build symbol-level chunks concurrently across all scannable files. The
  // tree-sitter chunker falls back to a file-level chunk for parse failures
  // and unsupported extensions, so this Promise.all always resolves.
  const limitChunkBuild = pLimit(CHUNK_BUILD_CONCURRENCY);
  const chunkSets = await Promise.all(
    scannableFiles.map((file) =>
      limitChunkBuild(async () => {
        const { relativePath, content } = file;
        const lineCount = content === "" ? 0 : content.split("\n").length;
        const trimmedContent =
          content.length > MAX_CHUNK_CONTENT_LENGTH
            ? `${content.slice(0, MAX_CHUNK_CONTENT_LENGTH)}\n/* mako-ai: file truncated for initial index */`
            : content;
        const chunks = await buildChunks({
          path: relativePath,
          content: trimmedContent,
          lineCount,
        });
        return { file, chunks, lineCount };
      }),
    ),
  );

  for (const { file, chunks, lineCount } of chunkSets) {
    const { relativePath, stat, content } = file;
    const symbols = collectExportedSymbolsFromAst(content, relativePath);
    const imports = collectImportEdgesFromAst(
      rootPath,
      content,
      relativePath,
      knownRelativePaths,
      profile.pathAliases,
    );
    const interactions = collectCodeInteractionsFromAst(
      rootPath,
      content,
      relativePath,
      knownRelativePaths,
      profile.pathAliases,
    );
    const routes = routesByFile.get(relativePath) ?? [];

    indexedFiles.push({
      path: relativePath,
      sha256: hashText(content),
      language: detectLanguage(relativePath),
      sizeBytes: stat.size,
      lineCount,
      isGenerated: looksGeneratedFile(relativePath),
      lastModifiedAt: stat.mtime.toISOString(),
      chunks,
      symbols,
      imports,
      interactions,
      routes,
    });
  }

  const schemaUsages: SchemaUsageRecord[] = collectSchemaUsages(indexedFiles, schemaObjects);

  const stats: ProjectScanStats = {
    files: indexedFiles.length,
    chunks: indexedFiles.reduce((sum, file) => sum + file.chunks.length, 0),
    symbols: indexedFiles.reduce((sum, file) => sum + file.symbols.length, 0),
    importEdges: indexedFiles.reduce((sum, file) => sum + file.imports.length, 0),
    codeInteractions: indexedFiles.reduce((sum, file) => sum + (file.interactions?.length ?? 0), 0),
    routes: indexedFiles.reduce((sum, file) => sum + file.routes.length, 0),
    schemaObjects: schemaObjectsIndexed,
    schemaUsages: schemaUsages.length,
  };

  return {
    snapshot: {
      files: indexedFiles,
      schemaObjects,
      schemaUsages,
    },
    stats,
  };
}
