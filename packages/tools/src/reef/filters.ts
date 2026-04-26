import type { ProjectFindingStatus, ProjectOverlay } from "@mako-ai/contracts";

export interface FindingFilters {
  overlay?: ProjectOverlay;
  source?: string;
  status?: ProjectFindingStatus;
  includeResolved: boolean;
}

export function findingFilters(input: {
  overlay?: ProjectOverlay;
  source?: string;
  status?: ProjectFindingStatus;
  includeResolved?: boolean;
}): FindingFilters {
  return {
    ...(input.overlay ? { overlay: input.overlay } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.status ? { status: input.status } : {}),
    includeResolved: input.includeResolved ?? (input.status === "resolved"),
  };
}

export interface FactFilters {
  overlay?: ProjectOverlay;
  source?: string;
  kind?: string;
  subjectFingerprint?: string;
}

export function factFilters(input: {
  overlay?: ProjectOverlay;
  source?: string;
  kind?: string;
  subjectFingerprint?: string;
}): FactFilters {
  return {
    ...(input.overlay ? { overlay: input.overlay } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.subjectFingerprint ? { subjectFingerprint: input.subjectFingerprint } : {}),
  };
}
