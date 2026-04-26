import { z } from "zod";
import type { JsonObject, Timestamp } from "./common.js";
import { JsonObjectSchema, TimestampSchema } from "./tool-schema-shared.js";

export const PROJECT_OVERLAYS = ["indexed", "working_tree", "staged", "preview"] as const;
export type ProjectOverlay = (typeof PROJECT_OVERLAYS)[number];
export const ProjectOverlaySchema = z.enum(PROJECT_OVERLAYS);

export const REEF_SEVERITIES = ["info", "warning", "error"] as const;
export type ReefSeverity = (typeof REEF_SEVERITIES)[number];
export const ReefSeveritySchema = z.enum(REEF_SEVERITIES);

export const PROJECT_FINDING_STATUSES = ["active", "resolved", "acknowledged", "suppressed"] as const;
export type ProjectFindingStatus = (typeof PROJECT_FINDING_STATUSES)[number];
export const ProjectFindingStatusSchema = z.enum(PROJECT_FINDING_STATUSES);

export const FACT_FRESHNESS_STATES = ["fresh", "stale", "unknown"] as const;
export type FactFreshnessState = (typeof FACT_FRESHNESS_STATES)[number];
export const FactFreshnessStateSchema = z.enum(FACT_FRESHNESS_STATES);

export const REEF_DIAGNOSTIC_RUN_STATUSES = ["unavailable", "ran_with_error", "succeeded"] as const;
export type ReefDiagnosticRunStatus = (typeof REEF_DIAGNOSTIC_RUN_STATUSES)[number];
export const ReefDiagnosticRunStatusSchema = z.enum(REEF_DIAGNOSTIC_RUN_STATUSES);

export const REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS = 30 * 60 * 1000;
export const REEF_DIAGNOSTIC_CACHE_STATES = ["fresh", "stale", "unknown"] as const;
export type ReefDiagnosticCacheState = (typeof REEF_DIAGNOSTIC_CACHE_STATES)[number];
export const ReefDiagnosticCacheStateSchema = z.enum(REEF_DIAGNOSTIC_CACHE_STATES);

export interface FactFreshness {
  state: FactFreshnessState;
  checkedAt: Timestamp;
  reason: string;
}

export const FactFreshnessSchema = z.object({
  state: FactFreshnessStateSchema,
  checkedAt: TimestampSchema,
  reason: z.string().min(1),
}) satisfies z.ZodType<FactFreshness>;

export type FactSubject =
  | { kind: "file"; path: string }
  | { kind: "symbol"; path: string; symbolName: string; line?: number }
  | { kind: "route"; routeKey: string }
  | { kind: "schema_object"; schemaName: string; objectName: string }
  | { kind: "import_edge"; sourcePath: string; targetPath: string }
  | { kind: "diagnostic"; path: string; ruleId?: string; code?: string };

export const FactSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1) }),
  z.object({
    kind: z.literal("symbol"),
    path: z.string().min(1),
    symbolName: z.string().min(1),
    line: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal("route"), routeKey: z.string().min(1) }),
  z.object({
    kind: z.literal("schema_object"),
    schemaName: z.string().min(1),
    objectName: z.string().min(1),
  }),
  z.object({
    kind: z.literal("import_edge"),
    sourcePath: z.string().min(1),
    targetPath: z.string().min(1),
  }),
  z.object({
    kind: z.literal("diagnostic"),
    path: z.string().min(1),
    ruleId: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
  }),
]) satisfies z.ZodType<FactSubject>;

export type ReefCalculationDependency =
  | { kind: "file"; path: string }
  | { kind: "glob"; pattern: string }
  | { kind: "fact_kind"; factKind: string }
  | { kind: "config"; path: string };

export const ReefCalculationDependencySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1) }),
  z.object({ kind: z.literal("glob"), pattern: z.string().min(1) }),
  z.object({ kind: z.literal("fact_kind"), factKind: z.string().min(1) }),
  z.object({ kind: z.literal("config"), path: z.string().min(1) }),
]) satisfies z.ZodType<ReefCalculationDependency>;

