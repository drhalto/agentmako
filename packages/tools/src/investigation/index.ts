import type {
  AnswerResult,
  AskToolInput,
  ChangePlanResult,
  ChangePlanToolInput,
  FlowMapResult,
  FlowMapToolInput,
  GraphNodeLocator,
  GraphTraversalDirection,
  HealthTrendResult,
  HealthTrendToolInput,
  InvestigateResult,
  InvestigateToolInput,
  InvestigateToolOutput,
  InvestigationStep,
  InvestigationStopReason,
  InvestigationStrategy,
  IssuesNextResult,
  IssuesNextToolInput,
  JsonObject,
  SessionHandoffResult,
  SessionHandoffToolInput,
  SuggestResult,
  SuggestToolInput,
  SuggestToolOutput,
  TenantLeakAuditResult,
  TenantLeakAuditToolInput,
  ToolName,
  WorkflowPacketFollowOnHint,
} from "@mako-ai/contracts";
import { extractAnswerResultFromToolOutput } from "@mako-ai/contracts";
import { hashJson } from "@mako-ai/store";
import { executeAskSelection, routeAskQuestion, type AskToolSelection } from "../ask/index.js";
import { changePlanTool, flowMapTool } from "../graph/index.js";
import { tenantLeakAuditTool } from "../operators/index.js";
import { healthTrendTool, issuesNextTool, sessionHandoffTool } from "../project-intelligence/index.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";

interface PlannedInvestigationStep {
  stepId: string;
  title: string;
  toolName: ToolName;
  toolInput: JsonObject;
  inputSummary: string;
  rationale: string;
  selectionConfidence?: number;
  askSelection?: AskToolSelection;
}

interface InvestigationPlan {
  strategy: InvestigationStrategy;
  steps: PlannedInvestigationStep[];
  warnings: string[];
}

interface StepExecutionSummary {
  resultSummary?: string;
  resultRefs: string[];
  warnings: string[];
  followOn?: WorkflowPacketFollowOnHint;
}

const DEFAULT_SUGGEST_MAX_STEPS = 3;
const DEFAULT_INVESTIGATE_BUDGET = 3;
const ASK_ROUTED_MIN_CONFIDENCE = 0.8;

export async function suggestTool(
  input: SuggestToolInput,
  options: ToolServiceOptions = {},
): Promise<SuggestToolOutput> {
  return withProjectContext(input, options, async ({ project }) => {
    const plan = planInvestigation({
      ...input,
      projectId: project.projectId,
    });
    const maxSteps = normalizeSuggestMaxSteps(input.maxSteps);
    const warnings = [...plan.warnings];
    const limitedSteps = plan.steps.slice(0, maxSteps);

    let stopReason: InvestigationStopReason = "unsupported";
    if (limitedSteps.length === 0) {
      stopReason = "unsupported";
    } else if (plan.steps.length > maxSteps) {
      stopReason = "budget_exhausted";
      warnings.push(`suggest recommendation truncated at ${maxSteps} step(s).`);
    } else if (limitedSteps.length === 1) {
      stopReason = "satisfied_by_canonical_tool";
    } else {
      stopReason = "bounded_investigation_completed";
    }

    const result: SuggestResult = {
      strategy: limitedSteps.length > 0 ? plan.strategy : "unsupported",
      stopReason,
      steps: limitedSteps.map((step) => createTodoStep(step)),
      warnings,
    };

    return {
      toolName: "suggest",
      projectId: project.projectId,
      result,
    };
  });
}

