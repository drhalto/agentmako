/**
 * Harness — public entry point for the Roadmap 3 agent layer.
 *
 * Phase 3.0 wired the no-agent tier end to end via the deterministic `ask`
 * router. Phase 3.1 wires the local-agent and cloud-agent tiers through the
 * Vercel `ai` SDK with layered key resolution, per-session fallback chains,
 * and `harness_provider_calls` audit rows for every model invocation.
 *
 * The core still owns no HTTP, no SSE, no stdio, no terminal. Every surface
 * is an adapter over this class.
 */

import {
  type CreateSessionRequest,
  type HarnessEvent,
  type HarnessTier,
  type Session,
  type UpdateSessionRequest,
} from "@mako-ai/harness-contracts";

type ContractFallbackEntry = { provider: string; model: string };
import { createLogger } from "@mako-ai/logger";
import type { CallerKind, ProjectStore, HarnessSessionRecord } from "@mako-ai/store";
import type { ToolServiceOptions } from "@mako-ai/tools";
import { stepCountIs, streamText, type CoreMessage } from "ai";
import { runNoAgentTurn } from "./ask-adapter.js";
import { SessionEventBus, type EmittedSessionEvent } from "./event-bus.js";
import { classifyProviderError } from "./fallback.js";
import { createLanguageModel, ModelFactoryError } from "./model-factory.js";
import { maybeCompact } from "./compaction.js";
import type { CatalogSourceResolver } from "./catalog-source.js";
import { computeCallCostMicro, lookupModelCost } from "./cost.js";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { resolveEmbedding, type EmbeddingResolutionResult } from "./embedding-resolver.js";
import { PermissionEngine, type PermissionScope } from "./permission-engine.js";
import { ProviderRegistry } from "./provider-registry.js";
import { resumeSession, type ResumeResult } from "./resume.js";
import { resolveTierFromConfig } from "./tier-resolver.js";
import { PermissionDeniedError, ToolDispatch } from "./tool-dispatch.js";

const harnessLogger = createLogger("mako-harness");

const DEFAULT_PROVIDER_TIMEOUT_MS = Number.parseInt(
  process.env.MAKO_HARNESS_PROVIDER_TIMEOUT ?? "120000",
  10,
);

/**
 * Phase 3.4: the harness semver stamped onto `harness_sessions.harness_version`
 * at session-creation time. `Harness.resume()` compares the stored value's
 * major component against this constant and refuses to resume on mismatch.
 *
 * Bump the major component when `harness_session_events` semantics change in
 * a way that would make replay unsafe against older event streams.
 */
export const HARNESS_VERSION = "1.0.0";

export interface HarnessOptions {
  store: ProjectStore;
  toolOptions?: ToolServiceOptions;
  /**
   * Optional injected provider registry. When omitted the harness builds one
   * from the bundled catalog and the optional project/global config files.
   */
  providerRegistry?: ProviderRegistry;
  /** Optional injected permission engine. When omitted, built from the store + projectRoot. */
  permissionEngine?: PermissionEngine;
  /** Project root used to load `.mako/providers.json` and `.mako/permissions.json`. Default: cwd. */
  projectRoot?: string;
  /** Global config dir used to load `~/.mako/*` equivalents. */
  globalConfigDir?: string;
  /** Maximum tool-calling iterations per turn (ai SDK `maxSteps`). Default: 10. */
  maxSteps?: number;
  /**
   * Phase 3.9: optional catalog resolver for cost-at-write-time lookups.
   * When present, `harness_provider_calls.cost_usd_micro` is populated from
   * the active catalog's rates for the `(provider, model)` pair. When
   * absent, cost stays NULL and the rest of the provider-call row is still
   * persisted — cost is a best-effort annotation, never a turn blocker.
   */
  catalogSource?: CatalogSourceResolver;
}

