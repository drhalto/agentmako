/**
 * Moonshot extension — Kimi K2.5 and friends, accessed via the Moonshot API
 * over the OpenAI-compatible wire format.
 *
 * The actual `ProviderSpec` lives in the bundled catalog
 * (`packages/harness-contracts/models/catalog.json`). This extension exists
 * as a workspace package so:
 *   1. Build-graph dependencies make it impossible to ship a CLI that
 *      thinks Moonshot exists without the contract being shipped too.
 *   2. Future provider-specific extras (cost tables, header overrides,
 *      runtime discovery) have a place to land without touching the core.
 */

import {
  BUNDLED_CATALOG,
  type ProviderSpec,
} from "@mako-ai/harness-contracts";
import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "moonshot",
  displayName: "Moonshot",
  version: "0.1.0",
  kind: "model-provider",
  capabilities: [
    {
      kind: "answer-synthesis",
      description: "Cloud chat provider (Kimi K2.5, Kimi K2 Thinking, Moonshot v1).",
    },
  ],
};

export const providerSpec: ProviderSpec | null =
  BUNDLED_CATALOG.providers.find((p) => p.id === "moonshot") ?? null;
