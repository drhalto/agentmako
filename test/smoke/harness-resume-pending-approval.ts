/**
 * Phase 3.4 smoke — resume with an unresolved permission.request.
 *
 * Hand-crafts a session_events stream that contains a `permission.request`
 * event with no matching `permission.decision` (simulating a process that
 * died mid-approval), then:
 *
 *   - Calls `harness.resume(sessionId)`.
 *   - Asserts `pendingApprovals` length === 1 with the correct requestId.
 *   - Asserts a `resume.pending_approvals` event was emitted and persisted.
 *
 * Deterministic: inserts events directly via `store.insertHarnessSessionEvent`
 * so no live tool call or provider is involved.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHarness } from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-resume-pending-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-resume-pending-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  const store = openProjectStore({ projectRoot, stateDirName });
  try {
    const harness = createHarness({ store, projectRoot });

    const session = await harness.createSession({
      tier: "no-agent",
      title: "pending-approval smoke",
    });

    // Seed a partial exchange: a tool.call and a permission.request that
    // was never resolved (no matching permission.decision). The order mimics
    // what ToolDispatch would have written before the process died mid-ask.
    const pendingRequestId = "req-abc-123";

    store.insertHarnessSessionEvent({
      sessionId: session.id,
      kind: "tool.call",
      payload: { callId: "call-1", tool: "file_write", argsPreview: {} },
    });
    store.insertHarnessSessionEvent({
      sessionId: session.id,
      kind: "permission.request",
      payload: { requestId: pendingRequestId, tool: "file_write", preview: {} },
    });
    // NO permission.decision — simulates the process dying here.

    // Also seed a RESOLVED request in the same session to prove the scanner
    // does not false-positive on decided entries.
    const resolvedRequestId = "req-already-decided-xyz";
    store.insertHarnessSessionEvent({
      sessionId: session.id,
      kind: "permission.request",
      payload: { requestId: resolvedRequestId, tool: "shell_run", preview: {} },
    });
    store.insertHarnessSessionEvent({
      sessionId: session.id,
      kind: "permission.decision",
      payload: { requestId: resolvedRequestId, action: "allow", scope: "turn" },
    });

    const result = await harness.resume(session.id);

    assert.equal(
      result.pendingApprovals.length,
      1,
      `expected exactly 1 pending approval; got ${result.pendingApprovals.length}`,
    );
    const [pending] = result.pendingApprovals;
    assert.equal(pending.requestId, pendingRequestId, "pending request id matches");
    assert.equal(pending.tool, "file_write", "pending tool name propagated");
    assert.ok(
      typeof pending.requestOrdinal === "number" && pending.requestOrdinal >= 0,
      "requestOrdinal populated",
    );

    // A resume.pending_approvals event should now be in the event log.
    const events = store.listHarnessSessionEvents(session.id);
    const resumeEvents = events.filter((e) => e.kind === "resume.pending_approvals");
    assert.equal(resumeEvents.length, 1, "exactly one resume.pending_approvals emitted");
    const payload = resumeEvents[0]!.payload as { requestIds: string[]; note: string };
    assert.deepEqual(
      payload.requestIds,
      [pendingRequestId],
      "payload lists only the unresolved request",
    );
    assert.ok(payload.note.length > 0, "note explains what happened");

    // The resolved request must NOT appear in the pending list.
    assert.ok(
      !result.pendingApprovals.some((p) => p.requestId === resolvedRequestId),
      "decided requests excluded from pending",
    );

    console.log("harness-resume-pending-approval: PASS");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