/**
 * Phase 3.9: per-turn options exposed to non-web callers (Codex, Claude
 * Code, OpenCode, MCP-style clients, future backend automation). The
 * harness default tags turns as `"chat"` — the Vite web UI can omit this
 * entirely. Non-web callers pass `{ caller: { kind: "agent" } }` so the
 * recorded `harness_provider_calls` row can be rolled up as agent origin
 * in the `/usage` report.
 */
export interface PostMessageOptions {
  caller?: { kind: CallerKind };
}

export interface PostMessageResult {
  messageId: string;
  started: true;
}

interface FallbackChainEntry {
  provider: string;
  model: string;
}

const AUTO_TITLE_MAX_LENGTH = 72;
const AUTO_TITLE_LEADING = new Set(["`", '"', "'", "(", "[", "{", "<", " ", "\t", "\n", "\r"]);
const AUTO_TITLE_TRAILING = new Set([
  "`", '"', "'", ")", "]", "}", ">", ".", ",", "!", "?", ";", ":", " ", "\t", "\n", "\r",
]);

function deriveAutoTitle(content: string): string | null {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  let start = 0;
  while (start < normalized.length && AUTO_TITLE_LEADING.has(normalized.charAt(start))) start++;
  let end = normalized.length;
  while (end > start && AUTO_TITLE_TRAILING.has(normalized.charAt(end - 1))) end--;
  const stripped = normalized.slice(start, end);
  const base = stripped.length > 0 ? stripped : normalized;
  if (base.length <= AUTO_TITLE_MAX_LENGTH) return base;

  const truncated = base.slice(0, AUTO_TITLE_MAX_LENGTH + 1);
  const cutoff = truncated.lastIndexOf(" ");
  const safe =
    cutoff >= 24 ? truncated.slice(0, cutoff).trimEnd() : truncated.slice(0, AUTO_TITLE_MAX_LENGTH).trimEnd();
  return `${safe}…`;
}

function toSession(record: HarnessSessionRecord): Session {
  return {
    id: record.sessionId,
    projectId: record.projectId,
    parentId: record.parentId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    title: record.title,
    tier: record.tier,
    activeProvider: record.activeProvider,
    activeModel: record.activeModel,
    fallbackChain: record.fallbackChain,
    status: record.status,
  };
}

export class Harness {
  readonly bus: SessionEventBus;
  readonly providerRegistry: ProviderRegistry;
  readonly permissionEngine: PermissionEngine;

  private embeddingProviderPromise: Promise<EmbeddingResolutionResult> | null = null;

  constructor(private readonly options: HarnessOptions) {
    this.bus = new SessionEventBus(options.store);
    this.providerRegistry =
      options.providerRegistry ??
      new ProviderRegistry({
        projectRoot: options.projectRoot,
        globalConfigDir: options.globalConfigDir,
      });
    this.permissionEngine =
      options.permissionEngine ??
      new PermissionEngine({
        store: options.store,
        projectRoot: options.projectRoot,
        globalConfigDir: options.globalConfigDir,
      });
  }

  /**
   * Resolve (and cache) an embedding provider for this harness instance.
   * Returns the resolution result either way — callers inspect `ok` to see
   * whether memory tools have a semantic path or will fall back to FTS.
   */
  async resolveEmbeddingProvider(): Promise<EmbeddingResolutionResult> {
    if (!this.embeddingProviderPromise) {
      this.embeddingProviderPromise = resolveEmbedding({
        projectRoot: this.options.projectRoot,
        globalConfigDir: this.options.globalConfigDir,
        registry: this.providerRegistry,
      });
    }
    return this.embeddingProviderPromise;
  }

  /** Internal helper used by the turn loop; returns an `EmbeddingProvider` or null. */
  private async getEmbeddingProviderOrNull(): Promise<EmbeddingProvider | null> {
    const result = await this.resolveEmbeddingProvider();
    return result.ok ? result.provider : null;
  }

