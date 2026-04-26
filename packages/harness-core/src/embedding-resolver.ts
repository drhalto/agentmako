/**
 * Embedding resolver — picks an embedding provider + model through the same
 * layered precedence pattern as chat tier resolution:
 *
 *   1. Explicit override (`{ providerId, modelId }` args)
 *   2. Env (`MAKO_EMBEDDING_PROVIDER` + `MAKO_EMBEDDING_MODEL`)
 *   3. Project `.mako/config.json` `defaults.embedding`
 *   4. Global `~/.mako/config.json` `defaults.embedding`
 *   5. Auto: first reachable local embedding provider (Ollama, LM Studio) →
 *      first cloud provider with a key and a declared embedding model → null
 *
 * Returns `null` when no embedding provider is available; callers treat that
 * as "run in FTS-only fallback mode." This is not an error — it is the
 * deliberate `no-agent` degradation that Phase 3.3 promises.
 *
 * The resolver does NOT cache across calls. Callers that want to reuse an
 * `EmbeddingProvider` instance (and its discovered `dim`) should hold onto
 * the return value.
 */

import type { ModelSpec, ProviderSpec } from "@mako-ai/harness-contracts";
import { createLogger } from "@mako-ai/logger";
import {
  createEmbeddingProvider,
  EmbeddingProviderError,
  type EmbeddingProvider,
} from "./embedding-provider.js";
import { loadHarnessConfig } from "./local-config.js";
import type { ProviderRegistry } from "./provider-registry.js";

const resolverLogger = createLogger("mako-harness-embedding-resolver");

export interface ResolveEmbeddingInput {
  explicitProviderId?: string;
  explicitModelId?: string;
  projectRoot?: string;
  globalConfigDir?: string;
  registry: ProviderRegistry;
}

export type EmbeddingResolutionSource =
  | "explicit"
  | "env"
  | "project-config"
  | "global-config"
  | "auto-local"
  | "auto-cloud";

export interface ResolvedEmbedding {
  provider: EmbeddingProvider;
  spec: ProviderSpec;
  modelId: string;
  source: EmbeddingResolutionSource;
  reason: string;
}

export interface EmbeddingResolutionFailure {
  ok: false;
  reason: string;
  attempted: Array<{ providerId: string; modelId: string; reason: string }>;
}

export interface EmbeddingResolutionSuccess extends ResolvedEmbedding {
  ok: true;
}

export type EmbeddingResolutionResult =
  | EmbeddingResolutionSuccess
  | EmbeddingResolutionFailure;

const LOCAL_EMBEDDING_PROVIDER_ORDER = ["ollama", "lmstudio"];

function isEmbeddingCapable(spec: ProviderSpec): boolean {
  return spec.kind === "embedding" || spec.kind === "both";
}

function looksLikeEmbeddingModel(model: ModelSpec): boolean {
  // Heuristic — embeddings models are flagged by id-substring in the bundled
  // catalog (e.g. `nomic-embed-text`, `text-embedding-3-small`, `mxbai-embed-large`).
  // A future catalog version can add a first-class `kind: "embedding"` field on
  // ModelSpec and this heuristic can retire.
  const id = model.id.toLowerCase();
  return id.includes("embed");
}

function pickDefaultEmbeddingModel(spec: ProviderSpec): string | null {
  for (const m of spec.models) {
    if (looksLikeEmbeddingModel(m)) return m.id;
  }
  // Fall through: providers with empty `models` arrays (e.g. `openai-compatible`
  // custom endpoints) accept any string.
  return null;
}

async function buildResolved(
  registry: ProviderRegistry,
  spec: ProviderSpec,
  modelId: string,
  source: EmbeddingResolutionSource,
  reason: string,
): Promise<ResolvedEmbedding> {
  const { key } = await registry.resolveApiKey(spec.id);
  const provider = createEmbeddingProvider({ spec, modelId, apiKey: key });
  return { provider, spec, modelId, source, reason };
}

