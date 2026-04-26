/**
 * Ollama Cloud extension — BYOK access to large models hosted by Ollama
 * (Kimi K2 1T, Qwen3 Coder 480B, DeepSeek v3.1 671B, GPT-OSS 120B). Speaks
 * the OpenAI-compatible wire format at `https://ollama.com/v1`.
 */

import {
  BUNDLED_CATALOG,
  type ProviderSpec,
} from "@mako-ai/harness-contracts";
import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "ollama-cloud",
  displayName: "Ollama Cloud",
  version: "0.1.0",
  kind: "model-provider",
  capabilities: [
    {
      kind: "answer-synthesis",
      description: "Cloud chat provider for Ollama-hosted large models (BYOK).",
    },
  ],
};

export const providerSpec: ProviderSpec | null =
  BUNDLED_CATALOG.providers.find((p) => p.id === "ollama-cloud") ?? null;
