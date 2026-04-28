import { loadConfig } from "@mako-ai/config";
import type {
  FactFreshness,
  JsonObject,
  ReefFreshnessPolicy,
  ReefProjectStatus,
  ReefRuntimeMode,
  ReefSnapshotBehavior,
  ReefToolExecution,
  ReefToolQueryPath,
  ReefToolServiceMode,
  ReefToolSnapshotState,
} from "@mako-ai/contracts";
import { appendReefOperation } from "@mako-ai/indexer";
import type { ToolServiceOptions } from "../runtime.js";

const DEFAULT_SLOW_REEF_TOOL_QUERY_MS = 250;

interface ReefToolExecutionInput {
  toolName: string;
  projectId: string;
  projectRoot: string;
  options: ToolServiceOptions;
  startedAtMs: number;
  freshnessPolicy?: ReefFreshnessPolicy;
  snapshotBehavior?: ReefSnapshotBehavior;
  queryPath?: ReefToolQueryPath;
  staleEvidenceDropped?: number;
  staleEvidenceLabeled?: number;
  returnedCount?: number;
}

export interface ReefFreshnessFilterResult<T> {
  items: T[];
  staleEvidenceDropped: number;
  staleEvidenceLabeled: number;
  warnings: string[];
}

export interface ReefToolExecutionResult {
  execution: ReefToolExecution;
  projectStatus?: ReefProjectStatus;
}

export function defaultReefToolFreshnessPolicy(policy: ReefFreshnessPolicy | undefined): ReefFreshnessPolicy {
  return policy ?? "require_fresh";
}

export function applyReefToolFreshnessPolicy<T extends { freshness: FactFreshness }>(
  items: readonly T[],
  policy: ReefFreshnessPolicy,
  itemLabel: string,
): ReefFreshnessFilterResult<T> {
  const staleItems = items.filter((item) => item.freshness.state !== "fresh");
  if (policy !== "allow_stale_labeled") {
    const freshItems = items.filter((item) => item.freshness.state === "fresh");
    return {
      items: freshItems,
      staleEvidenceDropped: staleItems.length,
      staleEvidenceLabeled: 0,
      warnings: staleItems.length > 0
        ? [freshnessPolicyDropWarning(staleItems.length, itemLabel, policy)]
        : [],
    };
  }

  return {
    items: [...items],
    staleEvidenceDropped: 0,
    staleEvidenceLabeled: staleItems.length,
    warnings: [],
  };
}

export async function buildReefToolExecution(input: ReefToolExecutionInput): Promise<ReefToolExecution> {
  const result = await buildReefToolExecutionWithStatus(input);
  return result.execution;
}

export async function buildReefToolExecutionWithStatus(input: ReefToolExecutionInput): Promise<ReefToolExecutionResult> {
  const reefMode = resolveToolReefMode(input.options);
  const freshnessPolicy = defaultReefToolFreshnessPolicy(input.freshnessPolicy);
  const snapshotBehavior = input.snapshotBehavior ?? "latest";
  const reefStatus = await loadReefStatus({
    projectId: input.projectId,
    reefMode,
    options: input.options,
  });
  const fallbackReason = fallbackReasonForStatus(reefMode, reefStatus);
  const serviceMode = serviceModeForStatus(reefMode, reefStatus.status);
  const queryPath = reefMode === "legacy" ? "legacy" : (input.queryPath ?? "reef_materialized_view");
  let execution: ReefToolExecution = {
    reefMode,
    serviceMode,
    queryPath,
    freshnessPolicy,
    snapshot: {
      behavior: snapshotBehavior,
      ...(reefStatus.status?.analysis.currentRevision !== undefined
        ? { revision: reefStatus.status.analysis.currentRevision }
        : {}),
      ...(reefStatus.status?.analysis.materializedRevision !== undefined
        ? { materializedRevision: reefStatus.status.analysis.materializedRevision }
        : {}),
      state: snapshotStateFromProjectStatus(reefStatus.status),
    },
    ...(reefStatus.status ? { watcher: watcherExecutionFromStatus(reefStatus.status) } : {}),
    ...(fallbackReason ? { fallback: { used: true, reason: fallbackReason } } : { fallback: { used: false } }),
    durationMs: Math.max(0, Date.now() - input.startedAtMs),
  };

  const operation = await appendQueryPathOperation(input, execution).catch(() => undefined);
  if (operation?.id) {
    execution = { ...execution, operationId: operation.id };
  }

  if (execution.fallback?.used) {
    await appendFallbackOperation(input, execution).catch(() => undefined);
  }

  return {
    execution,
    ...(reefStatus.status ? { projectStatus: reefStatus.status } : {}),
  };
}

function freshnessPolicyDropWarning(count: number, itemLabel: string, policy: ReefFreshnessPolicy): string {
  switch (policy) {
    case "require_fresh":
      return `Dropped ${count} stale ${itemLabel} under freshnessPolicy=require_fresh.`;
    case "wait_for_refresh":
      return `Dropped ${count} stale ${itemLabel} after freshnessPolicy=wait_for_refresh did not yield fresh item evidence.`;
    case "live_fallback":
      return `Dropped ${count} stale ${itemLabel} because freshnessPolicy=live_fallback has no live fallback for this materialized evidence path.`;
    case "allow_stale_labeled":
      return `Returned ${count} stale ${itemLabel} under freshnessPolicy=allow_stale_labeled.`;
    default: {
      const exhaustive: never = policy;
      return exhaustive;
    }
  }
}

function resolveToolReefMode(options: ToolServiceOptions): ReefRuntimeMode {
  return loadConfig(options.configOverrides).reef.mode;
}

