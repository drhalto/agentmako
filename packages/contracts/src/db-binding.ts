import { z } from "zod";
import type { Timestamp } from "./common.js";
import type { ProjectBindingStrategy } from "./project.js";
import type { SchemaSourceMode } from "./schema-snapshot.js";
import { ProjectBindingStrategySchema } from "./project.js";
import { SchemaSourceModeSchema } from "./schema-snapshot.js";

export type DbBindingTestStatus = "untested" | "success" | "failure";

export interface DbBindingStatus {
  strategy: ProjectBindingStrategy;
  ref: string;
  enabled: boolean;
  configured: boolean;
  lastTestedAt?: Timestamp;
  lastTestStatus?: DbBindingTestStatus;
  lastTestError?: string;
  lastVerifiedAt?: Timestamp;
  lastRefreshedAt?: Timestamp;
  sourceMode?: SchemaSourceMode;
  driftDetected?: boolean;
}

export interface DbConnectionTestResult {
  success: boolean;
  testedAt: Timestamp;
  strategy: ProjectBindingStrategy;
  ref: string;
  serverVersion?: string;
  currentUser?: string;
  error?: string;
}

export type DbVerificationOutcome =
  | "verified"
  | "drift_detected"
  | "snapshot_missing";

export interface DbSchemaDiff {
  additions: string[];
  removals: string[];
  unchangedCount: number;
}

export interface DbVerificationResult {
  outcome: DbVerificationOutcome;
  verifiedAt: Timestamp;
  partial: boolean;
  includedSchemas?: string[];
  snapshotId?: string;
  tableDiff: DbSchemaDiff;
  columnDiff: DbSchemaDiff;
  enumDiff: DbSchemaDiff;
  rpcDiff: DbSchemaDiff;
  indexDiff: DbSchemaDiff;
  foreignKeyDiff: DbSchemaDiff;
  rlsDiff: DbSchemaDiff;
  triggerDiff: DbSchemaDiff;
}

export interface DbRefreshResult {
  snapshotId: string;
  fingerprint: string;
  sourceMode: SchemaSourceMode;
  refreshedAt: Timestamp;
  tableCount: number;
  warningCount: number;
}

export const DbBindingTestStatusSchema = z.enum(["untested", "success", "failure"]);

export const DbBindingStatusSchema: z.ZodType<DbBindingStatus> = z.object({
  strategy: ProjectBindingStrategySchema,
  ref: z.string(),
  enabled: z.boolean(),
  configured: z.boolean(),
  lastTestedAt: z.string().optional(),
  lastTestStatus: DbBindingTestStatusSchema.optional(),
  lastTestError: z.string().optional(),
  lastVerifiedAt: z.string().optional(),
  lastRefreshedAt: z.string().optional(),
  sourceMode: SchemaSourceModeSchema.optional(),
  driftDetected: z.boolean().optional(),
});

export const DbConnectionTestResultSchema: z.ZodType<DbConnectionTestResult> = z.object({
  success: z.boolean(),
  testedAt: z.string(),
  strategy: ProjectBindingStrategySchema,
  ref: z.string(),
  serverVersion: z.string().optional(),
  currentUser: z.string().optional(),
  error: z.string().optional(),
});

export const DbSchemaDiffSchema: z.ZodType<DbSchemaDiff> = z.object({
  additions: z.array(z.string()),
  removals: z.array(z.string()),
  unchangedCount: z.number().int().nonnegative(),
});

export const DbVerificationOutcomeSchema = z.enum([
  "verified",
  "drift_detected",
  "snapshot_missing",
]);

export const DbVerificationResultSchema: z.ZodType<DbVerificationResult> = z.object({
  outcome: DbVerificationOutcomeSchema,
  verifiedAt: z.string(),
  partial: z.boolean(),
  includedSchemas: z.array(z.string()).optional(),
  snapshotId: z.string().optional(),
  tableDiff: DbSchemaDiffSchema,
  columnDiff: DbSchemaDiffSchema,
  enumDiff: DbSchemaDiffSchema,
  rpcDiff: DbSchemaDiffSchema,
  indexDiff: DbSchemaDiffSchema,
  foreignKeyDiff: DbSchemaDiffSchema,
  rlsDiff: DbSchemaDiffSchema,
  triggerDiff: DbSchemaDiffSchema,
});

export const DbRefreshResultSchema: z.ZodType<DbRefreshResult> = z.object({
  snapshotId: z.string(),
  fingerprint: z.string(),
  sourceMode: SchemaSourceModeSchema,
  refreshedAt: z.string(),
  tableCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});
