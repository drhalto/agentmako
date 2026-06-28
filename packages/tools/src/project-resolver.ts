import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
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

type ProjectContextLocationSource = "mcp_root" | "meta_cwd";

interface ProjectContextLocationHint {
  source: ProjectContextLocationSource;
  path: string;
  normalizedPath: string;
  exists: boolean;
  suggestedProjectRoot?: string;
  suggestedProjectRootReason?: string;
}

interface DiscoveredProjectRoot {
  path: string;
  reason: string;
}

const WORKSPACE_ROOT_MARKERS = [
  "pnpm-workspace.yaml",
  "rush.json",
  "lerna.json",
  "nx.json",
  "workspace.json",
] as const;
const PROJECT_ROOT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "settings.gradle",
  "deno.json",
] as const;

function existingDirectoryForReference(reference: string): string | undefined {
  if (!existsSync(reference)) {
    return undefined;
  }

  try {
    const resolved = realpathSync(reference);
    return statSync(resolved).isDirectory() ? resolved : dirname(resolved);
  } catch {
    return undefined;
  }
}

function hasAnyMarker(directory: string, markers: readonly string[]): string | undefined {
  return markers.find((marker) => existsSync(join(directory, marker)));
}

function normalizeExistingDirectory(directory: string): string {
  return normalizePath(realpathSync(directory));
}

function discoverSuggestedProjectRoot(reference: string): DiscoveredProjectRoot | undefined {
  let current = existingDirectoryForReference(reference);
  let packageCandidate: DiscoveredProjectRoot | undefined;

  while (current) {
    if (existsSync(join(current, ".mako", "project.json"))) {
      return {
        path: normalizeExistingDirectory(current),
        reason: "mako_manifest",
      };
    }

    if (existsSync(join(current, ".git"))) {
      return {
        path: normalizeExistingDirectory(current),
        reason: "git_root",
      };
    }

    const workspaceMarker = hasAnyMarker(current, WORKSPACE_ROOT_MARKERS);
    if (workspaceMarker) {
      return {
        path: normalizeExistingDirectory(current),
        reason: workspaceMarker,
      };
    }

    const projectMarker = hasAnyMarker(current, PROJECT_ROOT_MARKERS);
    if (!packageCandidate && projectMarker) {
      packageCandidate = {
        path: normalizeExistingDirectory(current),
        reason: projectMarker,
      };
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return packageCandidate;
}

function createProjectContextLocationHint(
  source: ProjectContextLocationSource,
  rawPath: string,
): ProjectContextLocationHint | null {
  const path = rawPath.trim();
  if (path === "") {
    return null;
  }

  const suggestedProjectRoot = discoverSuggestedProjectRoot(path);
  return {
    source,
    path,
    normalizedPath: resolveProjectReference(path),
    exists: existsSync(path),
    ...(suggestedProjectRoot
      ? {
          suggestedProjectRoot: suggestedProjectRoot.path,
          suggestedProjectRootReason: suggestedProjectRoot.reason,
        }
      : {}),
  };
}

function collectProjectContextLocationHints(
  roots: readonly string[],
  metaCwd: string | undefined,
): ProjectContextLocationHint[] {
  const hints = new Map<string, ProjectContextLocationHint>();
  for (const root of roots) {
    const hint = createProjectContextLocationHint("mcp_root", root);
    if (hint) {
      hints.set(`${hint.source}:${hint.normalizedPath}`, hint);
    }
  }

  if (metaCwd) {
    const hint = createProjectContextLocationHint("meta_cwd", metaCwd);
    if (hint) {
      hints.set(`${hint.source}:${hint.normalizedPath}`, hint);
    }
  }

  return [...hints.values()];
}

function quoteCliArg(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

function chooseSuggestedProjectRef(hints: readonly ProjectContextLocationHint[]): string | undefined {
  return (
    hints.find((hint) => hint.source === "meta_cwd" && hint.suggestedProjectRoot)?.suggestedProjectRoot ??
    hints.find((hint) => hint.suggestedProjectRoot)?.suggestedProjectRoot ??
    hints.find((hint) => hint.source === "meta_cwd" && hint.exists)?.normalizedPath ??
    hints.find((hint) => hint.exists)?.normalizedPath ??
    hints[0]?.normalizedPath
  );
}

function createUnmatchedLocationProjectContextError(
  hints: readonly ProjectContextLocationHint[],
): ReturnType<typeof createMissingProjectContextError> {
  const suggestedProjectRef = chooseSuggestedProjectRef(hints);
  const suggestedCommand = suggestedProjectRef
    ? `agentmako connect ${quoteCliArg(suggestedProjectRef)} --no-db`
    : undefined;
  const message = suggestedCommand
    ? `Project context is required. MCP roots/cwd did not match any attached Mako project. Run \`${suggestedCommand}\` or pass \`projectId\`/\`projectRef\`.`
    : "Project context is required. Provide `projectId` or `projectRef`, or call from an attached project context.";
  const details: JsonObject = {
    unmatchedLocations: hints.map((hint) => ({
      source: hint.source,
      path: hint.path,
      normalizedPath: hint.normalizedPath,
      exists: hint.exists,
      ...(hint.suggestedProjectRoot
        ? {
            suggestedProjectRoot: hint.suggestedProjectRoot,
            suggestedProjectRootReason: hint.suggestedProjectRootReason,
          }
        : {}),
    })),
  };
  if (suggestedProjectRef && suggestedCommand) {
    details.suggestedProjectRef = suggestedProjectRef;
    details.suggestedCommand = suggestedCommand;
    details.suggestedAction = "Run the suggested command from a terminal, then retry the MCP tool call.";
  }

  return createMissingProjectContextError(message, details);
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

    const roots = (await options.requestContext?.getRoots?.()) ?? [];
    const metaCwd = getMetaCwd(options.requestContext?.meta);
    const locationHints = collectProjectContextLocationHints(roots, metaCwd);
    const rootResolution = resolveProjectFromLocations(globalStore, roots);
    if (rootResolution.project) {
      await notifyProjectResolved(options, rootResolution.project);
      return rootResolution.project;
    }

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

    if (options.requestContext?.sessionProjectId) {
      const sessionProject = globalStore.getProjectById(options.requestContext.sessionProjectId);
      if (sessionProject) {
        await notifyProjectResolved(options, sessionProject);
        return sessionProject;
      }
    }

    if (locationHints.length > 0) {
      throw createUnmatchedLocationProjectContextError(locationHints);
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
