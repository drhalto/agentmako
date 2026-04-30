import { existsSync, realpathSync } from "node:fs";
import { loadConfig } from "@mako-ai/config";
import type { AttachedProject, JsonObject, ProjectLocatorInput } from "@mako-ai/contracts";
import {
  normalizePath,
  openGlobalStore,
  type GlobalStore,
  type ProjectLocationMatch,
} from "@mako-ai/store";
import { createMissingProjectContextError, createProjectNotAttachedError } from "./resolver-errors.js";
import type { ToolServiceOptions } from "./runtime.js";

function resolveProjectReference(reference: string): string {
  if (existsSync(reference)) {
    return normalizePath(realpathSync(reference));
  }

  return normalizePath(reference);
}

export interface ProjectLocationResolution {
  project: AttachedProject | null;
  detachedProject: AttachedProject | null;
  ambiguousCandidates: AttachedProject[];
}

export function pickBestLocationCandidate(matches: ProjectLocationMatch[]): ProjectLocationResolution {
  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      project: null,
      detachedProject: null,
      ambiguousCandidates: [],
    };
  }

  const topMatchLength = matches[0]?.matchLength ?? -1;
  const topCandidates = matches.filter((candidate) => candidate.matchLength === topMatchLength);
  if (topCandidates.length > 1) {
    return {
      project: null,
      detachedProject: null,
      ambiguousCandidates: topCandidates.map((candidate) => candidate.project),
    };
  }

  return {
    project: topCandidates[0]?.project ?? null,
    detachedProject: null,
    ambiguousCandidates: [],
  };
}

export function createDetachedLocationCandidate(matches: ProjectLocationMatch[]): AttachedProject | null {
  if (!Array.isArray(matches) || matches.length === 0) {
    return null;
  }

  const topMatchLength = matches[0]?.matchLength ?? -1;
  const topCandidates = matches.filter((candidate) => candidate.matchLength === topMatchLength);
  if (topCandidates.length !== 1) {
    return null;
  }

  return topCandidates[0]?.project ?? null;
}

function getMetaCwd(meta: JsonObject | undefined): string | undefined {
  return typeof meta?.cwd === "string" && meta.cwd.trim() !== "" ? meta.cwd.trim() : undefined;
}

export function resolveProjectFromLocations(
  globalStore: ReturnType<typeof openGlobalStore>,
  locations: string[],
): ProjectLocationResolution {
  const normalizedLocations = [...new Set(locations.map((location) => location.trim()).filter((location) => location !== ""))].map((location) =>
    resolveProjectReference(location),
  );

  const activeProjects = new Map<string, AttachedProject>();
  const ambiguousCandidates = new Map<string, AttachedProject>();
  const detachedProjects = new Map<string, AttachedProject>();

  for (const location of normalizedLocations) {
    const activeResolution = pickBestLocationCandidate(globalStore.findProjectMatchesByLocation(location));
    if (activeResolution.project) {
      activeProjects.set(activeResolution.project.projectId, activeResolution.project);
      continue;
    }

    if (activeResolution.ambiguousCandidates.length > 0) {
      for (const candidate of activeResolution.ambiguousCandidates) {
        ambiguousCandidates.set(candidate.projectId, candidate);
      }
      continue;
    }

    const detachedCandidate = createDetachedLocationCandidate(
      globalStore.findProjectMatchesByLocation(location, { includeDetached: true }),
    );
    if (detachedCandidate) {
      detachedProjects.set(detachedCandidate.projectId, detachedCandidate);
    }
  }

  if (activeProjects.size === 1 && ambiguousCandidates.size === 0) {
    return {
      project: [...activeProjects.values()][0] ?? null,
      detachedProject: null,
      ambiguousCandidates: [],
    };
  }

  if (activeProjects.size > 1 || ambiguousCandidates.size > 0) {
    return {
      project: null,
      detachedProject: null,
      ambiguousCandidates: [...new Map([...activeProjects, ...ambiguousCandidates]).values()],
    };
  }

  return {
    project: null,
    detachedProject: detachedProjects.size === 1 ? ([...detachedProjects.values()][0] ?? null) : null,
    ambiguousCandidates: [],
  };
}

