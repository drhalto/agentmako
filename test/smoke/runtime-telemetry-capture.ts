import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AnswerResult,
  ArtifactBase,
  ArtifactKind,
  GraphNeighborsToolOutput,
  TaskPreflightArtifactToolOutput,
  ToolOutput,
} from "../../packages/contracts/src/index.ts";
import {
  captureRuntimePacketUsefulnessForAnswerResult,
  captureRuntimeUsefulnessForToolInvocation,
} from "../../packages/tools/src/runtime-telemetry/index.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "runtime-telemetry-capture-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }
}

function makePreflightArtifact(
  overrides: Partial<ArtifactBase<ArtifactKind, unknown>> = {},
): ArtifactBase<"task_preflight", unknown> {
  return {
    artifactId: "art_preflight_1",
    kind: "task_preflight",
    projectId: "proj_rt_capture",
    title: "sample task preflight",
    generatedAt: "2026-04-22T12:00:00.000Z",
    basis: [
      {
        basisRefId: "basis_brief_1",
        kind: "workflow_packet",
        sourceId: "pkt_brief_1",
        fingerprint: "fp_brief",
        sourceOrigin: "local",
      },
      {
        basisRefId: "basis_plan_1",
        kind: "workflow_result",
        sourceId: "change_plan_1",
        fingerprint: "fp_plan",
        sourceOrigin: "local",
      },
    ],
    freshness: {
      state: "fresh",
      staleBehavior: "warn_and_keep",
      staleBasisRefIds: [],
      evaluatedAt: "2026-04-22T12:00:00.000Z",
    },
    consumerTargets: ["harness"],
    exportIntent: { exportable: false, defaultTargets: [] },
    payload: {
      summary: "Before changing the events route, read these and verify.",
      readFirst: [
        {
          itemId: "read_1",
          title: "Events route handler",
          detail: "Reads the current GET handler to know what the new change must preserve.",
          basisRefIds: ["basis_brief_1"],
        },
      ],
      likelyMoveSurfaces: [
        {
          surfaceId: "surf_1",
          title: "app/api/events/route.ts",
          nodeLabel: "route:/api/events:GET",
          role: "direct",
          dependsOnStepIds: [],
          rationale: "The change target itself.",
          containsHeuristicEdge: false,
          basisRefIds: ["basis_plan_1"],
        },
      ],
      verifyBeforeStart: [
        {
          itemId: "verify_1",
          text: "Confirm the existing response contract is preserved in the rewritten handler.",
          basisRefIds: ["basis_plan_1"],
        },
      ],
      activeRisks: [],
    },
    renderings: [
      { format: "json", body: JSON.stringify({ kind: "task_preflight" }) },
      { format: "markdown", body: "# task preflight" },
    ],
    ...overrides,
  } as ArtifactBase<"task_preflight", unknown>;
}

function makeTaskPreflightToolOutput(
  options: { projectId: string; withExport?: boolean } = { projectId: "proj_rt_capture" },
): TaskPreflightArtifactToolOutput {
  const output: TaskPreflightArtifactToolOutput = {
    toolName: "task_preflight_artifact",
    projectId: options.projectId,
    result: makePreflightArtifact({ projectId: options.projectId }) as TaskPreflightArtifactToolOutput["result"],
  };
  if (options.withExport) {
    output.exported = {
      files: [
        {
          format: "json",
          path: ".mako/artifacts/task_preflight/art_preflight_1.json",
        },
        {
          format: "markdown",
          path: ".mako/artifacts/task_preflight/art_preflight_1.md",
        },
      ],
    };
  }
  return output;
}