export async function resolveEmbedding(
  input: ResolveEmbeddingInput,
): Promise<EmbeddingResolutionResult> {
  const { registry } = input;
  const attempted: EmbeddingResolutionFailure["attempted"] = [];

  // -- 1. Explicit
  if (input.explicitProviderId) {
    const providerId = input.explicitProviderId;
    const entry = registry.get(providerId);
    if (!entry) {
      return {
        ok: false,
        reason: `embedding provider \`${providerId}\` not in registry`,
        attempted: [
          { providerId, modelId: input.explicitModelId ?? "?", reason: "not in registry" },
        ],
      };
    }
    if (!isEmbeddingCapable(entry.spec)) {
      return {
        ok: false,
        reason: `provider \`${providerId}\` declares kind \`${entry.spec.kind}\` and cannot serve embeddings`,
        attempted: [
          { providerId, modelId: input.explicitModelId ?? "?", reason: `kind=${entry.spec.kind}` },
        ],
      };
    }
    const modelId = input.explicitModelId ?? pickDefaultEmbeddingModel(entry.spec);
    if (!modelId) {
      return {
        ok: false,
        reason: `provider \`${providerId}\` has no embedding model declared; pass \`modelId\` explicitly`,
        attempted: [{ providerId, modelId: "?", reason: "no embedding model declared" }],
      };
    }
    const resolved = await buildResolved(registry, entry.spec, modelId, "explicit", "explicit override");
    return { ok: true, ...resolved };
  }

  // -- 2. Env
  const envProvider = process.env.MAKO_EMBEDDING_PROVIDER?.trim();
  const envModel = process.env.MAKO_EMBEDDING_MODEL?.trim();
  if (envProvider) {
    const entry = registry.get(envProvider);
    if (entry && isEmbeddingCapable(entry.spec)) {
      const modelId = envModel || pickDefaultEmbeddingModel(entry.spec);
      if (modelId) {
        const resolved = await buildResolved(
          registry,
          entry.spec,
          modelId,
          "env",
          `MAKO_EMBEDDING_PROVIDER=${envProvider}`,
        );
        return { ok: true, ...resolved };
      }
      attempted.push({ providerId: envProvider, modelId: "?", reason: "no embedding model declared" });
    } else {
      attempted.push({
        providerId: envProvider,
        modelId: envModel ?? "?",
        reason: entry ? `kind=${entry.spec.kind}` : "not in registry",
      });
    }
  }

  // -- 3, 4. Config
  const config = loadHarnessConfig({
    projectRoot: input.projectRoot,
    globalConfigDir: input.globalConfigDir,
  });
  for (const [source, defaults] of [
    ["project-config", config.projectEmbeddingDefaults] as const,
    ["global-config", config.globalEmbeddingDefaults] as const,
  ]) {
    if (!defaults?.provider) continue;
    const entry = registry.get(defaults.provider);
    if (!entry || !isEmbeddingCapable(entry.spec)) {
      attempted.push({
        providerId: defaults.provider,
        modelId: defaults.model ?? "?",
        reason: entry ? `kind=${entry.spec.kind}` : "not in registry",
      });
      continue;
    }
    const modelId = defaults.model ?? pickDefaultEmbeddingModel(entry.spec);
    if (!modelId) {
      attempted.push({ providerId: defaults.provider, modelId: "?", reason: "no model declared" });
      continue;
    }
    const resolved = await buildResolved(
      registry,
      entry.spec,
      modelId,
      source,
      `${source} defaults.embedding`,
    );
    return { ok: true, ...resolved };
  }

  // -- 5. Auto: local first (Ollama, LM Studio), then cloud
  for (const providerId of LOCAL_EMBEDDING_PROVIDER_ORDER) {
    const entry = registry.get(providerId);
    if (!entry || !isEmbeddingCapable(entry.spec)) continue;
    const probe = await registry.probeLocalProvider(providerId);
    if (!probe.ok) {
      attempted.push({
        providerId,
        modelId: "?",
        reason: `local probe failed at ${probe.url ?? "(no url)"}`,
      });
      continue;
    }
    const modelId = pickDefaultEmbeddingModel(entry.spec);
    if (!modelId) {
      attempted.push({ providerId, modelId: "?", reason: "no embedding model declared" });
      continue;
    }
    try {
      const resolved = await buildResolved(
        registry,
        entry.spec,
        modelId,
        "auto-local",
        `local provider ${providerId} reachable`,
      );
      return { ok: true, ...resolved };
    } catch (error) {
      attempted.push({
        providerId,
        modelId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const { spec } of registry.list()) {
    if (!isEmbeddingCapable(spec)) continue;
    if (spec.tier !== "cloud") continue;
    const { key } = await registry.resolveApiKey(spec.id);
    if (!key) {
      attempted.push({ providerId: spec.id, modelId: "?", reason: "no API key" });
      continue;
    }
    const modelId = pickDefaultEmbeddingModel(spec);
    if (!modelId) {
      attempted.push({ providerId: spec.id, modelId: "?", reason: "no embedding model declared" });
      continue;
    }
    try {
      const provider = createEmbeddingProvider({ spec, modelId, apiKey: key });
      return {
        ok: true,
        provider,
        spec,
        modelId,
        source: "auto-cloud",
        reason: `BYOK key available for cloud provider ${spec.id}`,
      };
    } catch (error) {
      if (error instanceof EmbeddingProviderError) {
        attempted.push({ providerId: spec.id, modelId, reason: error.message });
      } else {
        throw error;
      }
    }
  }

  resolverLogger.info("embedding.resolve.none-available", {
    attempted: attempted.length,
  });
  return {
    ok: false,
    reason: "no embedding provider is available — memory_recall will run in fts-fallback mode",
    attempted,
  };
}
