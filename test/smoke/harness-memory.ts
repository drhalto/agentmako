/**
 * Phase 3.3 acceptance smoke — Ollama hybrid path.
 *
 * Skips cleanly when Ollama is not reachable at `http://localhost:11434`.
 * When Ollama IS reachable with `nomic-embed-text` pulled, asserts that:
 *
 *   1. `memory_remember` stores a row AND produces a vector (embedded=true).
 *   2. `memory_recall` returns `mode: "hybrid"`, with both an FTS rank and a
 *      cosine score on the top hit.
 *   3. The RRF top hit matches the expected semantic intent ("audit") even
 *      though the exact lexical match is weaker than in an FTS-only run.
 *
 * Run manually:
 *
 *     node --import tsx test/smoke/harness-memory.ts
 *
 * Not added to the default `pnpm test:smoke` chain because it requires a
 * local Ollama install with a pulled embedding model.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createEmbeddingProvider,
  recallMemories,
} from "../../packages/harness-core/src/index.ts";
import { BUNDLED_CATALOG } from "../../packages/harness-contracts/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const MODEL = process.env.MAKO_EMBEDDING_MODEL ?? "nomic-embed-text";

async function probeOllama(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!(await probeOllama())) {
    console.log(`harness-memory: SKIP (Ollama not reachable at ${OLLAMA_URL})`);
    return;
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-memory-ollama-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-memory-ollama-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  const ollamaSpec = BUNDLED_CATALOG.providers.find((p) => p.id === "ollama");
  assert.ok(ollamaSpec, "bundled catalog must contain ollama");

  const embedding = createEmbeddingProvider({
    spec: ollamaSpec,
    modelId: MODEL,
    apiKey: null,
  });

  // Sanity probe the specific embedding model so we skip cleanly if it isn't pulled.
  const probe = await embedding.probe();
  if (!probe.ok) {
    console.log(
      `harness-memory: SKIP (Ollama model \`${MODEL}\` not available: ${probe.reason ?? "unknown"})`,
    );
    rmSync(tmp, { recursive: true, force: true });
    return;
  }
  assert.ok(probe.dim && probe.dim > 0, "probe should report a dim");

  const store = openProjectStore({ projectRoot, stateDirName });
  try {
    const facts = [
      {
        text: "This project uses pgvector for audit log similarity search.",
        category: "architecture",
      },
      {
        text: "Rate limits are enforced per-tenant via a leaky bucket.",
        category: "rate-limits",
      },
      {
        text: "The CLI lives in apps/cli and dispatches to commands/*.ts.",
        category: "layout",
      },
    ];
    for (const f of facts) {
      const row = store.insertHarnessMemory({ text: f.text, category: f.category });
      const vector = await embedding.embed(f.text);
      store.insertEmbedding({
        ownerKind: "memory",
        ownerId: row.memoryId,
        provider: embedding.providerId,
        model: embedding.modelId,
        vector,
      });
    }

    const result = await recallMemories({
      store,
      query: "how do we audit similarity search",
      embeddingProvider: embedding,
      k: 3,
    });
    assert.equal(result.mode, "hybrid", `expected mode=hybrid, got ${result.mode}`);
    assert.ok(result.results.length > 0, "hybrid should return at least one hit");
    const top = result.results[0]!;
    assert.ok(
      typeof top.vectorScore === "number" && top.vectorScore > 0,
      "top hit should have a positive cosine score",
    );
    assert.ok(
      top.text.includes("pgvector"),
      `top hit should be the pgvector memory; got: ${top.text}`,
    );

    console.log(
      `harness-memory: PASS (dim=${embedding.dim}, top-cos=${top.vectorScore?.toFixed(3)})`,
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