  /**
   * Resolve a pending `permission.request` for a session — called by the HTTP
   * route `POST /api/v1/permissions/requests/:id` and by the CLI prompt.
   * Returns `true` if a matching request was found and resolved.
   */
  resolvePermissionRequest(
    sessionId: string,
    requestId: string,
    decision: { action: "allow" | "deny"; scope: PermissionScope },
  ): boolean {
    const ok = ToolDispatch.resolveApproval(sessionId, requestId, decision);
    if (ok) {
      this.bus.emit(sessionId, {
        kind: "permission.decision",
        requestId,
        action: decision.action,
        scope: decision.scope,
      });
    }
    return ok;
  }

  listPendingApprovals(sessionId: string): ReturnType<typeof ToolDispatch.listPending> {
    return ToolDispatch.listPending(sessionId);
  }

  async createSession(input: CreateSessionRequest = {}): Promise<Session> {
    const fallbackChain = input.fallbackChain ?? [];
    const primary = fallbackChain[0];
    const tier: HarnessTier =
      input.tier ??
      (
        await resolveTierFromConfig({
          providerRegistry: this.providerRegistry,
          projectRoot: this.options.projectRoot,
          globalConfigDir: this.options.globalConfigDir,
        })
      ).current;
    const record = this.options.store.createHarnessSession({
      projectId: input.projectId ?? null,
      parentId: input.parentId ?? null,
      title: input.title ?? null,
      tier,
      activeProvider: input.provider ?? primary?.provider ?? null,
      activeModel: input.model ?? primary?.model ?? null,
      fallbackChain,
      harnessVersion: HARNESS_VERSION,
    });
    const session = toSession(record);
    this.bus.emit(session.id, { kind: "session.created", sessionId: session.id });
    harnessLogger.info("session.created", { sessionId: session.id, tier: session.tier });
    return session;
  }

  getSession(sessionId: string): Session | null {
    const record = this.options.store.getHarnessSession(sessionId);
    return record ? toSession(record) : null;
  }

  updateSession(sessionId: string, input: UpdateSessionRequest = {}): Session {
    const existing = this.options.store.getHarnessSession(sessionId);
    if (!existing) {
      throw new Error(`harness-core/session-not-found: ${sessionId}`);
    }
    const nextFallbackChain =
      input.fallbackChain ??
      (input.provider && input.model
        ? [{ provider: input.provider, model: input.model }]
        : existing.fallbackChain);
    const record = this.options.store.updateHarnessSession(sessionId, {
      tier: input.tier ?? existing.tier,
      activeProvider:
        input.provider === undefined ? existing.activeProvider : input.provider,
      activeModel: input.model === undefined ? existing.activeModel : input.model,
      fallbackChain: nextFallbackChain,
      status: "active",
    });
    return toSession(record);
  }

  listSessions(options: { projectId?: string | null; limit?: number } = {}): Session[] {
    const records = this.options.store.listHarnessSessions(options);
    return records.map(toSession);
  }

  deleteSession(sessionId: string): void {
    this.options.store.deleteHarnessSession(sessionId);
  }

  /**
   * Replay `harness_session_events` to rehydrate any caller-observable state,
   * emit a `resume.pending_approvals` event if any `permission.request` rows
   * were left unresolved, and return the last-known ordinal so SSE clients
   * can pick up from there.
   *
   * No tools are re-invoked. Conversation state lives in
   * `harness_messages` + `harness_message_parts` and is already durable.
   */
  async resume(sessionId: string): Promise<ResumeResult> {
    return resumeSession({
      sessionId,
      store: this.options.store,
      bus: this.bus,
    });
  }

  listMessages(sessionId: string): {
    messages: Array<{
      id: string;
      role: string;
      archived: boolean;
      parts: Array<{ kind: string; payload: unknown }>;
    }>;
    archivedCount: number;
  } {
    const rows = this.options.store.listHarnessMessages(sessionId);
    const messages = rows.map((m) => {
      const parts = this.options.store.listHarnessMessageParts(m.messageId).map((p) => ({
        kind: p.kind,
        payload: p.payload,
      }));
      return { id: m.messageId, role: m.role, archived: m.archived, parts };
    });
    const archivedCount = messages.filter((m) => m.archived).length;
    return { messages, archivedCount };
  }

