import type { MakoApiService } from "@mako-ai/api";
import {
  extractAnswerResultFromToolOutput,
  extractImplementationHandoffArtifactFromToolOutput,
  extractReviewBundleArtifactFromToolOutput,
  extractTaskPreflightArtifactFromToolOutput,
  extractVerificationBundleArtifactFromToolOutput,
  type AnswerResult,
  type ImplementationHandoffArtifact,
  type RepoMapToolOutput,
  type ReviewBundleArtifact,
  type TaskPreflightArtifact,
  type VerificationBundleArtifact,
  type AnswerTrustState,
} from "@mako-ai/contracts";
import {
  COLORS,
  color,
  formatToolList,
  parseQueryKind,
  printJson,
  shouldUseInteractive,
  type CliOptions,
} from "../shared.js";

export async function runAnswerAskCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const projectReference = rawArgs[0];
  const queryKindValue = rawArgs[1];
  const queryText = rawArgs.slice(2).join(" ").trim();

  if (!projectReference || !queryKindValue || queryText === "") {
    throw new Error("Usage: mako answer ask <path-or-project-id> <query-kind> <question...>");
  }

  const status = api.getProjectStatus(projectReference);
  if (!status || !status.project) {
    throw new Error(`No attached project found for: ${projectReference}`);
  }

  if (shouldUseInteractive(cliOptions)) {
    console.log(color("Asking question…", COLORS.bright));
    console.log();
  }

  const result = await api.askQuestion(
    { projectId: status.project.projectId },
    parseQueryKind(queryKindValue),
    queryText,
  );
  if (shouldUseInteractive(cliOptions)) {
    printInteractiveAnswerResult(result, toolLabelForQueryKind(result.queryKind));
  } else {
    printJson(result);
  }
}

export async function runToolListCommand(api: MakoApiService, cliOptions: CliOptions): Promise<void> {
  const tools = api.listTools();
  if (shouldUseInteractive(cliOptions)) {
    console.log(formatToolList(tools));
  } else {
    printJson(tools);
  }
}

export async function runToolCallCommand(
  api: MakoApiService,
  rawArgs: string[],
  cliOptions: CliOptions,
): Promise<void> {
  const projectReference = rawArgs[0];
  const toolName = rawArgs[1];
  const jsonArgsText = rawArgs.slice(2).join(" ").trim();

  if (!projectReference || !toolName || jsonArgsText === "") {
    throw new Error("Usage: mako tool call <path-or-project-id> <tool-name> <json-args>");
  }

  let parsedArgs: Record<string, unknown>;
  try {
    const candidate = JSON.parse(jsonArgsText) as unknown;
    if (candidate == null || Array.isArray(candidate) || typeof candidate !== "object") {
      throw new Error("Tool arguments must be a JSON object.");
    }

    parsedArgs = candidate as Record<string, unknown>;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Tool arguments must be valid JSON.");
  }

  const { projectId: _ignoredProjectId, projectRef: _ignoredProjectRef, ...toolArgs } = parsedArgs;
  const result = await api.callTool(toolName, {
    ...toolArgs,
    projectRef: projectReference,
  });

  if (shouldUseInteractive(cliOptions)) {
    const answerResult = extractAnswerResultFromToolOutput(result);
    if (answerResult) {
      printInteractiveAnswerResult(answerResult, toolName);
    } else {
      const artifact =
        extractImplementationHandoffArtifactFromToolOutput(result) ??
        extractTaskPreflightArtifactFromToolOutput(result) ??
        extractReviewBundleArtifactFromToolOutput(result) ??
        extractVerificationBundleArtifactFromToolOutput(result);
      if (artifact) {
        printInteractiveArtifactResult(artifact, toolName);
      } else if (isRepoMapToolOutput(result)) {
        printInteractiveRepoMapResult(result, toolName);
      } else {
        console.log(color(`Tool: ${toolName}`, COLORS.bright + COLORS.cyan));
        console.log();
        printJson(result);
      }
    }
  } else {
    printJson(result);
  }
}

