import type {
  FactFreshness,
  JsonObject,
  ProjectOverlay,
  ReefDiagnosticRun,
} from "@mako-ai/contracts";
import type { ProjectStore, ToolRunRecord } from "@mako-ai/store";

export interface ReefOperationalGraphEvidence {
  source: "reef_operations";
  overlay: ProjectOverlay;
  freshness: FactFreshness;
  diagnosticRuns: ReefDiagnosticRun[];
  toolRuns: ToolRunRecord[];
  warnings: string[];
}

export interface CollectFocusedOperationalGraphEvidenceInput {
  projectStore: ProjectStore;
  projectId: string;
  focusFiles: string[];
  freshness: FactFreshness;
  diagnosticRunLimit?: number;
  toolRunLimit?: number;
}

const DEFAULT_DIAGNOSTIC_RUN_LIMIT = 20;
const DEFAULT_TOOL_RUN_LIMIT = 20;

export function collectFocusedOperationalGraphEvidence(
  input: CollectFocusedOperationalGraphEvidenceInput,
): ReefOperationalGraphEvidence {
  const diagnosticRunLimit = input.diagnosticRunLimit ?? DEFAULT_DIAGNOSTIC_RUN_LIMIT;
  const toolRunLimit = input.toolRunLimit ?? DEFAULT_TOOL_RUN_LIMIT;
  const focusFiles = new Set(input.focusFiles);
  const diagnosticRuns = input.projectStore
    .queryReefDiagnosticRuns({ projectId: input.projectId, limit: diagnosticRunLimit })
    .filter((run) => focusFiles.size === 0 || diagnosticRunTouchesFocus(run, focusFiles));
  const recalled = input.projectStore.recallToolRuns({
    projectId: input.projectId,
    limit: toolRunLimit,
    includePayload: false,
  });
  const toolRuns = recalled.toolRuns.filter((run) =>
    focusFiles.size === 0 || toolRunTouchesFocus(run, focusFiles)
  );

  return {
    source: "reef_operations",
    overlay: "working_tree",
    freshness: input.freshness,
    diagnosticRuns,
    toolRuns,
    warnings: recalled.matchCount > toolRunLimit
      ? [`Focused operational graph evidence scanned the latest ${toolRunLimit} tool run(s); older session evidence is omitted.`]
      : [],
  };
}

function diagnosticRunTouchesFocus(run: ReefDiagnosticRun, focusFiles: Set<string>): boolean {
  const requestedFiles = jsonStringArray(run.metadata, "requestedFiles");
  if (requestedFiles.length === 0) return true;
  return requestedFiles.some((filePath) => focusFiles.has(filePath));
}

function toolRunTouchesFocus(run: ToolRunRecord, focusFiles: Set<string>): boolean {
  const text = [
    JSON.stringify(run.inputSummary),
    JSON.stringify(run.outputSummary),
    run.errorText ?? "",
  ].join("\n");
  for (const filePath of focusFiles) {
    if (text.includes(filePath)) return true;
  }
  return false;
}

function jsonStringArray(object: JsonObject | undefined, key: string): string[] {
  const value = object?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}
