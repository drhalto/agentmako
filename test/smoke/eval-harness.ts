import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  openGlobalStore,
  openProjectStore,
} from "../../packages/store/src/index.ts";
import {
  runTrustEvalSuite,
  type TrustEvalPacketSummary,
  type TrustEvalSuiteFixture,
} from "../../packages/tools/src/evals/index.ts";

function buildSmokeSnapshot(includeAuthSymbol: boolean) {
  const authBody = [
    "export function requireAuth() {",
    "  return 'auth';",
    "}",
  ].join("\n");
  const eventsRepoBody = [
    "import { supabase } from './client';",
    "",
    "export async function loadEvents() {",
    "  return supabase.from('events').select('*');",
    "}",
  ].join("\n");

  return {
    files: [
      {
        path: "src/auth.ts",
        sha256: includeAuthSymbol ? "auth-with-symbol" : "auth-without-symbol",
        language: "typescript",
        sizeBytes: Buffer.byteLength(`${authBody}\n`, "utf8"),
        lineCount: authBody.split("\n").length,
        chunks: [
          {
            chunkKind: "file",
            name: "src/auth.ts",
            lineStart: 1,
            lineEnd: authBody.split("\n").length,
            content: authBody,
          },
        ],
        symbols: includeAuthSymbol
          ? [
              {
                name: "requireAuth",
                kind: "function",
                exportName: "requireAuth",
                lineStart: 1,
                lineEnd: 3,
                signatureText: "export function requireAuth()",
              },
            ]
          : [],
        imports: [],
        routes: [],
      },
      {
        path: "src/events-repo.ts",
        sha256: "events",
        language: "typescript",
        sizeBytes: Buffer.byteLength(`${eventsRepoBody}\n`, "utf8"),
        lineCount: eventsRepoBody.split("\n").length,
        chunks: [
          {
            chunkKind: "file",
            name: "src/events-repo.ts",
            lineStart: 1,
            lineEnd: eventsRepoBody.split("\n").length,
            content: eventsRepoBody,
          },
        ],
        symbols: [],
        imports: [],
        routes: [],
      },
    ],
    schemaObjects: [],
    schemaUsages: [],
  };
}

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "trust-eval-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  const authBody = [
    "export function requireAuth() {",
    "  return 'auth';",
    "}",
  ].join("\n");
  writeFileSync(path.join(projectRoot, "src", "auth.ts"), `${authBody}\n`);
  const eventsRepoBody = [
    "import { supabase } from './client';",
    "",
    "export async function loadEvents() {",
    "  return supabase.from('events').select('*');",
    "}",
  ].join("\n");
  writeFileSync(path.join(projectRoot, "src", "events-repo.ts"), `${eventsRepoBody}\n`);

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "trust-eval-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "trust-eval-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: "src",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });

    store.replaceIndexSnapshot(buildSmokeSnapshot(true));

    const indexRun = store.beginIndexRun("smoke");
    store.finishIndexRun(indexRun.runId, "succeeded");

    const now = new Date().toISOString();
    store.saveSchemaSnapshot({
      snapshotId: `snap_${randomUUID()}`,
      sourceMode: "repo_only",
      generatedAt: now,
      refreshedAt: now,
      fingerprint: "trust-eval-smoke",
      freshnessStatus: "fresh",
      driftDetected: false,
      sources: [],
      warnings: [],
      ir: {
        version: "1.0.0",
        schemas: {
          public: {
            tables: [
              {
                name: "events",
                schema: "public",
                sources: [],
                columns: [
                  {
                    name: "id",
                    dataType: "uuid",
                    nullable: false,
                    isPrimaryKey: true,
                    sources: [],
                  },
                ],
                indexes: [],
                rls: {
                  rlsEnabled: true,
                  forceRls: false,
                  policies: [],
                },
                triggers: [],
              },
            ],
            views: [],
            enums: [],
            rpcs: [],
          },
        },
      },
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-eval-harness-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    const vagueSuite: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_vague_smoke",
      name: "Trust Eval Vague Smoke",
      kind: "vague_question",
      version: "1.0.0",
      cases: [
        {
          caseId: "vague_auth_file",
          name: "What does src/auth.ts do?",
          toolName: "ask",
          family: "orientation",
          input: {
            question: "what does src/auth.ts do?",
          },
          assertions: [
            { type: "selected_tool_equals", expectedValue: "file_health" },
            { type: "selected_family_equals", expectedValue: "answers" },
            { type: "result_query_kind_equals", expectedValue: "file_health" },
            { type: "result_evidence_file_includes", expectedValue: "src/auth.ts" },
            { type: "result_evidence_file_excludes", expectedValue: "src/events-repo.ts" },
            { type: "result_missing_info_excludes", expectedValue: "missing_file" },
            { type: "trust_identity_kind_equals", expectedValue: "file_target" },
            { type: "trust_provenance_equals", expectedValue: "seeded_eval" },
          ],
        },
        {
          caseId: "retired_auth_file",
          name: "Retired case is excluded",
          toolName: "ask",
          lifecycle: "retired",
          family: "orientation",
          input: {
            question: "what does src/auth.ts do?",
          },
          assertions: [
            { type: "selected_tool_equals", expectedValue: "trace_file" },
          ],
        },
      ],
    };

    const vagueRun = await runTrustEvalSuite({ projectId }, vagueSuite);
    assert.equal(vagueRun.outcome, "passed");
    assert.deepEqual(vagueRun.counts, {
      active: 1,
      pass: 1,
      partial: 0,
      miss: 0,
      errored: 0,
      skipped: 1,
    });
    assert.equal(vagueRun.caseResults[0]?.toolName, "ask");
    assert.equal(vagueRun.caseResults[0]?.actualValue.provenance, "seeded_eval");
    assert.equal(typeof vagueRun.caseResults[0]?.actualValue.trustState, "string");
    assert.deepEqual(vagueRun.caseResults[0]?.failureReasons, []);
    assert.equal(vagueRun.comparison.baselineRunId, undefined);
    assert.equal(vagueRun.comparison.baselineSelection, "none");

    const trustFreshnessSuite: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_freshness_smoke",
      name: "Trust Eval Freshness Smoke",
      kind: "vague_question",
      version: "1.0.0",
      cases: [
        {
          caseId: "aging_auth_file",
          name: "Auth file becomes aging after 45 days",
          toolName: "trace_table",
          family: "trust_freshness",
          trustAgeDays: 45,
          input: {
            table: "events",
          },
          assertions: [
            { type: "result_query_kind_equals", expectedValue: "trace_table" },
            { type: "trust_state_equals", expectedValue: "aging" },
            { type: "trust_reason_code_includes", expectedValue: "freshness_warning" },
          ],
        },
        {
          caseId: "stale_auth_file",
          name: "Auth file becomes stale after 95 days",
          toolName: "trace_table",
          family: "trust_freshness",
          trustAgeDays: 95,
          input: {
            table: "events",
          },
          assertions: [
            { type: "result_query_kind_equals", expectedValue: "trace_table" },
            { type: "trust_state_equals", expectedValue: "stale" },
            { type: "trust_reason_code_includes", expectedValue: "freshness_expired" },
          ],
        },
      ],
    };

    const trustFreshnessRun = await runTrustEvalSuite({ projectId }, trustFreshnessSuite);
    assert.equal(trustFreshnessRun.outcome, "passed");
    assert.equal(trustFreshnessRun.counts.pass, 2);
    assert.equal(trustFreshnessRun.caseResults[0]?.actualValue.trustState, "aging");
    assert.ok(
      Array.isArray(trustFreshnessRun.caseResults[0]?.actualValue.trustReasonCodes) &&
        trustFreshnessRun.caseResults[0]?.actualValue.trustReasonCodes.includes("freshness_warning"),
    );
    assert.equal(trustFreshnessRun.caseResults[1]?.actualValue.trustState, "stale");
    assert.ok(
      Array.isArray(trustFreshnessRun.caseResults[1]?.actualValue.trustReasonCodes) &&
        trustFreshnessRun.caseResults[1]?.actualValue.trustReasonCodes.includes("freshness_expired"),
    );

    const trustSufficiencySuite: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_sufficiency_smoke",
      name: "Trust Eval Sufficiency Smoke",
      kind: "vague_question",
      version: "1.0.0",
      cases: [
        {
          caseId: "district_sync_no_hits",
          name: "No-hit cross search becomes insufficient evidence",
          toolName: "ask",
          family: "trust_sufficiency",
          input: {
            question: "how is district sync approval enforced?",
          },
          assertions: [
            { type: "selected_tool_equals", expectedValue: "cross_search" },
            { type: "trust_state_equals", expectedValue: "insufficient_evidence" },
            { type: "trust_reason_code_includes", expectedValue: "partial_evidence" },
            { type: "trust_reason_code_includes", expectedValue: "best_effort_support" },
          ],
        },
      ],
    };

    const trustSufficiencyRun = await runTrustEvalSuite({ projectId }, trustSufficiencySuite);
    assert.equal(trustSufficiencyRun.outcome, "passed");
    assert.equal(trustSufficiencyRun.counts.pass, 1);
    assert.equal(trustSufficiencyRun.caseResults[0]?.actualValue.trustState, "insufficient_evidence");
    assert.ok(
      Array.isArray(trustSufficiencyRun.caseResults[0]?.actualValue.trustReasonCodes) &&
        trustSufficiencyRun.caseResults[0]?.actualValue.trustReasonCodes.includes("partial_evidence"),
    );
    assert.ok(
      Array.isArray(trustSufficiencyRun.caseResults[0]?.actualValue.trustReasonCodes) &&
        trustSufficiencyRun.caseResults[0]?.actualValue.trustReasonCodes.includes("best_effort_support"),
    );

    const workflowUsefulnessSuite: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_workflow_usefulness_smoke",
      name: "Trust Eval Workflow Usefulness Smoke",
      kind: "vague_question",
      version: "1.0.0",
      cases: [
        {
          caseId: "workflow_auth_file_health",
          name: "Auth file health attaches a useful verification plan companion",
          toolName: "ask",
          family: "workflow_usefulness",
          input: {
            question: "what does src/auth.ts do?",
          },
          assertions: [
            { type: "selected_tool_equals", expectedValue: "file_health" },
            { type: "companion_packet_family_equals", expectedValue: "verification_plan" },
            { type: "companion_handoff_present_equals", expectedValue: true },
            { type: "companion_handoff_current_contains", expectedValue: "Re-trace" },
            { type: "companion_handoff_stop_when_contains", expectedValue: "resolves cleanly" },
            { type: "workflow_usefulness_grade_equals", expectedValue: "full" },
            { type: "workflow_usefulness_reason_includes", expectedValue: "handoff_present" },
            { type: "workflow_usefulness_reason_includes", expectedValue: "grounded_citations" },
          ],
        },
      ],
    };
    const workflowUsefulnessRun = await runTrustEvalSuite({ projectId }, workflowUsefulnessSuite);
    assert.equal(workflowUsefulnessRun.outcome, "passed");
    assert.equal(workflowUsefulnessRun.counts.pass, 1);
    assert.equal(
      workflowUsefulnessRun.caseResults[0]?.actualValue.companionPacketFamily,
      "verification_plan",
    );
    assert.equal(workflowUsefulnessRun.caseResults[0]?.actualValue.workflowUsefulnessGrade, "full");
    assert.equal(workflowUsefulnessRun.workflowUsefulness?.eligibleCount, 1);
    assert.equal(workflowUsefulnessRun.workflowUsefulness?.attachedCount, 1);
    assert.equal(workflowUsefulnessRun.workflowUsefulness?.fullCount, 1);
    assert.equal(workflowUsefulnessRun.workflowUsefulness?.noCount, 0);
    assert.equal(workflowUsefulnessRun.workflowUsefulness?.actualFollowupTakenCount, 0);
    assert.equal(workflowUsefulnessRun.workflowUsefulness?.actualFollowupRate, null);
    assert.equal(workflowUsefulnessRun.workflowUsefulness?.packetHelpedNextStepRate, 1);
    assert.equal(workflowUsefulnessRun.workflowUsefulness?.noNoiseRate, 1);

    const powerWorkflowSuite: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_power_workflow_smoke",
      name: "Trust Eval Power Workflow Smoke",
      kind: "vague_question",
      version: "1.0.0",
      cases: [
        {
          caseId: "power_workflow_suggest_auth_file",
          name: "Suggest routes auth file question to one canonical tool recommendation",
          toolName: "suggest",
          family: "power_workflows",
          input: {
            question: "what does src/auth.ts do?",
          },
          assertions: [],
        },
        {
          caseId: "power_workflow_investigate_auth_file",
          name: "Investigate executes the bounded canonical auth file path",
          toolName: "investigate",
          family: "power_workflows",
          input: {
            question: "what does src/auth.ts do?",
          },
          assertions: [],
        },
      ],
    };
    const powerWorkflowRun = await runTrustEvalSuite({ projectId }, powerWorkflowSuite);
    assert.equal(powerWorkflowRun.outcome, "passed");
    assert.equal(powerWorkflowRun.counts.pass, 2);
    assert.equal(
      powerWorkflowRun.caseResults[0]?.actualValue.powerWorkflowUsefulnessGrade,
      "partial",
    );
    assert.deepEqual(
      Array.isArray(powerWorkflowRun.caseResults[0]?.actualValue.powerWorkflowUsefulnessReasonCodes) &&
        powerWorkflowRun.caseResults[0]?.actualValue.powerWorkflowUsefulnessReasonCodes.includes(
          "canonical_tool_selected",
        ),
      true,
    );
    assert.equal(
      powerWorkflowRun.caseResults[1]?.actualValue.powerWorkflowUsefulnessGrade,
      "full",
    );
    assert.equal(powerWorkflowRun.powerWorkflowUsefulness?.byTool.length, 2);
    assert.equal(
      powerWorkflowRun.powerWorkflowUsefulness?.byTool.find((item) => item.toolName === "suggest")
        ?.helpfulRate,
      1,
    );
    assert.equal(
      powerWorkflowRun.powerWorkflowUsefulness?.byTool.find((item) => item.toolName === "investigate")
        ?.helpfulRate,
      1,
    );
    assert.equal(
      powerWorkflowRun.powerWorkflowUsefulness?.exposureDecisions.find(
        (item) => item.toolName === "suggest",
      )?.exposure,
      "dark",
    );
    assert.equal(
      powerWorkflowRun.powerWorkflowUsefulness?.exposureDecisions.find(
        (item) => item.toolName === "investigate",
      )?.exposure,
      "opt_in",
    );

    const packetSummary = vagueRun.caseResults[0]?.actualValue.packetSummary as TrustEvalPacketSummary | undefined;
    assert.ok(packetSummary, "expected vague question run to capture packet summary");

    const snapshotSuite: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_snapshot_smoke",
      name: "Trust Eval Snapshot Smoke",
      kind: "packet_snapshot",
      version: "1.0.0",
      cases: [
        {
          caseId: "snapshot_auth_file",
          name: "Snapshot auth file packet summary",
          toolName: "ask",
          family: "snapshots",
          input: {
            question: "what does src/auth.ts do?",
          },
          assertions: [
            { type: "packet_summary_equals", expectedValue: packetSummary },
            { type: "trust_provenance_equals", expectedValue: "seeded_eval" },
          ],
        },
      ],
    };

    const snapshotRun = await runTrustEvalSuite({ projectId }, snapshotSuite);
    assert.equal(snapshotRun.outcome, "passed");
    assert.equal(snapshotRun.counts.pass, 1);

    const seededSuite: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_seeded_smoke",
      name: "Trust Eval Seeded Smoke",
      kind: "seeded_defect",
      version: "1.0.0",
      cases: [
        {
          caseId: "seeded_events_table",
          name: "Trace events table for seeded drift context",
          toolName: "trace_table",
          family: "schema_alignment",
          input: {
            table: "events",
          },
          assertions: [
            { type: "result_query_kind_equals", expectedValue: "trace_table" },
            { type: "result_evidence_file_includes", expectedValue: "src/events-repo.ts" },
            { type: "trust_identity_kind_equals", expectedValue: "table_target" },
            { type: "trust_provenance_equals", expectedValue: "seeded_eval" },
          ],
        },
      ],
    };

    const seededRun = await runTrustEvalSuite({ projectId }, seededSuite);
    assert.equal(seededRun.outcome, "passed");
    assert.equal(seededRun.counts.pass, 1);

    const regressedVagueSuite: TrustEvalSuiteFixture = {
      ...vagueSuite,
      version: "1.0.1",
      cases: [
        {
          ...vagueSuite.cases[0]!,
          assertions: [
            { type: "selected_tool_equals", expectedValue: "trace_file" },
          ],
        },
        vagueSuite.cases[1]!,
      ],
    };

    const regressedRun = await runTrustEvalSuite({ projectId }, regressedVagueSuite);
    assert.equal(regressedRun.outcome, "failed");
    assert.deepEqual(regressedRun.comparison.regressedCaseIds, ["vague_auth_file"]);
    assert.equal(regressedRun.comparison.baselineRunId, vagueRun.runId);
    assert.equal(regressedRun.comparison.baselineSelection, "last_passed");
    assert.deepEqual(regressedRun.caseResults[0]?.failureReasons, ["selected_tool_equals"]);
    assert.equal(regressedRun.comparison.familyDeltas[0]?.family, "orientation");
    assert.equal(regressedRun.comparison.familyDeltas[0]?.regressed, 1);

    const secondRegressedRun = await runTrustEvalSuite({ projectId }, regressedVagueSuite);
    assert.equal(secondRegressedRun.outcome, "failed");
    assert.equal(
      secondRegressedRun.comparison.baselineRunId,
      vagueRun.runId,
      "baseline should stay pinned to last passed run instead of drifting to the previous regression",
    );
    assert.equal(secondRegressedRun.comparison.baselineSelection, "last_passed");

    const pinnedBaselineRun = await runTrustEvalSuite(
      { projectId },
      {
        ...regressedVagueSuite,
        baseline: {
          mode: "pinned",
          runId: vagueRun.runId,
        },
      },
    );
    assert.equal(pinnedBaselineRun.outcome, "failed");
    assert.equal(pinnedBaselineRun.comparison.baselineRunId, vagueRun.runId);
    assert.equal(pinnedBaselineRun.comparison.baselineSelection, "pinned");

    const driftSuiteBase: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_drift_smoke",
      name: "Trust Eval Assertion Drift Smoke",
      kind: "vague_question",
      version: "1.0.0",
      cases: [
        {
          caseId: "drift_case_1",
          name: "Assertion drift probe",
          toolName: "trace_table",
          family: "schema_alignment",
          input: { table: "events" },
          assertions: [
            { type: "result_query_kind_equals", expectedValue: "trace_table" },
            { type: "trust_identity_kind_equals", expectedValue: "WRONG_IDENTITY" },
          ],
        },
      ],
    };
    const driftFirstRun = await runTrustEvalSuite({ projectId }, driftSuiteBase);
    assert.equal(driftFirstRun.outcome, "partial");
    assert.deepEqual(driftFirstRun.caseResults[0]?.failureReasons, ["trust_identity_kind_equals"]);

    const driftSuiteShifted: TrustEvalSuiteFixture = {
      ...driftSuiteBase,
      version: "1.0.1",
      cases: [
        {
          ...driftSuiteBase.cases[0]!,
          assertions: [
            { type: "result_query_kind_equals", expectedValue: "trace_table" },
            { type: "trust_provenance_equals", expectedValue: "WRONG_PROVENANCE" },
          ],
        },
      ],
    };
    const driftSecondRun = await runTrustEvalSuite({ projectId }, driftSuiteShifted);
    assert.equal(driftSecondRun.outcome, "partial");
    assert.deepEqual(driftSecondRun.caseResults[0]?.failureReasons, ["trust_provenance_equals"]);
    assert.equal(driftSecondRun.comparison.baselineRunId, driftFirstRun.runId);
    assert.equal(driftSecondRun.comparison.baselineSelection, "last_partial");
    assert.deepEqual(driftSecondRun.comparison.assertionDriftCaseIds, ["drift_case_1"]);
    assert.deepEqual(driftSecondRun.comparison.regressedCaseIds, []);
    assert.deepEqual(driftSecondRun.comparison.improvedCaseIds, []);
    assert.equal(driftSecondRun.comparison.familyDeltas[0]?.assertionDrift, 1);
    assert.equal(driftSecondRun.comparison.familyDeltas[0]?.unchanged, 0);

    const errorSuite: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_error_smoke",
      name: "Trust Eval Error Smoke",
      kind: "regression_compare",
      version: "1.0.0",
      cases: [
        {
          caseId: "invalid_trace_table_input",
          name: "Invalid trace_table input returns a structured error code",
          toolName: "trace_table",
          family: "errors",
          input: {},
          assertions: [
            { type: "error_code_equals", expectedValue: "invalid_tool_input" },
          ],
        },
      ],
    };
    const errorRun = await runTrustEvalSuite({ projectId }, errorSuite);
    assert.equal(errorRun.outcome, "failed");
    assert.equal(errorRun.caseResults[0]?.outcome, "errored");
    assert.equal(errorRun.caseResults[0]?.errorCode, "invalid_tool_input");
    assert.deepEqual(errorRun.caseResults[0]?.failureReasons, []);

    const contradictionSuite: TrustEvalSuiteFixture = {
      suiteId: "trust_eval_contradiction_smoke",
      name: "Trust Eval Contradiction Smoke",
      kind: "seeded_defect",
      version: "1.0.0",
      cases: [
        {
          caseId: "trace_file_symbol_removed_contradiction",
          name: "Removing a surfaced symbol contradicts the older trace_file run when strong evidence disappears without replacement",
          toolName: "trace_file",
          family: "trust_contradiction",
          input: {
            file: "src/auth.ts",
          },
          assertions: [
            { type: "result_query_kind_equals", expectedValue: "trace_file" },
            { type: "result_evidence_file_includes", expectedValue: "src/auth.ts" },
            { type: "trust_identity_kind_equals", expectedValue: "file_target" },
            { type: "trust_provenance_equals", expectedValue: "seeded_eval" },
          ],
          rerun: {
            mutation: {
              kind: "replace_index_snapshot",
              snapshot: buildSmokeSnapshot(false),
              triggerSource: "trust_eval_rerun_smoke",
            },
            expectedOlderState: "contradicted",
            expectedNewerState: "changed",
          },
        },
      ],
    };

    const contradictionRun = await runTrustEvalSuite({ projectId }, contradictionSuite);
    assert.equal(contradictionRun.outcome, "passed");
    assert.equal(contradictionRun.counts.pass, 1);
    assert.equal(contradictionRun.caseResults[0]?.rerunComparisonId != null, true);
    assert.deepEqual(contradictionRun.caseResults[0]?.failureReasons, []);
    assert.deepEqual(contradictionRun.caseResults[0]?.actualValue.rerun, {
      mutationRunsAgainst: "replaceIndexSnapshot_store",
      comparisonId: contradictionRun.caseResults[0]?.rerunComparisonId,
      meaningfulChangeDetected: true,
      priorTraceId: contradictionRun.caseResults[0]?.traceId,
      currentTraceId: (contradictionRun.caseResults[0]?.actualValue.rerun as { currentTraceId?: string })?.currentTraceId,
      olderTrustState: "contradicted",
      newerTrustState: "changed",
    });

    const store = openProjectStore({ projectRoot });
    try {
      assert.ok(store.getBenchmarkSuite(vagueSuite.suiteId), "expected vague suite definition to persist");
      assert.equal(store.listBenchmarkRuns({ suiteId: vagueSuite.suiteId }).length, 4);
      assert.equal(
        store.listBenchmarkCases(vagueSuite.suiteId).some((item) => item.caseId === "retired_auth_file"),
        true,
        "expected retired cases to remain registered",
      );

      const vagueRuns = store.listBenchmarkRuns({ suiteId: vagueSuite.suiteId, limit: 4 });
      const latestRunCaseResults = store.listBenchmarkCaseResults({ runId: vagueRuns[0]!.runId });
      assert.equal(latestRunCaseResults.length, 1, "expected only active cases to write benchmark_case_results rows");

      const trustRuns = store.listComparableAnswerRuns({
        projectId,
        queryKind: "file_health",
        queryText: "src/auth.ts",
      });
      assert.ok(
        trustRuns.some((run) => run.provenance === "seeded_eval"),
        "expected eval runs to reuse normal trust history with seeded_eval provenance",
      );
      const latestTrustEval = store.getLatestAnswerTrustEvaluationForTrace(
        vagueRun.caseResults[0]!.traceId!,
      );
      assert.equal(
        latestTrustEval?.state,
        "superseded",
        "older eval traces should be superseded once newer runs exist for the same target",
      );
      const latestComparableRun = trustRuns[0];
      assert.ok(latestComparableRun?.traceId, "expected latest comparable trust run to expose a trace id");
      const latestTraceTrustEval = store.getLatestAnswerTrustEvaluationForTrace(
        latestComparableRun!.traceId,
      );
      assert.equal(
        latestTraceTrustEval?.state,
        "insufficient_evidence",
        "the latest run for the target should reflect the current insufficiency classifier",
      );
      assert.ok(
        latestTraceTrustEval?.reasons.some(
          (reason) => reason.code === "partial_evidence" || reason.code === "best_effort_support",
        ),
        "expected latest insufficiency state to keep an insufficiency reason",
      );

      const contradictionCase = contradictionRun.caseResults[0]!;
      const contradictionRerun = contradictionCase.actualValue.rerun as
        | { currentTraceId?: string; olderTrustState?: string; newerTrustState?: string }
        | undefined;
      assert.equal(contradictionRerun?.olderTrustState, "contradicted");
      assert.equal(contradictionRerun?.newerTrustState, "changed");
      assert.ok(contradictionRerun?.currentTraceId, "expected rerun fixture to persist the newer trace id");
      const olderContradictionEval = store.getLatestAnswerTrustEvaluationForTrace(contradictionCase.traceId!);
      assert.equal(olderContradictionEval?.state, "contradicted");
      const newerContradictionEval = store.getLatestAnswerTrustEvaluationForTrace(
        contradictionRerun!.currentTraceId!,
      );
      assert.equal(newerContradictionEval?.state, "changed");
    } finally {
      store.close();
    }

    console.log("eval-harness: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
