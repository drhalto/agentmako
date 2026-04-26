/**
 * Phase 3.9 smoke: catalog-source four-tier fallback.
 *
 * Exercises the composer in isolation by injecting each tier's availability
 * through the `createCatalogSource` options so we can assert that the
 * fallback chain resolves in the right order.
 *
 *   1. cache present + fresh → returns "cache"
 *   2. cache stale + fetch ok → returns "fresh" and writes back into cache
 *   3. cache stale + fetch fails + snapshot present → returns "snapshot"
 *   4. all gone → returns "bundled" (always succeeds)
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createCatalogSource,
  loadBundledCatalog,
} from "../../packages/harness-core/src/index.ts";

const SAMPLE_PAYLOAD = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    env: ["ANTHROPIC_API_KEY"],
    models: {
      "claude-sonnet-4-6": {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        attachment: true,
        reasoning: true,
        tool_call: true,
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        limit: { context: 200000, output: 8192 },
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  },
  "ollama-cloud": {
    id: "ollama-cloud",
    name: "Ollama Cloud",
    api: "https://ollama.com/v1",
    env: ["OLLAMA_CLOUD_API_KEY"],
    models: {
      "kimi-k2.5": {
        id: "kimi-k2.5",
        name: "Kimi K2.5",
        attachment: true,
        reasoning: true,
        tool_call: true,
        limit: { context: 256000, output: 8192 },
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    },
  },
};

function mockFetch(ok: boolean, payload?: unknown): typeof fetch {
  return async () => {
    if (!ok) throw new Error("mock-fetch-failed");
    return new Response(JSON.stringify(payload ?? SAMPLE_PAYLOAD), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function main(): Promise<void> {
  const bundled = loadBundledCatalog();
  assert.equal(bundled.source, "bundled");
  assert.ok(bundled.providers.length > 0, "bundled catalog should carry shipped providers");

  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-catalog-source-"));
  try {
    const cachePath = path.join(tmp, "cache", "models-dev.json");
    const snapshotPath = path.join(tmp, "snapshot.json");

    // Case 4: all gone → bundled.
    {
      const source = createCatalogSource({
        disableFetch: true,
        cachePath,
        snapshotPath: null,
        fetchImpl: mockFetch(false),
      });
      const catalog = await source.resolve();
      assert.equal(catalog.source, "bundled", "no sources → bundled floor");
      assert.ok(catalog.providers.length > 0);
    }

    // Case 3: snapshot file present, fetch disabled, no cache → "snapshot".
    {
      mkdirSync(path.dirname(snapshotPath), { recursive: true });
      writeFileSync(
        snapshotPath,
        JSON.stringify({
          __fetchedAt: "2026-04-10T00:00:00.000Z",
          payload: SAMPLE_PAYLOAD,
        }),
      );
      const source = createCatalogSource({
        disableFetch: true,
        cachePath,
        snapshotPath,
      });
      const catalog = await source.resolve();
      assert.equal(catalog.source, "snapshot", "snapshot answers when cache missing + fetch disabled");
      assert.ok(catalog.providers.some((p) => p.id === "anthropic"));
      const ollamaCloud = catalog.providers.find((p) => p.id === "ollama-cloud");
      assert.ok(ollamaCloud, "snapshot should include ollama-cloud");
      assert.ok(
        ollamaCloud.models.some((m) => m.id === "kimi-k2.5:cloud"),
        "ollama-cloud ids should normalize to runnable :cloud ids",
      );
      const key = "anthropic/claude-sonnet-4-6";
      assert.ok(catalog.rates[key], "rates carried through from snapshot");
      assert.equal(catalog.rates[key]?.input, 3);
    }

    // Case 2: fetch ok, cache empty → "fresh" and cache gets written.
    {
      rmSync(cachePath, { force: true });
      const source = createCatalogSource({
        disableFetch: false,
        cachePath,
        snapshotPath,
        fetchImpl: mockFetch(true),
      });
      const catalog = await source.resolve();
      assert.equal(catalog.source, "fresh", "fresh fetch on empty cache");

      // After a successful fresh fetch, the cache file exists and the next
      // resolve() should return "cache" (Case 1).
      const next = await source.resolve();
      assert.equal(next.source, "cache", "cache answers on the next resolve within TTL");
    }

    // Case: status endpoint reports the active source.
    {
      const source = createCatalogSource({
        disableFetch: true,
        cachePath,
        snapshotPath,
      });
      const status = await source.status();
      assert.ok(status.modelCount > 0);
      assert.ok(status.providerCount > 0);
      assert.ok(
        ["cache", "snapshot", "bundled"].includes(status.source),
        `status.source should be one of the offline tiers (got ${status.source})`,
      );
    }

    // Case: refresh with failing fetch falls back to snapshot (not error).
    {
      rmSync(cachePath, { force: true });
      const source = createCatalogSource({
        disableFetch: false,
        cachePath,
        snapshotPath,
        fetchImpl: mockFetch(false),
      });
      const catalog = await source.refresh();
      assert.equal(catalog.source, "snapshot", "refresh should fall back to snapshot when fetch fails");
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log("harness-catalog-source: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
