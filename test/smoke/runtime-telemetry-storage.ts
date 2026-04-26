import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeUsefulnessEvent } from "../../packages/contracts/src/index.ts";
import {
  createRuntimeTelemetryEmitter,
  NOOP_RUNTIME_TELEMETRY_EMITTER,
} from "../../packages/tools/src/runtime-telemetry/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

function makeEvent(
  overrides: Partial<RuntimeUsefulnessEvent> = {},
): RuntimeUsefulnessEvent {
  return {
    eventId: "evt_fixture_1",
    projectId: "proj_fixture",
    requestId: "req_fixture_1",
    traceId: "trace_fixture_1",
    capturedAt: "2026-04-22T12:00:00.000Z",
    decisionKind: "artifact_usefulness",
    family: "task_preflight",
    toolName: "task_preflight_artifact",
    grade: "full",
    reasonCodes: ["basis_complete", "preflight_has_verification_steps"],
    observedFollowupLinked: true,
    reason: "all basis refs present",
    ...overrides,
  };
}

async function main(): Promise<void> {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mako-rt-telemetry-"));
  try {
    const projectStore = openProjectStore({ projectRoot: tmpRoot });
    try {
      // --- Insert + query round-trip ---

      const inserted = projectStore.insertUsefulnessEvent({
        eventId: "evt_1",
        projectId: "proj_fixture",
        requestId: "req_1",
        capturedAt: "2026-04-22T12:00:00.000Z",
        decisionKind: "artifact_usefulness",
        family: "task_preflight",
        toolName: "task_preflight_artifact",
        grade: "full",
        reasonCodes: ["basis_complete"],
        observedFollowupLinked: true,
        reason: "fixture",
      });
      assert.equal(inserted.eventId, "evt_1");
      assert.equal(inserted.reasonCodes.length, 1);
      assert.equal(inserted.reasonCodes[0], "basis_complete");
      assert.equal(inserted.observedFollowupLinked, true);

      const queried = projectStore.queryUsefulnessEvents({
        projectId: "proj_fixture",
      });
      assert.equal(queried.length, 1);
      assert.equal(queried[0]?.eventId, "evt_1");

      // --- Auto-generated eventId + capturedAt ---

      const auto = projectStore.insertUsefulnessEvent({
        projectId: "proj_fixture",
        requestId: "req_2",
        decisionKind: "power_workflow_usefulness",
        family: "flow_map",
        grade: "partial",
        reasonCodes: ["no_diagnostic_signal"],
      });
      assert.ok(auto.eventId.length > 0, "eventId auto-generated");
      assert.ok(auto.capturedAt.length > 0, "capturedAt auto-generated");
      assert.equal(auto.traceId, undefined, "traceId optional drops cleanly");
      assert.equal(auto.toolName, undefined, "toolName optional drops cleanly");
      assert.equal(
        auto.observedFollowupLinked,
        undefined,
        "observedFollowupLinked optional drops cleanly",
      );

      // --- Filtering works ---

      projectStore.insertUsefulnessEvent({
        eventId: "evt_wrapper",
        projectId: "proj_fixture",
        requestId: "req_3",
        decisionKind: "wrapper_usefulness",
        family: "tool_plane",
        grade: "no",
        reasonCodes: ["tool_call_failed"],
      });

      const wrapperOnly = projectStore.queryUsefulnessEvents({
        decisionKind: "wrapper_usefulness",
      });
      assert.equal(wrapperOnly.length, 1);
      assert.equal(wrapperOnly[0]?.decisionKind, "wrapper_usefulness");

      const taskPreflightOnly = projectStore.queryUsefulnessEvents({
        family: "task_preflight",
      });
      assert.equal(taskPreflightOnly.length, 1);
      assert.equal(taskPreflightOnly[0]?.family, "task_preflight");

      const byRequest = projectStore.queryUsefulnessEvents({
        requestId: "req_3",
      });
      assert.equal(byRequest.length, 1);
      assert.equal(byRequest[0]?.eventId, "evt_wrapper");

      // --- ORDER BY captured_at DESC ---

      const all = projectStore.queryUsefulnessEvents({
        projectId: "proj_fixture",
      });
      assert.equal(all.length, 3);
      for (let i = 1; i < all.length; i++) {
        const prev = all[i - 1]!;
        const cur = all[i]!;
        assert.ok(
          prev.capturedAt >= cur.capturedAt,
          `results must be ordered by capturedAt DESC (index ${i})`,
        );
      }

      // --- Append-only triggers reject UPDATE + DELETE ---

      assert.throws(
        () =>
          projectStore.db
            .prepare(`UPDATE mako_usefulness_events SET family = 'mutated' WHERE event_id = 'evt_1'`)
            .run(),
        /append-only/,
        "UPDATE on mako_usefulness_events must be blocked",
      );

      assert.throws(
        () =>
          projectStore.db
            .prepare(`DELETE FROM mako_usefulness_events WHERE event_id = 'evt_1'`)
            .run(),
        /append-only/,
        "DELETE on mako_usefulness_events must be blocked",
      );

      // --- Write-path schema validation ---
      //
      // insertUsefulnessEventImpl parses through RuntimeUsefulnessEventSchema
      // before running SQL, so malformed inputs are rejected even when the
      // SQL CHECK constraints would not have caught them (empty strings,
      // malformed ISO timestamps, empty reason-code entries).

      assert.throws(
        () =>
          projectStore.insertUsefulnessEvent({
            projectId: "proj_fixture",
            requestId: "req_bad",
            // @ts-expect-error intentional bad value
            decisionKind: "not_a_kind",
            family: "x",
            grade: "full",
            reasonCodes: [],
          }),
        "unknown decisionKind must be rejected",
      );

      assert.throws(
        () =>
          projectStore.insertUsefulnessEvent({
            projectId: "proj_fixture",
            requestId: "req_bad_grade",
            decisionKind: "artifact_usefulness",
            family: "x",
            // @ts-expect-error intentional bad value
            grade: "mystery",
            reasonCodes: [],
          }),
        "unknown grade must be rejected",
      );

      assert.throws(
        () =>
          projectStore.insertUsefulnessEvent({
            projectId: "proj_fixture",
            requestId: "req_bad_time",
            capturedAt: "not-an-iso-string",
            decisionKind: "artifact_usefulness",
            family: "x",
            grade: "full",
            reasonCodes: [],
          }),
        "non-ISO capturedAt must be rejected at the store boundary",
      );

      assert.throws(
        () =>
          projectStore.insertUsefulnessEvent({
            projectId: "proj_fixture",
            requestId: "req_empty_family",
            decisionKind: "artifact_usefulness",
            family: "",
            grade: "full",
            reasonCodes: [],
          }),
        "empty family must be rejected at the store boundary",
      );

      assert.throws(
        () =>
          projectStore.insertUsefulnessEvent({
            projectId: "proj_fixture",
            requestId: "req_empty_reason_code",
            decisionKind: "artifact_usefulness",
            family: "x",
            grade: "full",
            reasonCodes: [""],
          }),
        "empty reasonCodes entry must be rejected at the store boundary",
      );

      assert.throws(
        () =>
          projectStore.insertUsefulnessEvent({
            projectId: "",
            requestId: "req_empty_proj",
            decisionKind: "artifact_usefulness",
            family: "x",
            grade: "full",
            reasonCodes: [],
          }),
        "empty projectId must be rejected at the store boundary",
      );

      // --- Emitter swallows insert failures ---

      const captured: string[] = [];
      const throwingEmitter = createRuntimeTelemetryEmitter({
        insert: () => {
          throw new Error("simulated write failure");
        },
        logger: (msg) => {
          captured.push(msg);
        },
      });
      assert.doesNotThrow(() => throwingEmitter(makeEvent()));
      assert.equal(captured.length, 1);
      assert.match(captured[0] ?? "", /runtime-telemetry/);

      // --- Emitter succeeds through ProjectStore ---

      let inserts = 0;
      const liveEmitter = createRuntimeTelemetryEmitter({
        insert: (input) => {
          inserts += 1;
          return projectStore.insertUsefulnessEvent(input);
        },
      });
      liveEmitter(makeEvent({ eventId: "evt_via_emitter", requestId: "req_em" }));
      assert.equal(inserts, 1);
      const byEmitter = projectStore.queryUsefulnessEvents({
        requestId: "req_em",
      });
      assert.equal(byEmitter.length, 1);
      assert.equal(byEmitter[0]?.eventId, "evt_via_emitter");

      // --- NOOP emitter is safe to call and does nothing ---

      NOOP_RUNTIME_TELEMETRY_EMITTER(makeEvent({ eventId: "should_not_land" }));
      const afterNoop = projectStore.queryUsefulnessEvents({
        projectId: "proj_fixture",
      });
      assert.ok(
        afterNoop.every((r) => r.eventId !== "should_not_land"),
        "NOOP emitter must not write",
      );

      console.log("runtime-telemetry-storage: PASS");
    } finally {
      projectStore.close();
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
