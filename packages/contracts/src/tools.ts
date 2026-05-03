import type { AnswerResult, QueryKind } from "./answer.js";
import type {
  ImplementationHandoffArtifact,
  ReviewBundleArtifact,
  TaskPreflightArtifact,
  VerificationBundleArtifact,
} from "./artifacts.js";
import type { WorkflowPacketSurface } from "./workflow-packets.js";
import {
  MAKO_ANSWER_TOOL_NAMES,
  MAKO_COMPOSER_TOOL_NAMES,
  MAKO_TOOL_CATEGORIES,
  MAKO_TOOL_NAMES,
  ToolAnnotationsSchema,
  ToolCategorySchema,
  ToolDefinitionSummarySchema,
  ToolHintsSchema,
  ToolNameSchema,
} from "./tool-registry.js";
import type {
  AnswerToolName,
  ComposerToolName,
  ToolAnnotations,
  ToolCategory,
  ToolDefinitionSummary,
  ToolHints,
  ToolName,
} from "./tool-registry.js";
import {
  ProjectLocatorInputObjectSchema,
  ProjectLocatorInputSchema,
} from "./tool-project-locator.js";
import type { ProjectLocatorInput } from "./tool-project-locator.js";
import {
  AnswerResultSchema,
} from "./tool-answer-schemas.js";
import {
  ImplementationHandoffArtifactSchema,
  ReviewBundleArtifactSchema,
  TaskPreflightArtifactSchema,
  VerificationBundleArtifactSchema,
} from "./artifacts.js";
import {
  AskToolOutputSchema,
  type AskToolOutput,
  type AskToolInput,
  type AuthPathToolInput,
  type AuthPathToolOutput,
  type CrossSearchToolInput,
  type CrossSearchToolOutput,
  type ExportsOfToolInput,
  type ExportsOfToolOutput,
  type FileHealthToolInput,
  type FileHealthToolOutput,
  type ImportsCyclesToolInput,
  type ImportsCyclesToolOutput,
  type ImportsDepsToolInput,
  type ImportsDepsToolOutput,
  type ImportsHotspotsToolInput,
  type ImportsHotspotsToolOutput,
  type ImportsImpactToolInput,
  type ImportsImpactToolOutput,
  type PreflightTableToolInput,
  type PreflightTableToolOutput,
  type RouteTraceToolInput,
  type RouteTraceToolOutput,
  type SchemaUsageToolInput,
  type SchemaUsageToolOutput,
  type SymbolsOfToolInput,
  type SymbolsOfToolOutput,
  type TraceEdgeToolInput,
  type TraceEdgeToolOutput,
  type TraceErrorToolInput,
  type TraceErrorToolOutput,
  type TraceFileToolInput,
  type TraceFileToolOutput,
  type TraceRpcToolInput,
  type TraceRpcToolOutput,
  type TraceTableToolInput,
  type TraceTableToolOutput,
} from "./tool-query-schemas.js";
import type {
  ImplementationHandoffArtifactToolInput,
  ImplementationHandoffArtifactToolOutput,
  ReviewBundleArtifactToolInput,
  ReviewBundleArtifactToolOutput,
  TaskPreflightArtifactToolInput,
  TaskPreflightArtifactToolOutput,
  VerificationBundleArtifactToolInput,
  VerificationBundleArtifactToolOutput,
} from "./tool-artifact-schemas.js";
import {
  ImplementationHandoffArtifactToolOutputSchema,
  ReviewBundleArtifactToolOutputSchema,
  TaskPreflightArtifactToolOutputSchema,
  VerificationBundleArtifactToolOutputSchema,
} from "./tool-artifact-schemas.js";
import {
  WorkflowPacketSurfaceSchema,
  WorkflowPacketToolOutputSchema,
  type WorkflowPacketToolInput,
  type WorkflowPacketToolOutput,
} from "./tool-workflow-schemas.js";
import type {
  ChangePlanToolInput,
  ChangePlanToolOutput,
  FlowMapToolInput,
  FlowMapToolOutput,
  GraphNeighborsToolInput,
  GraphNeighborsToolOutput,
  GraphPathToolInput,
  GraphPathToolOutput,
  HealthTrendToolInput,
  HealthTrendToolOutput,
  InvestigateToolInput,
  InvestigateToolOutput,
  IssuesNextToolInput,
  IssuesNextToolOutput,
  SessionHandoffToolInput,
  SessionHandoffToolOutput,
  SuggestToolInput,
  SuggestToolOutput,
  TenantLeakAuditToolInput,
  TenantLeakAuditToolOutput,
} from "./tool-power-schemas.js";
import type {
  DbColumnsToolInput,
  DbColumnsToolOutput,
  DbFkToolInput,
  DbFkToolOutput,
  DbPingToolInput,
  DbPingToolOutput,
  DbRlsToolInput,
  DbRlsToolOutput,
  DbRpcToolInput,
  DbRpcToolOutput,
  DbTableSchemaToolInput,
  DbTableSchemaToolOutput,
} from "./tool-db-schemas.js";
import type {
  AstFindPatternToolInput,
  AstFindPatternToolOutput,
} from "./tool-ast-schemas.js";
import type {
  MakoHelpToolInput,
  MakoHelpToolOutput,
} from "./tool-mako-help-schemas.js";
import type {
  LiveTextSearchToolInput,
  LiveTextSearchToolOutput,
} from "./tool-live-text-search-schemas.js";
import type {
  LintFilesToolInput,
  LintFilesToolOutput,
} from "./tool-lint-schemas.js";
import type {
  EslintDiagnosticsToolInput,
  EslintDiagnosticsToolOutput,
} from "./tool-eslint-diagnostics-schemas.js";
import type {
  OxlintDiagnosticsToolInput,
  OxlintDiagnosticsToolOutput,
} from "./tool-oxlint-diagnostics-schemas.js";
import type {
  BiomeDiagnosticsToolInput,
  BiomeDiagnosticsToolOutput,
} from "./tool-biome-diagnostics-schemas.js";
import type {
  GitPrecommitCheckToolInput,
  GitPrecommitCheckToolOutput,
} from "./tool-git-precommit-schemas.js";
import type {
  RepoMapToolInput,
  RepoMapToolOutput,
} from "./tool-repo-map-schemas.js";
import type {
  RuntimeTelemetryReportToolInput,
  RuntimeTelemetryReportToolOutput,
} from "./tool-runtime-telemetry-schemas.js";
import type {
  FindingAckToolInput,
  FindingAckToolOutput,
  FindingAckBatchToolInput,
  FindingAckBatchToolOutput,
  FindingAcksReportToolInput,
  FindingAcksReportToolOutput,
} from "./tool-finding-ack-schemas.js";
import type {
  RecallAnswersToolInput,
  RecallAnswersToolOutput,
  RecallToolRunsToolInput,
  RecallToolRunsToolOutput,
} from "./tool-recall-schemas.js";
import type {
  RouteContextToolInput,
  RouteContextToolOutput,
  RpcNeighborhoodToolInput,
  RpcNeighborhoodToolOutput,
  TableNeighborhoodToolInput,
  TableNeighborhoodToolOutput,
} from "./tool-neighborhood-schemas.js";
import type {
  AgentFeedbackReportToolInput,
  AgentFeedbackReportToolOutput,
  AgentFeedbackToolInput,
  AgentFeedbackToolOutput,
} from "./tool-agent-feedback-schemas.js";
import type {
  ProjectIndexRefreshToolInput,
  ProjectIndexRefreshToolOutput,
  ProjectIndexStatusToolInput,
  ProjectIndexStatusToolOutput,
} from "./tool-project-index-schemas.js";
import type {
  ContextPacketToolInput,
  ContextPacketToolOutput,
} from "./tool-context-packet-schemas.js";
import type {
  ToolBatchInput,
  ToolBatchToolOutput,
} from "./tool-batch-schemas.js";
import type {
  TypeScriptDiagnosticsToolInput,
  TypeScriptDiagnosticsToolOutput,
} from "./tool-typescript-diagnostics-schemas.js";
import type {
  EvidenceConfidenceToolInput,
  EvidenceConfidenceToolOutput,
  EvidenceConflictsToolInput,
  EvidenceConflictsToolOutput,
  ExtractRuleTemplateToolInput,
  ExtractRuleTemplateToolOutput,
  DiagnosticRefreshToolInput,
  DiagnosticRefreshToolOutput,
  DbReefRefreshToolInput,
  DbReefRefreshToolOutput,
  DbReviewCommentToolInput,
  DbReviewCommentToolOutput,
  DbReviewCommentsToolInput,
  DbReviewCommentsToolOutput,
  FileFindingsToolInput,
  FileFindingsToolOutput,
  FilePreflightToolInput,
  FilePreflightToolOutput,
  FileFactsToolInput,
  FileFactsToolOutput,
  ListReefRulesToolInput,
  ListReefRulesToolOutput,
  ProjectConventionsToolInput,
  ProjectConventionsToolOutput,
  ProjectDiagnosticRunsToolInput,
  ProjectDiagnosticRunsToolOutput,
  ProjectFactsToolInput,
  ProjectFactsToolOutput,
  ProjectFindingsToolInput,
  ProjectFindingsToolOutput,
  ReefAskToolInput,
  ReefAskToolOutput,
  ProjectOpenLoopsToolInput,
  ProjectOpenLoopsToolOutput,
  ReefDiffImpactToolInput,
  ReefDiffImpactToolOutput,
  ReefImpactToolInput,
  ReefImpactToolOutput,
  ReefOverlayDiffToolInput,
  ReefOverlayDiffToolOutput,
  ReefInstructionsToolInput,
  ReefInstructionsToolOutput,
  ReefInspectToolInput,
  ReefInspectToolOutput,
  ReefAgentStatusToolInput,
  ReefAgentStatusToolOutput,
  ReefStatusToolInput,
  ReefStatusToolOutput,
  ReefKnownIssuesToolInput,
  ReefKnownIssuesToolOutput,
  ReefLearningReviewToolInput,
  ReefLearningReviewToolOutput,
  ReefScoutToolInput,
  ReefScoutToolOutput,
  ReefVerifyToolInput,
  ReefVerifyToolOutput,
  ReefWhereUsedToolInput,
  ReefWhereUsedToolOutput,
  RulePackValidateToolInput,
  RulePackValidateToolOutput,
  RuleMemoryToolInput,
  RuleMemoryToolOutput,
  VerificationStateToolInput,
  VerificationStateToolOutput,
  WorkingTreeOverlayToolInput,
  WorkingTreeOverlayToolOutput,
} from "./tool-reef-schemas.js";

