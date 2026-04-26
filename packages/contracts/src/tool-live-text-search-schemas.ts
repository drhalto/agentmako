import { z } from "zod";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";

export interface LiveTextSearchMatch {
  filePath: string;
  line: number;
  column: number;
  text: string;
  submatches: Array<{
    text: string;
    start: number;
    end: number;
  }>;
}

export const LiveTextSearchMatchSchema = z.object({
  filePath: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  text: z.string(),
  submatches: z.array(z.object({
    text: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })),
}) satisfies z.ZodType<LiveTextSearchMatch>;

export interface LiveTextSearchToolInput {
  projectId?: string;
  projectRef?: string;
  query: string;
  pathGlob?: string;
  caseSensitive?: boolean;
  /** Defaults to true. Set false to pass `query` through ripgrep regex syntax. */
  fixedStrings?: boolean;
  includeHidden?: boolean;
  maxMatches?: number;
  maxFiles?: number;
}

export const LiveTextSearchToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  query: z.string().min(1).max(512),
  pathGlob: z.string().trim().min(1).max(256).optional(),
  caseSensitive: z.boolean().optional(),
  fixedStrings: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
  maxMatches: z.number().int().positive().max(2000).optional(),
  maxFiles: z.number().int().positive().max(5000).optional(),
}).strict() satisfies z.ZodType<LiveTextSearchToolInput>;

export interface LiveTextSearchToolOutput {
  toolName: "live_text_search";
  projectId: string;
  query: string;
  evidenceMode: "live_filesystem";
  matches: LiveTextSearchMatch[];
  filesMatched: string[];
  truncated: boolean;
  warnings: string[];
}

export const LiveTextSearchToolOutputSchema = z.object({
  toolName: z.literal("live_text_search"),
  projectId: z.string().min(1),
  query: z.string().min(1),
  evidenceMode: z.literal("live_filesystem"),
  matches: z.array(LiveTextSearchMatchSchema),
  filesMatched: z.array(z.string().min(1)),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<LiveTextSearchToolOutput>;
