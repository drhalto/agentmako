/**
 * Phase 3.0.1 hotfix regression smoke.
 *
 * Locks in two bugs that shipped in Phase 3.0 and were caught by an
 * out-of-band review. Both have surface-level appeal as "looks fine"
 * but break under modest stress:
 *
 *   1. Append-only DELETE protection. Phase 3.0 shipped UPDATE triggers
 *      on the harness_* fact tables but no DELETE triggers, so a direct
 *      `DELETE FROM harness_session_events WHERE ...` was silently
 *      accepted. Migration 0009 added cascade-safe BEFORE DELETE triggers.
 *      This smoke asserts direct deletes fail AND that the legitimate
 *      `harness.deleteSession()` cascade still works.
 *
 *   2. Multi-turn SSE cursor. The CLI used to open a fresh `/stream`
 *      with no `?after` cursor on each turn, which caused the server
 *      to replay every prior event including past `turn.done` events.
 *      Turn 2 saw turn 1's `turn.done` first and exited early. The fix
 *      threads a `lastOrdinal` cursor through the chat loop; this smoke
 *      drives two turns over real HTTP+SSE and asserts turn 2 sees its
 *      own answer, not turn 1's.
 *
 * No real model is invoked. Both turns route through the no-agent tier's
 * deterministic `ask` adapter (Phase 3.0). The bug under test was in the
 * SSE replay semantics, not the provider layer.
 */

import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiService } from "../../services/api/src/service.ts";
import { startHarnessServer } from "../../services/harness/src/server.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";
import { cleanupSmokeStateDir } from "./state-cleanup.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.MAKO_STATE_HOME = os.tmpdir();
const stateDirName = `.mako-ai-hotfix-${Date.now()}-${process.pid}`;
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

interface SseEvent {
  kind: string;
  ordinal?: number;
  text?: string;
  [key: string]: unknown;
}

async function* streamEvents(
  baseURL: string,
  sessionId: string,
  afterOrdinal?: number,
): AsyncGenerator<SseEvent> {
  const query = afterOrdinal !== undefined ? `?after=${afterOrdinal}` : "";
  const response = await fetch(
    `${baseURL}/api/v1/sessions/${sessionId}/stream${query}`,
    { headers: { accept: "text/event-stream" } },
  );
  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf("\n\n");
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      try {
        // Envelope: { sessionId, ordinal, createdAt, event: { kind, ... } }.
        // Merge so downstream reads `.kind`, `.text`, AND `.ordinal` from
        // a single object (the ordinal is on the envelope, not the inner
        // event).
        const envelope = JSON.parse(dataLine.slice(6)) as {
          ordinal?: number;
          createdAt?: string;
          event?: SseEvent;
          kind?: string;
        };
        const inner = envelope.event ?? (envelope as SseEvent);
        if (inner && typeof inner.kind === "string") {
          yield {
            ...inner,
            ordinal: typeof envelope.ordinal === "number" ? envelope.ordinal : (inner as { ordinal?: number }).ordinal,
          } as SseEvent;
        }
      } catch {
        // ignore malformed frames
      }
    }
  }
}

async function postJson<T>(baseURL: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseURL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = JSON.parse(text) as { ok: boolean; data?: T; error?: { message: string } };
  if (!parsed.ok) {
    throw new Error(`POST ${path} failed: ${parsed.error?.message ?? response.status}`);
  }
  return parsed.data as T;
}

async function runTurn(
  baseURL: string,
  sessionId: string,
  content: string,
  afterOrdinal?: number,
): Promise<{ text: string; lastOrdinal: number; turnDone: boolean }> {
  await postJson<{ messageId: string }>(
    baseURL,
    `/api/v1/sessions/${sessionId}/messages`,
    { content },
  );
  let text = "";
  let lastOrdinal = afterOrdinal ?? -1;
  let turnDone = false;
  for await (const event of streamEvents(baseURL, sessionId, afterOrdinal)) {
    if (typeof event.ordinal === "number" && event.ordinal > lastOrdinal) {
      lastOrdinal = event.ordinal;
    }
    if (event.kind === "text.delta" && typeof event.text === "string") {
      text += event.text;
    } else if (event.kind === "turn.done") {
      turnDone = true;
      break;
    } else if (event.kind === "error") {
      break;
    }
  }
  return { text, lastOrdinal, turnDone };
}