export async function investigateTool(
  input: InvestigateToolInput,
  options: ToolServiceOptions = {},
): Promise<InvestigateToolOutput> {
  return withProjectContext(input, options, async ({ project }) => {
    const plan = planInvestigation({
      ...input,
      projectId: project.projectId,
    });
    const budget = normalizeInvestigateBudget(input.budget);
    const warnings = [...plan.warnings];
    const followOnHints: WorkflowPacketFollowOnHint[] = [];
    const steps = plan.steps.map((step) => createTodoStep(step));

    if (steps.length === 0) {
      return {
        toolName: "investigate",
        projectId: project.projectId,
        result: {
          strategy: "unsupported",
          stopReason: "unsupported",
          budget,
          executedStepCount: 0,
          steps,
          followOnHints,
          warnings,
        },
      };
    }

    let executedStepCount = 0;
    let stopReason: InvestigationStopReason | null = null;

    for (let index = 0; index < plan.steps.length; index += 1) {
      if (executedStepCount >= budget) {
        stopReason = "budget_exhausted";
        warnings.push(`investigation stopped after ${budget} executed step(s); budget exhausted.`);
        break;
      }

      const plannedStep = plan.steps[index];
      const step = steps[index];
      step.status = "in_progress";
      await options.progressReporter?.report({
        stage: plannedStep.toolName,
        message: `Running investigation sub-tool ${plannedStep.toolName}.`,
        current: executedStepCount + 1,
        total: Math.min(plan.steps.length, budget),
      });

      try {
        const output = await runPlannedStep(plannedStep, input.question, options);
        const summary = summarizeToolOutput(output);
        step.status = "done";
        step.resultSummary = summary.resultSummary;
        step.resultRefs = summary.resultRefs;
        step.warnings = summary.warnings;
        if (summary.followOn) {
          step.followOn = summary.followOn;
          pushUniqueFollowOnHint(followOnHints, summary.followOn);
        }
        warnings.push(...summary.warnings);
        executedStepCount += 1;
      } catch (error) {
        step.status = "todo";
        const message = error instanceof Error ? error.message : String(error);
        const warning = `investigation step \`${plannedStep.toolName}\` failed: ${message}`;
        step.warnings = [warning];
        warnings.push(warning);
        stopReason = "unsupported";
        break;
      }
    }

    if (stopReason == null) {
      stopReason =
        plan.steps.length === 1
          ? "satisfied_by_canonical_tool"
          : "bounded_investigation_completed";
    }

    const result: InvestigateResult = {
      strategy: plan.strategy,
      stopReason,
      budget,
      executedStepCount,
      steps,
      followOnHints,
      warnings,
    };

    return {
      toolName: "investigate",
      projectId: project.projectId,
      result,
    };
  });
}

function planInvestigation(
  input: (SuggestToolInput | InvestigateToolInput) & { projectId: string },
): InvestigationPlan {
  const warnings: string[] = [];
  const graphPlan = planGraphWorkflow(input);
  if (graphPlan) {
    return graphPlan;
  }

  if (input.startEntity || input.targetEntity) {
    warnings.push(
      "graph-backed suggest/investigate requires both `startEntity` and `targetEntity`; partial graph input was ignored.",
    );
  }

  if (looksLikeTenantAuditQuestion(input.question)) {
    return {
      strategy: "tenant_audit",
      steps: [
        createPlannedStep({
          toolName: "tenant_leak_audit",
          toolInput: {
            projectId: input.projectId,
            acknowledgeAdvisory: true,
          },
          title: "Run the tenant-boundary audit",
          inputSummary: "tenant boundary audit for the attached project",
          rationale: "The question is about tenant isolation, RLS, or cross-tenant leakage.",
        }),
      ],
      warnings,
    };
  }

  const projectIntelligencePlan = planProjectIntelligenceWorkflow(input);
  if (projectIntelligencePlan) {
    projectIntelligencePlan.warnings.unshift(...warnings);
    return projectIntelligencePlan;
  }

  const askSelection = routeAskQuestion({
    question: input.question,
    projectId: input.projectId,
  } satisfies AskToolInput);
  if (askSelection.mode === "tool") {
    if (askSelection.confidence < ASK_ROUTED_MIN_CONFIDENCE) {
      warnings.push(
        `Ask-routed canonical fallback was skipped because routing confidence ${askSelection.confidence.toFixed(2)} is below the ${ASK_ROUTED_MIN_CONFIDENCE.toFixed(2)} threshold.`,
      );
      return {
        strategy: "unsupported",
        steps: [],
        warnings,
      };
    }
    return {
      strategy: "ask_routed_canonical",
      steps: [
        createPlannedStep({
          toolName: askSelection.selectedTool,
          toolInput: askSelection.selectedArgs,
          title: `Run the canonical tool \`${askSelection.selectedTool}\``,
          inputSummary: summarizeToolInput(askSelection.selectedTool, askSelection.selectedArgs),
          rationale: "One deterministic named tool already answers this question cleanly.",
          selectionConfidence: askSelection.confidence,
          askSelection,
        }),
      ],
      warnings,
    };
  }

  warnings.push("No bounded workflow or deterministic named tool matched this question.");
  return {
    strategy: "unsupported",
    steps: [],
    warnings,
  };
}