  /**
   * Archive a starting-from message plus every later non-archived
   * message in the same session. Used by the chat UI's edit-and-resend
   * affordance: archives the user message at `fromMessageId` plus every
   * subsequent assistant reply so the next `postMessage` continues
   * from the pre-edit state.
   *
   * Archiving is the same non-destructive path Phase 3.4 compaction
   * uses — rows stay in `harness_messages` for audit, `listMessages`
   * filters them out, and `buildHistory` skips them when assembling
   * model context.
   */
  truncateMessagesFromId(
    sessionId: string,
    fromMessageId: string,
  ): { archived: number; fromOrdinal: number | null } {
    const session = this.options.store.getHarnessSession(sessionId);
    if (!session) {
      throw new Error(`session-not-found: ${sessionId}`);
    }
    const rows = this.options.store.listHarnessMessages(sessionId);
    const anchor = rows.find((m) => m.messageId === fromMessageId);
    if (!anchor) {
      throw new Error(`message-not-found: ${fromMessageId}`);
    }
    const fromOrdinal = anchor.ordinal;
    const ids = rows
      .filter((m) => !m.archived && m.ordinal >= fromOrdinal)
      .map((m) => m.messageId);
    if (ids.length === 0) return { archived: 0, fromOrdinal };
    const archived = this.options.store.markHarnessMessagesArchived(ids);
    return { archived, fromOrdinal };
  }

  replayEvents(sessionId: string, afterOrdinal?: number): EmittedSessionEvent[] {
    return this.bus.replay(sessionId, afterOrdinal);
  }

