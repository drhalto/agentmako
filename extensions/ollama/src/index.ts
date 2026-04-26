/**
 * Ollama extension — local OpenAI-compatible endpoint at
 * `http://localhost:11434/v1`. Health-checked at first use; when the daemon
 * is offline the fallback chain advances to the next entry.
 *
 * Override the base URL with `OLLAMA_BASE_URL` or `MAKO_OLLAMA_BASE_URL`.
 */

import {
  BUNDLED_CATALOG,
  type ProviderSpec,
} from "@mako-ai/harness-contracts";
import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "ollama",
  displayName: "Ollama (local)",
  version: "0.1.0",
  kind: "model-provider",
  capabilities: [
    {
      kind: "answer-synthesis",
      description:
        "Local chat + embedding provider. Default endpoint http://localhost:11434/v1; override with OLLAMA_BASE_URL.",
    },
  ],
};

export const providerSpec: ProviderSpec | null =
  BUNDLED_CATALOG.providers.find((p) => p.id === "ollama") ?? null;

/** Best-effort runtime discovery — pings `/api/tags` to see if the daemon is up. */
export async function discoverOllamaModels(
  baseURL = providerSpec?.baseURL ?? "http://localhost:11434/v1",
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const tagsUrl = baseURL.replace(/\/v1\/?$/, "/api/tags");
  try {
    const response = await fetchImpl(tagsUrl, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return { ok: false, models: [], error: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as { models?: Array<{ name: string }> };
    return { ok: true, models: (body.models ?? []).map((m) => m.name) };
  } catch (error) {
    return {
      ok: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
