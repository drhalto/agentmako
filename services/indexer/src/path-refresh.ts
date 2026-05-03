import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { JsonValue } from "@mako-ai/contracts";
import type {
  FileSummaryRecord,
  ResolvedSchemaObjectRecord,
  SchemaObjectKind,
  SchemaObjectRecord,
  SymbolRecord,
} from "@mako-ai/store";
import { createLogger } from "@mako-ai/logger";
import { attachProject } from "./attach.js";
import { scanProjectPaths } from "./file-scan.js";
import { indexProject } from "./index-project.js";
import { buildSemanticUnits } from "./semantic-unit-scan.js";
import { toSchemaSnapshotSummary } from "./schema-snapshot.js";
import {
  materializeReefIndexerStructuralArtifacts,
  type ReefStructuralArtifactMaterializationResult,
} from "./reef-calculation-nodes.js";
import {
  isWatchableProjectPath,
  MAX_INDEXED_FILE_SIZE_BYTES,
  toProjectIndexRelativePath,
} from "./project-index-scope.js";
import type { IndexerOptions, RefreshProjectPathsResult } from "./types.js";
import { durationMs, withGlobalStore, withProjectStore } from "./utils.js";
import { withReefRootWriterLock } from "./reef-writer-lock.js";

const pathRefreshLogger = createLogger("mako-indexer", { component: "path-refresh" });

interface PathPlan {
  paths: string[];
  deletedPaths: string[];
  existingPaths: string[];
  fallbackReason?: string;
}

function normalizeInputPath(projectRoot: string, inputPath: string): string | null {
  const normalized = inputPath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(projectRoot, normalized);
  return toProjectIndexRelativePath(projectRoot, absolutePath);
}

function unsafeFullRefreshReason(relativePath: string): string | null {
  const normalized = relativePath.toLowerCase();
  if (normalized.endsWith(".sql")) {
    return "schema source changed";
  }
  if (
    /(^|\/)(package\.json|tsconfig(?:\.[^/]*)?\.json|next\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|webpack\.config\.[cm]?[jt]s|mako\.config\.[cm]?[jt]s)$/i
      .test(relativePath)
  ) {
    return "project configuration changed";
  }
  if (
    normalized.includes("database.types.") ||
    normalized.includes("/generated/") ||
    normalized.endsWith(".generated.ts") ||
    normalized.endsWith(".generated.tsx")
  ) {
    return "generated type/source changed";
  }
  return null;
}

