import { z } from "zod";
import type { MemoryToolContext } from "./memory-tools.js";
import { searchSemantic } from "./semantic-search.js";

export type SemanticToolContext = MemoryToolContext;

export interface SemanticToolDefinition<I> {
  name: string;
  description: string;
  parameters: z.ZodType<I>;
  execute(args: I, ctx: SemanticToolContext): Promise<unknown>;
}

const SemanticSearchParams = z.object({
  query: z.string().min(1).describe("Natural-language query."),
  k: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Maximum results to return (default 10)."),
  kinds: z
    .array(z.enum(["code", "doc", "memory"]))
    .max(3)
    .optional()
    .describe("Optional source filter. Defaults to code, doc, and memory."),
  includeMemories: z
    .boolean()
    .optional()
    .describe("When kinds are omitted, set false to search only code+docs."),
});
type SemanticSearchInput = z.infer<typeof SemanticSearchParams>;

export const semanticSearchTool: SemanticToolDefinition<SemanticSearchInput> = {
  name: "semantic_search",
  description:
    "Search repo-local code symbols, markdown docs, and memories. Returns hybrid FTS+vector results when embeddings are healthy, or FTS-only results with a mode signal when they are not.",
  parameters: SemanticSearchParams,
  async execute(args, ctx) {
    return searchSemantic({
      store: ctx.store,
      query: args.query,
      embeddingProvider: ctx.embeddingProvider,
      projectId: ctx.projectId,
      k: args.k,
      kinds: args.kinds,
      includeMemories: args.includeMemories,
    });
  },
};

export const SEMANTIC_TOOLS = [semanticSearchTool] as const;
