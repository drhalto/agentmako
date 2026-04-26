/**
 * Session compaction — Phase 3.4.
 *
 * Compaction fires after `turn.done` when the session's cumulative token
 * estimate exceeds `contextWindow * threshold` (default `0.6`). The mechanism
 * is intentionally boring: archive the older half of the session's
 * un-archived messages, run one summarization call against the active
 * provider, insert the summary as a new `system`-role message, and emit
 * events on `harness_session_events` so resume replay can reconstruct the
 * state without re-calling the model.
 *
 * The archival is non-destructive. Originals stay in `harness_messages`
 * (they were append-only before Phase 3.4; migration 0012 loosened the
 * update trigger to allow exactly one column — `archived` — to flip 0→1).
 * The turn that follows a compaction sees the summary plus the newest turns
 * in `buildHistory`, which filters `archived = 1` messages out of the model
 * context.
 *
 * Failure semantics: if the summarization call fails, we emit
 * `compaction.failed` and leave the session untouched. The session keeps
 * running with all turns visible — the user notices nothing beyond the
 * warning event. Compaction will retry on the next `turn.done` crossing.
 */

import { generateText, type LanguageModelV1 } from "ai";
import { createLogger } from "@mako-ai/logger";
import type {
  HarnessMessageRecord,
  HarnessMessagePartRecord,
  ProjectStore,
} from "@mako-ai/store";
import type { SessionEventBus } from "./event-bus.js";
import { createLanguageModel } from "./model-factory.js";
import type { ProviderRegistry } from "./provider-registry.js";

const compactionLogger = createLogger("mako-harness-compaction");

/** Default trigger threshold as a fraction of the active model's context window. */
export const DEFAULT_COMPACTION_THRESHOLD = 0.6;

/** Fallback context window when the active model spec is unknown. */
const FALLBACK_CONTEXT_WINDOW = 32_768;

/** Keep this many of the newest messages out of the archival set. */
const RETAINED_TAIL_MESSAGES = 4;

/** Rough per-message overhead to account for role tags, tool-call framing, etc. */
const PER_MESSAGE_OVERHEAD_TOKENS = 8;

export interface CompactionContext {
  sessionId: string;
  store: ProjectStore;
  bus: SessionEventBus;
  providerRegistry: ProviderRegistry;
  threshold?: number;
}

export interface CompactionResult {
  ranCompaction: boolean;
  reason?: string;
  archivedCount?: number;
  summaryMessageId?: string;
  tokensBefore?: number;
}

/**
 * Inspect the session; run compaction if the token estimate crosses
 * `contextWindow * threshold`. Safe to call on every `turn.done` — cheap
 * when below threshold, bounded work when above.
 */
