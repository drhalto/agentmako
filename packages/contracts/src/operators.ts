import { z } from "zod";
import type { JsonObject } from "./common.js";
import {
  type WorkflowPacketFollowOnHint,
  WorkflowPacketFollowOnHintSchema,
} from "./workflow-follow-on.js";

const JsonObjectSchema = z.record(z.unknown()) as z.ZodType<JsonObject>;

export type TenantLeakAuditRolloutStage = "dark" | "opt_in" | "default";
export type TenantLeakAuditSurfaceKind = "table" | "rpc" | "route" | "file";
export type TenantLeakAuditFindingStrength = "direct_evidence" | "weak_signal";
export type TenantLeakAuditReviewedClassification = "not_a_leak";
export type TenantLeakAuditFindingCode =
  | "table_rls_disabled"
  | "table_rls_policy_missing"
  | "table_policies_missing_tenant_signal"
  | "rpc_touches_protected_table_without_tenant_signal"
  | "route_rpc_usage_missing_tenant_signal"
  | "file_rpc_usage_missing_tenant_signal";

export interface TenantLeakAuditBasis {
  latestIndexRunId?: string | null;
  schemaSnapshotId?: string | null;
  schemaFingerprint?: string | null;
}

export interface TenantLeakAuditProtectedTable {
  tableKey: string;
  tenantColumns: string[];
  rlsEnabled: boolean;
  policyCount: number;
  evidenceRefs: string[];
}

export interface TenantLeakAuditFinding {
  findingId: string;
  strength: TenantLeakAuditFindingStrength;
  surfaceKind: TenantLeakAuditSurfaceKind;
  surfaceKey: string;
  code: TenantLeakAuditFindingCode;
  message: string;
  evidenceRefs: string[];
  tenantSignals: string[];
  metadata?: JsonObject;
}

export interface TenantLeakAuditReviewedSurface {
  surfaceKind: TenantLeakAuditSurfaceKind;
  surfaceKey: string;
  classification: TenantLeakAuditReviewedClassification;
  reason: string;
  evidenceRefs: string[];
  metadata?: JsonObject;
}

export interface TenantLeakAuditSummary {
  protectedTableCount: number;
  directEvidenceCount: number;
  weakSignalCount: number;
  reviewedSurfaceCount: number;
}

export interface TenantLeakAuditResult {
  advisoryOnly: true;
  rolloutStage: TenantLeakAuditRolloutStage;
  basis: TenantLeakAuditBasis;
  tenantSignals: string[];
  protectedTables: TenantLeakAuditProtectedTable[];
  findings: TenantLeakAuditFinding[];
  reviewedSurfaces: TenantLeakAuditReviewedSurface[];
  recommendedFollowOn?: WorkflowPacketFollowOnHint;
  summary: TenantLeakAuditSummary;
  warnings: string[];
}

export const TenantLeakAuditRolloutStageSchema = z.enum(["dark", "opt_in", "default"]);
export const TenantLeakAuditSurfaceKindSchema = z.enum(["table", "rpc", "route", "file"]);
export const TenantLeakAuditFindingStrengthSchema = z.enum(["direct_evidence", "weak_signal"]);
export const TenantLeakAuditReviewedClassificationSchema = z.enum(["not_a_leak"]);
export const TenantLeakAuditFindingCodeSchema = z.enum([
  "table_rls_disabled",
  "table_rls_policy_missing",
  "table_policies_missing_tenant_signal",
  "rpc_touches_protected_table_without_tenant_signal",
  "route_rpc_usage_missing_tenant_signal",
  "file_rpc_usage_missing_tenant_signal",
]);

export const TenantLeakAuditBasisSchema = z.object({
  latestIndexRunId: z.string().trim().min(1).nullable().optional(),
  schemaSnapshotId: z.string().trim().min(1).nullable().optional(),
  schemaFingerprint: z.string().trim().min(1).nullable().optional(),
}) satisfies z.ZodType<TenantLeakAuditBasis>;

