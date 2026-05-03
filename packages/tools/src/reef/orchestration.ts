import type {
  ProjectOpenLoopsToolInput,
  ReefImpactToolInput,
  ReefImpactToolOutput,
  ReefStatusToolInput,
  ReefStatusToolOutput,
  ReefVerifyToolInput,
  ReefVerifyToolOutput,
  VerificationSourceState,
} from "@mako-ai/contracts";
import type { ToolServiceOptions } from "../runtime.js";
import { reefAgentStatusTool } from "./agent-status.js";
import { reefDiffImpactTool } from "./diff-impact.js";
import { projectOpenLoopsTool } from "./open-loops.js";
import { buildReefToolExecution } from "./tool-execution.js";
import { verificationStateTool } from "./verification.js";

export async function reefStatusTool(
  input: ReefStatusToolInput,
  options: ToolServiceOptions = {},
): Promise<ReefStatusToolOutput> {
  const status = await reefAgentStatusTool(input, options);
  return {
    ...status,
    toolName: "reef_status",
  };
}

export async function reefImpactTool(
  input: ReefImpactToolInput,
  options: ToolServiceOptions = {},
): Promise<ReefImpactToolOutput> {
  const impact = await reefDiffImpactTool(input, options);
  return {
    ...impact,
    toolName: "reef_impact",
  };
}

export async function reefVerifyTool(
  input: ReefVerifyToolInput,
  options: ToolServiceOptions = {},
): Promise<ReefVerifyToolOutput> {
  const startedAtMs = Date.now();
  const verification = await verificationStateTool(input, options);
  const includeOpenLoops = input.includeOpenLoops ?? true;
  const openLoops = includeOpenLoops
    ? await projectOpenLoopsTool(openLoopsInput(input, verification.projectId), options)
    : undefined;
  const summary = {
    verificationStatus: verification.status,
    sourceCount: verification.sources.length,
    staleSourceCount: countSources(verification.sources, "stale"),
    failedSourceCount: countSources(verification.sources, "failed"),
    unknownSourceCount: countSources(verification.sources, "unknown"),
    changedFileCount: verification.changedFiles.length,
    recentRunCount: verification.recentRuns.length,
    openLoopCount: openLoops?.summary.total ?? 0,
    openLoopErrorCount: openLoops?.summary.errors ?? 0,
    openLoopWarningCount: openLoops?.summary.warnings ?? 0,
    canClaimVerified: verification.status === "fresh" && (openLoops?.summary.errors ?? 0) === 0,
  };
  const suggestedActions = uniqueActions([
    ...verification.suggestedActions,
    ...(openLoops && openLoops.summary.errors > 0
      ? ["Resolve or explicitly acknowledge error open loops before claiming the work is complete."]
      : []),
    ...(openLoops && openLoops.summary.warnings > 0
      ? ["Review warning open loops and decide whether they block the current change."]
      : []),
    ...(summary.canClaimVerified
      ? ["Verification state is fresh and no error open loop is currently known."]
      : []),
  ]);
  const reefExecution = await buildReefToolExecution({
    toolName: "reef_verify",
    projectId: verification.projectId,
    projectRoot: verification.projectRoot,
    options,
    startedAtMs,
    freshnessPolicy: "allow_stale_labeled",
    staleEvidenceLabeled: summary.staleSourceCount +
      summary.failedSourceCount +
      summary.unknownSourceCount +
      summary.changedFileCount +
      summary.openLoopWarningCount,
    returnedCount: summary.sourceCount +
      summary.recentRunCount +
      summary.changedFileCount +
      summary.openLoopCount,
  });

  return {
    toolName: "reef_verify",
    projectId: verification.projectId,
    projectRoot: verification.projectRoot,
    status: verification.status,
    verification,
    ...(openLoops ? { openLoops } : {}),
    summary,
    reefExecution,
    suggestedActions,
    warnings: [
      ...verification.warnings,
      ...(openLoops?.warnings ?? []),
    ],
  };
}

function openLoopsInput(
  input: ReefVerifyToolInput,
  projectId: string,
): ProjectOpenLoopsToolInput {
  return {
    projectId,
    ...(input.files?.length === 1 ? { filePath: input.files[0] } : {}),
    ...(input.includeAcknowledgedLoops !== undefined
      ? { includeAcknowledged: input.includeAcknowledgedLoops }
      : {}),
    limit: input.openLoopsLimit ?? input.limit ?? 100,
    ...(input.cacheStalenessMs !== undefined ? { cacheStalenessMs: input.cacheStalenessMs } : {}),
  };
}

function countSources(
  sources: readonly VerificationSourceState[],
  status: VerificationSourceState["status"],
): number {
  return sources.filter((source) => source.status === status).length;
}

function uniqueActions(actions: readonly string[]): string[] {
  return [...new Set(actions.filter((action) => action.trim().length > 0))];
}
