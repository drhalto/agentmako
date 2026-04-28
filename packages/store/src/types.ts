import type {
  AnswerComparisonChange,
  AnswerComparableTarget,
  AnswerComparisonRecord as ContractAnswerComparisonRecord,
  AnswerPacket,
  AnswerResult,
  AnswerTrustFacet,
  AnswerTrustClusterRecord as ContractAnswerTrustClusterRecord,
  AnswerTrustEvaluationRecord as ContractAnswerTrustEvaluationRecord,
  AnswerTrustReason,
  AnswerTrustRun,
  AnswerTrustRunProvenance,
  AnswerTrustScopeRelation,
  AnswerTrustState,
  AttachedProject,
  DbBindingTestStatus,
  DbReviewComment,
  DbReviewCommentCategory,
  DbReviewObjectType,
  DbReviewTarget,
  EvidenceBlock,
  EvidenceStatus,
  FindingAck,
  FindingAckStatus,
  FindingAckSubjectKind,
  IndexRunStatus,
  JsonObject,
  JsonValue,
  ProjectFact,
  ProjectFinding,
  ProjectFindingStatus,
  ProjectOverlay,
  ProjectProfile,
  ProjectStatus,
  ReefDiagnosticRun,
  ReefDiagnosticRunStatus,
  ReefProjectEvent,
  ReefRuleDescriptor,
  ReefWorkspaceChangeSet,
  QueryKind,
  ReasoningTier,
  RuntimeUsefulnessDecisionKind,
  RuntimeUsefulnessEvent,
  RuntimeUsefulnessGrade,
  SupportLevel,
  Timestamp,
  WorkflowPacketFamily,
} from "@mako-ai/contracts";

export interface DbBindingStateRecord {
  lastTestedAt?: Timestamp;
  lastTestStatus: DbBindingTestStatus;
  lastTestError?: string;
  lastTestServerVersion?: string;
  lastTestCurrentUser?: string;
  lastVerifiedAt?: Timestamp;
  lastRefreshedAt?: Timestamp;
}

export interface ProjectRegistrationInput {
  projectId: string;
  displayName: string;
  canonicalPath: string;
  lastSeenPath: string;
  supportTarget: string;
  status?: ProjectStatus;
  profileHash?: string;
}

export interface ProjectProfileRecord {
  profile: ProjectProfile;
  profileHash: string;
  supportLevel: SupportLevel;
  detectedAt: Timestamp;
}

export type IndexRunStats = JsonObject & {
  filesIndexed?: number;
  chunksIndexed?: number;
  symbolsIndexed?: number;
  importsIndexed?: number;
  routesIndexed?: number;
  schemaObjectsIndexed?: number;
  schemaUsagesIndexed?: number;
};

export interface IndexRunRecord {
  runId: string;
  triggerSource: string;
  status: IndexRunStatus;
  stats?: IndexRunStats;
  errorText?: string;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  createdAt: Timestamp;
}

export type LifecycleEventType =
  | "project_attach"
  | "project_detach"
  | "project_index"
  | "schema_snapshot_build"
  | "schema_snapshot_refresh"
  | "db_verify"
  | "db_test"
  | "db_bind"
  | "db_unbind";

export type LifecycleEventOutcome = "success" | "failed" | "skipped";

export interface LifecycleEventRecord {
  eventId: string;
  projectId: string;
  eventType: LifecycleEventType;
  outcome: LifecycleEventOutcome;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMs: number;
  metadata: JsonObject;
  errorText?: string;
}

export interface LifecycleEventInsert {
  projectId: string;
  eventType: LifecycleEventType;
  outcome: LifecycleEventOutcome;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMs: number;
  metadata?: JsonObject;
  errorText?: string;
}

export interface QueryLifecycleEventsOptions {
  eventType?: LifecycleEventType;
  outcome?: LifecycleEventOutcome;
  limit?: number;
}

export type ToolRunOutcome = "success" | "failed" | "error";

export interface ToolRunRecord {
  runId: string;
  projectId?: string;
  toolName: string;
  inputSummary: JsonValue;
  outputSummary?: JsonValue;
  payload?: JsonValue;
  outcome: ToolRunOutcome;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMs: number;
  requestId?: string;
  errorText?: string;
}