function exportedNames(symbols: readonly SymbolRecord[]): Set<string> {
  return new Set(
    symbols
      .map((symbol) => symbol.exportName ?? symbol.name)
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function schemaObjectKey(object: ResolvedSchemaObjectRecord): string {
  return [object.objectType, object.schemaName, object.parentObjectName ?? "", object.objectName].join(":");
}

function toSchemaObjectRecord(object: ResolvedSchemaObjectRecord): SchemaObjectRecord | null {
  const supported = new Set<string>(["schema", "table", "view", "column", "rpc", "policy", "trigger", "enum"]);
  if (!supported.has(object.objectType)) {
    return null;
  }
  return {
    objectKey: schemaObjectKey(object),
    objectType: object.objectType as SchemaObjectKind,
    schemaName: object.schemaName,
    objectName: object.objectName,
    ...(object.parentObjectName ? { parentObjectName: object.parentObjectName } : {}),
    ...(object.dataType ? { dataType: object.dataType } : {}),
    ...(object.definition ? { definition: object.definition } : {}),
  };
}

function planPathRefresh(args: {
  projectRoot: string;
  inputPaths: readonly string[];
  indexedFiles: Map<string, FileSummaryRecord>;
  dependentsForFile: (filePath: string) => number;
  unresolvedImportTargets: Set<string>;
}): PathPlan {
  const paths: string[] = [];
  const deletedPaths: string[] = [];
  const existingPaths: string[] = [];

  for (const inputPath of args.inputPaths) {
    const relativePath = normalizeInputPath(args.projectRoot, inputPath);
    if (!relativePath) {
      return { paths, deletedPaths, existingPaths, fallbackReason: "changed path is outside the project root" };
    }
    if (paths.includes(relativePath)) {
      continue;
    }
    paths.push(relativePath);

    const unsafeReason = unsafeFullRefreshReason(relativePath);
    if (unsafeReason) {
      return { paths, deletedPaths, existingPaths, fallbackReason: unsafeReason };
    }

    const absolutePath = path.join(args.projectRoot, relativePath);
    const existsOnDisk = existsSync(absolutePath);
    if (!existsOnDisk) {
      deletedPaths.push(relativePath);
      if (args.indexedFiles.has(relativePath) && args.dependentsForFile(relativePath) > 0) {
        return { paths, deletedPaths, existingPaths, fallbackReason: "deleted file has indexed dependents" };
      }
      continue;
    }

    if (!isWatchableProjectPath(relativePath)) {
      return { paths, deletedPaths, existingPaths, fallbackReason: "changed path is not safely watchable" };
    }

    const stat = statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_INDEXED_FILE_SIZE_BYTES) {
      return { paths, deletedPaths, existingPaths, fallbackReason: "changed file cannot be indexed by the path refresher" };
    }

    if (!args.indexedFiles.has(relativePath) && args.unresolvedImportTargets.has(relativePath)) {
      return { paths, deletedPaths, existingPaths, fallbackReason: "new file may satisfy a previously unresolved import" };
    }

    existingPaths.push(relativePath);
  }

  return { paths, deletedPaths, existingPaths };
}

export async function refreshProjectPaths(
  projectRoot: string,
  changedPaths: readonly string[],
  options: IndexerOptions = {},
): Promise<RefreshProjectPathsResult> {
  const attached = attachProject(projectRoot, options, { logLifecycleEvent: false });

  if (!options.skipReefWriterLock) {
    return withReefRootWriterLock({
      configOverrides: options.configOverrides,
      projectId: attached.project.projectId,
      canonicalRoot: attached.resolvedRootPath,
      analysisHostId: "path-refresh",
      acquireTimeoutMs: options.reefWriterLockAcquireTimeoutMs,
    }, () => refreshProjectPaths(attached.resolvedRootPath, changedPaths, {
      ...options,
      skipReefWriterLock: true,
    }));
  }

  const triggerSource = options.triggerSource ?? "mcp_refresh_paths";
  const fallbackToFull = async (reason: string, paths: string[], deletedPaths: string[]) => {
    pathRefreshLogger.info("path-refresh.full-fallback", {
      projectRoot: attached.resolvedRootPath,
      reason,
      pathCount: paths.length,
    });
    const full = await indexProject(attached.resolvedRootPath, {
      ...options,
      skipReefWriterLock: true,
      triggerSource,
    });
    return {
      ...full,
      mode: "full" as const,
      refreshedPaths: paths,
      deletedPaths,
      fallbackReason: reason,
    };
  };

  const attempted = await withGlobalStore(options, ({ config, globalStore }) =>
    withProjectStore(attached.resolvedRootPath, config, async (projectStore) => {
      const indexedFiles = new Map(projectStore.listFiles().map((file) => [file.path, file] as const));
      const importEdges = projectStore.listAllImportEdges();
      const unresolvedImportTargets = new Set(
        importEdges
          .filter((edge) => !edge.targetExists)
          .map((edge) => edge.targetPath),
      );
      const plan = planPathRefresh({
        projectRoot: attached.resolvedRootPath,
        inputPaths: changedPaths,
        indexedFiles,
        unresolvedImportTargets,
        dependentsForFile: (filePath) => projectStore.listDependentsForFile(filePath).length,
      });
      if (plan.fallbackReason) {
        return { type: "fallback" as const, plan };
      }
      if (plan.paths.length === 0) {
        return { type: "fallback" as const, plan: { ...plan, fallbackReason: "no refreshable paths were provided" } };
      }

      const schemaObjects = projectStore
        .listSchemaObjects()
        .map(toSchemaObjectRecord)
        .filter((object): object is SchemaObjectRecord => object != null);
      const knownRelativePaths = new Set([
        ...indexedFiles.keys(),
        ...plan.existingPaths,
      ]);
      const { snapshot } = await scanProjectPaths(
        attached.resolvedRootPath,
        attached.profile,
        plan.existingPaths,
        {
          knownRelativePaths,
          schemaObjects,
        },
      );

      if (snapshot.files.length !== plan.existingPaths.length) {
        return {
          type: "fallback" as const,
          plan: { ...plan, fallbackReason: "path scan did not produce every changed file" },
        };
      }

      for (const file of snapshot.files) {
        const previous = indexedFiles.get(file.path);
        if (previous) {
          const oldExports = exportedNames(projectStore.listSymbolsForFile(previous.path));
          const newExports = exportedNames(file.symbols);
          if (!sameSet(oldExports, newExports)) {
            return {
              type: "fallback" as const,
              plan: { ...plan, fallbackReason: "exported symbol set changed" },
            };
          }
        }

        for (const route of file.routes) {
          const collision = projectStore
            .listRoutes()
            .find((existingRoute) => existingRoute.routeKey === route.routeKey && existingRoute.filePath !== file.path);
          if (collision) {
            return {
              type: "fallback" as const,
              plan: { ...plan, fallbackReason: "route ownership collision detected" },
            };
          }
        }
      }

      const run = projectStore.beginIndexRun(triggerSource);
      const startedAt = new Date().toISOString();
      let lifecycleError: unknown;
      let finalizedRun = run;
      let stats = projectStore.getScanStats();
      let semanticUnitCount = projectStore.countSemanticUnits();
      let structuralArtifactResult: ReefStructuralArtifactMaterializationResult | undefined;
      const priorFileContents = new Map<string, string>();
      for (const filePath of plan.existingPaths) {
        const priorContent = projectStore.getFileContent(filePath);
        if (priorContent != null) {
          priorFileContents.set(filePath, priorContent);
        }
      }
      try {
        stats = projectStore.replaceFileIndexRows({
          files: snapshot.files,
          deletedPaths: plan.deletedPaths,
          schemaUsages: snapshot.schemaUsages.filter((usage) => plan.existingPaths.includes(usage.filePath)),
        });
        projectStore.replaceSemanticUnitsForFiles(
          plan.paths,
          buildSemanticUnits({
            projectId: attached.project.projectId,
            projectRoot: attached.resolvedRootPath,
            snapshot: {
              files: snapshot.files,
              schemaObjects: [],
              schemaUsages: [],
            },
          }),
        );
        semanticUnitCount = projectStore.countSemanticUnits();
        stats = {
          ...stats,
          semanticUnits: semanticUnitCount,
        };
        structuralArtifactResult = await materializeReefIndexerStructuralArtifacts(projectStore, {
          projectId: attached.project.projectId,
          root: attached.project.canonicalPath,
          snapshot,
          paths: plan.paths,
          deletedPaths: plan.deletedPaths,
          priorFileContents,
          revision: options.reefRevision,
        });
        finalizedRun = projectStore.finishIndexRun(run.runId, "succeeded", {
          filesIndexed: stats.files,
          chunksIndexed: stats.chunks,
          symbolsIndexed: stats.symbols,
          importsIndexed: stats.importEdges,
          ...(stats.codeInteractions !== undefined ? { codeInteractionsIndexed: stats.codeInteractions } : {}),
          routesIndexed: stats.routes,
          schemaObjectsIndexed: stats.schemaObjects,
          schemaUsagesIndexed: stats.schemaUsages,
          semanticUnitsIndexed: semanticUnitCount,
          pathRefreshCount: plan.paths.length,
          deletedPathCount: plan.deletedPaths.length,
        });
        const indexedAt = new Date().toISOString();
        globalStore.markProjectIndexed(attached.project.projectId, indexedAt);
        const schemaSnapshot = toSchemaSnapshotSummary(
          projectStore.loadSchemaSnapshot(),
          attached.manifest.database.schemaSources,
        );

        return {
          type: "paths" as const,
          result: {
            project: {
              ...attached.project,
              lastIndexedAt: indexedAt,
            },
            profile: attached.profile,
            manifest: attached.manifest,
            manifestPath: attached.manifestPath,
            run: finalizedRun,
            stats,
            schemaSnapshot,
            schemaSnapshotWarnings: [],
            globalDbPath: attached.globalDbPath,
            projectDbPath: attached.projectDbPath,
            mode: "paths" as const,
            refreshedPaths: plan.paths,
            deletedPaths: plan.deletedPaths,
          },
        };
      } catch (error) {
        lifecycleError = error;
        projectStore.finishIndexRun(
          run.runId,
          "failed",
          undefined,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      } finally {
        const finishedAt = new Date().toISOString();
        try {
          projectStore.insertLifecycleEvent({
            projectId: attached.project.projectId,
            eventType: "project_index",
            outcome: lifecycleError ? "failed" : "success",
            startedAt,
            finishedAt,
            durationMs: durationMs(startedAt, finishedAt),
            metadata: {
              mode: "paths",
              runId: run.runId,
              triggerSource,
              pathCount: plan.paths.length,
              deletedPathCount: plan.deletedPaths.length,
              paths: plan.paths.slice(0, 50) as unknown as JsonValue,
              stats: (stats ?? null) as unknown as JsonValue,
              structuralArtifactMaterialization: (structuralArtifactResult ?? null) as unknown as JsonValue,
            },
            errorText: lifecycleError instanceof Error ? lifecycleError.message : lifecycleError ? String(lifecycleError) : undefined,
          });
        } catch (error) {
          pathRefreshLogger.warn("log-write-failed", {
            eventType: "project_index",
            projectId: attached.project.projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, options),
  );

  if (attempted.type === "fallback") {
    return fallbackToFull(
      attempted.plan.fallbackReason ?? "path refresh fallback requested",
      attempted.plan.paths,
      attempted.plan.deletedPaths,
    );
  }
  return attempted.result;
}
