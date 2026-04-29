/**
 * Tool dispatch — bridges `@mako-ai/harness-tools` action tools into the
 * Vercel `ai` SDK's `tools: { ... }` map for `streamText`, and manages the
 * approval-flow pause/resume for `ask` decisions.
 *
 * The agent loop in `harness.ts` constructs a `ToolDispatch` per turn and
 * passes its `tools` map to `streamText`. When the model calls a tool:
 *
 *   1. `dryRun()` produces a preview without touching the disk.
 *   2. `permissionEngine.evaluate()` returns `allow | deny | ask`.
 *   3. `allow`  → `apply()` runs immediately, snapshot id flows through.
 *   4. `deny`   → throw a structured error; the SDK surfaces it as a
 *                 tool result so the model can adapt.
 *   5. `ask`    → emit `permission.request`, register a pending Promise on
 *                 the session, await `resolveApproval()` from the HTTP
 *                 route or CLI prompt, then allow/deny accordingly.
 *
 * Pending approvals timeout after `MAKO_HARNESS_APPROVAL_TIMEOUT` ms
 * (default 5 minutes). On timeout the Promise rejects with
 * `permission/request-timeout` and the SDK surfaces it to the model.
 */

import { randomUUID } from "node:crypto";
import { dynamicTool, type Tool } from "ai";
import { createLogger } from "@mako-ai/logger";
import type { ProjectStore } from "@mako-ai/store";
import {
  ACTION_TOOLS,
  type ActionToolContext,
  ActionToolError,
} from "@mako-ai/harness-tools";
import type { ToolServiceOptions } from "@mako-ai/tools";
import type { SessionEventBus } from "./event-bus.js";
import { MEMORY_TOOLS, type MemoryToolContext } from "./memory-tools.js";
import type { PermissionEngine, PermissionScope } from "./permission-engine.js";
import { SEMANTIC_TOOLS } from "./semantic-tools.js";
import { SUB_AGENT_TOOLS, type SubAgentToolContext } from "./sub-agent-tools.js";
import { buildRegistryToolset } from "./tool-bridge.js";
import { buildHarnessToolExposurePlan } from "./tool-exposure-plan.js";
import { logHarnessToolRun } from "./tool-run-logging.js";

const dispatchLogger = createLogger("mako-harness-tool-dispatch");

const APPROVAL_TIMEOUT_MS = Number.parseInt(
  process.env.MAKO_HARNESS_APPROVAL_TIMEOUT ?? "300000",
  10,
);

const MAX_PENDING_REQUESTS_PER_SESSION = Number.parseInt(
  process.env.MAKO_HARNESS_MAX_PENDING_APPROVALS ?? "3",
  10,
);