export {
  MAKO_ANSWER_TOOL_NAMES,
  MAKO_COMPOSER_TOOL_NAMES,
  MAKO_TOOL_CATEGORIES,
  MAKO_TOOL_NAMES,
  ToolAnnotationsSchema,
  ToolCategorySchema,
  ToolDefinitionSummarySchema,
  ToolHintsSchema,
  ToolNameSchema,
} from "./tool-registry.js";
export type {
  AnswerToolName,
  ComposerToolName,
  ToolAnnotations,
  ToolCategory,
  ToolDefinitionSummary,
  ToolHints,
  ToolName,
} from "./tool-registry.js";
export {
  ProjectLocatorInputObjectSchema,
  ProjectLocatorInputSchema,
} from "./tool-project-locator.js";
export type { ProjectLocatorInput } from "./tool-project-locator.js";

export * from "./tool-answer-schemas.js";
export * from "./tool-schema-shared.js";
export * from "./tool-query-schemas.js";
export * from "./tool-artifact-schemas.js";
export * from "./tool-workflow-schemas.js";
export * from "./tool-power-schemas.js";
export * from "./tool-db-schemas.js";
export * from "./tool-mako-help-schemas.js";
export * from "./tool-ast-schemas.js";
export * from "./tool-live-text-search-schemas.js";
export * from "./tool-lint-schemas.js";
export * from "./tool-eslint-diagnostics-schemas.js";
export * from "./tool-oxlint-diagnostics-schemas.js";
export * from "./tool-biome-diagnostics-schemas.js";
export * from "./tool-git-precommit-schemas.js";
export * from "./tool-repo-map-schemas.js";
export * from "./tool-runtime-telemetry-schemas.js";
export * from "./tool-finding-ack-schemas.js";
export * from "./tool-recall-schemas.js";
export * from "./tool-neighborhood-schemas.js";
export * from "./tool-agent-feedback-schemas.js";
export * from "./tool-project-index-schemas.js";
export * from "./tool-context-packet-schemas.js";
export * from "./tool-batch-schemas.js";
export * from "./tool-typescript-diagnostics-schemas.js";
export * from "./tool-reef-execution-schemas.js";
export * from "./tool-reef-schemas.js";

function isToolOutputRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function extractAnswerResultFromToolOutput(value: unknown): AnswerResult | null {
  const direct = AnswerResultSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  if (isToolOutputRecord(value) && "result" in value) {
    return extractAnswerResultFromToolOutput(value.result);
  }

  return null;
}

export function extractAskOutputFromToolOutput(value: unknown): AskToolOutput | null {
  const direct = AskToolOutputSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  if (isToolOutputRecord(value) && "result" in value) {
    return extractAskOutputFromToolOutput(value.result);
  }

  return null;
}

export function extractWorkflowPacketSurfaceFromToolOutput(value: unknown): WorkflowPacketSurface | null {
  const direct = WorkflowPacketSurfaceSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const toolOutput = WorkflowPacketToolOutputSchema.safeParse(value);
  if (toolOutput.success) {
    return toolOutput.data.result;
  }

  if (isToolOutputRecord(value) && "result" in value) {
    return extractWorkflowPacketSurfaceFromToolOutput(value.result);
  }

  return null;
}

export function extractImplementationHandoffArtifactFromToolOutput(value: unknown): ImplementationHandoffArtifact | null {
  const direct = ImplementationHandoffArtifactSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const toolOutput = ImplementationHandoffArtifactToolOutputSchema.safeParse(value);
  if (toolOutput.success) {
    return toolOutput.data.result;
  }

  if (isToolOutputRecord(value) && "result" in value) {
    return extractImplementationHandoffArtifactFromToolOutput(value.result);
  }

  return null;
}

