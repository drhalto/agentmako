/**
 * LM Studio extension — local OpenAI-compatible endpoint at
 * `http://localhost:1234/v1` by default. Health-checked at first use.
 */

import {
  BUNDLED_CATALOG,
  type ProviderSpec,
} from "@mako-ai/harness-contracts";
import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "lmstudio",
  displayName: "LM Studio (local)",
  version: "0.1.0",
  kind: "model-provider",
  capabilities: [
    {
      kind: "answer-synthesis",
      description: "Local chat provider via LM Studio's OpenAI-compatible server.",
    },
  ],
};

export const providerSpec: ProviderSpec | null =
  BUNDLED_CATALOG.providers.find((p) => p.id === "lmstudio") ?? null;

/** Best-effort runtime discovery — pings `/v1/models`. */
export async function discoverLmStudioModels(
  baseURL = providerSpec?.baseURL ?? "http://localhost:1234/v1",
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const response = await fetchImpl(`${baseURL.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return { ok: false, models: [], error: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as { data?: Array<{ id: string }> };
    return { ok: true, models: (body.data ?? []).map((m) => m.id) };
  } catch (error) {
    return {
      ok: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
