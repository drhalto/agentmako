import { z } from "zod";
import type { ReefQueryFreshness } from "./index-freshness.js";
import { ReefQueryFreshnessSchema } from "./index-freshness.js";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";
import type { ReefToolExecution } from "./tool-reef-execution-schemas.js";
import { ReefToolExecutionSchema } from "./tool-reef-execution-schemas.js";

/**
 * `ast_find_pattern` — read-only structural pattern search.
 *
 * Wraps `@ast-grep/napi` over every indexed project file in the supported
 * language set (TypeScript / TSX / JavaScript / JSX). The pattern uses
 * ast-grep's metavariable syntax — e.g. `console.log($X)` captures the
 * argument as `X`; see https://ast-grep.github.io/guide/pattern-syntax.html.
 *
 * Scope:
 * - read-only: never edits files. Rewriting is deferred per Roadmap 7.5
 *   wrapper-deferral guidance until eval data shows a named friction.
 * - indexed files only: iterates `projectStore.listFiles()` rather than
 *   walking the filesystem directly, so results are always a subset of
 *   the indexed snapshot.
 * - bounded: callers can cap `maxMatches` and `maxFiles`; defaults keep
 *   the output readable without manual truncation.
 */

export const AST_FIND_PATTERN_LANGUAGES = ["ts", "tsx", "js", "jsx"] as const;
export type AstFindPatternLanguage = (typeof AST_FIND_PATTERN_LANGUAGES)[number];
export const AstFindPatternLanguageSchema = z.enum(AST_FIND_PATTERN_LANGUAGES);

export const AstFindPatternVariantSchema = z.enum(["original", "auto_anchored"]);
export type AstFindPatternVariant = z.infer<typeof AstFindPatternVariantSchema>;

export interface AstFindPatternAttempt {
  variant: AstFindPatternVariant;
  pattern: string;
  context?: string;
  selector?: string;
  languages: AstFindPatternLanguage[];
  filesTried: number;
  matchCount: number;
}

export const AstFindPatternAttemptSchema = z.object({
  variant: AstFindPatternVariantSchema,
  pattern: z.string().min(1),
  context: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  languages: z.array(AstFindPatternLanguageSchema),
  filesTried: z.number().int().nonnegative(),
  matchCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<AstFindPatternAttempt>;

export interface AstFindPatternMatch {
  filePath: string;
  language: AstFindPatternLanguage;
  patternVariant: AstFindPatternVariant;
  patternContext?: string;
  patternSelector?: string;
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
  matchText: string;
  captures: Record<string, string>;
  /**
   * Location-aware fingerprint that identifies this match for the
   * `finding_ack` ledger. Callers pass this verbatim as the `fingerprint`
   * field on `finding_ack` to acknowledge the match. Stable across runs
   * for the same (filePath, coords, matchText); distinguishes repeated
   * identical snippets in the same file via coords.
   */
  ackableFingerprint: string;
}

export const AstFindPatternMatchSchema = z.object({
  filePath: z.string().min(1),
  language: AstFindPatternLanguageSchema,
  patternVariant: AstFindPatternVariantSchema,
  patternContext: z.string().min(1).optional(),
  patternSelector: z.string().min(1).optional(),
  lineStart: z.number().int().nonnegative(),
  lineEnd: z.number().int().nonnegative(),
  columnStart: z.number().int().nonnegative(),
  columnEnd: z.number().int().nonnegative(),
  matchText: z.string(),
  captures: z.record(z.string()),
  ackableFingerprint: z.string().min(1),
}) satisfies z.ZodType<AstFindPatternMatch>;

export interface AstFindPatternToolInput {
  projectId?: string;
  projectRef?: string;
  pattern: string;
  captures?: string[];
  languages?: AstFindPatternLanguage[];
  // SQLite-style GLOB applied to the indexed file path. Only files whose
  // relative path matches are searched. Empty / omitted = all indexed files
  // within the language filter.
  pathGlob?: string;
  /**
   * Cost class: byte-cost. Ast-grep still scans eligible files before
   * this cap is applied; the cap only limits returned JSON. Default is
   * 500 so large text results can flow to MCP clients that persist
   * oversized output instead of losing mako-side detail.
   */
  maxMatches?: number;
  /**
   * Cost class: latency-cost. This bounds how many indexed files are
   * parsed/searched, so the default stays 500 even though the hard cap is
   * higher.
   */
  maxFiles?: number;
  /**
   * When set, matches whose `ackableFingerprint` has been acked under
   * this category (via the `finding_ack` tool) are filtered out and
   * counted in `acknowledgedCount`. Filter is status-agnostic — both
   * `ignored` and `accepted` rows dedupe.
   */
  excludeAcknowledgedCategory?: string;
}

export const AstFindPatternToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  pattern: z.string().trim().min(1),
  captures: z.array(z.string().trim().min(1)).max(16).optional(),
  languages: z.array(AstFindPatternLanguageSchema).min(1).max(4).optional(),
  pathGlob: z.string().trim().min(1).max(256).optional(),
  // Cost class: byte-cost. Default 500 in tool implementation; hard max unchanged.
  maxMatches: z.number().int().positive().max(2000).optional(),
  // Cost class: latency-cost. Default 500 in tool implementation; hard max unchanged.
  maxFiles: z.number().int().positive().max(5000).optional(),
  excludeAcknowledgedCategory: z.string().trim().min(1).optional(),
}).strict() satisfies z.ZodType<AstFindPatternToolInput>;

export interface AstFindPatternToolOutput {
  toolName: "ast_find_pattern";
  projectId: string;
  pattern: string;
  languagesApplied: AstFindPatternLanguage[];
  filesScanned: number;
  patternAttempts: AstFindPatternAttempt[];
  matches: AstFindPatternMatch[];
  /**
   * Matches filtered out by acks for the requested category. Always 0
   * when `excludeAcknowledgedCategory` is unset.
   */
  acknowledgedCount: number;
  reefFreshness: ReefQueryFreshness;
  reefExecution: ReefToolExecution;
  truncated: boolean;
  warnings: string[];
}

export const AstFindPatternToolOutputSchema = z.object({
  toolName: z.literal("ast_find_pattern"),
  projectId: z.string().min(1),
  pattern: z.string().min(1),
  languagesApplied: z.array(AstFindPatternLanguageSchema).min(1),
  filesScanned: z.number().int().nonnegative(),
  patternAttempts: z.array(AstFindPatternAttemptSchema),
  matches: z.array(AstFindPatternMatchSchema),
  acknowledgedCount: z.number().int().nonnegative(),
  reefFreshness: ReefQueryFreshnessSchema,
  reefExecution: ReefToolExecutionSchema,
  truncated: z.boolean(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<AstFindPatternToolOutput>;