export function extractTaskPreflightArtifactFromToolOutput(value: unknown): TaskPreflightArtifact | null {
  const direct = TaskPreflightArtifactSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const toolOutput = TaskPreflightArtifactToolOutputSchema.safeParse(value);
  if (toolOutput.success) {
    return toolOutput.data.result;
  }

  if (isToolOutputRecord(value) && "result" in value) {
    return extractTaskPreflightArtifactFromToolOutput(value.result);
  }

  return null;
}

export function extractReviewBundleArtifactFromToolOutput(value: unknown): ReviewBundleArtifact | null {
  const direct = ReviewBundleArtifactSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const toolOutput = ReviewBundleArtifactToolOutputSchema.safeParse(value);
  if (toolOutput.success) {
    return toolOutput.data.result;
  }

  if (isToolOutputRecord(value) && "result" in value) {
    return extractReviewBundleArtifactFromToolOutput(value.result);
  }

  return null;
}

export function extractVerificationBundleArtifactFromToolOutput(
  value: unknown,
): VerificationBundleArtifact | null {
  const direct = VerificationBundleArtifactSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const toolOutput = VerificationBundleArtifactToolOutputSchema.safeParse(value);
  if (toolOutput.success) {
    return toolOutput.data.result;
  }

  if (isToolOutputRecord(value) && "result" in value) {
    return extractVerificationBundleArtifactFromToolOutput(value.result);
  }

  return null;
}

