import type {
  FactFreshness,
  JsonValue,
  ProjectConvention,
  ProjectOverlay,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { collectProjectConventions } from "./conventions.js";

export interface ReefConventionGraphEvidence {
  source: "project_conventions";
  overlay: ProjectOverlay;
  freshness: FactFreshness;
  conventions: ProjectConvention[];
  warnings: string[];
}

export interface CollectFocusedConventionGraphEvidenceInput {
  projectStore: ProjectStore;
  projectId: string;
  focusFiles: string[];
  freshness: FactFreshness;
  scanLimit?: number;
  returnLimit?: number;
}

const DEFAULT_SCAN_LIMIT = 200;
const DEFAULT_RETURN_LIMIT = 48;

export function collectFocusedConventionGraphEvidence(
  input: CollectFocusedConventionGraphEvidenceInput,
): ReefConventionGraphEvidence {
  const scanLimit = input.scanLimit ?? DEFAULT_SCAN_LIMIT;
  const returnLimit = input.returnLimit ?? DEFAULT_RETURN_LIMIT;
  const focusFiles = new Set(input.focusFiles);
  const allConventions = collectProjectConventions(input.projectStore, input.projectId, {
    limit: scanLimit,
  });
  const selected = new Map<string, ProjectConvention>();

  for (const convention of allConventions) {
    if (conventionAppliesToFocus(convention, focusFiles)) {
      selected.set(convention.id, convention);
    }
  }

  for (const convention of allConventions) {
    if (selected.size >= returnLimit) break;
    if (selected.has(convention.id)) continue;
    if (isHighSignalGlobalConvention(convention)) {
      selected.set(convention.id, convention);
    }
  }

  return {
    source: "project_conventions",
    overlay: "indexed",
    freshness: input.freshness,
    conventions: [...selected.values()]
      .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
      .slice(0, returnLimit),
    warnings: selected.size > returnLimit
      ? [`Focused convention graph evidence capped convention nodes at ${returnLimit}.`]
      : [],
  };
}

function conventionAppliesToFocus(
  convention: ProjectConvention,
  focusFiles: Set<string>,
): boolean {
  if (focusFiles.size === 0) return true;
  if (convention.filePath && focusFiles.has(convention.filePath)) return true;
  for (const evidence of convention.evidence) {
    if (containsFocusedFile(evidence, focusFiles)) return true;
  }
  return convention.metadata ? jsonContainsFocusedFile(convention.metadata, focusFiles) : false;
}

function isHighSignalGlobalConvention(convention: ProjectConvention): boolean {
  if (convention.filePath) return false;
  if (convention.status === "accepted") return true;
  if (convention.confidence >= 0.7) return true;
  return convention.id.startsWith("rule:") && convention.confidence >= 0.6;
}

function jsonContainsFocusedFile(value: JsonValue, focusFiles: Set<string>): boolean {
  if (typeof value === "string") return containsFocusedFile(value, focusFiles);
  if (Array.isArray(value)) {
    return value.some((item) => jsonContainsFocusedFile(item, focusFiles));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => jsonContainsFocusedFile(item, focusFiles));
  }
  return false;
}

function containsFocusedFile(value: string, focusFiles: Set<string>): boolean {
  for (const filePath of focusFiles) {
    if (value === filePath || value.startsWith(`${filePath}:`) || value.includes(filePath)) {
      return true;
    }
  }
  return false;
}
