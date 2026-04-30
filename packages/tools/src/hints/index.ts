import type {
  ContextPacketToolOutput,
  DbColumnsToolOutput,
  DbFkToolOutput,
  DbRlsToolOutput,
  DbTableSchemaToolOutput,
  ExportsOfToolOutput,
  ImportsCyclesToolOutput,
  ImportsDepsToolOutput,
  ImportsHotspotsToolOutput,
  ImportsImpactToolOutput,
  ReefScoutToolOutput,
  SymbolsOfToolOutput,
  ToolAnnotations,
} from "@mako-ai/contracts";
import { maybeGetToolOperationalMetadata } from "../tool-operational-metadata.js";
import { answerToolHints } from "./answers.js";
import { contextPacketHints } from "./context.js";
import {
  dbColumnsHints,
  dbFkHints,
  dbRlsHints,
  dbTableSchemaHints,
} from "./db.js";
import {
  importsCyclesHints,
  importsDepsHints,
  importsHotspotsHints,
  importsImpactHints,
} from "./imports.js";
import { reefScoutHints } from "./reef.js";
import { exportsOfHints, symbolsOfHints } from "./symbols.js";

export {
  answerToolHints,
  contextPacketHints,
  dbColumnsHints,
  dbFkHints,
  dbRlsHints,
  dbTableSchemaHints,
  exportsOfHints,
  importsCyclesHints,
  importsDepsHints,
  importsHotspotsHints,
  importsImpactHints,
  reefScoutHints,
  symbolsOfHints,
};

const MAX_HINTS = 8;

export interface AttachToolHintsInput {
  toolName: string;
  input: unknown;
  output: unknown;
  annotations: ToolAnnotations;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function freshnessState(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  return typeof state === "string" ? state : null;
}

function nestedAnswerResult(output: Record<string, unknown>): Record<string, unknown> | null {
  const direct = output.candidateActions || output.packet || output.evidenceStatus
    ? output
    : null;
  if (direct) return direct;
  const result = output.result;
  return isRecord(result) ? result : null;
}

function addUnique(hints: string[], hint: string): void {
  const trimmed = hint.trim();
  if (!trimmed || hints.includes(trimmed)) return;
  hints.push(trimmed);
}

function commonOutputHints(toolName: string, output: Record<string, unknown>): string[] {
  const hints: string[] = [];
  const warnings = stringArray(output.warnings);
  if (warnings.length > 0) {
    addUnique(hints, `${warnings.length} warning(s) returned; review them before relying on this result.`);
  }

  const indexFreshness = freshnessState(output.indexFreshness);
  if (indexFreshness && indexFreshness !== "fresh") {
    addUnique(hints, `Indexed evidence is ${indexFreshness}; verify with live_text_search or project_index_status before trusting exact lines.`);
  }

  const answer = nestedAnswerResult(output);
  if (answer) {
    const evidenceStatus = typeof answer.evidenceStatus === "string" ? answer.evidenceStatus : null;
    if (evidenceStatus && evidenceStatus !== "complete") {
      addUnique(hints, `Evidence is ${evidenceStatus}; expand with a focused follow-up before making broad changes.`);
    }
    const candidateActions = Array.isArray(answer.candidateActions) ? answer.candidateActions : [];
    if (candidateActions.length > 0) {
      addUnique(hints, `${candidateActions.length} candidate action(s) available; prefer the safest relevant follow-up.`);
    }
  }

  if (toolName === "tool_batch") {
    const summary = isRecord(output.summary) ? output.summary : null;
    const rejected = typeof summary?.rejectedOps === "number" ? summary.rejectedOps : 0;
    const failed = typeof summary?.failedOps === "number" ? summary.failedOps : 0;
    if (rejected + failed > 0) {
      addUnique(hints, `${rejected + failed} batch op(s) did not succeed; inspect per-op results before continuing.`);
    }
  }

  return hints;
}

function familyHints(toolName: string, output: Record<string, unknown>): string[] {
  switch (toolName) {
    case "imports_deps":
      return importsDepsHints(output as unknown as ImportsDepsToolOutput);
    case "imports_impact":
      return importsImpactHints(output as unknown as ImportsImpactToolOutput);
    case "imports_cycles":
      return importsCyclesHints(output as unknown as ImportsCyclesToolOutput);
    case "imports_hotspots":
      return importsHotspotsHints(output as unknown as ImportsHotspotsToolOutput);
    case "symbols_of":
      return symbolsOfHints(output as unknown as SymbolsOfToolOutput);
    case "exports_of":
      return exportsOfHints(output as unknown as ExportsOfToolOutput);
    case "db_columns":
      return dbColumnsHints(output as unknown as DbColumnsToolOutput);
    case "db_fk":
      return dbFkHints(output as unknown as DbFkToolOutput);
    case "db_rls":
      return dbRlsHints(output as unknown as DbRlsToolOutput);
    case "db_table_schema":
      return dbTableSchemaHints(output as unknown as DbTableSchemaToolOutput);
    case "context_packet":
      return contextPacketHints(output as unknown as ContextPacketToolOutput);
    case "reef_scout":
      return reefScoutHints(output as unknown as ReefScoutToolOutput);
    case "route_trace":
    case "schema_usage":
    case "file_health":
    case "auth_path":
      return answerToolHints(toolName, output as { result?: unknown });
    default:
      return [];
  }
}

function mutationHints(toolName: string, output: Record<string, unknown>, annotations: ToolAnnotations): string[] {
  if (!("mutation" in annotations)) return [];
  const hints: string[] = [];
  const metadata = maybeGetToolOperationalMetadata(toolName);
  if (output.preview === true) {
    addUnique(hints, "Preview only. Run again with preview=false to apply.");
  } else if (metadata?.previewDecision === "required" || metadata?.previewDecision === "useful") {
    addUnique(hints, "This mutation supports preview; call with preview=true first when user confirmation is needed.");
  }
  return hints;
}

export function attachToolHints(
  input: AttachToolHintsInput,
): Record<string, unknown> & { _hints: string[] } {
  const baseHints = isRecord(input.output) ? stringArray(input.output._hints) : [];
  const hints = [...baseHints];
  if (isRecord(input.output)) {
    for (const hint of familyHints(input.toolName, input.output)) addUnique(hints, hint);
    for (const hint of commonOutputHints(input.toolName, input.output)) addUnique(hints, hint);
    for (const hint of mutationHints(input.toolName, input.output, input.annotations)) addUnique(hints, hint);
    return {
      ...input.output,
      _hints: hints.slice(0, MAX_HINTS),
    };
  }

  return {
    value: input.output,
    _hints: hints.slice(0, MAX_HINTS),
  };
}