async function main(): Promise<void> {
  cleanup();
  const options = {
    configOverrides: { stateDirName, databaseTools: { enabled: false } },
  };
  const api = createApiService(options);
  let store: ReturnType<typeof openProjectStore> | undefined;
  let server: Awaited<ReturnType<typeof startHarnessServer>> | undefined;

  try {
    api.attachProject(repoRoot);
    await api.indexProject(repoRoot);
    const status = api.getProjectStatus(repoRoot);
    assert.ok(status?.project, "expected attached project for hotfix smoke");

    // ------------------------------------------------------------------
    // PART A: Direct DELETE on append-only tables must FAIL.
    // ------------------------------------------------------------------
    store = openProjectStore({ projectRoot: repoRoot, stateDirName });
    const session = store.createHarnessSession({
      projectId: status.project.projectId,
      tier: "no-agent",
    });
    const message = store.insertHarnessMessage({ sessionId: session.sessionId, role: "user" });
    const part = store.insertHarnessMessagePart({
      messageId: message.messageId,
      kind: "text",
      payload: { text: "hi" },
    });
    const event = store.insertHarnessSessionEvent({
      sessionId: session.sessionId,
      kind: "test.event",
      payload: { hello: "world" },
    });
    store.insertHarnessProviderCall({
      sessionId: session.sessionId,
      provider: "p",
      model: "m",
      ok: true,
    });

    const expectFail = (label: string, fn: () => void): void => {
      let caught: unknown;
      try {
        fn();
      } catch (e) {
        caught = e;
      }
      assert.ok(
        caught instanceof Error && /append-only/i.test(caught.message),
        `expected ${label} to fail with append-only error; got ${String(caught)}`,
      );
    };

    expectFail("DELETE harness_message_parts", () =>
      store!.db.prepare("DELETE FROM harness_message_parts WHERE part_id = ?").run(part.partId),
    );
    expectFail("DELETE harness_session_events", () =>
      store!.db
        .prepare("DELETE FROM harness_session_events WHERE session_id = ? AND ordinal = ?")
        .run(event.sessionId, event.ordinal),
    );
    expectFail("DELETE harness_provider_calls", () =>
      store!.db
        .prepare("DELETE FROM harness_provider_calls WHERE session_id = ?")
        .run(session.sessionId),
    );
    expectFail("DELETE harness_messages", () =>
      store!.db
        .prepare("DELETE FROM harness_messages WHERE message_id = ?")
        .run(message.messageId),
    );

    // Cascade DELETE via parent must SUCCEED — the WHEN guard sees the
    // parent already gone and lets the cascade through.
    store.deleteHarnessSession(session.sessionId);
    const remaining = store.listHarnessSessions({});
    assert.equal(
      remaining.find((s) => s.sessionId === session.sessionId),
      undefined,
      "cascade delete via deleteHarnessSession should succeed",
    );

    // ------------------------------------------------------------------
    // PART B: Multi-turn over HTTP+SSE with cursor must NOT replay.
    // ------------------------------------------------------------------
    server = await startHarnessServer({
      projectRoot: repoRoot,
      stateDirName,
      toolOptions: { configOverrides: options.configOverrides },
      host: "127.0.0.1",
      port: 0, // ephemeral
    });
    const baseURL = `http://${server.host}:${server.port}`;

    const created = await postJson<{ session: { id: string } }>(baseURL, "/api/v1/sessions", {
      projectId: status.project.projectId,
      tier: "no-agent",
    });
    const sid = created.session.id;

    const turn1 = await runTurn(baseURL, sid, "what tools does this project have?");
    assert.equal(turn1.turnDone, true, "turn 1 should reach turn.done");
    assert.ok(turn1.text.length > 0, "turn 1 should have streamed text");
    assert.ok(turn1.lastOrdinal > 0, "turn 1 should have advanced the ordinal");

    const turn2 = await runTurn(
      baseURL,
      sid,
      "now what files exist?",
      turn1.lastOrdinal,
    );
    assert.equal(turn2.turnDone, true, "turn 2 should reach turn.done");
    assert.ok(turn2.text.length > 0, "turn 2 should have streamed text");
    assert.ok(
      turn2.lastOrdinal > turn1.lastOrdinal,
      `turn 2 ordinal (${turn2.lastOrdinal}) must exceed turn 1 ordinal (${turn1.lastOrdinal})`,
    );

    // Negative case: opening turn 2 stream WITHOUT the cursor (the old
    // broken behavior) would see turn 1's turn.done first and exit with
    // empty text. Confirm the regression is real if anyone reverts the fix.
    const broken = await (async (): Promise<{ text: string; firstTurnDoneOrdinal: number }> => {
      let txt = "";
      let firstDoneOrdinal = -1;
      for await (const event of streamEvents(baseURL, sid, undefined)) {
        if (event.kind === "text.delta" && typeof event.text === "string") txt += event.text;
        if (event.kind === "turn.done") {
          firstDoneOrdinal = typeof event.ordinal === "number" ? event.ordinal : -1;
          break;
        }
      }
      return { text: txt, firstTurnDoneOrdinal: firstDoneOrdinal };
    })();
    assert.ok(
      broken.firstTurnDoneOrdinal <= turn1.lastOrdinal,
      `cursorless replay surfaces an old turn.done first (got ordinal ${broken.firstTurnDoneOrdinal}); the cursor fix is what hides this`,
    );

    console.log("harness-immutability-and-multiturn: PASS");
  } finally {
    await server?.close();
    store?.close();
    api.close();
    cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
