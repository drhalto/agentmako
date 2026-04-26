import { existsSync, realpathSync, statSync } from "node:fs";
import { resolveGlobalDbPath, resolveProjectDbPath } from "@mako-ai/config";
import { createLogger } from "@mako-ai/logger";
import { createId, normalizePath } from "@mako-ai/store";
import { ProjectCommandError } from "./errors.js";
import { buildProjectManifest, readProjectManifest, writeProjectManifest } from "./project-manifest.js";
import { detectProjectProfile } from "./project-profile.js";
import type { AttachProjectResult, IndexerOptions } from "./types.js";
import { durationMs, withGlobalStore, withProjectStore } from "./utils.js";

const attachLogger = createLogger("mako-indexer", { component: "attach" });

interface AttachProjectBehaviorOptions {
  logLifecycleEvent?: boolean;
}

function assertProjectRoot(projectRoot: string): string {
  if (!existsSync(projectRoot)) {
    throw new ProjectCommandError(400, "not_a_project_path", `Project path does not exist: ${projectRoot}`, {
      projectRoot,
    });
  }

  const stat = statSync(projectRoot);
  if (!stat.isDirectory()) {
    throw new ProjectCommandError(400, "not_a_project_path", `Project path is not a directory: ${projectRoot}`, {
      projectRoot,
    });
  }

  return realpathSync(projectRoot);
}

export function attachProject(
  projectRoot: string,
  options: IndexerOptions = {},
  behavior: AttachProjectBehaviorOptions = {},
): AttachProjectResult {
  const startedAt = new Date().toISOString();
  const resolvedRootPath = assertProjectRoot(projectRoot);
  const normalizedRootPath = normalizePath(resolvedRootPath);

  let projectId: string | undefined;
  let profile: AttachProjectResult["profile"] | undefined;
  let manifestPath: string | undefined;
  let project: AttachProjectResult["project"] | undefined;
  let attachError: unknown;

  return withGlobalStore(options, ({ config, globalStore }) =>
    withProjectStore(resolvedRootPath, config, (projectStore) => {
      try {
        const existingProject = globalStore.getProjectByPath(normalizedRootPath);
        projectId = existingProject?.projectId ?? createId("project");
        profile = detectProjectProfile(resolvedRootPath);
        const savedProfile = projectStore.saveProjectProfile(profile);
        project = globalStore.saveProject({
          projectId,
          displayName: profile.name,
          canonicalPath: normalizedRootPath,
          lastSeenPath: normalizedRootPath,
          status: "active",
          supportTarget: config.supportTarget,
          profileHash: savedProfile.profileHash,
        });
        const existingManifest = readProjectManifest(resolvedRootPath);
        const manifest = buildProjectManifest(resolvedRootPath, project.projectId, profile, {
          stateDirName: config.stateDirName,
          existingManifest,
        });
        manifestPath = writeProjectManifest(resolvedRootPath, manifest);

        return {
          project,
          profile,
          manifest,
          manifestPath,
          resolvedRootPath,
          globalDbPath: resolveGlobalDbPath(undefined, config.stateDirName, config.globalDbFilename),
          projectDbPath: resolveProjectDbPath(
            resolvedRootPath,
            config.stateDirName,
            config.projectDbFilename,
          ),
        };
      } catch (error) {
        attachError = error;
        throw error;
      } finally {
        if ((behavior.logLifecycleEvent ?? true) && projectId) {
          const finishedAt = new Date().toISOString();
          try {
            projectStore.insertLifecycleEvent({
              projectId,
              eventType: "project_attach",
              outcome: attachError ? "failed" : "success",
              startedAt,
              finishedAt,
              durationMs: durationMs(startedAt, finishedAt),
              metadata: {
                projectRoot: normalizedRootPath,
                displayName: profile?.name ?? project?.displayName ?? normalizedRootPath,
                supportLevel: profile?.supportLevel ?? "best_effort",
                manifestPath: manifestPath ?? null,
              },
              errorText: attachError instanceof Error ? attachError.message : attachError ? String(attachError) : undefined,
            });
          } catch (logError) {
            attachLogger.warn("log-write-failed", {
              eventType: "project_attach",
              projectId,
              error: logError instanceof Error ? logError.message : String(logError),
            });
          }
        }
      }
    }),
  );
}
