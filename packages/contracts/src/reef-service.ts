import { z } from "zod";
import type { IndexRunStatus, JsonObject, ProjectStatus, Timestamp } from "./common.js";
import {
  IndexFreshnessSummarySchema,
  ProjectIndexWatchCatchUpMethodSchema,
  ProjectIndexWatchCatchUpStatusSchema,
  ProjectIndexWatchStateSchema,
  ReefFreshnessPolicySchema,
  ReefSnapshotBehaviorSchema,
  type ProjectIndexWatchState,
  type ReefFreshnessPolicy,
  type ReefSnapshotBehavior,
} from "./index-freshness.js";
import {
  SchemaFreshnessStatusSchema,
  SchemaSourceModeSchema,
  type SchemaFreshnessStatus,
  type SchemaSourceMode,
} from "./schema-snapshot.js";
import { JsonObjectSchema, TimestampSchema } from "./tool-schema-shared.js";
import {
  ReefCalculationExecutionPlanSchema,
  type ReefCalculationExecutionPlan,
} from "./reef.js";

export const REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;

export const ReefServiceModeSchema = z.enum(["daemon", "in_process"]);
export type ReefServiceMode = z.infer<typeof ReefServiceModeSchema>;

export const ReefRuntimeModeSchema = z.enum(["auto", "required", "legacy"]);
export type ReefRuntimeMode = z.infer<typeof ReefRuntimeModeSchema>;

export const ReefDaemonTransportSchema = z.enum(["pipe", "unix_socket", "localhost"]);
export type ReefDaemonTransport = z.infer<typeof ReefDaemonTransportSchema>;

export interface ReefDaemonProcessInfo {
  pid: number;
  endpoint: string;
  transport: ReefDaemonTransport;
  protocolVersion: string;
  packageVersion: string;
  startedAt: Timestamp;
  stateHome: string;
  tokenFingerprint: string;
}

export const ReefDaemonProcessInfoSchema = z.object({
  pid: z.number().int().positive(),
  endpoint: z.string().min(1),
  transport: ReefDaemonTransportSchema,
  protocolVersion: z.string().min(1),
  packageVersion: z.string().min(1),
  startedAt: TimestampSchema,
  stateHome: z.string().min(1),
  tokenFingerprint: z.string().min(1),
}) satisfies z.ZodType<ReefDaemonProcessInfo>;

export interface ReefDaemonStatus {
  serviceMode: ReefRuntimeMode;
  available: boolean;
  compatible: boolean;
  process?: ReefDaemonProcessInfo;
  error?: string;
  projects: ReefProjectStatus[];
}

export const ReefDaemonStatusSchema = z.object({
  serviceMode: ReefRuntimeModeSchema,
  available: z.boolean(),
  compatible: z.boolean(),
  process: ReefDaemonProcessInfoSchema.optional(),
  error: z.string().min(1).optional(),
  projects: z.array(z.lazy(() => ReefProjectStatusSchema)),
}) satisfies z.ZodType<ReefDaemonStatus>;

export interface ReefDaemonStartResult {
  started: boolean;
  reused: boolean;
  foreground: boolean;
  process?: ReefDaemonProcessInfo;
  message: string;
}

export const ReefDaemonStartResultSchema = z.object({
  started: z.boolean(),
  reused: z.boolean(),
  foreground: z.boolean(),
  process: ReefDaemonProcessInfoSchema.optional(),
  message: z.string().min(1),
}) satisfies z.ZodType<ReefDaemonStartResult>;

export interface ReefDaemonStopResult {
  stopped: boolean;
  process?: ReefDaemonProcessInfo;
  message: string;
}

export const ReefDaemonStopResultSchema = z.object({
  stopped: z.boolean(),
  process: ReefDaemonProcessInfoSchema.optional(),
  message: z.string().min(1),
}) satisfies z.ZodType<ReefDaemonStopResult>;

export const ReefProjectStateSchema = z.enum([
  "fresh",
  "refreshing",
  "dirty",
  "stale",
  "unknown",
  "disabled",
  "error",
]);
export type ReefProjectState = z.infer<typeof ReefProjectStateSchema>;

export const ReefAnalysisRevisionStateSchema = z.enum([
  "unavailable",
  "initializing",
  "active",
]);
export type ReefAnalysisRevisionState = z.infer<typeof ReefAnalysisRevisionStateSchema>;

