import { createLogger } from "@mako-ai/logger";
import type { AttachedProject, DbBindingStatus, ProjectManifest } from "@mako-ai/contracts";
import type { DbBindingStateRecord } from "@mako-ai/store";
import { readProjectManifest, resolveProjectManifestPath } from "./project-manifest.js";
import { resolveProjectReference } from "./project-reference.js";
import { summarizeProjectIndexFreshness } from "./index-freshness.js";
import { resolveSchemaSnapshotSummary } from "./schema-snapshot.js";
import type { IndexerOptions, ProjectStatusResult } from "./types.js";
import { withGlobalStore, withProjectStore } from "./utils.js";

const statusLogger = createLogger("mako-indexer", { component: "status" });

function buildDbBindingStatus(
  manifest: ProjectManifest | null,
  bindingState: DbBindingStateRecord,
  schemaSnapshot: { sourceMode?: string; driftDetected?: boolean },
): DbBindingStatus {
  const liveBinding = manifest?.database.liveBinding ?? {
    strategy: "keychain_ref" as const,
    ref: "",
    enabled: false,
  };

  return {
    strategy: liveBinding.strategy,
    ref: liveBinding.ref,
    enabled: liveBinding.enabled,
    configured: liveBinding.enabled && liveBinding.ref.trim() !== "",
    lastTestedAt: bindingState.lastTestedAt,
    lastTestStatus: bindingState.lastTestStatus,
    lastTestError: bindingState.lastTestError,
    lastVerifiedAt: bindingState.lastVerifiedAt,
    lastRefreshedAt: bindingState.lastRefreshedAt,
    sourceMode: schemaSnapshot.sourceMode as DbBindingStatus["sourceMode"],
    driftDetected: schemaSnapshot.driftDetected,
  };
}

function extractWarningCount(metadata: Record<string, unknown> | undefined): number | undefined {
  if (!metadata) {
    return undefined;
  }

  const warnings = metadata.warnings;
  if (Array.isArray(warnings)) {
    return warnings.length;
  }

  return typeof metadata.warningCount === "number" ? metadata.warningCount : undefined;
}

export function listAttachedProjects(options: IndexerOptions = {}): AttachedProject[] {
  return withGlobalStore(options, ({ globalStore }) => globalStore.listProjects());
}

export function getProjectStatus(
  projectReference: string,
  options: IndexerOptions = {},
): ProjectStatusResult | null {
  return withGlobalStore(options, ({ config, globalStore }) => {
    const resolved = resolveProjectReference(globalStore, projectReference);
    const project = resolved.project;

    if (!project) {
      return null;
    }

    return withProjectStore(project.canonicalPath, config, (projectStore) => {
      const manifest = readProjectManifest(project.canonicalPath);
      const storedSnapshot = projectStore.loadSchemaSnapshot();
      let schemaSnapshot = resolveSchemaSnapshotSummary(
        project.canonicalPath,
        manifest?.database ?? null,
        storedSnapshot,
      );
      if (schemaSnapshot.state !== "no_sources") {
        try {
          const latestSchemaBuild = projectStore.queryLifecycleEvents({
            eventType: "schema_snapshot_build",
            limit: 1,
          })[0];
          const warningCount = extractWarningCount(latestSchemaBuild?.metadata as Record<string, unknown> | undefined);
          if (warningCount !== undefined) {
            schemaSnapshot = {
              ...schemaSnapshot,
              warningCount,
            };
          }
        } catch (error) {
          statusLogger.warn("summary-refresh-failed", {
            projectId: project.projectId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const bindingState = projectStore.loadDbBindingState();
      const dbBinding = buildDbBindingStatus(manifest, bindingState, {
        sourceMode: schemaSnapshot.sourceMode,
        driftDetected: schemaSnapshot.driftDetected,
      });

      // Phase 3.9: 30-day rolling spend for this project.
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
      let costUsdMicro30d: number | null = null;
      try {
        const total = projectStore.sumProjectCostUsdMicro(
          project.projectId,
          thirtyDaysAgo.toISOString(),
        );
        costUsdMicro30d = total;
      } catch (error) {
        statusLogger.warn("cost-30d-lookup-failed", {
          projectId: project.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        ...projectStore.getStatus(project),
        manifest,
        manifestPath: resolveProjectManifestPath(project.canonicalPath),
        schemaSnapshot,
        codeIndexFreshness: summarizeProjectIndexFreshness({
          projectRoot: project.canonicalPath,
          store: projectStore,
          includeUnindexed: false,
        }),
        dbBinding,
        costUsdMicro30d,
      };
    }, options);
  });
}
