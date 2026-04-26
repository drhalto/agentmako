import type {
  AnswerResult,
  AnswerTrustEvaluationRecord,
  AskToolOutput,
  JsonValue,
} from "@mako-ai/contracts";
import type {
  AnswerTrustRunRecord,
  BenchmarkRunRecord,
  ProjectStore,
  QueryToolRunsOptions,
  ToolRunRecord,
} from "@mako-ai/store";
import { buildAnswerRankingSurface } from "../trust/enrich-answer-result.js";
import { normalizeStringArray } from "../workflow-packets/common.js";

import type {
  TrustEvalAssertionResult,
  TrustEvalAssertionType,
  TrustEvalBaselineConfig,
  TrustEvalBaselineSelection,
  TrustEvalCaseOutcome,
  TrustEvalPacketSummary,
} from "./types.js";

const CASE_OUTCOME_VALUES = new Set<TrustEvalCaseOutcome>([
  "pass",
  "partial",
  "miss",
  "errored",
  "skipped",
]);

export function coerceCaseOutcome(raw: unknown): TrustEvalCaseOutcome {
  return typeof raw === "string" && CASE_OUTCOME_VALUES.has(raw as TrustEvalCaseOutcome)
    ? (raw as TrustEvalCaseOutcome)
    : "skipped";
}

export function normalizeFailureReasons(
  assertions: TrustEvalAssertionResult[],
): TrustEvalAssertionType[] {
  return [...new Set(assertions.filter((item) => !item.passed).map((item) => item.type))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function extractFailureReasons(actualValue: JsonValue | null | undefined): TrustEvalAssertionType[] {
  if (!isRecord(actualValue)) return [];
  const raw = actualValue.failureReasons;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is TrustEvalAssertionType => typeof value === "string").sort(
    (left, right) => left.localeCompare(right),
  );
}

export function failureReasonsEqual(
  left: TrustEvalAssertionType[],
  right: TrustEvalAssertionType[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function resolveEffectiveRanking(
  answerResult: AnswerResult | null,
  trustEvaluation: AnswerTrustEvaluationRecord | null,
) {
  if (!answerResult) {
    return null;
  }
  return trustEvaluation
    ? buildAnswerRankingSurface(trustEvaluation.state, answerResult.diagnostics ?? [])
    : (answerResult.ranking ?? null);
}

export function buildPacketSummary(
  answerResult: AnswerResult | null,
  trustRun: AnswerTrustRunRecord | null,
  askOutput: AskToolOutput | null,
): TrustEvalPacketSummary | null {
  if (!answerResult) {
    return null;
  }

  const packet = answerResult.packet;
  return {
    queryKind: answerResult.queryKind,
    evidenceStatus: answerResult.evidenceStatus,
    supportLevel: answerResult.supportLevel,
    missingInformation: normalizeStringArray(packet.missingInformation),
    stalenessFlags: normalizeStringArray(packet.stalenessFlags),
    evidenceFiles: normalizeStringArray(packet.evidence.map((block) => block.filePath)),
    evidenceSourceRefs: normalizeStringArray(packet.evidence.map((block) => block.sourceRef)),
    identityKind:
      trustRun && typeof trustRun.target.identity.kind === "string"
        ? trustRun.target.identity.kind
        : null,
    selectedFamily: askOutput?.selectedFamily ?? null,
    selectedTool: askOutput?.selectedTool ?? null,
    diagnosticCodes: normalizeStringArray(answerResult.diagnostics?.map((diagnostic) => diagnostic.code) ?? []),
    rankingDeEmphasized: resolveEffectiveRanking(answerResult, null)?.deEmphasized ?? answerResult.ranking?.deEmphasized ?? null,
  };
}

export function resolveToolRun(
  projectStore: ProjectStore,
  requestId: string,
  toolName: string,
): ToolRunRecord | null {
  const runs = projectStore.queryToolRuns({ requestId, limit: 10 } satisfies QueryToolRunsOptions);
  return runs.find((run) => run.toolName === toolName) ?? null;
}

export function countObservedWorkflowFollowups(
  projectStore: ProjectStore,
  answerResult: AnswerResult | null,
): number {
  const actionId = answerResult?.candidateActions[0]?.actionId;
  if (!answerResult || typeof actionId !== "string" || actionId.length === 0) {
    return 0;
  }

  return projectStore.queryWorkflowFollowups({
    originQueryId: answerResult.queryId,
    originActionId: actionId,
    limit: 50,
  }).length;
}

export function selectBaselineRun(
  projectStore: ProjectStore,
  suiteId: string,
  config?: TrustEvalBaselineConfig,
): { run: BenchmarkRunRecord | null; selection: TrustEvalBaselineSelection } {
  if (config?.mode === "pinned") {
    if (!config.runId) {
      throw new Error(`trust-eval-runner: pinned baseline for suite ${suiteId} is missing runId`);
    }
    const pinnedRun = projectStore.getBenchmarkRun(config.runId);
    if (!pinnedRun) {
      throw new Error(
        `trust-eval-runner: pinned baseline run ${config.runId} was not found for suite ${suiteId}`,
      );
    }
    if (pinnedRun.suiteId !== suiteId) {
      throw new Error(
        `trust-eval-runner: pinned baseline run ${config.runId} belongs to suite ${pinnedRun.suiteId}, expected ${suiteId}`,
      );
    }
    return { run: pinnedRun, selection: "pinned" };
  }

  const passed = projectStore.listBenchmarkRuns({ suiteId, outcome: "passed", limit: 1 })[0];
  if (passed) return { run: passed, selection: "last_passed" };
  const partial = projectStore.listBenchmarkRuns({ suiteId, outcome: "partial", limit: 1 })[0];
  if (partial) return { run: partial, selection: "last_partial" };
  const any = projectStore.listBenchmarkRuns({ suiteId, limit: 1 })[0];
  if (any) return { run: any, selection: "last_any" };
  return { run: null, selection: "none" };
}