export const ReefDiagnosticSourceKindSchema = z.enum([
  "syntactic",
  "semantic",
  "lint",
  "schema",
  "programmatic",
]);
export type ReefDiagnosticSourceKind = z.infer<typeof ReefDiagnosticSourceKindSchema>;

export const ReefDiagnosticSourceStateSchema = z.enum([
  "clean",
  "findings",
  "stale",
  "failed",
  "unavailable",
  "unknown",
]);
export type ReefDiagnosticSourceState = z.infer<typeof ReefDiagnosticSourceStateSchema>;

export interface ReefDiagnosticSourceStatus {
  source: string;
  kind: ReefDiagnosticSourceKind;
  state: ReefDiagnosticSourceState;
  reason: string;
  latestRunId?: string;
  latestFinishedAt?: Timestamp;
  inputRevision?: number;
  outputRevision?: number;
  checkedFileCount?: number;
  findingCount?: number;
  staleFileCount: number;
}

export const ReefDiagnosticSourceStatusSchema = z.object({
  source: z.string().min(1),
  kind: ReefDiagnosticSourceKindSchema,
  state: ReefDiagnosticSourceStateSchema,
  reason: z.string().min(1),
  latestRunId: z.string().min(1).optional(),
  latestFinishedAt: TimestampSchema.optional(),
  inputRevision: z.number().int().nonnegative().optional(),
  outputRevision: z.number().int().nonnegative().optional(),
  checkedFileCount: z.number().int().nonnegative().optional(),
  findingCount: z.number().int().nonnegative().optional(),
  staleFileCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<ReefDiagnosticSourceStatus>;

export interface ReefDiagnosticChangedFile {
  filePath: string;
  lastModifiedAt: Timestamp;
  staleSources: string[];
}

export const ReefDiagnosticChangedFileSchema = z.object({
  filePath: z.string().min(1),
  lastModifiedAt: TimestampSchema,
  staleSources: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefDiagnosticChangedFile>;

export interface ReefProjectDiagnosticStatus {
  checkedAt: Timestamp;
  staleAfterMs: number;
  typescript: {
    syntactic: ReefDiagnosticSourceStatus;
    semantic: ReefDiagnosticSourceStatus;
  };
  sources: ReefDiagnosticSourceStatus[];
  changedAfterCheck: ReefDiagnosticChangedFile[];
}

export const ReefProjectDiagnosticStatusSchema = z.object({
  checkedAt: TimestampSchema,
  staleAfterMs: z.number().int().positive(),
  typescript: z.object({
    syntactic: ReefDiagnosticSourceStatusSchema,
    semantic: ReefDiagnosticSourceStatusSchema,
  }),
  sources: z.array(ReefDiagnosticSourceStatusSchema),
  changedAfterCheck: z.array(ReefDiagnosticChangedFileSchema),
}) satisfies z.ZodType<ReefProjectDiagnosticStatus>;

export const ReefSchemaSourceFreshnessStateSchema = z.enum([
  "fresh",
  "stale",
  "unknown",
  "no_snapshot",
]);
export type ReefSchemaSourceFreshnessState = z.infer<typeof ReefSchemaSourceFreshnessStateSchema>;

export const ReefSchemaLiveFreshnessStateSchema = z.enum([
  "fresh",
  "stale",
  "unknown",
  "not_bound",
]);
export type ReefSchemaLiveFreshnessState = z.infer<typeof ReefSchemaLiveFreshnessStateSchema>;

export interface ReefProjectSchemaStatus {
  checkedAt: Timestamp;
  state: "fresh" | "stale" | "unknown" | "no_snapshot";
  reason: string;
  snapshotId?: string;
  sourceMode?: SchemaSourceMode;
  freshnessStatus?: SchemaFreshnessStatus;
  sourceFreshness: ReefSchemaSourceFreshnessState;
  liveDbFreshness: ReefSchemaLiveFreshnessState;
  liveDbBound: boolean;
  lastSnapshotAt?: Timestamp;
  lastVerifiedAt?: Timestamp;
  liveSnapshotMaxAgeMs: number;
  snapshotAgeMs?: number;
  driftDetected?: boolean;
}

export const ReefProjectSchemaStatusSchema = z.object({
  checkedAt: TimestampSchema,
  state: z.enum(["fresh", "stale", "unknown", "no_snapshot"]),
  reason: z.string().min(1),
  snapshotId: z.string().min(1).optional(),
  sourceMode: SchemaSourceModeSchema.optional(),
  freshnessStatus: SchemaFreshnessStatusSchema.optional(),
  sourceFreshness: ReefSchemaSourceFreshnessStateSchema,
  liveDbFreshness: ReefSchemaLiveFreshnessStateSchema,
  liveDbBound: z.boolean(),
  lastSnapshotAt: TimestampSchema.optional(),
  lastVerifiedAt: TimestampSchema.optional(),
  liveSnapshotMaxAgeMs: z.number().int().positive(),
  snapshotAgeMs: z.number().int().nonnegative().optional(),
  driftDetected: z.boolean().optional(),
}) satisfies z.ZodType<ReefProjectSchemaStatus>;

export interface RegisterProjectInput {
  root: string;
  displayName?: string;
  watchEnabled?: boolean;
}

export const RegisterProjectInputSchema = z.object({
  root: z.string().trim().min(1),
  displayName: z.string().trim().min(1).optional(),
  watchEnabled: z.boolean().optional(),
}) satisfies z.ZodType<RegisterProjectInput>;

export interface RegisteredProject {
  projectId: string;
  root: string;
  canonicalRoot: string;
  displayName?: string;
  addedAt: Timestamp;
  lastSeenAt?: Timestamp;
  watchEnabled: boolean;
  status: ProjectStatus | "degraded" | "disabled" | "error";
}

export const RegisteredProjectSchema = z.object({
  projectId: z.string().min(1),
  root: z.string().min(1),
  canonicalRoot: z.string().min(1),
  displayName: z.string().min(1).optional(),
  addedAt: TimestampSchema,
  lastSeenAt: TimestampSchema.optional(),
  watchEnabled: z.boolean(),
  status: z.enum(["active", "detached", "archived", "degraded", "disabled", "error"]),
}) satisfies z.ZodType<RegisteredProject>;

export interface ReefProjectStatus {
  projectId: string;
  root: string;
  serviceMode: ReefServiceMode;
  state: ReefProjectState;
  analysis: {
    hostId?: string;
    revisionState: ReefAnalysisRevisionState;
    currentRevision?: number;
    lastAppliedChangeSetId?: string;
    lastAppliedAt?: Timestamp;
    pendingChangeSets?: number;
    runningQueryCount: number;
    canceledQueryCount: number;
    materializedRevision?: number;
  };
  watcher: {
    active: boolean;
    degraded: boolean;
    backend?: string;
    dirtyPathCount: number;
    lastEventAt?: Timestamp;
    lastError?: string;
    recrawlCount: number;
    lastRecrawlAt?: Timestamp;
    lastRecrawlReason?: string;
    lastRecrawlWarning?: string;
    lastCatchUpAt?: Timestamp;
    lastCatchUpStatus?: z.infer<typeof ProjectIndexWatchCatchUpStatusSchema>;
    lastCatchUpMethod?: z.infer<typeof ProjectIndexWatchCatchUpMethodSchema>;
    lastCatchUpDurationMs?: number;
    lastCatchUpReason?: string;
    lastCatchUpError?: string;
    state?: ProjectIndexWatchState;
  };
  writerQueue: {
    running: boolean;
    queued: number;
    activeKind?: "refresh" | "materialization" | "diagnostic" | "schema" | "audit";
    lastRunAt?: Timestamp;
    lastRunTrigger?: string;
    lastRunResult?: "succeeded" | "failed" | "skipped";
  };
  freshness: {
    checkedAt: Timestamp;
    indexedFiles: number;
    staleFiles: number;
    deletedFiles: number;
    unknownFiles: number;
    unindexedFiles: number;
    unindexedScan: "skipped" | "running" | "completed";
  };
  diagnostics?: ReefProjectDiagnosticStatus;
  schema?: ReefProjectSchemaStatus;
}

export const ReefProjectStatusSchema = z.object({
  projectId: z.string().min(1),
  root: z.string().min(1),
  serviceMode: ReefServiceModeSchema,
  state: ReefProjectStateSchema,
  analysis: z.object({
    hostId: z.string().min(1).optional(),
    revisionState: ReefAnalysisRevisionStateSchema,
    currentRevision: z.number().int().nonnegative().optional(),
    lastAppliedChangeSetId: z.string().min(1).optional(),
    lastAppliedAt: TimestampSchema.optional(),
    pendingChangeSets: z.number().int().nonnegative().optional(),
    runningQueryCount: z.number().int().nonnegative(),
    canceledQueryCount: z.number().int().nonnegative(),
    materializedRevision: z.number().int().nonnegative().optional(),
  }),
  watcher: z.object({
    active: z.boolean(),
    degraded: z.boolean(),
    backend: z.string().min(1).optional(),
    dirtyPathCount: z.number().int().nonnegative(),
    lastEventAt: TimestampSchema.optional(),
    lastError: z.string().min(1).optional(),
    recrawlCount: z.number().int().nonnegative(),
    lastRecrawlAt: TimestampSchema.optional(),
    lastRecrawlReason: z.string().min(1).optional(),
    lastRecrawlWarning: z.string().min(1).optional(),
    lastCatchUpAt: TimestampSchema.optional(),
    lastCatchUpStatus: ProjectIndexWatchCatchUpStatusSchema.optional(),
    lastCatchUpMethod: ProjectIndexWatchCatchUpMethodSchema.optional(),
    lastCatchUpDurationMs: z.number().int().nonnegative().optional(),
    lastCatchUpReason: z.string().min(1).optional(),
    lastCatchUpError: z.string().min(1).optional(),
    state: ProjectIndexWatchStateSchema.optional(),
  }),
  writerQueue: z.object({
    running: z.boolean(),
    queued: z.number().int().nonnegative(),
    activeKind: z.enum(["refresh", "materialization", "diagnostic", "schema", "audit"]).optional(),
    lastRunAt: TimestampSchema.optional(),
    lastRunTrigger: z.string().min(1).optional(),
    lastRunResult: z.enum(["succeeded", "failed", "skipped"]).optional(),
  }),
  freshness: z.object({
    checkedAt: TimestampSchema,
    indexedFiles: z.number().int().nonnegative(),
    staleFiles: z.number().int().nonnegative(),
    deletedFiles: z.number().int().nonnegative(),
    unknownFiles: z.number().int().nonnegative(),
    unindexedFiles: z.number().int().nonnegative(),
    unindexedScan: z.enum(["skipped", "running", "completed"]),
  }),
  diagnostics: ReefProjectDiagnosticStatusSchema.optional(),
  schema: ReefProjectSchemaStatusSchema.optional(),
}) satisfies z.ZodType<ReefProjectStatus>;

export interface ReefRefreshRequest {
  projectId: string;
  paths?: string[];
  reason: string;
  wait?: boolean;
  maxWaitMs?: number;
}

export const ReefRefreshRequestSchema = z.object({
  projectId: z.string().min(1),
  paths: z.array(z.string().min(1)).optional(),
  reason: z.string().min(1),
  wait: z.boolean().optional(),
  maxWaitMs: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<ReefRefreshRequest>;

export interface ReefRefreshResult {
  projectId: string;
  state: "queued" | "running" | "completed" | "skipped" | "failed";
  operationId?: string;
  appliedRevision?: number;
  refreshMode?: "path_scoped" | "full";
  refreshedPathCount?: number;
  deletedPathCount?: number;
  fallbackReason?: string;
  message?: string;
}

export const ReefRefreshResultSchema = z.object({
  projectId: z.string().min(1),
  state: z.enum(["queued", "running", "completed", "skipped", "failed"]),
  operationId: z.string().min(1).optional(),
  appliedRevision: z.number().int().nonnegative().optional(),
  refreshMode: z.enum(["path_scoped", "full"]).optional(),
  refreshedPathCount: z.number().int().nonnegative().optional(),
  deletedPathCount: z.number().int().nonnegative().optional(),
  fallbackReason: z.string().min(1).optional(),
  message: z.string().min(1).optional(),
}) satisfies z.ZodType<ReefRefreshResult>;

export interface ReefWatcherRecrawlInput {
  projectId: string;
  reason: string;
  warning?: string;
  observedAt?: Timestamp;
  repair?: "full_refresh" | "none";
}

export const ReefWatcherRecrawlInputSchema = z.object({
  projectId: z.string().min(1),
  reason: z.string().min(1),
  warning: z.string().min(1).optional(),
  observedAt: TimestampSchema.optional(),
  repair: z.enum(["full_refresh", "none"]).optional(),
}) satisfies z.ZodType<ReefWatcherRecrawlInput>;

export interface ReefOperationQuery {
  projectId?: string;
  kind?: ReefOperationKind;
  severity?: ReefOperationLogEntry["severity"];
  since?: Timestamp;
  limit?: number;
}

export const ReefOperationQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  kind: z.lazy(() => ReefOperationKindSchema).optional(),
  severity: z.enum(["debug", "info", "warning", "error"]).optional(),
  since: TimestampSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
}) satisfies z.ZodType<ReefOperationQuery>;

export const ReefOperationKindSchema = z.enum([
  "daemon_lifecycle",
  "project_registry",
  "watcher_event",
  "refresh_requested",
  "refresh_decision",
  "change_set_created",
  "refresh_completed",
  "refresh_failed",
  "change_set_applied",
  "query_snapshot",
  "artifact_tag",
  "freshness_gate",
  "query_path",
  "diagnostic_source",
  "fallback_used",
  "watcher_recrawl",
  "watcher_catch_up",
  "calculation_executor",
  "audit_result",
  "writer_lock",
  "degraded_state",
]);
export type ReefOperationKind = z.infer<typeof ReefOperationKindSchema>;

export interface ReefOperationLogEntry {
  id: string;
  projectId?: string;
  root?: string;
  kind: ReefOperationKind;
  severity: "debug" | "info" | "warning" | "error";
  message: string;
  data?: JsonObject;
  createdAt: Timestamp;
}

export const ReefOperationLogEntrySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  root: z.string().min(1).optional(),
  kind: ReefOperationKindSchema,
  severity: z.enum(["debug", "info", "warning", "error"]),
  message: z.string().min(1),
  data: JsonObjectSchema.optional(),
  createdAt: TimestampSchema,
}) satisfies z.ZodType<ReefOperationLogEntry>;

export interface ReefQueryRequest<TInput = unknown> {
  projectId: string;
  kind: string;
  input?: TInput;
  freshnessPolicy: ReefFreshnessPolicy;
  snapshot: ReefSnapshotBehavior;
  revision?: number;
}

export const ReefQueryRequestSchema = z.object({
  projectId: z.string().min(1),
  kind: z.string().min(1),
  input: z.custom<unknown>(),
  freshnessPolicy: ReefFreshnessPolicySchema,
  snapshot: ReefSnapshotBehaviorSchema,
  revision: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<ReefQueryRequest>;

export interface ReefServiceEvent {
  projectId: string;
  kind: "status" | "operation" | "change_set" | "degraded";
  createdAt: Timestamp;
  data: JsonObject;
}

export interface ReefProjectEvent {
  eventId: string;
  projectId: string;
  root: string;
  kind:
    | "reef.file.added"
    | "reef.file.changed"
    | "reef.file.deleted"
    | "reef.file.renamed"
    | "reef.refresh.requested"
    | "reef.git.index_changed"
    | "reef.git.branch_changed"
    | "reef.schema.source_changed"
    | "reef.schema.snapshot_changed"
    | "reef.schema.live_maybe_stale"
    | "reef.diagnostic.source_changed"
    | "reef.ack.changed"
    | "reef.comment.changed";
  paths?: string[];
  observedAt: Timestamp;
  data?: JsonObject;
}

export const ReefProjectEventKindSchema = z.enum([
  "reef.file.added",
  "reef.file.changed",
  "reef.file.deleted",
  "reef.file.renamed",
  "reef.refresh.requested",
  "reef.git.index_changed",
  "reef.git.branch_changed",
  "reef.schema.source_changed",
  "reef.schema.snapshot_changed",
  "reef.schema.live_maybe_stale",
  "reef.diagnostic.source_changed",
  "reef.ack.changed",
  "reef.comment.changed",
]);

export const ReefProjectEventSchema = z.object({
  eventId: z.string().min(1),
  projectId: z.string().min(1),
  root: z.string().min(1),
  kind: ReefProjectEventKindSchema,
  paths: z.array(z.string().min(1)).optional(),
  observedAt: TimestampSchema,
  data: JsonObjectSchema.optional(),
}) satisfies z.ZodType<ReefProjectEvent>;

export interface ReefWorkspaceChangeSet {
  changeSetId: string;
  projectId: string;
  root: string;
  observedAt: Timestamp;
  baseRevision?: number;
  causes: ReefProjectEvent[];
  fileChanges: {
    path: string;
    kind: "created" | "updated" | "deleted" | "renamed";
    priorPath?: string;
    contentHash?: string;
    sizeBytes?: number;
    mtime?: Timestamp;
  }[];
  git?: {
    head?: string;
    branch?: string;
    indexHash?: string;
    lockfileHash?: string;
  };
  schema?: {
    sourceChanged?: boolean;
    snapshotId?: string;
    liveSnapshotAt?: Timestamp;
  };
}

export const ReefWorkspaceFileChangeSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["created", "updated", "deleted", "renamed"]),
  priorPath: z.string().min(1).optional(),
  contentHash: z.string().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  mtime: TimestampSchema.optional(),
});

export const ReefWorkspaceChangeSetSchema = z.object({
  changeSetId: z.string().min(1),
  projectId: z.string().min(1),
  root: z.string().min(1),
  observedAt: TimestampSchema,
  baseRevision: z.number().int().nonnegative().optional(),
  causes: z.array(ReefProjectEventSchema),
  fileChanges: z.array(ReefWorkspaceFileChangeSchema),
  git: z.object({
    head: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    indexHash: z.string().min(1).optional(),
    lockfileHash: z.string().min(1).optional(),
  }).optional(),
  schema: z.object({
    sourceChanged: z.boolean().optional(),
    snapshotId: z.string().min(1).optional(),
    liveSnapshotAt: TimestampSchema.optional(),
  }).optional(),
}) satisfies z.ZodType<ReefWorkspaceChangeSet>;

export interface ReefChangeSetResult {
  changeSetId: string;
  baseRevision: number;
  newRevision: number;
  appliedAt: Timestamp;
  canceledQueryIds: string[];
}

export const ReefChangeSetResultSchema = z.object({
  changeSetId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  newRevision: z.number().int().nonnegative(),
  appliedAt: TimestampSchema,
  canceledQueryIds: z.array(z.string().min(1)),
}) satisfies z.ZodType<ReefChangeSetResult>;

export const REEF_CALCULATION_PLAN_QUERY_KIND = "reef.calculation_plan";

export interface ReefCalculationPlanQueryInput {
  changeSet?: ReefWorkspaceChangeSet;
  changeSetId?: string;
}

export const ReefCalculationPlanQueryInputSchema = z.object({
  changeSet: ReefWorkspaceChangeSetSchema.optional(),
  changeSetId: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.changeSet && value.changeSetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["changeSetId"],
      message: "Provide either changeSet or changeSetId, not both.",
    });
  }
}) satisfies z.ZodType<ReefCalculationPlanQueryInput>;

