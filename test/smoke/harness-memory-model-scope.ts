/**
 * Phase 3.3 acceptance smoke — embedding-model scope guarantee.
 *
 * Proves that changing the active embedding model never surfaces vectors
 * produced under a prior model (dimension-mismatch safety by construction).
 *
 * The test does not need a real embedding provider — it writes synthetic
 * vectors of differing dimensions directly into the store. A faux provider
 * declares a `modelId` and returns a deterministic vector for its query;
 * `recallMemories` should ignore embeddings tagged with other models, even
 * when their dims happen to match.
 *
 * This is the pure-deterministic cousin of the Ollama / LM Studio tests,
 * and runs in CI without any local provider dependency.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recallMemories,
  type EmbeddingProbeResult,
  type EmbeddingProvider,
} from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

function fauxProvider(
  providerId: string,
  modelId: string,
  fixedVector: Float32Array,
): EmbeddingProvider {
  return {
    providerId,
    modelId,
    get dim(): number {
      return fixedVector.length;
    },
    async embed(): Promise<Float32Array> {
      return fixedVector;
    },
    async embedMany(texts: string[]): Promise<Float32Array[]> {
      return texts.map(() => fixedVector);
    },
    async probe(): Promise<EmbeddingProbeResult> {
      return { ok: true, dim: fixedVector.length };
    },
  };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-memory-scope-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-memory-scope-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  const store = openProjectStore({ projectRoot, stateDirName });
  try {
    // Write two memories under two different embedding models.
    const m1 = store.insertHarnessMemory({
      text: "Old model sentence about billing webhook signing.",
      category: "billing",
    });
    const m2 = store.insertHarnessMemory({
      text: "New model sentence about billing webhook signing.",
      category: "billing",
    });

    // Old model: 4-dim, aligned with queryVector.
    const oldVec = Float32Array.of(1, 0, 0, 0);
    store.insertEmbedding({
      ownerKind: "memory",
      ownerId: m1.memoryId,
      provider: "fake",
      model: "old-model-v1",
      vector: oldVec,
    });

    // New model: 4-dim, same shape. If scoping is broken, both would surface.
    const newVec = Float32Array.of(0, 1, 0, 0);
    store.insertEmbedding({
      ownerKind: "memory",
      ownerId: m2.memoryId,
      provider: "fake",
      model: "new-model-v1",
      vector: newVec,
    });

    // Active provider = new-model-v1, query vector matches newVec exactly.
    const newProvider = fauxProvider("fake", "new-model-v1", Float32Array.of(0, 1, 0, 0));
    const result = await recallMemories({
      store,
      query: "billing webhook",
      embeddingProvider: newProvider,
      k: 5,
    });
    assert.equal(result.mode, "hybrid", `expected mode=hybrid, got ${result.mode}`);
    // The top hit must be m2 (new-model embedding). m1's vector stays on disk
    // but must not contribute to the vector ranking.
    const topByVector = result.results.find((r) => r.vectorScore !== null);
    assert.ok(topByVector, "at least one hit should have a vector score");
    assert.equal(
      topByVector.memoryId,
      m2.memoryId,
      "only new-model vectors should contribute to the vector ranking",
    );

    // Counts confirm the old-model embedding is still on disk.
    const oldCount = store.countEmbeddingsForModel("memory", "old-model-v1");
    assert.equal(oldCount, 1, "old-model embedding must be preserved, not deleted");
    const newCount = store.countEmbeddingsForModel("memory", "new-model-v1");
    assert.equal(newCount, 1);

    // And switching back to the old model surfaces the old row instead.
    const oldProvider = fauxProvider("fake", "old-model-v1", Float32Array.of(1, 0, 0, 0));
    const swapped = await recallMemories({
      store,
      query: "billing webhook",
      embeddingProvider: oldProvider,
      k: 5,
    });
    const topSwapped = swapped.results.find((r) => r.vectorScore !== null);
    assert.ok(topSwapped);
    assert.equal(topSwapped.memoryId, m1.memoryId, "old-model query should now surface m1");

    // Dimension-mismatch safety: a vector with dim=3 must be skipped silently.
    const oddLengthMemory = store.insertHarnessMemory({ text: "Odd-dim memory." });
    store.insertEmbedding({
      ownerKind: "memory",
      ownerId: oddLengthMemory.memoryId,
      provider: "fake",
      model: "new-model-v1",
      vector: Float32Array.of(0.5, 0.5, 0.5),
    });
    const mismatched = await recallMemories({
      store,
      query: "odd-dim",
      embeddingProvider: newProvider,
      k: 5,
    });
    // The fauxProvider returns a 4-dim vector; the 3-dim row should be skipped,
    // not throw.
    assert.equal(mismatched.mode, "hybrid");

    // Project scoping must apply to vector hits as well as FTS hits.
    const scopedMemory = store.insertHarnessMemory({
      projectId: "project-a",
      text: "Scoped memory about alpha project setup.",
      category: "project-a",
    });
    const otherProjectMemory = store.insertHarnessMemory({
      projectId: "project-b",
      text: "Other project memory about secret audit token.",
      category: "project-b",
    });
    store.insertEmbedding({
      ownerKind: "memory",
      ownerId: scopedMemory.memoryId,
      provider: "fake",
      model: "new-model-v1",
      vector: Float32Array.of(0, 0, 1, 0),
    });
    store.insertEmbedding({
      ownerKind: "memory",
      ownerId: otherProjectMemory.memoryId,
      provider: "fake",
      model: "new-model-v1",
      vector: Float32Array.of(0, 1, 0, 0),
    });
    const scoped = await recallMemories({
      store,
      query: "secret audit token",
      embeddingProvider: newProvider,
      projectId: "project-a",
      k: 10,
    });
    assert.ok(
      scoped.results.some((hit) => hit.memoryId === scopedMemory.memoryId),
      "scoped project memory should remain searchable",
    );
    assert.ok(
      scoped.results.every((hit) => hit.memoryId !== otherProjectMemory.memoryId),
      "project-scoped recall must not surface vector hits from another project",
    );

    console.log("harness-memory-model-scope: PASS");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