export async function maybeCompact(
  ctx: CompactionContext,
): Promise<CompactionResult> {
  const threshold = ctx.threshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const session = ctx.store.getHarnessSession(ctx.sessionId);
  if (!session) {
    return { ranCompaction: false, reason: "session not found" };
  }

  const messages = ctx.store.listHarnessMessages(ctx.sessionId, {
    includeArchived: false,
  });
  if (messages.length <= RETAINED_TAIL_MESSAGES + 1) {
    return { ranCompaction: false, reason: "too few messages" };
  }

  // Load parts for every message so we can estimate tokens AND build the
  // transcript the summarization prompt will work against.
  const messagesWithParts = messages.map((message) => ({
    message,
    parts: ctx.store.listHarnessMessageParts(message.messageId),
  }));

  const tokens = estimateTokens(messagesWithParts);
  const contextWindow = resolveContextWindow(session, ctx.providerRegistry);
  const triggerAt = contextWindow * threshold;

  if (tokens < triggerAt) {
    return { ranCompaction: false, reason: "below threshold", tokensBefore: tokens };
  }

  // Split into archive-candidates vs. retained tail. Archive everything
  // except the last `RETAINED_TAIL_MESSAGES` messages.
  const archivalCutoff = messagesWithParts.length - RETAINED_TAIL_MESSAGES;
  const toArchive = messagesWithParts.slice(0, archivalCutoff);
  if (toArchive.length === 0) {
    return {
      ranCompaction: false,
      reason: "nothing eligible for archival",
      tokensBefore: tokens,
    };
  }

  ctx.bus.emit(ctx.sessionId, {
    kind: "compaction.started",
    archivedMessageIds: toArchive.map((m) => m.message.messageId),
    tokensBefore: tokens,
    threshold,
  });

  let model: LanguageModelV1;
  try {
    model = await resolveActiveModel(session, ctx.providerRegistry);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    compactionLogger.warn("compaction.model-resolution-failed", {
      sessionId: ctx.sessionId,
      reason,
    });
    ctx.bus.emit(ctx.sessionId, { kind: "compaction.failed", reason });
    return { ranCompaction: false, reason };
  }

  let summary: string;
  try {
    summary = await summarize(model, toArchive);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    compactionLogger.warn("compaction.summarize-failed", {
      sessionId: ctx.sessionId,
      reason,
    });
    ctx.bus.emit(ctx.sessionId, { kind: "compaction.failed", reason });
    return { ranCompaction: false, reason };
  }

  // Persist the synthetic summary message, attach it as a text part, then
  // archive the originals. The order matters: failures during the archival
  // step would leave both the summary AND the originals visible, which is
  // strictly safer (no lost context) than the reverse.
  const summaryMessage = ctx.store.insertHarnessMessage({
    sessionId: ctx.sessionId,
    role: "system",
  });
  ctx.store.insertHarnessMessagePart({
    messageId: summaryMessage.messageId,
    kind: "text",
    payload: {
      kind: "compaction-summary",
      archivedCount: toArchive.length,
      text: summary,
    },
  });

  const archivedCount = ctx.store.markHarnessMessagesArchived(
    toArchive.map((m) => m.message.messageId),
  );

  ctx.bus.emit(ctx.sessionId, {
    kind: "compaction.summary_inserted",
    summaryMessageId: summaryMessage.messageId,
    archivedCount,
  });

  compactionLogger.info("compaction.complete", {
    sessionId: ctx.sessionId,
    archivedCount,
    tokensBefore: tokens,
    threshold,
  });

  return {
    ranCompaction: true,
    archivedCount,
    summaryMessageId: summaryMessage.messageId,
    tokensBefore: tokens,
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

interface MessageWithParts {
  message: HarnessMessageRecord;
  parts: HarnessMessagePartRecord[];
}

export function estimateTokens(items: MessageWithParts[]): number {
  let total = 0;
  for (const { parts } of items) {
    total += PER_MESSAGE_OVERHEAD_TOKENS;
    for (const part of parts) {
      total += estimatePartTokens(part);
    }
  }
  return total;
}

function estimatePartTokens(part: HarnessMessagePartRecord): number {
  // Very rough byte-per-token heuristic. Good enough for triggering
  // compaction — the alternative is pulling tiktoken in, which we don't want
  // in a local-first package.
  const payload = part.payload;
  if (typeof payload === "string") {
    return Math.ceil(payload.length / 4);
  }
  try {
    return Math.ceil(JSON.stringify(payload).length / 4);
  } catch {
    return 0;
  }
}

function resolveContextWindow(
  session: { activeProvider: string | null; activeModel: string | null },
  registry: ProviderRegistry,
): number {
  if (!session.activeProvider || !session.activeModel) {
    return FALLBACK_CONTEXT_WINDOW;
  }
  const entry = registry.get(session.activeProvider);
  if (!entry) return FALLBACK_CONTEXT_WINDOW;
  const modelSpec = entry.spec.models.find((m) => m.id === session.activeModel);
  return modelSpec?.contextWindow ?? FALLBACK_CONTEXT_WINDOW;
}

async function resolveActiveModel(
  session: { activeProvider: string | null; activeModel: string | null },
  registry: ProviderRegistry,
): Promise<LanguageModelV1> {
  if (!session.activeProvider || !session.activeModel) {
    throw new Error(
      "session has no active provider/model — cannot compact (session was never touched by a real provider)",
    );
  }
  const entry = registry.get(session.activeProvider);
  if (!entry) {
    throw new Error(`provider not in registry: ${session.activeProvider}`);
  }
  const { key } = await registry.resolveApiKey(session.activeProvider);
  return createLanguageModel({ spec: entry.spec, modelId: session.activeModel, apiKey: key });
}

async function summarize(
  model: LanguageModelV1,
  items: MessageWithParts[],
): Promise<string> {
  const transcript = items
    .map(({ message, parts }) => {
      const header = `[${message.role}]`;
      const body = parts
        .map((part) => formatPartForSummary(part))
        .filter((s) => s.length > 0)
        .join("\n");
      return `${header}\n${body}`;
    })
    .join("\n\n");

  const system =
    "You are a compaction summarizer for an agent coding assistant. Condense the conversation below into a concise summary (≤ 500 words) that preserves: decisions made, files touched, tools invoked, unresolved questions, and the user's active intent. Omit small talk. Use short bullet points where natural. Return only the summary — no preamble.";

  const result = await generateText({
    model,
    system,
    prompt: transcript,
    maxTokens: 800,
  });
  return result.text.trim();
}

function formatPartForSummary(part: HarnessMessagePartRecord): string {
  const payload = part.payload;
  if (payload == null) return "";
  if (part.kind === "text") {
    if (typeof payload === "string") return payload;
    if (typeof payload === "object" && "text" in payload && typeof (payload as { text: unknown }).text === "string") {
      return String((payload as { text: string }).text);
    }
  }
  if (part.kind === "tool_call") {
    const p = payload as { tool?: string; args?: unknown };
    return `<tool_call>${p.tool ?? "?"}(${safeJson(p.args)})</tool_call>`;
  }
  if (part.kind === "tool_result") {
    const p = payload as { ok?: boolean; error?: string };
    if (p.ok === false) {
      return `<tool_result ok=false>${p.error ?? "(no error text)"}</tool_result>`;
    }
    return `<tool_result ok=true>(elided)</tool_result>`;
  }
  return `<${part.kind}>(elided)</${part.kind}>`;
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 200 ? `${s.slice(0, 197)}...` : s;
  } catch {
    return "(unserializable)";
  }
}

// Exports for the smoke tests. Not part of the public API; use with care.
export const __compactionInternal = {
  estimateTokens,
  RETAINED_TAIL_MESSAGES,
  PER_MESSAGE_OVERHEAD_TOKENS,
};
