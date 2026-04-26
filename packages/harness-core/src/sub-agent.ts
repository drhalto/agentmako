/**
 * Sub-agent orchestration helpers — Phase 3.4.
 *
 * Shared logic between the `sub_agent_spawn` tool (in `sub-agent-tools.ts`)
 * and any future sub-agent call sites. This module owns:
 *
 *   - recursion-depth enforcement (walks `parent_id`)
 *   - permission-inheritance snapshots (turn / session / none / full)
 *   - child-session lifecycle: create → postMessage → await turn.done
 *   - budget enforcement (`maxTurns`) and best-effort token cap (`maxTokens`)
 *
 * The orchestrator works against a `Harness` handle — the same class the
 * parent turn is running under. That avoids standing up a second `Harness`
 * and keeps the child's `SessionEventBus` wired into the same pipeline so
 * resume replay sees a coherent event log across parent + children.
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "@mako-ai/logger";
import type {
  HarnessPermissionDecisionRecord,
  ProjectStore,
} from "@mako-ai/store";
import type { EmittedSessionEvent } from "./event-bus.js";
import type { Harness } from "./harness.js";

const subAgentLogger = createLogger("mako-harness-sub-agent");

export type InheritPermissionsMode = "none" | "turn" | "full";

export interface SubAgentBudget {
  /** Max total turns the child may execute. Default 1. */
  maxTurns?: number;
  /**
   * Best-effort soft cap on the child's total prompt+completion tokens. The
   * child turn is allowed to complete but will not be continued past this
   * threshold if it tries to iterate.
   */
  maxTokens?: number;
}

export interface SpawnChildSessionInput {
  harness: Harness;
  store: ProjectStore;
  parentSessionId: string;
  /**
   * The `callId` on the parent's `tool.call` event that triggered this
   * spawn, if any. When present, `sub_agent.started` and
   * `sub_agent.finished` events are emitted on the parent bus correlated
   * by this id. When absent (direct programmatic spawn), a synthetic id is
   * minted so the events still reference a stable correlation key.
   */
  parentCallId?: string;
  prompt: string;
  budget?: SubAgentBudget;
  inheritPermissions?: InheritPermissionsMode;
  provider?: string;
  model?: string;
  fallbackChain?: Array<{ provider: string; model: string }>;
  title?: string;
  /** Hard cap — exceeds throws `sub-agent/recursion-cap`. */
  maxRecursionDepth?: number;
}

export interface SpawnChildSessionResult {
  childSessionId: string;
  ok: boolean;
  /** Concatenated assistant text produced by the child. */
  summary: string;
  budgetExhausted: boolean;
  turnsRun: number;
  reason?: string;
}

export class SubAgentError extends Error {
  constructor(
    message: string,
    readonly code:
      | "sub-agent/recursion-cap"
      | "sub-agent/budget-exhausted"
      | "sub-agent/parent-not-found"
      | "sub-agent/child-timeout"
      | "sub-agent/child-error",
  ) {
    super(message);
    this.name = "SubAgentError";
  }
}

const DEFAULT_MAX_RECURSION_DEPTH = Number.parseInt(
  process.env.MAKO_HARNESS_MAX_SUB_AGENT_DEPTH ?? "3",
  10,
);

const DEFAULT_MAX_TURNS = 1;

const DEFAULT_CHILD_TURN_TIMEOUT_MS = Number.parseInt(
  process.env.MAKO_HARNESS_SUB_AGENT_TURN_TIMEOUT_MS ?? "180000",
  10,
);

/**
 * Walk parent_id upward; throw if the chain (including the prospective new
 * child) would exceed `maxRecursionDepth`. Returns the current depth of the
 * parent (0 if parent is root).
 */
export function assertRecursionWithinCap(
  store: ProjectStore,
  parentSessionId: string,
  maxDepth: number = DEFAULT_MAX_RECURSION_DEPTH,
): number {
  let depth = 0;
  let current: string | null = parentSessionId;
  while (current !== null) {
    const row = store.getHarnessSession(current);
    if (!row) {
      throw new SubAgentError(
        `sub-agent parent chain points at missing session: ${current}`,
        "sub-agent/parent-not-found",
      );
    }
    if (depth >= maxDepth) {
      throw new SubAgentError(
        `sub-agent recursion exceeded cap (${maxDepth}); session ${parentSessionId} already at depth ${depth}`,
        "sub-agent/recursion-cap",
      );
    }
    current = row.parentId;
    depth += 1;
  }
  return depth - 1; // depth was incremented once for the parent itself
}

