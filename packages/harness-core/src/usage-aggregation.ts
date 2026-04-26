/**
 * Phase 3.9 usage rollup.
 *
 * Given a list of provider-call records (already filtered by the store),
 * group by `model`, `caller_kind`, or the combined `model+kind`. Returns a
 * sorted list of rollup rows ready for the `/api/v1/usage` response and the
 * `/usage` web page.
 *
 * This is a pure function — inputs come from the ProjectStore, outputs are
 * plain JSON. No transport, no DB access.
 */

import type { HarnessProviderCallRecord, CallerKind } from "@mako-ai/store";

export type UsageGroupBy = "model" | "kind" | "model+kind";

export interface UsageRow {
  providerId: string | null;
  modelId: string | null;
  callerKind: CallerKind | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsdMicro: number;
  firstAt: string | null;
  lastAt: string | null;
}

function emptyRow(): UsageRow {
  return {
    providerId: null,
    modelId: null,
    callerKind: null,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsdMicro: 0,
    firstAt: null,
    lastAt: null,
  };
}

function keyFor(row: HarnessProviderCallRecord, groupBy: UsageGroupBy): string {
  if (groupBy === "model") return `${row.provider}/${row.model}`;
  if (groupBy === "kind") return row.callerKind;
  return `${row.provider}/${row.model}|${row.callerKind}`;
}

export function aggregateUsage(
  rows: HarnessProviderCallRecord[],
  groupBy: UsageGroupBy = "model+kind",
): UsageRow[] {
  const buckets = new Map<string, UsageRow>();
  for (const row of rows) {
    const key = keyFor(row, groupBy);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = emptyRow();
      if (groupBy !== "kind") {
        bucket.providerId = row.provider;
        bucket.modelId = row.model;
      }
      if (groupBy !== "model") {
        bucket.callerKind = row.callerKind;
      }
      buckets.set(key, bucket);
    }
    bucket.calls += 1;
    bucket.inputTokens += row.promptTokens ?? 0;
    bucket.outputTokens += row.completionTokens ?? 0;
    bucket.reasoningTokens += row.reasoningTokens ?? 0;
    bucket.cacheReadTokens += row.cacheReadTokens ?? 0;
    bucket.cacheWriteTokens += row.cacheWriteTokens ?? 0;
    bucket.costUsdMicro += row.costUsdMicro ?? 0;
    if (!bucket.firstAt || row.createdAt < bucket.firstAt) bucket.firstAt = row.createdAt;
    if (!bucket.lastAt || row.createdAt > bucket.lastAt) bucket.lastAt = row.createdAt;
  }
  return Array.from(buckets.values()).sort((a, b) => b.costUsdMicro - a.costUsdMicro || b.calls - a.calls);
}

export function parseUsageGroupBy(raw: string | null | undefined): UsageGroupBy {
  if (raw === "model") return "model";
  if (raw === "kind") return "kind";
  return "model+kind";
}

export function parseSinceParam(
  raw: string | null | undefined,
  defaultDays = 30,
): string {
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - defaultDays);
  return d.toISOString();
}
