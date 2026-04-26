/**
 * Phase 3.9 cost lookup + per-call cost computation.
 *
 * Costs in the catalog are per-million tokens (USD). We persist per-call
 * costs as micro-USD integers (1 USD = 1_000_000) to avoid float drift in
 * SQLite. All conversions happen here; nothing downstream should do math on
 * a double.
 */

import { costRateKey, type CostRates, type ParsedCatalog } from "@mako-ai/harness-contracts";

export interface CallTokens {
  promptTokens?: number | null;
  completionTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}

export function lookupModelCost(
  catalog: ParsedCatalog | null | undefined,
  providerId: string,
  modelId: string,
): CostRates | null {
  if (!catalog) return null;
  return catalog.rates[costRateKey(providerId, modelId)] ?? null;
}

/**
 * Compute the micro-USD cost for a single provider call. Returns `null` if
 * we don't have enough data to compute (no rates known, or no tokens seen).
 *
 * Cache-read/write tokens are treated as subsets of `promptTokens` when both
 * are present, so they reprice part of the prompt instead of stacking on top
 * of the full input total. Cache-read is billed against the `cacheRead` rate
 * when present and falls back to the input rate at the common 0.1× multiplier
 * advertised by most providers. Cache-write falls back to input rate at 1.25×.
 * These fallbacks mirror opencode's behavior and exist so older models still
 * show a non-zero cost when cache tokens appear — the catalog rates always
 * take precedence when present.
 */
export function computeCallCostMicro(
  tokens: CallTokens,
  rates: CostRates | null,
): number | null {
  if (!rates) return null;
  const promptTotal = tokens.promptTokens ?? 0;
  const output = tokens.completionTokens ?? 0;
  const cacheRead = tokens.cacheReadTokens ?? 0;
  const cacheWrite = tokens.cacheWriteTokens ?? 0;
  if (promptTotal === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return null;

  const inputRate = rates.input ?? 0;
  const outputRate = rates.output ?? 0;
  const cacheReadRate = rates.cacheRead ?? inputRate * 0.1;
  const cacheWriteRate = rates.cacheWrite ?? inputRate * 1.25;
  const uncachedInput = Math.max(0, promptTotal - cacheRead - cacheWrite);

  // per-million → per-token → USD → micro-USD; finalized with rounding.
  const usd =
    (uncachedInput * inputRate +
      output * outputRate +
      cacheRead * cacheReadRate +
      cacheWrite * cacheWriteRate) /
    1_000_000;
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return Math.round(usd * 1_000_000);
}

export function microUsdToUsd(micro: number | null | undefined): number | null {
  if (micro === null || micro === undefined) return null;
  return micro / 1_000_000;
}

export function formatUsdCompact(micro: number | null | undefined): string | null {
  const usd = microUsdToUsd(micro);
  if (usd === null) return null;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
