/**
 * Model factory — turns a `ProviderSpec` + `modelId` + `apiKey` into an `ai`
 * SDK `LanguageModel` instance.
 *
 * Phase 3.1 supports four transports: `anthropic`, `openai`, `openai-compatible`,
 * and `none` (no-agent placeholder). Other transports declared in
 * `ProviderTransportSchema` (`google`, `mistral`, `ollama`) are routed
 * through `openai-compatible` for now — Ollama and LM Studio expose
 * OpenAI-compatible endpoints natively, and dedicated `@ai-sdk/google` /
 * `@ai-sdk/mistral` integrations can land in a follow-up commit without
 * reshaping callers.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderSpec } from "@mako-ai/harness-contracts";
import type { LanguageModel } from "ai";

export interface ModelFactoryInput {
  spec: ProviderSpec;
  modelId: string;
  apiKey: string | null;
}

export class ModelFactoryError extends Error {
  constructor(
    message: string,
    readonly code:
      | "missing-api-key"
      | "missing-base-url"
      | "unsupported-transport"
      | "model-not-in-catalog",
  ) {
    super(message);
    this.name = "ModelFactoryError";
  }
}

function assertModelDeclared(spec: ProviderSpec, modelId: string): void {
  // Custom providers can ship empty model arrays — let those through.
  if (spec.models.length === 0) return;
  if (!spec.models.some((m) => m.id === modelId)) {
    throw new ModelFactoryError(
      `Model \`${modelId}\` is not declared on provider \`${spec.id}\`. ` +
        `Known: ${spec.models.map((m) => m.id).join(", ") || "(none)"}`,
      "model-not-in-catalog",
    );
  }
}

export function createLanguageModel(input: ModelFactoryInput): LanguageModel {
  const { spec, modelId, apiKey } = input;
  assertModelDeclared(spec, modelId);

  switch (spec.transport) {
    case "anthropic": {
      if (!apiKey) {
        throw new ModelFactoryError(
          `Provider \`${spec.id}\` requires an API key. Run \`agentmako keys set ${spec.id} --prompt\` or set ${spec.envVarHints[0] ?? `MAKO_${spec.id.toUpperCase()}_API_KEY`}.`,
          "missing-api-key",
        );
      }
      const anthropic = createAnthropic({
        apiKey,
        baseURL: spec.baseURL,
        headers: spec.headers,
      });
      return anthropic(modelId);
    }

    case "openai": {
      if (!apiKey) {
        throw new ModelFactoryError(
          `Provider \`${spec.id}\` requires an API key.`,
          "missing-api-key",
        );
      }
      const openai = createOpenAI({
        apiKey,
        baseURL: spec.baseURL,
        headers: spec.headers,
      });
      return openai(modelId);
    }

    case "openai-compatible":
    case "ollama":
    case "google":
    case "mistral": {
      // All routed through @ai-sdk/openai-compatible. Dedicated SDKs for
      // google/mistral can land in 3.1.x; the data model already supports it.
      if (!spec.baseURL) {
        throw new ModelFactoryError(
          `Provider \`${spec.id}\` is openai-compatible but has no \`baseURL\`. ` +
            `Set one in .mako/providers.json or POST /api/v1/providers.`,
          "missing-base-url",
        );
      }
      const compat = createOpenAICompatible({
        name: spec.id,
        baseURL: spec.baseURL,
        // For `auth: "none"` (e.g. local Ollama) the SDK accepts an empty/sentinel value.
        apiKey: spec.auth === "none" ? apiKey ?? "local" : apiKey ?? undefined,
        headers: spec.headers,
      });
      return compat(modelId);
    }

    case "none":
      throw new ModelFactoryError(
        `Provider \`${spec.id}\` has transport \`none\` and cannot serve model calls.`,
        "unsupported-transport",
      );

    default: {
      const exhaustive: never = spec.transport;
      throw new ModelFactoryError(
        `Unsupported provider transport: ${String(exhaustive)}`,
        "unsupported-transport",
      );
    }
  }
}
