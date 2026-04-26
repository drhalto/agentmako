/**
 * Helpers for turning the raw /providers response into a model picker list.
 *
 * Chat-capability heuristic: we include a model if its id does NOT look
 * like an embedding model. Bundled catalog flags are imperfect
 * (`supportsTools: false` does not mean "not a chat model" — Gemma 4 is
 * chat-capable without tool calling), so we rely on the id signal.
 *
 * Key availability: a model is "usable" if the provider is reachable
 * (`auth: "none"` local provider) or the key has been resolved. The UI
 * shows usable ones first and greys out the rest with the reason.
 */

import type { ProviderEntry } from "../api-types";

export interface PickableModel {
  providerId: string;
  providerName: string;
  providerTier: "local" | "cloud";
  modelId: string;
  modelDisplay: string;
  contextWindow: number;
  supportsTools: boolean;
  usable: boolean;
  reason?: string;
}

const EMBEDDING_HINTS = [/embed/i, /e5-/i, /bge-/i];

export function isEmbeddingModel(modelId: string): boolean {
  return EMBEDDING_HINTS.some((re) => re.test(modelId));
}

export function isChatCapable(modelId: string): boolean {
  return !isEmbeddingModel(modelId);
}

export function isProviderUsable(entry: ProviderEntry): boolean {
  return entry.spec.auth === "none" ? entry.reachable === true : entry.keyResolved;
}

export function providerUnavailableReason(entry: ProviderEntry): string | undefined {
  if (isProviderUsable(entry)) return undefined;
  return entry.spec.auth === "none" ? "provider unreachable" : "no API key";
}

export function buildPickableModels(entries: ProviderEntry[]): PickableModel[] {
  const out: PickableModel[] = [];
  for (const entry of entries) {
    const { spec } = entry;
    const kind = spec.kind;
    if (kind === "embedding") continue;

    for (const m of spec.models ?? []) {
      if (!isChatCapable(m.id)) continue;
      const usable = isProviderUsable(entry);
      out.push({
        providerId: spec.id,
        providerName: spec.name,
        providerTier: spec.tier as "local" | "cloud",
        modelId: m.id,
        modelDisplay: m.displayName,
        contextWindow: m.contextWindow,
        supportsTools: m.supportsTools,
        usable,
        reason: providerUnavailableReason(entry),
      });
    }
  }
  return out;
}

const LS_KEY = "mako:last-model-pick";

export interface ModelPick {
  providerId: string;
  modelId: string;
}

export function loadLastPick(): ModelPick | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ModelPick>;
    if (parsed.providerId && parsed.modelId) {
      return { providerId: parsed.providerId, modelId: parsed.modelId };
    }
  } catch {
    /* swallow */
  }
  return null;
}

export function saveLastPick(pick: ModelPick): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(pick));
  } catch {
    /* swallow */
  }
}

/** Pick a sensible default when the user hasn't chosen yet. */
export function pickDefaultModel(models: PickableModel[]): ModelPick | null {
  const usable = models.filter((m) => m.usable);
  if (usable.length === 0) return null;
  // Prefer local tier, then the first model in catalog order.
  const local = usable.find((m) => m.providerTier === "local");
  const pick = local ?? usable[0]!;
  return { providerId: pick.providerId, modelId: pick.modelId };
}