export type ToolInput =
  | TaskPreflightArtifactToolInput
  | ImplementationHandoffArtifactToolInput
  | ReviewBundleArtifactToolInput
  | VerificationBundleArtifactToolInput
  | SuggestToolInput
  | InvestigateToolInput
  | GraphNeighborsToolInput
  | GraphPathToolInput
  | FlowMapToolInput
  | ChangePlanToolInput
  | TenantLeakAuditToolInput
  | HealthTrendToolInput
  | IssuesNextToolInput
  | SessionHandoffToolInput
  | RecallAnswersToolInput
  | RecallToolRunsToolInput
  | TableNeighborhoodToolInput
  | RouteContextToolInput
  | RpcNeighborhoodToolInput
  | AgentFeedbackToolInput
  | AgentFeedbackReportToolInput
  | RouteTraceToolInput
  | SchemaUsageToolInput
  | FileHealthToolInput
  | AuthPathToolInput
  | ImportsDepsToolInput
  | ImportsImpactToolInput
  | ImportsHotspotsToolInput
  | ImportsCyclesToolInput
  | SymbolsOfToolInput
  | ExportsOfToolInput
  | AskToolInput
  | DbPingToolInput
  | DbColumnsToolInput
  | DbFkToolInput
  | DbRlsToolInput
  | DbRpcToolInput
  | DbTableSchemaToolInput
  | MakoHelpToolInput
  | TraceFileToolInput
  | PreflightTableToolInput
  | CrossSearchToolInput
  | TraceEdgeToolInput
  | TraceErrorToolInput
  | TraceTableToolInput
  | TraceRpcToolInput
  | WorkflowPacketToolInput
  | AstFindPatternToolInput
  | LiveTextSearchToolInput
  | LintFilesToolInput
  | TypeScriptDiagnosticsToolInput
  | EslintDiagnosticsToolInput
  | OxlintDiagnosticsToolInput
  | BiomeDiagnosticsToolInput
  | GitPrecommitCheckToolInput
  | DiagnosticRefreshToolInput
  | DbReefRefreshToolInput
  | DbReviewCommentToolInput
  | DbReviewCommentsToolInput
  | RepoMapToolInput
  | RuntimeTelemetryReportToolInput
  | ProjectIndexStatusToolInput
  | ProjectIndexRefreshToolInput
  | ContextPacketToolInput
  | ReefAskToolInput
  | ToolBatchInput
  | FindingAckToolInput
  | FindingAckBatchToolInput
  | FindingAcksReportToolInput
  | ProjectFindingsToolInput
  | FileFindingsToolInput
  | FilePreflightToolInput
  | ProjectFactsToolInput
  | FileFactsToolInput
  | WorkingTreeOverlayToolInput
  | ReefOverlayDiffToolInput
  | ReefDiffImpactToolInput
  | ReefImpactToolInput
  | ReefInstructionsToolInput
  | ReefLearningReviewToolInput
  | ListReefRulesToolInput
  | RulePackValidateToolInput
  | ExtractRuleTemplateToolInput
  | ProjectDiagnosticRunsToolInput
  | ReefScoutToolInput
  | ReefInspectToolInput
  | ReefWhereUsedToolInput
  | ReefVerifyToolInput
  | ProjectOpenLoopsToolInput
  | VerificationStateToolInput
  | ProjectConventionsToolInput
  | RuleMemoryToolInput
  | EvidenceConfidenceToolInput
  | EvidenceConflictsToolInput
  | ReefKnownIssuesToolInput
  | ReefStatusToolInput
  | ReefAgentStatusToolInput;

