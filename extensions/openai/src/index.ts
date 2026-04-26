/**
 * OpenAI extension — GPT-4o, GPT-4o mini, o1 family via the native OpenAI API.
 */

import {
  BUNDLED_CATALOG,
  type ProviderSpec,
} from "@mako-ai/harness-contracts";
import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "openai",
  displayName: "OpenAI",
  version: "0.1.0",
  kind: "model-provider",
  capabilities: [
    {
      kind: "answer-synthesis",
      description: "Cloud chat provider (GPT-4o, GPT-4o mini, o1, o1-mini).",
    },
  ],
};

export const providerSpec: ProviderSpec | null =
  BUNDLED_CATALOG.providers.find((p) => p.id === "openai") ?? null;