function planGraphWorkflow(
  input: (SuggestToolInput | InvestigateToolInput) & { projectId: string },
): InvestigationPlan | null {
  if (!input.startEntity || !input.targetEntity) {
    return null;
  }

  const graphInput = {
    projectId: input.projectId,
    startEntity: toGraphNodeLocatorJson(input.startEntity),
    targetEntity: toGraphNodeLocatorJson(input.targetEntity),
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.traversalDepth ? { traversalDepth: input.traversalDepth } : {}),
    ...(typeof input.includeHeuristicEdges === "boolean"
      ? { includeHeuristicEdges: input.includeHeuristicEdges }
      : {}),
  } satisfies JsonObject;

  const wantsChange = looksLikeChangeQuestion(input.question);
  const wantsFlow = looksLikeFlowQuestion(input.question);

  if (wantsChange && wantsFlow) {
    return {
      strategy: "flow_then_change",
      steps: [
        createPlannedStep({
          toolName: "flow_map",
          toolInput: graphInput,
          title: "Map the flow between the requested entities",
          inputSummary: summarizeGraphInput(input.startEntity, input.targetEntity),
          rationale: "The question asks both how the entities connect and what changes would be affected.",
        }),
        createPlannedStep({
          toolName: "change_plan",
          toolInput: graphInput,
          title: "Build a bounded change plan for the same path",
          inputSummary: summarizeGraphInput(input.startEntity, input.targetEntity),
          rationale: "After the flow is known, derive direct and dependent change surfaces from the same graph path.",
        }),
      ],
      warnings: [],
    };
  }

  if (wantsChange) {
    return {
      strategy: "change_scope",
      steps: [
        createPlannedStep({
          toolName: "change_plan",
          toolInput: graphInput,
          title: "Build a bounded change plan",
          inputSummary: summarizeGraphInput(input.startEntity, input.targetEntity),
          rationale: "The question is primarily about impact, touched surfaces, or edit ordering.",
        }),
      ],
      warnings: [],
    };
  }

  return {
    strategy: "graph_flow",
    steps: [
      createPlannedStep({
        toolName: "flow_map",
        toolInput: graphInput,
        title: "Map the graph flow",
        inputSummary: summarizeGraphInput(input.startEntity, input.targetEntity),
        rationale: "The question is primarily about how two entities connect through the shipped graph workflows.",
      }),
    ],
    warnings: [],
  };
}

