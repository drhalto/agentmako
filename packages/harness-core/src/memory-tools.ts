/**
 * Memory tool family — `memory_remember`, `memory_recall`, `memory_list`.
 *
 * These tools live in `harness-core` rather than `harness-tools` because they
 * depend on `ProjectStore` (the @mako-ai/store accessors) and
 * `EmbeddingProvider` + `recallMemories` (both in harness-core). Placing them
 * in harness-tools would force a circular dependency — the `harness-core →
 * harness-tools` edge is one-way by design, and filesystem-mutation tools
 * (the `harness-tools` contract) are pure local operations that never need
 * orchestration context.
 *
 * Unlike action tools, memory tools are read/append-only and never require
 * approval — `memory_remember` creates an append-only row, `memory_recall`
 * and `memory_list` are pure reads. They are routed through the same tool
 * dispatcher so the agent loop sees a unified tool surface, but they bypass
 * the permission flow.
 *
 * Phase 3.3 ships these three tools. `memory_forget` is deferred to a later
 * phase as the spec mandates append-only behavior for 3.3.
 */

import { z } from "zod";
import type { ProjectStore } from "@mako-ai/store";
import type { EmbeddingProvider } from "./embedding-provider.js";
import { recallMemories } from "./memory-search.js";

export interface MemoryToolContext {
  store: ProjectStore;
  projectId: string | null;
  embeddingProvider: EmbeddingProvider | null;
}

export interface MemoryToolDefinition<I> {
  name: string;
  description: string;
  parameters: z.ZodType<I>;
  execute(args: I, ctx: MemoryToolContext): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// memory_remember
// -----------------------------------------------------------------------------

const MemoryRememberParams = z.object({
  text: z.string().min(1).describe("The fact or note to remember."),
  category: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("Optional short label, e.g. `architecture` or `gotcha`."),
  tags: z
    .array(z.string().min(1).max(64))
    .max(16)
    .optional()
    .describe("Optional tags for retrieval filtering."),
});
type MemoryRememberInput = z.infer<typeof MemoryRememberParams>;

export const memoryRememberTool: MemoryToolDefinition<MemoryRememberInput> = {
  name: "memory_remember",
  description:
    "Store a durable fact scoped to the active project. Optionally embed it for semantic recall. Returns the memory id and whether an embedding was produced.",
  parameters: MemoryRememberParams,
  async execute(args, ctx) {
    const record = ctx.store.insertHarnessMemory({
      projectId: ctx.projectId,
      text: args.text,
      category: args.category ?? null,
      tags: args.tags ?? [],
    });

    let embedded = false;
    let embeddingError: string | null = null;

    if (ctx.embeddingProvider) {
      try {
        const vector = await ctx.embeddingProvider.embed(args.text);
        ctx.store.insertEmbedding({
          ownerKind: "memory",
          ownerId: record.memoryId,
          provider: ctx.embeddingProvider.providerId,
          model: ctx.embeddingProvider.modelId,
          vector,
        });
        embedded = true;
      } catch (error) {
        embeddingError = error instanceof Error ? error.message : String(error);
        // Embedding failure is non-fatal — FTS still indexes the row. The
        // caller sees `{ embedded: false, embeddingError }` and can decide
        // whether to re-embed later.
      }
    }

    return {
      id: record.memoryId,
      createdAt: record.createdAt,
      embedded,
      embeddingModel: embedded ? ctx.embeddingProvider?.modelId ?? null : null,
      embeddingError,
    };
  },
};

// -----------------------------------------------------------------------------
// memory_recall
// -----------------------------------------------------------------------------

const MemoryRecallParams = z.object({
  query: z.string().min(1).describe("Natural-language query."),
  k: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum results to return (default 10)."),
});
type MemoryRecallInput = z.infer<typeof MemoryRecallParams>;

export const memoryRecallTool: MemoryToolDefinition<MemoryRecallInput> = {
  name: "memory_recall",
  description:
    "Search stored memories. Returns hybrid FTS+vector results when an embedding provider is healthy, or FTS-only results with a mode signal when it is not.",
  parameters: MemoryRecallParams,
  async execute(args, ctx) {
    const result = await recallMemories({
      store: ctx.store,
      query: args.query,
      embeddingProvider: ctx.embeddingProvider,
      projectId: ctx.projectId,
      k: args.k,
    });
    return result;
  },
};

// -----------------------------------------------------------------------------
// memory_list
// -----------------------------------------------------------------------------

const MemoryListParams = z.object({
  category: z.string().min(1).optional().describe("Filter by exact category."),
  tag: z.string().min(1).optional().describe("Filter by tag (contains)."),
  since: z
    .string()
    .min(1)
    .optional()
    .describe("ISO timestamp; only memories created at or after this instant."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Maximum rows to return (default 100)."),
});
type MemoryListInput = z.infer<typeof MemoryListParams>;

export const memoryListTool: MemoryToolDefinition<MemoryListInput> = {
  name: "memory_list",
  description:
    "List stored memories for the active project, most recent first. Optional category, tag, and since filters.",
  parameters: MemoryListParams,
  async execute(args, ctx) {
    const rows = ctx.store.listHarnessMemories({
      projectId: ctx.projectId,
      category: args.category ?? null,
      tag: args.tag ?? null,
      since: args.since ?? null,
      limit: args.limit ?? 100,
    });
    return {
      count: rows.length,
      memories: rows.map((r) => ({
        id: r.memoryId,
        text: r.text,
        category: r.category,
        tags: r.tags,
        createdAt: r.createdAt,
      })),
    };
  },
};

export const MEMORY_TOOLS = [
  memoryRememberTool,
  memoryRecallTool,
  memoryListTool,
] as const;
