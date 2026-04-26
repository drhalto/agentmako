import {
  type AnswerResult,
  type AskToolOutput,
  type AnswerTrustEvaluationRecord,
  type JsonObject,
  type JsonValue,
  type PowerWorkflowUsefulnessEvaluation,
  type ToolOutput,
} from "@mako-ai/contracts";
import { hashJson, type AnswerTrustRunRecord } from "@mako-ai/store";
import type { RerunAndCompareResult } from "../trust/rerun-and-compare.js";
import type {
  TrustEvalAssertionFixture,
  TrustEvalAssertionResult,
  TrustEvalAssertionType,
  TrustEvalCaseFixture,
  TrustEvalCaseOutcome,
} from "./types.js";
import {
  buildPacketSummary,
  isRecord,
  resolveEffectiveRanking,
} from "./runner-helpers.js";
import { normalizeStringArray } from "../workflow-packets/common.js";
import type { WorkflowPacketUsefulnessEvaluation } from "../workflow-packets/usefulness.js";

export function buildActualCaseValue(args: {
  output: ToolOutput | null;
  askOutput: AskToolOutput | null;
  answerResult: AnswerResult | null;
  trustRun: AnswerTrustRunRecord | null;
  trustEvaluation: AnswerTrustEvaluationRecord | null;
  workflowUsefulness: WorkflowPacketUsefulnessEvaluation | null;
  powerWorkflowUsefulness: PowerWorkflowUsefulnessEvaluation | null;
  rerunResult?: RerunAndCompareResult | null;
  rerunOlderEvaluation?: AnswerTrustEvaluationRecord | null;
  rerunNewerEvaluation?: AnswerTrustEvaluationRecord | null;
  failureReasons: TrustEvalAssertionType[];
  errorCode?: string;
}): JsonObject {
  const packetSummary = buildPacketSummary(args.answerResult, args.trustRun, args.askOutput);
  const effectiveRanking = resolveEffectiveRanking(args.answerResult, args.trustEvaluation);
  return {
    selectedFamily: args.askOutput?.selectedFamily ?? null,
    selectedTool: args.askOutput?.selectedTool ?? null,
    confidence: args.askOutput?.confidence ?? null,
    queryKind: args.answerResult?.queryKind ?? null,
    traceId: args.answerResult?.queryId ?? null,
    targetId: args.trustRun?.targetId ?? null,
    provenance: args.trustRun?.provenance ?? null,
    trustState: args.trustEvaluation?.state ?? null,
    trustReasonCodes:
      args.trustEvaluation?.reasons.map((reason) => reason.code).sort((left, right) =>
        left.localeCompare(right),
      ) ?? [],
    trustComparisonId: args.trustEvaluation?.comparisonId ?? null,
    trustClusterId: args.trustEvaluation?.clusterId ?? null,
    trustScopeRelation: args.trustEvaluation?.scopeRelation ?? null,
    trustConflictingFacets: args.trustEvaluation?.conflictingFacets ?? [],
    trustBasisTraceIds: args.trustEvaluation?.basisTraceIds ?? [],
    identityKind:
      args.trustRun && typeof args.trustRun.target.identity.kind === "string"
        ? args.trustRun.target.identity.kind
        : null,
    identity: args.trustRun?.target.identity ?? null,
    packetSummary,
    diagnosticCodes:
      normalizeStringArray(args.answerResult?.diagnostics?.map((diagnostic) => diagnostic.code) ?? []),
    diagnosticCategories:
      normalizeStringArray(
        args.answerResult?.diagnostics?.map((diagnostic) => diagnostic.category) ?? [],
      ),
    rankingDeEmphasized: effectiveRanking?.deEmphasized ?? null,
    rankingReasonCodes:
      effectiveRanking?.reasons.map((reason) => reason.code).sort((left, right) =>
        left.localeCompare(right),
      ) ?? [],
    rerun:
      args.rerunResult && args.rerunOlderEvaluation && args.rerunNewerEvaluation
        ? {
            mutationRunsAgainst: "replaceIndexSnapshot_store",
            comparisonId: args.rerunResult.comparison.comparisonId,
            meaningfulChangeDetected: args.rerunResult.comparison.meaningfulChangeDetected,
            priorTraceId: args.rerunResult.priorRun.traceId,
            currentTraceId: args.rerunResult.currentRun.traceId,
            olderTrustState: args.rerunOlderEvaluation.state,
            newerTrustState: args.rerunNewerEvaluation.state,
          }
        : null,
    companionPacketFamily: args.answerResult?.companionPacket?.packet.family ?? null,
    companionAttachmentReason: args.answerResult?.companionPacket?.attachmentReason ?? null,
    companionHandoffPresent:
      args.answerResult?.companionPacket != null ? args.answerResult.companionPacket.handoff != null : null,
    companionHandoffCurrent: args.answerResult?.companionPacket?.handoff?.current ?? null,
    companionHandoffStopWhen: args.answerResult?.companionPacket?.handoff?.stopWhen ?? null,
    companionHandoffRefreshWhen: args.answerResult?.companionPacket?.handoff?.refreshWhen ?? null,
    firstCandidateActionLabel: args.answerResult?.candidateActions[0]?.label ?? null,
    firstCandidateActionToolName: args.answerResult?.candidateActions[0]?.execute?.toolName ?? null,
    firstCandidateActionToolInput: args.answerResult?.candidateActions[0]?.execute?.input ?? null,
    workflowUsefulnessEligible: args.workflowUsefulness?.eligible ?? null,
    workflowUsefulnessAttached: args.workflowUsefulness?.attached ?? null,
    workflowUsefulnessGrade: args.workflowUsefulness?.grade ?? null,
    workflowUsefulnessReasonCodes: args.workflowUsefulness?.reasonCodes ?? [],
    workflowObservedFollowupCount: args.workflowUsefulness?.observedFollowupCount ?? 0,
    powerWorkflowUsefulnessGrade: args.powerWorkflowUsefulness?.grade ?? null,
    powerWorkflowUsefulnessReasonCodes: args.powerWorkflowUsefulness?.reasonCodes ?? [],
    powerWorkflowObservedFollowupCount: args.powerWorkflowUsefulness?.observedFollowupCount ?? 0,
    failureReasons: args.failureReasons,
    errorCode: args.errorCode ?? null,
    toolName:
      isRecord(args.output) && typeof args.output.toolName === "string"
        ? args.output.toolName
        : null,
  };
}

