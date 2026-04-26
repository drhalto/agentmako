import type { ToolDefinitionSummary, ToolName } from "@mako-ai/contracts";
import { isDbToolAvailableForSession } from "./db/runtime.js";
import {
  getToolDefinition,
  listToolDefinitions,
  type MakoToolDefinition,
} from "./tool-definitions.js";
import type { ToolServiceOptions } from "./runtime.js";

export type ToolExposureSurface = "harness" | "api" | "mcp";
export type ToolExposure = "immediate" | "deferred" | "blocked";
export type ToolExposureReason =
  | "router_tool_hidden_from_model_surface"
  | "requires_project_db_binding";
export type ToolSearchFamily =
  | "registry"
  | "action"
  | "memory"
  | "semantic"
  | "sub_agent";

export interface RegistryToolCapabilities {
  handlerKind: "registry";
  requiresProject: boolean;
  requiresSession: boolean;
  requiresDbBinding: boolean;
  parallelSafe: boolean;
  deferEligible: boolean;
}

export interface RegistryToolExposureItem {
  definition: MakoToolDefinition<ToolName>;
  summary: ToolDefinitionSummary;
  capabilities: RegistryToolCapabilities;
  exposure: ToolExposure;
  reason?: ToolExposureReason;
}

export interface RegistryToolExposurePlan {
  items: RegistryToolExposureItem[];
  immediate: RegistryToolExposureItem[];
  deferred: RegistryToolExposureItem[];
  blocked: RegistryToolExposureItem[];
}

export interface RegistryToolExposurePlanOptions extends ToolServiceOptions {
  surface: ToolExposureSurface;
}

export interface RankedToolCatalogEntry {
  name: string;
  description: string;
  category?: string;
}

export interface ToolSearchCatalogEntry extends RankedToolCatalogEntry {
  family: ToolSearchFamily;
  availability: ToolExposure;
  reason: string | null;
}

function inferRegistryToolCapabilities(
  definition: MakoToolDefinition<ToolName>,
): RegistryToolCapabilities {
  return {
    handlerKind: "registry",
    requiresProject: definition.name !== "ask",
    requiresSession: false,
    requiresDbBinding: definition.category === "db",
    parallelSafe: !("mutation" in definition.annotations),
    deferEligible: definition.name === "ask",
  };
}

function scoreCatalogEntry(
  query: string,
  entry: RankedToolCatalogEntry,
): number {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return 0;

  const haystack = `${entry.name} ${entry.category ?? ""} ${entry.description}`.toLowerCase();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let score = 0;

  if (entry.name.toLowerCase() === trimmed) score += 120;
  if (entry.name.toLowerCase().startsWith(trimmed)) score += 70;
  if (haystack.includes(trimmed)) score += 35;

  for (const token of tokens) {
    if (entry.name.toLowerCase() === token) {
      score += 40;
      continue;
    }
    if (entry.name.toLowerCase().includes(token)) {
      score += 18;
      continue;
    }
    if (haystack.includes(token)) {
      score += 8;
    }
  }

  return score;
}

export function rankToolSearchEntries<T extends RankedToolCatalogEntry>(
  entries: readonly T[],
  query: string,
  limit = 8,
): T[] {
  return entries
    .map((entry) => ({
      entry,
      score: scoreCatalogEntry(query, entry),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.entry.name.localeCompare(right.entry.name);
    })
    .slice(0, limit)
    .map((item) => item.entry);
}

export function formatToolExposureReason(reason?: ToolExposureReason): string | null {
  return reason ? reason.replace(/_/g, " ") : null;
}

export function buildRegistryToolSearchCatalog(
  plan: RegistryToolExposurePlan,
): ToolSearchCatalogEntry[] {
  return plan.items.map((item) => ({
    name: item.summary.name,
    description: item.summary.description,
    category: item.summary.category,
    family: "registry",
    availability: item.exposure,
    reason: formatToolExposureReason(item.reason),
  }));
}

export function buildRegistryToolExposurePlan(
  options: RegistryToolExposurePlanOptions,
): RegistryToolExposurePlan {
  const summaries = new Map<ToolName, ToolDefinitionSummary>(
    listToolDefinitions().map((summary) => [summary.name, summary] as const),
  );
  const hasDbBinding =
    options.surface === "harness"
      ? isDbToolAvailableForSession(options)
      : true;

  const items: RegistryToolExposureItem[] = [];
  for (const summary of listToolDefinitions()) {
    const definition = getToolDefinition(summary.name) as
      | MakoToolDefinition<ToolName>
      | undefined;
    if (!definition) {
      continue;
    }

    const capabilities = inferRegistryToolCapabilities(definition);
    let exposure: ToolExposure = "immediate";
    let reason: ToolExposureReason | undefined;

    if (capabilities.deferEligible && options.surface === "harness") {
      exposure = "deferred";
      reason = "router_tool_hidden_from_model_surface";
    } else if (capabilities.requiresDbBinding && !hasDbBinding) {
      exposure = "blocked";
      reason = "requires_project_db_binding";
    }

    const item: RegistryToolExposureItem = {
      definition,
      summary: summaries.get(definition.name as ToolName) ?? summary,
      capabilities,
      exposure,
    };
    if (reason) {
      item.reason = reason;
    }
    items.push(item);
  }

  return {
    items,
    immediate: items.filter((item) => item.exposure === "immediate"),
    deferred: items.filter((item) => item.exposure === "deferred"),
    blocked: items.filter((item) => item.exposure === "blocked"),
  };
}