export interface FactProvenance {
  source: string;
  capturedAt: Timestamp;
  dependencies?: ReefCalculationDependency[];
  metadata?: JsonObject;
}

export const FactProvenanceSchema = z.object({
  source: z.string().min(1),
  capturedAt: TimestampSchema,
  dependencies: z.array(ReefCalculationDependencySchema).optional(),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<FactProvenance>;

export interface ProjectFact {
  projectId: string;
  kind: string;
  subject: FactSubject;
  subjectFingerprint: string;
  overlay: ProjectOverlay;
  source: string;
  confidence: number;
  fingerprint: string;
  freshness: FactFreshness;
  provenance: FactProvenance;
  data?: JsonObject;
}

export const ProjectFactSchema = z.object({
  projectId: z.string().min(1),
  kind: z.string().min(1),
  subject: FactSubjectSchema,
  subjectFingerprint: z.string().min(1),
  overlay: ProjectOverlaySchema,
  source: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fingerprint: z.string().min(1),
  freshness: FactFreshnessSchema,
  provenance: FactProvenanceSchema,
  data: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ProjectFact>;

export interface ProjectFindingSuggestedFix {
  kind: "edit" | "manual";
  description: string;
}

export const ProjectFindingSuggestedFixSchema = z.object({
  kind: z.enum(["edit", "manual"]),
  description: z.string().min(1),
}) satisfies z.ZodType<ProjectFindingSuggestedFix>;

export interface ProjectFinding {
  projectId: string;
  fingerprint: string;
  source: string;
  subjectFingerprint: string;
  overlay: ProjectOverlay;
  severity: ReefSeverity;
  status: ProjectFindingStatus;
  filePath?: string;
  line?: number;
  ruleId?: string;
  documentationUrl?: string;
  suggestedFix?: ProjectFindingSuggestedFix;
  evidenceRefs?: string[];
  freshness: FactFreshness;
  capturedAt: Timestamp;
  message: string;
  factFingerprints: string[];
}

export const ProjectFindingSchema = z.object({
  projectId: z.string().min(1),
  fingerprint: z.string().min(1),
  source: z.string().min(1),
  subjectFingerprint: z.string().min(1),
  overlay: ProjectOverlaySchema,
  severity: ReefSeveritySchema,
  status: ProjectFindingStatusSchema,
  filePath: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  ruleId: z.string().min(1).optional(),
  documentationUrl: z.string().min(1).optional(),
  suggestedFix: ProjectFindingSuggestedFixSchema.optional(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  freshness: FactFreshnessSchema,
  capturedAt: TimestampSchema,
  message: z.string().min(1),
  factFingerprints: z.array(z.string().min(1)),
}) satisfies z.ZodType<ProjectFinding>;

export interface ReefRuleDescriptor {
  id: string;
  version: string;
  source: string;
  sourceNamespace: string;
  type: "problem" | "suggestion" | "overlay";
  severity: ReefSeverity;
  title: string;
  description: string;
  docs?: { body: string };
  documentationUrl?: string;
  factKinds: string[];
  dependsOnFactKinds?: string[];
  fixable?: boolean;
  tags?: string[];
  enabledByDefault: boolean;
}

export const ReefRuleDescriptorSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  source: z.string().min(1),
  sourceNamespace: z.string().min(1),
  type: z.enum(["problem", "suggestion", "overlay"]),
  severity: ReefSeveritySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  docs: z.object({ body: z.string() }).optional(),
  documentationUrl: z.string().min(1).optional(),
  factKinds: z.array(z.string().min(1)),
  dependsOnFactKinds: z.array(z.string().min(1)).optional(),
  fixable: z.boolean().optional(),
  tags: z.array(z.string().min(1)).optional(),
  enabledByDefault: z.boolean(),
}) satisfies z.ZodType<ReefRuleDescriptor>;

export interface ReefDiagnosticRunCache {
  state: ReefDiagnosticCacheState;
  checkedAt: Timestamp;
  ageMs?: number;
  staleAfterMs: number;
  reason: string;
}

export const ReefDiagnosticRunCacheSchema = z.object({
  state: ReefDiagnosticCacheStateSchema,
  checkedAt: TimestampSchema,
  ageMs: z.number().int().nonnegative().optional(),
  staleAfterMs: z.number().int().positive(),
  reason: z.string().min(1),
}) satisfies z.ZodType<ReefDiagnosticRunCache>;

export interface ReefDiagnosticRun {
  runId: string;
  projectId: string;
  source: string;
  overlay: ProjectOverlay;
  status: ReefDiagnosticRunStatus;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMs: number;
  checkedFileCount?: number;
  findingCount: number;
  persistedFindingCount: number;
  command?: string;
  cwd?: string;
  configPath?: string;
  errorText?: string;
  metadata?: JsonObject;
  cache?: ReefDiagnosticRunCache;
}

export const ReefDiagnosticRunSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  source: z.string().min(1),
  overlay: ProjectOverlaySchema,
  status: ReefDiagnosticRunStatusSchema,
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema,
  durationMs: z.number().int().nonnegative(),
  checkedFileCount: z.number().int().nonnegative().optional(),
  findingCount: z.number().int().nonnegative(),
  persistedFindingCount: z.number().int().nonnegative(),
  command: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  configPath: z.string().min(1).optional(),
  errorText: z.string().min(1).optional(),
  metadata: JsonObjectSchema.optional(),
  cache: ReefDiagnosticRunCacheSchema.optional(),
}) satisfies z.ZodType<ReefDiagnosticRun>;

export const DB_REVIEW_OBJECT_TYPES = [
  "database",
  "schema",
  "table",
  "view",
  "column",
  "index",
  "foreign_key",
  "rpc",
  "function",
  "policy",
  "rls_policy",
  "trigger",
  "enum",
  "publication",
  "subscription",
  "replication_slot",
  "replication",
  "unknown",
] as const;
export type DbReviewObjectType = (typeof DB_REVIEW_OBJECT_TYPES)[number];
export const DbReviewObjectTypeSchema = z.enum(DB_REVIEW_OBJECT_TYPES);

export const DB_REVIEW_COMMENT_CATEGORIES = [
  "note",
  "review",
  "risk",
  "decision",
  "todo",
] as const;
export type DbReviewCommentCategory = (typeof DB_REVIEW_COMMENT_CATEGORIES)[number];
export const DbReviewCommentCategorySchema = z.enum(DB_REVIEW_COMMENT_CATEGORIES);

export interface DbReviewTarget {
  objectType: DbReviewObjectType;
  objectName: string;
  schemaName?: string;
  parentObjectName?: string;
}

export const DbReviewTargetSchema = z.object({
  objectType: DbReviewObjectTypeSchema,
  objectName: z.string().trim().min(1),
  schemaName: z.string().trim().min(1).optional(),
  parentObjectName: z.string().trim().min(1).optional(),
}) satisfies z.ZodType<DbReviewTarget>;

export interface DbReviewComment {
  commentId: string;
  projectId: string;
  target: DbReviewTarget;
  targetFingerprint: string;
  category: DbReviewCommentCategory;
  severity?: ReefSeverity;
  comment: string;
  tags: string[];
  createdBy?: string;
  createdAt: Timestamp;
  sourceToolName: string;
  metadata?: JsonObject;
}

export const DbReviewCommentSchema = z.object({
  commentId: z.string().min(1),
  projectId: z.string().min(1),
  target: DbReviewTargetSchema,
  targetFingerprint: z.string().min(1),
  category: DbReviewCommentCategorySchema,
  severity: ReefSeveritySchema.optional(),
  comment: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)),
  createdBy: z.string().trim().min(1).optional(),
  createdAt: TimestampSchema,
  sourceToolName: z.string().min(1),
  metadata: JsonObjectSchema.optional(),
}) satisfies z.ZodType<DbReviewComment>;