interface PendingApproval {
  requestId: string;
  sessionId: string;
  permission: string;
  pattern: string;
  resolve(decision: { action: "allow" | "deny"; scope: PermissionScope }): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class PermissionDeniedError extends Error {
  constructor(
    message: string,
    readonly code:
      | "permission/denied"
      | "permission/request-timeout"
      | "permission/too-many-pending"
      | "permission/path-outside-project",
  ) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export interface ToolDispatchInput {
  store: ProjectStore;
  bus: SessionEventBus;
  engine: PermissionEngine;
  context: ActionToolContext;
  projectId?: string | null;
  /**
   * Optional context for the memory tool family. When omitted, memory tools
   * are still registered but fall back to an error result at call time so
   * the agent can learn they're unavailable without crashing the turn.
   */
  memoryContext?: MemoryToolContext | null;
  /**
   * Optional context for the sub-agent tool family. When omitted, sub-agent
   * tools return an error result rather than crashing the turn (useful for
   * unit tests that don't stand up a full harness).
   */
  subAgentContext?: SubAgentToolContext | null;
  /** Persist a `harness_message_parts` row for tool_call / tool_result. */
  persistToolPart(kind: "tool_call" | "tool_result", payload: unknown): void;
  /**
   * When set, every tool in `@mako-ai/tools`'s `TOOL_DEFINITIONS` registry is
   * bridged into the SDK tool bag. The bridge reuses `persistToolPart` + `bus`
   * for tool_call / tool_result surfaces so registry tools render in the web
   * timeline identically to action / memory / sub-agent tools. Registry tools
   * whose names collide with a specialized family (action/memory/sub-agent)
   * are skipped so the specialized dispatch wins.
   */
  toolServiceOptions?: ToolServiceOptions;
}

export class ToolDispatch {
  /** keyed by sessionId; value is a map of requestId → pending approval. */
  private static pendingBySession = new Map<string, Map<string, PendingApproval>>();

  readonly tools: Record<string, Tool>;

  constructor(private readonly input: ToolDispatchInput) {
    this.tools = this.buildTools();
  }

  private recordToolRun(args: {
    toolFamily: "action" | "memory" | "semantic" | "sub_agent";
    toolName: string;
    callId: string;
    input: unknown;
    output?: unknown;
    startedAtMs: number;
    sessionId: string;
    error?: unknown;
  }): void {
    logHarnessToolRun({
      store: this.input.store,
      projectId: this.input.projectId,
      toolName: args.toolName,
      toolFamily: args.toolFamily,
      input: args.input,
      output: args.output,
      startedAtMs: args.startedAtMs,
      sessionId: args.sessionId,
      callId: args.callId,
      error: args.error,
    });
  }

  private buildTools(): Record<string, Tool> {
    const out: Record<string, Tool> = {};
    const exposurePlan = buildHarnessToolExposurePlan({
      toolServiceOptions: this.input.toolServiceOptions,
      hasMemoryContext: this.input.memoryContext != null,
      hasSubAgentContext: this.input.subAgentContext != null,
    });
    for (const def of ACTION_TOOLS) {
      out[def.name] = dynamicTool({
        description: def.description,
        inputSchema: def.parameters,
        execute: async (args) => {
          return this.executeTool(def.name, args);
        },
      });
    }
    if (exposurePlan.includeMemoryTools) {
      for (const def of MEMORY_TOOLS) {
        out[def.name] = dynamicTool({
          description: def.description,
          inputSchema: def.parameters,
          execute: async (args) => {
            return this.executeMemoryTool(def.name, args);
          },
        });
      }
    }
    if (exposurePlan.includeSemanticTools) {
      for (const def of SEMANTIC_TOOLS) {
        out[def.name] = dynamicTool({
          description: def.description,
          inputSchema: def.parameters,
          execute: async (args) => {
            return this.executeSemanticTool(def.name, args);
          },
        });
      }
    }
    if (exposurePlan.includeSubAgentTools) {
      for (const def of SUB_AGENT_TOOLS) {
        out[def.name] = dynamicTool({
          description: def.description,
          inputSchema: def.parameters,
          execute: async (args) => {
            return this.executeSubAgentTool(def.name, args);
          },
        });
      }
    }
    if (this.input.toolServiceOptions) {
      const reserved = new Set<string>([
        ...ACTION_TOOLS.map((t) => t.name),
        ...MEMORY_TOOLS.map((t) => t.name),
        ...SEMANTIC_TOOLS.map((t) => t.name),
        ...SUB_AGENT_TOOLS.map((t) => t.name),
      ]);
      const bridged = buildRegistryToolset(
        {
          bus: this.input.bus,
          sessionId: this.input.context.sessionId,
          toolOptions: this.input.toolServiceOptions,
          persistToolPart: this.input.persistToolPart,
        },
        reserved,
      );
      for (const [name, bridgedTool] of Object.entries(bridged)) {
        if (name in out) {
          continue;
        }
        out[name] = bridgedTool;
      }
    }
    out[exposurePlan.toolSearch.name] = dynamicTool({
      description: exposurePlan.toolSearch.description,
      inputSchema: exposurePlan.toolSearch.parameters,
      execute: async (args: unknown) =>
        exposurePlan.toolSearch.execute(
          args as Parameters<typeof exposurePlan.toolSearch.execute>[0],
        ),
    });
    return out;
  }

  private async executeSubAgentTool(name: string, args: unknown): Promise<unknown> {
    const def = SUB_AGENT_TOOLS.find((t) => t.name === name);
    if (!def) {
      throw new Error(`tool-dispatch/unknown-sub-agent-tool: ${name}`);
    }
    const callId = randomUUID();
    const sessionId = this.input.context.sessionId;
    const startedAtMs = Date.now();

    this.input.bus.emit(sessionId, {
      kind: "tool.call",
      callId,
      tool: def.name,
      argsPreview: args,
    });
    this.input.persistToolPart("tool_call", { callId, tool: def.name, args });

    if (!this.input.subAgentContext) {
      const reason = "sub-agent-tools/unavailable: no sub-agent context bound to this dispatch";
      const output = { ok: false, error: reason };
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: false,
        resultPreview: { error: reason },
      });
      this.input.persistToolPart("tool_result", { callId, ok: false, error: reason });
      this.recordToolRun({
        toolFamily: "sub_agent",
        toolName: def.name,
        callId,
        input: args,
        output,
        startedAtMs,
        sessionId,
      });
      return output;
    }

    const parsed = def.parameters.parse(args) as unknown as {
      prompt: string;
      inheritPermissions?: "none" | "turn" | "full";
    };

    try {
      const result = (await (
        def.execute as (
          a: unknown,
          c: SubAgentToolContext & { parentCallId: string },
        ) => Promise<{
          ok: boolean;
          childSessionId: string | null;
          summary: string;
          budgetExhausted: boolean;
          turnsRun: number;
          reason: string | null;
        }>
      )(parsed, { ...this.input.subAgentContext, parentCallId: callId }));

      // sub_agent.started + sub_agent.finished events are emitted by
      // `spawnChildSession` itself so they can carry the real child id.
      // Here we only emit the generic tool.result wrapper.
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: result.ok,
        resultPreview: {
          childSessionId: result.childSessionId,
          turnsRun: result.turnsRun,
          budgetExhausted: result.budgetExhausted,
          summaryPreview: result.summary.slice(0, 500),
        },
      });
      this.input.persistToolPart("tool_result", {
        callId,
        ok: result.ok,
        childSessionId: result.childSessionId,
        summary: result.summary,
        budgetExhausted: result.budgetExhausted,
        turnsRun: result.turnsRun,
        reason: result.reason,
      });
      this.recordToolRun({
        toolFamily: "sub_agent",
        toolName: def.name,
        callId,
        input: args,
        output: result,
        startedAtMs,
        sessionId,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: false,
        resultPreview: { error: message },
      });
      this.input.persistToolPart("tool_result", { callId, ok: false, error: message });
      this.recordToolRun({
        toolFamily: "sub_agent",
        toolName: def.name,
        callId,
        input: args,
        startedAtMs,
        sessionId,
        error,
      });
      throw error;
    }
  }

  private async executeMemoryTool(name: string, args: unknown): Promise<unknown> {
    const def = MEMORY_TOOLS.find((t) => t.name === name);
    if (!def) {
      throw new Error(`tool-dispatch/unknown-memory-tool: ${name}`);
    }
    const callId = randomUUID();
    const sessionId = this.input.context.sessionId;
    const startedAtMs = Date.now();

    this.input.bus.emit(sessionId, {
      kind: "tool.call",
      callId,
      tool: def.name,
      argsPreview: args,
    });
    this.input.persistToolPart("tool_call", { callId, tool: def.name, args });

    if (!this.input.memoryContext) {
      const reason = "memory-tools/unavailable: no memory context (project not attached?)";
      const output = { ok: false, error: reason };
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: false,
        resultPreview: { error: reason },
      });
      this.input.persistToolPart("tool_result", { callId, ok: false, error: reason });
      this.recordToolRun({
        toolFamily: "memory",
        toolName: def.name,
        callId,
        input: args,
        output,
        startedAtMs,
        sessionId,
      });
      return output;
    }

    try {
      const parsed = def.parameters.parse(args);
      const result = await (
        def.execute as (a: unknown, c: MemoryToolContext) => Promise<unknown>
      )(parsed, this.input.memoryContext);
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: true,
        resultPreview: result,
      });
      this.input.persistToolPart("tool_result", { callId, ok: true, ...(result as object) });
      this.recordToolRun({
        toolFamily: "memory",
        toolName: def.name,
        callId,
        input: args,
        output: result,
        startedAtMs,
        sessionId,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: false,
        resultPreview: { error: message },
      });
      this.input.persistToolPart("tool_result", { callId, ok: false, error: message });
      this.recordToolRun({
        toolFamily: "memory",
        toolName: def.name,
        callId,
        input: args,
        startedAtMs,
        sessionId,
        error,
      });
      throw error;
    }
  }

  private async executeSemanticTool(name: string, args: unknown): Promise<unknown> {
    const def = SEMANTIC_TOOLS.find((t) => t.name === name);
    if (!def) {
      throw new Error(`tool-dispatch/unknown-semantic-tool: ${name}`);
    }
    const callId = randomUUID();
    const sessionId = this.input.context.sessionId;
    const startedAtMs = Date.now();

    this.input.bus.emit(sessionId, {
      kind: "tool.call",
      callId,
      tool: def.name,
      argsPreview: args,
    });
    this.input.persistToolPart("tool_call", { callId, tool: def.name, args });

    if (!this.input.memoryContext) {
      const reason = "semantic-tools/unavailable: no memory context (project not attached?)";
      const output = { ok: false, error: reason };
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: false,
        resultPreview: { error: reason },
      });
      this.input.persistToolPart("tool_result", { callId, ok: false, error: reason });
      this.recordToolRun({
        toolFamily: "semantic",
        toolName: def.name,
        callId,
        input: args,
        output,
        startedAtMs,
        sessionId,
      });
      return output;
    }

    try {
      const parsed = def.parameters.parse(args);
      const result = await def.execute(parsed, this.input.memoryContext);
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: true,
        resultPreview: result,
      });
      this.input.persistToolPart("tool_result", { callId, ok: true, ...(result as object) });
      this.recordToolRun({
        toolFamily: "semantic",
        toolName: def.name,
        callId,
        input: args,
        output: result,
        startedAtMs,
        sessionId,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: false,
        resultPreview: { error: message },
      });
      this.input.persistToolPart("tool_result", { callId, ok: false, error: message });
      this.recordToolRun({
        toolFamily: "semantic",
        toolName: def.name,
        callId,
        input: args,
        startedAtMs,
        sessionId,
        error,
      });
      throw error;
    }
  }

  private async executeTool(name: string, args: unknown): Promise<unknown> {
    const def = (ACTION_TOOLS as readonly { name: string }[]).find((t) => t.name === name) as
      | (typeof ACTION_TOOLS)[number]
      | undefined;
    if (!def) {
      throw new Error(`tool-dispatch/unknown-tool: ${name}`);
    }
    const callId = randomUUID();
    const ctx = this.input.context;
    const sessionId = ctx.sessionId;
    const startedAtMs = Date.now();

    let preview: import("@mako-ai/harness-tools").DryRunPreview;
    try {
      // Variance escape: `def` is a union of `ActionToolDefinition<I>` whose
      // input types differ per tool. The model is the source of truth for arg
      // shape — zod validates inside dryRun/apply.
      preview = (
        def.dryRun as (
          a: unknown,
          c: ActionToolContext,
        ) => import("@mako-ai/harness-tools").DryRunPreview
      )(args, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: false,
        resultPreview: { error: message },
      });
      this.input.persistToolPart("tool_result", { callId, ok: false, error: message });
      this.recordToolRun({
        toolFamily: "action",
        toolName: def.name,
        callId,
        input: args,
        startedAtMs,
        sessionId,
        error,
      });
      throw error;
    }

    this.input.bus.emit(sessionId, {
      kind: "tool.call",
      callId,
      tool: def.name,
      argsPreview: preview.detail,
    });
    this.input.persistToolPart("tool_call", {
      callId,
      tool: def.name,
      args,
      preview,
    });

    const target = pickTarget(name, args, preview);
    const decision = this.input.engine.evaluate({
      permission: def.permission,
      target,
      sessionId,
      preview,
      args,
    });

    if (decision.action === "deny") {
      const error = new PermissionDeniedError(
        `Permission denied for ${def.name}: ${decision.reason}`,
        "permission/denied",
      );
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: false,
        resultPreview: { error: error.message, reason: decision.reason },
      });
      this.input.persistToolPart("tool_result", {
        callId,
        ok: false,
        error: error.message,
        reason: decision.reason,
      });
      this.recordToolRun({
        toolFamily: "action",
        toolName: def.name,
        callId,
        input: args,
        startedAtMs,
        sessionId,
        error,
      });
      throw error;
    }

    if (decision.action === "ask") {
      const granted = await this.requestApproval({
        sessionId,
        permission: def.permission,
        pattern: target,
        toolName: def.name,
        callId,
        preview,
        args,
      });
      if (granted.action === "deny") {
        const error = new PermissionDeniedError(
          `User denied ${def.name}`,
          "permission/denied",
        );
        this.input.bus.emit(sessionId, {
          kind: "tool.result",
          callId,
          ok: false,
          resultPreview: { error: error.message },
        });
        this.input.persistToolPart("tool_result", { callId, ok: false, error: error.message });
        this.recordToolRun({
          toolFamily: "action",
          toolName: def.name,
          callId,
          input: args,
          startedAtMs,
          sessionId,
          error,
        });
        throw error;
      }
      // Persist the user's decision per scope so subsequent matching tool
      // calls in this session don't re-prompt.
      this.input.engine.rememberDecision({
        sessionId,
        permission: def.permission,
        pattern: target,
        action: "allow",
        scope: granted.scope,
      });
    }

    try {
      const result = await (
        def.apply as (
          a: unknown,
          c: ActionToolContext,
        ) => Promise<import("@mako-ai/harness-tools").ApplyResult>
      )(args, ctx);
      const summary = {
        snapshotId: result.snapshotId,
        bytesAffected: result.bytesAffected,
        filesAffected: result.filesAffected,
        outputPreview: result.output ? result.output.slice(0, 2000) : undefined,
      };
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: true,
        resultPreview: summary,
      });
      this.input.persistToolPart("tool_result", { callId, ok: true, ...summary });
      this.recordToolRun({
        toolFamily: "action",
        toolName: def.name,
        callId,
        input: args,
        output: summary,
        startedAtMs,
        sessionId,
      });
      return summary;
    } catch (error: unknown) {
      const message =
        error instanceof ActionToolError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
      this.input.bus.emit(sessionId, {
        kind: "tool.result",
        callId,
        ok: false,
        resultPreview: { error: message },
      });
      this.input.persistToolPart("tool_result", { callId, ok: false, error: message });
      this.recordToolRun({
        toolFamily: "action",
        toolName: def.name,
        callId,
        input: args,
        startedAtMs,
        sessionId,
        error,
      });
      throw error;
    }
  }

  private async requestApproval(input: {
    sessionId: string;
    permission: string;
    pattern: string;
    toolName: string;
    callId: string;
    preview: unknown;
    args: unknown;
  }): Promise<{ action: "allow" | "deny"; scope: PermissionScope }> {
    const { sessionId, permission, pattern, toolName, callId, preview, args } = input;

    const pending = ToolDispatch.pendingFor(sessionId);
    if (pending.size >= MAX_PENDING_REQUESTS_PER_SESSION) {
      throw new PermissionDeniedError(
        `permission/too-many-pending: session has ${pending.size} outstanding approval requests`,
        "permission/too-many-pending",
      );
    }

    const requestId = randomUUID();
    return new Promise<{ action: "allow" | "deny"; scope: PermissionScope }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(
            new PermissionDeniedError(
              `permission/request-timeout: no decision within ${APPROVAL_TIMEOUT_MS}ms`,
              "permission/request-timeout",
            ),
          );
        }, APPROVAL_TIMEOUT_MS);

        pending.set(requestId, {
          requestId,
          sessionId,
          permission,
          pattern,
          resolve: (decision) => {
            clearTimeout(timer);
            pending.delete(requestId);
            resolve(decision);
          },
          reject: (err) => {
            clearTimeout(timer);
            pending.delete(requestId);
            reject(err);
          },
          timer,
        });

        this.input.bus.emit(sessionId, {
          kind: "permission.request",
          requestId,
          tool: toolName,
          preview: { args, dryRun: preview, callId, pattern, permission },
        });
        dispatchLogger.info("permission.request", {
          sessionId,
          requestId,
          tool: toolName,
          permission,
          pattern,
        });
      },
    );
  }

  private static pendingFor(sessionId: string): Map<string, PendingApproval> {
    let map = ToolDispatch.pendingBySession.get(sessionId);
    if (!map) {
      map = new Map();
      ToolDispatch.pendingBySession.set(sessionId, map);
    }
    return map;
  }

  /** HTTP route + CLI prompt resolve approvals through this static method. */
  static resolveApproval(
    sessionId: string,
    requestId: string,
    decision: { action: "allow" | "deny"; scope: PermissionScope },
  ): boolean {
    const pending = ToolDispatch.pendingBySession.get(sessionId);
    const entry = pending?.get(requestId);
    if (!entry) return false;
    entry.resolve(decision);
    return true;
  }

  /** Inspect outstanding requests (used by `GET /permissions/requests`). */
  static listPending(sessionId: string): Array<{
    requestId: string;
    permission: string;
    pattern: string;
  }> {
    const pending = ToolDispatch.pendingBySession.get(sessionId);
    if (!pending) return [];
    return [...pending.values()].map((p) => ({
      requestId: p.requestId,
      permission: p.permission,
      pattern: p.pattern,
    }));
  }
}

function pickTarget(toolName: string, args: unknown, preview: { detail: unknown }): string {
  // For shell_run, target is "command args..."; for file tools, target is the project-relative path.
  const a = args as { path?: string; command?: string; args?: string[]; diff?: string };
  if (toolName === "shell_run" && a.command) {
    return [a.command, ...(a.args ?? [])].join(" ");
  }
  if (typeof a.path === "string") {
    return a.path;
  }
  if (a.diff) {
    // For apply_patch, derive a deterministic target from the file list in the preview.
    const files = (preview.detail as { files?: string[] } | null)?.files ?? [];
    return files.join(",");
  }
  return toolName;
}
