/**
 * Embedding provider — a separate provider axis from chat, intentionally kept
 * independent so a user can pair local embeddings with a cloud chat model (or
 * vice versa) without reconfiguration.
 *
 * Phase 3.3 ships four concrete adapters:
 *
 *   - `ollama` — direct HTTP to `/api/embed` (batched) with graceful fallback
 *     to the older `/api/embeddings` single-prompt endpoint. `@ai-sdk/openai-compatible`
 *     would work for Ollama's chat endpoint but not its embedding endpoint
 *     shape, so this one stays hand-rolled.
 *   - `lmstudio` — rides `@ai-sdk/openai-compatible`'s `textEmbeddingModel(...)`
 *     and the AI SDK's `embedMany({ ... })`. LM Studio's `/v1/embeddings` is
 *     pure OpenAI wire format.
 *   - `openai` — `@ai-sdk/openai` `.textEmbeddingModel(...)` → `embedMany`.
 *   - `openai-compatible` — same path as `lmstudio`, for generic OpenAI-compatible
 *     endpoints (OpenRouter, custom deployments, etc.).
 *
 * Google and Mistral adapters are deferred to a 3.3.x follow-up; the spec
 * lists them but the BYOK local+cloud story is fully covered by the four
 * above. `createEmbeddingProvider` returns a structured
 * `embedding/unsupported-transport` error for them.
 *
 * Dimension is discovered on first call and cached on the provider instance.
 * Callers that need `dim` before embedding can invoke `probe()` explicitly.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderSpec } from "@mako-ai/harness-contracts";
import { createLogger } from "@mako-ai/logger";
import { embed, embedMany, type EmbeddingModel } from "ai";

const embeddingLogger = createLogger("mako-harness-embedding");

export interface EmbeddingProvider {
  readonly providerId: string;
  readonly modelId: string;
  /** Dimension of the produced vectors; `null` until the first successful call. */
  readonly dim: number | null;
  embed(text: string): Promise<Float32Array>;
  embedMany(texts: string[]): Promise<Float32Array[]>;
  /**
   * Probe liveness by embedding a single short string. Returns `{ ok, dim?, reason? }`.
   * Called by `agentmako tier` and by hybrid search's health check.
   */
  probe(): Promise<EmbeddingProbeResult>;
}

export interface EmbeddingProbeResult {
  ok: boolean;
  dim?: number;
  reason?: string;
}

export class EmbeddingProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "missing-api-key"
      | "missing-base-url"
      | "unsupported-transport"
      | "provider-unavailable"
      | "dimension-mismatch",
  ) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}

export interface CreateEmbeddingProviderInput {
  spec: ProviderSpec;
  modelId: string;
  apiKey: string | null;
}

export function createEmbeddingProvider(
  input: CreateEmbeddingProviderInput,
): EmbeddingProvider {
  const { spec, modelId, apiKey } = input;

  switch (spec.transport) {
    case "ollama":
      return new OllamaEmbeddingProvider(spec, modelId);

    case "openai": {
      if (!apiKey) {
        throw new EmbeddingProviderError(
          `Provider \`${spec.id}\` requires an API key for embeddings.`,
          "missing-api-key",
        );
      }
      const client = createOpenAI({
        apiKey,
        baseURL: spec.baseURL,
        headers: spec.headers,
      });
      return new AiSdkEmbeddingProvider(
        spec.id,
        modelId,
        client.textEmbeddingModel(modelId),
      );
    }

    case "openai-compatible": {
      if (!spec.baseURL) {
        throw new EmbeddingProviderError(
          `Provider \`${spec.id}\` is openai-compatible but has no \`baseURL\`.`,
          "missing-base-url",
        );
      }
      const compat = createOpenAICompatible({
        name: spec.id,
        baseURL: spec.baseURL,
        apiKey: spec.auth === "none" ? apiKey ?? "local" : apiKey ?? undefined,
        headers: spec.headers,
      });
      return new AiSdkEmbeddingProvider(
        spec.id,
        modelId,
        compat.textEmbeddingModel(modelId),
      );
    }

    case "google":
    case "mistral":
      throw new EmbeddingProviderError(
        `Provider transport \`${spec.transport}\` is not yet supported for embeddings. ` +
          `Use \`ollama\`, \`lmstudio\`, \`openai\`, or a custom \`openai-compatible\` endpoint for now.`,
        "unsupported-transport",
      );

    case "anthropic":
    case "none":
      throw new EmbeddingProviderError(
        `Provider transport \`${spec.transport}\` cannot serve embeddings.`,
        "unsupported-transport",
      );

    default: {
      const exhaustive: never = spec.transport;
      throw new EmbeddingProviderError(
        `Unknown provider transport: ${String(exhaustive)}`,
        "unsupported-transport",
      );
    }
  }
}

// -----------------------------------------------------------------------------
// Ollama — direct HTTP
// -----------------------------------------------------------------------------