  /**
   * Post a user message and schedule a turn to run. The turn executes
   * asynchronously — callers subscribe to events via `bus.subscribe(sessionId)`
   * or poll `replayEvents(sessionId, afterOrdinal)` to observe progress.
   */
  postMessage(
    sessionId: string,
    content: string,
    options: PostMessageOptions = {},
  ): PostMessageResult {
    const session = this.options.store.getHarnessSession(sessionId);
    if (!session) {
      throw new Error(`harness-core/session-not-found: ${sessionId}`);
    }
    const callerKind: CallerKind = options.caller?.kind ?? "chat";

    const autoTitle = session.title ? null : deriveAutoTitle(content);
    this.options.store.updateHarnessSession(sessionId, {
      title: autoTitle ?? undefined,
      status: "active",
    });

    const userMessage = this.options.store.insertHarnessMessage({
      sessionId,
      role: "user",
    });
    this.options.store.insertHarnessMessagePart({
      messageId: userMessage.messageId,
      kind: "text",
      payload: { text: content },
    });
    this.bus.emit(sessionId, {
      kind: "message.created",
      messageId: userMessage.messageId,
      role: "user",
    });
    // Phase 3.5: emit the user text into the event stream so stream-only
    // clients (the web dashboard) can render it from SSE alone. The part
    // is also persisted to harness_message_parts above, which is the
    // durable source of truth; this event is the wire-level mirror.
    this.bus.emit(sessionId, {
      kind: "text.delta",
      messageId: userMessage.messageId,
      text: content,
    });

    void this.runTurn(sessionId, session.tier, content, callerKind).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      harnessLogger.warn("turn.failed", { sessionId, error: message });
      this.bus.emit(sessionId, { kind: "error", code: "turn-failed", message });
    });

    return { messageId: userMessage.messageId, started: true };
  }

  private buildHistory(sessionId: string): CoreMessage[] {
    // Phase 3.4: exclude compaction-archived messages from model context.
    // The compaction summary (a synthetic `system` message) and any
    // post-compaction turns remain and are passed through.
    const messages = this.options.store.listHarnessMessages(sessionId, {
      includeArchived: false,
    });
    const out: CoreMessage[] = [];
    for (const m of messages) {
      if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") continue;
      const parts = this.options.store.listHarnessMessageParts(m.messageId);
      const text = parts
        .filter((p) => p.kind === "text")
        .map((p) => {
          const payload = p.payload as { text?: string } | null;
          return payload?.text ?? "";
        })
        .join("");
      if (text.length === 0) continue;
      out.push({ role: m.role, content: text } as CoreMessage);
    }
    return out;
  }

  private resolveFallbackChain(session: HarnessSessionRecord): FallbackChainEntry[] {
    if (session.fallbackChain.length > 0) {
      return session.fallbackChain.map((e: ContractFallbackEntry) => ({
        provider: e.provider,
        model: e.model,
      }));
    }
    if (session.activeProvider && session.activeModel) {
      return [{ provider: session.activeProvider, model: session.activeModel }];
    }
    return [];
  }

  private async runTurn(
    sessionId: string,
    tier: HarnessTier,
    content: string,
    callerKind: CallerKind,
  ): Promise<void> {
    const session = this.options.store.getHarnessSession(sessionId);
    if (!session) return;

    const assistantMessage = this.options.store.insertHarnessMessage({
      sessionId,
      role: "assistant",
    });
    this.bus.emit(sessionId, {
      kind: "message.created",
      messageId: assistantMessage.messageId,
      role: "assistant",
    });

    if (tier === "no-agent") {
      const reply = await runNoAgentTurn(content, {
        projectId: session.projectId ?? undefined,
        toolOptions: this.options.toolOptions,
      });
      this.persistAssistantText(assistantMessage.messageId, reply.text);
      this.bus.emit(sessionId, {
        kind: "text.delta",
        messageId: assistantMessage.messageId,
        text: reply.text,
      });
      this.bus.emit(sessionId, {
        kind: "turn.done",
        messageId: assistantMessage.messageId,
      });
      return;
    }

    // local-agent / cloud-agent path
    const chain = this.resolveFallbackChain(session);
    if (chain.length === 0) {
      const message =
        `Session is at tier \`${tier}\` but has no provider/model configured. ` +
        `Set \`active_provider\` and \`active_model\` (or pass \`provider\`/\`model\` on POST /sessions).`;
      this.persistAssistantText(assistantMessage.messageId, message);
      this.bus.emit(sessionId, {
        kind: "text.delta",
        messageId: assistantMessage.messageId,
        text: message,
      });
      this.bus.emit(sessionId, {
        kind: "error",
        code: "no-provider-configured",
        message,
      });
      this.bus.emit(sessionId, {
        kind: "turn.done",
        messageId: assistantMessage.messageId,
      });
      return;
    }

    const history = this.buildHistory(sessionId);
    let accumulated = "";
    let lastError: { code: string; message: string } | null = null;

    const embeddingProvider = await this.getEmbeddingProviderOrNull();

    const dispatch = new ToolDispatch({
      store: this.options.store,
      bus: this.bus,
      engine: this.permissionEngine,
      projectId: session.projectId,
      context: {
        projectRoot: this.options.projectRoot ?? process.cwd(),
        sessionId,
        messageOrdinal: assistantMessage.ordinal,
      },
      memoryContext: {
        store: this.options.store,
        projectId: session.projectId,
        embeddingProvider,
      },
      subAgentContext: {
        harness: this,
        store: this.options.store,
        parentSessionId: sessionId,
      },
      toolServiceOptions: {
        ...this.options.toolOptions,
        requestContext: {
          ...this.options.toolOptions?.requestContext,
          sessionProjectId:
            session.projectId ?? this.options.toolOptions?.requestContext?.sessionProjectId,
        },
      },
      persistToolPart: (kind, payload) => {
        this.options.store.insertHarnessMessagePart({
          messageId: assistantMessage.messageId,
          kind,
          payload,
        });
      },
    });

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i]!;
      const startedAt = Date.now();
      try {
        const resolved = this.providerRegistry.get(entry.provider);
        if (!resolved) {
          throw new Error(`provider-not-found: ${entry.provider}`);
        }
        const { key } = await this.providerRegistry.resolveApiKey(entry.provider);
        const model = createLanguageModel({
          spec: resolved.spec,
          modelId: entry.model,
          apiKey: key,
        });

        const result = streamText({
          model,
          messages: history,
          tools: dispatch.tools,
          stopWhen: stepCountIs(this.options.maxSteps ?? 10),
          abortSignal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
        });

        for await (const delta of result.textStream) {
          if (delta.length === 0) continue;
          accumulated += delta;
          this.bus.emit(sessionId, {
            kind: "text.delta",
            messageId: assistantMessage.messageId,
            text: delta,
          });
        }

        const usage = await result.usage.catch(() => undefined);
        const latencyMs = Date.now() - startedAt;
        const tokens = extractTokenBreakdown(usage);
        const costUsdMicro = await this.computeProviderCallCost(entry.provider, entry.model, tokens);
        this.options.store.insertHarnessProviderCall({
          sessionId,
          provider: entry.provider,
          model: entry.model,
          promptTokens: tokens.promptTokens,
          completionTokens: tokens.completionTokens,
          reasoningTokens: tokens.reasoningTokens,
          cacheReadTokens: tokens.cacheReadTokens,
          cacheWriteTokens: tokens.cacheWriteTokens,
          latencyMs,
          costUsdMicro,
          callerKind,
          ok: true,
        });
        this.bus.emit(sessionId, {
          kind: "provider.call",
          provider: entry.provider,
          model: entry.model,
          latencyMs,
          ok: true,
        });

        this.persistAssistantText(assistantMessage.messageId, accumulated);
        this.bus.emit(sessionId, {
          kind: "turn.done",
          messageId: assistantMessage.messageId,
        });
        await this.tryCompact(sessionId);
        return;
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const classification = classifyProviderError(error);
        const errorMsg =
          error instanceof ModelFactoryError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        this.options.store.insertHarnessProviderCall({
          sessionId,
          provider: entry.provider,
          model: entry.model,
          latencyMs,
          callerKind,
          ok: false,
          errorText: errorMsg,
        });
        this.bus.emit(sessionId, {
          kind: "provider.call",
          provider: entry.provider,
          model: entry.model,
          latencyMs,
          ok: false,
        });
        harnessLogger.warn("provider.call.failed", {
          sessionId,
          provider: entry.provider,
          model: entry.model,
          kind: classification.kind,
          error: errorMsg,
        });
        lastError = {
          code: `provider/${classification.kind}`,
          message: `\`${entry.provider}/${entry.model}\`: ${errorMsg}`,
        };
        if (!classification.shouldFallover) break;
        // exponential backoff between fallback entries
        if (i + 1 < chain.length) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** i, 2000)));
        }
      }
    }

    const message = lastError
      ? `Provider chain exhausted. Last error: ${lastError.message}`
      : "Provider chain exhausted with no successful response.";
    this.persistAssistantText(assistantMessage.messageId, message);
    this.bus.emit(sessionId, {
      kind: "text.delta",
      messageId: assistantMessage.messageId,
      text: message,
    });
    if (lastError) {
      const errorEvent: HarnessEvent = {
        kind: "error",
        code: lastError.code,
        message: lastError.message,
      };
      this.bus.emit(sessionId, errorEvent);
    }
    this.bus.emit(sessionId, {
      kind: "turn.done",
      messageId: assistantMessage.messageId,
    });
  }

  private persistAssistantText(messageId: string, text: string): void {
    this.options.store.insertHarnessMessagePart({
      messageId,
      kind: "text",
      payload: { text },
    });
  }

  /**
   * Phase 3.4: fire-and-forget compaction check after a successful turn.
   * No-op for sessions without an active provider (no-agent tier, or a
   * session that has never received a real model response). Exceptions are
   * logged and swallowed — compaction is best-effort, never a turn blocker.
   */
  private async tryCompact(sessionId: string): Promise<void> {
    const session = this.options.store.getHarnessSession(sessionId);
    if (!session || !session.activeProvider || !session.activeModel) return;
    try {
      await maybeCompact({
        sessionId,
        store: this.options.store,
        bus: this.bus,
        providerRegistry: this.providerRegistry,
      });
    } catch (error) {
      harnessLogger.warn("compaction.unexpected-error", {
        sessionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Phase 3.9: compute cost for a provider call against the active catalog.
   * Returns null if no catalog resolver was configured or the catalog has no
   * rates for this (provider, model). Never throws — cost is a best-effort
   * annotation, the provider-call row is persisted either way.
   */
  private async computeProviderCallCost(
    providerId: string,
    modelId: string,
    tokens: TokenBreakdown,
  ): Promise<number | null> {
    if (!this.options.catalogSource) return null;
    try {
      const catalog = await this.options.catalogSource.resolve();
      const rates = lookupModelCost(catalog, providerId, modelId);
      return computeCallCostMicro(tokens, rates);
    } catch {
      return null;
    }
  }
}

interface TokenBreakdown {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

/**
 * Phase 3.9: pull every token kind we care about out of the ai SDK v4 usage
 * object. The ai SDK v4 surfaces `promptTokens` + `completionTokens`
 * canonically; reasoning + cache tokens are passed through
 * `providerMetadata.*.cachedInputTokens` / `reasoningTokens` when the
 * provider includes them. We read defensively — any missing field stays
 * null rather than defaulting to 0 so the usage UI can distinguish "no
 * data" from "zero tokens".
 */
function extractTokenBreakdown(usage: unknown): TokenBreakdown {
  const out: TokenBreakdown = {
    promptTokens: null,
    completionTokens: null,
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  };
  if (!usage || typeof usage !== "object") return out;
  const record = usage as Record<string, unknown>;
  if (typeof record.promptTokens === "number") out.promptTokens = record.promptTokens;
  if (typeof record.completionTokens === "number") out.completionTokens = record.completionTokens;
  if (typeof record.reasoningTokens === "number") out.reasoningTokens = record.reasoningTokens;
  if (typeof record.cachedInputTokens === "number") out.cacheReadTokens = record.cachedInputTokens;
  // ai SDK v4 exposes `providerMetadata.anthropic.{cacheReadInputTokens,cacheCreationInputTokens}`
  // for Anthropic and `providerMetadata.openai.cachedPromptTokens` for OpenAI. Pull those
  // through when present — the names differ but the semantics match.
  const meta = record.providerMetadata;
  if (meta && typeof meta === "object") {
    const metaRec = meta as Record<string, unknown>;
    for (const providerMeta of Object.values(metaRec)) {
      if (!providerMeta || typeof providerMeta !== "object") continue;
      const pm = providerMeta as Record<string, unknown>;
      if (typeof pm.cacheReadInputTokens === "number" && out.cacheReadTokens === null) {
        out.cacheReadTokens = pm.cacheReadInputTokens;
      }
      if (typeof pm.cachedPromptTokens === "number" && out.cacheReadTokens === null) {
        out.cacheReadTokens = pm.cachedPromptTokens;
      }
      if (typeof pm.cacheCreationInputTokens === "number" && out.cacheWriteTokens === null) {
        out.cacheWriteTokens = pm.cacheCreationInputTokens;
      }
      if (typeof pm.reasoningTokens === "number" && out.reasoningTokens === null) {
        out.reasoningTokens = pm.reasoningTokens;
      }
    }
  }
  return out;
}

export function createHarness(options: HarnessOptions): Harness {
  return new Harness(options);
}