export interface ToolRunInsert {
  projectId?: string;
  toolName: string;
  inputSummary: JsonValue;
  outputSummary?: JsonValue;
  payload?: JsonValue;
  outcome: ToolRunOutcome;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMs: number;
  requestId?: string;
  errorText?: string;
}

export interface QueryToolRunsOptions {
  toolName?: string;
  outcome?: ToolRunOutcome;
  requestId?: string;
  limit?: number;
}

export interface RecalledAnswerPacketSummary {
  family: string;
  basisCount: number;
  evidenceRefCount: number;
}

export interface RecalledAnswerRecord {
  traceId: string;
  queryKind: QueryKind;
  queryText: string;
  createdAt: Timestamp;
  supportLevel: SupportLevel;
  trustState?: AnswerTrustState;
  answerConfidence?: number;
  answerMarkdown?: string;
  packetSummary: RecalledAnswerPacketSummary;
}

export interface RecallAnswersOptions {
  projectId: string;
  query?: string;
  queryKind?: QueryKind;
  supportLevel?: SupportLevel;
  trustState?: AnswerTrustState;
  since?: Timestamp;
  until?: Timestamp;
  limit?: number;
}

export interface RecallAnswersResult {
  answers: RecalledAnswerRecord[];
  matchCount: number;
}

export interface RecallToolRunsOptions {
  projectId: string;
  toolName?: string;
  outcome?: ToolRunOutcome;
  requestId?: string;
  since?: Timestamp;
  until?: Timestamp;
  limit?: number;
  includePayload?: boolean;
}

export interface RecallToolRunsResult {
  toolRuns: ToolRunRecord[];
  matchCount: number;
}

export interface WorkflowFollowupRecord {
  followupId: string;
  projectId: string;
  originQueryId: string;
  originActionId: string;
  originPacketId?: string;
  originPacketFamily: WorkflowPacketFamily;
  originQueryKind: QueryKind;
  executedToolName: string;
  executedInput: JsonValue;
  resultPacketId: string;
  resultPacketFamily: WorkflowPacketFamily;
  resultQueryId: string;
  requestId?: string;
  createdAt: Timestamp;
}

export interface WorkflowFollowupInsert {
  projectId: string;
  originQueryId: string;
  originActionId: string;
  originPacketId?: string;
  originPacketFamily: WorkflowPacketFamily;
  originQueryKind: QueryKind;
  executedToolName: string;
  executedInput: JsonValue;
  resultPacketId: string;
  resultPacketFamily: WorkflowPacketFamily;
  resultQueryId: string;
  requestId?: string;
  createdAt?: Timestamp;
}

export interface QueryWorkflowFollowupsOptions {
  originQueryId?: string;
  originActionId?: string;
  requestId?: string;
  limit?: number;
}

// Phase 8.1a: runtime usefulness telemetry.
//
// `UsefulnessEventRecord` mirrors `RuntimeUsefulnessEvent` from @mako-ai/contracts
// exactly — the store layer does not introduce a parallel shape; what lands
// on disk is what the contract defines.
export type UsefulnessEventRecord = RuntimeUsefulnessEvent;

export interface UsefulnessEventInsert {
  eventId?: string;
  projectId: string;
  requestId: string;
  traceId?: string;
  capturedAt?: Timestamp;
  decisionKind: RuntimeUsefulnessDecisionKind;
  family: string;
  toolName?: string;
  grade: RuntimeUsefulnessGrade;
  reasonCodes: string[];
  observedFollowupLinked?: boolean;
  reason?: string;
}

export interface QueryUsefulnessEventsOptions {
  projectId?: string;
  decisionKind?: RuntimeUsefulnessDecisionKind;
  family?: string;
  requestId?: string;
  since?: Timestamp;
  until?: Timestamp;
  limit?: number;
}

// Aggregation filter — same shape as QueryUsefulnessEventsOptions minus
// `limit`, since aggregates always scan every matching row.
export type UsefulnessEventAggregationFilter = Omit<
  QueryUsefulnessEventsOptions,
  "limit"
>;

export interface UsefulnessEventDecisionKindCount {
  decisionKind: RuntimeUsefulnessDecisionKind;
  count: number;
}

export interface UsefulnessEventFamilyCount {
  decisionKind: RuntimeUsefulnessDecisionKind;
  family: string;
  count: number;
}

