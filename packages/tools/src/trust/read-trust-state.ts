import type {
  AnswerComparableTarget,
  AnswerTrustRun,
  AnswerTrustStateHistory,
  AnswerTrustStateSnapshot,
  ProjectLocatorInput,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { MakoToolError } from "../errors.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { resolveTrustTargetAndRun } from "./common.js";
import { evaluateTrustState, type EvaluateTrustStateInput } from "./evaluate-trust-state.js";

export interface ReadTrustStateInput extends ProjectLocatorInput {
  traceId?: string;
  targetId?: string;
  evaluatedAt?: string;
}

export interface ListTrustStateHistoryInput extends ProjectLocatorInput {
  traceId?: string;
  targetId?: string;
  evaluatedAt?: string;
  limit?: number;
  ensureEvaluated?: boolean;
}

async function ensureEvaluationForTrace(
  projectStore: Pick<
    ProjectStore,
    | "getLatestAnswerTrustEvaluationForTrace"
    | "getAnswerTrustRun"
    | "getAnswerTrustCluster"
    | "getAnswerComparison"
  >,
  input: EvaluateTrustStateInput,
  traceId: string,
  options: ToolServiceOptions,
): Promise<AnswerTrustStateSnapshot> {
  const existing = projectStore.getLatestAnswerTrustEvaluationForTrace(traceId);
  if (!existing) {
    const evaluated = await evaluateTrustState(input, options);
    return {
      target: evaluated.target as AnswerComparableTarget,
      run: evaluated.subjectRun as AnswerTrustRun,
      evaluation: evaluated.evaluation,
      comparison: evaluated.comparison,
      cluster: evaluated.subjectCluster,
    };
  }

  const run = projectStore.getAnswerTrustRun(traceId);
  if (!run) {
    throw new MakoToolError(404, "trust_run_not_found", `Unknown trust run: ${traceId}`);
  }

  const cluster = existing.clusterId ? projectStore.getAnswerTrustCluster(existing.clusterId) : null;
  const comparison = existing.comparisonId ? projectStore.getAnswerComparison(existing.comparisonId) : null;

  return {
    target: run.target as AnswerComparableTarget,
    run: run as AnswerTrustRun,
    evaluation: existing,
    comparison,
    cluster,
  };
}

export async function readTrustState(
  input: ReadTrustStateInput,
  options: ToolServiceOptions = {},
): Promise<AnswerTrustStateSnapshot> {
  return withProjectContext(input, options, async ({ projectStore, project }) => {
    const resolved = resolveTrustTargetAndRun(projectStore, input);
    return ensureEvaluationForTrace(
      projectStore,
      {
        projectId: project.projectId,
        traceId: resolved.run?.traceId,
        evaluatedAt: input.evaluatedAt,
      },
      resolved.run!.traceId,
      options,
    );
  });
}

export async function listTrustStateHistory(
  input: ListTrustStateHistoryInput,
  options: ToolServiceOptions = {},
): Promise<AnswerTrustStateHistory> {
  return withProjectContext(input, options, async ({ projectStore, project }) => {
    const resolved = resolveTrustTargetAndRun(projectStore, input);
    const limit = Math.max(1, Math.min(200, input.limit ?? 25));
    const latestRun = projectStore.getLatestComparableAnswerRun({
      projectId: resolved.target.projectId,
      queryKind: resolved.target.queryKind,
      queryText: resolved.target.normalizedQueryText,
      identity: resolved.target.identity,
    }) as AnswerTrustRun | null;

    let latestEvaluation = latestRun
      ? projectStore.getLatestAnswerTrustEvaluationForTrace(latestRun.traceId)
      : null;
    if (!latestEvaluation && input.ensureEvaluated !== false) {
      latestEvaluation = (
        await evaluateTrustState(
          {
            projectId: project.projectId,
            targetId: resolved.target.targetId,
            evaluatedAt: input.evaluatedAt,
          },
          options,
        )
      ).evaluation;
    }

    return {
      target: resolved.target,
      latestRun,
      latestEvaluation,
      evaluations: projectStore.listAnswerTrustEvaluations(resolved.target.targetId, limit),
      clusters: projectStore.listAnswerTrustClusters(resolved.target.targetId, limit),
      comparisons: projectStore.listAnswerComparisons(resolved.target.targetId, limit),
    };
  });
}