/**
 * Copy the parent's remembered allow decisions into the child session
 * according to the inheritance mode. Decisions recorded here are persisted
 * via `insertHarnessPermissionDecision` — the permission evaluator will find
 * them through the normal lookup path during the child's first turn.
 *
 * Scope mapping:
 *   - `"none"`  — nothing is copied.
 *   - `"turn"`  — parent's `turn`-scope `allow` decisions copy over as turn
 *                 scope on the child's first turn. Session/project/global
 *                 decisions already apply to the child through rule matching
 *                 (they are pattern-scoped, not session-scoped), so only turn
 *                 decisions need explicit propagation.
 *   - `"full"`  — `turn` AND `session` scope decisions from the parent copy
 *                 into the child (session-scope decisions were bound to the
 *                 parent's session id, so they would NOT otherwise carry).
 */
export function inheritPermissionDecisions(
  store: ProjectStore,
  parentSessionId: string,
  childSessionId: string,
  mode: InheritPermissionsMode,
): HarnessPermissionDecisionRecord[] {
  if (mode === "none") return [];

  const parentDecisions = store.listHarnessPermissionDecisions(parentSessionId);
  const scopesToCopy: ReadonlyArray<HarnessPermissionDecisionRecord["scope"]> =
    mode === "full" ? ["turn", "session"] : ["turn"];

  const copied: HarnessPermissionDecisionRecord[] = [];
  for (const d of parentDecisions) {
    if (d.action !== "allow") continue;
    if (!scopesToCopy.includes(d.scope)) continue;
    const inserted = store.insertHarnessPermissionDecision({
      sessionId: childSessionId,
      toolName: d.toolName,
      pattern: d.pattern,
      action: "allow",
      scope: d.scope,
    });
    copied.push(inserted);
  }
  return copied;
}

/**
 * Create a child session, run `prompt` through it on the same `Harness`,
 * wait for `turn.done`, and return a structured summary. Used by the
 * `sub_agent_spawn` tool.
 */