export interface ReefCalculationPlanQueryOutput {
  kind: typeof REEF_CALCULATION_PLAN_QUERY_KIND;
  projectId: string;
  root: string;
  plan: ReefCalculationExecutionPlan;
}

export const ReefCalculationPlanQueryOutputSchema = z.object({
  kind: z.literal(REEF_CALCULATION_PLAN_QUERY_KIND),
  projectId: z.string().min(1),
  root: z.string().min(1),
  plan: ReefCalculationExecutionPlanSchema,
}) satisfies z.ZodType<ReefCalculationPlanQueryOutput>;

export interface ReefService {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerProject(input: RegisterProjectInput): Promise<RegisteredProject>;
  unregisterProject(projectId: string): Promise<void>;
  listProjects(): Promise<RegisteredProject[]>;
  getProjectStatus(projectId: string): Promise<ReefProjectStatus>;
  listProjectStatuses(): Promise<ReefProjectStatus[]>;
  requestRefresh(input: ReefRefreshRequest): Promise<ReefRefreshResult>;
  recordWatcherRecrawl(input: ReefWatcherRecrawlInput): Promise<ReefProjectStatus>;
  query<TInput, TOutput>(request: ReefQueryRequest<TInput>): Promise<TOutput>;
  listOperations(input: ReefOperationQuery): Promise<ReefOperationLogEntry[]>;
  subscribe(projectId: string): AsyncIterable<ReefServiceEvent>;
}

export interface ReefAnalysisHost extends ReefService {
  submitEvent(event: ReefProjectEvent): Promise<void>;
  applyChangeSet(changeSet: ReefWorkspaceChangeSet): Promise<ReefChangeSetResult>;
}

export function reefIndexRunStatusToWriterResult(
  status: IndexRunStatus | undefined,
): ReefProjectStatus["writerQueue"]["lastRunResult"] {
  if (status === "succeeded") {
    return "succeeded";
  }
  if (status === "failed") {
    return "failed";
  }
  return undefined;
}

export function reefIndexedFileCountFromFreshness(
  freshness: z.infer<typeof IndexFreshnessSummarySchema>,
): number {
  return freshness.freshCount + freshness.staleCount + freshness.deletedCount + freshness.unknownCount;
}
