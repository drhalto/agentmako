import type { MakoApiService } from "@mako-ai/api";
import type {
  QueryKind,
  WorkflowContextItemKind,
  WorkflowPacketFamily,
} from "@mako-ai/contracts";
import {
  COLORS,
  color,
  printJson,
  shouldUseInteractive,
  type CliOptions,
} from "../shared.js";

const WORKFLOW_PACKET_FAMILIES = [
  "implementation_brief",
  "impact_packet",
  "precedent_pack",
  "verification_plan",
  "workflow_recipe",
] as const satisfies readonly WorkflowPacketFamily[];

const WORKFLOW_QUERY_KINDS = [
  "route_trace",
  "schema_usage",
  "auth_path",
  "file_health",
  "free_form",
  "trace_file",
  "preflight_table",
  "cross_search",
  "trace_edge",
  "trace_error",
  "trace_table",
  "trace_rpc",
] as const satisfies readonly QueryKind[];

const WORKFLOW_FOCUS_KINDS = [
  "answer_packet",
  "file",
  "symbol",
  "route",
  "rpc",
  "table",
  "diagnostic",
  "trust_evaluation",
  "comparison",
] as const satisfies readonly WorkflowContextItemKind[];

interface WorkflowPacketCommandArgs {
  projectRef: string;
  family: WorkflowPacketFamily;
  queryKind: QueryKind;
  queryText: string;
  watchMode?: "watch";
  scope?: "primary" | "all";
  focusKinds?: WorkflowContextItemKind[];
  focusItemIds?: string[];
}

export async function runWorkflowPacketCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const parsed = parseWorkflowPacketArgs(rawArgs);
  const surface = await api.generateWorkflowPacket({
    projectRef: parsed.projectRef,
    family: parsed.family,
    queryKind: parsed.queryKind,
    queryText: parsed.queryText,
    scope: parsed.scope,
    watchMode: parsed.watchMode,
    focusKinds: parsed.focusKinds,
    focusItemIds: parsed.focusItemIds,
  });

  if (!shouldUseInteractive(cliOptions)) {
    printJson(surface);
    return;
  }

  console.log(color(`Workflow Packet: ${surface.packet.family}`, COLORS.bright + COLORS.cyan));
  if (surface.handoff) {
    console.log(color(`Current: ${surface.handoff.current}`, COLORS.gray));
    console.log(color(`Stop When: ${surface.handoff.stopWhen}`, COLORS.gray));
    if (surface.handoff.refreshWhen) {
      console.log(color(`Refresh When: ${surface.handoff.refreshWhen}`, COLORS.gray));
    }
    console.log();
  }
  console.log(surface.rendered);
  console.log();
  console.log(
    color(
      `Watch: ${surface.watch.mode} (${surface.watch.refreshReason})`,
      surface.watch.mode === "watch" ? COLORS.yellow : COLORS.gray,
    ),
  );
  console.log(
    color(
      `Surface: generate=${surface.surfacePlan.generateWith}` +
        ` guided=${surface.surfacePlan.guidedConsumption ?? "none"}` +
        ` reusable=${surface.surfacePlan.reusableContext ?? "none"}`,
      COLORS.gray,
    ),
  );
  if (surface.watch.refreshTriggers.length > 0) {
    console.log();
    console.log(color("Refresh triggers:", COLORS.bright));
    for (const trigger of surface.watch.refreshTriggers.slice(0, 6)) {
      console.log(`  - ${trigger}`);
    }
    if (surface.watch.refreshTriggers.length > 6) {
      console.log(color(`  - +${surface.watch.refreshTriggers.length - 6} more`, COLORS.gray));
    }
  }
}

function parseWorkflowPacketArgs(rawArgs: string[]): WorkflowPacketCommandArgs {
  let watchMode: "watch" | undefined;
  let scope: "primary" | "all" | undefined;
  let focusKinds: WorkflowContextItemKind[] | undefined;
  let focusItemIds: string[] | undefined;
  const positional: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--watch") {
      watchMode = "watch";
      continue;
    }
    if (arg === "--scope") {
      const value = rawArgs[index + 1];
      if (value !== "primary" && value !== "all") {
        throw new Error("`--scope` must be `primary` or `all`.");
      }
      scope = value;
      index += 1;
      continue;
    }
    if (arg === "--focus-kind") {
      const value = rawArgs[index + 1];
      if (!value) {
        throw new Error("`--focus-kind` requires a comma-separated list.");
      }
      focusKinds = value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry): entry is WorkflowContextItemKind =>
          (WORKFLOW_FOCUS_KINDS as readonly string[]).includes(entry),
        );
      if (focusKinds.length === 0) {
        throw new Error(`\`--focus-kind\` must use one of: ${WORKFLOW_FOCUS_KINDS.join(", ")}`);
      }
      index += 1;
      continue;
    }
    if (arg === "--focus-item") {
      const value = rawArgs[index + 1];
      if (!value) {
        throw new Error("`--focus-item` requires a comma-separated list.");
      }
      focusItemIds = value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (focusItemIds.length === 0) {
        throw new Error("`--focus-item` requires at least one item id.");
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown workflow packet option: ${arg}`);
    }
    positional.push(arg);
  }

  const [projectRef, familyValue, queryKindValue, ...queryParts] = positional;
  const queryText = queryParts.join(" ").trim();
  if (!projectRef || !familyValue || !queryKindValue || queryText === "") {
    throw new Error(
      "Usage: agentmako workflow packet <path-or-project-id> <family> <query-kind> <question...> [--watch] [--scope primary|all] [--focus-kind kind1,kind2] [--focus-item id1,id2]",
    );
  }

  if (!(WORKFLOW_PACKET_FAMILIES as readonly string[]).includes(familyValue)) {
    throw new Error(`Unknown workflow packet family: ${familyValue}`);
  }
  if (!(WORKFLOW_QUERY_KINDS as readonly string[]).includes(queryKindValue)) {
    throw new Error(`Unknown workflow query kind: ${queryKindValue}`);
  }

  return {
    projectRef,
    family: familyValue as WorkflowPacketFamily,
    queryKind: queryKindValue as QueryKind,
    queryText,
    watchMode,
    scope,
    focusKinds,
    focusItemIds,
  };
}
