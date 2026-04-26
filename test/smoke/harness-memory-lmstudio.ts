/**
 * Phase 3.3 acceptance smoke — LM Studio hybrid path.
 *
 * Skips cleanly when LM Studio is not reachable at `http://localhost:1234`.
 * When LM Studio IS reachable with an embedding model loaded (user-configurable
 * via `MAKO_EMBEDDING_MODEL`; defaults to `text-embedding-nomic-embed-text-v1.5`),
 * asserts the same hybrid-mode contract the Ollama test asserts.
 *
 * LM Studio exposes its embedding endpoint at `/v1/embeddings` in the pure
 * OpenAI wire format, so this path rides `@ai-sdk/openai-compatible`'s
 * `textEmbeddingModel(...)` adapter (no hand-rolled HTTP like Ollama needs).
 *
 * Run manually:
 *
 *     node --import tsx test/smoke/harness-memory-lmstudio.ts
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

const LMSTUDIO_URL = process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234";
const MODEL =
  process.env.MAKO_EMBEDDING_MODEL ?? "text-embedding-nomic-embed-text-v1.5";

async function probeLmStudio(): Promise<boolean> {
  try {
    const response = await fetch(`${LMSTUDIO_URL}/v1/models`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!(await probeLmStudio())) {
    console.log(`harness-memory-lmstudio: SKIP (LM Studio not reachable at ${LMSTUDIO_URL})`);
    return;
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-memory-lmstudio-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-memory-lmstudio-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  const lmSpec = BUNDLED_CATALOG.providers.find((p) => p.id === "lmstudio");
  assert.ok(lmSpec, "bundled catalog must contain lmstudio");

  const embedding = createEmbeddingProvider({
    spec: lmSpec,
    modelId: MODEL,
    apiKey: null,
  });

  const probe = await embedding.probe();
  if (!probe.ok) {
    console.log(
      `harness-memory-lmstudio: SKIP (LM Studio embedding model \`${MODEL}\` unavailable: ${probe.reason ?? "unknown"})`,
    );
    rmSync(tmp, { recursive: true, force: true });
    return;
  }
  assert.ok(probe.dim && probe.dim > 0, "probe should report a dim");

  const store = openProjectStore({ projectRoot, stateDirName });
  try {
    const facts = [
      {
        text: "Our observability stack ships OpenTelemetry traces to Honeycomb.",
        category: "observability",
      },
      {
        text: "The frontend is a Vite SPA with React 19 and Tailwind.",
        category: "frontend",
      },
      {
        text: "The billing webhook is signed with HMAC-SHA256 and timestamped.",
        category: "billing",
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
      query: "where do we send performance traces",
      embeddingProvider: embedding,
      k: 3,
    });
    assert.equal(result.mode, "hybrid", `expected mode=hybrid, got ${result.mode}`);
    assert.ok(result.results.length > 0, "hybrid should return at least one hit");
    const top = result.results[0]!;
    assert.ok(
      typeof top.vectorScore === "number",
      "top hit should carry a vectorScore",
    );
    assert.ok(
      top.text.includes("Honeycomb") || top.text.includes("OpenTelemetry"),
      `expected observability memory as top hit; got: ${top.text}`,
    );

    console.log(
      `harness-memory-lmstudio: PASS (dim=${embedding.dim}, top-cos=${top.vectorScore?.toFixed(3)})`,
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
