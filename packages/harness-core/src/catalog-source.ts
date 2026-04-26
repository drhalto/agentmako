/**
 * Phase 3.9 catalog source composer.
 *
 * Returns the best available catalog for the harness in a four-tier fallback:
 *
 *   cache (fresh, <5min)  →  fresh fetch  →  snapshot  →  bundled
 *
 * The bundled floor (`BUNDLED_CATALOG`) always succeeds, so the composer
 * never errors up to the caller. Every resolved catalog carries a `source`
 * tag so `GET /api/v1/catalog/status` and the Providers page line can tell
 * the operator which tier answered.
 *
 * File layout:
 *   ~/.mako-ai/cache/models-dev.json   — runtime cache (5-minute TTL)
 *   apps/cli/dist/models-snapshot.json — CLI bundle artifact (resolved via
 *                                        `import.meta.url` when shipped)
 *   packages/harness-contracts/models/snapshot.json — source-tree snapshot
 *                                                     consumed when running
 *                                                     from sources
 *
 * `MAKO_DISABLE_MODELS_FETCH=true` short-circuits the fresh fetch — useful
 * for offline runs, smokes, and CI. `MAKO_MODELS_DEV_URL` overrides the
 * upstream URL.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUNDLED_CATALOG,
  coerceModelsDevPayload,
  parsedCatalogFromProviders,
  type CatalogSource,
  type ParsedCatalog,
} from "@mako-ai/harness-contracts";

const DEFAULT_MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export interface CatalogSourceOptions {
  /** Upstream URL. Defaults to `MAKO_MODELS_DEV_URL` env or https://models.dev/api.json. */
  url?: string;
  /** Disable live fetches. Defaults to `MAKO_DISABLE_MODELS_FETCH === "true"`. */
  disableFetch?: boolean;
  /** Override the cache path (used by tests). */
  cachePath?: string;
  /** Override the snapshot resolver (used by tests). Returns the on-disk snapshot path or null. */
  snapshotPath?: string | null;
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Injected clock for tests. */
  now?: () => number;
}

interface CachedCatalogFile {
  fetchedAt: string;
  payload: unknown;
}

function defaultCachePath(): string {
  const base =
    process.env.MAKO_STATE_DIR ?? join(homedir(), ".mako-ai");
  return join(base, "cache", "models-dev.json");
}

