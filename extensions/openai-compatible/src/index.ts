/**
 * Generic OpenAI-compatible extension — placeholder for arbitrary
 * `baseURL`-targeted endpoints (llama.cpp server, vLLM, text-generation-webui,
 * Together, Groq, OpenRouter).
 *
 * Users instantiate concrete providers by writing their own entries in
 * `.mako/providers.json` (or `~/.mako/providers.json`). This extension
 * exists so the build graph and `agentmako providers list` can surface a
 * "register your own openai-compatible endpoint" affordance without code.
 */

import {
  BUNDLED_CATALOG,
  type ProviderSpec,
} from "@mako-ai/harness-contracts";
import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "openai-compatible",
  displayName: "OpenAI-compatible (custom)",
  version: "0.1.0",
  kind: "model-provider",
  capabilities: [
    {
      kind: "answer-synthesis",
      description:
        "Generic adapter for any OpenAI-compatible endpoint. Configure baseURL + apiKey via .mako/providers.json.",
    },
  ],
};

export const providerSpec: ProviderSpec | null =
  BUNDLED_CATALOG.providers.find((p) => p.id === "openai-compatible") ?? null;
