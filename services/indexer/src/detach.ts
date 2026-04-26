import { existsSync, rmSync } from "node:fs";
import { resolveProjectStateDir } from "@mako-ai/config";
import { createLogger } from "@mako-ai/logger";
import { ProjectCommandError } from "./errors.js";
import { resolveProjectManifestDir } from "./project-manifest.js";
import { resolveProjectReference } from "./project-reference.js";
import type { DetachProjectResult, IndexerOptions } from "./types.js";
import { durationMs, withGlobalStore, withProjectStore } from "./utils.js";

const detachLogger = createLogger("mako-indexer", { component: "detach" });

function removePathIfPresent(targetPath: string, removedPaths: string[]): void {
  if (!existsSync(targetPath)) {
    return;
  }

  rmSync(targetPath, { recursive: true, force: true });
  removedPaths.push(targetPath);
}

export function detachProject(
  projectReference: string,
  options: IndexerOptions & { purge?: boolean } = {},
): DetachProjectResult {
  return withGlobalStore(options, ({ config, globalStore }) => {
    const detachStartedAt = new Date().toISOString();
    const resolved = resolveProjectReference(globalStore, projectReference);
    if (resolved.ambiguousCandidates.length > 0) {
      throw new ProjectCommandError(
        409,
        "detach_target_ambiguous",
        `Multiple attached projects match: ${projectReference}`,
        {
          projectReference,
          candidates: resolved.ambiguousCandidates.map((project) => ({
            projectId: project.projectId,
            canonicalPath: project.canonicalPath,
          })),
        },
      );
    }

    if (!resolved.project) {
      throw new ProjectCommandError(
        404,
        "project_not_attached",
        `No attached project found for: ${projectReference}`,
        {
          projectReference,
          normalizedReference: resolved.normalizedReference,
          detachedProjectId: resolved.detachedProject?.projectId,
        },
      );
    }

    const project = resolved.project;

    const { detachedProject, detachedAt } = withProjectStore(project.canonicalPath, config, (projectStore) => {
      const detachedProject = globalStore.detachProject(project.projectId);
      if (!detachedProject) {
        throw new ProjectCommandError(404, "project_not_attached", `No attached project found for: ${projectReference}`);
      }

      const detachedAt = new Date().toISOString();

      try {
        projectStore.insertLifecycleEvent({
          projectId: detachedProject.projectId,
          eventType: "project_detach",
          outcome: "success",
          startedAt: detachStartedAt,
          finishedAt: detachedAt,
          durationMs: durationMs(detachStartedAt, detachedAt),
          metadata: {
            projectReference,
            purged: options.purge ?? false,
          },
        });
      } catch (error) {
        detachLogger.warn("log-write-failed", {
          eventType: "project_detach",
          projectId: detachedProject.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return { detachedProject, detachedAt };
    }, options);

    const removedPaths: string[] = [];
    if (options.purge) {
      try {
        removePathIfPresent(resolveProjectManifestDir(detachedProject.canonicalPath), removedPaths);
        removePathIfPresent(
          resolveProjectStateDir(detachedProject.canonicalPath, config.stateDirName),
          removedPaths,
        );
        globalStore.removeProject(detachedProject.projectId);
      } catch (error) {
        throw new ProjectCommandError(
          500,
          "purge_failed",
          `Failed to purge local state for: ${projectReference}`,
          {
            projectReference,
            removedPaths,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    return {
      project: {
        ...detachedProject,
        status: "detached",
      },
      detachedAt,
      purged: options.purge ?? false,
      removedPaths,
    };
  });
}
