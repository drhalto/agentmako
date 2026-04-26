/**
 * Harness contracts — zod schemas for sessions, messages, parts, events,
 * providers, permissions, and tier metadata.
 *
 * These types are consumed by `@mako-ai/harness-core`, `@mako-ai/harness-tools`,
 * `services/harness`, and any client (CLI, web UI, MCP bridge) that drives the
 * harness. Keep this file the single source of truth for the harness data
 * model — do not duplicate shapes in the core package.
 */

import { z } from "zod";

// -----------------------------------------------------------------------------
// Tier
// -----------------------------------------------------------------------------

export const HarnessTierSchema = z.enum(["no-agent", "local-agent", "cloud-agent"]);
export type HarnessTier = z.infer<typeof HarnessTierSchema>;

export const TierResolutionSchema = z.object({
  current: HarnessTierSchema,
  reason: z.string(),
  upgradePath: z.array(z.string()).default([]),
});
export type TierResolution = z.infer<typeof TierResolutionSchema>;

// -----------------------------------------------------------------------------
// Provider (real population lands in Phase 3.1; schemas are stable now)
// -----------------------------------------------------------------------------

export const ProviderKindSchema = z.enum(["chat", "embedding", "both"]);
export const ProviderTransportSchema = z.enum([
  "anthropic",
  "openai",
  "openai-compatible",
  "google",
  "mistral",
  "ollama",
  "none",
]);
export const ProviderAuthSchema = z.enum(["api-key", "oauth", "none"]);

export const ModelSpecSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  contextWindow: z.number().int().positive(),
  supportsTools: z.boolean(),
  supportsVision: z.boolean(),
  supportsReasoning: z.boolean(),
  /**
   * Phase 3.9: runtime-only hint for local-daemon discovery. When true, the
   * model came from a live probe instead of the bundled/catalog list.
   */
  discovered: z.boolean().optional(),
  costHint: z
    .object({
      input: z.number(),
      output: z.number(),
    })
    .optional(),
  tier: z.enum(["local", "cloud"]),
});
export type ModelSpec = z.infer<typeof ModelSpecSchema>;

export const ProviderSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProviderKindSchema,
  transport: ProviderTransportSchema,
  baseURL: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  auth: ProviderAuthSchema,
  headers: z.record(z.string()).optional(),
  /** Env vars consulted (in order) when resolving an API key for this provider. */
  envVarHints: z.array(z.string()).default([]),
  /** Human-readable note shown in `agentmako providers list` and the docs. */
  note: z.string().optional(),
  models: z.array(ModelSpecSchema).default([]),
  tier: z.enum(["local", "cloud"]),
});
export type ProviderSpec = z.infer<typeof ProviderSpecSchema>;

// -----------------------------------------------------------------------------
// Permissions (evaluator logic lands in Phase 3.2; schemas are stable now)
// -----------------------------------------------------------------------------

export const PermissionActionSchema = z.enum(["allow", "deny", "ask"]);
export const PermissionScopeSchema = z.enum(["turn", "session", "project", "global"]);

export const PermissionRuleSchema = z.object({
  permission: z.string(),
  pattern: z.string(),
  action: PermissionActionSchema,
  scope: PermissionScopeSchema.default("project"),
});
export type PermissionRule = z.infer<typeof PermissionRuleSchema>;

export const PermissionDecisionSchema = z.object({
  sessionId: z.string(),
  toolName: z.string(),
  pattern: z.string(),
  action: PermissionActionSchema,
  scope: PermissionScopeSchema,
  rememberedAt: z.string(),
});
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

// -----------------------------------------------------------------------------
// Sessions, messages, parts
// -----------------------------------------------------------------------------