function planProjectIntelligenceWorkflow(
  input: (SuggestToolInput | InvestigateToolInput) & { projectId: string },
): InvestigationPlan | null {
  const wantsHandoff = looksLikeHandoffQuestion(input.question);
  const wantsNext = looksLikeNextIssuesQuestion(input.question);
  const wantsHealth = looksLikeHealthTrendQuestion(input.question);

  if (!wantsHandoff && !wantsNext && !wantsHealth) {
    return null;
  }

  const baseInput = { projectId: input.projectId } satisfies JsonObject;
  const steps: PlannedInvestigationStep[] = [];

  if (wantsHandoff) {
    steps.push(
      createPlannedStep({
        toolName: "session_handoff",
        toolInput: baseInput,
        title: "Summarize the current project handoff",
        inputSummary: "recent unresolved project focus",
        rationale: "The question asks for current focus, resume state, or handoff context.",
      }),
    );
  }
  if (wantsNext) {
    steps.push(
      createPlannedStep({
        toolName: "issues_next",
        toolInput: baseInput,
        title: "Rank the next unresolved issues",
        inputSummary: "derived queue of recent unresolved issues",
        rationale: "The question asks what to do next or which unresolved issue should come first.",
      }),
    );
  }
  if (wantsHealth) {
    steps.push(
      createPlannedStep({
        toolName: "health_trend",
        toolInput: baseInput,
        title: "Check the recent health trend",
        inputSummary: "recent vs prior project health window",
        rationale: "The question asks about project trend, improvement, or regression.",
      }),
    );
  }

  const strategy: InvestigationStrategy =
    steps.length > 1
      ? "project_status"
      : steps[0]?.toolName === "session_handoff"
        ? "project_handoff"
        : steps[0]?.toolName === "issues_next"
          ? "project_queue"
          : "project_health";

  return {
    strategy,
    steps,
    warnings: [],
  };
}

function createPlannedStep(args: {
  toolName: ToolName;
  toolInput: JsonObject;
  title: string;
  inputSummary: string;
  rationale: string;
  selectionConfidence?: number;
  askSelection?: AskToolSelection;
}): PlannedInvestigationStep {
  return {
    stepId: `investigation_step_${hashJson({ toolName: args.toolName, input: args.toolInput, title: args.title }).slice(0, 10)}`,
    title: args.title,
    toolName: args.toolName,
    toolInput: args.toolInput,
    inputSummary: args.inputSummary,
    rationale: args.rationale,
    ...(typeof args.selectionConfidence === "number"
      ? { selectionConfidence: args.selectionConfidence }
      : {}),
    askSelection: args.askSelection,
  };
}

function createTodoStep(step: PlannedInvestigationStep): InvestigationStep {
  return {
    stepId: step.stepId,
    title: step.title,
    toolName: step.toolName,
    toolInput: step.toolInput,
    inputSummary: step.inputSummary,
    rationale: step.rationale,
    ...(typeof step.selectionConfidence === "number"
      ? { selectionConfidence: step.selectionConfidence }
      : {}),
    status: "todo",
    resultRefs: [],
    warnings: [],
  };
}

async function runPlannedStep(
  step: PlannedInvestigationStep,
  question: string,
  options: ToolServiceOptions,
): Promise<unknown> {
  switch (step.toolName) {
    case "flow_map":
      return flowMapTool(step.toolInput as unknown as FlowMapToolInput, options);
    case "change_plan":
      return changePlanTool(step.toolInput as unknown as ChangePlanToolInput, options);
    case "tenant_leak_audit":
      return tenantLeakAuditTool(step.toolInput as unknown as TenantLeakAuditToolInput, options);
    case "session_handoff":
      return sessionHandoffTool(step.toolInput as unknown as SessionHandoffToolInput, options);
    case "health_trend":
      return healthTrendTool(step.toolInput as unknown as HealthTrendToolInput, options);
    case "issues_next":
      return issuesNextTool(step.toolInput as unknown as IssuesNextToolInput, options);
    default:
      if (step.askSelection) {
        return executeAskSelection(
          step.askSelection,
          {
            question,
            ...(typeof step.toolInput.projectId === "string" ? { projectId: step.toolInput.projectId } : {}),
            ...(typeof step.toolInput.projectRef === "string" ? { projectRef: step.toolInput.projectRef } : {}),
          },
          options,
        );
      }
      throw new Error(`unsupported investigation tool: ${step.toolName}`);
  }
}

