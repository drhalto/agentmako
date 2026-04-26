import type { JsonObject, QueryKind } from "@mako-ai/contracts";
import type { AnswerComparableTargetRecord, AnswerTrustRunRecord } from "@mako-ai/store";
import { MakoToolError } from "../errors.js";

export interface TrustLocatorInput {
  traceId?: string;
  targetId?: string;
}

export interface TrustLocatorStore {
  getAnswerTrustRun(traceId: string): AnswerTrustRunRecord | null;
  getAnswerComparableTarget(targetId: string): AnswerComparableTargetRecord | null;
  getLatestComparableAnswerRun(args: {
    projectId: string;
    queryKind: QueryKind;
    queryText: string;
    identity?: JsonObject;
  }): AnswerTrustRunRecord | null;
}

export function assertExclusiveTrustLocator(input: TrustLocatorInput): void {
  if ((!input.traceId && !input.targetId) || (input.traceId && input.targetId)) {
    throw new MakoToolError(400, "invalid_tool_input", "Provide exactly one of traceId or targetId.");
  }
}

export function resolveTrustTargetAndRun(
  projectStore: TrustLocatorStore,
  input: TrustLocatorInput,
): { target: AnswerComparableTargetRecord; run: AnswerTrustRunRecord } {
  assertExclusiveTrustLocator(input);

  if (input.traceId) {
    const run = projectStore.getAnswerTrustRun(input.traceId);
    if (!run) {
      throw new MakoToolError(404, "trust_run_not_found", `Unknown trust run: ${input.traceId}`);
    }
    return {
      target: run.target,
      run,
    };
  }

  const target = projectStore.getAnswerComparableTarget(input.targetId as string);
  if (!target) {
    throw new MakoToolError(404, "trust_target_not_found", `Unknown comparable target: ${input.targetId}`);
  }

  const latestRun = projectStore.getLatestComparableAnswerRun({
    projectId: target.projectId,
    queryKind: target.queryKind,
    queryText: target.normalizedQueryText,
    identity: target.identity,
  });
  if (!latestRun) {
    throw new MakoToolError(
      404,
      "trust_target_not_found",
      `Comparable target ${input.targetId} has no trust history.`,
    );
  }

  return {
    target,
    run: latestRun,
  };
}
