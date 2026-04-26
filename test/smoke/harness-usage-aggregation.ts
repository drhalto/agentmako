/**
 * Phase 3.9 smoke: usage rollup grouping.
 *
 * Seeds a set of `harness_provider_calls` rows with a mix of agent + chat
 * + multi-model entries and asserts that `aggregateUsage` produces the
 * correct rollup under each `group_by` mode.
 */

import assert from "node:assert/strict";
import { aggregateUsage } from "../../packages/harness-core/src/index.ts";
import type { HarnessProviderCallRecord } from "../../packages/store/src/index.ts";

function row(
  overrides: Partial<HarnessProviderCallRecord>,
): HarnessProviderCallRecord {
  return {
    callId: overrides.callId ?? "call-" + Math.random().toString(36).slice(2),
    sessionId: overrides.sessionId ?? null,
    provider: overrides.provider ?? "anthropic",
    model: overrides.model ?? "claude-sonnet-4-6",
    promptTokens: overrides.promptTokens ?? 1000,
    completionTokens: overrides.completionTokens ?? 500,
    reasoningTokens: overrides.reasoningTokens ?? null,
    cacheReadTokens: overrides.cacheReadTokens ?? null,
    cacheWriteTokens: overrides.cacheWriteTokens ?? null,
    latencyMs: overrides.latencyMs ?? 1000,
    costHint: overrides.costHint ?? null,
    costUsdMicro: overrides.costUsdMicro ?? 15_000,
    callerKind: overrides.callerKind ?? "chat",
    ok: overrides.ok ?? true,
    errorText: overrides.errorText ?? null,
    createdAt: overrides.createdAt ?? "2026-04-17T00:00:00.000Z",
  };
}

async function main(): Promise<void> {
  const rows: HarnessProviderCallRecord[] = [
    row({ provider: "anthropic", model: "claude-sonnet-4-6", callerKind: "chat", costUsdMicro: 10_000 }),
    row({ provider: "anthropic", model: "claude-sonnet-4-6", callerKind: "chat", costUsdMicro: 5_000 }),
    row({ provider: "anthropic", model: "claude-sonnet-4-6", callerKind: "agent", costUsdMicro: 20_000 }),
    row({ provider: "openai", model: "gpt-4o", callerKind: "chat", costUsdMicro: 3_000 }),
    row({ provider: "openai", model: "gpt-4o", callerKind: "agent", costUsdMicro: 2_000 }),
    row({ provider: "openai", model: "gpt-4o-mini", callerKind: "agent", costUsdMicro: 100 }),
  ];

  // group-by model+kind: one row per (model, kind) pair → 5 rows.
  const modelKind = aggregateUsage(rows, "model+kind");
  assert.equal(modelKind.length, 5, `model+kind: expected 5 rows, got ${modelKind.length}`);
  const sonnetChat = modelKind.find(
    (r) => r.providerId === "anthropic" && r.modelId === "claude-sonnet-4-6" && r.callerKind === "chat",
  );
  assert.ok(sonnetChat);
  assert.equal(sonnetChat!.calls, 2);
  assert.equal(sonnetChat!.costUsdMicro, 15_000);

  // group-by model: 3 distinct models, all kinds collapsed.
  const byModel = aggregateUsage(rows, "model");
  assert.equal(byModel.length, 3, "model: 3 distinct provider/model pairs");
  const sonnet = byModel.find((r) => r.modelId === "claude-sonnet-4-6");
  assert.ok(sonnet);
  assert.equal(sonnet!.calls, 3, "3 sonnet calls across chat + agent");
  assert.equal(sonnet!.costUsdMicro, 35_000);
  assert.equal(sonnet!.callerKind, null, "kind is null when grouping by model alone");

  // group-by kind: 2 buckets total.
  const byKind = aggregateUsage(rows, "kind");
  assert.equal(byKind.length, 2, "kind: 2 buckets (chat + agent)");
  const chatBucket = byKind.find((r) => r.callerKind === "chat");
  const agentBucket = byKind.find((r) => r.callerKind === "agent");
  assert.ok(chatBucket && agentBucket);
  assert.equal(chatBucket!.calls, 3, "3 chat rows");
  assert.equal(agentBucket!.calls, 3, "3 agent rows");
  assert.equal(chatBucket!.costUsdMicro, 18_000);
  assert.equal(agentBucket!.costUsdMicro, 22_100);

  // Top-level ordering: highest cost first.
  const biggest = modelKind[0]!;
  assert.ok(
    biggest.costUsdMicro >= modelKind[modelKind.length - 1]!.costUsdMicro,
    "rollup sorts by cost desc",
  );

  console.log("harness-usage-aggregation: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
