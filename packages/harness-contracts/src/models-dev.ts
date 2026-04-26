/**
 * Phase 3.9: typed schema + pure parsers for the models.dev catalog.
 *
 * The upstream JSON (https://models.dev/api.json) groups models by provider
 * id, with cost per 1M tokens and a `limit.context` window. We coerce that
 * shape into two things:
 *
 *   - `ProviderSpec[]` — same shape as the bundled `BUNDLED_CATALOG`, so the
 *     existing registry / Defaults UI doesn't need to know the catalog
 *     changed sources
 *   - `CostRatesMap` — keyed by `"providerId/modelId"`, holds the per-million
 *     input / output / cacheRead / cacheWrite rates used at provider-call
 *     write time
 *
 * Network + filesystem loaders live in `@mako-ai/harness-core/catalog-source`.
 * This file stays pure so `@mako-ai/harness-contracts` remains safe to import
 * from any runtime (browser type imports included).
 */

import { z } from "zod";
import {
  ModelSpecSchema,
  ProviderSpecSchema,
  type ModelSpec,
  type ProviderSpec,
} from "./schemas.js";

// -----------------------------------------------------------------------------
// models.dev wire schema (best-effort; fields we don't use are passed through)
// -----------------------------------------------------------------------------

const NullableNumber = z.union([z.number(), z.null()]).optional();

export const ModelsDevCostSchema = z
  .object({
    input: NullableNumber,
    output: NullableNumber,
    cache_read: NullableNumber,
    cache_write: NullableNumber,
  })
  .partial();

export const ModelsDevLimitSchema = z
  .object({
    context: z.number().int().positive().optional(),
    output: z.number().int().positive().optional(),
  })
  .partial();

export const ModelsDevModalitiesSchema = z
  .object({
    input: z.array(z.string()).optional(),
    output: z.array(z.string()).optional(),
  })
  .partial();

export const ModelsDevModelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    cost: ModelsDevCostSchema.optional(),
    limit: ModelsDevLimitSchema.optional(),
    modalities: ModelsDevModalitiesSchema.optional(),
    open_weights: z.boolean().optional(),
  })
  .passthrough();

export const ModelsDevProviderSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    env: z.array(z.string()).optional(),
    api: z.string().url().optional(),
    npm: z.string().optional(),
    doc: z.string().optional(),
    models: z.record(ModelsDevModelSchema),
  })
  .passthrough();

export const ModelsDevPayloadSchema = z.record(ModelsDevProviderSchema);
export type ModelsDevPayload = z.infer<typeof ModelsDevPayloadSchema>;

// -----------------------------------------------------------------------------
// Parsed catalog shape returned to the composer
// -----------------------------------------------------------------------------

export type CatalogSource = "cache" | "fresh" | "snapshot" | "bundled";

export interface CostRates {
  /** USD per 1M input tokens. */
  input?: number;
  /** USD per 1M output tokens. */
  output?: number;
  /** USD per 1M cache-read tokens. */
  cacheRead?: number;
  /** USD per 1M cache-write tokens. */
  cacheWrite?: number;
}

export type CostRatesMap = Record<string, CostRates>;

export interface ParsedCatalog {
  /** Source tier this catalog came from. */
  source: CatalogSource;
  /** ISO string — when the underlying data was fetched / generated. */
  fetchedAt: string | null;
  /** Flattened providers list (same shape as BUNDLED_CATALOG.providers). */
  providers: ProviderSpec[];
  /** Per-model cost rates keyed as `"providerId/modelId"`. */
  rates: CostRatesMap;
}

export function costRateKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

// -----------------------------------------------------------------------------
// Provider id → local transport mapping
// -----------------------------------------------------------------------------

/**
 * Known provider transports. Anything not listed here is treated as
 * `openai-compatible` — the common denominator. The `kind` mapping below is
 * approximate: we leave it `chat` unless the provider id matches a known
 * embedding-only host.
 */
const KNOWN_TRANSPORTS: Record<
  string,
  { transport: ProviderSpec["transport"]; kind: ProviderSpec["kind"]; tier: ProviderSpec["tier"] }
> = {
  anthropic: { transport: "anthropic", kind: "chat", tier: "cloud" },
  openai: { transport: "openai", kind: "both", tier: "cloud" },
  google: { transport: "google", kind: "chat", tier: "cloud" },
  mistral: { transport: "mistral", kind: "chat", tier: "cloud" },
  ollama: { transport: "ollama", kind: "both", tier: "local" },
  lmstudio: { transport: "openai-compatible", kind: "both", tier: "local" },
  moonshot: { transport: "openai-compatible", kind: "chat", tier: "cloud" },
  groq: { transport: "openai-compatible", kind: "chat", tier: "cloud" },
  xai: { transport: "openai-compatible", kind: "chat", tier: "cloud" },
  together: { transport: "openai-compatible", kind: "chat", tier: "cloud" },
  openrouter: { transport: "openai-compatible", kind: "chat", tier: "cloud" },
  deepseek: { transport: "openai-compatible", kind: "chat", tier: "cloud" },
  cerebras: { transport: "openai-compatible", kind: "chat", tier: "cloud" },
};