export type ToolOutput = (
  | TaskPreflightArtifactToolOutput
  | ImplementationHandoffArtifactToolOutput
  | ReviewBundleArtifactToolOutput
  | VerificationBundleArtifactToolOutput
  | SuggestToolOutput
  | InvestigateToolOutput
  | GraphNeighborsToolOutput
  | GraphPathToolOutput
  | FlowMapToolOutput
  | ChangePlanToolOutput
  | TenantLeakAuditToolOutput
  | HealthTrendToolOutput
  | IssuesNextToolOutput
  | SessionHandoffToolOutput
  | RecallAnswersToolOutput
  | RecallToolRunsToolOutput
  | TableNeighborhoodToolOutput
  | RouteContextToolOutput
  | RpcNeighborhoodToolOutput
  | AgentFeedbackToolOutput
  | AgentFeedbackReportToolOutput
  | RouteTraceToolOutput
  | SchemaUsageToolOutput
  | FileHealthToolOutput
  | AuthPathToolOutput
  | ImportsDepsToolOutput
  | ImportsImpactToolOutput
  | ImportsHotspotsToolOutput
  | ImportsCyclesToolOutput
  | SymbolsOfToolOutput
  | ExportsOfToolOutput
  | AskToolOutput
  | DbPingToolOutput
  | DbColumnsToolOutput
  | DbFkToolOutput
  | DbRlsToolOutput
  | DbRpcToolOutput
  | DbTableSchemaToolOutput
  | MakoHelpToolOutput
  | TraceFileToolOutput
  | PreflightTableToolOutput
  | CrossSearchToolOutput
  | TraceEdgeToolOutput
  | TraceErrorToolOutput
  | TraceTableToolOutput
  | TraceRpcToolOutput
  | WorkflowPacketToolOutput
  | AstFindPatternToolOutput
  | LiveTextSearchToolOutput
  | LintFilesToolOutput
  | TypeScriptDiagnosticsToolOutput
  | EslintDiagnosticsToolOutput
  | OxlintDiagnosticsToolOutput
  | BiomeDiagnosticsToolOutput
  | GitPrecommitCheckToolOutput
  | DiagnosticRefreshToolOutput
  | DbReefRefreshToolOutput
  | DbReviewCommentToolOutput
  | DbReviewCommentsToolOutput
  | RepoMapToolOutput
  | RuntimeTelemetryReportToolOutput
  | ProjectIndexStatusToolOutput
  | ProjectIndexRefreshToolOutput
  | ContextPacketToolOutput
  | ReefAskToolOutput
  | ToolBatchToolOutput
  | FindingAckToolOutput
  | FindingAckBatchToolOutput
  | FindingAcksReportToolOutput
  | ProjectFindingsToolOutput
  | FileFindingsToolOutput
  | FilePreflightToolOutput
  | ProjectFactsToolOutput
  | FileFactsToolOutput
  | WorkingTreeOverlayToolOutput
  | ReefOverlayDiffToolOutput
  | ReefDiffImpactToolOutput
  | ReefImpactToolOutput
  | ReefInstructionsToolOutput
  | ReefLearningReviewToolOutput
  | ListReefRulesToolOutput
  | RulePackValidateToolOutput
  | ExtractRuleTemplateToolOutput
  | ProjectDiagnosticRunsToolOutput
  | ReefScoutToolOutput
  | ReefInspectToolOutput
  | ReefWhereUsedToolOutput
  | ReefVerifyToolOutput
  | ProjectOpenLoopsToolOutput
  | VerificationStateToolOutput
  | ProjectConventionsToolOutput
  | RuleMemoryToolOutput
  | EvidenceConfidenceToolOutput
  | EvidenceConflictsToolOutput
  | ReefKnownIssuesToolOutput
  | ReefStatusToolOutput
  | ReefAgentStatusToolOutput
) & Partial<ToolHints>;

export type AnswerToolQueryKind = Extract<QueryKind, AnswerToolName>;
