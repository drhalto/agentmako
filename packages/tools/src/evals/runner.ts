import { randomUUID } from "node:crypto";
import {
  extractAnswerResultFromToolOutput,
  extractAskOutputFromToolOutput,
  type AnswerTrustEvaluationRecord,
  type ArtifactUsefulnessEvaluation,
  type PowerWorkflowUsefulnessEvaluation,
} from "@mako-ai/contracts";
import { type IndexSnapshot, type ProjectStore } from "@mako-ai/store";
import { isMakoToolError } from "../errors.js";
import { invokeTool } from "../registry.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { evaluateTrustState } from "../trust/evaluate-trust-state.js";
import { rerunAndCompare, type RerunAndCompareResult } from "../trust/rerun-and-compare.js";
import { DAY_MS } from "../time.js";
import {
  evaluateWorkflowPacketUsefulness,
  summarizeWorkflowPacketPromotionMetrics,
  type WorkflowPacketUsefulnessEvaluation,
} from "../workflow-packets/usefulness.js";
import {
  decidePowerWorkflowExposure,
  evaluatePowerWorkflowUsefulness,
  summarizePowerWorkflowPromotionMetrics,
} from "../workflow-evaluation.js";
import {
  decideArtifactExposure,
  evaluateArtifactUsefulness,
  extractArtifactFromToolOutput,
  summarizeArtifactPromotionMetrics,
} from "../artifact-evaluation.js";
import type {
  TrustEvalCaseFixture,
  TrustEvalCaseRunResult,
  TrustEvalRunSummary,
  TrustEvalSuiteFixture,
  TrustEvalSuiteOutcome,
} from "./types.js";
import {
  coerceCaseOutcome,
  countObservedWorkflowFollowups,
  extractFailureReasons,
  normalizeFailureReasons,
  resolveToolRun,
  selectBaselineRun,
} from "./runner-helpers.js";
import { normalizeStringArray } from "../workflow-packets/common.js";
import {
  buildActualCaseValue,
  buildRerunAssertionResults,
  evaluateAssertion,
  scoreCase,
} from "./runner-assertions.js";
import {
  buildAssertionId,
  buildCaseExpectedOutcome,
  buildComparison,
  buildSuiteConfig,
  toSuiteOutcome,
} from "./runner-summary.js";