function printInteractiveAnswerResult(result: AnswerResult, toolLabel: string): void {
  console.log(color(`${toolLabel}:`, COLORS.bright + COLORS.cyan));
  console.log(result.answer ?? color("(no answer provided)", COLORS.gray));
  console.log();
  console.log(color(`Confidence: ${formatPercent(result.answerConfidence ?? 0)}`, COLORS.gray));
  console.log(color(`Evidence: ${result.packet.evidence.length} item(s)`, COLORS.gray));

  if (result.trust) {
    console.log(color(`Trust: ${result.trust.state}`, trustColor(result.trust.state)));
    if (result.trust.reasons.length > 0) {
      console.log(color(`Reason: ${result.trust.reasons.map((reason) => reason.code).join(", ")}`, COLORS.gray));
    }
    if (result.trust.comparisonSummary.length > 0) {
      console.log(
        color(
          `Compare: ${result.trust.comparisonSummary.map((change) => change.code).join(", ")}`,
          COLORS.gray,
        ),
      );
    }
  }

  if (result.ranking) {
    console.log(
      color(
        `Ranking: ${result.ranking.deEmphasized ? "de-emphasized" : "normal"} (${result.ranking.orderKey})`,
        result.ranking.deEmphasized ? COLORS.yellow : COLORS.gray,
      ),
    );
  }

  const diagnostics = result.diagnostics ?? [];
  if (diagnostics.length > 0) {
    console.log();
    console.log(color(`Diagnostics (${diagnostics.length}):`, COLORS.bright));
    for (const diagnostic of diagnostics.slice(0, 5)) {
      const location = diagnostic.path
        ? `${diagnostic.path}${typeof diagnostic.line === "number" ? `:${diagnostic.line}` : ""}`
        : null;
      console.log(
        color(
          `- ${diagnostic.code}${location ? ` @ ${location}` : ""}`,
          diagnostic.severity === "critical" || diagnostic.severity === "high" ? COLORS.yellow : COLORS.gray,
        ),
      );
    }
    if (diagnostics.length > 5) {
      console.log(color(`- +${diagnostics.length - 5} more`, COLORS.gray));
    }
  }

  if (result.companionPacket) {
    console.log();
    console.log(color(`Workflow Packet: ${result.companionPacket.packet.family}`, COLORS.bright));
    if (result.companionPacket.attachmentReason) {
      console.log(color(`Attached: ${result.companionPacket.attachmentReason}`, COLORS.gray));
    }
    if (result.companionPacket.handoff) {
      console.log(color(`Current: ${result.companionPacket.handoff.current}`, COLORS.gray));
      console.log(color(`Stop When: ${result.companionPacket.handoff.stopWhen}`, COLORS.gray));
      if (result.companionPacket.handoff.refreshWhen) {
        console.log(color(`Refresh When: ${result.companionPacket.handoff.refreshWhen}`, COLORS.gray));
      }
    } else {
      console.log(color(result.companionPacket.rendered, COLORS.gray));
    }
  }

  if (result.candidateActions.length > 0) {
    console.log();
    console.log(color(`Next Actions (${result.candidateActions.length}):`, COLORS.bright));
    for (const action of result.candidateActions.slice(0, 4)) {
      console.log(color(`- ${action.label}`, COLORS.gray));
      console.log(color(`  ${action.description}`, COLORS.gray));
      if (action.execute) {
        console.log(color(`  Executes: ${action.execute.toolName}`, COLORS.gray));
      }
    }
    if (result.candidateActions.length > 4) {
      console.log(color(`- +${result.candidateActions.length - 4} more`, COLORS.gray));
    }
  }
}

function toolLabelForQueryKind(queryKind: string): string {
  return queryKind === "free_form" ? "Answer" : queryKind;
}

function printInteractiveArtifactResult(
  result:
    | ImplementationHandoffArtifact
    | TaskPreflightArtifact
    | ReviewBundleArtifact
    | VerificationBundleArtifact,
  toolLabel: string,
): void {
  console.log(color(`${toolLabel}:`, COLORS.bright + COLORS.cyan));
  console.log(color(`Artifact: ${result.kind}`, COLORS.gray));
  console.log();
  const markdown = result.renderings.find((rendering) => rendering.format === "markdown");
  if (markdown) {
    console.log(markdown.body);
  } else {
    printJson(result);
  }
  console.log();
  console.log(color(`Basis: ${result.basis.length} ref(s)`, COLORS.gray));
  console.log(color(`Generated: ${new Date(result.generatedAt).toLocaleString()}`, COLORS.gray));
}

function isRepoMapToolOutput(value: unknown): value is RepoMapToolOutput {
  return (
    value != null &&
    typeof value === "object" &&
    (value as { toolName?: unknown }).toolName === "repo_map" &&
    typeof (value as { rendered?: unknown }).rendered === "string"
  );
}

function printInteractiveRepoMapResult(result: RepoMapToolOutput, toolLabel: string): void {
  console.log(color(`${toolLabel}:`, COLORS.bright + COLORS.cyan));
  console.log();
  if (result.rendered.trim().length > 0) {
    console.log(result.rendered.trimEnd());
  } else {
    console.log(color("(no repo map content generated)", COLORS.gray));
  }
  console.log();
  console.log(
    color(
      `Files: ${result.files.length}/${result.totalFilesEligible} eligible (${result.totalFilesIndexed} indexed)`,
      COLORS.gray,
    ),
  );
  console.log(color(`Budget: ${result.estimatedTokens}/${result.tokenBudget} est tokens`, COLORS.gray));
  for (const warning of result.warnings.slice(0, 3)) {
    console.log(color(`Warning: ${warning}`, COLORS.gray));
  }
}

function trustColor(state: AnswerTrustState): string {
  switch (state) {
    case "stable":
      return COLORS.green;
    case "changed":
    case "aging":
      return COLORS.yellow;
    case "stale":
    case "superseded":
    case "insufficient_evidence":
    case "contradicted":
      return COLORS.red;
    default:
      return COLORS.gray;
  }
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