function valuesEqual(left: JsonValue, right: JsonValue, tolerance?: number): boolean {
  if (
    typeof tolerance === "number" &&
    Number.isFinite(tolerance) &&
    typeof left === "number" &&
    typeof right === "number"
  ) {
    return Math.abs(left - right) <= tolerance;
  }
  return hashJson(left) === hashJson(right);
}

export function evaluateAssertion(args: {
  assertionId: string;
  assertion: TrustEvalAssertionFixture;
  output: ToolOutput | null;
  askOutput: AskToolOutput | null;
  answerResult: AnswerResult | null;
  trustRun: AnswerTrustRunRecord | null;
  trustEvaluation: AnswerTrustEvaluationRecord | null;
  workflowUsefulness: WorkflowPacketUsefulnessEvaluation | null;
  powerWorkflowUsefulness?: PowerWorkflowUsefulnessEvaluation | null;
  errorCode?: string;
}): TrustEvalAssertionResult {
  const { assertion } = args;
  let actualValue: JsonValue = null;
  const effectiveRanking = resolveEffectiveRanking(args.answerResult, args.trustEvaluation);

  switch (assertion.type) {
    case "selected_tool_equals":
      actualValue = args.askOutput?.selectedTool ?? null;
      break;
    case "selected_family_equals":
      actualValue = args.askOutput?.selectedFamily ?? null;
      break;
    case "result_query_kind_equals":
      actualValue = args.answerResult?.queryKind ?? null;
      break;
    case "result_answer_contains": {
      const answer = args.answerResult?.answer ?? "";
      actualValue = answer;
      break;
    }
    case "result_evidence_file_includes":
    case "result_evidence_file_excludes":
      actualValue = normalizeStringArray(args.answerResult?.packet.evidence.map((block) => block.filePath) ?? []);
      break;
    case "result_evidence_source_ref_includes":
    case "result_evidence_source_ref_excludes":
      actualValue = normalizeStringArray(args.answerResult?.packet.evidence.map((block) => block.sourceRef) ?? []);
      break;
    case "result_missing_info_includes":
    case "result_missing_info_excludes":
      actualValue = normalizeStringArray(args.answerResult?.packet.missingInformation ?? []);
      break;
    case "trust_identity_kind_equals":
      actualValue =
        args.trustRun && typeof args.trustRun.target.identity.kind === "string"
          ? args.trustRun.target.identity.kind
          : null;
      break;
    case "trust_identity_equals":
      actualValue = args.trustRun?.target.identity ?? null;
      break;
    case "trust_provenance_equals":
      actualValue = args.trustRun?.provenance ?? null;
      break;
    case "trust_state_equals":
      actualValue = args.trustEvaluation?.state ?? null;
      break;
    case "trust_reason_code_includes":
    case "trust_reason_code_excludes":
      actualValue =
        args.trustEvaluation?.reasons.map((reason) => reason.code).sort((left, right) =>
          left.localeCompare(right),
        ) ?? [];
      break;
    case "diagnostic_code_includes":
      actualValue = normalizeStringArray(
        args.answerResult?.diagnostics?.map((diagnostic) => diagnostic.code) ?? [],
      );
      break;
    case "diagnostic_category_includes":
      actualValue = normalizeStringArray(
        args.answerResult?.diagnostics?.map((diagnostic) => diagnostic.category) ?? [],
      );
      break;
    case "ranking_deemphasized_equals":
      actualValue = effectiveRanking?.deEmphasized ?? null;
      break;
    case "ranking_reason_code_includes":
      actualValue = normalizeStringArray(
        effectiveRanking?.reasons.map((reason) => reason.code) ?? [],
      );
      break;
    case "companion_packet_family_equals":
      actualValue = args.answerResult?.companionPacket?.packet.family ?? null;
      break;
    case "companion_attachment_reason_contains":
      actualValue = args.answerResult?.companionPacket?.attachmentReason ?? "";
      break;
    case "companion_handoff_present_equals":
      actualValue = args.answerResult?.companionPacket?.handoff != null;
      break;
    case "companion_handoff_current_contains":
      actualValue = args.answerResult?.companionPacket?.handoff?.current ?? "";
      break;
    case "companion_handoff_stop_when_contains":
      actualValue = args.answerResult?.companionPacket?.handoff?.stopWhen ?? "";
      break;
    case "workflow_usefulness_grade_equals":
      actualValue = args.workflowUsefulness?.grade ?? null;
      break;
    case "workflow_usefulness_reason_includes":
      actualValue = normalizeStringArray(args.workflowUsefulness?.reasonCodes ?? []);
      break;
    case "rerun_older_trust_state_equals":
    case "rerun_newer_trust_state_equals":
      throw new Error(`Rerun trust-state assertions are synthesized by the eval runner: ${assertion.type}`);
    case "error_code_equals":
      actualValue = args.errorCode ?? null;
      break;
    case "packet_summary_equals":
      actualValue = buildPacketSummary(args.answerResult, args.trustRun, args.askOutput);
      break;
    default: {
      const neverType: never = assertion.type;
      throw new Error(`Unsupported trust eval assertion: ${neverType}`);
    }
  }

  let passed: boolean;
  if (assertion.type === "result_answer_contains") {
    const expectedNeedle = typeof assertion.expectedValue === "string" ? assertion.expectedValue : "";
    passed = typeof actualValue === "string" && actualValue.includes(expectedNeedle);
  } else if (
    assertion.type === "companion_attachment_reason_contains" ||
    assertion.type === "companion_handoff_current_contains" ||
    assertion.type === "companion_handoff_stop_when_contains"
  ) {
    const expectedNeedle = typeof assertion.expectedValue === "string" ? assertion.expectedValue : "";
    passed = typeof actualValue === "string" && actualValue.includes(expectedNeedle);
  } else if (
    assertion.type === "result_evidence_file_includes" ||
    assertion.type === "result_evidence_source_ref_includes" ||
    assertion.type === "result_missing_info_includes" ||
    assertion.type === "trust_reason_code_includes" ||
    assertion.type === "diagnostic_code_includes" ||
    assertion.type === "diagnostic_category_includes" ||
    assertion.type === "ranking_reason_code_includes" ||
    assertion.type === "workflow_usefulness_reason_includes"
  ) {
    const expectedNeedle = typeof assertion.expectedValue === "string" ? assertion.expectedValue : "";
    passed = Array.isArray(actualValue) && actualValue.some((value) => value === expectedNeedle);
  } else if (
    assertion.type === "result_evidence_file_excludes" ||
    assertion.type === "result_evidence_source_ref_excludes" ||
    assertion.type === "result_missing_info_excludes" ||
    assertion.type === "trust_reason_code_excludes"
  ) {
    const expectedNeedle = typeof assertion.expectedValue === "string" ? assertion.expectedValue : "";
    passed = Array.isArray(actualValue) && !actualValue.some((value) => value === expectedNeedle);
  } else {
    passed = valuesEqual(actualValue, assertion.expectedValue, assertion.tolerance);
  }

  return {
    assertionId: args.assertionId,
    type: assertion.type,
    passed,
    actualValue,
    expectedValue: assertion.expectedValue,
    description: assertion.description,
  };
}

