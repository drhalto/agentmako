import type { JsonValue } from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import { attachProject } from "./attach.js";
import { scanProject } from "./file-scan.js";
import { collectProfileDepth } from "./profile-depth.js";
import { updateProjectManifestCapabilities } from "./project-manifest.js";
import { buildSemanticUnits } from "./semantic-unit-scan.js";
import { buildSchemaSnapshot, toSchemaSnapshotSummary } from "./schema-snapshot.js";
import {
  materializeReefIndexerStructuralArtifacts,
  type ReefStructuralArtifactMaterializationResult,
} from "./reef-calculation-nodes.js";
import type { AttachProjectResult, IndexProjectResult, IndexerOptions } from "./types.js";
import { durationMs, withGlobalStore, withProjectStore } from "./utils.js";
import { withReefRootWriterLock } from "./reef-writer-lock.js";

const indexLogger = createLogger("mako-indexer", { component: "index-project" });

export async function indexProject(projectRoot: string, options: IndexerOptions = {}): Promise<IndexProjectResult> {
  const attached = attachProject(projectRoot, options, { logLifecycleEvent: false });

  if (!options.skipReefWriterLock) {
    return withReefRootWriterLock({
      configOverrides: options.configOverrides,
      projectId: attached.project.projectId,
      canonicalRoot: attached.resolvedRootPath,
      analysisHostId: "index-project",
      acquireTimeoutMs: options.reefWriterLockAcquireTimeoutMs,
    }, () => indexAttachedProject(attached, options));
  }

  return indexAttachedProject(attached, options);
}

