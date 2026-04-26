/**
 * Phase 3.0 acceptance smoke test.
 *
 * Boots the harness directly against the mako-ai repo (attached as its own
 * scratch project), creates a session, posts a user message, and asserts
 * that the no-agent tier routes through the deterministic `ask` tool and
 * emits the expected event sequence:
 *
 *   session.created → message.created (user) → message.created (assistant)
 *   → text.delta → turn.done
 *
 * The test does not start the HTTP server — it exercises `packages/harness-core`
 * directly. Transport is validated by the separate CLI + HTTP path; this
 * file proves the core contract.
 */

import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiService } from "../../services/api/src/service.ts";
import { createHarness } from "../../packages/harness-core/src/index.ts";
import type { EmittedSessionEvent } from "../../packages/harness-core/src/event-bus.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";
import { cleanupSmokeStateDir } from "./state-cleanup.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.MAKO_STATE_HOME = os.tmpdir();
const stateDirName = `.mako-ai-harness-no-agent-${Date.now()}-${process.pid}`;
const homeStateDir = path.join(os.tmpdir(), stateDirName);
const projectStateDir = path.join(repoRoot, stateDirName);
const repoManifestDir = path.join(repoRoot, ".mako");
const repoManifestExisted = existsSync(repoManifestDir);

function cleanup(): void {
  cleanupSmokeStateDir(homeStateDir);
  cleanupSmokeStateDir(projectStateDir);
  if (!repoManifestExisted) {
    rmSync(repoManifestDir, { recursive: true, force: true });
  }
}

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
  throw new Error("timed out waiting for turn.done event");
}

async function main(): Promise<void> {
  cleanup();
  const options = {
    configOverrides: {
      stateDirName,
      databaseTools: { enabled: false },
    },
  };
  const api = createApiService(options);
  let store: ReturnType<typeof openProjectStore> | undefined;

  try {
    api.attachProject(repoRoot);
    await api.indexProject(repoRoot);
    const status = api.getProjectStatus(repoRoot);
    assert.ok(status?.project, "expected attached project for harness smoke");

    store = openProjectStore({ projectRoot: repoRoot, stateDirName });
    const harness = createHarness({
      store,
      toolOptions: {
        configOverrides: options.configOverrides,
      },
    });

    // ---- createSession ------------------------------------------------------
    const session = await harness.createSession({
      projectId: status.project.projectId,
      tier: "no-agent",
    });
    assert.ok(session.id, "session id");
    assert.equal(session.tier, "no-agent");
    assert.equal(session.status, "active");

    // ---- subscribe + postMessage -------------------------------------------
    const collected: EmittedSessionEvent[] = [];
    const unsubscribe = harness.bus.subscribe(session.id, (ev) => {
      collected.push(ev);
    });

    const postResult = harness.postMessage(
      session.id,
      "what files are in this project?",
    );
    assert.equal(postResult.started, true);
    assert.ok(postResult.messageId);

    await waitForTurnDone(collected);
    unsubscribe();

    // ---- assertions --------------------------------------------------------
    // Events collected live during postMessage should include message.created,
    // text.delta, and turn.done. The session.created event fires inline during
    // createSession() and is therefore inspected via replay below.
    const liveKinds = collected.map((e) => e.event.kind);
    assert.ok(
      liveKinds.filter((k) => k === "message.created").length >= 2,
      `expected at least two message.created events (user + assistant), got ${liveKinds.join(",")}`,
    );
    assert.ok(liveKinds.includes("text.delta"), "expected text.delta from assistant");
    assert.ok(liveKinds.includes("turn.done"), "expected turn.done");

    const persistedKinds = harness.replayEvents(session.id).map((e) => e.event.kind);
    assert.ok(
      persistedKinds.includes("session.created"),
      `expected session.created in replay, got ${persistedKinds.join(",")}`,
    );

    const textDelta = collected.find((e) => e.event.kind === "text.delta");
    assert.ok(
      textDelta && typeof (textDelta.event as { text?: string }).text === "string",
      "text.delta should carry a string",
    );
    assert.ok(
      (textDelta!.event as { text: string }).text.length > 0,
      "text.delta should not be empty",
    );

    // ---- replay check: events are persisted -------------------------------
    const replayed = harness.replayEvents(session.id);
    assert.ok(replayed.length >= collected.length, "events should persist for replay");

    // ---- listSessions + getSession -----------------------------------------
    const listed = harness.listSessions({ projectId: status.project.projectId });
    assert.ok(
      listed.some((s) => s.id === session.id),
      "listSessions should include the created session",
    );
    const fetched = harness.getSession(session.id);
    assert.equal(fetched?.id, session.id);
    assert.equal(
      fetched?.title,
      "what files are in this project",
      "first user message should auto-title untitled sessions",
    );

    // ---- messages accessor -------------------------------------------------
    const { messages } = harness.listMessages(session.id);
    assert.ok(messages.length >= 2, "expected user + assistant messages");
    const assistantMessage = messages.find((m) => m.role === "assistant");
    assert.ok(assistantMessage, "assistant message recorded");
    assert.ok(
      assistantMessage.parts.some((p) => p.kind === "text"),
      "assistant text part recorded",
    );

    console.log("harness-no-agent: PASS");
  } finally {
    store?.close();
    api.close();
    cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