function transportForProvider(
  id: string,
): { transport: ProviderSpec["transport"]; kind: ProviderSpec["kind"]; tier: ProviderSpec["tier"] } {
  return (
    KNOWN_TRANSPORTS[id] ?? {
      transport: "openai-compatible",
      kind: "chat",
      tier: "cloud",
    }
  );
}

// -----------------------------------------------------------------------------
// Pure coercion: raw models.dev JSON → ParsedCatalog
// -----------------------------------------------------------------------------

/**
 * Coerce a raw models.dev API payload into a ParsedCatalog. Lenient: rows that
 * fail `ModelSpecSchema.safeParse` are skipped rather than throwing so a
 * single malformed upstream entry can't break the whole catalog.
 */
export function coerceModelsDevPayload(
  raw: unknown,
  source: CatalogSource,
  fetchedAt: string | null,
): ParsedCatalog {
  const parsed = ModelsDevPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { source, fetchedAt, providers: [], rates: {} };
  }
  const providers: ProviderSpec[] = [];
  const rates: CostRatesMap = {};

  for (const [providerId, providerEntry] of Object.entries(parsed.data)) {
    const { transport, kind, tier } = transportForProvider(providerId);
    const models: ModelSpec[] = [];
    for (const [modelId, modelEntry] of Object.entries(providerEntry.models)) {
      const normalizedModelId = normalizeModelId(providerId, modelId);
      const contextWindow = modelEntry.limit?.context ?? 0;
      if (contextWindow <= 0) continue;
      const spec = ModelSpecSchema.safeParse({
        id: normalizedModelId,
        displayName: modelEntry.name ?? normalizedModelId,
        contextWindow,
        supportsTools: modelEntry.tool_call ?? false,
        supportsVision: modelEntry.modalities?.input?.includes("image") ?? false,
        supportsReasoning: modelEntry.reasoning ?? false,
        costHint: pickCostHint(modelEntry.cost),
        tier,
      });
      if (!spec.success) continue;
      models.push(spec.data);
      const costRates = pickCostRates(modelEntry.cost);
      if (costRates) {
        rates[costRateKey(providerId, normalizedModelId)] = costRates;
      }
    }
    if (models.length === 0) continue;
    const providerSpec = ProviderSpecSchema.safeParse({
      id: providerId,
      name: providerEntry.name ?? providerId,
      kind,
      transport,
      auth: tier === "local" ? "none" : "api-key",
      baseURL: providerEntry.api,
      envVarHints: providerEntry.env ?? [],
      models,
      tier,
    });
    if (providerSpec.success) {
      providers.push(providerSpec.data);
    }
  }

  return { source, fetchedAt, providers, rates };
}

function normalizeModelId(providerId: string, modelId: string): string {
  if (providerId !== "ollama-cloud") return modelId;
  if (modelId.endsWith(":cloud") || modelId.endsWith("-cloud")) return modelId;
  return modelId.includes(":") ? `${modelId}-cloud` : `${modelId}:cloud`;
}

function pickCostHint(
  cost: z.infer<typeof ModelsDevCostSchema> | undefined,
): ModelSpec["costHint"] | undefined {
  if (!cost) return undefined;
  const input = typeof cost.input === "number" ? cost.input : undefined;
  const output = typeof cost.output === "number" ? cost.output : undefined;
  if (input === undefined || output === undefined) return undefined;
  return { input, output };
}

function pickCostRates(
  cost: z.infer<typeof ModelsDevCostSchema> | undefined,
): CostRates | null {
  if (!cost) return null;
  const out: CostRates = {};
  if (typeof cost.input === "number") out.input = cost.input;
  if (typeof cost.output === "number") out.output = cost.output;
  if (typeof cost.cache_read === "number") out.cacheRead = cost.cache_read;
  if (typeof cost.cache_write === "number") out.cacheWrite = cost.cache_write;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Build a ParsedCatalog from an already-validated `providers` array (the
 * bundled-catalog path). Cost hints from individual models are lifted into
 * the `rates` map so callers get a uniform surface.
 */
export function parsedCatalogFromProviders(
  providers: ProviderSpec[],
  source: CatalogSource,
  fetchedAt: string | null,
): ParsedCatalog {
  const rates: CostRatesMap = {};
  for (const provider of providers) {
    for (const model of provider.models ?? []) {
      if (model.costHint) {
        rates[costRateKey(provider.id, model.id)] = {
          input: model.costHint.input,
          output: model.costHint.output,
        };
      }
    }
  }
  return { source, fetchedAt, providers, rates };
}