function applySnapshotMutation(
  projectStore: ProjectStore,
  mutation: NonNullable<TrustEvalCaseFixture["rerun"]>["mutation"],
): void {
  const indexRun = projectStore.beginIndexRun(mutation.triggerSource ?? "trust_eval_rerun");
  try {
    const stats = projectStore.replaceIndexSnapshot(mutation.snapshot);
    projectStore.finishIndexRun(indexRun.runId, "succeeded", { ...stats });
  } catch (error) {
    projectStore.finishIndexRun(
      indexRun.runId,
      "failed",
      undefined,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

function captureCurrentIndexSnapshot(projectStore: ProjectStore): IndexSnapshot {
  const files = projectStore.listFiles().map((file) => {
    const detail = projectStore.getFileDetail(file.path);
    const content = projectStore.getFileContent(file.path) ?? "";
    return {
      path: file.path,
      sha256: file.sha256 ?? "",
      language: file.language,
      sizeBytes: file.sizeBytes,
      lineCount: file.lineCount,
      isGenerated: file.isGenerated,
      lastModifiedAt: file.lastModifiedAt,
      chunks: [
        {
          chunkKind: "file",
          name: file.path,
          lineStart: 1,
          lineEnd: file.lineCount,
          content,
        },
      ],
      symbols: detail?.symbols ?? [],
      imports:
        detail?.outboundImports.map((edge) => ({
          targetPath: edge.targetPath,
          specifier: edge.specifier,
          importKind: edge.importKind,
          isTypeOnly: edge.isTypeOnly,
          line: edge.line,
        })) ?? [],
      routes:
        detail?.routes.map((route) => ({
          routeKey: route.routeKey,
          framework: route.framework,
          pattern: route.pattern,
          method: route.method,
          handlerName: route.handlerName,
          isApi: route.isApi,
          metadata: route.metadata,
        })) ?? [],
    };
  });

  const schemaObjects = projectStore.listSchemaObjects().map((object) => ({
    objectKey: `${object.schemaName}.${object.objectType}.${object.objectName}.${object.parentObjectName ?? ""}`,
    objectType: object.objectType,
    schemaName: object.schemaName,
    objectName: object.objectName,
    parentObjectName: object.parentObjectName,
    dataType: object.dataType,
    definition: object.definition,
  }));

  const schemaUsages = projectStore.listSchemaObjects().flatMap((object) =>
    projectStore.listSchemaUsages(object.objectId).map((usage) => ({
      objectKey: `${object.schemaName}.${object.objectType}.${object.objectName}.${object.parentObjectName ?? ""}`,
      filePath: usage.filePath,
      usageKind: usage.usageKind,
      line: usage.line,
      excerpt: usage.excerpt,
    })),
  );

  return {
    files,
    schemaObjects,
    schemaUsages,
  };
}

export function registerTrustEvalSuite(
  projectStore: ProjectStore,
  fixture: TrustEvalSuiteFixture,
): void {
  projectStore.saveBenchmarkSuite({
    suiteId: fixture.suiteId,
    name: fixture.name,
    description: fixture.description,
    version: fixture.version,
    config: buildSuiteConfig(fixture),
  });

  for (const caseFixture of fixture.cases) {
    projectStore.saveBenchmarkCase({
      caseId: caseFixture.caseId,
      suiteId: fixture.suiteId,
      name: caseFixture.name,
      toolName: caseFixture.toolName,
      input: caseFixture.input,
      expectedOutcome: buildCaseExpectedOutcome(caseFixture),
    });

    caseFixture.assertions.forEach((assertion, index) => {
      projectStore.saveBenchmarkAssertion({
        assertionId: buildAssertionId(fixture.suiteId, caseFixture.caseId, index, assertion),
        caseId: caseFixture.caseId,
        assertionType: assertion.type,
        expectedValue: assertion.expectedValue,
        tolerance: assertion.tolerance,
      });
    });

    if (caseFixture.rerun) {
      projectStore.saveBenchmarkAssertion({
        assertionId: `${fixture.suiteId}:${caseFixture.caseId}:rerun:older_state`,
        caseId: caseFixture.caseId,
        assertionType: "rerun_older_trust_state_equals",
        expectedValue: caseFixture.rerun.expectedOlderState,
      });
      projectStore.saveBenchmarkAssertion({
        assertionId: `${fixture.suiteId}:${caseFixture.caseId}:rerun:newer_state`,
        caseId: caseFixture.caseId,
        assertionType: "rerun_newer_trust_state_equals",
        expectedValue: caseFixture.rerun.expectedNewerState,
      });
    }
  }
}

function mergeLocator(projectId: string, baseInput: Record<string, unknown>) {
  return {
    projectId,
    ...baseInput,
  };
}

export async function runTrustEvalSuite(
  locator: { projectId?: string; projectRef?: string },
  fixture: TrustEvalSuiteFixture,
  options: ToolServiceOptions = {},
): Promise<TrustEvalRunSummary> {
  return withProjectContext(locator, options, async ({ project, projectStore }) => {
    registerTrustEvalSuite(projectStore, fixture);

    const { run: baselineRun, selection: baselineSelection } = selectBaselineRun(
      projectStore,
      fixture.suiteId,
      fixture.baseline,
    );
    const baselineCaseSignals = new Map<
      string,
      {
        outcome: TrustEvalCaseRunResult["outcome"];
        failureReasons: ReturnType<typeof extractFailureReasons>;
      }
    >();
    if (baselineRun) {
      for (const baselineCaseResult of projectStore.listBenchmarkCaseResults({
        runId: baselineRun.runId,
      })) {
        baselineCaseSignals.set(baselineCaseResult.caseId, {
          outcome: coerceCaseOutcome(baselineCaseResult.outcome),
          failureReasons: extractFailureReasons(baselineCaseResult.actualValue ?? null),
        });
      }
    }

    const startedAt = new Date().toISOString();
    const caseResults: TrustEvalCaseRunResult[] = [];
    const powerWorkflowUsefulnessEvaluations: PowerWorkflowUsefulnessEvaluation[] = [];
    const artifactUsefulnessEvaluations: ArtifactUsefulnessEvaluation[] = [];

    for (const caseFixture of fixture.cases) {
      const lifecycle = caseFixture.lifecycle ?? "active";
      if (lifecycle !== "active") {
        caseResults.push({
          caseId: caseFixture.caseId,
          name: caseFixture.name,
          lifecycle,
          family: caseFixture.family,
          toolName: caseFixture.toolName,
          outcome: "skipped",
          actualValue: {
            skippedReason: `lifecycle:${lifecycle}`,
            failureReasons: [],
          },
          assertions: [],
          failureReasons: [],
        });
        continue;
      }

      const requestId = `eval_${randomUUID()}`;
      let output: Awaited<ReturnType<typeof invokeTool>> | null = null;
      let errorText: string | undefined;
      let errorCode: string | undefined;
      try {
        output = await invokeTool(caseFixture.toolName, mergeLocator(project.projectId, caseFixture.input), {
          ...options,
          requestContext: {
            ...options.requestContext,
            requestId,
            sessionProjectId: project.projectId,
            meta: {
              ...(options.requestContext?.meta ?? {}),
              trustEvalSuiteId: fixture.suiteId,
              trustEvalCaseId: caseFixture.caseId,
              trustEvalSuiteKind: fixture.kind,
            },
          },
          answerTraceOptions: {
            ...(options.answerTraceOptions ?? {}),
            provenance: "seeded_eval",
          },
        });
      } catch (error) {
        if (isMakoToolError(error)) {
          errorText = error.message;
          errorCode = error.code;
        } else if (error instanceof Error) {
          errorText = error.message;
          errorCode = error.name;
        } else {
          errorText = String(error);
        }
      }

      const toolRun = resolveToolRun(projectStore, requestId, caseFixture.toolName);
      if (!toolRun) {
        throw new Error(`trust-eval-runner: missing tool_runs row for ${caseFixture.toolName} request ${requestId}`);
      }

      const askOutput = extractAskOutputFromToolOutput(output);
      const answerResult = extractAnswerResultFromToolOutput(output);
      const trustRun =
        answerResult && typeof answerResult.queryId === "string"
          ? projectStore.getAnswerTrustRun(answerResult.queryId)
          : null;
      const trustEvaluation =
        answerResult && trustRun
          ? (
              await evaluateTrustState(
                {
                  projectId: project.projectId,
                  traceId: trustRun.traceId,
                  evaluatedAt:
                    typeof caseFixture.trustAgeDays === "number" &&
                    Number.isFinite(caseFixture.trustAgeDays)
                      ? new Date(
                          new Date(trustRun.createdAt).getTime() + caseFixture.trustAgeDays * DAY_MS,
                        ).toISOString()
                      : undefined,
                },
                options,
              )
            ).evaluation
          : null;
      const observedWorkflowFollowupCount = countObservedWorkflowFollowups(projectStore, answerResult);
      const workflowUsefulness = answerResult
        ? evaluateWorkflowPacketUsefulness(answerResult, {
            observedFollowupCount: observedWorkflowFollowupCount,
          })
        : null;
      const powerWorkflowUsefulness = output
        ? evaluatePowerWorkflowUsefulness(output, {
            observedFollowupCount: observedWorkflowFollowupCount,
          })
        : null;
      if (powerWorkflowUsefulness) {
        powerWorkflowUsefulnessEvaluations.push(powerWorkflowUsefulness);
      }
      // 7.5: if the tool output carries one of the four artifact kinds,
      // grade it and collect for the run-summary aggregate. Non-artifact
      // outputs return null from extractArtifactFromToolOutput so this is
      // a no-op on power-workflow cases.
      const artifactFromOutput = output ? extractArtifactFromToolOutput(output) : null;
      const artifactUsefulness = artifactFromOutput
        ? evaluateArtifactUsefulness(artifactFromOutput, {
            observedFollowupCount: observedWorkflowFollowupCount,
          })
        : null;
      if (artifactUsefulness) {
        artifactUsefulnessEvaluations.push(artifactUsefulness);
      }

      let rerunResult: RerunAndCompareResult | null = null;
      let rerunOlderEvaluation: AnswerTrustEvaluationRecord | null = null;
      let rerunNewerEvaluation: AnswerTrustEvaluationRecord | null = null;

      if (caseFixture.rerun) {
        if (!trustRun) {
          throw new Error(
            `trust-eval-runner: rerun case ${caseFixture.caseId} did not persist an initial trust run.`,
          );
        }
        const originalSnapshot = captureCurrentIndexSnapshot(projectStore);
        try {
          applySnapshotMutation(projectStore, caseFixture.rerun.mutation);
          rerunResult = await rerunAndCompare(
            {
              projectId: project.projectId,
              targetId: trustRun.targetId,
            },
            options,
          );
          rerunOlderEvaluation = (
            await evaluateTrustState(
              {
                projectId: project.projectId,
                traceId: rerunResult.priorRun.traceId,
              },
              options,
            )
          ).evaluation;
          rerunNewerEvaluation = (
            await evaluateTrustState(
              {
                projectId: project.projectId,
                traceId: rerunResult.currentRun.traceId,
              },
              options,
            )
          ).evaluation;
        } finally {
          applySnapshotMutation(projectStore, {
            kind: "replace_index_snapshot",
            snapshot: originalSnapshot,
            triggerSource: "trust_eval_rerun_restore",
          });
        }
      }

      const assertionResults = caseFixture.assertions.map((assertion, index) =>
        evaluateAssertion({
          assertionId: buildAssertionId(fixture.suiteId, caseFixture.caseId, index, assertion),
          assertion,
          output,
          askOutput,
          answerResult,
          trustRun,
          trustEvaluation,
          workflowUsefulness,
          powerWorkflowUsefulness,
          errorCode,
        }),
      );
      if (caseFixture.rerun && rerunOlderEvaluation && rerunNewerEvaluation) {
        assertionResults.push(
          ...buildRerunAssertionResults({
            suiteId: fixture.suiteId,
            caseId: caseFixture.caseId,
            rerun: caseFixture.rerun,
            olderEvaluation: rerunOlderEvaluation,
            newerEvaluation: rerunNewerEvaluation,
          }),
        );
      }

      const failureReasons = normalizeFailureReasons(assertionResults);
      const actualValue = buildActualCaseValue({
        output,
        askOutput,
        answerResult,
        trustRun,
        trustEvaluation,
        workflowUsefulness,
        powerWorkflowUsefulness,
        rerunResult,
        rerunOlderEvaluation,
        rerunNewerEvaluation,
        failureReasons,
        errorCode,
      });

      caseResults.push({
        caseId: caseFixture.caseId,
        name: caseFixture.name,
        lifecycle,
        family: caseFixture.family,
        toolName: caseFixture.toolName,
        outcome: scoreCase(assertionResults, errorText),
        requestId,
        toolRunId: toolRun.runId,
        traceId: answerResult?.queryId,
        targetId: trustRun?.targetId,
        actualValue,
        assertions: assertionResults,
        failureReasons,
        errorText,
        errorCode,
        rerunComparisonId: rerunResult?.comparison.comparisonId,
      });
    }

    const finishedAt = new Date().toISOString();
    const benchmarkRun = projectStore.insertBenchmarkRun({
      suiteId: fixture.suiteId,
      startedAt,
      finishedAt,
      outcome: toSuiteOutcome(caseResults),
      runnerVersion: "trust_eval_runner@1",
    });

    for (const result of caseResults) {
      if (!result.toolRunId) {
        continue;
      }

      const caseResultRecord = projectStore.insertBenchmarkCaseResult({
        runId: benchmarkRun.runId,
        caseId: result.caseId,
        toolRunId: result.toolRunId,
        outcome: result.outcome,
        actualValue: result.actualValue,
      });

      for (const assertion of result.assertions) {
        projectStore.insertBenchmarkAssertionResult({
          caseResultId: caseResultRecord.caseResultId,
          assertionId: assertion.assertionId,
          passed: assertion.passed,
          actualValue: assertion.actualValue,
          expectedValue: assertion.expectedValue,
        });
      }
    }

    const comparison = buildComparison(baselineRun, baselineSelection, baselineCaseSignals, caseResults);
    const workflowUsefulnessEvaluations: WorkflowPacketUsefulnessEvaluation[] = [];
    for (const result of caseResults) {
      const actualValue = result.actualValue as {
        workflowUsefulnessEligible?: boolean | null;
        workflowUsefulnessAttached?: boolean | null;
        workflowUsefulnessGrade?: "full" | "partial" | "no" | null;
        workflowUsefulnessReasonCodes?: string[];
        workflowObservedFollowupCount?: number | null;
      };
      if (
        typeof actualValue.workflowUsefulnessEligible !== "boolean" ||
        typeof actualValue.workflowUsefulnessAttached !== "boolean" ||
        (actualValue.workflowUsefulnessGrade !== "full" &&
          actualValue.workflowUsefulnessGrade !== "partial" &&
          actualValue.workflowUsefulnessGrade !== "no")
      ) {
        continue;
      }
      workflowUsefulnessEvaluations.push({
        eligible: actualValue.workflowUsefulnessEligible,
        attached: actualValue.workflowUsefulnessAttached,
        family: null,
        grade: actualValue.workflowUsefulnessGrade,
        reasonCodes: normalizeStringArray(
          actualValue.workflowUsefulnessReasonCodes ?? [],
        ) as WorkflowPacketUsefulnessEvaluation["reasonCodes"],
        observedFollowupCount:
          typeof actualValue.workflowObservedFollowupCount === "number" &&
          Number.isFinite(actualValue.workflowObservedFollowupCount)
            ? Math.max(0, Math.trunc(actualValue.workflowObservedFollowupCount))
            : 0,
      });
    }

    const workflowUsefulness = summarizeWorkflowPacketPromotionMetrics(workflowUsefulnessEvaluations);
    const powerWorkflowUsefulnessByTool =
      summarizePowerWorkflowPromotionMetrics(powerWorkflowUsefulnessEvaluations);
    const powerWorkflowUsefulness =
      powerWorkflowUsefulnessByTool.length > 0
        ? {
            byTool: powerWorkflowUsefulnessByTool,
            exposureDecisions: powerWorkflowUsefulnessByTool.map((metrics) =>
              decidePowerWorkflowExposure(metrics),
            ),
          }
        : undefined;
    const artifactUsefulnessByKind = summarizeArtifactPromotionMetrics(artifactUsefulnessEvaluations);
    const artifactUsefulness =
      artifactUsefulnessByKind.length > 0
        ? {
            byKind: artifactUsefulnessByKind,
            exposureDecisions: artifactUsefulnessByKind.map((metrics) =>
              decideArtifactExposure(metrics),
            ),
          }
        : undefined;

    return {
      runId: benchmarkRun.runId,
      suiteId: fixture.suiteId,
      outcome: benchmarkRun.outcome as TrustEvalSuiteOutcome,
      startedAt: benchmarkRun.startedAt,
      finishedAt: benchmarkRun.finishedAt,
      counts: {
        active: caseResults.filter((result) => result.lifecycle === "active").length,
        pass: caseResults.filter((result) => result.outcome === "pass").length,
        partial: caseResults.filter((result) => result.outcome === "partial").length,
        miss: caseResults.filter((result) => result.outcome === "miss").length,
        errored: caseResults.filter((result) => result.outcome === "errored").length,
        skipped: caseResults.filter((result) => result.outcome === "skipped").length,
      },
      caseResults,
      comparison,
      workflowUsefulness,
      powerWorkflowUsefulness,
      ...(artifactUsefulness ? { artifactUsefulness } : {}),
    };
  });
}
