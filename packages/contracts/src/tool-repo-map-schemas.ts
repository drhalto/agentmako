import { z } from "zod";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";

/**
 * `repo_map` — aider-style token-budgeted compact project outline.
 *
 * Emits a concise, ranked map of the indexed project showing the most central
 * files and the key symbols defined in each. Designed as first-turn context
 * for agents meeting an unfamiliar codebase, or as a cheap orientation lookup
 * mid-session.
 *
 * Scope:
 * - read-only: never edits files
 * - indexed files only: walks `projectStore.listFiles()` and
 *   `projectStore.listSymbolsForFile(...)`, never the live filesystem
 * - bounded: default 1024-token budget, cap 16384; uses char/4 approximation
 *   (portable, no per-language tokenizers)
 * - ranked: approximate centrality via `fanIn * log2(fanOut + 2)`; real
 *   PageRank deferred as premature complexity
 *
 * Output is rendered plaintext with aider-visual conventions (`⋮...` for
 * elided interior content, `│` left-bar for kept signature lines). JSON
 * projection of the same data ships alongside the rendered text so callers
 * can consume either form.
 */

export interface RepoMapSymbolEntry {
  name: string;
  kind: string;
  exported: boolean;
  lineStart?: number;
  lineEnd?: number;
  signatureText?: string;
}

export const RepoMapSymbolEntrySchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  exported: z.boolean(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  signatureText: z.string().optional(),
}) satisfies z.ZodType<RepoMapSymbolEntry>;

export interface RepoMapFileEntry {
  filePath: string;
  score: number;
  inboundCount: number;
  outboundCount: number;
  symbolsIncluded: RepoMapSymbolEntry[];
  symbolsTotal: number;
  truncatedSymbols: boolean;
}

export const RepoMapFileEntrySchema = z.object({
  filePath: z.string().min(1),
  score: z.number().nonnegative(),
  inboundCount: z.number().int().nonnegative(),
  outboundCount: z.number().int().nonnegative(),
  symbolsIncluded: z.array(RepoMapSymbolEntrySchema),
  symbolsTotal: z.number().int().nonnegative(),
  truncatedSymbols: z.boolean(),
}) satisfies z.ZodType<RepoMapFileEntry>;

export interface RepoMapToolInput {
  projectId?: string;
  projectRef?: string;
  /**
   * Cost class: shape-cost. Bigger maps become less useful as maps even
   * when clients can persist large output, so the default stays 1024.
   */
  tokenBudget?: number;
  /**
   * Cost class: shape-cost. Ranking gets noisy when too many files are
   * included, so the default stays 60.
   */
  maxFiles?: number;
  /**
   * Cost class: shape-cost. Per-file symbol lists are intentionally
   * compact so the rendered outline stays scannable; default stays 6.
   */
  maxSymbolsPerFile?: number;
  // Files named here get a score boost and are emitted first (helpful when an
  // agent already knows the relevant subtree).
  focusFiles?: string[];
  // Optional SQLite-style GLOB filter on file paths.
  pathGlob?: string;
}

export const RepoMapToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  // Cost class: shape-cost. Default 1024 in tool implementation.
  tokenBudget: z.number().int().positive().max(16384).optional(),
  // Cost class: shape-cost. Default 60 in tool implementation.
  maxFiles: z.number().int().positive().max(500).optional(),
  // Cost class: shape-cost. Default 6 in tool implementation.
  maxSymbolsPerFile: z.number().int().positive().max(32).optional(),
  focusFiles: z.array(z.string().trim().min(1)).max(64).optional(),
  pathGlob: z.string().trim().min(1).max(256).optional(),
}).strict() satisfies z.ZodType<RepoMapToolInput>;

export interface RepoMapToolOutput {
  toolName: "repo_map";
  projectId: string;
  rendered: string;
  files: RepoMapFileEntry[];
  tokenBudget: number;
  estimatedTokens: number;
  totalFilesIndexed: number;
  totalFilesEligible: number;
  truncatedByBudget: boolean;
  truncatedByMaxFiles: boolean;
  warnings: string[];
}

export const RepoMapToolOutputSchema = z.object({
  toolName: z.literal("repo_map"),
  projectId: z.string().min(1),
  rendered: z.string(),
  files: z.array(RepoMapFileEntrySchema),
  tokenBudget: z.number().int().positive(),
  estimatedTokens: z.number().int().nonnegative(),
  totalFilesIndexed: z.number().int().nonnegative(),
  totalFilesEligible: z.number().int().nonnegative(),
  truncatedByBudget: z.boolean(),
  truncatedByMaxFiles: z.boolean(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<RepoMapToolOutput>;
