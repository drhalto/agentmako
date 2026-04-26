import { existsSync, realpathSync } from "node:fs";
import type { AttachedProject } from "@mako-ai/contracts";
import { normalizePath, type GlobalStore, type ProjectLocationMatch } from "@mako-ai/store";

export interface ProjectReferenceResolution {
  project: AttachedProject | null;
  detachedProject: AttachedProject | null;
  ambiguousCandidates: AttachedProject[];
  normalizedReference: string;
  referenceKind: "path" | "identifier";
}

function normalizeReference(reference: string): Pick<ProjectReferenceResolution, "normalizedReference" | "referenceKind"> {
  if (existsSync(reference)) {
    return {
      normalizedReference: normalizePath(realpathSync(reference)),
      referenceKind: "path",
    };
  }

  return {
    normalizedReference: normalizePath(reference),
    referenceKind: "identifier",
  };
}

function pickBestLocationMatch(matches: ProjectLocationMatch[]): {
  project: AttachedProject | null;
  ambiguousCandidates: AttachedProject[];
} {
  if (matches.length === 0) {
    return { project: null, ambiguousCandidates: [] };
  }

  const topMatchLength = matches[0]?.matchLength ?? -1;
  const topMatches = matches.filter((candidate) => candidate.matchLength === topMatchLength);
  if (topMatches.length > 1) {
    return {
      project: null,
      ambiguousCandidates: topMatches.map((candidate) => candidate.project),
    };
  }

  return {
    project: topMatches[0]?.project ?? null,
    ambiguousCandidates: [],
  };
}

export function resolveProjectReference(
  globalStore: GlobalStore,
  reference: string,
): ProjectReferenceResolution {
  const trimmedReference = reference.trim();
  const { normalizedReference, referenceKind } = normalizeReference(trimmedReference);

  if (referenceKind === "path") {
    const activeLocationMatch = pickBestLocationMatch(
      globalStore.findProjectMatchesByLocation(normalizedReference),
    );
    if (activeLocationMatch.project || activeLocationMatch.ambiguousCandidates.length > 0) {
      return {
        project: activeLocationMatch.project,
        detachedProject: null,
        ambiguousCandidates: activeLocationMatch.ambiguousCandidates,
        normalizedReference,
        referenceKind,
      };
    }

    const detachedLocationMatch = pickBestLocationMatch(
      globalStore.findProjectMatchesByLocation(normalizedReference, { includeDetached: true }),
    );
    return {
      project: null,
      detachedProject: detachedLocationMatch.project,
      ambiguousCandidates: detachedLocationMatch.ambiguousCandidates,
      normalizedReference,
      referenceKind,
    };
  }

  const projectById = globalStore.getProjectById(trimmedReference);
  if (projectById) {
    return {
      project: projectById,
      detachedProject: null,
      ambiguousCandidates: [],
      normalizedReference,
      referenceKind,
    };
  }

  const detachedProjectById = globalStore.getProjectById(trimmedReference, { includeDetached: true });
  if (detachedProjectById) {
    return {
      project: null,
      detachedProject: detachedProjectById,
      ambiguousCandidates: [],
      normalizedReference,
      referenceKind,
    };
  }

  const projectByPath = globalStore.getProjectByPath(normalizedReference);
  if (projectByPath) {
    return {
      project: projectByPath,
      detachedProject: null,
      ambiguousCandidates: [],
      normalizedReference,
      referenceKind,
    };
  }

  const detachedProjectByPath = globalStore.getProjectByPath(normalizedReference, { includeDetached: true });
  return {
    project: null,
    detachedProject: detachedProjectByPath,
    ambiguousCandidates: [],
    normalizedReference,
    referenceKind,
  };
}
