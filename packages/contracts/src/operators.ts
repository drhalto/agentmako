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
