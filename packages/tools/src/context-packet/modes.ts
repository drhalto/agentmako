import type {
  ContextPacketMode,
  ContextPacketModePolicySummary,
} from "@mako-ai/contracts";
import type { ContextPacketExpandableToolName } from "./expandable-tools-catalog.js";

export const CONTEXT_PACKET_PROVIDER_NAMES = [
  "file_provider",
  "route_provider",
  "schema_provider",
  "symbol_provider",
  "import_graph_provider",
  "repo_map_provider",
  "hot_hint_index",
  "working_tree_overlay",
  "reef_convention",
] as const;

export type ContextPacketProviderName = (typeof CONTEXT_PACKET_PROVIDER_NAMES)[number];

export interface ContextPacketModePolicy {
  mode: ContextPacketMode;
  enabledProviders: readonly ContextPacketProviderName[];
  /**
   * Tools this mode recommends as expansion paths from the packet. The
   * builder layers state-driven additions (working_tree_overlay,
   * project_index_*) on top of this list when freshness/overlay state
   * warrants it.
   */
  expandableTools: readonly ContextPacketExpandableToolName[];
  defaultMaxPrimaryContext: number;
  defaultMaxRelatedContext: number;
  defaultBudgetTokens: number;
  includeInstructions: boolean;
  includeRisks: boolean;
  includeActiveFindings: boolean;
  includeExpandableTools: boolean;
}

const ALL_PROVIDERS = CONTEXT_PACKET_PROVIDER_NAMES;

export const CONTEXT_PACKET_MODE_POLICIES: Record<ContextPacketMode, ContextPacketModePolicy> = {
  explore: {
    mode: "explore",
    enabledProviders: ALL_PROVIDERS,
    expandableTools: [
      "repo_map",
      "live_text_search",
      "project_open_loops",
      "evidence_confidence",
    ],
    defaultMaxPrimaryContext: 8,
    defaultMaxRelatedContext: 16,
    defaultBudgetTokens: 2400,
    includeInstructions: true,
    includeRisks: true,
    includeActiveFindings: true,
    includeExpandableTools: true,
  },
  plan: {
    mode: "plan",
    enabledProviders: ALL_PROVIDERS,
    expandableTools: [
      "change_plan",
      "route_context",
      "table_neighborhood",
      "project_open_loops",
      "evidence_confidence",
    ],
    defaultMaxPrimaryContext: 10,
    defaultMaxRelatedContext: 20,
    defaultBudgetTokens: 3600,
    includeInstructions: true,
    includeRisks: true,
    includeActiveFindings: true,
    includeExpandableTools: true,
  },
  implement: {
    mode: "implement",
    enabledProviders: [
      "file_provider",
      "route_provider",
      "schema_provider",
      "symbol_provider",
      "import_graph_provider",
      "hot_hint_index",
      "working_tree_overlay",
      "reef_convention",
    ],
    expandableTools: [
      "live_text_search",
      "ast_find_pattern",
      "route_context",
      "table_neighborhood",
      "lint_files",
    ],
    defaultMaxPrimaryContext: 8,
    defaultMaxRelatedContext: 12,
    defaultBudgetTokens: 2400,
    includeInstructions: true,
    includeRisks: true,
    includeActiveFindings: true,
    includeExpandableTools: true,
  },
  review: {
    mode: "review",
    enabledProviders: ALL_PROVIDERS,
    expandableTools: [
      "verification_state",
      "project_open_loops",
      "change_plan",
      "lint_files",
      "evidence_confidence",
    ],
    defaultMaxPrimaryContext: 10,
    defaultMaxRelatedContext: 24,
    defaultBudgetTokens: 3200,
    includeInstructions: true,
    includeRisks: true,
    includeActiveFindings: true,
    includeExpandableTools: true,
  },
};

export function resolveContextPacketModePolicy(
  mode: ContextPacketMode | undefined,
): ContextPacketModePolicy {
  return CONTEXT_PACKET_MODE_POLICIES[mode ?? "explore"];
}

export function providerEnabled(
  policy: ContextPacketModePolicy,
  providerName: ContextPacketProviderName,
): boolean {
  return policy.enabledProviders.includes(providerName);
}

export function contextPacketModePolicySummary(args: {
  policy: ContextPacketModePolicy;
  includeInstructions: boolean;
  includeRisks: boolean;
  includeActiveFindings: boolean;
  includeExpandableTools: boolean;
}): ContextPacketModePolicySummary {
  const enabled = new Set(args.policy.enabledProviders);
  return {
    enabledProviders: [...args.policy.enabledProviders],
    disabledProviders: CONTEXT_PACKET_PROVIDER_NAMES.filter((name) => !enabled.has(name)),
    includeInstructions: args.includeInstructions,
    includeRisks: args.includeRisks,
    includeActiveFindings: args.includeActiveFindings,
    includeExpandableTools: args.includeExpandableTools,
  };
}
