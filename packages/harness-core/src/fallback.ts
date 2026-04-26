/**
 * Provider fallback chain.
 *
 * On `auth-error`, `rate-limit`, `server-error`, or `timeout`, the agent loop
 * advances one entry in the session's `fallback_chain`. Each attempt writes
 * a `harness_provider_calls` row so the audit trail captures every transition.
 *
 * Capped at `chain.length` total attempts (no infinite loops). Exponential
 * backoff between entries: 0ms → 250ms → 500ms → 1000ms → 2000ms (cap).
 */

export type ProviderErrorKind =
  | "auth-error"
  | "rate-limit"
  | "server-error"
  | "timeout"
  | "fatal";

export interface ProviderErrorClassification {
  kind: ProviderErrorKind;
  /** Original error for logging — never surfaced to UI. */
  cause: unknown;
  /** Whether the fallback chain should advance. `fatal` returns false. */
  shouldFallover: boolean;
}

const AUTH_PATTERNS = [/401/, /403/, /unauthorized/i, /invalid api key/i, /authentication/i];
const RATE_PATTERNS = [/429/, /rate.?limit/i, /quota/i, /too many requests/i];
const SERVER_PATTERNS = [/5\d\d/, /server error/i, /service unavailable/i, /bad gateway/i];
const TIMEOUT_PATTERNS = [/timeout/i, /etimedout/i, /aborted/i, /econnreset/i];

export function classifyProviderError(error: unknown): ProviderErrorClassification {
  const message = error instanceof Error ? error.message : String(error);

  if (AUTH_PATTERNS.some((re) => re.test(message))) {
    return { kind: "auth-error", cause: error, shouldFallover: true };
  }
  if (RATE_PATTERNS.some((re) => re.test(message))) {
    return { kind: "rate-limit", cause: error, shouldFallover: true };
  }
  if (SERVER_PATTERNS.some((re) => re.test(message))) {
    return { kind: "server-error", cause: error, shouldFallover: true };
  }
  if (TIMEOUT_PATTERNS.some((re) => re.test(message))) {
    return { kind: "timeout", cause: error, shouldFallover: true };
  }
  return { kind: "fatal", cause: error, shouldFallover: false };
}

export async function fallbackBackoff(attempt: number): Promise<void> {
  if (attempt <= 0) return;
  const delays = [0, 250, 500, 1000, 2000];
  const ms = delays[Math.min(attempt, delays.length - 1)] ?? 2000;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FallbackEntry {
  provider: string;
  model: string;
}

export interface FallbackChainResult<T> {
  ok: true;
  value: T;
  attempts: Array<{ entry: FallbackEntry; ok: true; latencyMs: number }>;
}

export interface FallbackChainFailure {
  ok: false;
  attempts: Array<{
    entry: FallbackEntry;
    ok: false;
    latencyMs: number;
    classification: ProviderErrorClassification;
  }>;
}

export type FallbackChainOutcome<T> = FallbackChainResult<T> | FallbackChainFailure;

/**
 * Run a function across a fallback chain. The function receives the current
 * entry and is expected to throw on transport failure. The chain advances
 * on classifiable, retryable errors; `fatal` errors bubble up immediately.
 */
export async function runWithFallback<T>(
  chain: FallbackEntry[],
  attempt: (entry: FallbackEntry) => Promise<T>,
  hooks: {
    onAttemptStart?: (entry: FallbackEntry, index: number) => void;
    onAttemptOk?: (entry: FallbackEntry, latencyMs: number) => void;
    onAttemptFail?: (
      entry: FallbackEntry,
      latencyMs: number,
      classification: ProviderErrorClassification,
    ) => void;
  } = {},
): Promise<FallbackChainOutcome<T>> {
  if (chain.length === 0) {
    throw new Error("fallback chain is empty");
  }

  const failures: FallbackChainFailure["attempts"] = [];

  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i]!;
    if (i > 0) await fallbackBackoff(i);
    hooks.onAttemptStart?.(entry, i);

    const startedAt = Date.now();
    try {
      const value = await attempt(entry);
      const latencyMs = Date.now() - startedAt;
      hooks.onAttemptOk?.(entry, latencyMs);
      const okAttempts: FallbackChainResult<T>["attempts"] = failures.map((f) => ({
        entry: f.entry,
        ok: false as const,
        latencyMs: f.latencyMs,
      })) as never;
      return { ok: true, value, attempts: [...okAttempts, { entry, ok: true, latencyMs }] };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const classification = classifyProviderError(error);
      hooks.onAttemptFail?.(entry, latencyMs, classification);
      failures.push({ entry, ok: false, latencyMs, classification });
      if (!classification.shouldFallover) break;
    }
  }

  return { ok: false, attempts: failures };
}
