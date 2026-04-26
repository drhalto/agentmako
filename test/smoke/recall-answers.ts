import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnswerResult, RecallAnswersToolOutput } from "../../packages/contracts/src/index.ts";
import { RecallAnswersToolOutputSchema } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function createAnswerResult(args: {
  projectId: string;
  queryId: string;
  queryKind: AnswerResult["queryKind"];
  queryText: string;
  answer: string;
  supportLevel?: AnswerResult["supportLevel"];
}): AnswerResult {
  const supportLevel = args.supportLevel ?? "native";
  return {
    queryId: args.queryId,
    projectId: args.projectId,
    queryKind: args.queryKind,
    tierUsed: "standard",
    supportLevel,
    evidenceStatus: "complete",
    answer: args.answer,
    answerConfidence: 0.92,
    packet: {
      queryId: args.queryId,
      projectId: args.projectId,
      queryKind: args.queryKind,
      queryText: args.queryText,
      tierUsed: "standard",
      supportLevel,
      evidenceStatus: "complete",
      evidenceConfidence: 0.92,
      missingInformation: [],
      stalenessFlags: [],
      evidence: [
        {
          blockId: `${args.queryId}_ev_1`,
          kind: "file",
          title: "Seeded smoke evidence",
          sourceRef: "src/admin.ts",
          filePath: "src/admin.ts",
          content: "seeded smoke evidence",
        },
      ],
      generatedAt: new Date().toISOString(),
    },
    candidateActions: [],
  };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedProject(projectRoot: string, projectId: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "recall-answers-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "native",
    });
  } finally {
    globalStore.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-recall-answers-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "recall-answers-smoke" }));
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    const store = openProjectStore({ projectRoot });
    try {
      const admin = store.saveAnswerTrace(createAnswerResult({
        projectId,
        queryId: "trace_admin_gatekeeper",
        queryKind: "auth_path",
        queryText: "where is the admin gatekeeper",
        answer: "The admin gatekeeper uses admin_gatekeeper_token in src/admin.ts.",
      }));
      const dashboard = store.saveAnswerTrace(createAnswerResult({
        projectId,
        queryId: "trace_dashboard_health",
        queryKind: "file_health",
        queryText: "src/dashboard/page.tsx",
        answer: "Dashboard health has a raw-update placeholder.",
        supportLevel: "best_effort",
      }));
      const old = store.saveAnswerTrace(createAnswerResult({
        projectId,
        queryId: "trace_old_memory",
        queryKind: "file_health",
        queryText: "old memory outside default window",
        answer: "This old answer should not appear under the default recall window.",
      }));
      const deleteProbe = store.saveAnswerTrace(createAnswerResult({
        projectId,
        queryId: "trace_deleteprobe",
        queryKind: "trace_file",
        queryText: "deleteprobe marker",
        answer: "deleteprobe should leave FTS after raw delete.",
      }));
      const boundedBulk = Array.from({ length: 3 }, (_unused, index) =>
        store.saveAnswerTrace(createAnswerResult({
          projectId,
          queryId: `trace_bulkbounded_${index}`,
          queryKind: "trace_file",
          queryText: `bulkbounded marker ${index}`,
          answer: `bulkbounded answer ${index}`,
        })),
      );

      store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(isoDaysAgo(1), admin.traceId);
      store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(isoDaysAgo(2), dashboard.traceId);
      store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(isoDaysAgo(45), old.traceId);
      store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(isoDaysAgo(3), deleteProbe.traceId);
      boundedBulk.forEach((trace, index) => {
        store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(isoDaysAgo(35 + index), trace.traceId);
      });

      const adminRun = store.getAnswerTrustRun(admin.traceId);
      const dashboardRun = store.getAnswerTrustRun(dashboard.traceId);
      assert.ok(adminRun);
      assert.ok(dashboardRun);
      store.insertAnswerTrustEvaluation({
        targetId: adminRun!.targetId,
        traceId: admin.traceId,
        state: "stable",
        reasons: [{ code: "no_meaningful_change", detail: "seeded stable recall trace" }],
        basisTraceIds: [admin.traceId],
        conflictingFacets: [],
        scopeRelation: "same_scope",
      });
      store.insertAnswerTrustEvaluation({
        targetId: dashboardRun!.targetId,
        traceId: dashboard.traceId,
        state: "changed",
        reasons: [{ code: "meaningful_change_detected", detail: "seeded changed recall trace" }],
        basisTraceIds: [dashboard.traceId],
        conflictingFacets: ["answer_markdown"],
        scopeRelation: "same_scope",
      });

      store.db.prepare(`INSERT INTO answer_traces_fts(answer_traces_fts) VALUES('rebuild')`).run();
      const rebuildCount = store.db
        .prepare(`SELECT COUNT(*) AS count FROM answer_traces_fts WHERE answer_traces_fts MATCH ?`)
        .get('"gatekeeper"') as { count: number };
      assert.ok(rebuildCount.count >= 1, "FTS rebuild should index pre-existing answer traces");

      store.db
        .prepare(`UPDATE answer_traces SET answer_markdown = ? WHERE trace_id = ?`)
        .run("Updated raw SQL answer with queuedfollowup marker.", dashboard.traceId);
      const updateCount = store.db
        .prepare(`SELECT COUNT(*) AS count FROM answer_traces_fts WHERE answer_traces_fts MATCH ?`)
        .get('"queuedfollowup"') as { count: number };
      assert.ok(updateCount.count >= 1, "FTS update trigger should index raw answer_markdown changes");

      store.db.prepare(`DELETE FROM answer_traces WHERE trace_id = ?`).run(deleteProbe.traceId);
      const deleteCount = store.db
        .prepare(`SELECT COUNT(*) AS count FROM answer_traces_fts WHERE answer_traces_fts MATCH ?`)
        .get('"deleteprobe"') as { count: number };
      assert.equal(deleteCount.count, 0, "FTS delete trigger should remove deleted answer traces");
    } finally {
      store.close();
    }

    const byText = RecallAnswersToolOutputSchema.parse(await invokeTool("recall_answers", {
      projectId,
      query: "gatekeeper",
    })) as RecallAnswersToolOutput;
    assert.equal(byText.toolName, "recall_answers");
    assert.equal(byText.projectId, projectId);
    assert.equal(byText.matchCount, 1);
    assert.equal(byText.truncated, false);
    assert.equal(byText.answers[0]?.traceId, "trace_admin_gatekeeper");
    assert.equal(byText.answers[0]?.trustState, "stable");
    assert.ok(byText.answers[0]?.answerMarkdown?.includes("admin_gatekeeper_token"));
    assert.equal(byText.answers[0]?.packetSummary.evidenceRefCount, 1);

    const byRawUpdate = RecallAnswersToolOutputSchema.parse(await invokeTool("recall_answers", {
      projectId,
      query: "queuedfollowup",
    })) as RecallAnswersToolOutput;
    assert.equal(byRawUpdate.matchCount, 1);
    assert.equal(byRawUpdate.answers[0]?.traceId, "trace_dashboard_health");

    const byKind = RecallAnswersToolOutputSchema.parse(await invokeTool("recall_answers", {
      projectId,
      queryKind: "file_health",
    })) as RecallAnswersToolOutput;
    assert.equal(byKind.matchCount, 1, "default 30-day window excludes old file_health trace");
    assert.equal(byKind.answers[0]?.traceId, "trace_dashboard_health");

    const bySupport = RecallAnswersToolOutputSchema.parse(await invokeTool("recall_answers", {
      projectId,
      supportLevel: "best_effort",
    })) as RecallAnswersToolOutput;
    assert.equal(bySupport.matchCount, 1);
    assert.equal(bySupport.answers[0]?.traceId, "trace_dashboard_health");

    const stableOnly = RecallAnswersToolOutputSchema.parse(await invokeTool("recall_answers", {
      projectId,
      trustState: "stable",
    })) as RecallAnswersToolOutput;
    assert.equal(stableOnly.matchCount, 1);
    assert.equal(stableOnly.answers[0]?.traceId, "trace_admin_gatekeeper");

    const narrowWindow = RecallAnswersToolOutputSchema.parse(await invokeTool("recall_answers", {
      projectId,
      since: isoDaysAgo(1.5),
    })) as RecallAnswersToolOutput;
    assert.equal(narrowWindow.matchCount, 1);
    assert.equal(narrowWindow.answers[0]?.traceId, "trace_admin_gatekeeper");

    const truncated = RecallAnswersToolOutputSchema.parse(await invokeTool("recall_answers", {
      projectId,
      limit: 1,
    })) as RecallAnswersToolOutput;
    assert.equal(truncated.matchCount, 2);
    assert.equal(truncated.answers.length, 1);
    assert.equal(truncated.truncated, true);
    assert.ok(truncated.warnings[0]?.includes("truncated"));

    const boundedTextQuery = RecallAnswersToolOutputSchema.parse(await invokeTool("recall_answers", {
      projectId,
      query: "bulkbounded",
      since: isoDaysAgo(60),
      limit: 1,
    })) as RecallAnswersToolOutput;
    assert.equal(boundedTextQuery.matchCount, 3, "text recall count remains pre-limit");
    assert.equal(boundedTextQuery.answers.length, 1, "text recall rows are SQL-limited");
    assert.equal(boundedTextQuery.answers[0]?.traceId, "trace_bulkbounded_0");
    assert.equal(boundedTextQuery.truncated, true);

    console.log("recall-answers: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("recall-answers: FAIL");
  console.error(error);
  process.exit(1);
});
