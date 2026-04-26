import type { BenchmarkRunRecord } from "@mako-ai/store";
import type {
  TrustEvalAssertionFixture,
  TrustEvalAssertionType,
  TrustEvalBaselineSelection,
  TrustEvalCaseFixture,
  TrustEvalCaseOutcome,
  TrustEvalCaseRunResult,
  TrustEvalFamilyDelta,
  TrustEvalRunComparison,
  TrustEvalSuiteFixture,
  TrustEvalSuiteOutcome,
} from "./types.js";
import { failureReasonsEqual } from "./runner-helpers.js";
import { scoreWeight } from "./runner-assertions.js";
import type { JsonObject } from "@mako-ai/contracts";

export function toSuiteOutcome(caseResults: TrustEvalCaseRunResult[]): TrustEvalSuiteOutcome {
  const activeResults = caseResults.filter((result) => result.lifecycle === "active");
  if (activeResults.some((result) => result.outcome === "errored" || result.outcome === "miss")) {
    return "failed";
  }
  if (activeResults.some((result) => result.outcome === "partial")) {
    return "partial";
  }
  return "passed";
}

interface BaselineCaseSignal {
  outcome: TrustEvalCaseOutcome;
  failureReasons: TrustEvalAssertionType[];
}

export function buildComparison(
  baselineRun: BenchmarkRunRecord | null,
  baselineSelection: TrustEvalBaselineSelection,
  baselineCaseSignals: Map<string, BaselineCaseSignal>,
  currentCaseResults: TrustEvalCaseRunResult[],
): TrustEvalRunComparison {
  const improvedCaseIds: string[] = [];
  const regressedCaseIds: string[] = [];
  const assertionDriftCaseIds: string[] = [];
  const unchangedCaseIds: string[] = [];
  const newCaseIds: string[] = [];
  const familyAggregate = new Map<string, TrustEvalFamilyDelta>();

  const upsertFamily = (family: string): TrustEvalFamilyDelta => {
    const existing = familyAggregate.get(family);
    if (existing) {
      return existing;
    }
    const created: TrustEvalFamilyDelta = {
      family,
      improved: 0,
      regressed: 0,
      assertionDrift: 0,
      unchanged: 0,
      previousScore: 0,
      currentScore: 0,
    };
    familyAggregate.set(family, created);
    return created;
  };

  for (const result of currentCaseResults) {
    if (result.lifecycle !== "active") {
      continue;
    }
    const baselineSignal = baselineCaseSignals.get(result.caseId);
    const currentScore = scoreWeight(result.outcome);
    const family = result.family ?? "uncategorized";
    const familyDelta = upsertFamily(family);
    familyDelta.currentScore += currentScore;

    if (!baselineSignal) {
      newCaseIds.push(result.caseId);
      continue;
    }

    const baselineScore = scoreWeight(baselineSignal.outcome);
    familyDelta.previousScore += baselineScore;

    if (currentScore > baselineScore) {
      improvedCaseIds.push(result.caseId);
      familyDelta.improved += 1;
      continue;
    }

    if (currentScore < baselineScore) {
      regressedCaseIds.push(result.caseId);
      familyDelta.regressed += 1;
      continue;
    }

    if (!failureReasonsEqual(result.failureReasons, baselineSignal.failureReasons)) {
      assertionDriftCaseIds.push(result.caseId);
      familyDelta.assertionDrift += 1;
      continue;
    }

    unchangedCaseIds.push(result.caseId);
    familyDelta.unchanged += 1;
  }

  return {
    baselineRunId: baselineRun?.runId,
    baselineSelection,
    improvedCaseIds,
    regressedCaseIds,
    assertionDriftCaseIds,
    unchangedCaseIds,
    newCaseIds,
    familyDeltas: [...familyAggregate.values()].sort((left, right) =>
      left.family.localeCompare(right.family),
    ),
  };
}

export function buildSuiteConfig(fixture: TrustEvalSuiteFixture): JsonObject {
  const baseline = fixture.baseline
    ? {
        mode: fixture.baseline.mode ?? "heuristic",
        runId: fixture.baseline.runId ?? null,
      }
    : {
        mode: "heuristic",
        runId: null,
      };
  return {
    source: "trust_eval",
    kind: fixture.kind,
    tags: fixture.tags ?? [],
    metadata: fixture.metadata ?? {},
    baseline,
  };
}

export function buildCaseExpectedOutcome(caseFixture: TrustEvalCaseFixture): JsonObject {
  return {
    lifecycle: caseFixture.lifecycle ?? "active",
    family: caseFixture.family ?? null,
    trustAgeDays: caseFixture.trustAgeDays ?? null,
    rerun:
      caseFixture.rerun == null
        ? null
        : {
            mutationKind: caseFixture.rerun.mutation.kind,
            expectedOlderState: caseFixture.rerun.expectedOlderState,
            expectedNewerState: caseFixture.rerun.expectedNewerState,
          },
    tags: caseFixture.tags ?? [],
    description: caseFixture.description ?? null,
    metadata: caseFixture.metadata ?? {},
  };
}

export function buildAssertionId(
  suiteId: string,
  caseId: string,
  index: number,
  assertion: TrustEvalAssertionFixture,
): string {
  return assertion.assertionId ?? `${suiteId}:${caseId}:${index}:${assertion.type}`;
}
