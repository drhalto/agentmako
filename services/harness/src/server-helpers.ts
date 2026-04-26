import type { IncomingMessage, ServerResponse } from "node:http";
import {
  estimateTokens,
  resolveTierFromConfig,
  type EmittedSessionEvent,
  type Harness,
} from "@mako-ai/harness-core";
import { match } from "path-to-regexp";
import type { ProviderSpec, SessionUsageSnapshot } from "@mako-ai/harness-contracts";
import type { ProjectStore } from "@mako-ai/store";
import {
  readResolvedDefaults,
  resolveAxis,
  type AxisDefaults,
  type AxisPrefer,
  type DefaultsPatch,
  type ModelSlot,
  type ResolvedAxis,
} from "@mako-ai/config";
import { discoverOllamaModels } from "@mako-ai/extension-ollama";
import { discoverLmStudioModels } from "@mako-ai/extension-lmstudio";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const BODY_LIMIT_BYTES = 1_000_000;
const LOCAL_DISCOVERY_TTL_MS = 30_000;

interface DefaultsPatchInput {
  agent?: Partial<{ cloud: ModelSlot; local: ModelSlot; prefer: AxisPrefer }>;
  embedding?: Partial<{ cloud: ModelSlot; local: ModelSlot; prefer: AxisPrefer }>;
}

interface ProviderAvailability {
  reason: string | null;
}

interface JsonReply {
  status: number;
  body: unknown;
}

interface DiscoveryCacheEntry {
  expiresAt: number;
  ok: boolean;
  models: string[];
  error?: string;
}

const localDiscoveryCache = new Map<string, DiscoveryCacheEntry>();

function parseSlot(value: unknown): ModelSlot | undefined {
  if (value === null) return null;
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as { providerId?: unknown; modelId?: unknown };
  if (typeof candidate.providerId === "string" && typeof candidate.modelId === "string") {
    return { providerId: candidate.providerId, modelId: candidate.modelId };
  }
  return undefined;
}

function parseAxisPatch(
  raw: unknown,
): Partial<{ cloud: ModelSlot; local: ModelSlot; prefer: AxisPrefer }> | null {
  if (raw === undefined) return undefined as never;
  if (typeof raw !== "object" || raw === null) return null;
  const out: Partial<{ cloud: ModelSlot; local: ModelSlot; prefer: AxisPrefer }> = {};
  const obj = raw as Record<string, unknown>;
  if ("cloud" in obj) {
    const slot = parseSlot(obj.cloud);
    if (slot === undefined) return null;
    out.cloud = slot;
  }
  if ("local" in obj) {
    const slot = parseSlot(obj.local);
    if (slot === undefined) return null;
    out.local = slot;
  }
  if ("prefer" in obj) {
    if (obj.prefer !== "cloud" && obj.prefer !== "local") return null;
    out.prefer = obj.prefer;
  }
  return out;
}

export function parseDefaultsPatch(body: unknown): DefaultsPatch | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const input = body as DefaultsPatchInput;
  const out: DefaultsPatch = {};
  if (input.agent !== undefined) {
    const agent = parseAxisPatch(input.agent);
    if (agent === null) return null;
    if (agent !== undefined) out.agent = agent;
  }
  if (input.embedding !== undefined) {
    const embedding = parseAxisPatch(input.embedding);
    if (embedding === null) return null;
    if (embedding !== undefined) out.embedding = embedding;
  }
  return out;
}

async function buildSlotAvailability(
  harness: Harness,
): Promise<(slot: { providerId: string; modelId: string }) => string | null> {
  const entries = harness.providerRegistry.list();
  const cache = new Map<string, ProviderAvailability>();
  await Promise.all(
    entries.map(async ({ spec }: { spec: ProviderSpec }) => {
      let reason: string | null;
      if (spec.auth === "none") {
        const probe =
          spec.tier === "local"
            ? await harness.providerRegistry.probeLocalProvider(spec.id)
            : { ok: true };
        reason = probe.ok ? null : "unreachable";
      } else {
        const { key } = await harness.providerRegistry.resolveApiKey(spec.id);
        reason = key ? null : "no api key";
      }
      cache.set(spec.id, { reason });
    }),
  );
  return ({ providerId }) => {
    const hit = cache.get(providerId);
    if (!hit) return "provider not configured";
    return hit.reason;
  };
}

function shapeAxis(
  axis: AxisDefaults,
  isUsable: (slot: { providerId: string; modelId: string }) => string | null,
): AxisDefaults & ResolvedAxis {
  const resolved = resolveAxis(axis, isUsable);
  return { ...axis, ...resolved };
}

export function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host === "[::1]";
}

function writeJson(response: ServerResponse, requestId: string, reply: JsonReply): void {
  response.statusCode = reply.status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-request-id", requestId);
  response.setHeader("cache-control", "no-store");
  response.setHeader("access-control-allow-origin", "*");
  response.end(JSON.stringify(reply.body));
}

export function writeError(
  response: ServerResponse,
  requestId: string,
  status: number,
  code: string,
  message: string,
): void {
  writeJson(response, requestId, {
    status,
    body: { ok: false, requestId, error: { code, message } },
  });
}

export function writeSuccess(
  response: ServerResponse,
  requestId: string,
  status: number,
  data: unknown,
): void {
  writeJson(response, requestId, { status, body: { ok: true, requestId, data } });
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    request.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > BODY_LIMIT_BYTES) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw.length === 0 ? {} : JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