export function borrowGlobalStore<T>(
  options: ToolServiceOptions,
  callback: (store: GlobalStore) => T,
): T {
  if (options.sharedGlobalStore) {
    return callback(options.sharedGlobalStore);
  }

  const config = loadConfig(options.configOverrides);
  const tempStore = openGlobalStore({
    stateDirName: config.stateDirName,
    globalDbFilename: config.globalDbFilename,
  });
  try {
    return callback(tempStore);
  } finally {
    tempStore.close();
  }
}

export async function resolveProject(
  locator: ProjectLocatorInput,
  options: ToolServiceOptions,
): Promise<AttachedProject> {
  const config = loadConfig(options.configOverrides);
  const shared = options.sharedGlobalStore;
  const globalStore = shared ?? openGlobalStore({
    stateDirName: config.stateDirName,
    globalDbFilename: config.globalDbFilename,
  });

  try {
    if (locator.projectId) {
      const projectById = globalStore.getProjectById(locator.projectId);
      if (projectById) {
        await notifyProjectResolved(options, projectById);
        return projectById;
      }

      const detachedProject = globalStore.getProjectById(locator.projectId, { includeDetached: true });
      throw createProjectNotAttachedError(`No attached project found for: ${locator.projectId}`, {
        projectId: locator.projectId,
        detachedProjectId: detachedProject?.projectId ?? null,
      });
    }

    if (locator.projectRef) {
      const resolvedReference = resolveProjectReference(locator.projectRef);
      const projectByPath =
        globalStore.findBestProjectByLocation(resolvedReference) ??
        globalStore.getProjectByPath(resolvedReference) ??
        globalStore.getProjectById(locator.projectRef);
      if (projectByPath) {
        await notifyProjectResolved(options, projectByPath);
        return projectByPath;
      }

      const detachedProject =
        globalStore.findBestProjectByLocation(resolvedReference, { includeDetached: true }) ??
        globalStore.getProjectByPath(resolvedReference, { includeDetached: true }) ??
        globalStore.getProjectById(locator.projectRef, { includeDetached: true });
      throw createProjectNotAttachedError(`No attached project found for: ${locator.projectRef}`, {
        projectRef: locator.projectRef,
        normalizedReference: resolvedReference,
        detachedProjectId: detachedProject?.projectId ?? null,
      });
    }

    if (options.requestContext?.sessionProjectId) {
      const sessionProject = globalStore.getProjectById(options.requestContext.sessionProjectId);
      if (sessionProject) {
        await notifyProjectResolved(options, sessionProject);
        return sessionProject;
      }
    }

    const roots = (await options.requestContext?.getRoots?.()) ?? [];
    const rootResolution = resolveProjectFromLocations(globalStore, roots);
    if (rootResolution.project) {
      await notifyProjectResolved(options, rootResolution.project);
      return rootResolution.project;
    }

    const metaCwd = getMetaCwd(options.requestContext?.meta);
    const cwdResolution = metaCwd
      ? resolveProjectFromLocations(globalStore, [metaCwd])
      : { project: null, detachedProject: null, ambiguousCandidates: [] };
    if (cwdResolution.project) {
      await notifyProjectResolved(options, cwdResolution.project);
      return cwdResolution.project;
    }

    const ambiguousCandidates = [
      ...rootResolution.ambiguousCandidates,
      ...cwdResolution.ambiguousCandidates,
    ];
    if (ambiguousCandidates.length > 0) {
      throw createMissingProjectContextError("Project context resolved to multiple attached projects.", {
        candidates: ambiguousCandidates.map((candidate) => ({
          projectId: candidate.projectId,
          canonicalPath: candidate.canonicalPath,
        })),
      });
    }

    const detachedProject = rootResolution.detachedProject ?? cwdResolution.detachedProject;
    if (detachedProject) {
      throw createProjectNotAttachedError("Project context matched a detached project.", {
        projectId: detachedProject.projectId,
        canonicalPath: detachedProject.canonicalPath,
      });
    }
  } finally {
    if (!shared) {
      globalStore.close();
    }
  }

  throw createMissingProjectContextError(
    "Project context is required. Provide `projectId` or `projectRef`, or call from an attached project context.",
  );
}

export async function resolveProjectFromToolContext(
  locator: ProjectLocatorInput,
  options: ToolServiceOptions,
): Promise<AttachedProject> {
  return resolveProject(locator, options);
}

async function notifyProjectResolved(options: ToolServiceOptions, project: AttachedProject): Promise<void> {
  await options.requestContext?.onProjectResolved?.(project);
}