export function scoreCase(
  assertions: TrustEvalAssertionResult[],
  errorText?: string,
): TrustEvalCaseOutcome {
  if (errorText) {
    return "errored";
  }

  if (assertions.length === 0) {
    return "pass";
  }

  const passedCount = assertions.filter((item) => item.passed).length;
  if (passedCount === assertions.length) {
    return "pass";
  }
  if (passedCount === 0) {
    return "miss";
  }
  return "partial";
}

export function scoreWeight(outcome: TrustEvalCaseOutcome): number {
  switch (outcome) {
    case "pass":
      return 3;
    case "partial":
      return 2;
    case "miss":
      return 1;
    case "errored":
      return 0;
    case "skipped":
      return 0;
    default: {
      const neverOutcome: never = outcome;
      throw new Error(`Unhandled trust eval outcome: ${neverOutcome}`);
    }
  }
}

export function buildRerunAssertionResults(args: {
  suiteId: string;
  caseId: string;
  rerun: NonNullable<TrustEvalCaseFixture["rerun"]>;
  olderEvaluation: AnswerTrustEvaluationRecord;
  newerEvaluation: AnswerTrustEvaluationRecord;
}): TrustEvalAssertionResult[] {
  return [
    {
      assertionId: `${args.suiteId}:${args.caseId}:rerun:older_state`,
      type: "rerun_older_trust_state_equals",
      passed: args.olderEvaluation.state === args.rerun.expectedOlderState,
      actualValue: args.olderEvaluation.state,
      expectedValue: args.rerun.expectedOlderState,
      description: "rerun fixture gate: older comparable run resolves to the expected trust state",
    },
    {
      assertionId: `${args.suiteId}:${args.caseId}:rerun:newer_state`,
      type: "rerun_newer_trust_state_equals",
      passed: args.newerEvaluation.state === args.rerun.expectedNewerState,
      actualValue: args.newerEvaluation.state,
      expectedValue: args.rerun.expectedNewerState,
      description: "rerun fixture gate: newer comparable run resolves to the expected trust state",
    },
  ];
}
