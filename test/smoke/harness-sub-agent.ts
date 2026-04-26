/**
 * Phase 3.4 smoke — sub-agent spawn (no-agent tier, deterministic).
 *
 * Exercises:
 *   - `assertRecursionWithinCap` (at depth 0 → OK)
 *   - `spawnChildSession` → creates a child `harness_sessions` row with
 *     `parent_id` set and `harness_version` stamped
 *   - The child runs a no-agent turn and produces an assistant text reply
 *   - `inheritPermissions: "none"` — no parent decisions carry
 *   - `sub_agent.started` and `sub_agent.finished` events land on the
 *     parent session's event log
 *
 * Runs without a real provider: both sessions are at no-agent tier, which
 * routes through the `ask` adapter.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertRecursionWithinCap,
  createHarness,
  HARNESS_VERSION,
  spawnChildSession,
} from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-sub-agent-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-sub-agent-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  const store = openProjectStore({ projectRoot, stateDirName });
  try {
    const harness = createHarness({ store, projectRoot });

    const parent = await harness.createSession({
      tier: "no-agent",
      title: "parent",
    });
    assert.ok(parent.id, "parent session created");
    assert.equal(parent.tier, "no-agent");

    // Recursion walk at the root must succeed (depth = 0 ancestors).
    const depth = assertRecursionWithinCap(store, parent.id, 3);
    assert.equal(depth, 0, "root parent walk reports depth 0 (no ancestors)");

    // harness_version stamped at creation.
    const parentRow = store.getHarnessSession(parent.id);
    assert.ok(parentRow, "parent row readable");
    assert.equal(
      parentRow.harnessVersion,
      HARNESS_VERSION,
      "parent stamped with HARNESS_VERSION",
    );

    const result = await spawnChildSession({
      harness,
      store,
      parentSessionId: parent.id,
      prompt: "what files are in this project?",
      inheritPermissions: "none",
      title: "child-of-parent",
    });

    assert.ok(result.ok, `child turn should succeed; reason=${result.reason ?? "ok"}`);
    assert.ok(result.childSessionId, "child session id returned");
    assert.ok(result.summary.length > 0, "child produced some assistant text");
    assert.equal(result.budgetExhausted, false, "single-turn child not budget-exhausted");
    assert.equal(result.turnsRun, 1, "exactly one turn ran");

    // Child row carries parent_id.
    const childRow = store.getHarnessSession(result.childSessionId);
    assert.ok(childRow, "child row exists");
    assert.equal(childRow.parentId, parent.id, "child.parent_id === parent.id");
    assert.equal(childRow.tier, "no-agent", "child inherited no-agent tier");
    assert.equal(childRow.harnessVersion, HARNESS_VERSION, "child stamped with HARNESS_VERSION");
    assert.equal(childRow.status, "closed", "child closed after turn");

    // inheritPermissions: "none" → child has zero permission decisions.
    const childDecisions = store.listHarnessPermissionDecisions(result.childSessionId);
    assert.equal(childDecisions.length, 0, "none mode leaves child decisions empty");

    // Recursion walk from the child sees 1 ancestor.
    const childDepth = assertRecursionWithinCap(store, result.childSessionId, 3);
    assert.equal(childDepth, 1, "child walk reports depth 1 (one ancestor: parent)");

    // Parent event log carries sub_agent.started + sub_agent.finished.
    const parentEvents = store.listHarnessSessionEvents(parent.id);
    const kinds = parentEvents.map((e) => e.kind);
    assert.ok(
      kinds.includes("sub_agent.started"),
      `expected sub_agent.started in parent events; got ${kinds.join(",")}`,
    );
    assert.ok(
      kinds.includes("sub_agent.finished"),
      `expected sub_agent.finished in parent events; got ${kinds.join(",")}`,
    );

    console.log("harness-sub-agent: PASS");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
