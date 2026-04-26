import { loadConfig, type MakoConfig } from "@mako-ai/config";
import type { AttachedProject } from "@mako-ai/contracts";
import { openGlobalStore, openProjectStore, type GlobalStore, type ProjectStore } from "@mako-ai/store";
import { ProjectCommandError } from "./errors.js";
import { resolveProjectReference } from "./project-reference.js";
import type { IndexerOptions } from "./types.js";

type MaybePromise<T> = T | Promise<T>;

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

export function durationMs(startedAt: string, finishedAt: string): number {
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
}

export function withGlobalStore<T>(
  options: IndexerOptions,
  callback: (context: { config: MakoConfig; globalStore: GlobalStore }) => T,
): T;
export function withGlobalStore<T>(
  options: IndexerOptions,
  callback: (context: { config: MakoConfig; globalStore: GlobalStore }) => Promise<T>,
): Promise<T>;
export function withGlobalStore<T>(
  options: IndexerOptions,
  callback: (context: { config: MakoConfig; globalStore: GlobalStore }) => MaybePromise<T>,
): MaybePromise<T> {
  const config = loadConfig(options.configOverrides);
  const globalStore = openGlobalStore({
    stateDirName: config.stateDirName,
    globalDbFilename: config.globalDbFilename,
  });

  try {
    const result = callback({ config, globalStore });
    if (isPromiseLike(result)) {
      return result.finally(() => {
        globalStore.close();
      });
    }

    globalStore.close();
    return result;
  } catch (error) {
    globalStore.close();
    throw error;
  }
}

export function withProjectStore<T>(
  projectRoot: string,
  config: Pick<MakoConfig, "stateDirName" | "projectDbFilename">,
  callback: (projectStore: ProjectStore) => T,
  options?: Pick<IndexerOptions, "projectStoreCache">,
): T;
export function withProjectStore<T>(
  projectRoot: string,
  config: Pick<MakoConfig, "stateDirName" | "projectDbFilename">,
  callback: (projectStore: ProjectStore) => Promise<T>,
  options?: Pick<IndexerOptions, "projectStoreCache">,
): Promise<T>;
export function withProjectStore<T>(
  projectRoot: string,
  config: Pick<MakoConfig, "stateDirName" | "projectDbFilename">,
  callback: (projectStore: ProjectStore) => MaybePromise<T>,
  options: Pick<IndexerOptions, "projectStoreCache"> = {},
): MaybePromise<T> {
  if (options.projectStoreCache) {
    const projectStore = options.projectStoreCache.borrow({
      projectRoot,
      stateDirName: config.stateDirName,
      projectDbFilename: config.projectDbFilename,
    });
    return callback(projectStore);
  }

  const projectStore = openProjectStore({
    projectRoot,
    stateDirName: config.stateDirName,
    projectDbFilename: config.projectDbFilename,
  });

  try {
    const result = callback(projectStore);
    if (isPromiseLike(result)) {
      return result.finally(() => {
        projectStore.close();
      });
    }

    projectStore.close();
    return result;
  } catch (error) {
    projectStore.close();
    throw error;
  }
}

export function withResolvedProjectContext<T>(
  projectReference: string,
  options: IndexerOptions,
  callback: (context: {
    config: MakoConfig;
    globalStore: GlobalStore;
    project: AttachedProject;
    projectStore: ProjectStore;
  }) => T,
): T;
export function withResolvedProjectContext<T>(
  projectReference: string,
  options: IndexerOptions,
  callback: (context: {
    config: MakoConfig;
    globalStore: GlobalStore;
    project: AttachedProject;
    projectStore: ProjectStore;
  }) => Promise<T>,
): Promise<T>;
export function withResolvedProjectContext<T>(
  projectReference: string,
  options: IndexerOptions,
  callback: (context: {
    config: MakoConfig;
    globalStore: GlobalStore;
    project: AttachedProject;
    projectStore: ProjectStore;
  }) => MaybePromise<T>,
): MaybePromise<T> {
  return withGlobalStore(options, ({ config, globalStore }) => {
    const resolved = resolveProjectReference(globalStore, projectReference);
    if (!resolved.project) {
      throw new ProjectCommandError(
        404,
        "project_not_attached",
        `No attached project found for: ${projectReference}`,
        { projectReference },
      );
    }

    const project = resolved.project;

    return withProjectStore(project.canonicalPath, config, (projectStore) =>
      callback({
        config,
        globalStore,
        project,
        projectStore,
      }),
      options,
    );
  });
}