export const SessionStatusSchema = z.enum(["active", "idle", "closed", "error"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessagePartKindSchema = z.enum([
  "text",
  "tool_call",
  "tool_result",
  "reasoning",
  "error",
]);
export type MessagePartKind = z.infer<typeof MessagePartKindSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  parentId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  title: z.string().nullable(),
  tier: HarnessTierSchema,
  activeProvider: z.string().nullable(),
  activeModel: z.string().nullable(),
  fallbackChain: z.array(z.object({ provider: z.string(), model: z.string() })).default([]),
  status: SessionStatusSchema,
});
export type Session = z.infer<typeof SessionSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  parentId: z.string().nullable(),
  role: MessageRoleSchema,
  createdAt: z.string(),
  ordinal: z.number().int().nonnegative(),
});
export type Message = z.infer<typeof MessageSchema>;

export const MessagePartSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  kind: MessagePartKindSchema,
  ordinal: z.number().int().nonnegative(),
  payload: z.unknown(),
});
export type MessagePart = z.infer<typeof MessagePartSchema>;

export const SessionUsageSnapshotSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  /** Phase 3.9: reasoning tokens for models that expose them (Claude 3.7, GPT-o). */
  reasoningTokens: z.number().int().nonnegative().nullable().default(null),
  /** Phase 3.9: prompt-cache-hit tokens (charged at reduced rate by the provider). */
  cacheReadTokens: z.number().int().nonnegative().nullable().default(null),
  /** Phase 3.9: prompt-cache-write tokens. */
  cacheWriteTokens: z.number().int().nonnegative().nullable().default(null),
  /** Phase 3.9: session spend in micro-USD (1 USD = 1_000_000). */
  costUsdMicro: z.number().int().nonnegative().nullable().default(null),
  contextTokens: z.number().int().nonnegative(),
  contextWindow: z.number().int().positive().nullable(),
  contextUtilization: z.number().nonnegative().nullable(),
});
export type SessionUsageSnapshot = z.infer<typeof SessionUsageSnapshotSchema>;

// -----------------------------------------------------------------------------
// Harness events (SSE / WS wire format)
// -----------------------------------------------------------------------------

export const HarnessEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session.created"),
    sessionId: z.string(),
  }),
  z.object({
    kind: z.literal("message.created"),
    messageId: z.string(),
    role: MessageRoleSchema,
  }),
  z.object({
    kind: z.literal("text.delta"),
    messageId: z.string(),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("tool.call"),
    callId: z.string(),
    tool: z.string(),
    argsPreview: z.unknown(),
  }),
  z.object({
    kind: z.literal("tool.result"),
    callId: z.string(),
    ok: z.boolean(),
    resultPreview: z.unknown(),
  }),
  z.object({
    kind: z.literal("permission.request"),
    requestId: z.string(),
    tool: z.string(),
    preview: z.unknown(),
  }),
  z.object({
    kind: z.literal("permission.decision"),
    requestId: z.string(),
    action: z.enum(["allow", "deny"]),
    scope: PermissionScopeSchema,
  }),
  z.object({
    kind: z.literal("provider.call"),
    provider: z.string(),
    model: z.string(),
    latencyMs: z.number(),
    ok: z.boolean(),
  }),
  z.object({
    kind: z.literal("turn.done"),
    messageId: z.string(),
  }),
  z.object({
    kind: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
  // ---- Phase 3.4: sub-agent + compaction + resume event kinds ----
  z.object({
    kind: z.literal("sub_agent.started"),
    callId: z.string(),
    childSessionId: z.string(),
    parentSessionId: z.string(),
    inheritPermissions: z.enum(["none", "turn", "full"]),
  }),
  z.object({
    kind: z.literal("sub_agent.finished"),
    callId: z.string(),
    childSessionId: z.string(),
    ok: z.boolean(),
    /** Short text summary returned as the tool_result payload. */
    summary: z.string(),
    /** When the child exhausted its budget rather than completing. */
    budgetExhausted: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("compaction.started"),
    /** Snapshot of the messageIds about to be archived. */
    archivedMessageIds: z.array(z.string()),
    /** Token count estimate at trigger time. */
    tokensBefore: z.number().int().nonnegative(),
    /** Configured threshold (fraction of context window) that tripped. */
    threshold: z.number(),
  }),
  z.object({
    kind: z.literal("compaction.summary_inserted"),
    /** The synthetic system-role message that carries the summary. */
    summaryMessageId: z.string(),
    /** How many turns were rolled into the summary. */
    archivedCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("compaction.failed"),
    reason: z.string(),
  }),
  z.object({
    kind: z.literal("resume.pending_approvals"),
    requestIds: z.array(z.string()),
    /** Brief reason — included so UIs can show "these were abandoned when the process died". */
    note: z.string(),
  }),
]);
export type HarnessEvent = z.infer<typeof HarnessEventSchema>;

