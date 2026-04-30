import { z } from "zod";
import type { AnswerSurfaceIssue } from "./answer.js";
import { AnswerSurfaceIssueSchema } from "./tool-answer-schemas.js";
import { ProjectLocatorInputObjectSchema } from "./tool-project-locator.js";

/**
 * `lint_files` — read-only diagnostics over an arbitrary indexed file set.
 *
 * Wraps the shared `collectDiagnosticsForFiles` primitive (rule-pack + TS-aware
 * alignment diagnostics + structural alignment diagnostics), which also powers
 * `collectAnswerDiagnostics` behind the answer loop and the `review_bundle`
 * artifact. This tool exposes the same engine directly so callers can audit
 * a set of files without routing through an answer.
 *
 * Scope:
 * - read-only: never edits files, never suggests fixes
 * - indexed files only: file paths are resolved against
 *   `projectStore.getFileContent(...)`; files outside the indexed snapshot
 *   are reported via `unresolvedFiles` rather than silently skipped
 * - bounded: optional `maxFindings` cap keeps noisy change surfaces readable
 *   without manual truncation
 */

export interface LintFilesToolInput {
  projectId?: string;
  projectRef?: string;
  files: string[];
  verbosity?: "compact" | "full";
  // Optional "primary" focus file. When set, findings are filtered to only
  // those that touch it (same semantics as `collectAnswerDiagnostics` when
  // the query kind is `file_health` / `trace_file`).
  primaryFocusFile?: string;
  /**
   * Cost class: byte-cost. Diagnostics are collected before this cap is
   * applied; the cap only limits returned findings. Default is 500 so
   * large text results can flow to MCP clients that persist oversized
   * output instead of losing mako-side detail.
   */
  maxFindings?: number;
  /**
   * When set, findings whose `identity.matchBasedId` has been acked
   * under this category (via the `finding_ack` tool) are filtered out
   * and counted in `acknowledgedCount`. For lint findings the
   * recommended default category is `finding.code`. Filter is
   * status-agnostic — both `ignored` and `accepted` rows dedupe.
   */
  excludeAcknowledgedCategory?: string;
}

export const LintFilesToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  files: z.array(z.string().trim().min(1)).min(1).max(200),
  verbosity: z.enum(["compact", "full"]).optional(),
  primaryFocusFile: z.string().trim().min(1).optional(),
  // Cost class: byte-cost. Default 500 in tool implementation; hard max unchanged.
  maxFindings: z.number().int().positive().max(1000).optional(),
  excludeAcknowledgedCategory: z.string().trim().min(1).optional(),
}).strict() satisfies z.ZodType<LintFilesToolInput>;

export interface LintFilesToolOutput {
  toolName: "lint_files";
  projectId: string;
  resolvedFiles: string[];
  unresolvedFiles: string[];
  findings: AnswerSurfaceIssue[];
  /**
   * Findings filtered out by acks for the requested category. Always 0
   * when `excludeAcknowledgedCategory` is unset.
   */
  acknowledgedCount: number;
  truncated: boolean;
  warnings: string[];
}

export const LintFilesToolOutputSchema = z.object({
  toolName: z.literal("lint_files"),
  projectId: z.string().min(1),
  resolvedFiles: z.array(z.string().min(1)),
  unresolvedFiles: z.array(z.string().min(1)),
  findings: z.array(AnswerSurfaceIssueSchema),
  acknowledgedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<LintFilesToolOutput>;