export function matchPath(
  pathname: string,
  pattern: string,
): Record<string, string> | null {
  const result = match<Record<string, string>>(pattern, {
    decode: decodeURIComponent,
    end: true,
  })(pathname);
  return result === false ? null : result.params;
}

export function sseFormat(event: EmittedSessionEvent): string {
  return `id: ${event.ordinal}\ndata: ${JSON.stringify({
    sessionId: event.sessionId,
    ordinal: event.ordinal,
    createdAt: event.createdAt,
    event: event.event,
  })}\n\n`;
}

export async function discoverLocalModelsCached(
  providerId: string,
  baseURL: string,
): Promise<DiscoveryCacheEntry> {
  const key = `${providerId}|${baseURL}`;
  const now = Date.now();
  const existing = localDiscoveryCache.get(key);
  if (existing && existing.expiresAt > now) return existing;

  let probe: { ok: boolean; models: string[]; error?: string };
  if (providerId === "ollama" || providerId === "ollama-cloud") {
    probe = await discoverOllamaModels(baseURL);
  } else if (providerId === "lmstudio") {
    probe = await discoverLmStudioModels(baseURL);
  } else {
    probe = await probeOpenAiCompatibleModels(baseURL);
  }
  const entry: DiscoveryCacheEntry = {
    ...probe,
    expiresAt: now + LOCAL_DISCOVERY_TTL_MS,
  };
  localDiscoveryCache.set(key, entry);
  return entry;
}

async function probeOpenAiCompatibleModels(
  baseURL: string,
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const url = `${baseURL.replace(/\/$/, "")}/models`;
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
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

export function buildDiscoveredModels(
  existing: ProviderSpec["models"],
  ids: string[],
): ProviderSpec["models"] {
  return ids.map((id) => {
    const known = existing.find((model) => model.id === id);
    return {
      id,
      displayName: known?.displayName ?? id,
      contextWindow: known?.contextWindow ?? 32_768,
      supportsTools: known?.supportsTools ?? true,
      supportsVision: known?.supportsVision ?? false,
      supportsReasoning: known?.supportsReasoning ?? false,
      discovered: true,
      tier: "local" as const,
    };
  });
}

function resolveSessionContextWindow(
  harness: Harness,
  session: { activeProvider: string | null; activeModel: string | null },
): number | null {
  if (!session.activeProvider || !session.activeModel) return null;
  const provider = harness.providerRegistry.get(session.activeProvider);
  const model = provider?.spec.models.find((entry) => entry.id === session.activeModel);
  return model?.contextWindow ?? null;
}

export function computeSessionUsage(
  harness: Harness,
  store: ProjectStore,
  session: {
    id: string;
    activeProvider: string | null;
    activeModel: string | null;
  },
): SessionUsageSnapshot {
  const providerCalls = store.listHarnessProviderCalls(session.id);
  let promptTotal = 0;
  let promptSeen = 0;
  let completionTotal = 0;
  let completionSeen = 0;
  let reasoningTotal = 0;
  let reasoningSeen = 0;
  let cacheReadTotal = 0;
  let cacheReadSeen = 0;
  let cacheWriteTotal = 0;
  let cacheWriteSeen = 0;
  let costTotal = 0;
  let costSeen = 0;

  for (const call of providerCalls) {
    if (typeof call.promptTokens === "number") {
      promptTotal += call.promptTokens;
      promptSeen += 1;
    }
    if (typeof call.completionTokens === "number") {
      completionTotal += call.completionTokens;
      completionSeen += 1;
    }
    if (typeof call.reasoningTokens === "number") {
      reasoningTotal += call.reasoningTokens;
      reasoningSeen += 1;
    }
    if (typeof call.cacheReadTokens === "number") {
      cacheReadTotal += call.cacheReadTokens;
      cacheReadSeen += 1;
    }
    if (typeof call.cacheWriteTokens === "number") {
      cacheWriteTotal += call.cacheWriteTokens;
      cacheWriteSeen += 1;
    }
    if (typeof call.costUsdMicro === "number") {
      costTotal += call.costUsdMicro;
      costSeen += 1;
    }
  }

  const activeMessages = store.listHarnessMessages(session.id, { includeArchived: false });
  const messagesWithParts = activeMessages.map((message) => ({
    message,
    parts: store.listHarnessMessageParts(message.messageId),
  }));
  const contextTokens = estimateTokens(messagesWithParts);
  const contextWindow = resolveSessionContextWindow(harness, session);

  return {
    inputTokens: promptSeen > 0 ? promptTotal : null,
    outputTokens: completionSeen > 0 ? completionTotal : null,
    reasoningTokens: reasoningSeen > 0 ? reasoningTotal : null,
    cacheReadTokens: cacheReadSeen > 0 ? cacheReadTotal : null,
    cacheWriteTokens: cacheWriteSeen > 0 ? cacheWriteTotal : null,
    costUsdMicro: costSeen > 0 ? costTotal : null,
    contextTokens,
    contextWindow,
    contextUtilization:
      contextWindow && contextWindow > 0 ? contextTokens / contextWindow : null,
  };
}

export async function readShapedDefaults(
  projectRoot: string,
  harness: Harness,
): Promise<{
  agent: AxisDefaults & ResolvedAxis;
  embedding: AxisDefaults & ResolvedAxis;
}> {
  const defaults = readResolvedDefaults(projectRoot);
  const availability = await buildSlotAvailability(harness);
  return {
    agent: shapeAxis(defaults.agent, availability),
    embedding: shapeAxis(defaults.embedding, availability),
  };
}

export {
  resolveTierFromConfig,
};