function makeGraphNeighborsToolOutput(
  projectId: string,
): GraphNeighborsToolOutput {
  // Minimal shape; capture reads only `result.neighbors.length`,
  // `result.warnings.length`, and the tool name. Cast through unknown
  // because the full GraphSliceBasis shape is not load-bearing for this
  // test.
  return {
    toolName: "graph_neighbors",
    projectId,
    result: {
      requestedStartEntities: [{ kind: "route", key: "route:/api/events:GET" }],
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

function makeAnswerResultWithCompanionPacket(
  projectId: string,
): AnswerResult {
  // The evaluator accesses: packet.family, packet.citations,
  // packet.sections[i].kind, packetSurface.attachmentReason,
  // packetSurface.handoff.{current,stopWhen}, result.candidateActions[0],
  // result.trust, result.diagnostics. Every other field is structural.
  const packet = {
    packetId: "pkt_1",
    family: "verification_plan" as const,
    title: "Verification plan for events route",
    queryId: "query_rt_1",
    projectId,
    basis: {
      scope: {},
      watchMode: "single_run" as const,
      selectedItemIds: [],
      focusedItemIds: [],
      primaryItemIds: [],
      supportingItemIds: [],
    },
    sections: [
      {
        sectionId: "sec_verify",
        kind: "verification" as const,
        title: "Verify",
        entries: [
          {
            entryId: "entry_1",
            text: "Call GET /api/events and confirm 200.",
            citationIds: [],
          },
        ],
      },
    ],
    citations: [],
    assumptions: [],
    openQuestions: [],
    payload: {
      summarySectionId: "sec_verify",
      baselineSectionId: null,
      verificationSectionId: "sec_verify",
      doneCriteriaSectionId: null,
      rerunTriggerSectionId: null,
    },
  };
  return {
    projectId,
    queryId: "query_rt_1",
    queryKind: "route_trace",
    supportLevel: "native",
    evidenceStatus: "complete",
    packet: {
      queryText: "trace the events route",
      focusedItemIds: [],
      scope: {},
    },
    candidateActions: [],
    companionPacket: {
      packet,
      handoff: {
        current: "verification",
        stopWhen: "the route returns expected payload",
      },
      attachmentDecision: {
        family: "verification_plan",
        trigger: {
          queryKind: "route_trace",
          supportLevel: "native",
          evidenceStatus: "complete",
          trustState: "consistent",
        },
      },
      attachmentReason:
        "Attached verification_plan because queryKind=route_trace produced complete native evidence.",
    },
    trust: {
      state: "consistent",
      reasons: [],
      basisTraceIds: ["query_rt_1"],
      conflictingFacets: [],
      scopeRelation: "same_scope",
    },
    diagnostics: [],
  } as unknown as AnswerResult;
}

async function main(): Promise<void> {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mako-rt-capture-"));
  const previousStateHome = process.env.MAKO_STATE_HOME;
  const previousStateDirname = process.env.MAKO_STATE_DIRNAME;
  try {
    const stateHome = path.join(tmpRoot, "state");
    mkdirSync(stateHome, { recursive: true });
    process.env.MAKO_STATE_HOME = stateHome;
    delete process.env.MAKO_STATE_DIRNAME;

    const projectId = "proj_rt_capture";
    seedProject(tmpRoot, projectId);

    // --- Test A: successful task_preflight_artifact → artifact + tool_plane wrapper ---

    await captureRuntimeUsefulnessForToolInvocation({
      toolName: "task_preflight_artifact",
      input: { projectId },
      output: makeTaskPreflightToolOutput({ projectId }),
      outcome: "success",
      requestId: "req_a",
      options: {},
    });

    {
      const projectStore = openProjectStore({ projectRoot: tmpRoot });
      try {
        const events = projectStore.queryUsefulnessEvents({ requestId: "req_a" });
        const kinds = events.map((e) => e.decisionKind).sort();
        assert.deepEqual(
          kinds,
          ["artifact_usefulness", "wrapper_usefulness"],
          "successful artifact tool call emits artifact + tool_plane wrapper",
        );
        const artifactEvent = events.find((e) => e.decisionKind === "artifact_usefulness");
        assert.ok(artifactEvent, "artifact event present");
        assert.equal(artifactEvent?.family, "task_preflight");
        assert.equal(artifactEvent?.toolName, "task_preflight_artifact");
        assert.ok(
          ["full", "partial", "no"].includes(artifactEvent?.grade ?? ""),
          "artifact grade is a valid enum value",
        );
        const wrapperEvent = events.find(
          (e) => e.decisionKind === "wrapper_usefulness",
        );
        assert.equal(wrapperEvent?.family, "tool_plane");
      } finally {
        projectStore.close();
      }
    }

    // --- Test B: with export → adds file_export wrapper event ---

    await captureRuntimeUsefulnessForToolInvocation({
      toolName: "task_preflight_artifact",
      input: { projectId },
      output: makeTaskPreflightToolOutput({ projectId, withExport: true }),
      outcome: "success",
      requestId: "req_b",
      options: {},
    });

    {
      const projectStore = openProjectStore({ projectRoot: tmpRoot });
      try {
        const events = projectStore.queryUsefulnessEvents({ requestId: "req_b" });
        const wrapperFamilies = events
          .filter((e) => e.decisionKind === "wrapper_usefulness")
          .map((e) => e.family)
          .sort();
        assert.deepEqual(
          wrapperFamilies,
          ["file_export", "tool_plane"],
          "export request emits both tool_plane and file_export wrappers",
        );
        const fileExport = events.find((e) => e.family === "file_export");
        assert.ok(fileExport?.reasonCodes.includes("export_files_written"));
      } finally {
        projectStore.close();
      }
    }

    // --- Test C: failed artifact tool call → tool_plane wrapper failure only ---

    await captureRuntimeUsefulnessForToolInvocation({
      toolName: "task_preflight_artifact",
      input: { projectId },
      output: undefined,
      outcome: "failed",
      requestId: "req_c",
      options: {},
    });

    {
      const projectStore = openProjectStore({ projectRoot: tmpRoot });
      try {
        const events = projectStore.queryUsefulnessEvents({ requestId: "req_c" });
        assert.equal(events.length, 1);
        assert.equal(events[0]?.decisionKind, "wrapper_usefulness");
        assert.equal(events[0]?.family, "tool_plane");
        assert.equal(events[0]?.grade, "no");
        assert.ok(events[0]?.reasonCodes.includes("tool_call_failed"));
      } finally {
        projectStore.close();
      }
    }

    // --- Test D: non-gradeable tool → no events ---

    await captureRuntimeUsefulnessForToolInvocation({
      toolName: "answer_ask",
      input: { projectId },
      output: { toolName: "answer_ask", result: {} } as unknown as ToolOutput,
      outcome: "success",
      requestId: "req_d",
      options: {},
    });

    {
      const projectStore = openProjectStore({ projectRoot: tmpRoot });
      try {
        const events = projectStore.queryUsefulnessEvents({ requestId: "req_d" });
        assert.equal(events.length, 0, "non-gradeable tools must not emit events");
      } finally {
        projectStore.close();
      }
    }

    // --- Test E: power-workflow tool → power_workflow_usefulness event ---

    await captureRuntimeUsefulnessForToolInvocation({
      toolName: "graph_neighbors",
      input: { projectId },
      output: makeGraphNeighborsToolOutput(projectId),
      outcome: "success",
      requestId: "req_e",
      options: {},
    });

    {
      const projectStore = openProjectStore({ projectRoot: tmpRoot });
      try {
        const events = projectStore.queryUsefulnessEvents({ requestId: "req_e" });
        assert.equal(events.length, 1);
        assert.equal(events[0]?.decisionKind, "power_workflow_usefulness");
        assert.equal(events[0]?.family, "graph_traversal");
        assert.equal(events[0]?.toolName, "graph_neighbors");
      } finally {
        projectStore.close();
      }
    }

    // --- Test F: packet usefulness capture with fixture AnswerResult ---

    {
      const projectStore = openProjectStore({ projectRoot: tmpRoot });
      try {
        captureRuntimePacketUsefulnessForAnswerResult({
          answerResult: makeAnswerResultWithCompanionPacket(projectId),
          projectStore,
          requestId: "req_f",
        });

        const events = projectStore.queryUsefulnessEvents({ requestId: "req_f" });
        assert.equal(events.length, 1);
        assert.equal(events[0]?.decisionKind, "packet_usefulness");
        assert.equal(events[0]?.family, "verification_plan");
        assert.equal(events[0]?.traceId, "query_rt_1");
      } finally {
        projectStore.close();
      }
    }

    // --- Test G: capture never throws even on missing project resolution ---

    await assert.doesNotReject(async () => {
      await captureRuntimeUsefulnessForToolInvocation({
        toolName: "task_preflight_artifact",
        input: {}, // no projectId, no projectRef
        output: makeTaskPreflightToolOutput({ projectId }),
        outcome: "success",
        requestId: "req_g",
        options: {},
      });
    });

    console.log("runtime-telemetry-capture: PASS");
  } finally {
    if (previousStateHome == null) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = previousStateHome;
    }
    if (previousStateDirname == null) {
      delete process.env.MAKO_STATE_DIRNAME;
    } else {
      process.env.MAKO_STATE_DIRNAME = previousStateDirname;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