async function indexAttachedProject(
  attached: AttachProjectResult,
  options: IndexerOptions,
): Promise<IndexProjectResult> {
  return withGlobalStore(options, ({ config, globalStore }) =>
    withProjectStore(attached.resolvedRootPath, config, async (projectStore) => {
      const triggerSource = options.triggerSource ?? "manual";
      const run = projectStore.beginIndexRun(triggerSource);
      const indexStartedAt = new Date().toISOString();
      let lifecycleError: unknown;
      let stats: IndexProjectResult["stats"] | undefined;
      let schemaSnapshotSummary: IndexProjectResult["schemaSnapshot"] | undefined;
      let schemaSnapshotWarnings: IndexProjectResult["schemaSnapshotWarnings"] = [];
      let finalizedRun: IndexProjectResult["run"] | undefined;
      let semanticUnitCount = 0;
      let structuralArtifactResult: ReefStructuralArtifactMaterializationResult | undefined;
      let profileManifest = attached.manifest;
      let profile = attached.profile;

      try {
        const { snapshot } = await scanProject(attached.resolvedRootPath, attached.profile);
        stats = projectStore.replaceIndexSnapshot(snapshot);
        semanticUnitCount = projectStore.replaceSemanticUnits(
          buildSemanticUnits({
            projectId: attached.project.projectId,
            projectRoot: attached.resolvedRootPath,
            snapshot,
          }),
        );
        stats = {
          ...stats,
          semanticUnits: semanticUnitCount,
        };
        structuralArtifactResult = await materializeReefIndexerStructuralArtifacts(projectStore, {
          projectId: attached.project.projectId,
          root: attached.project.canonicalPath,
          snapshot,
          fullRefresh: true,
          revision: options.reefRevision,
        });

        // Phase 3.3: re-derive serverOnlyModules and authGuardSymbols from the now-indexed
        // import graph and exported-symbol table. At attach time these are empty because
        // the scan hasn't run yet; this post-scan step fills them in and writes the values
        // back to the manifest. Failures degrade to leaving the previous values in place —
        // never block the index run on profile-depth errors.
        try {
          const depth = collectProfileDepth(projectStore);
          const updated = updateProjectManifestCapabilities(attached.resolvedRootPath, {
            serverOnlyModules: depth.serverOnlyModules,
            authGuardSymbols: depth.authGuardSymbols,
          });
          profileManifest = updated.manifest;
          profile = {
            ...profile,
            serverOnlyModules: depth.serverOnlyModules,
            authGuardSymbols: depth.authGuardSymbols,
          };
        } catch (error) {
          indexLogger.warn("profile_depth_failed", {
            projectRoot: attached.resolvedRootPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        const schemaSnapshotStartedAt = new Date().toISOString();
        let schemaSnapshotResult: Awaited<ReturnType<typeof buildSchemaSnapshot>> | undefined;
        let schemaSnapshotBuildError: unknown;
        try {
          schemaSnapshotResult = await buildSchemaSnapshot({
            projectRoot: attached.resolvedRootPath,
            manifest: profileManifest,
          });
          if (schemaSnapshotResult.snapshot) {
            projectStore.saveSchemaSnapshot(schemaSnapshotResult.snapshot);
          } else {
            projectStore.clearSchemaSnapshot();
          }
        } catch (error) {
          schemaSnapshotBuildError = error;
          throw error;
        } finally {
          const finishedAt = new Date().toISOString();
          try {
            projectStore.insertLifecycleEvent({
              projectId: attached.project.projectId,
              eventType: "schema_snapshot_build",
              outcome: schemaSnapshotBuildError
                ? "failed"
                : schemaSnapshotResult?.snapshot
                  ? "success"
                  : "skipped",
              startedAt: schemaSnapshotStartedAt,
              finishedAt,
              durationMs: durationMs(schemaSnapshotStartedAt, finishedAt),
              metadata: {
                sourceMode: "repo_only",
                declaredSchemaSources: [...profileManifest.database.schemaSources],
                persistedSnapshotId: schemaSnapshotBuildError
                  ? null
                  : schemaSnapshotResult?.snapshot?.snapshotId ?? null,
                sourceCount: schemaSnapshotResult?.snapshot?.sources.length ?? 0,
                warningCount: schemaSnapshotResult?.warnings.length ?? 0,
                warnings: (schemaSnapshotResult?.warnings ?? []) as unknown as JsonValue,
              },
              errorText:
                schemaSnapshotBuildError instanceof Error
                  ? schemaSnapshotBuildError.message
                  : schemaSnapshotBuildError
                    ? String(schemaSnapshotBuildError)
                    : undefined,
            });
          } catch (error) {
            indexLogger.warn("log-write-failed", {
              eventType: "schema_snapshot_build",
              projectId: attached.project.projectId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        schemaSnapshotWarnings = schemaSnapshotResult?.warnings ?? [];
        schemaSnapshotSummary = toSchemaSnapshotSummary(
          schemaSnapshotResult?.snapshot ?? null,
          profileManifest.database.schemaSources,
        );
        if (schemaSnapshotWarnings.length > 0) {
          schemaSnapshotSummary = {
            ...schemaSnapshotSummary,
            warningCount: schemaSnapshotWarnings.length,
          };
        }

        if (!stats) {
          throw new Error("index stats were not produced");
        }

        finalizedRun = projectStore.finishIndexRun(run.runId, "succeeded", {
          filesIndexed: stats.files,
          chunksIndexed: stats.chunks,
          symbolsIndexed: stats.symbols,
          importsIndexed: stats.importEdges,
          routesIndexed: stats.routes,
          schemaObjectsIndexed: stats.schemaObjects,
          schemaUsagesIndexed: stats.schemaUsages,
          semanticUnitsIndexed: semanticUnitCount,
        });

        const indexedAt = new Date().toISOString();
        globalStore.markProjectIndexed(attached.project.projectId, indexedAt);

        return {
          project: {
            ...attached.project,
            lastIndexedAt: indexedAt,
          },
          profile,
          manifest: profileManifest,
          manifestPath: attached.manifestPath,
          run: finalizedRun,
          stats,
          schemaSnapshot: schemaSnapshotSummary,
          schemaSnapshotWarnings,
          globalDbPath: attached.globalDbPath,
          projectDbPath: attached.projectDbPath,
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
            startedAt: indexStartedAt,
            finishedAt,
            durationMs: durationMs(indexStartedAt, finishedAt),
            metadata: {
              runId: run.runId,
              triggerSource: run.triggerSource,
              runStatus: finalizedRun?.status ?? (lifecycleError ? "failed" : run.status),
              stats: (stats ?? null) as unknown as JsonValue,
              schemaSnapshotState: schemaSnapshotSummary?.state ?? null,
              schemaSnapshotWarningCount: schemaSnapshotWarnings.length,
              structuralArtifactMaterialization: (structuralArtifactResult ?? null) as unknown as JsonValue,
            },
            errorText: lifecycleError instanceof Error ? lifecycleError.message : lifecycleError ? String(lifecycleError) : undefined,
          });
        } catch (error) {
          indexLogger.warn("log-write-failed", {
            eventType: "project_index",
            projectId: attached.project.projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, options),
  );
}
