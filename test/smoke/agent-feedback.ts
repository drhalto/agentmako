/**
 * `agent_feedback` + `agent_feedback_report` smoke.
 *
 * Verifies append-only feedback capture, required request scoping,
 * report filters, truncation signalling, and visibility through the
 * shared runtime_telemetry_report surface.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AgentFeedbackReportToolOutputSchema,
  AgentFeedbackToolOutputSchema,
  type AgentFeedbackReportToolOutput,
  type RuntimeTelemetryReportToolOutput,
} from "../../packages/contracts/src/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

function seedProject(projectRoot: string, projectId: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "agent-feedback-smoke",
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
      name: "agent-feedback-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-agent-feedback-"));
  try {
    const stateHome = path.join(tmp, "state");
    mkdirSync(stateHome, { recursive: true });
    const projectRoot = path.join(tmp, "project");
    mkdirSync(projectRoot, { recursive: true });

    process.env.MAKO_STATE_HOME = stateHome;
    delete process.env.MAKO_STATE_DIRNAME;

    const projectId = randomUUID();
    seedProject(projectRoot, projectId);

    const first = AgentFeedbackToolOutputSchema.parse(
      await invokeTool("agent_feedback", {
        projectId,
        referencedToolName: "cross_search",
        referencedRequestId: "req_cross_1",
        grade: "partial",
        reasonCodes: ["partial_coverage", "top_not_useful"],
        reason: "useful result was below the fold",
      }),
    );
    assert.equal(first.toolName, "agent_feedback");
    assert.equal(first.projectId, projectId);
    assert.ok(first.eventId.length > 0);

    const duplicate = AgentFeedbackToolOutputSchema.parse(
      await invokeTool("agent_feedback", {
        projectId,
        referencedToolName: "cross_search",
        referencedRequestId: "req_cross_1",
        grade: "no",
        reasonCodes: ["answer_wrong"],
        reason: "top answer identified the wrong file",
      }),
    );
    assert.notEqual(
      duplicate.eventId,
      first.eventId,
      "duplicate feedback for one tool run remains append-only",
    );

    await invokeTool("agent_feedback", {
      projectId,
      referencedToolName: "table_neighborhood",
      referencedRequestId: "req_table_1",
      grade: "full",
      reasonCodes: ["answer_complete"],
    });

    const projectStore = openProjectStore({ projectRoot });
    try {
      const events = projectStore.queryUsefulnessEvents({
        projectId,
        decisionKind: "agent_feedback",
      });
      assert.equal(events.length, 3, "one event per feedback call");

      const firstEvent = events.find((event) => event.eventId === first.eventId);
      assert.ok(firstEvent, "first feedback event persisted");
      assert.equal(firstEvent?.family, "cross_search");
      assert.equal(firstEvent?.requestId, "req_cross_1");
      assert.equal(firstEvent?.toolName, "agent_feedback");
      assert.equal(firstEvent?.grade, "partial");
      assert.deepEqual(firstEvent?.reasonCodes, ["partial_coverage", "top_not_useful"]);
      assert.equal(firstEvent?.reason, "useful result was below the fold");
    } finally {
      projectStore.close();
    }

    const report = AgentFeedbackReportToolOutputSchema.parse(
      await invokeTool("agent_feedback_report", { projectId }),
    );
    assertReportTotals(report);
    assert.equal(report.feedbackInWindow, 3);
    assert.equal(report.entries.length, 3);
    assert.equal(report.truncated, false);

    const crossEntries = report.entries.filter(
      (entry) =>
        entry.referencedToolName === "cross_search" &&
        entry.referencedRequestId === "req_cross_1",
    );
    assert.equal(crossEntries.length, 2, "duplicate feedback rows both appear");

    const crossOnly = AgentFeedbackReportToolOutputSchema.parse(
      await invokeTool("agent_feedback_report", {
        projectId,
        referencedToolName: "cross_search",
      }),
    );
    assert.equal(crossOnly.feedbackInWindow, 2);
    assert.equal(crossOnly.byTool.length, 1);
    assert.equal(crossOnly.byTool[0]?.referencedToolName, "cross_search");

    const fullOnly = AgentFeedbackReportToolOutputSchema.parse(
      await invokeTool("agent_feedback_report", {
        projectId,
        grade: "full",
      }),
    );
    assert.equal(fullOnly.feedbackInWindow, 1);
    assert.equal(fullOnly.entries[0]?.referencedToolName, "table_neighborhood");

    const limited = AgentFeedbackReportToolOutputSchema.parse(
      await invokeTool("agent_feedback_report", {
        projectId,
        limit: 1,
      }),
    );
    assert.equal(limited.entries.length, 1);
    assert.equal(limited.truncated, true);
    assert.ok(
      limited.warnings.some((warning) => /returning first/i.test(warning)),
      "limit truncation warning present",
    );

    const telemetryReport = (await invokeTool("runtime_telemetry_report", {
      projectId,
      decisionKind: "agent_feedback",
    })) as RuntimeTelemetryReportToolOutput;
    assert.equal(telemetryReport.eventsInWindow, 3);
    assert.ok(
      telemetryReport.events.every(
        (event) => event.decisionKind === "agent_feedback",
      ),
      "runtime telemetry report filters to agent feedback rows",
    );
    assert.equal(
      telemetryReport.byDecisionKind.find(
        (row) => row.decisionKind === "agent_feedback",
      )?.count,
      3,
    );

    await assert.rejects(
      async () =>
        invokeTool("agent_feedback", {
          projectId,
          referencedToolName: "cross_search",
          grade: "full",
          reasonCodes: ["answer_complete"],
        }),
      "referencedRequestId is required",
    );

    console.log("agent-feedback: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function assertReportTotals(report: AgentFeedbackReportToolOutput): void {
  const byTool = new Map(report.byTool.map((row) => [row.referencedToolName, row]));

  const cross = byTool.get("cross_search");
  assert.ok(cross, "cross_search aggregate present");
  assert.equal(cross?.full, 0);
  assert.equal(cross?.partial, 1);
  assert.equal(cross?.no, 1);
  assert.equal(cross?.total, 2);

  const table = byTool.get("table_neighborhood");
  assert.ok(table, "table_neighborhood aggregate present");
  assert.equal(table?.full, 1);
  assert.equal(table?.partial, 0);
  assert.equal(table?.no, 0);
  assert.equal(table?.total, 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
