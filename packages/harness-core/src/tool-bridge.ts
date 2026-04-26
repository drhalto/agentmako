/**
 * Tool registry bridge — wraps every tool in `@mako-ai/tools`'s `TOOL_DEFINITIONS`
 * as a Vercel AI SDK `Tool` so the model can call any registered tool mid-turn.
 *
 * Responsibilities per call:
 *   1. Generate a `callId` (uuid), matching the existing dispatch pattern.
 *   2. Emit `tool.call` on the session bus (for SSE stream consumers).
 *   3. `persistToolPart("tool_call", ...)` — writes a `harness_message_parts` row
 *      so the web UI timeline can render a tool card.
 *   4. Invoke the registered tool through `invokeTool(...)`. That path already
 *      writes a `tool_runs` row — the bridge does NOT duplicate that logging.
 *   5. Emit `tool.result` + `persistToolPart("tool_result", ...)` with the outcome.
 *
 * Name flattening: model-facing tool names must match `^[a-zA-Z0-9_-]{1,64}$`.
 * Registry names are already flat today, but the helper dots-to-underscores
 * guard keeps us safe against future naming.
 *
 * Reserved-name guard: if a registry tool's name collides with an action / memory
 * / sub-agent tool, the bridge skips it so the specialized dispatch wins. No
 * tool ever registers twice.
 */

import { randomUUID } from "node:crypto";
import { tool, type Tool } from "ai";
import { createLogger } from "@mako-ai/logger";
import {
  buildRegistryToolExposurePlan,
  invokeTool,
  type MakoToolDefinition,
  type ToolServiceOptions,
} from "@mako-ai/tools";
import type { SessionEventBus } from "./event-bus.js";

const bridgeLogger = createLogger("mako-harness-tool-bridge");

export interface ToolBridgeContext {
  bus: SessionEventBus;
  sessionId: string;
  toolOptions: ToolServiceOptions;
  persistToolPart(kind: "tool_call" | "tool_result", payload: unknown): void;
}

function flattenToolName(name: string): string {
  return name.replace(/\./g, "_").slice(0, 64);
}

export function toolFromDefinition(
  def: MakoToolDefinition,
  ctx: ToolBridgeContext,
): Tool {
  return tool({
    description: def.description,
    parameters: def.inputSchema,
    execute: async (args) => {
      const callId = randomUUID();
      ctx.bus.emit(ctx.sessionId, {
        kind: "tool.call",
        callId,
        tool: def.name,
        argsPreview: args,
      });
      ctx.persistToolPart("tool_call", { callId, tool: def.name, args });

      try {
        const result = await invokeTool(def.name, args, ctx.toolOptions);
        ctx.bus.emit(ctx.sessionId, {
          kind: "tool.result",
          callId,
          ok: true,
          resultPreview: result,
        });
        ctx.persistToolPart("tool_result", { callId, ok: true, result });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        bridgeLogger.info("bridge.tool_error", {
          sessionId: ctx.sessionId,
          callId,
          tool: def.name,
          error: message,
        });
        ctx.bus.emit(ctx.sessionId, {
          kind: "tool.result",
          callId,
          ok: false,
          resultPreview: { error: message },
        });
        ctx.persistToolPart("tool_result", {
          callId,
          ok: false,
          error: message,
        });
        throw error;
      }
    },
  });
}

export function buildRegistryToolset(
  ctx: ToolBridgeContext,
  reservedNames: ReadonlySet<string>,
): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  const plan = buildRegistryToolExposurePlan({
    ...ctx.toolOptions,
    surface: "harness",
  });
  for (const item of plan.immediate) {
    const def = item.definition;
    const flat = flattenToolName(def.name);
    if (reservedNames.has(flat)) {
      bridgeLogger.warn("bridge.skipped", {
        toolName: def.name,
        reason: "name-reserved-by-dispatch",
      });
      continue;
    }
    out[flat] = toolFromDefinition(def, ctx);
  }
  return out;
}