export const TenantLeakAuditProtectedTableSchema = z.object({
  tableKey: z.string().trim().min(1),
  tenantColumns: z.array(z.string().trim().min(1)),
  rlsEnabled: z.boolean(),
  policyCount: z.number().int().nonnegative(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
}) satisfies z.ZodType<TenantLeakAuditProtectedTable>;

export const TenantLeakAuditFindingSchema = z.object({
  findingId: z.string().trim().min(1),
  strength: TenantLeakAuditFindingStrengthSchema,
  surfaceKind: TenantLeakAuditSurfaceKindSchema,
  surfaceKey: z.string().trim().min(1),
  code: TenantLeakAuditFindingCodeSchema,
  message: z.string().trim().min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  tenantSignals: z.array(z.string().trim().min(1)),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<TenantLeakAuditFinding>;

export const TenantLeakAuditReviewedSurfaceSchema = z.object({
  surfaceKind: TenantLeakAuditSurfaceKindSchema,
  surfaceKey: z.string().trim().min(1),
  classification: TenantLeakAuditReviewedClassificationSchema,
  reason: z.string().trim().min(1),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<TenantLeakAuditReviewedSurface>;

export const TenantLeakAuditSummarySchema = z.object({
  protectedTableCount: z.number().int().nonnegative(),
  directEvidenceCount: z.number().int().nonnegative(),
  weakSignalCount: z.number().int().nonnegative(),
  reviewedSurfaceCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<TenantLeakAuditSummary>;

export const TenantLeakAuditResultSchema = z.object({
  advisoryOnly: z.literal(true),
  rolloutStage: TenantLeakAuditRolloutStageSchema,
  basis: TenantLeakAuditBasisSchema,
  tenantSignals: z.array(z.string().trim().min(1)),
  protectedTables: z.array(TenantLeakAuditProtectedTableSchema),
  findings: z.array(TenantLeakAuditFindingSchema),
  reviewedSurfaces: z.array(TenantLeakAuditReviewedSurfaceSchema),
  recommendedFollowOn: WorkflowPacketFollowOnHintSchema.optional(),
  summary: TenantLeakAuditSummarySchema,
  warnings: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<TenantLeakAuditResult>;

// ---------------------------------------------------------------------------
// owasp_audit — OWASP Top 10 (2025) heuristic detection operator.
//
// Mirrors the tenant_leak_audit shape: an advisory, return-only operator that
// emits its own finding type (not AnswerSurfaceIssue/ProjectFinding) with a
// `strength` honesty signal. Each finding maps to an OWASP 2025 category with
// CWE references. The `coverage` section names every category and is explicit
// about which were scanned vs. left for human/design review, so the tool never
// implies a pass/fail security score it cannot stand behind.
// ---------------------------------------------------------------------------

export type OwaspCategoryId =
  | "A01"
  | "A02"
  | "A03"
  | "A04"
  | "A05"
  | "A06"
  | "A07"
  | "A08"
  | "A09"
  | "A10";
export type OwaspAuditRolloutStage = "dark" | "opt_in" | "default";
export type OwaspAuditFindingStrength = "direct_evidence" | "weak_signal";
export type OwaspAuditSurfaceKind = "route" | "file";
export type OwaspAuditSeverity = "low" | "medium" | "high" | "critical";
export type OwaspCoverageStatus = "scanned" | "signal_only" | "not_covered";

export interface OwaspAuditBasis {
  latestIndexRunId?: string | null;
  scannedFileCount: number;
  truncatedScan: boolean;
}

export interface OwaspAuditFinding {
  findingId: string;
  owaspCategory: OwaspCategoryId;
  owaspTitle: string;
  owaspRef: string;
  detectorId: string;
  strength: OwaspAuditFindingStrength;
  severity: OwaspAuditSeverity;
  surfaceKind: OwaspAuditSurfaceKind;
  surfaceKey: string;
  filePath: string;
  line?: number;
  message: string;
  cwe: string[];
  references: string[];
  evidenceRefs: string[];
  metadata?: JsonObject;
}

export interface OwaspCoverageEntry {
  owaspCategory: OwaspCategoryId;
  owaspTitle: string;
  owaspRef: string;
  status: OwaspCoverageStatus;
  detectorIds: string[];
  note: string;
}

export interface OwaspAuditSummary {
  findingCount: number;
  directEvidenceCount: number;
  weakSignalCount: number;
  scannedCategoryCount: number;
  notCoveredCategoryCount: number;
  byCategory: Record<string, number>;
}

export interface OwaspAuditResult {
  advisoryOnly: true;
  rolloutStage: OwaspAuditRolloutStage;
  basis: OwaspAuditBasis;
  coverage: OwaspCoverageEntry[];
  findings: OwaspAuditFinding[];
  recommendedFollowOn?: WorkflowPacketFollowOnHint;
  summary: OwaspAuditSummary;
  warnings: string[];
}

export const OwaspCategoryIdSchema = z.enum([
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "A07",
  "A08",
  "A09",
  "A10",
]);
export const OwaspAuditRolloutStageSchema = z.enum(["dark", "opt_in", "default"]);
export const OwaspAuditFindingStrengthSchema = z.enum(["direct_evidence", "weak_signal"]);
export const OwaspAuditSurfaceKindSchema = z.enum(["route", "file"]);
export const OwaspAuditSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export const OwaspCoverageStatusSchema = z.enum(["scanned", "signal_only", "not_covered"]);

export const OwaspAuditBasisSchema = z.object({
  latestIndexRunId: z.string().trim().min(1).nullable().optional(),
  scannedFileCount: z.number().int().nonnegative(),
  truncatedScan: z.boolean(),
}) satisfies z.ZodType<OwaspAuditBasis>;

export const OwaspAuditFindingSchema = z.object({
  findingId: z.string().trim().min(1),
  owaspCategory: OwaspCategoryIdSchema,
  owaspTitle: z.string().trim().min(1),
  owaspRef: z.string().trim().min(1),
  detectorId: z.string().trim().min(1),
  strength: OwaspAuditFindingStrengthSchema,
  severity: OwaspAuditSeveritySchema,
  surfaceKind: OwaspAuditSurfaceKindSchema,
  surfaceKey: z.string().trim().min(1),
  filePath: z.string().trim().min(1),
  line: z.number().int().positive().optional(),
  message: z.string().trim().min(1),
  cwe: z.array(z.string().trim().min(1)),
  references: z.array(z.string().trim().min(1)),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<OwaspAuditFinding>;

export const OwaspCoverageEntrySchema = z.object({
  owaspCategory: OwaspCategoryIdSchema,
  owaspTitle: z.string().trim().min(1),
  owaspRef: z.string().trim().min(1),
  status: OwaspCoverageStatusSchema,
  detectorIds: z.array(z.string().trim().min(1)),
  note: z.string().trim().min(1),
}) satisfies z.ZodType<OwaspCoverageEntry>;

export const OwaspAuditSummarySchema = z.object({
  findingCount: z.number().int().nonnegative(),
  directEvidenceCount: z.number().int().nonnegative(),
  weakSignalCount: z.number().int().nonnegative(),
  scannedCategoryCount: z.number().int().nonnegative(),
  notCoveredCategoryCount: z.number().int().nonnegative(),
  byCategory: z.record(z.number().int().nonnegative()),
}) satisfies z.ZodType<OwaspAuditSummary>;

export const OwaspAuditResultSchema = z.object({
  advisoryOnly: z.literal(true),
  rolloutStage: OwaspAuditRolloutStageSchema,
  basis: OwaspAuditBasisSchema,
  coverage: z.array(OwaspCoverageEntrySchema),
  findings: z.array(OwaspAuditFindingSchema),
  recommendedFollowOn: WorkflowPacketFollowOnHintSchema.optional(),
  summary: OwaspAuditSummarySchema,
  warnings: z.array(z.string().trim().min(1)),
}) satisfies z.ZodType<OwaspAuditResult>;