async function loadReefStatus(args: {
  projectId: string;
  reefMode: ReefRuntimeMode;
  options: ToolServiceOptions;
}): Promise<{ status?: ReefProjectStatus; error?: string; directReason?: string }> {
  if (args.reefMode === "legacy") {
    return { directReason: "MAKO_REEF_MODE=legacy bypassed Reef service routing." };
  }
  if (!args.options.reefService) {
    if (args.reefMode === "required") {
      throw new Error("MAKO_REEF_MODE=required requires a Reef daemon-backed service for migrated Reef tools.");
    }
    return { directReason: "No Reef service was provided; reading the Reef materialized store directly." };
  }

  try {
    const status = await args.options.reefService.getProjectStatus(args.projectId);
    if (args.reefMode === "required" && status.serviceMode !== "daemon") {
      throw new Error(`MAKO_REEF_MODE=required expected daemon service mode, received ${status.serviceMode}.`);
    }
    return { status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.reefMode === "required") {
      throw new Error(`MAKO_REEF_MODE=required could not read Reef project status: ${message}`);
    }
    return { error: message };
  }
}

function fallbackReasonForStatus(
  reefMode: ReefRuntimeMode,
  status: { status?: ReefProjectStatus; error?: string; directReason?: string },
): string | undefined {
  if (reefMode === "legacy") {
    return status.directReason ?? "legacy mode selected";
  }
  if (status.directReason) {
    return status.directReason;
  }
  if (status.error) {
    return `Reef service status unavailable; using direct materialized-store read. ${status.error}`;
  }
  if (reefMode === "auto" && status.status?.serviceMode === "in_process") {
    return "Auto mode used the in-process Reef service.";
  }
  return undefined;
}

function serviceModeForStatus(
  reefMode: ReefRuntimeMode,
  status: ReefProjectStatus | undefined,
): ReefToolServiceMode {
  if (reefMode === "legacy") return "legacy";
  return status?.serviceMode ?? "direct";
}

function snapshotStateFromProjectStatus(status: ReefProjectStatus | undefined): ReefToolSnapshotState {
  switch (status?.state) {
    case "fresh":
      return "fresh";
    case "refreshing":
      return "refreshing";
    case "dirty":
    case "stale":
      return "stale";
    default:
      return "unknown";
  }
}

function watcherExecutionFromStatus(status: ReefProjectStatus): NonNullable<ReefToolExecution["watcher"]> {
  return {
    active: status.watcher.active,
    degraded: status.watcher.degraded,
    recrawlCount: status.watcher.recrawlCount,
    ...(status.watcher.lastRecrawlReason ? { lastRecrawlReason: status.watcher.lastRecrawlReason } : {}),
    ...(status.watcher.lastCatchUpStatus ? { lastCatchUpStatus: status.watcher.lastCatchUpStatus } : {}),
  };
}

async function appendQueryPathOperation(
  input: ReefToolExecutionInput,
  execution: ReefToolExecution,
) {
  const slowQueryBudgetMs = DEFAULT_SLOW_REEF_TOOL_QUERY_MS;
  const slow = execution.durationMs > slowQueryBudgetMs;
  return await appendReefOperation(input.options, {
    projectId: input.projectId,
    root: input.projectRoot,
    kind: "query_path",
    severity: slow ? "warning" : "debug",
    message: slow ? "reef tool query exceeded budget" : "reef tool query path selected",
    data: operationData({
      toolName: input.toolName,
      reefMode: execution.reefMode,
      serviceMode: execution.serviceMode,
      queryPath: execution.queryPath,
      freshnessPolicy: execution.freshnessPolicy,
      snapshotBehavior: execution.snapshot.behavior,
      snapshotState: execution.snapshot.state,
      durationMs: execution.durationMs,
      slow,
      slowQueryBudgetMs,
      ...(execution.snapshot.revision !== undefined ? { revision: execution.snapshot.revision } : {}),
      ...(execution.snapshot.materializedRevision !== undefined
        ? { materializedRevision: execution.snapshot.materializedRevision }
        : {}),
      ...(input.staleEvidenceDropped !== undefined ? { staleEvidenceDropped: input.staleEvidenceDropped } : {}),
      ...(input.staleEvidenceLabeled !== undefined ? { staleEvidenceLabeled: input.staleEvidenceLabeled } : {}),
      ...(input.returnedCount !== undefined ? { returnedCount: input.returnedCount } : {}),
      ...(execution.fallback?.used ? { fallbackReason: execution.fallback.reason ?? "fallback selected" } : {}),
      ...(execution.watcher ? { watcherRecrawlCount: execution.watcher.recrawlCount } : {}),
      ...(execution.watcher?.lastCatchUpStatus ? { watcherLastCatchUpStatus: execution.watcher.lastCatchUpStatus } : {}),
    }),
  });
}

async function appendFallbackOperation(
  input: ReefToolExecutionInput,
  execution: ReefToolExecution,
): Promise<void> {
  await appendReefOperation(input.options, {
    projectId: input.projectId,
    root: input.projectRoot,
    kind: "fallback_used",
    severity: execution.reefMode === "legacy" ? "info" : "warning",
    message: "reef tool fallback selected",
    data: operationData({
      toolName: input.toolName,
      reefMode: execution.reefMode,
      serviceMode: execution.serviceMode,
      queryPath: execution.queryPath,
      reason: execution.fallback?.reason ?? "fallback selected",
    }),
  });
}

function operationData(data: Record<string, string | number | boolean>): JsonObject {
  return data as JsonObject;
}