export interface UsefulnessEventGradeCount {
  grade: "full" | "partial" | "no";
  count: number;
}

// Initial Testing Phase 1: finding acknowledgements.
//
// `FindingAckRecord` mirrors the `FindingAck` contract exactly — the store
// layer does not introduce a parallel shape; what lands on disk is what
// the contract defines.
export type FindingAckRecord = FindingAck;

export interface FindingAckInsert {
  ackId?: string;
  projectId: string;
  category: string;
  subjectKind: FindingAckSubjectKind;
  filePath?: string;
  fingerprint: string;
  status: FindingAckStatus;
  reason: string;
  acknowledgedBy?: string;
  acknowledgedAt?: Timestamp;
  snippet?: string;
  sourceToolName?: string;
  sourceRuleId?: string;
  sourceIdentityMatchBasedId?: string;
}

export interface QueryFindingAcksOptions {
  projectId?: string;
  category?: string;
  subjectKind?: FindingAckSubjectKind;
  filePath?: string;
  status?: FindingAckStatus;
  since?: Timestamp;
  until?: Timestamp;
  limit?: number;
}

export interface FindingAckCategoryFingerprintCount {
  category: string;
  distinctFingerprints: number;
  totalRows: number;
}

export interface FindingAckStatusCount {
  status: FindingAckStatus;
  count: number;
}

export interface FindingAckSubjectKindCount {
  subjectKind: FindingAckSubjectKind;
  count: number;
}

export interface FindingAckFilePathCount {
  filePath: string | null;
  count: number;
}

export type FindingAckAggregationFilter = Omit<
  QueryFindingAcksOptions,
  "limit"
>;

// Reef Engine Phase 1: durable fact and active findings substrate.
export interface QueryReefFactsOptions {
  projectId: string;
  overlay?: ProjectOverlay;
  source?: string;
  kind?: string;
  subjectFingerprint?: string;
  limit?: number;
}

export type ReefFactRecord = ProjectFact;

export interface ReplaceReefFactsForSourceInput {
  projectId: string;
  source: string;
  overlay: ProjectOverlay;
  facts: ProjectFact[];
  kinds?: string[];
}

export interface ReplaceReefFindingsForSourceInput {
  projectId: string;
  source: string;
  overlay: ProjectOverlay;
  findings: ProjectFinding[];
  subjectFingerprints?: string[];
  resolvedAt?: Timestamp;
  reason?: string;
}

export interface QueryReefFindingsOptions {
  projectId: string;
  overlay?: ProjectOverlay;
  source?: string;
  sources?: string[];
  filePath?: string;
  filePaths?: string[];
  severities?: Array<ProjectFinding["severity"]>;
  status?: ProjectFindingStatus;
  includeResolved?: boolean;
  excludeAcknowledged?: boolean;
  limit?: number;
}

export interface ResolveReefFindingsForDeletedFilesInput {
  projectId: string;
  filePaths: string[];
  overlays?: ProjectOverlay[];
  resolvedAt?: Timestamp;
  reason?: string;
}

export type ReefFindingRecord = ProjectFinding;
export type ReefRuleDescriptorRecord = ReefRuleDescriptor;

export type SaveReefDiagnosticRunInput = Omit<ReefDiagnosticRun, "runId"> & {
  runId?: string;
};

export interface QueryReefDiagnosticRunsOptions {
  projectId: string;
  source?: string;
  status?: ReefDiagnosticRunStatus;
  limit?: number;
}

export type ReefDiagnosticRunRecord = ReefDiagnosticRun;

export interface InsertDbReviewCommentInput {
  projectId: string;
  target: DbReviewTarget;
  category: DbReviewCommentCategory;
  severity?: ProjectFinding["severity"];
  comment: string;
  tags?: string[];
  createdBy?: string;
  createdAt?: Timestamp;
  sourceToolName: string;
  metadata?: JsonObject;
}

export interface QueryDbReviewCommentsOptions {
  projectId: string;
  objectType?: DbReviewObjectType;
  objectName?: string;
  schemaName?: string;
  parentObjectName?: string;
  targetFingerprint?: string;
  category?: DbReviewCommentCategory;
  query?: string;
  limit?: number;
}

export type DbReviewCommentRecord = DbReviewComment;

