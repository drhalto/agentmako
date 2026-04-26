/**
 * Phase 3.2 acceptance smoke.
 *
 * Covers the four critical action-tool paths the phase doc lists as separate
 * smoke files (action-approval, action-deny, shell-run-constrained, undo)
 * inside one harness so the deterministic substrate (no network calls) is
 * exercised end to end:
 *
 *   1. Permission engine: explicit `allow` rule short-circuits the prompt.
 *   2. Permission engine: explicit `deny` rule blocks a mutation tool.
 *   3. Approval flow: pending `permission.request` is resolved by an HTTP-style
 *      call into `Harness.resolvePermissionRequest` and the tool applies.
 *   4. Snapshot + undo: an applied edit is reverted byte-for-byte.
 *   5. Shell guard: shell metacharacters in `command` are rejected; cwd outside
 *      the project root is rejected; env keys outside the allowlist are rejected.
 *
 * The smoke does not stand up an LLM. It calls the dispatch's tool execute()
 * functions directly through `harness.permissionEngine` + the tool registry,
 * which is what the real cloud-agent path uses inside `streamText` and so
 * exercises the same code paths.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ACTION_TOOLS,
  applyUndo,
  fileEditTool,
  fileWriteTool,
  shellRunTool,
} from "../../packages/harness-tools/src/index.ts";
import {
  PermissionEngine,
  ToolDispatch,
  PermissionDeniedError,
  createHarness,
} from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-action-tools-"));
  const projectRoot = path.join(tmp, "project");
  const globalConfigDir = path.join(tmp, "global-config");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-action-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  // Seed a real file we can edit + a permissions.json with one allow + one deny.
  writeFileSync(
    path.join(projectRoot, "README.md"),
    "# Test\n\nHello world.\n",
  );
  mkdirSync(path.join(projectRoot, ".mako"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, ".mako", "permissions.json"),
    JSON.stringify({
      rules: [
        { permission: "shell_run", pattern: "git *", action: "allow" },
        { permission: "file_write", pattern: "secrets/**", action: "deny" },
        { permission: "file_write", pattern: "docs/private/**", action: "deny" },
      ],
    }),
  );
  mkdirSync(globalConfigDir, { recursive: true });
  writeFileSync(
    path.join(globalConfigDir, "permissions.json"),
    JSON.stringify({
      rules: [{ permission: "file_write", pattern: "docs/**", action: "deny" }],
    }),
  );

  const store = openProjectStore({ projectRoot, stateDirName });

  try {
    // ---- 1. ACTION_TOOLS catalog sanity --------------------------------------
    assert.equal(ACTION_TOOLS.length, 6, "expected six action tools");
    for (const t of ACTION_TOOLS) {
      assert.ok(typeof t.dryRun === "function", `${t.name} dryRun fn`);
      assert.ok(typeof t.apply === "function", `${t.name} apply fn`);
      assert.ok(typeof t.permission === "string", `${t.name} permission key`);
    }

    // ---- 2. Permission engine: allow rule short-circuits ---------------------
    const session = store.createHarnessSession({
      projectId: null,
      tier: "cloud-agent",
      activeProvider: "mock",
      activeModel: "mock-model",
    });
    const engine = new PermissionEngine({ store, projectRoot, globalConfigDir });

    const allow = engine.evaluate({
      permission: "shell_run",
      target: "git status",
      sessionId: session.sessionId,
    });
    assert.equal(allow.action, "allow", `git status should match allow rule, got ${allow.action}`);
    assert.match(allow.reason, /allow rule.*git \*/);

    // ---- 3. Permission engine: deny rule blocks ------------------------------
    const deny = engine.evaluate({
      permission: "file_write",
      target: "secrets/db.json",
      sessionId: session.sessionId,
    });
    assert.equal(deny.action, "deny");
    assert.match(deny.reason, /deny rule/);

    const denySpecific = engine.evaluate({
      permission: "file_write",
      target: "docs/private/plan.md",
      sessionId: session.sessionId,
    });
    assert.equal(denySpecific.action, "deny");
    assert.match(
      denySpecific.reason,
      /docs\/private\/\*\*/,
      "project-scope specific rule should beat broader global rule",
    );

    // ---- 4. Permission engine: ask is the default ----------------------------
    const ask = engine.evaluate({
      permission: "file_edit",
      target: "README.md",
      sessionId: session.sessionId,
    });
    assert.equal(ask.action, "ask", `unmatched permission should default to ask`);

    // ---- 5. Persisted decision: session-scope allow is remembered -----------
    engine.rememberDecision({
      sessionId: session.sessionId,
      permission: "file_edit",
      pattern: "README.md",
      action: "allow",
      scope: "session",
    });
    const remembered = engine.evaluate({
      permission: "file_edit",
      target: "README.md",
      sessionId: session.sessionId,
    });
    assert.equal(remembered.action, "allow");
    assert.equal(remembered.fromPersistedDecision, true);

    engine.rememberDecision({
      sessionId: session.sessionId,
      permission: "file_edit",
      pattern: "docs/guide.md",
      action: "allow",
      scope: "project",
    });
    engine.rememberDecision({
      sessionId: session.sessionId,
      permission: "shell_run",
      pattern: "npm test",
      action: "allow",
      scope: "global",
    });
    const reloadedEngine = new PermissionEngine({ store, projectRoot, globalConfigDir });
    const projectRemembered = reloadedEngine.evaluate({
      permission: "file_edit",
      target: "docs/guide.md",
      sessionId: "fresh-session",
    });
    assert.equal(projectRemembered.action, "allow");
    assert.match(projectRemembered.reason, /allow rule/);
    const globalRemembered = reloadedEngine.evaluate({
      permission: "shell_run",
      target: "npm test",
      sessionId: "fresh-session",
    });
    assert.equal(globalRemembered.action, "allow");
    assert.match(globalRemembered.reason, /allow rule/);

    // ---- 6. file_edit applies; snapshot is captured; undo restores ----------
    const ctx = { projectRoot, sessionId: session.sessionId, messageOrdinal: 0 };
    const editResult = await fileEditTool.apply(
      { path: "README.md", oldString: "Hello world.", newString: "Hello, mako." },
      ctx,
    );
    assert.equal(editResult.ok, true);
    assert.ok(editResult.snapshotId, "snapshot id should be set");
    const afterEdit = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    assert.match(afterEdit, /Hello, mako\./);

    const undoStats = applyUndo(projectRoot, session.sessionId, 0);
    assert.equal(undoStats.filesRestored, 1, "expected 1 file restored");
    const afterUndo = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    assert.match(afterUndo, /Hello world\./, "undo should restore original content");

    // ---- 7. file_write to a new file → tombstone snapshot, undo deletes ----
    const writeResult = await fileWriteTool.apply(
      { path: "NEWFILE.md", content: "freshly written\n" },
      { ...ctx, messageOrdinal: 1 },
    );
    assert.equal(writeResult.ok, true);
    assert.ok(existsSync(path.join(projectRoot, "NEWFILE.md")));
    const undoNew = applyUndo(projectRoot, session.sessionId, 1);
    assert.equal(undoNew.filesDeleted, 1, "tombstone undo should delete created file");
    assert.equal(existsSync(path.join(projectRoot, "NEWFILE.md")), false);

    // ---- 8. Path guard: write outside project root rejected ----------------
    let pathError: unknown;
    try {
      await fileWriteTool.apply(
        { path: "../OUT_OF_BOUNDS.md", content: "no" },
        { ...ctx, messageOrdinal: 2 },
      );
    } catch (e) {
      pathError = e;
    }
    assert.ok(pathError, "expected path-guard rejection");
    assert.match(
      String((pathError as Error).message),
      /outside the active project root/,
    );

    // ---- 9. Path guard: .env* default-deny ---------------------------------
    let envError: unknown;
    try {
      await fileWriteTool.apply(
        { path: ".env.local", content: "SECRET=x" },
        { ...ctx, messageOrdinal: 3 },
      );
    } catch (e) {
      envError = e;
    }
    assert.ok(envError, "expected default-deny rejection for .env.local");

    // ---- 10. shell_run guard: metacharacter rejection -----------------------
    let shellMeta: unknown;
    try {
      shellRunTool.dryRun({ command: "ls; rm -rf /", args: [] }, ctx);
    } catch (e) {
      shellMeta = e;
    }
    assert.ok(shellMeta, "expected shell metacharacter rejection");
    assert.match(String((shellMeta as Error).message), /metacharacters/);

    // ---- 11. shell_run guard: cwd outside project root rejected -------------
    let shellCwd: unknown;
    try {
      shellRunTool.dryRun(
        { command: "node", args: ["-v"], cwd: "../.." },
        ctx,
      );
    } catch (e) {
      shellCwd = e;
    }
    assert.ok(shellCwd, "expected cwd-outside-project rejection");

    // ---- 12. shell_run guard: env not allowlisted --------------------------
    let envAllowlist: unknown;
    try {
      await shellRunTool.apply(
        {
          command: "node",
          args: ["-e", "process.exit(0)"],
          env: { TOTALLY_RANDOM_VAR: "x" },
        },
        ctx,
      );
    } catch (e) {
      envAllowlist = e;
    }
    assert.ok(envAllowlist, "expected env-allowlist rejection");
    assert.match(
      String((envAllowlist as Error).message),
      /allowlist/,
    );

    // ---- 13. Approval-flow round-trip via Harness.resolvePermissionRequest --
    const harness = createHarness({
      store,
      projectRoot,
      permissionEngine: engine,
    });
    const approvalSession = await harness.createSession({
      projectId: undefined,
      tier: "cloud-agent",
      provider: "mock",
      model: "mock-model",
    });

    // Drive a single tool through the dispatch directly so we exercise
    // the same pause/resume code path the agent loop uses.
    const dispatch = new ToolDispatch({
      store,
      bus: harness.bus,
      engine: harness.permissionEngine,
      projectId: null,
      context: { projectRoot, sessionId: approvalSession.id, messageOrdinal: 99 },
      persistToolPart: () => undefined,
    });
    const file_edit = dispatch.tools.file_edit!;
    const turnPromise = (
      file_edit.execute as (
        a: { path: string; oldString: string; newString: string },
      ) => Promise<unknown>
    )({ path: "README.md", oldString: "Hello world.", newString: "Approved!" });
    // Wait for the request to register
    await new Promise((r) => setTimeout(r, 50));
    const pending = harness.listPendingApprovals(approvalSession.id);
    assert.equal(pending.length, 1, "expected one pending approval");
    const ok = harness.resolvePermissionRequest(
      approvalSession.id,
      pending[0]!.requestId,
      { action: "allow", scope: "turn" },
    );
    assert.equal(ok, true);
    await turnPromise;
    const afterApproved = readFileSync(path.join(projectRoot, "README.md"), "utf8");
    assert.match(afterApproved, /Approved!/);

    // ---- 14. Approval-flow deny path ---------------------------------------
    const denySession = await harness.createSession({
      projectId: undefined,
      tier: "cloud-agent",
      provider: "mock",
      model: "mock-model",
    });
    const denyDispatch = new ToolDispatch({
      store,
      bus: harness.bus,
      engine: harness.permissionEngine,
      projectId: null,
      context: { projectRoot, sessionId: denySession.id, messageOrdinal: 99 },
      persistToolPart: () => undefined,
    });
    const file_write = denyDispatch.tools.file_write!;
    const denyTurn = (
      file_write.execute as (a: { path: string; content: string }) => Promise<unknown>
    )({ path: "OTHER.md", content: "no" });
    await new Promise((r) => setTimeout(r, 50));
    const denyPending = harness.listPendingApprovals(denySession.id);
    assert.equal(denyPending.length, 1);
    harness.resolvePermissionRequest(
      denySession.id,
      denyPending[0]!.requestId,
      { action: "deny", scope: "turn" },
    );
    let denyCaught: unknown;
    try {
      await denyTurn;
    } catch (e) {
      denyCaught = e;
    }
    assert.ok(denyCaught instanceof PermissionDeniedError, "expected PermissionDeniedError");

    console.log("harness-action-tools: PASS");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
