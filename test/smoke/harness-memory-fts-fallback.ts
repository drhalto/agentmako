/**
 * Phase 3.3 acceptance smoke — FTS-only fallback.
 *
 * Proves that `memory_recall` returns useful results with no embedding
 * provider configured. The test:
 *
 *   1. Opens a fresh project store.
 *   2. Writes three memories with distinct text.
 *   3. Calls `recallMemories(...)` with `embeddingProvider: null`.
 *   4. Asserts `mode === "fts-fallback"`, a structured `reason`, and that
 *      the query matches the expected row via FTS5.
 *
 * This is the baseline test — it never touches the network and runs in CI.
 * The Ollama and LM Studio tests are separate files that skip when their
 * local endpoint is unreachable.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recallMemories } from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-memory-fts-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-memory-fts-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  const store = openProjectStore({ projectRoot, stateDirName });
  try {
    const m1 = store.insertHarnessMemory({
      text: "This project uses pgvector for audit log similarity search.",
      category: "architecture",
      tags: ["postgres", "audit"],
    });
    store.insertHarnessMemory({
      text: "Rate limits are enforced per-tenant via a leaky bucket.",
      category: "rate-limits",
    });
    store.insertHarnessMemory({
      text: "The CLI lives in apps/cli and dispatches to commands/*.ts.",
      category: "layout",
      tags: ["cli"],
    });

    // 1. No embedding provider → FTS-only, with clear reason.
    const result = await recallMemories({
      store,
      query: "audit pgvector",
      embeddingProvider: null,
      k: 5,
    });
    assert.equal(result.mode, "fts-fallback", "mode should be fts-fallback");
    assert.ok(result.reason, "reason should be populated");
    assert.ok(result.results.length > 0, "FTS should return at least one hit");
    const top = result.results[0]!;
    assert.equal(
      top.memoryId,
      m1.memoryId,
      `top hit should be the pgvector memory; got ${top.memoryId}`,
    );
    assert.equal(top.vectorScore, null, "fts-fallback hits should have null vectorScore");
    assert.ok(
      typeof top.ftsRank === "number" && top.ftsRank >= 1,
      "ftsRank should be a positive integer",
    );

    // 2. Empty / punctuation-only query should not throw.
    const empty = await recallMemories({
      store,
      query: "???",
      embeddingProvider: null,
      k: 5,
    });
    assert.equal(empty.mode, "fts-fallback");
    // Tokens are all non-word chars → sanitizer produces the sentinel → zero hits.
    assert.equal(empty.results.length, 0, "punctuation-only query returns zero results");

    // 3. listHarnessMemories with filters works.
    const archOnly = store.listHarnessMemories({ category: "architecture" });
    assert.equal(archOnly.length, 1);
    const tagged = store.listHarnessMemories({ tag: "cli" });
    assert.equal(tagged.length, 1);

    console.log("harness-memory-fts-fallback: PASS");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