export interface ReefAnalysisStateRecord {
  projectId: string;
  root: string;
  currentRevision: number;
  materializedRevision?: number;
  lastAppliedChangeSetId?: string;
  lastAppliedAt?: Timestamp;
  recomputationGeneration: number;
  watcherRecrawlCount: number;
  lastRecrawlAt?: Timestamp;
  lastRecrawlReason?: string;
  lastRecrawlWarning?: string;
  updatedAt: Timestamp;
}

export type ReefAppliedChangeSetStatus = "applied" | "skipped" | "failed";
export type ReefAppliedChangeSetRefreshMode = "path_scoped" | "full";

export interface ReefAppliedChangeSetRecord {
  changeSetId: string;
  projectId: string;
  root: string;
  baseRevision: number;
  newRevision: number;
  observedAt: Timestamp;
  appliedAt: Timestamp;
  generation: number;
  status: ReefAppliedChangeSetStatus;
  refreshMode: ReefAppliedChangeSetRefreshMode;
  fallbackReason?: string;
  causeCount: number;
  fileChangeCount: number;
  causes: ReefProjectEvent[];
  fileChanges: ReefWorkspaceChangeSet["fileChanges"];
  data?: JsonObject;
}

export interface ApplyReefChangeSetInput {
  changeSet: ReefWorkspaceChangeSet;
  refreshMode: ReefAppliedChangeSetRefreshMode;
  fallbackReason?: string;
  appliedAt?: Timestamp;
}

export interface MarkReefChangeSetMaterializedInput {
  projectId: string;
  root: string;
  changeSetId: string;
  revision: number;
  materializedAt?: Timestamp;
  refreshMode?: ReefAppliedChangeSetRefreshMode;
  fallbackReason?: string;
}

export interface MarkReefChangeSetFailedInput {
  projectId: string;
  root: string;
  changeSetId: string;
  errorText: string;
}

export interface MarkReefChangeSetSkippedInput {
  projectId: string;
  root: string;
  changeSetId: string;
  reason: string;
}

export interface RecordReefWatcherRecrawlInput {
  projectId: string;
  root: string;
  reason: string;
  warning?: string;
  observedAt?: Timestamp;
}

export interface QueryReefAppliedChangeSetsOptions {
  projectId: string;
  root?: string;
  changeSetId?: string;
  maxRevision?: number;
  limit?: number;
}

export interface EnsureReefAnalysisStateInput {
  projectId: string;
  root: string;
  now?: Timestamp;
}

export interface ReefArtifactKey {
  contentHash: string;
  artifactKind: string;
  extractorVersion: string;
}

