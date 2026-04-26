import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnswerResult, EvidenceBlock, EvidenceStatus, SupportLevel } from "../../packages/contracts/src/index.ts";
import { createId, openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "trust-state-smoke", version: "0.0.0" }),
  );

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "trust-state-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }
}

function buildEvidence(filePath: string, title = "Evidence"): EvidenceBlock[] {
  return [
    {
      blockId: createId("evidence"),
      kind: "file",
      title,
      sourceRef: filePath,
      filePath,
      line: 1,
      content: `evidence from ${filePath}`,
      metadata: {},
    },
  ];
}

function buildAnswerResult(args: {
  projectId: string;
  queryKind: AnswerResult["queryKind"];
  queryText: string;
  supportLevel: SupportLevel;
  evidenceStatus: EvidenceStatus;
  evidence: EvidenceBlock[];
  missingInformation?: string[];
  stalenessFlags?: string[];
  answer?: string;
}): AnswerResult {
  const queryId = createId("query");
  return {
    queryId,
    projectId: args.projectId,
    queryKind: args.queryKind,
    tierUsed: "standard",
    supportLevel: args.supportLevel,
    evidenceStatus: args.evidenceStatus,
    answer: args.answer,
    answerConfidence: args.supportLevel === "native" ? 0.95 : args.supportLevel === "adapted" ? 0.8 : 0.5,
    candidateActions: [],
    packet: {
      queryId,
      projectId: args.projectId,
      queryKind: args.queryKind,
      queryText: args.queryText,
      tierUsed: "standard",
      supportLevel: args.supportLevel,
      evidenceStatus: args.evidenceStatus,
      evidenceConfidence: args.supportLevel === "native" ? 0.95 : args.supportLevel === "adapted" ? 0.8 : 0.5,
      missingInformation: args.missingInformation ?? [],
      stalenessFlags: args.stalenessFlags ?? [],
      evidence: args.evidence,
      generatedAt: new Date().toISOString(),
    },
  };
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-trust-state-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  const store = openProjectStore({ projectRoot });
  const toolService = createToolService();
  try {
    const stableRun1 = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/stable.ts)",
        supportLevel: "native",
        evidenceStatus: "complete",
        evidence: buildEvidence("src/stable.ts", "Stable file"),
        answer: "stable v1",
      }),
    );
    const stableRun2 = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/stable.ts)",
        supportLevel: "native",
        evidenceStatus: "complete",
        evidence: buildEvidence("src/stable.ts", "Stable file"),
        answer: "stable v1",
      }),
    );
    const stableRun1Trust = store.getAnswerTrustRun(stableRun1.traceId);
    const stableRun2Trust = store.getAnswerTrustRun(stableRun2.traceId);
    assert.ok(stableRun1Trust && stableRun2Trust);
    store.insertAnswerComparison({
      targetId: stableRun2Trust.targetId,
      priorTraceId: stableRun1.traceId,
      currentTraceId: stableRun2.traceId,
      summaryChanges: [],
      rawDelta: {},
      meaningfulChangeDetected: false,
      provenance: "manual_rerun",
    });

    const changedRun1 = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/changed.ts)",
        supportLevel: "native",
        evidenceStatus: "complete",
        evidence: buildEvidence("src/changed.ts", "Changed file before"),
        answer: "before",
      }),
    );
    const changedRun2 = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/changed.ts)",
        supportLevel: "native",
        evidenceStatus: "complete",
        evidence: buildEvidence("src/changed-next.ts", "Changed file after"),
        answer: "after",
      }),
    );
    const changedRun1Trust = store.getAnswerTrustRun(changedRun1.traceId);
    const changedRun2Trust = store.getAnswerTrustRun(changedRun2.traceId);
    assert.ok(changedRun1Trust && changedRun2Trust);
    store.insertAnswerComparison({
      targetId: changedRun2Trust.targetId,
      priorTraceId: changedRun1.traceId,
      currentTraceId: changedRun2.traceId,
      summaryChanges: [
        { code: "evidence_removed", detail: "old evidence disappeared" },
        { code: "evidence_added", detail: "new evidence appeared" },
      ],
      rawDelta: {
        packet: {
          evidence: {
            added: ["src/changed-next.ts"],
            removed: ["src/changed.ts"],
          },
        },
      },
      meaningfulChangeDetected: true,
      provenance: "manual_rerun",
    });

    const contradictionRun1 = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/contradiction.ts)",
        supportLevel: "native",
        evidenceStatus: "complete",
        evidence: buildEvidence("src/contradiction-before.ts", "Contradiction before"),
        answer: "before contradiction",
      }),
    );
    const contradictionRun2 = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/contradiction.ts)",
        supportLevel: "native",
        evidenceStatus: "complete",
        evidence: buildEvidence("src/contradiction-after.ts", "Contradiction after"),
        answer: "after contradiction",
      }),
    );
    const contradictionRun1Trust = store.getAnswerTrustRun(contradictionRun1.traceId);
    const contradictionRun2Trust = store.getAnswerTrustRun(contradictionRun2.traceId);
    assert.ok(contradictionRun1Trust && contradictionRun2Trust);
    store.insertAnswerComparison({
      targetId: contradictionRun2Trust.targetId,
      priorTraceId: contradictionRun1.traceId,
      currentTraceId: contradictionRun2.traceId,
      summaryChanges: [
        { code: "core_claim_conflict", detail: "same-scope core claim changed from before to after" },
        { code: "evidence_removed", detail: "old contradiction evidence disappeared" },
        { code: "evidence_added", detail: "new contradiction evidence appeared" },
      ],
      rawDelta: {
        packet: {
          coreClaim: {
            before: "before contradiction",
            after: "after contradiction",
          },
        },
      },
      meaningfulChangeDetected: true,
      provenance: "manual_rerun",
    });

    const agingRun = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/aging.ts)",
        supportLevel: "native",
        evidenceStatus: "complete",
        evidence: buildEvidence("src/aging.ts", "Aging file"),
        answer: "aging",
      }),
    );
    const agingRunTrust = store.getAnswerTrustRun(agingRun.traceId);
    assert.ok(agingRunTrust);

    const insufficientRun = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/insufficient.ts)",
        supportLevel: "best_effort",
        evidenceStatus: "partial",
        evidence: [],
        missingInformation: ["missing schema context"],
        answer: "insufficient",
      }),
    );
    const insufficientRunTrust = store.getAnswerTrustRun(insufficientRun.traceId);
    assert.ok(insufficientRunTrust);

    const partialCoverageRun = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/partial.ts)",
        supportLevel: "native",
        evidenceStatus: "partial",
        evidence: buildEvidence("src/partial.ts", "Partial file"),
        answer: "partial",
      }),
    );
    const partialCoverageRunTrust = store.getAnswerTrustRun(partialCoverageRun.traceId);
    assert.ok(partialCoverageRunTrust);

    const mismatchedFreeFormRun = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "free_form",
        queryText: "where is teacher impersonation handled?",
        supportLevel: "native",
        evidenceStatus: "complete",
        evidence: buildEvidence("src/admin-publish-event.ts", "Admin publish event"),
        answer: "admin_publish_event is defined in src/admin-publish-event.ts",
      }),
    );
    const mismatchedFreeFormRunTrust = store.getAnswerTrustRun(mismatchedFreeFormRun.traceId);
    assert.ok(mismatchedFreeFormRunTrust);

    const unreadRun = store.saveAnswerTrace(
      buildAnswerResult({
        projectId,
        queryKind: "trace_file",
        queryText: "trace_file(src/unread.ts)",
        supportLevel: "native",
        evidenceStatus: "complete",
        evidence: buildEvidence("src/unread.ts", "Unread file"),
        answer: "unread",
      }),
    );
    const unreadRunTrust = store.getAnswerTrustRun(unreadRun.traceId);
    assert.ok(unreadRunTrust);

    const stableLatest = await toolService.evaluateTrustState({
      projectId,
      targetId: stableRun2Trust.targetId,
    });
    assert.equal(stableLatest.evaluation.state, "stable");
    assert.equal(stableLatest.relatedEvaluations.length, 1);
    assert.equal(stableLatest.relatedEvaluations[0]?.state, "superseded");

    const stableOlder = await toolService.evaluateTrustState({
      projectId,
      traceId: stableRun1.traceId,
    });
    assert.equal(stableOlder.evaluation.state, "superseded");

    const changedLatest = await toolService.evaluateTrustState({
      projectId,
      targetId: changedRun2Trust.targetId,
    });
    assert.equal(changedLatest.evaluation.state, "changed");
    assert.equal(changedLatest.clusters.length, 2);
    assert.equal(changedLatest.subjectCluster.runCount, 1);

    const supersededOlder = await toolService.evaluateTrustState({
      projectId,
      traceId: changedRun1.traceId,
    });
    assert.equal(supersededOlder.evaluation.state, "superseded");
    assert.equal(supersededOlder.evaluation.scopeRelation, "same_scope");
    assert.deepEqual(supersededOlder.evaluation.conflictingFacets, ["evidence_set"]);
    assert.deepEqual(supersededOlder.evaluation.basisTraceIds, [changedRun2.traceId]);

    const contradictedOlder = await toolService.evaluateTrustState({
      projectId,
      traceId: contradictionRun1.traceId,
    });
    assert.equal(contradictedOlder.evaluation.state, "contradicted");
    assert.equal(contradictedOlder.evaluation.scopeRelation, "same_scope");
    assert.ok(contradictedOlder.evaluation.conflictingFacets.includes("core_claim"));
    assert.deepEqual(contradictedOlder.evaluation.basisTraceIds, [contradictionRun2.traceId]);

    const agingEvaluation = await toolService.evaluateTrustState({
      projectId,
      targetId: agingRunTrust.targetId,
      evaluatedAt: addDays(agingRun.createdAt, 45),
    });
    assert.equal(agingEvaluation.evaluation.state, "aging");
    assert.equal(agingEvaluation.evaluation.ageDays, 45);

    const staleEvaluation = await toolService.evaluateTrustState({
      projectId,
      targetId: agingRunTrust.targetId,
      evaluatedAt: addDays(agingRun.createdAt, 120),
    });
    assert.equal(staleEvaluation.evaluation.state, "stale");
    assert.equal(staleEvaluation.evaluation.ageDays, 120);

    const insufficientEvaluation = await toolService.evaluateTrustState({
      projectId,
      targetId: insufficientRunTrust.targetId,
    });
    assert.equal(insufficientEvaluation.evaluation.state, "insufficient_evidence");

    const partialCoverageEvaluation = await toolService.evaluateTrustState({
      projectId,
      targetId: partialCoverageRunTrust.targetId,
    });
    assert.equal(partialCoverageEvaluation.evaluation.state, "insufficient_evidence");
    assert.ok(
      partialCoverageEvaluation.evaluation.reasons.some((reason) => reason.code === "partial_evidence"),
      "expected partial evidence runs to classify as insufficient even when some evidence exists",
    );

    const mismatchedFreeFormEvaluation = await toolService.evaluateTrustState({
      projectId,
      targetId: mismatchedFreeFormRunTrust.targetId,
    });
    assert.equal(mismatchedFreeFormEvaluation.evaluation.state, "insufficient_evidence");
    assert.ok(
      mismatchedFreeFormEvaluation.evaluation.reasons.some(
        (reason) => reason.code === "query_evidence_mismatch",
      ),
      "expected off-topic free-form evidence to classify as insufficient",
    );

    const changedSnapshot = await toolService.readTrustState({
      projectId,
      targetId: changedRun2Trust.targetId,
    });
    assert.equal(changedSnapshot.run.traceId, changedRun2.traceId);
    assert.equal(changedSnapshot.evaluation.state, "changed");
    assert.equal(changedSnapshot.evaluation.scopeRelation, "same_scope");
    assert.equal(changedSnapshot.cluster?.clusterId, changedLatest.subjectCluster.clusterId);
    assert.equal(changedSnapshot.comparison?.comparisonId, changedLatest.comparison?.comparisonId);

    const supersededSnapshot = await toolService.readTrustState({
      projectId,
      traceId: changedRun1.traceId,
    });
    assert.equal(supersededSnapshot.evaluation.state, "superseded");
    assert.equal(supersededSnapshot.run.traceId, changedRun1.traceId);

    const contradictedSnapshot = await toolService.readTrustState({
      projectId,
      traceId: contradictionRun1.traceId,
    });
    assert.equal(contradictedSnapshot.evaluation.state, "contradicted");
    assert.equal(contradictedSnapshot.run.traceId, contradictionRun1.traceId);

    const unreadSnapshot = await toolService.readTrustState({
      projectId,
      targetId: unreadRunTrust.targetId,
    });
    assert.equal(unreadSnapshot.evaluation.state, "stable");
    assert.equal(unreadSnapshot.run.traceId, unreadRun.traceId);

    const changedHistorySnapshot = await toolService.listTrustStateHistory({
      projectId,
      targetId: changedRun2Trust.targetId,
    });
    assert.equal(changedHistorySnapshot.latestRun?.traceId, changedRun2.traceId);
    assert.equal(changedHistorySnapshot.latestEvaluation?.traceId, changedRun2.traceId);
    assert.ok(
      changedHistorySnapshot.evaluations.some((item) => item.state === "superseded"),
      "expected history read to include superseded older state",
    );
    assert.equal(changedHistorySnapshot.clusters.length, 2);
    assert.ok(changedHistorySnapshot.comparisons.length >= 1);

    const contradictedHistorySnapshot = await toolService.listTrustStateHistory({
      projectId,
      targetId: contradictionRun2Trust.targetId,
    });
    assert.equal(contradictedHistorySnapshot.latestRun?.traceId, contradictionRun2.traceId);
    assert.ok(
      contradictedHistorySnapshot.evaluations.some((item) => item.state === "contradicted"),
      "expected contradiction history to include the older contradicted run",
    );

    const changedHistoryByOlderTrace = await toolService.listTrustStateHistory({
      projectId,
      traceId: changedRun1.traceId,
    });
    assert.equal(
      changedHistoryByOlderTrace.latestRun?.traceId,
      changedRun2.traceId,
      "history reads anchored by an older trace should still return the target's latest run",
    );

    const unreadHistorySnapshot = await toolService.listTrustStateHistory({
      projectId,
      targetId: unreadRunTrust.targetId,
    });
    assert.equal(unreadHistorySnapshot.latestEvaluation?.state, "stable");
    assert.ok(
      unreadHistorySnapshot.evaluations.length >= 1,
      "expected history read to backfill a persisted evaluation when missing",
    );

    // The "latest evaluation for target" can belong to either comparable trace
    // depending on whether the older-run evaluator deduplicated against the
    // related-eval written during the latest-run pass. Both outcomes are
    // correct — assert shape and scope via trace-scoped lookups below instead
    // of pinning a specific traceId here.
    const latestTargetEval = store.getLatestAnswerTrustEvaluationForTarget(changedRun2Trust.targetId);
    assert.ok(latestTargetEval, "expected a latest evaluation for the target");
    assert.ok(
      latestTargetEval.traceId === changedRun1.traceId ||
        latestTargetEval.traceId === changedRun2.traceId,
      "latest target evaluation should belong to one of the two comparable runs",
    );
    assert.equal(latestTargetEval.scopeRelation, "same_scope");

    const latestTraceEval = store.getLatestAnswerTrustEvaluationForTrace(changedRun1.traceId);
    assert.equal(latestTraceEval?.state, "superseded");
    assert.deepEqual(latestTraceEval?.conflictingFacets, ["evidence_set"]);

    const latestChangedTraceEval = store.getLatestAnswerTrustEvaluationForTrace(changedRun2.traceId);
    assert.equal(latestChangedTraceEval?.state, "changed");

    const contradictedHistory = store.listAnswerTrustEvaluations(contradictionRun2Trust.targetId);
    assert.ok(
      contradictedHistory.some((item) => item.traceId === contradictionRun2.traceId && item.state === "changed"),
      "expected contradiction history to retain the newer changed evaluation",
    );
    const contradictedOlderEval = contradictedHistory.find((item) => item.traceId === contradictionRun1.traceId);
    assert.equal(contradictedOlderEval?.state, "contradicted");
    assert.equal(contradictedOlderEval?.scopeRelation, "same_scope");
    assert.ok(contradictedOlderEval?.conflictingFacets.includes("core_claim"));

    const latestContradictedTraceEval = store.getLatestAnswerTrustEvaluationForTrace(contradictionRun1.traceId);
    assert.equal(latestContradictedTraceEval?.state, "contradicted");

    const changedHistory = store.listAnswerTrustEvaluations(changedRun2Trust.targetId);
    assert.ok(changedHistory.length >= 2, "expected trust evaluations to persist");

    console.log("trust-state: PASS");
  } finally {
    toolService.close();
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
