/**
 * Phase 3.4 smoke — compaction (live provider required).
 *
 * Drives a session past the default `contextWindow * 0.6` threshold by
 * seeding many long turns in the store, then calls `maybeCompact` directly.
 * Requires a reachable provider (default: local Ollama) so the
 * summarization call can complete.
 *
 * Run manually:
 *
 *     corepack pnpm run test:smoke:compaction
 *
 * Skips cleanly when no provider is reachable. Not in the CI chain.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createHarness,
  maybeCompact,
  DEFAULT_COMPACTION_THRESHOLD,
} from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

async function probeOllamaChatModel(): Promise<string | null> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const models = (data.models ?? [])
      .map((m) => m.name ?? "")
      .filter((n) => n.length > 0);
    // Prefer an explicit override; fall back to the first loaded chat-capable
    // model (embedding-only names contain "embed").
    const override = process.env.MAKO_CHAT_MODEL;
    if (override && models.some((m) => m.startsWith(override))) return override;
    const chatModel = models.find((m) => !m.includes("embed"));
    return chatModel ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const pulled = await probeOllamaChatModel();
  if (!pulled) {
    console.log(
      `harness-compaction: SKIP (Ollama not reachable at ${OLLAMA_URL} or no chat model loaded — pull one with \`ollama pull llama3.2\` or set MAKO_CHAT_MODEL)`,
    );
    return;
  }

  // The bundled catalog gates `createLanguageModel` via `assertModelDeclared`.
  // Match the pulled model against catalog entries; skip the test if no
  // catalog-declared chat model is available locally.
  const { BUNDLED_CATALOG } = await import("../../packages/harness-contracts/src/index.ts");
  const ollamaSpec = BUNDLED_CATALOG.providers.find((p) => p.id === "ollama");
  const CHAT_MODEL =
    ollamaSpec?.models
      .filter((m) => m.supportsTools) // "embed" models are supportsTools=false
      .find((m) => pulled.startsWith(m.id))?.id ?? null;
  if (!CHAT_MODEL) {
    console.log(
      `harness-compaction: SKIP (pulled model \`${pulled}\` is not declared in the bundled catalog's \`ollama\` entry; add it to packages/harness-contracts/models/catalog.json or pull one that is)`,
    );
    return;
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-compaction-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-compaction-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  const store = openProjectStore({ projectRoot, stateDirName });
  try {
    const harness = createHarness({ store, projectRoot });

    const session = await harness.createSession({
      tier: "local-agent",
      title: "compaction smoke",
      provider: "ollama",
      model: CHAT_MODEL,
    });

    // Seed the session with long alternating user/assistant turns so we
    // cross the (synthetic) threshold. Each turn is ~800 chars → ~200
    // tokens. We also configure an abnormally small contextWindow below
    // by passing it through the threshold helper directly.
    const filler = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(20);
    for (let i = 0; i < 8; i++) {
      const user = store.insertHarnessMessage({
        sessionId: session.id,
        role: "user",
      });
      store.insertHarnessMessagePart({
        messageId: user.messageId,
        kind: "text",
        payload: { text: `Q${i}: ${filler}` },
      });
      const assistant = store.insertHarnessMessage({
        sessionId: session.id,
        role: "assistant",
      });
      store.insertHarnessMessagePart({
        messageId: assistant.messageId,
        kind: "text",
        payload: { text: `A${i}: ${filler}` },
      });
    }

    const before = store.listHarnessMessages(session.id, { includeArchived: false });
    assert.equal(before.length, 16, "16 un-archived messages seeded");

    // Force a low threshold by scaling down — we can't easily override
    // the model's contextWindow from here, but the default `llama3.1`
    // contextWindow is 128000; our synthetic transcript is tiny against
    // that. Use the compaction threshold arg to force a trip.
    const result = await maybeCompact({
      sessionId: session.id,
      store,
      bus: harness.bus,
      providerRegistry: harness.providerRegistry,
      threshold: 0.0001, // force trigger
    });

    assert.equal(
      result.ranCompaction,
      true,
      `compaction should have run; reason=${result.reason ?? ""}`,
    );
    assert.ok(result.archivedCount && result.archivedCount > 0, "archived some messages");
    assert.ok(result.summaryMessageId, "summary message inserted");

    const after = store.listHarnessMessages(session.id, { includeArchived: false });
    // The archived rows drop out of the un-archived list, but the synthetic
    // summary system message is now in place.
    assert.ok(
      after.length < before.length,
      `un-archived count decreased ${before.length} → ${after.length}`,
    );
    const hasSummary = after.some((m) => m.role === "system");
    assert.ok(hasSummary, "synthetic summary message is visible");

    console.log(
      `harness-compaction: PASS (archived=${result.archivedCount}, threshold used=${DEFAULT_COMPACTION_THRESHOLD} default; test forced lower)`,
    );
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
