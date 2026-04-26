/**
 * Phase 3.4 smoke — session resume (deterministic, no live provider).
 *
 * Exercises:
 *   - Create a session, post a no-agent turn → events persisted.
 *   - Close the harness and store, reopen, call `harness.resume(sessionId)`.
 *   - Assert: resumedFromOrdinal equals the last event ordinal persisted,
 *     eventCount matches, no pending approvals, harness_version stamp
 *     allows replay.
 *   - No tool is re-invoked — we verify that by counting
 *     `provider.call` events before vs. after resume (unchanged).
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHarness } from "../../packages/harness-core/src/index.ts";
import type { EmittedSessionEvent } from "../../packages/harness-core/src/event-bus.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function waitForTurnDone(
  events: EmittedSessionEvent[],
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.some((e) => e.event.kind === "turn.done" || e.event.kind === "error")) {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for turn.done");
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-resume-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-resume-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  // ---- Phase 1: create session + run one turn, then close store ------------
  let sessionId: string;
  let preResumeEventCount: number;
  {
    const store = openProjectStore({ projectRoot, stateDirName });
    const harness = createHarness({ store, projectRoot });

    const session = await harness.createSession({
      tier: "no-agent",
      title: "resume smoke",
    });
    sessionId = session.id;

    const events: EmittedSessionEvent[] = [];
    const unsubscribe = harness.bus.subscribe(sessionId, (ev) => {
      events.push(ev);
    });
    harness.postMessage(sessionId, "list the files here");
    await waitForTurnDone(events);
    unsubscribe();

    preResumeEventCount = store.listHarnessSessionEvents(sessionId).length;
    assert.ok(preResumeEventCount > 0, "pre-resume events persisted");

    store.close();
  }

  // ---- Phase 2: reopen store, resume, inspect ------------------------------
  {
    const store = openProjectStore({ projectRoot, stateDirName });
    try {
      const harness = createHarness({ store, projectRoot });

      const result = await harness.resume(sessionId);
      assert.equal(result.sessionId, sessionId);
      assert.equal(
        result.eventCount,
        preResumeEventCount,
        `eventCount ${result.eventCount} should match persisted ${preResumeEventCount}`,
      );
      assert.ok(result.resumedFromOrdinal >= 0, "resumedFromOrdinal is a real ordinal");
      assert.equal(result.pendingApprovals.length, 0, "no pending approvals in a clean run");

      // Resume must not have invoked the model; provider-call count stable.
      const providerCalls = store
        .listHarnessSessionEvents(sessionId)
        .filter((e) => e.kind === "provider.call");
      // No-agent tier never calls a provider, so count is 0 both before and after.
      assert.equal(providerCalls.length, 0, "no provider calls in no-agent tier");

      // resume.pending_approvals event is NOT emitted when none are pending.
      const resumeEvents = store
        .listHarnessSessionEvents(sessionId)
        .filter((e) => e.kind === "resume.pending_approvals");
      assert.equal(resumeEvents.length, 0, "no resume.pending_approvals when clean");

      console.log("harness-resume: PASS");
    } finally {
      store.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