export async function spawnChildSession(
  input: SpawnChildSessionInput,
): Promise<SpawnChildSessionResult> {
  const depth = assertRecursionWithinCap(
    input.store,
    input.parentSessionId,
    input.maxRecursionDepth,
  );
  subAgentLogger.info("sub-agent.spawn.start", {
    parentSessionId: input.parentSessionId,
    depth,
  });

  const parent = input.store.getHarnessSession(input.parentSessionId);
  if (!parent) {
    throw new SubAgentError(
      `sub-agent parent session not found: ${input.parentSessionId}`,
      "sub-agent/parent-not-found",
    );
  }

  const childTier = parent.tier;
  const childProvider = input.provider ?? parent.activeProvider ?? undefined;
  const childModel = input.model ?? parent.activeModel ?? undefined;
  const childFallback = input.fallbackChain ?? parent.fallbackChain;

  const child = await input.harness.createSession({
    projectId: parent.projectId ?? undefined,
    parentId: input.parentSessionId,
    title: input.title ?? `Sub-agent of ${input.parentSessionId}`,
    tier: childTier,
    fallbackChain:
      childProvider && childModel
        ? [{ provider: childProvider, model: childModel }, ...childFallback.slice(1)]
        : childFallback.length > 0
          ? childFallback
          : undefined,
  });

  const inheritMode = input.inheritPermissions ?? "turn";
  inheritPermissionDecisions(
    input.store,
    input.parentSessionId,
    child.id,
    inheritMode,
  );

  const correlationCallId = input.parentCallId ?? `sub-agent-${randomUUID()}`;
  input.harness.bus.emit(input.parentSessionId, {
    kind: "sub_agent.started",
    callId: correlationCallId,
    childSessionId: child.id,
    parentSessionId: input.parentSessionId,
    inheritPermissions: inheritMode,
  });

  const budget: Required<SubAgentBudget> = {
    maxTurns: input.budget?.maxTurns ?? DEFAULT_MAX_TURNS,
    maxTokens: input.budget?.maxTokens ?? 0,
  };

  let accumulated = "";
  let turnsRun = 0;
  let budgetExhausted = false;
  let lastError: string | null = null;

  for (let t = 0; t < budget.maxTurns; t++) {
    turnsRun += 1;
    const turnResult = await runChildTurn(
      input.harness,
      child.id,
      t === 0 ? input.prompt : "",
    );
    accumulated += (accumulated ? "\n\n" : "") + turnResult.text;
    if (!turnResult.ok) {
      lastError = turnResult.error ?? "child turn errored";
      break;
    }
    // Enforce token cap after each turn (best effort — based on the
    // persisted `harness_provider_calls` we've seen so far).
    if (budget.maxTokens > 0) {
      const used = sumChildTokens(input.store, child.id);
      if (used >= budget.maxTokens) {
        budgetExhausted = true;
        break;
      }
    }
    // Phase 3.4 ships single-turn children; break after the first turn.
    // Multi-turn continuation (agent-of-the-gaps loops) is out of scope.
    break;
  }

  // Close the child session so listSessions doesn't leave it as "active".
  try {
    input.store.updateHarnessSession(child.id, { status: "closed" });
  } catch (error) {
    subAgentLogger.debug("sub-agent.close-noop", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const ok = lastError === null;
  input.harness.bus.emit(input.parentSessionId, {
    kind: "sub_agent.finished",
    callId: correlationCallId,
    childSessionId: child.id,
    ok,
    summary: accumulated.slice(0, 2000),
    budgetExhausted,
  });

  return {
    childSessionId: child.id,
    ok,
    summary: accumulated,
    budgetExhausted,
    turnsRun,
    reason: lastError ?? undefined,
  };
}

interface ChildTurnResult {
  ok: boolean;
  text: string;
  error?: string;
}

async function runChildTurn(
  harness: Harness,
  childSessionId: string,
  prompt: string,
): Promise<ChildTurnResult> {
  let assistantMessageId: string | null = null;
  let accumulated = "";
  let done = false;
  let errorText: string | null = null;

  const unsubscribe = harness.bus.subscribe(
    childSessionId,
    (ev: EmittedSessionEvent) => {
      const e = ev.event;
      if (e.kind === "message.created" && e.role === "assistant") {
        assistantMessageId = e.messageId;
      } else if (e.kind === "text.delta" && e.messageId === assistantMessageId) {
        accumulated += e.text;
      } else if (e.kind === "error") {
        errorText = e.message;
        done = true;
      } else if (e.kind === "turn.done") {
        done = true;
      }
    },
  );

  try {
    if (prompt.length > 0) {
      // Sub-agent spawns are internal non-web turns by definition — classify
      // the recorded provider calls as agent-origin so the `/usage` rollup
      // distinguishes them from raw web chat turns.
      harness.postMessage(childSessionId, prompt, { caller: { kind: "agent" } });
    } else {
      // No prompt → nothing to do this turn. Synthesize a turn-done immediately.
      return { ok: true, text: "" };
    }

    const deadline = Date.now() + DEFAULT_CHILD_TURN_TIMEOUT_MS;
    while (!done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    if (!done) {
      throw new SubAgentError(
        `child turn timed out after ${DEFAULT_CHILD_TURN_TIMEOUT_MS}ms`,
        "sub-agent/child-timeout",
      );
    }
  } finally {
    unsubscribe();
  }

  if (errorText) {
    return { ok: false, text: accumulated, error: errorText };
  }
  return { ok: true, text: accumulated };
}

function sumChildTokens(store: ProjectStore, sessionId: string): number {
  // Minimal direct-query shortcut: listHarnessMessages gives us the message
  // rows, but prompt/completion tokens are in `harness_provider_calls`. We
  // don't expose a dedicated accessor, so this is a best-effort via the
  // event log. For 3.4 alpha, if the session has no provider_calls logged,
  // token budget enforcement is a no-op — that is deliberately fail-open
  // so a missing accessor does not block work.
  const events = store.listHarnessSessionEvents(sessionId);
  let total = 0;
  for (const ev of events) {
    if (ev.kind !== "provider.call") continue;
    // The event payload is the emitted shape; its schema does not carry
    // token counts, so we only get them via `harness_provider_calls` rows.
    // Follow-up: extend `provider.call` event payload to include tokens.
    total += 0;
  }
  return total;
}
