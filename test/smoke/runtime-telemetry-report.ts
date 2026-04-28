import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  RuntimeTelemetryReportToolOutput,
  TaskPreflightArtifactToolOutput,
  GraphNeighborsToolOutput,
} from "../../packages/contracts/src/index.ts";
import { captureRuntimeUsefulnessForToolInvocation } from "../../packages/tools/src/runtime-telemetry/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore } from "../../packages/store/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "runtime-telemetry-report-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      status: "active",
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }
}

function makePreflightOutput(
  projectId: string,
  overrides: { artifactId?: string; stale?: boolean } = {},
): TaskPreflightArtifactToolOutput {
  return {
    toolName: "task_preflight_artifact",
    projectId,
    result: {
      artifactId: overrides.artifactId ?? "art_preflight_rep_1",
      kind: "task_preflight",
      projectId,
      title: "report smoke preflight",
      generatedAt: "2026-04-22T12:00:00.000Z",
      basis: [
        {
          basisRefId: "basis_1",
          kind: "workflow_packet",
          sourceId: "pkt_1",
          fingerprint: "fp_1",
          sourceOrigin: "local",
        },
      ],
      freshness: {
        state: overrides.stale ? "stale" : "fresh",
        staleBehavior: "warn_and_keep",
        staleBasisRefIds: overrides.stale ? ["basis_1"] : [],
        evaluatedAt: "2026-04-22T12:00:00.000Z",
      },
      consumerTargets: ["harness"],
      exportIntent: { exportable: false, defaultTargets: [] },
      payload: {
        summary: "Summary",
        readFirst: [
          {
            itemId: "r1",
            title: "Read",
            detail: "Read this",
            basisRefIds: ["basis_1"],
          },
        ],
        likelyMoveSurfaces: [],
        verifyBeforeStart: [
          { itemId: "v1", text: "Verify", basisRefIds: ["basis_1"] },
        ],
        activeRisks: [],
      },
      renderings: [
        { format: "json", body: JSON.stringify({ kind: "task_preflight" }) },
      ],
    },
  } as TaskPreflightArtifactToolOutput;
}

function makeGraphNeighborsOutput(projectId: string): GraphNeighborsToolOutput {
  return {
    toolName: "graph_neighbors",
    projectId,
    result: {
      requestedStartEntities: [{ kind: "route", key: "route:/x:GET" }],
      resolvedStartNodes: [],
      missingStartEntities: [],
      direction: "downstream",
      traversalDepth: 2,
      includeHeuristicEdges: false,
      neighbors: [],
      graphBasis: {
        projectId,
        indexedAt: "2026-04-22T12:00:00.000Z",
        nodeCount: 0,
        edgeCount: 0,
      },
      warnings: [],
    },
  } as unknown as GraphNeighborsToolOutput;
}

