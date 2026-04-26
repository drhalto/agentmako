import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnswerResult } from "../../packages/contracts/src/answer.ts";
import {
  HealthTrendToolOutputSchema,
  IssuesNextToolOutputSchema,
  SessionHandoffToolOutputSchema,
} from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function createAnswerResult(args: {
  projectId: string;
  queryId: string;
  queryKind: AnswerResult["queryKind"];
  queryText: string;
  answer?: string;
}): AnswerResult {
  return {
    queryId: args.queryId,
    projectId: args.projectId,
    queryKind: args.queryKind,
    tierUsed: "standard",
    supportLevel: "native",
    evidenceStatus: "complete",
    answer: args.answer,
    answerConfidence: 0.9,
    packet: {
      queryId: args.queryId,
      projectId: args.projectId,
      queryKind: args.queryKind,
      queryText: args.queryText,
      tierUsed: "standard",
      supportLevel: "native",
      evidenceStatus: "complete",
      evidenceConfidence: 0.9,
      missingInformation: [],
      stalenessFlags: [],
      evidence: [],
      generatedAt: "2026-04-20T00:00:00.000Z",
    },
    candidateActions: [],
  };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-session-handoff-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "src", "orders"), { recursive: true });
  mkdirSync(path.join(projectRoot, "src", "dashboard"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "session-handoff-smoke", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "src", "orders", "service.ts"), "export function loadOrders() { return []; }\n");
  writeFileSync(path.join(projectRoot, "src", "dashboard", "page.tsx"), "export default function Page() { return null; }\n");

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "session-handoff-smoke",
        canonicalPath: projectRoot,
        lastSeenPath: projectRoot,
        supportTarget: "native",
      });
    } finally {
      globalStore.close();
    }

    const store = openProjectStore({ projectRoot });
    let latestIndexRunId: string | null = null;
    try {
      store.replaceIndexSnapshot({
        files: [
          {
            path: "src/orders/service.ts",
            sha256: "orders",
            language: "typescript",
            sizeBytes: 42,
            lineCount: 1,
            chunks: [
              {
                chunkKind: "file",
                content: "export function loadOrders() { return []; }",
              },
            ],
            symbols: [
              {
                name: "loadOrders",
                kind: "function",
                exportName: "loadOrders",
                lineStart: 1,
                lineEnd: 1,
              },
            ],
            imports: [],
            routes: [],
          },
          {
            path: "src/dashboard/page.tsx",
            sha256: "dashboard",
            language: "typescript",
            sizeBytes: 46,
            lineCount: 1,
            chunks: [
              {
                chunkKind: "file",
                content: "export default function Page() { return null; }",
              },
            ],
            symbols: [
              {
                name: "Page",
                kind: "function",
                exportName: "default",
                lineStart: 1,
                lineEnd: 1,
              },
            ],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
      latestIndexRunId = store.getLatestIndexRun()?.runId ?? null;

      const snapshotTime = "2026-04-20T00:30:00.000Z";
      store.saveSchemaSnapshot({
        snapshotId: "session_handoff_snapshot",
        sourceMode: "repo_only",
        generatedAt: snapshotTime,
        refreshedAt: snapshotTime,
        fingerprint: "session-handoff-smoke",
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: [],
        warnings: [],
        ir: { version: "1.0.0", schemas: {} },
      });

      const prior = store.saveAnswerTrace(
        createAnswerResult({
          projectId,
          queryId: "trace_prior",
          queryKind: "trace_file",
          queryText: "src/orders/service.ts",
          answer: "Prior context",
        }),
      );
      const current = store.saveAnswerTrace(
        createAnswerResult({
          projectId,
          queryId: "trace_current",
          queryKind: "trace_file",
          queryText: "src/orders/service.ts",
          answer: "Current context",
        }),
      );
      const stable = store.saveAnswerTrace(
        createAnswerResult({
          projectId,
          queryId: "file_health_stable",
          queryKind: "file_health",
          queryText: "src/dashboard/page.tsx",
          answer: "Stable dashboard page",
        }),
      );
      const missingEval = store.saveAnswerTrace(
        createAnswerResult({
          projectId,
          queryId: "trace_missing_eval",
          queryKind: "trace_file",
          queryText: "src/orders/service.ts",
          answer: "Older trace without direct evaluation",
        }),
      );

      store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
        "2026-04-20T00:00:00.000Z",
        prior.traceId,
      );
      store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
        "2026-04-20T00:10:00.000Z",
        current.traceId,
      );
      store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
        "2026-04-20T00:20:00.000Z",
        stable.traceId,
      );
      store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
        "2026-04-20T00:05:00.000Z",
        missingEval.traceId,
      );

      const priorRun = store.getAnswerTrustRun(prior.traceId);
      const currentRun = store.getAnswerTrustRun(current.traceId);
      const stableRun = store.getAnswerTrustRun(stable.traceId);
      assert.ok(priorRun);
      assert.ok(currentRun);
      assert.ok(stableRun);

      store.insertAnswerTrustEvaluation({
        targetId: priorRun!.targetId,
        traceId: prior.traceId,
        state: "stable",
        reasons: [{ code: "no_meaningful_change", detail: "baseline trace" }],
        basisTraceIds: [prior.traceId],
        conflictingFacets: [],
        scopeRelation: "same_scope",
        createdAt: "2026-04-20T00:01:00.000Z",
      });

      const comparison = store.insertAnswerComparison({
        targetId: currentRun!.targetId,
        priorTraceId: prior.traceId,
        currentTraceId: current.traceId,
        summaryChanges: [{ code: "answer_markdown_changed", detail: "rerun changed materially" }],
        rawDelta: { changed: true },
        meaningfulChangeDetected: true,
        provenance: "interactive",
        createdAt: "2026-04-20T00:11:00.000Z",
      });

      store.insertAnswerTrustEvaluation({
        targetId: currentRun!.targetId,
        traceId: current.traceId,
        comparisonId: comparison.comparisonId,
        state: "changed",
        reasons: [{ code: "meaningful_change_detected", detail: "rerun changed materially" }],
        basisTraceIds: [prior.traceId, current.traceId],
        conflictingFacets: ["answer_markdown"],
        scopeRelation: "same_scope",
        createdAt: "2026-04-20T00:12:00.000Z",
      });

      store.insertWorkflowFollowup({
        projectId,
        originQueryId: current.traceId,
        originActionId: "workflow_handoff:verification_plan:trace_current",
        originPacketId: "workflow_packet_current",
        originPacketFamily: "verification_plan",
        originQueryKind: "trace_file",
        executedToolName: "workflow_packet",
        executedInput: {
          projectId,
          family: "verification_plan",
          queryKind: "trace_file",
          queryText: "src/orders/service.ts",
        },
        resultPacketId: "workflow_packet_result",
        resultPacketFamily: "verification_plan",
        resultQueryId: "workflow_packet_query",
        createdAt: "2026-04-20T00:15:00.000Z",
      });

      store.insertAnswerTrustEvaluation({
        targetId: stableRun!.targetId,
        traceId: stable.traceId,
        state: "stable",
        reasons: [{ code: "no_meaningful_change", detail: "dashboard page is stable" }],
        basisTraceIds: [stable.traceId],
        conflictingFacets: [],
        scopeRelation: "same_scope",
        createdAt: "2026-04-20T00:21:00.000Z",
      });
    } finally {
      store.close();
    }

    const output = SessionHandoffToolOutputSchema.parse(
      await invokeTool("session_handoff", { projectId }),
    );
    const healthTrendOutput = HealthTrendToolOutputSchema.parse(
      await invokeTool("health_trend", { projectId }),
    );
    const issuesNextOutput = IssuesNextToolOutputSchema.parse(
      await invokeTool("issues_next", { projectId }),
    );

    assert.equal(output.toolName, "session_handoff");
    assert.deepEqual(output.result.basis, {
      latestIndexRunId,
      schemaSnapshotId: "session_handoff_snapshot",
      schemaFingerprint: "session-handoff-smoke",
      sourceTraceLimit: 8,
    });
    assert.deepEqual(output.result.summary, {
      recentQueryCount: 4,
      unresolvedQueryCount: 1,
      changedQueryCount: 1,
      queriesWithFollowups: 1,
    });
    assert.ok(output.result.currentFocus, "expected one derived current focus");
    assert.equal(output.result.currentFocus?.traceId, "trace_current");
    assert.equal(output.result.currentFocus?.reasonCode, "trust_changed");
    assert.equal(output.result.currentFocus?.followupCount, 1);
    assert.equal(output.result.currentFocus?.meaningfulChangeDetected, true);
    assert.ok(
      output.result.currentFocus?.stopWhen.includes(
        "the latest trust state for this target becomes stable or is superseded by a newer run",
      ),
    );
    assert.ok(
      output.result.currentFocus?.stopWhen.includes(
        "the latest comparison for this target no longer reports meaningful change",
      ),
    );

    const focusQuery = output.result.recentQueries.find((entry) => entry.traceId === "trace_current");
    const stableQuery = output.result.recentQueries.find((entry) => entry.traceId === "file_health_stable");
    const missingEvalQuery = output.result.recentQueries.find((entry) => entry.traceId === "trace_missing_eval");
    assert.ok(focusQuery);
    assert.ok(stableQuery);
    assert.ok(missingEvalQuery);
    assert.equal(focusQuery?.isCurrentFocus, true);
    assert.deepEqual(focusQuery?.signalCodes, [
      "trust_changed",
      "comparison_changed",
      "followup_in_progress",
    ]);
    assert.equal(stableQuery?.isCurrentFocus, false);
    assert.deepEqual(stableQuery?.signalCodes, []);
    assert.equal(missingEvalQuery?.isCurrentFocus, false);
    assert.deepEqual(missingEvalQuery?.signalCodes, []);
    assert.equal(output.result.warnings.length, 0);
    assert.equal(healthTrendOutput.toolName, "health_trend");
    assert.deepEqual(healthTrendOutput.result.basis, {
      latestIndexRunId,
      schemaSnapshotId: "session_handoff_snapshot",
      schemaFingerprint: "session-handoff-smoke",
      sourceTraceLimit: 8,
    });
    assert.deepEqual(healthTrendOutput.result.summary, {
      traceCount: 4,
      unresolvedQueryCount: 1,
      stableQueryCount: 2,
      changedQueryCount: 1,
      contradictedQueryCount: 0,
      insufficientEvidenceQueryCount: 0,
      queriesWithFollowups: 1,
      enoughHistory: true,
      recentWindowTraceCount: 2,
      priorWindowTraceCount: 2,
    });
    assert.deepEqual(healthTrendOutput.result.recentWindow, {
      traceCount: 2,
      unresolvedQueryCount: 1,
      stableQueryCount: 1,
      changedQueryCount: 1,
      contradictedQueryCount: 0,
      insufficientEvidenceQueryCount: 0,
      queriesWithFollowups: 1,
    });
    assert.deepEqual(healthTrendOutput.result.priorWindow, {
      traceCount: 2,
      unresolvedQueryCount: 0,
      stableQueryCount: 1,
      changedQueryCount: 0,
      contradictedQueryCount: 0,
      insufficientEvidenceQueryCount: 0,
      queriesWithFollowups: 0,
    });
    assert.deepEqual(
      healthTrendOutput.result.metrics.map((metric) => [metric.metric, metric.direction]),
      [
        ["unresolved_queries", "up"],
        ["stable_queries", "flat"],
        ["changed_queries", "up"],
        ["contradicted_queries", "flat"],
        ["insufficient_evidence_queries", "flat"],
        ["queries_with_followups", "up"],
      ],
    );
    assert.equal(healthTrendOutput.result.warnings.length, 0);

    assert.equal(issuesNextOutput.toolName, "issues_next");
    assert.deepEqual(issuesNextOutput.result.basis, {
      latestIndexRunId,
      schemaSnapshotId: "session_handoff_snapshot",
      schemaFingerprint: "session-handoff-smoke",
      sourceTraceLimit: 8,
    });
    assert.deepEqual(issuesNextOutput.result.summary, {
      recentQueryCount: 4,
      candidateCount: 1,
      activeCount: 1,
      queuedCount: 0,
      truncatedQueuedCount: 0,
      suppressedStableCount: 3,
      queriesWithFollowups: 1,
    });
    assert.equal(issuesNextOutput.result.currentIssue?.traceId, "trace_current");
    assert.equal(issuesNextOutput.result.currentIssue?.reasonCode, "trust_changed");
    assert.equal(issuesNextOutput.result.queuedIssues.length, 0);
    assert.equal(issuesNextOutput.result.warnings.length, 0);

    const limitedOutput = SessionHandoffToolOutputSchema.parse(
      await invokeTool("session_handoff", { projectId, limit: 2 }),
    );
    const limitedHealthTrendOutput = HealthTrendToolOutputSchema.parse(
      await invokeTool("health_trend", { projectId, limit: 2 }),
    );
    const limitedIssuesNextOutput = IssuesNextToolOutputSchema.parse(
      await invokeTool("issues_next", { projectId, limit: 2 }),
    );
    assert.equal(limitedOutput.result.basis.sourceTraceLimit, 2);
    assert.equal(limitedOutput.result.summary.recentQueryCount, 2);
    assert.deepEqual(
      limitedOutput.result.recentQueries.map((entry) => entry.traceId),
      ["file_health_stable", "trace_current"],
    );
    assert.equal(limitedHealthTrendOutput.result.basis.sourceTraceLimit, 2);
    assert.equal(limitedHealthTrendOutput.result.summary.traceCount, 2);
    assert.equal(limitedHealthTrendOutput.result.summary.enoughHistory, false);
    assert.ok(
      limitedHealthTrendOutput.result.warnings.includes(
        "health trend has insufficient history; at least four recent traces are needed to compare a recent window against a prior window.",
      ),
    );
    assert.ok(
      limitedHealthTrendOutput.result.metrics.every(
        (metric) => metric.direction === "insufficient_history",
      ),
    );
    assert.equal(limitedIssuesNextOutput.result.basis.sourceTraceLimit, 2);
    assert.equal(limitedIssuesNextOutput.result.summary.recentQueryCount, 2);
    assert.equal(limitedIssuesNextOutput.result.summary.truncatedQueuedCount, 0);
    assert.deepEqual(
      limitedIssuesNextOutput.result.currentIssue?.traceId,
      "trace_current",
    );

    const stableOnlyProjectId = randomUUID();
    const stableProjectRoot = path.join(tmp, "stable-project");
    mkdirSync(path.join(stableProjectRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(stableProjectRoot, "package.json"),
      JSON.stringify({ name: "session-handoff-stable-smoke", version: "0.0.0" }),
    );
    writeFileSync(path.join(stableProjectRoot, "src", "index.ts"), "export const ok = true;\n");

    const secondGlobalStore = openGlobalStore();
    try {
      secondGlobalStore.saveProject({
        projectId: stableOnlyProjectId,
        displayName: "session-handoff-stable-smoke",
        canonicalPath: stableProjectRoot,
        lastSeenPath: stableProjectRoot,
        supportTarget: "native",
      });
    } finally {
      secondGlobalStore.close();
    }

    const stableOnlyStore = openProjectStore({ projectRoot: stableProjectRoot });
    try {
      stableOnlyStore.replaceIndexSnapshot({
        files: [
          {
            path: "src/index.ts",
            sha256: "stable-only",
            language: "typescript",
            sizeBytes: 24,
            lineCount: 1,
            chunks: [
              {
                chunkKind: "file",
                content: "export const ok = true;",
              },
            ],
            symbols: [
              {
                name: "ok",
                kind: "constant",
                exportName: "ok",
                lineStart: 1,
                lineEnd: 1,
              },
            ],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
      stableOnlyStore.saveSchemaSnapshot({
        snapshotId: "stable_only_snapshot",
        sourceMode: "repo_only",
        generatedAt: "2026-04-20T01:00:00.000Z",
        refreshedAt: "2026-04-20T01:00:00.000Z",
        fingerprint: "stable-only-fingerprint",
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: [],
        warnings: [],
        ir: { version: "1.0.0", schemas: {} },
      });

      const stableOnlyTrace = stableOnlyStore.saveAnswerTrace(
        createAnswerResult({
          projectId: stableOnlyProjectId,
          queryId: "stable_only_trace",
          queryKind: "file_health",
          queryText: "src/index.ts",
          answer: "Everything is stable",
        }),
      );
      stableOnlyStore.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
        "2026-04-20T01:05:00.000Z",
        stableOnlyTrace.traceId,
      );

      const stableOnlyRun = stableOnlyStore.getAnswerTrustRun(stableOnlyTrace.traceId);
      assert.ok(stableOnlyRun);
      stableOnlyStore.insertAnswerTrustEvaluation({
        targetId: stableOnlyRun!.targetId,
        traceId: stableOnlyTrace.traceId,
        state: "stable",
        reasons: [{ code: "no_meaningful_change", detail: "steady state" }],
        basisTraceIds: [stableOnlyTrace.traceId],
        conflictingFacets: [],
        scopeRelation: "same_scope",
        createdAt: "2026-04-20T01:06:00.000Z",
      });
    } finally {
      stableOnlyStore.close();
    }

    const stableOnlyOutput = SessionHandoffToolOutputSchema.parse(
      await invokeTool("session_handoff", { projectId: stableOnlyProjectId }),
    );
    const stableOnlyHealthTrend = HealthTrendToolOutputSchema.parse(
      await invokeTool("health_trend", { projectId: stableOnlyProjectId }),
    );
    const stableOnlyIssuesNext = IssuesNextToolOutputSchema.parse(
      await invokeTool("issues_next", { projectId: stableOnlyProjectId }),
    );
    assert.equal(stableOnlyOutput.result.currentFocus, null);
    assert.ok(
      stableOnlyOutput.result.warnings.includes(
        "session handoff found no unresolved current focus; recent traces are stable, superseded, or have no active change signal.",
      ),
    );
    assert.equal(stableOnlyHealthTrend.result.summary.enoughHistory, false);
    assert.equal(stableOnlyHealthTrend.result.summary.traceCount, 1);
    assert.ok(
      stableOnlyHealthTrend.result.warnings.includes(
        "health trend has insufficient history; at least four recent traces are needed to compare a recent window against a prior window.",
      ),
    );
    assert.ok(
      stableOnlyHealthTrend.result.metrics.every(
        (metric) => metric.direction === "insufficient_history",
      ),
    );
    assert.equal(stableOnlyIssuesNext.result.currentIssue, null);
    assert.equal(stableOnlyIssuesNext.result.queuedIssues.length, 0);
    assert.ok(
      stableOnlyIssuesNext.result.warnings.includes(
        "issues next found no unresolved recommendations; recent traces are stable, superseded, or have no active change signal.",
      ),
    );

    const queueHeavyProjectId = randomUUID();
    const queueHeavyProjectRoot = path.join(tmp, "queue-heavy-project");
    mkdirSync(path.join(queueHeavyProjectRoot, "src"), { recursive: true });
    writeFileSync(
      path.join(queueHeavyProjectRoot, "package.json"),
      JSON.stringify({ name: "session-handoff-queue-heavy", version: "0.0.0" }),
    );
    writeFileSync(path.join(queueHeavyProjectRoot, "src", "index.ts"), "export const queueHeavy = true;\n");

    const thirdGlobalStore = openGlobalStore();
    try {
      thirdGlobalStore.saveProject({
        projectId: queueHeavyProjectId,
        displayName: "session-handoff-queue-heavy",
        canonicalPath: queueHeavyProjectRoot,
        lastSeenPath: queueHeavyProjectRoot,
        supportTarget: "native",
      });
    } finally {
      thirdGlobalStore.close();
    }

    const queueHeavyStore = openProjectStore({ projectRoot: queueHeavyProjectRoot });
    try {
      queueHeavyStore.replaceIndexSnapshot({
        files: [
          {
            path: "src/index.ts",
            sha256: "queue-heavy",
            language: "typescript",
            sizeBytes: 32,
            lineCount: 1,
            chunks: [
              {
                chunkKind: "file",
                content: "export const queueHeavy = true;",
              },
            ],
            symbols: [
              {
                name: "queueHeavy",
                kind: "constant",
                exportName: "queueHeavy",
                lineStart: 1,
                lineEnd: 1,
              },
            ],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
      queueHeavyStore.saveSchemaSnapshot({
        snapshotId: "queue_heavy_snapshot",
        sourceMode: "repo_only",
        generatedAt: "2026-04-20T02:00:00.000Z",
        refreshedAt: "2026-04-20T02:00:00.000Z",
        fingerprint: "queue-heavy-fingerprint",
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: [],
        warnings: [],
        ir: { version: "1.0.0", schemas: {} },
      });

      for (let index = 0; index < 12; index += 1) {
        const trace = queueHeavyStore.saveAnswerTrace(
          createAnswerResult({
            projectId: queueHeavyProjectId,
            queryId: `queue_heavy_${index}`,
            queryKind: "trace_file",
            queryText: `src/index.ts#${index}`,
            answer: `Queue-heavy trace ${index}`,
          }),
        );
        queueHeavyStore.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
          `2026-04-20T02:${String(index).padStart(2, "0")}:00.000Z`,
          trace.traceId,
        );

        const trustRun = queueHeavyStore.getAnswerTrustRun(trace.traceId);
        assert.ok(trustRun);
        queueHeavyStore.insertAnswerTrustEvaluation({
          targetId: trustRun!.targetId,
          traceId: trace.traceId,
          state: "changed",
          reasons: [{ code: "meaningful_change_detected", detail: `queue-heavy change ${index}` }],
          basisTraceIds: [trace.traceId],
          conflictingFacets: ["answer_markdown"],
          scopeRelation: "same_scope",
          createdAt: `2026-04-20T02:${String(index).padStart(2, "0")}:30.000Z`,
        });
      }
    } finally {
      queueHeavyStore.close();
    }

    const queueHeavyIssuesNext = IssuesNextToolOutputSchema.parse(
      await invokeTool("issues_next", { projectId: queueHeavyProjectId, limit: 32 }),
    );
    assert.equal(queueHeavyIssuesNext.result.summary.recentQueryCount, 12);
    assert.equal(queueHeavyIssuesNext.result.summary.candidateCount, 12);
    assert.equal(queueHeavyIssuesNext.result.summary.activeCount, 1);
    assert.equal(queueHeavyIssuesNext.result.summary.queuedCount, 10);
    assert.equal(queueHeavyIssuesNext.result.summary.truncatedQueuedCount, 1);
    assert.equal(queueHeavyIssuesNext.result.queuedIssues.length, 10);
    assert.ok(
      queueHeavyIssuesNext.result.warnings.includes(
        "issues next truncated queued recommendations to 10 items; narrow the recent-trace window for a smaller queue.",
      ),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

void main();