function defaultSnapshotPath(): string | null {
  // Running from source tree: `packages/harness-contracts/models/snapshot.json`.
  // Running from the CLI bundle: sibling `models-snapshot.json` next to
  // `dist/index.js` (the tsup config copies it at build time).
  try {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const candidates = [
      join(here, "../../harness-contracts/models/snapshot.json"),
      join(here, "../harness-contracts/models/snapshot.json"),
      join(here, "models-snapshot.json"),
      join(here, "../models-snapshot.json"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

function envOverrideUrl(): string {
  const override = process.env.MAKO_MODELS_DEV_URL?.trim();
  if (override && override.length > 0) return override;
  return DEFAULT_MODELS_DEV_URL;
}

function envDisableFetch(): boolean {
  const flag = process.env.MAKO_DISABLE_MODELS_FETCH?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

// -----------------------------------------------------------------------------
// Individual loaders (exported so the smokes can drive each tier in isolation)
// -----------------------------------------------------------------------------

export async function fetchCatalog(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedCatalog | null> {
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    controller = new AbortController();
    timer = setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS);
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = (await response.json()) as unknown;
    return coerceModelsDevPayload(payload, "fresh", new Date().toISOString());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function loadCachedCatalog(
  cachePath: string,
  now: () => number = Date.now,
): ParsedCatalog | null {
  try {
    if (!existsSync(cachePath)) return null;
    const stats = statSync(cachePath);
    const age = now() - stats.mtimeMs;
    if (age > CACHE_TTL_MS) return null;
    const raw = JSON.parse(readFileSync(cachePath, "utf8")) as CachedCatalogFile;
    return coerceModelsDevPayload(raw.payload, "cache", raw.fetchedAt);
  } catch {
    return null;
  }
}

export function writeCachedCatalog(
  cachePath: string,
  rawPayload: unknown,
  fetchedAt: string = new Date().toISOString(),
): void {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const body: CachedCatalogFile = { fetchedAt, payload: rawPayload };
    writeFileSync(cachePath, JSON.stringify(body), "utf8");
  } catch {
    // Cache writes are best-effort; failing here should not break the caller.
  }
}

export function loadSnapshotCatalog(snapshotPath: string | null): ParsedCatalog | null {
  if (!snapshotPath) return null;
  try {
    if (!existsSync(snapshotPath)) return null;
    const raw = JSON.parse(readFileSync(snapshotPath, "utf8")) as unknown;
    // Snapshot stores the raw models.dev payload. We coerce on read.
    if (!raw || typeof raw !== "object") return null;
    if ("__comment" in (raw as Record<string, unknown>) && Object.keys(raw as Record<string, unknown>).length <= 1) {
      // Empty placeholder — treat as missing so the BUNDLED tier answers.
      return null;
    }
    const fetchedAt =
      typeof (raw as { __fetchedAt?: unknown }).__fetchedAt === "string"
        ? (raw as { __fetchedAt: string }).__fetchedAt
        : null;
    const payload = fetchedAt
      ? (raw as { payload?: unknown }).payload ?? raw
      : raw;
    return coerceModelsDevPayload(payload, "snapshot", fetchedAt);
  } catch {
    return null;
  }
}

export function loadBundledCatalog(): ParsedCatalog {
  return parsedCatalogFromProviders(
    BUNDLED_CATALOG.providers,
    "bundled",
    BUNDLED_CATALOG.generatedAt || null,
  );
}

// -----------------------------------------------------------------------------
// Composer
// -----------------------------------------------------------------------------

export interface CatalogStatus {
  source: CatalogSource;
  fetchedAt: string | null;
  modelCount: number;
  providerCount: number;
  ttlSecondsRemaining: number | null;
  cachePath: string;
}

export interface CatalogSourceResolver {
  /** Return the currently active catalog (reuses cached/fresh when possible). */
  resolve(): Promise<ParsedCatalog>;
  /** Force a re-fetch, bypassing the cache. Returns the active catalog post-refresh. */
  refresh(): Promise<ParsedCatalog>;
  /** Describe the active catalog for `/api/v1/catalog/status`. */
  status(): Promise<CatalogStatus>;
}

export function createCatalogSource(
  options: CatalogSourceOptions = {},
): CatalogSourceResolver {
  const url = options.url ?? envOverrideUrl();
  const disableFetch = options.disableFetch ?? envDisableFetch();
  const cachePath = options.cachePath ?? defaultCachePath();
  const snapshotPath = options.snapshotPath === undefined
    ? defaultSnapshotPath()
    : options.snapshotPath;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  async function resolveInner(forceRefresh: boolean): Promise<ParsedCatalog> {
    if (!forceRefresh) {
      const cached = loadCachedCatalog(cachePath, now);
      if (cached && cached.providers.length > 0) return cached;
    }
    if (!disableFetch) {
      const fresh = await fetchCatalog(url, fetchImpl);
      if (fresh && fresh.providers.length > 0) {
        // Persist the raw payload by re-fetching once into the cache file.
        // To avoid a double fetch, we stash a coerced-back payload by
        // re-serializing the parsed providers as the cached body. The cache
        // is an optimization; staleness is already handled by the TTL.
        writeCachedCatalog(cachePath, toRawPayload(fresh), fresh.fetchedAt ?? new Date(now()).toISOString());
        return fresh;
      }
    }
    const snapshot = loadSnapshotCatalog(snapshotPath);
    if (snapshot && snapshot.providers.length > 0) return snapshot;
    return loadBundledCatalog();
  }

  return {
    resolve() {
      return resolveInner(false);
    },
    refresh() {
      return resolveInner(true);
    },
    async status() {
      const active = await resolveInner(false);
      let ttlSecondsRemaining: number | null = null;
      if (active.source === "cache") {
        try {
          const stats = statSync(cachePath);
          const age = now() - stats.mtimeMs;
          ttlSecondsRemaining = Math.max(0, Math.round((CACHE_TTL_MS - age) / 1000));
        } catch {
          ttlSecondsRemaining = null;
        }
      }
      return {
        source: active.source,
        fetchedAt: active.fetchedAt,
        modelCount: active.providers.reduce((sum, p) => sum + p.models.length, 0),
        providerCount: active.providers.length,
        ttlSecondsRemaining,
        cachePath,
      };
    },
  };
}

/**
 * Re-serialize a `ParsedCatalog` back into a models.dev-shaped payload so it
 * can be written to the cache file. Lossy on fields we don't consume (extra
 * passthrough keys from the upstream), but round-trips every field the
 * composer reads on the next load.
 */
function toRawPayload(catalog: ParsedCatalog): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const provider of catalog.providers) {
    const models: Record<string, unknown> = {};
    for (const model of provider.models ?? []) {
      const rates = catalog.rates[`${provider.id}/${model.id}`];
      models[model.id] = {
        id: model.id,
        name: model.displayName,
        tool_call: model.supportsTools,
        reasoning: model.supportsReasoning,
        modalities: {
          input: model.supportsVision ? ["text", "image"] : ["text"],
          output: ["text"],
        },
        limit: { context: model.contextWindow },
        cost: rates
          ? {
              input: rates.input,
              output: rates.output,
              cache_read: rates.cacheRead,
              cache_write: rates.cacheWrite,
            }
          : undefined,
      };
    }
    out[provider.id] = {
      id: provider.id,
      name: provider.name,
      api: provider.baseURL,
      env: provider.envVarHints,
      models,
    };
  }
  return out;
}
