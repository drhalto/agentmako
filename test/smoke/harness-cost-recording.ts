/**
 * Phase 3.9 smoke: provider-call cost is computed at write time against the
 * active catalog and persists on the `harness_provider_calls` row, and
 * caller_kind is honored through the write path.
 *
 * Sidesteps live providers entirely — we insert a row directly via the
 * store's `insertHarnessProviderCall` API (the same API the harness calls)
 * and verify the cost math, then confirm `computeCallCostMicro` against a
 * known rate sheet.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  computeCallCostMicro,
  lookupModelCost,
} from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";
import {
  parsedCatalogFromProviders,
  type ParsedCatalog,
} from "../../packages/harness-contracts/src/index.ts";

function makeTestCatalog(): ParsedCatalog {
  return {
    source: "bundled",
    fetchedAt: null,
    providers: [
      {
        id: "anthropic",
        name: "Anthropic",
        kind: "chat",
        transport: "anthropic",
        auth: "api-key",
        tier: "cloud",
        envVarHints: [],
        models: [
          {
            id: "claude-sonnet-4-6",
            displayName: "Claude Sonnet 4.6",
            contextWindow: 200000,
            supportsTools: true,
            supportsVision: true,
            supportsReasoning: true,
            costHint: { input: 3, output: 15 },
            tier: "cloud",
          },
        ],
      },
    ],
    rates: {
      "anthropic/claude-sonnet-4-6": {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
    },
  };
}

async function main(): Promise<void> {
  const catalog = makeTestCatalog();

  // Unit: cost lookup + compute — known rates should produce a stable micro-USD.
  const rates = lookupModelCost(catalog, "anthropic", "claude-sonnet-4-6");
  assert.ok(rates, "rates should resolve for known model");
  const cost = computeCallCostMicro(
    {
      promptTokens: 3_000_000,
      completionTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    },
    rates,
  );
  // Prompt tokens are the full canonical prompt total. Cache-read/write
  // tokens reprice subsets of that total instead of stacking on top.
  // 1M uncached input × $3 = $3; 1M output × $15 = $15; 1M cacheRead ×
  // $0.30 = $0.30; 1M cacheWrite × $3.75 = $3.75; total $22.05 =
  // 22_050_000 micro.
  assert.equal(cost, 22_050_000, `expected 22_050_000 micro-USD, got ${cost}`);

  // Unit: unknown model → rates is null → cost is null.
  assert.equal(lookupModelCost(catalog, "openai", "gpt-4o"), null);
  assert.equal(computeCallCostMicro({ promptTokens: 1000 }, null), null);

  // Unit: known rates + zero tokens → null (nothing to charge for).
  assert.equal(computeCallCostMicro({ promptTokens: 0, completionTokens: 0 }, rates), null);

  // Integration: write two rows with different caller_kind values, read them
  // back, and verify both the kind tag and the cost columns persist.
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-cost-"));
  let store: ReturnType<typeof openProjectStore> | undefined;
  try {
    store = openProjectStore({ projectRoot: tmp, stateDirName: ".mako-ai-cost-smoke" });

    // Need a session row for the FK. Use the harness store directly.
    const session = store.createHarnessSession({
      tier: "cloud-agent",
      title: "cost-smoke",
      activeProvider: "anthropic",
      activeModel: "claude-sonnet-4-6",
    });

    store.insertHarnessProviderCall({
      sessionId: session.sessionId,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 1000,
      completionTokens: 500,
      reasoningTokens: 200,
      cacheReadTokens: 100,
      cacheWriteTokens: 50,
      latencyMs: 1200,
      costUsdMicro: 15_000,
      callerKind: "chat",
      ok: true,
    });

    store.insertHarnessProviderCall({
      sessionId: session.sessionId,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 800,
      completionTokens: 400,
      latencyMs: 900,
      costUsdMicro: 9_000,
      callerKind: "agent",
      ok: true,
    });

    const rows = store.listHarnessProviderCalls(session.sessionId);
    assert.equal(rows.length, 2, "both inserted rows should read back");

    const chatRow = rows.find((r) => r.callerKind === "chat");
    const agentRow = rows.find((r) => r.callerKind === "agent");
    assert.ok(chatRow, "chat-kind row should read back");
    assert.ok(agentRow, "agent-kind row should read back");
    assert.equal(chatRow!.costUsdMicro, 15_000);
    assert.equal(agentRow!.costUsdMicro, 9_000);
    assert.equal(chatRow!.reasoningTokens, 200);
    assert.equal(chatRow!.cacheReadTokens, 100);
    assert.equal(chatRow!.cacheWriteTokens, 50);
    assert.equal(agentRow!.reasoningTokens, null);

    // Sum for usage rollup — listHarnessProviderCallsForUsage is what the
    // server uses. Both rows should appear; errors are excluded.
    const usageRows = store.listHarnessProviderCallsForUsage({});
    assert.equal(usageRows.length, 2);
  } finally {
    store?.close();
    rmSync(tmp, { recursive: true, force: true });
  }

  // parsedCatalogFromProviders round-trip sanity check — rates lifted from costHint.
  const round = parsedCatalogFromProviders(catalog.providers, "bundled", null);
  assert.ok(round.rates["anthropic/claude-sonnet-4-6"], "rates lift from costHint");

  console.log("harness-cost-recording: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
