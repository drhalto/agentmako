/**
 * Anthropic extension — Claude family via the native Anthropic API.
 * Phase 3.1: provider spec sourced from the bundled catalog so Claude is
 * available in `agentmako providers list` out of the box.
 */

import {
  BUNDLED_CATALOG,
  type ProviderSpec,
} from "@mako-ai/harness-contracts";
import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "anthropic",
  displayName: "Anthropic",
  version: "0.1.0",
  kind: "model-provider",
  capabilities: [
    {
      kind: "answer-synthesis",
      description: "Cloud chat provider (Claude Opus, Sonnet, Haiku).",
    },
  ],
};

export const providerSpec: ProviderSpec | null =
  BUNDLED_CATALOG.providers.find((p) => p.id === "anthropic") ?? null;
