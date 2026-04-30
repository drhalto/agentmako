/**
 * `defineComposer` factory — Layer 5.
 *
 * One wrapper around every composer. Responsibilities:
 *   1. Resolve the attached project (via the existing `withProjectContext`
 *      helper) and build a `ComposerContext`.
 *   2. Pass composer-specific input + context to the composer's `run` function.
 *   3. Enforce the output contract — every composer result is an `AnswerResult`
 *      wrapping a validated `AnswerPacket`.
 *   4. Persist the result via `projectStore.saveAnswerTrace` so the web UI
 *      trace history surfaces composer calls alongside answer tools.
 *   5. Emit a typed `MakoToolDefinition` for direct append to `TOOL_DEFINITIONS`.
 *
 * `defineComposer` does NOT write `tool_runs` — `invokeTool` already does that
 * for every registered tool. Single-writer rule.
 */

import type { ComposerToolName } from "@mako-ai/contracts";
import type { ZodTypeAny, z } from "zod";
import { withProjectContext, type ToolServiceOptions } from "../../runtime.js";
import { ensureFreshSchemaSnapshot } from "../../schema-freshness.js";
import type { MakoToolDefinition } from "../../tool-definitions.js";
import { toolAnnotations } from "../../tool-operational-metadata.js";
import { persistAndEnrichAnswerResult } from "../../trust/enrich-answer-result.js";
import { readFreshness, type ComposerContext } from "./context.js";

export interface ComposerRunContext extends ComposerContext {}

export interface ComposerDefinition<
  Name extends ComposerToolName,
  InputSchema extends ZodTypeAny,
  OutputSchema extends ZodTypeAny,
> {
  name: Name;
  description: string;
  inputSchema: InputSchema;
  outputSchema: OutputSchema;
  run: (
    input: z.infer<InputSchema>,
    ctx: ComposerRunContext,
  ) => Promise<z.infer<OutputSchema>>;
}

export function defineComposer<
  Name extends ComposerToolName,
  InputSchema extends ZodTypeAny,
  OutputSchema extends ZodTypeAny,
>(def: ComposerDefinition<Name, InputSchema, OutputSchema>): MakoToolDefinition<Name> {
  return {
    name: def.name,
    category: "composer",
    description: def.description,
    annotations: toolAnnotations(def.name),
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    execute: async (input, options: ToolServiceOptions) => {
      return withProjectContext(
        input as { projectId?: string; projectRef?: string },
        options,
        async ({ project, projectStore, profile }) => {
          // Composers lean on the persisted schema snapshot
          // (getSchemaTableSnapshot, listFunctionTableRefs, etc.). If the
          // snapshot has drifted behind the live DB, composer findings will
          // be computed against stale state. Refresh inline before the run;
          // the helper is a no-op for projects without a live DB binding or
          // when the snapshot is already fresh, and it debounces per-process
          // so rapid composer chains (`suggest`/`investigate`) do not
          // re-trigger refreshes on every step.
          //
          // Caller opt-out is carried on the composer input as an optional
          // `freshen` flag — read defensively since individual composer
          // input schemas have not all adopted it yet.
          const rawInput = (input as { freshen?: unknown }) ?? {};
          const freshen =
            typeof rawInput.freshen === "boolean" ? rawInput.freshen : undefined;
          await ensureFreshSchemaSnapshot({
            projectId: project.projectId,
            projectRoot: project.canonicalPath,
            projectStore,
            ...(freshen === undefined ? {} : { freshen }),
            toolOptions: options,
          });
          const ctx: ComposerContext = {
            projectId: project.projectId,
            canonicalPath: project.canonicalPath,
            projectRoot: project.canonicalPath,
            profile: profile ?? null,
            store: projectStore,
            freshness: readFreshness(projectStore),
          };
          const result = await def.run(input as z.infer<InputSchema>, ctx);
          const parsed = def.outputSchema.parse(result);
          // Composer outputs wrap an AnswerResult at the `.result` key (same
          // shape as existing answer tools). Persist for trace history when
          // the shape matches; quietly skip otherwise (defensive).
          const maybeResult = (parsed as { result?: unknown }).result;
          if (maybeResult && typeof maybeResult === "object") {
            const enrichedResult = await persistAndEnrichAnswerResult({
              result: maybeResult as Parameters<typeof projectStore.saveAnswerTrace>[0],
              projectStore,
              options,
            });
            (parsed as { result?: unknown }).result = enrichedResult;
          }
          return parsed;
        },
      );
    },
  };
}