function summarizeToolOutput(output: unknown): StepExecutionSummary {
  if (!output || typeof output !== "object" || !("toolName" in output)) {
    return { resultRefs: [], warnings: [] };
  }

  const toolName = String(output.toolName);
  switch (toolName) {
    case "flow_map":
      return summarizeFlowMapOutput(output as unknown as { result: FlowMapResult });
    case "change_plan":
      return summarizeChangePlanOutput(output as unknown as { result: ChangePlanResult });
    case "tenant_leak_audit":
      return summarizeTenantLeakAuditOutput(output as unknown as { result: TenantLeakAuditResult });
    case "session_handoff":
      return summarizeSessionHandoffOutput(output as unknown as { result: SessionHandoffResult });
    case "health_trend":
      return summarizeHealthTrendOutput(output as unknown as { result: HealthTrendResult });
    case "issues_next":
      return summarizeIssuesNextOutput(output as unknown as { result: IssuesNextResult });
    default: {
      const answer = extractAnswerResultFromToolOutput(output) as AnswerResult | null;
      if (answer) {
        return {
          resultSummary: `${answer.queryKind} answered \`${answer.packet.queryText}\`.`,
          resultRefs: [`query:${answer.queryId}`],
          warnings: [],
        };
      }
      return {
        resultSummary: `Completed \`${toolName}\`.`,
        resultRefs: [],
        warnings: [],
      };
    }
  }
}

function summarizeFlowMapOutput(output: { result: FlowMapResult }): StepExecutionSummary {
  const { result } = output;
  return {
    resultSummary: result.pathFound
      ? `Mapped ${result.steps.length} flow step(s) across ${result.majorBoundaryKinds.join(", ")}.`
      : `No flow path found (${result.noPathReason ?? "disconnected"}).`,
    resultRefs: result.steps.map((step) => `${step.node.kind}:${step.node.key}`),
    warnings: result.warnings,
  };
}

function summarizeChangePlanOutput(output: { result: ChangePlanResult }): StepExecutionSummary {
  const { result } = output;
  return {
    resultSummary: result.pathFound
      ? `Planned ${result.directSurfaces.length} direct and ${result.dependentSurfaces.length} dependent change surface(s).`
      : `No change plan path found (${result.noPathReason ?? "disconnected"}).`,
    resultRefs: [
      ...result.directSurfaces.map((surface) => `${surface.node.kind}:${surface.node.key}`),
      ...result.dependentSurfaces.map((surface) => `${surface.node.kind}:${surface.node.key}`),
    ],
    warnings: result.warnings,
    followOn: result.recommendedFollowOn,
  };
}

function summarizeTenantLeakAuditOutput(output: { result: TenantLeakAuditResult }): StepExecutionSummary {
  const { result } = output;
  return {
    resultSummary: `Tenant audit found ${result.summary.directEvidenceCount} direct finding(s) and ${result.summary.weakSignalCount} weak signal(s).`,
    resultRefs: result.findings.map((finding) => `${finding.surfaceKind}:${finding.surfaceKey}`),
    warnings: result.warnings,
    followOn: result.recommendedFollowOn,
  };
}

function summarizeSessionHandoffOutput(output: { result: SessionHandoffResult }): StepExecutionSummary {
  const { result } = output;
  return {
    resultSummary:
      result.currentFocus == null
        ? "Session handoff found no unresolved current focus."
        : `Current focus: ${result.currentFocus.queryText}.`,
    resultRefs:
      result.currentFocus == null
        ? result.recentQueries.map((entry) => `trace:${entry.traceId}`)
        : [`trace:${result.currentFocus.traceId}`],
    warnings: result.warnings,
  };
}

function summarizeHealthTrendOutput(output: { result: HealthTrendResult }): StepExecutionSummary {
  const { result } = output;
  return {
    resultSummary: result.metrics[0]?.interpretation ?? "Health trend computed.",
    resultRefs: result.metrics.map((metric) => `metric:${metric.metric}`),
    warnings: result.warnings,
  };
}