export interface ReefArtifactRecord extends ReefArtifactKey {
  artifactId: string;
  payload: JsonValue;
  metadata?: JsonObject;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UpsertReefArtifactInput extends ReefArtifactKey {
  artifactId?: string;
  payload: JsonValue;
  metadata?: JsonObject;
  now?: Timestamp;
}

export interface ReefArtifactTagRecord extends ReefArtifactKey {
  tagId: string;
  artifactId: string;
  projectId: string;
  root: string;
  branch?: string;
  worktree?: string;
  overlay: ProjectOverlay;
  path: string;
  lastVerifiedRevision?: number;
  lastChangedRevision?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AddReefArtifactTagInput {
  artifactId: string;
  projectId: string;
  root: string;
  branch?: string;
  worktree?: string;
  overlay: ProjectOverlay;
  path: string;
  lastVerifiedRevision?: number;
  lastChangedRevision?: number;
  now?: Timestamp;
}

export interface QueryReefArtifactsOptions extends Partial<ReefArtifactKey> {
  artifactId?: string;
  projectId?: string;
  root?: string;
  branch?: string;
  worktree?: string;
  overlay?: ProjectOverlay;
  path?: string;
  limit?: number;
}

export interface QueryReefArtifactTagsOptions extends Partial<ReefArtifactKey> {
  artifactId?: string;
  projectId?: string;
  root?: string;
  branch?: string;
  worktree?: string;
  overlay?: ProjectOverlay;
  path?: string;
  limit?: number;
}

export interface RemoveReefArtifactTagsInput extends QueryReefArtifactTagsOptions {
  tagId?: string;
  pruneArtifacts?: boolean;
}

export interface RemoveReefArtifactTagsResult {
  removedTagCount: number;
  prunedArtifactCount: number;
}

export interface BenchmarkSuiteRecord {
  suiteId: string;
  name: string;
  description?: string;
  version: string;
  config: JsonValue;
}

export interface SaveBenchmarkSuiteInput {
  suiteId?: string;
  name: string;
  description?: string;
  version: string;
  config?: JsonValue;
}

export interface BenchmarkCaseRecord {
  caseId: string;
  suiteId: string;
  name: string;
  toolName: string;
  input: JsonValue;
  expectedOutcome: JsonValue;
}

export interface SaveBenchmarkCaseInput {
  caseId?: string;
  suiteId: string;
  name: string;
  toolName: string;
  input: JsonValue;
  expectedOutcome: JsonValue;
}

export interface BenchmarkAssertionRecord {
  assertionId: string;
  caseId: string;
  assertionType: string;
  expectedValue: JsonValue;
  tolerance?: number;
}

export interface SaveBenchmarkAssertionInput {
  assertionId?: string;
  caseId: string;
  assertionType: string;
  expectedValue: JsonValue;
  tolerance?: number;
}

export interface BenchmarkRunRecord {
  runId: string;
  suiteId: string;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  outcome: string;
  runnerVersion: string;
}

export interface BenchmarkRunInsert {
  suiteId: string;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  outcome: string;
  runnerVersion: string;
}

export interface QueryBenchmarkRunsOptions {
  suiteId?: string;
  outcome?: string;
  limit?: number;
}

export interface BenchmarkCaseResultRecord {
  caseResultId: string;
  runId: string;
  caseId: string;
  toolRunId: string;
  outcome: string;
  actualValue?: JsonValue;
}

export interface BenchmarkCaseResultInsert {
  runId: string;
  caseId: string;
  toolRunId: string;
  outcome: string;
  actualValue?: JsonValue;
}

export interface QueryBenchmarkCaseResultsOptions {
  runId?: string;
  caseId?: string;
  outcome?: string;
  limit?: number;
}

export interface BenchmarkAssertionResultRecord {
  assertionResultId: string;
  caseResultId: string;
  assertionId: string;
  passed: boolean;
  actualValue?: JsonValue;
  expectedValue: JsonValue;
}

export interface BenchmarkAssertionResultInsert {
  caseResultId: string;
  assertionId: string;
  passed: boolean;
  actualValue?: JsonValue;
  expectedValue: JsonValue;
}

export interface QueryBenchmarkAssertionResultsOptions {
  caseResultId?: string;
  assertionId?: string;
  passed?: boolean;
  limit?: number;
}

export interface ToolUsageStatRecord {
  toolName: string;
  callCount: number;
  lastCalledAt: Timestamp;
  lastProjectId?: string;
}

export interface FileChunkRecord {
  chunkKind: string;
  name?: string;
  lineStart?: number;
  lineEnd?: number;
  content: string;
  // Byte offsets into the parsed source. Populated for tree-sitter symbol
  // chunks; in-memory only (not persisted in the chunks table). Used by the
  // semantic-unit builder to disambiguate multiple declarations that share a
  // line/name (common in minified code).
  startIndex?: number;
  endIndex?: number;
}

export interface SymbolRecord {
  name: string;
  kind: string;
  exportName?: string;
  lineStart?: number;
  lineEnd?: number;
  signatureText?: string;
  metadata?: JsonObject;
}

export interface ImportEdgeRecord {
  targetPath: string;
  specifier: string;
  importKind: string;
  isTypeOnly?: boolean;
  line?: number;
}

export interface RouteRecord {
  routeKey: string;
  framework: string;
  pattern: string;
  method?: string;
  handlerName?: string;
  isApi?: boolean;
  metadata?: JsonObject;
}

export interface IndexedFileRecord {
  path: string;
  sha256: string;
  language: string;
  sizeBytes: number;
  lineCount: number;
  isGenerated?: boolean;
  lastModifiedAt?: Timestamp;
  chunks: FileChunkRecord[];
  symbols: SymbolRecord[];
  imports: ImportEdgeRecord[];
  routes: RouteRecord[];
}

export type SchemaObjectKind =
  | "schema"
  | "table"
  | "view"
  | "column"
  | "rpc"
  | "policy"
  | "trigger"
  | "enum";

export interface SchemaObjectRecord {
  objectKey: string;
  objectType: SchemaObjectKind;
  schemaName: string;
  objectName: string;
  parentObjectName?: string;
  dataType?: string;
  definition?: JsonObject;
}

export interface SchemaUsageRecord {
  objectKey: string;
  filePath: string;
  usageKind: string;
  line?: number;
  excerpt?: string;
}

export interface IndexSnapshot {
  files: IndexedFileRecord[];
  schemaObjects: SchemaObjectRecord[];
  schemaUsages: SchemaUsageRecord[];
}

export interface ReplaceFileIndexRowsInput {
  files: IndexedFileRecord[];
  deletedPaths: string[];
  schemaUsages?: SchemaUsageRecord[];
}

export interface FileSummaryRecord {
  path: string;
  sha256?: string;
  language: string;
  sizeBytes: number;
  lineCount: number;
  isGenerated: boolean;
  lastModifiedAt?: Timestamp;
  indexedAt: Timestamp;
}

export interface FileSearchMatch extends FileSummaryRecord {
  snippet?: string;
}

export interface FileImportLink {
  sourcePath: string;
  targetPath: string;
  specifier: string;
  importKind: string;
  isTypeOnly: boolean;
  line?: number;
  targetExists: boolean;
}

export interface ResolvedRouteRecord extends RouteRecord {
  filePath: string;
}

export interface FileDetailRecord extends FileSummaryRecord {
  chunkPreview?: string;
  symbols: SymbolRecord[];
  outboundImports: FileImportLink[];
  inboundImports: FileImportLink[];
  routes: ResolvedRouteRecord[];
}

export interface ResolvedSchemaObjectRecord extends Omit<SchemaObjectRecord, "objectKey"> {
  objectId: number;
}

export interface SchemaUsageMatch {
  filePath: string;
  usageKind: string;
  line?: number;
  excerpt?: string;
}

export interface SchemaObjectDetail {
  object: ResolvedSchemaObjectRecord;
  usages: SchemaUsageMatch[];
}

export interface ProjectScanStats {
  files: number;
  chunks: number;
  symbols: number;
  importEdges: number;
  routes: number;
  schemaObjects: number;
  schemaUsages: number;
  semanticUnits?: number;
}

export interface ProjectIndexStatus {
  project: AttachedProject | null;
  profile: ProjectProfile | null;
  latestRun: IndexRunRecord | null;
  stats: ProjectScanStats;
}

export interface SavedAnswerTraceRecord {
  traceId: string;
  queryKind: QueryKind;
  queryText: string;
  tierUsed: ReasoningTier;
  evidenceStatus: EvidenceStatus;
  supportLevel: SupportLevel;
  answerConfidence?: number;
  answerMarkdown?: string;
  packet: AnswerPacket;
  evidence: EvidenceBlock[];
  createdAt: Timestamp;
}

export interface QueryAnswerTracesOptions {
  limit?: number;
}

export interface AnswerComparableTargetRecord extends AnswerComparableTarget {}

export interface AnswerTrustRunRecord extends AnswerTrustRun {
  target: AnswerComparableTargetRecord;
}

export interface SaveAnswerTrustRunOptions {
  provenance?: AnswerTrustRunProvenance;
  identity?: JsonObject;
  projectRoot?: string;
}

export interface AnswerComparisonRecord extends ContractAnswerComparisonRecord {}

export interface SaveAnswerComparisonInput {
  targetId: string;
  priorTraceId: string;
  currentTraceId: string;
  summaryChanges: AnswerComparisonChange[];
  rawDelta: JsonValue;
  meaningfulChangeDetected: boolean;
  provenance: AnswerTrustRunProvenance;
  createdAt?: Timestamp;
}

export interface AnswerTrustClusterRecord extends ContractAnswerTrustClusterRecord {}

export interface AnswerTrustEvaluationRecord extends ContractAnswerTrustEvaluationRecord {}

export interface SaveAnswerTrustEvaluationInput {
  targetId: string;
  traceId: string;
  comparisonId?: string;
  clusterId?: string;
  state: AnswerTrustState;
  reasons: AnswerTrustReason[];
  basisTraceIds?: string[];
  conflictingFacets?: AnswerTrustFacet[];
  scopeRelation?: AnswerTrustScopeRelation;
  ageDays?: number;
  agingDays?: number;
  staleDays?: number;
  createdAt?: Timestamp;
}
