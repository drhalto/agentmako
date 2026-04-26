import { z } from "zod";
import type { JsonObject } from "./common.js";
import { ProjectLocatorInputObjectSchema, type ProjectLocatorInput } from "./tool-project-locator.js";

const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;

export const GitPrecommitFindingCodeSchema = z.enum([
  "git.unprotected_route",
  "git.client_uses_server_only",
  "git.server_uses_client_hook",
]);

export type GitPrecommitFindingCode = z.infer<typeof GitPrecommitFindingCodeSchema>;

export const GitPrecommitStagedChangeStatusSchema = z.enum([
  "added",
  "copied",
  "modified",
  "renamed",
  "deleted",
]);

export type GitPrecommitStagedChangeStatus = z.infer<typeof GitPrecommitStagedChangeStatusSchema>;

export interface GitPrecommitStagedChange {
  status: GitPrecommitStagedChangeStatus;
  path: string;
  oldPath?: string;
}

export const GitPrecommitStagedChangeSchema = z.object({
  status: GitPrecommitStagedChangeStatusSchema,
  path: z.string().min(1),
  oldPath: z.string().min(1).optional(),
}) satisfies z.ZodType<GitPrecommitStagedChange>;

export interface GitPrecommitFinding {
  code: GitPrecommitFindingCode;
  severity: "high" | "critical";
  path: string;
  line?: number;
  message: string;
  evidence: string;
  metadata?: JsonObject;
}

export const GitPrecommitFindingSchema = z.object({
  code: GitPrecommitFindingCodeSchema,
  severity: z.enum(["high", "critical"]),
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  message: z.string().min(1),
  evidence: z.string().min(1),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<GitPrecommitFinding>;

export interface GitPrecommitCheckToolInput extends ProjectLocatorInput {
  /**
   * Project-relative path globs that are intentionally public API routes.
   * Values are merged with `.mako/git-guard.json` when present.
   */
  publicRouteGlobs?: string[];
  /**
   * Extra auth guard function/call names. Values are merged with discovered
   * project profile guard symbols and `.mako/git-guard.json`.
   */
  authGuardSymbols?: string[];
  /**
   * Extra project-relative modules that should be treated as server-only when
   * imported from a `"use client"` file.
   */
  serverOnlyModules?: string[];
  /**
   * Staged source extensions to inspect. Defaults to `.ts` and `.tsx` to
   * mirror the Fenrir hook.
   */
  includeExtensions?: string[];
}

export const GitPrecommitCheckToolInputSchema = ProjectLocatorInputObjectSchema.extend({
  publicRouteGlobs: z.array(z.string().trim().min(1)).max(200).optional(),
  authGuardSymbols: z.array(z.string().trim().min(1)).max(200).optional(),
  serverOnlyModules: z.array(z.string().trim().min(1)).max(500).optional(),
  includeExtensions: z.array(z.enum([".ts", ".tsx", ".js", ".jsx"])).min(1).max(4).optional(),
}).strict() satisfies z.ZodType<GitPrecommitCheckToolInput>;

export interface GitPrecommitCheckToolOutput {
  toolName: "git_precommit_check";
  projectId: string;
  projectRoot: string;
  gitRoot: string;
  stagedChanges: GitPrecommitStagedChange[];
  stagedFiles: string[];
  checkedFiles: string[];
  skippedFiles: string[];
  findings: GitPrecommitFinding[];
  warnings: string[];
  policy: {
    publicRouteGlobs: string[];
    authGuardSymbols: string[];
    serverOnlyModules: string[];
    includeExtensions: string[];
    configSources: string[];
  };
  continue: boolean;
  stopReason?: string;
}

export const GitPrecommitCheckToolOutputSchema = z.object({
  toolName: z.literal("git_precommit_check"),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  gitRoot: z.string().min(1),
  stagedChanges: z.array(GitPrecommitStagedChangeSchema),
  stagedFiles: z.array(z.string().min(1)),
  checkedFiles: z.array(z.string().min(1)),
  skippedFiles: z.array(z.string().min(1)),
  findings: z.array(GitPrecommitFindingSchema),
  warnings: z.array(z.string().min(1)),
  policy: z.object({
    publicRouteGlobs: z.array(z.string().min(1)),
    authGuardSymbols: z.array(z.string().min(1)),
    serverOnlyModules: z.array(z.string().min(1)),
    includeExtensions: z.array(z.string().min(1)),
    configSources: z.array(z.string().min(1)),
  }),
  continue: z.boolean(),
  stopReason: z.string().min(1).optional(),
}) satisfies z.ZodType<GitPrecommitCheckToolOutput>;