function summarizeIssuesNextOutput(output: { result: IssuesNextResult }): StepExecutionSummary {
  const { result } = output;
  return {
    resultSummary:
      result.currentIssue == null
        ? "Issues next found no unresolved issue."
        : `Current issue: ${result.currentIssue.queryText}; ${result.queuedIssues.length} queued.`,
    resultRefs: [
      ...(result.currentIssue ? [`trace:${result.currentIssue.traceId}`] : []),
      ...result.queuedIssues.map((issue) => `trace:${issue.traceId}`),
    ],
    warnings: result.warnings,
  };
}

function normalizeSuggestMaxSteps(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SUGGEST_MAX_STEPS;
  }
  return Math.max(1, Math.min(DEFAULT_SUGGEST_MAX_STEPS, Math.trunc(value)));
}

function normalizeInvestigateBudget(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_INVESTIGATE_BUDGET;
  }
  return Math.max(1, Math.min(5, Math.trunc(value)));
}

function summarizeGraphInput(startEntity: GraphNodeLocator, targetEntity: GraphNodeLocator): string {
  return `${startEntity.kind}:${startEntity.key} -> ${targetEntity.kind}:${targetEntity.key}`;
}

function toGraphNodeLocatorJson(locator: GraphNodeLocator): JsonObject {
  return {
    kind: locator.kind,
    key: locator.key,
  };
}

function summarizeToolInput(toolName: ToolName, toolInput: JsonObject): string {
  switch (toolName) {
    case "route_trace":
      return `route ${(toolInput.route as string | undefined) ?? "unknown"}`;
    case "schema_usage":
      return `schema object ${(toolInput.object as string | undefined) ?? "unknown"}`;
    case "file_health":
    case "trace_file":
      return `file ${(toolInput.file as string | undefined) ?? "unknown"}`;
    case "trace_table":
    case "preflight_table":
      return `table ${(toolInput.table as string | undefined) ?? "unknown"}`;
    case "trace_rpc":
    case "db_rpc":
      return `rpc ${(toolInput.name as string | undefined) ?? "unknown"}`;
    case "auth_path":
      return String(toolInput.route ?? toolInput.file ?? toolInput.feature ?? "auth scope");
    case "cross_search":
    case "trace_error":
      return String(toolInput.term ?? "search term");
    case "trace_edge":
      return String(toolInput.name ?? "edge function");
    case "imports_deps":
    case "imports_impact":
    case "symbols_of":
    case "exports_of":
      return `file ${(toolInput.file as string | undefined) ?? "unknown"}`;
    default:
      return `${toolName} input`;
  }
}

function looksLikeChangeQuestion(question: string): boolean {
  return /\b(change|impact|edit|modify|refactor|touch|update|plan)\b/i.test(question);
}

function looksLikeFlowQuestion(question: string): boolean {
  return /\b(flow|path|connect|through|trace|map|how does)\b/i.test(question);
}

function looksLikeTenantAuditQuestion(question: string): boolean {
  const normalized = question.toLowerCase();
  const hasTenant = /\btenant|workspace|organization|account\b/i.test(normalized);
  const hasAuditShape = /\b(leak|rls|policy|policies|boundary|audit|auth|cross-tenant)\b/i.test(normalized);
  return hasTenant && hasAuditShape;
}

function looksLikeHandoffQuestion(question: string): boolean {
  return /\b(handoff|resume|current focus|focus now|where should i resume)\b/i.test(question);
}

function looksLikeNextIssuesQuestion(question: string): boolean {
  return /\b(what should i do next|what next|next issue|next issues|issues next|queue|triage)\b/i.test(question);
}

function looksLikeHealthTrendQuestion(question: string): boolean {
  return /\b(health|trend|improving|regressing|get(?:ting)? better|get(?:ting)? worse)\b/i.test(question);
}

function pushUniqueFollowOnHint(
  target: WorkflowPacketFollowOnHint[],
  hint: WorkflowPacketFollowOnHint,
): void {
  if (
    target.some(
      (entry) =>
        entry.toolName === hint.toolName &&
        entry.family === hint.family &&
        entry.reason === hint.reason,
    )
  ) {
    return;
  }
  target.push(hint);
}
