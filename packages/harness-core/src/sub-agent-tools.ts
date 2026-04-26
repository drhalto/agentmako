/**
 * Sub-agent tool family — Phase 3.4.
 *
 * Ships a single tool for now: `sub_agent_spawn`. Follows the same
 * single-file pattern as `memory-tools.ts` / `action-tools.ts`, and lives
 * in `harness-core` rather than `harness-tools` because it depends on
 * `Harness` and `ProjectStore` — placing it in `harness-tools` would
 * force a circular package dependency (same reason memory tools ship here).
 *
 * Registered into `ToolDispatch.buildTools` alongside `ACTION_TOOLS` and
 * `MEMORY_TOOLS`. Sub-agent tools bypass the permission flow — approval
 * for the parent's call to `sub_agent_spawn` is the gate; the child
 * session's own tool calls go through the permission engine normally.
 */

import { z } from "zod";
import type { ProjectStore } from "@mako-ai/store";
import type { Harness } from "./harness.js";
import {
  SubAgentError,
  spawnChildSession,
  type InheritPermissionsMode,
} from "./sub-agent.js";

export interface SubAgentToolContext {
  harness: Harness;
  store: ProjectStore;
  /** Session that is currently executing (i.e. the spawning session). */
  parentSessionId: string;
  /**
   * The parent session's `callId` for this `sub_agent_spawn` invocation —
   * populated by the dispatcher. Piped through so `sub_agent.started` and
   * `sub_agent.finished` events on the parent's log can be correlated back
   * to the originating tool call.
   */
  parentCallId?: string;
}

export interface SubAgentToolDefinition<I> {
  name: string;
  description: string;
  parameters: z.ZodType<I>;
  execute(args: I, ctx: SubAgentToolContext): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// sub_agent_spawn
// -----------------------------------------------------------------------------

const InheritPermissionsSchema = z.enum(["none", "turn", "full"]);

const SubAgentSpawnParams = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("The task for the child agent to complete, in a single message."),
  budget: z
    .object({
      maxTurns: z.number().int().min(1).max(10).optional(),
      maxTokens: z.number().int().positive().optional(),
    })
    .optional()
    .describe(
      "Soft caps for the child. `maxTurns` defaults to 1 (Phase 3.4 ships single-turn children). `maxTokens` is a best-effort total across the child's provider calls.",
    ),
  inheritPermissions: InheritPermissionsSchema.optional().describe(
    "How the child inherits approval decisions from the parent. Default: `turn` (only turn-scope allows carry; session+project+global apply independently by rule).",
  ),
  provider: z
    .string()
    .min(1)
    .optional()
    .describe("Override provider id for the child. Defaults to the parent's active provider."),
  model: z
    .string()
    .min(1)
    .optional()
    .describe("Override model id for the child."),
  title: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("Optional short title for the child session in `agentmako session list`."),
});
type SubAgentSpawnInput = z.infer<typeof SubAgentSpawnParams>;

export const subAgentSpawnTool: SubAgentToolDefinition<SubAgentSpawnInput> = {
  name: "sub_agent_spawn",
  description:
    "Delegate a scoped task to a child agent session. The child runs with its own context and returns a summary when done. Use when a task is large enough that isolating its context from the parent's is worth the handoff overhead.",
  parameters: SubAgentSpawnParams,
  async execute(args, ctx) {
    try {
      const result = await spawnChildSession({
        harness: ctx.harness,
        store: ctx.store,
        parentSessionId: ctx.parentSessionId,
        parentCallId: ctx.parentCallId,
        prompt: args.prompt,
        budget: args.budget,
        inheritPermissions: args.inheritPermissions as InheritPermissionsMode | undefined,
        provider: args.provider,
        model: args.model,
        title: args.title,
      });
      return {
        ok: result.ok,
        childSessionId: result.childSessionId,
        summary: result.summary,
        budgetExhausted: result.budgetExhausted,
        turnsRun: result.turnsRun,
        reason: result.reason ?? null,
      };
    } catch (error) {
      if (error instanceof SubAgentError) {
        return {
          ok: false,
          childSessionId: null,
          summary: "",
          budgetExhausted: false,
          turnsRun: 0,
          reason: `${error.code}: ${error.message}`,
        };
      }
      throw error;
    }
  },
};

export const SUB_AGENT_TOOLS = [subAgentSpawnTool] as const;
