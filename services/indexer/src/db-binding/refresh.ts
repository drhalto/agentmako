import { randomUUID } from "node:crypto";
import type { DbRefreshResult, JsonValue, SchemaIR, SchemaSnapshot } from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import { ProjectCommandError } from "../errors.js";
import { readProjectManifest, writeProjectManifest } from "../project-manifest.js";
import {
  buildSchemaSnapshot,
  computeSnapshotFreshness,
  fingerprintIR,
  mergeIRInto,
  sortIR,
} from "../schema-snapshot.js";
import type { IndexerOptions } from "../types.js";
import { durationMs, withResolvedProjectContext } from "../utils.js";
import { fetchLiveSchemaIR } from "./live-catalog.js";
import { resolveLiveDbUrl } from "./resolve.js";

const refreshLogger = createLogger("mako-indexer", { component: "db-refresh" });

export interface RefreshProjectDbOptions {
  includedSchemas?: string[];
}

function countTables(ir: SchemaIR): number {
  let count = 0;
  for (const namespace of Object.values(ir.schemas)) {
    count += namespace.tables.length;
  }
  return count;
}

function emptyIR(): SchemaIR {
  return { version: "1.0.0", schemas: {} };
}

export async function refreshProjectDb(
  projectReference: string,
  options: IndexerOptions & RefreshProjectDbOptions = {},
): Promise<DbRefreshResult> {
  return withResolvedProjectContext(projectReference, options, async ({ project, projectStore }) => {
    const manifest = readProjectManifest(project.canonicalPath);
    if (!manifest) {
      throw new ProjectCommandError(
        422,
        "project_manifest_invalid",
        `Project manifest is missing for: ${project.canonicalPath}`,
      );
    }

    const resolvedUrl = resolveLiveDbUrl(manifest.database.liveBinding);

    const refreshStartedAt = new Date().toISOString();
    let refreshResult: DbRefreshResult | undefined;
    let refreshError: unknown;

    try {
      const storedSnapshot = projectStore.loadSchemaSnapshot();
      if (storedSnapshot) {
        const currentFreshness = computeSnapshotFreshness(
          project.canonicalPath,
          manifest.database,
          storedSnapshot,
        );
        if (currentFreshness === "refresh_required") {
          throw new ProjectCommandError(
            412,
            "db_refresh_failed",
            "Repo schema sources have drifted since the stored snapshot. Run `mako project index` before refreshing from the live DB.",
            { projectReference, snapshotId: storedSnapshot.snapshotId },
          );
        }
      }

      const schemaSnapshotBuildStartedAt = new Date().toISOString();
      let repoResult: Awaited<ReturnType<typeof buildSchemaSnapshot>> | undefined;
      let schemaSnapshotBuildError: unknown;
      try {
        repoResult = await buildSchemaSnapshot({
          projectRoot: project.canonicalPath,
          manifest,
        });
      } catch (error) {
        schemaSnapshotBuildError = error;
        throw error;
      } finally {
        const finishedAt = new Date().toISOString();
        try {
          projectStore.insertLifecycleEvent({
            projectId: project.projectId,
            eventType: "schema_snapshot_build",
            outcome: schemaSnapshotBuildError
              ? "failed"
              : repoResult?.snapshot
                ? "success"
                : "skipped",
            startedAt: schemaSnapshotBuildStartedAt,
            finishedAt,
            durationMs: durationMs(schemaSnapshotBuildStartedAt, finishedAt),
            metadata: {
              sourceMode: manifest.database.mode,
              declaredSchemaSources: [...manifest.database.schemaSources],
              persistedSnapshotId: null,
              sourceCount: repoResult?.snapshot?.sources.length ?? 0,
              warningCount: repoResult?.warnings.length ?? 0,
              warnings: (repoResult?.warnings ?? []) as unknown as JsonValue,
            },
            errorText:
              schemaSnapshotBuildError instanceof Error
                ? schemaSnapshotBuildError.message
                : schemaSnapshotBuildError
                  ? String(schemaSnapshotBuildError)
                  : undefined,
          });
        } catch (error) {
          refreshLogger.warn("log-write-failed", {
            eventType: "schema_snapshot_build",
            projectId: project.projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const liveIR = await fetchLiveSchemaIR({
        databaseUrl: resolvedUrl.url,
        includedSchemas: options.includedSchemas,
      });

      const mergedIR: SchemaIR = repoResult.snapshot
        ? (JSON.parse(JSON.stringify(repoResult.snapshot.ir)) as SchemaIR)
        : emptyIR();
      mergeIRInto(mergedIR, liveIR);
      const sortedIR = sortIR(mergedIR);
      const fingerprint = fingerprintIR(sortedIR);

      const refreshedAt = new Date().toISOString();
      const snapshotId = `snapshot_${randomUUID()}`;

      const newSnapshot: SchemaSnapshot = {
        snapshotId,
        sourceMode: "live_refresh_enabled",
        generatedAt: repoResult.snapshot?.generatedAt ?? refreshedAt,
        refreshedAt,
        fingerprint,
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: repoResult.snapshot?.sources ?? [],
        warnings: repoResult.warnings,
        ir: sortedIR,
      };

      projectStore.saveSchemaSnapshot(newSnapshot);
      projectStore.markDbBindingRefreshed({ refreshedAt });

      // Promote the manifest mode to reflect the refreshed snapshot so later reads
      // (status, verify, etc.) agree with what the snapshot actually is.
      if (manifest.database.mode !== "live_refresh_enabled") {
        writeProjectManifest(project.canonicalPath, {
          ...manifest,
          database: {
            ...manifest.database,
            mode: "live_refresh_enabled",
          },
        });
      }

      refreshResult = {
        snapshotId,
        fingerprint,
        sourceMode: "live_refresh_enabled",
        refreshedAt,
        tableCount: countTables(sortedIR),
        warningCount: newSnapshot.warnings.length,
      };

      return refreshResult;
    } catch (error) {
      refreshError = error;
      throw error;
    } finally {
      const finishedAt = new Date().toISOString();
      try {
        projectStore.insertLifecycleEvent({
          projectId: project.projectId,
          eventType: "schema_snapshot_refresh",
          outcome: refreshError ? "failed" : "success",
          startedAt: refreshStartedAt,
          finishedAt,
          durationMs: durationMs(refreshStartedAt, finishedAt),
          metadata: {
            includedSchemas: options.includedSchemas ?? [],
            snapshotId: refreshResult?.snapshotId ?? null,
            fingerprint: refreshResult?.fingerprint ?? null,
            sourceMode: refreshResult?.sourceMode ?? null,
            tableCount: refreshResult?.tableCount ?? null,
            warningCount: refreshResult?.warningCount ?? null,
          },
          errorText: refreshError instanceof Error ? refreshError.message : refreshError ? String(refreshError) : undefined,
        });
      } catch (error) {
        refreshLogger.warn("log-write-failed", {
          eventType: "schema_snapshot_refresh",
          projectId: project.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}
