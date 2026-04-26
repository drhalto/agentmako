import { z } from "zod";
import {
  buildRegistryToolExposurePlan,
  formatToolExposureReason,
  rankToolSearchEntries,
  type MakoToolDefinition,
  type ToolSearchCatalogEntry,
  type ToolServiceOptions,
} from "@mako-ai/tools";
import { ACTION_TOOLS } from "@mako-ai/harness-tools";
import { MEMORY_TOOLS } from "./memory-tools.js";
import { SEMANTIC_TOOLS } from "./semantic-tools.js";
import { SUB_AGENT_TOOLS } from "./sub-agent-tools.js";

interface ToolSearchDefinition {
  name: string;
  description: string;
  parameters: z.ZodType<{
    query: string;
    limit?: number;
  }>;
  execute(args: { query: string; limit?: number }): Promise<unknown>;
}

export interface HarnessToolExposurePlan {
  includeMemoryTools: boolean;
  includeSemanticTools: boolean;
  includeSubAgentTools: boolean;
  registryDefinitions: readonly MakoToolDefinition<string>[];
  toolSearch: ToolSearchDefinition;
}

const ToolSearchParams = z.object({
  query: z.string().min(1).describe("Tool name or capability to search for."),
  limit: z.number().int().min(1).max(20).optional(),
});

function buildToolSearch(
  catalog: readonly ToolSearchCatalogEntry[],
): ToolSearchDefinition {
  return {
    name: "tool_search",
    description:
      "Search the immediate, deferred, and blocked tool catalog. Use when you are unsure which tool fits a task or why a tool is unavailable in this session.",
    parameters: ToolSearchParams,
    async execute(args) {
      const results = rankToolSearchEntries(catalog, args.query, args.limit ?? 8).map(
        (entry: ToolSearchCatalogEntry) => ({
          name: entry.name,
          family: entry.family,
          availability: entry.availability,
          reason: entry.reason,
          description: entry.description,
          category: entry.category ?? null,
        }),
      );
      return {
        query: args.query,
        count: results.length,
        results,
      };
    },
  };
}

export function buildHarnessToolExposurePlan(input: {
  toolServiceOptions?: ToolServiceOptions;
  hasMemoryContext: boolean;
  hasSubAgentContext: boolean;
}): HarnessToolExposurePlan {
  const catalog: ToolSearchCatalogEntry[] = ACTION_TOOLS.map((toolDef) => ({
    name: toolDef.name,
    description: toolDef.description,
    family: "action",
    availability: "immediate",
    reason: null,
  }));

  for (const toolDef of MEMORY_TOOLS) {
    catalog.push({
      name: toolDef.name,
      description: toolDef.description,
      family: "memory",
      availability: input.hasMemoryContext ? "immediate" : "blocked",
      reason: input.hasMemoryContext
        ? null
        : "no memory context is bound to this session",
    });
  }

  for (const toolDef of SEMANTIC_TOOLS) {
    catalog.push({
      name: toolDef.name,
      description: toolDef.description,
      family: "semantic",
      availability: input.hasMemoryContext ? "immediate" : "blocked",
      reason: input.hasMemoryContext
        ? null
        : "semantic search requires the session memory/embedding context",
    });
  }

  for (const toolDef of SUB_AGENT_TOOLS) {
    catalog.push({
      name: toolDef.name,
      description: toolDef.description,
      family: "sub_agent",
      availability: input.hasSubAgentContext ? "immediate" : "blocked",
      reason: input.hasSubAgentContext
        ? null
        : "sub-agent context is not bound to this dispatch",
    });
  }

  let registryDefinitions: readonly MakoToolDefinition<string>[] = [];
  if (input.toolServiceOptions) {
    const registryPlan = buildRegistryToolExposurePlan({
      ...input.toolServiceOptions,
      surface: "harness",
    });
    registryDefinitions = registryPlan.immediate.map(
      (item) => item.definition,
    );
    for (const item of registryPlan.items) {
      catalog.push({
        name: item.summary.name,
        description: item.summary.description,
        category: item.summary.category,
        family: "registry",
        availability: item.exposure,
        reason: formatToolExposureReason(item.reason),
      });
    }
  }

  return {
    includeMemoryTools: input.hasMemoryContext,
    includeSemanticTools: input.hasMemoryContext,
    includeSubAgentTools: input.hasSubAgentContext,
    registryDefinitions,
    toolSearch: buildToolSearch(catalog),
  };
}