async function main(): Promise<void> {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mako-rt-report-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const priorStateDirName = process.env.MAKO_STATE_DIRNAME;
  process.env.MAKO_STATE_HOME = path.join(tmpRoot, "state");
  delete process.env.MAKO_STATE_DIRNAME;
  try {
    const projectId = `proj_rt_report_${process.pid}_${Date.now()}`;
    seedProject(tmpRoot, projectId);

    // Seed events via the capture path, not the raw insert. This exercises
    // the full 8.1a storage + 8.1b capture + 8.1c report chain end-to-end.
    await captureRuntimeUsefulnessForToolInvocation({
      toolName: "task_preflight_artifact",
      input: { projectId },
      output: makePreflightOutput(projectId),
      outcome: "success",
      requestId: "req_1",
      options: {},
    });
    await captureRuntimeUsefulnessForToolInvocation({
      toolName: "task_preflight_artifact",
      input: { projectId },
      output: makePreflightOutput(projectId, { artifactId: "art_preflight_rep_2", stale: true }),
      outcome: "success",
      requestId: "req_2",
      options: {},
    });
    await captureRuntimeUsefulnessForToolInvocation({
      toolName: "graph_neighbors",
      input: { projectId },
      output: makeGraphNeighborsOutput(projectId),
      outcome: "success",
      requestId: "req_3",
      options: {},
    });

    // --- Unfiltered report returns aggregates + events ---

    {
      const result = (await invokeTool("runtime_telemetry_report", {
        projectId,
      })) as RuntimeTelemetryReportToolOutput;

      assert.equal(result.toolName, "runtime_telemetry_report");
      assert.equal(result.projectId, projectId);
      assert.ok(result.eventsInWindow > 0, "should see events");
      // Every shipped decision kind is represented in byDecisionKind, even
      // when its count is zero.
      const kindNames = result.byDecisionKind.map((row) => row.decisionKind).sort();
      assert.deepEqual(
        kindNames,
        [
          "agent_feedback",
          "artifact_usefulness",
          "finding_ack",
          "packet_usefulness",
          "power_workflow_usefulness",
          "wrapper_usefulness",
        ],
        "byDecisionKind lists every shipped kind",
      );

      const artifactCount = result.byDecisionKind.find(
        (row) => row.decisionKind === "artifact_usefulness",
      )?.count;
      assert.equal(artifactCount, 2, "two artifact events seeded");

      const powerCount = result.byDecisionKind.find(
        (row) => row.decisionKind === "power_workflow_usefulness",
      )?.count;
      assert.equal(powerCount, 1, "one power-workflow event seeded");

      const wrapperCount = result.byDecisionKind.find(
        (row) => row.decisionKind === "wrapper_usefulness",
      )?.count;
      assert.equal(wrapperCount, 2, "two tool_plane wrapper events seeded (one per artifact call)");

      // Events come back ordered by capturedAt DESC.
      for (let i = 1; i < result.events.length; i++) {
        assert.ok(
          result.events[i - 1]!.capturedAt >= result.events[i]!.capturedAt,
          `events must be ordered by capturedAt DESC (index ${i})`,
        );
      }
    }

    // --- Filter by decisionKind ---

    {
      const result = (await invokeTool("runtime_telemetry_report", {
        projectId,
        decisionKind: "power_workflow_usefulness",
      })) as RuntimeTelemetryReportToolOutput;

      assert.equal(result.eventsInWindow, 1);
      for (const event of result.events) {
        assert.equal(event.decisionKind, "power_workflow_usefulness");
      }
    }

    // --- Filter by family ---

    {
      const result = (await invokeTool("runtime_telemetry_report", {
        projectId,
        family: "task_preflight",
      })) as RuntimeTelemetryReportToolOutput;

      // Every event should be family=task_preflight (artifact events).
      for (const event of result.events) {
        assert.equal(event.family, "task_preflight");
      }
      assert.equal(result.eventsInWindow, 2);
    }

    // --- Filter by requestId pins to a single call ---

    {
      const result = (await invokeTool("runtime_telemetry_report", {
        projectId,
        requestId: "req_3",
      })) as RuntimeTelemetryReportToolOutput;

      assert.equal(result.eventsInWindow, 1);
      assert.equal(result.events[0]?.decisionKind, "power_workflow_usefulness");
    }

    // --- limit=1 truncates the returned event list ---

    {
      const result = (await invokeTool("runtime_telemetry_report", {
        projectId,
        limit: 1,
      })) as RuntimeTelemetryReportToolOutput;

      assert.equal(result.events.length, 1);
      assert.equal(result.truncated, true);
      assert.ok(
        result.warnings.some((w) => /returning first/i.test(w)),
        "truncation warning present",
      );
    }

    // --- Aggregates stay accurate when the event list is truncated ---
    //
    // Regression guard for the pre-fix bug where aggregates were
    // computed from an in-process slice of the first AGGREGATE_CAP rows:
    // asking for limit=1 must not change `eventsInWindow` or the counts,
    // and the sum of byDecisionKind must equal eventsInWindow.

    {
      const full = (await invokeTool("runtime_telemetry_report", {
        projectId,
      })) as RuntimeTelemetryReportToolOutput;
      const paged = (await invokeTool("runtime_telemetry_report", {
        projectId,
        limit: 1,
      })) as RuntimeTelemetryReportToolOutput;

      assert.equal(
        paged.eventsInWindow,
        full.eventsInWindow,
        "eventsInWindow is the true matching count, not a page size",
      );
      const sum = paged.byDecisionKind.reduce((acc, row) => acc + row.count, 0);
      assert.equal(
        sum,
        paged.eventsInWindow,
        "sum(byDecisionKind.count) === eventsInWindow",
      );
      const gradeSum = paged.byGrade.reduce((acc, row) => acc + row.count, 0);
      assert.equal(
        gradeSum,
        paged.eventsInWindow,
        "sum(byGrade.count) === eventsInWindow",
      );
      const familySum = paged.byFamily.reduce((acc, row) => acc + row.count, 0);
      assert.equal(
        familySum,
        paged.eventsInWindow,
        "sum(byFamily.count) === eventsInWindow",
      );
    }

    // --- Unknown decisionKind is rejected by the input schema ---

    await assert.rejects(
      async () =>
        invokeTool("runtime_telemetry_report", {
          projectId,
          decisionKind: "not_a_kind",
        }),
      "unknown decisionKind must be rejected by schema",
    );

    // --- Since / until window filter ---

    {
      // A window in the past yields no events.
      const far = (await invokeTool("runtime_telemetry_report", {
        projectId,
        until: "2000-01-01T00:00:00.000Z",
      })) as RuntimeTelemetryReportToolOutput;
      assert.equal(far.eventsInWindow, 0);

      // A wide window sees everything.
      const wide = (await invokeTool("runtime_telemetry_report", {
        projectId,
        since: "2000-01-01T00:00:00.000Z",
      })) as RuntimeTelemetryReportToolOutput;
      assert.ok(wide.eventsInWindow > 0);
    }

    console.log("runtime-telemetry-report: PASS");
  } finally {
    restoreEnv("MAKO_STATE_HOME", priorStateHome);
    restoreEnv("MAKO_STATE_DIRNAME", priorStateDirName);
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