export const SessionEventRowSchema = z.object({
  sessionId: z.string(),
  ordinal: z.number().int().nonnegative(),
  event: HarnessEventSchema,
  createdAt: z.string(),
});
export type SessionEventRow = z.infer<typeof SessionEventRowSchema>;

// -----------------------------------------------------------------------------
// HTTP request/response shapes (pure types — transports validate with zod)
// -----------------------------------------------------------------------------

const CreateSessionRequestInputSchema = z.object({
  projectId: z.string().optional(),
  /** Phase 3.4: set when a child session is being spawned by `sub_agent_spawn`. */
  parentId: z.string().optional(),
  tier: HarnessTierSchema.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  title: z.string().optional(),
  fallbackChain: z
    .array(z.object({ provider: z.string().min(1), model: z.string().min(1) }))
    .optional(),
  fallback_chain: z
    .array(z.object({ provider: z.string().min(1), model: z.string().min(1) }))
    .optional(),
});

export const CreateSessionRequestSchema = CreateSessionRequestInputSchema.transform(
  (input: z.input<typeof CreateSessionRequestInputSchema>) => {
    const { fallback_chain, fallbackChain, ...rest } = input;
    return {
      ...rest,
      fallbackChain: fallbackChain ?? fallback_chain ?? [],
    };
  },
);
export type CreateSessionRequest = z.input<typeof CreateSessionRequestSchema>;

const UpdateSessionRequestInputSchema = z.object({
  tier: HarnessTierSchema.optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  fallbackChain: z
    .array(z.object({ provider: z.string().min(1), model: z.string().min(1) }))
    .optional(),
  fallback_chain: z
    .array(z.object({ provider: z.string().min(1), model: z.string().min(1) }))
    .optional(),
});

export const UpdateSessionRequestSchema = UpdateSessionRequestInputSchema.transform(
  (input: z.input<typeof UpdateSessionRequestInputSchema>) => {
    const { fallback_chain, fallbackChain, ...rest } = input;
    return {
      ...rest,
      fallbackChain: fallbackChain ?? fallback_chain,
    };
  },
);
export type UpdateSessionRequest = z.input<typeof UpdateSessionRequestSchema>;

/**
 * Phase 3.9: `caller.kind` classifies the origin of a posted turn for the
 * `harness_provider_calls.caller_kind` column and the `/usage` rollup.
 *
 *   - `"chat"` — turns from the Vite web chat surface (default; the web UI
 *     does not need to set this explicitly).
 *   - `"agent"` — turns from non-web agent clients / runtimes (Codex,
 *     Claude Code, OpenCode, MCP-style callers, backend automation,
 *     sub-agent spawns within the harness).
 */
export const CallerKindSchema = z.enum(["agent", "chat"]);
export type CallerKind = z.infer<typeof CallerKindSchema>;

export const PostMessageRequestSchema = z.object({
  content: z.string().min(1),
  caller: z
    .object({
      kind: CallerKindSchema.default("chat"),
    })
    .optional(),
});
export type PostMessageRequest = z.infer<typeof PostMessageRequestSchema>;