class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly providerId: string;
  readonly modelId: string;
  private _dim: number | null = null;
  private readonly baseURL: string;

  constructor(spec: ProviderSpec, modelId: string) {
    this.providerId = spec.id;
    this.modelId = modelId;
    // Ollama provider specs sit at `http://localhost:11434/v1` for chat; the
    // embedding endpoints live at `/api/embed` and `/api/embeddings` off the
    // server root, so strip a trailing `/v1` if present.
    const rawBase = spec.baseURL ?? "http://localhost:11434/v1";
    this.baseURL = rawBase.replace(/\/v1\/?$/i, "");
  }

  get dim(): number | null {
    return this._dim;
  }

  async embed(text: string): Promise<Float32Array> {
    const vectors = await this.embedMany([text]);
    return vectors[0]!;
  }

  async embedMany(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    // Try the newer batch-capable /api/embed first.
    try {
      return await this.callEmbed(texts);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/404|not found/i.test(reason)) {
        embeddingLogger.debug("ollama.embed-endpoint-missing.fallback-to-embeddings");
        return await this.callEmbeddingsSequential(texts);
      }
      throw new EmbeddingProviderError(
        `Ollama embedding call failed: ${reason}`,
        "provider-unavailable",
      );
    }
  }

  async probe(): Promise<EmbeddingProbeResult> {
    try {
      const v = await this.embed("ping");
      return { ok: true, dim: v.length };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async callEmbed(texts: string[]): Promise<Float32Array[]> {
    const url = `${this.baseURL}/api/embed`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.modelId, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const body = await safeBody(response);
      throw new Error(`${response.status} ${response.statusText}: ${body}`);
    }
    const data = (await response.json()) as { embeddings?: number[][] };
    if (!Array.isArray(data.embeddings) || data.embeddings.length === 0) {
      throw new Error("Ollama /api/embed returned no embeddings");
    }
    const vectors = data.embeddings.map((e) => Float32Array.from(e));
    this.cacheDim(vectors[0]!.length);
    return vectors;
  }

  private async callEmbeddingsSequential(
    texts: string[],
  ): Promise<Float32Array[]> {
    const url = `${this.baseURL}/api/embeddings`;
    const results: Float32Array[] = [];
    for (const prompt of texts) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.modelId, prompt }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        const body = await safeBody(response);
        throw new EmbeddingProviderError(
          `Ollama /api/embeddings failed: ${response.status} ${body}`,
          "provider-unavailable",
        );
      }
      const data = (await response.json()) as { embedding?: number[] };
      if (!Array.isArray(data.embedding)) {
        throw new EmbeddingProviderError(
          "Ollama /api/embeddings returned no embedding",
          "provider-unavailable",
        );
      }
      const v = Float32Array.from(data.embedding);
      this.cacheDim(v.length);
      results.push(v);
    }
    return results;
  }

  private cacheDim(dim: number): void {
    if (this._dim === null) {
      this._dim = dim;
    } else if (this._dim !== dim) {
      throw new EmbeddingProviderError(
        `Ollama returned dim=${dim} but earlier calls produced dim=${this._dim}.`,
        "dimension-mismatch",
      );
    }
  }
}

// -----------------------------------------------------------------------------
// AI SDK adapter — reused by openai, lmstudio, openai-compatible
// -----------------------------------------------------------------------------

class AiSdkEmbeddingProvider implements EmbeddingProvider {
  readonly providerId: string;
  readonly modelId: string;
  private _dim: number | null = null;

  constructor(
    providerId: string,
    modelId: string,
    private readonly model: EmbeddingModel<string>,
  ) {
    this.providerId = providerId;
    this.modelId = modelId;
  }

  get dim(): number | null {
    return this._dim;
  }

  async embed(text: string): Promise<Float32Array> {
    try {
      const result = await embed({ model: this.model, value: text });
      const v = Float32Array.from(result.embedding);
      this.cacheDim(v.length);
      return v;
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async embedMany(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    try {
      const result = await embedMany({ model: this.model, values: texts });
      const vectors = result.embeddings.map((e) => Float32Array.from(e));
      this.cacheDim(vectors[0]!.length);
      return vectors;
    } catch (error) {
      throw this.wrap(error);
    }
  }

  async probe(): Promise<EmbeddingProbeResult> {
    try {
      const v = await this.embed("ping");
      return { ok: true, dim: v.length };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private cacheDim(dim: number): void {
    if (this._dim === null) {
      this._dim = dim;
    } else if (this._dim !== dim) {
      throw new EmbeddingProviderError(
        `Provider ${this.providerId} returned dim=${dim} but earlier calls produced dim=${this._dim}.`,
        "dimension-mismatch",
      );
    }
  }

  private wrap(error: unknown): EmbeddingProviderError {
    if (error instanceof EmbeddingProviderError) return error;
    return new EmbeddingProviderError(
      error instanceof Error ? error.message : String(error),
      "provider-unavailable",
    );
  }
}

async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

// -----------------------------------------------------------------------------
// Cosine similarity — Node-side search
// -----------------------------------------------------------------------------

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new EmbeddingProviderError(
      `cosine: dim mismatch ${a.length} vs ${b.length}`,
      "dimension-mismatch",
    );
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
