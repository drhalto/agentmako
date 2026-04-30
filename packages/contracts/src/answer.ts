import type {
  EvidenceStatus,
  ContextLayoutZone,
  JsonObject,
  JsonValue,
  ReasoningTier,
  SupportLevel,
  Timestamp,
} from "./common.js";
import type { IndexFreshnessDetail, IndexFreshnessSummary } from "./index-freshness.js";
import type { WorkflowPacketSurface } from "./workflow-packets.js";

export type QueryKind =
  | "route_trace"
  | "schema_usage"
  | "auth_path"
  | "file_health"
  | "free_form"
  | "trace_file"
  | "preflight_table"
  | "cross_search"
  | "trace_edge"
  | "trace_error"
  | "trace_table"
  | "trace_rpc";

export const COMPOSER_QUERY_KINDS = [
  "trace_file",
  "preflight_table",
  "cross_search",
  "trace_edge",
  "trace_error",
  "trace_table",
  "trace_rpc",
] as const satisfies readonly QueryKind[];

export type ComposerQueryKind = (typeof COMPOSER_QUERY_KINDS)[number];

export function isComposerQueryKind(kind: QueryKind): kind is ComposerQueryKind {
  return (COMPOSER_QUERY_KINDS as readonly QueryKind[]).includes(kind);
}

export type EvidenceKind =
  | "file"
  | "symbol"
  | "route"
  | "schema"
  | "finding"
  | "trace"
  | "document";

export interface EvidenceBlock {
  blockId: string;
  kind: EvidenceKind;
  title: string;
  sourceRef: string;
  filePath?: string;
  line?: number;
  content: string;
  layoutZone?: ContextLayoutZone;
  score?: number;
  stale?: boolean;
  freshness?: IndexFreshnessDetail;
  metadata?: JsonObject;
}

export interface CandidateAction {
  actionId: string;
  label: string;
  description: string;
  safeToAutomate: boolean;
  execute?: CandidateActionExecution;
}

export interface CandidateActionExecution {
  toolName: string;
  input: JsonObject;
}

export interface AnswerPacket {
  queryId: string;
  projectId: string;
  queryKind: QueryKind;
  queryText: string;
  tierUsed: ReasoningTier;
  supportLevel: SupportLevel;
  evidenceStatus: EvidenceStatus;
  evidenceConfidence: number;
  missingInformation: string[];
  stalenessFlags: string[];
  indexFreshness?: IndexFreshnessSummary;
  evidence: EvidenceBlock[];
  generatedAt: Timestamp;
}

export interface AnswerResult {
  queryId: string;
  projectId: string;
  queryKind: QueryKind;
  tierUsed: ReasoningTier;
  supportLevel: SupportLevel;
  evidenceStatus: EvidenceStatus;
  answer?: string;
  answerConfidence?: number;
  packet: AnswerPacket;
  candidateActions: CandidateAction[];
  noSynthesis?: boolean;
  trust?: AnswerTrustSurface;
  diagnostics?: AnswerSurfaceIssue[];
  ranking?: AnswerRankingSurface;
  companionPacket?: WorkflowPacketSurface;
}

export type AnswerSurfaceIssueSeverity = "low" | "medium" | "high" | "critical";

export type AnswerSurfaceIssueConfidence = "possible" | "probable" | "confirmed";

export type AnswerSurfaceIssueCategory =
  | "trust"
  | "producer_consumer_drift"
  | "identity_key_mismatch"
  | "rpc_helper_reuse"
  | "auth_role_drift"
  | "sql_alignment"
  | "ranking";

export interface AnswerSurfaceIssueIdentity {
  matchBasedId: string;
  codeHash: string;
  patternHash: string;
}

export interface AnswerSurfaceIssue {
  severity: AnswerSurfaceIssueSeverity;
  confidence: AnswerSurfaceIssueConfidence;
  category: AnswerSurfaceIssueCategory;
  code: string;
  message: string;
  path?: string;
  line?: number;
  producerPath?: string;
  consumerPath?: string;
  evidenceRefs: string[];
  identity: AnswerSurfaceIssueIdentity;
  metadata?: JsonObject;
}

export interface AnswerTrustSurface {
  state: AnswerTrustState;
  reasons: AnswerTrustReason[];
  basisTraceIds: string[];
  conflictingFacets: AnswerTrustFacet[];
  scopeRelation: AnswerTrustScopeRelation;
  comparisonId?: string;
  clusterId?: string;
  comparisonSummary: AnswerComparisonChange[];
  issues: AnswerSurfaceIssue[];
}

export interface AnswerRankingSurface {
  orderKey: number;
  deEmphasized: boolean;
  reasons: AnswerSurfaceIssue[];
}

export type AnswerTrustRunProvenance =
  | "interactive"
  | "manual_rerun"
  | "benchmark"
  | "seeded_eval"
  | "unknown";

export interface AnswerComparableTarget {
  targetId: string;
  projectId: string;
  queryKind: QueryKind;
  normalizedQueryText: string;
  comparisonKey: string;
  identity: JsonObject;
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
}

export interface AnswerEnvironmentFingerprint {
  gitHead: string | null;
  schemaSnapshotId: string | null;
  schemaFingerprint: string | null;
  indexRunId: string | null;
}

export interface AnswerTrustRun {
  traceId: string;
  targetId: string;
  previousTraceId?: string;
  provenance: AnswerTrustRunProvenance;
  packetHash: string;
  rawPacketHash: string;
  previousPacketHash?: string;
  answerHash?: string;
  environmentFingerprint: AnswerEnvironmentFingerprint;
  createdAt: Timestamp;
}

export type AnswerComparisonChangeCode =
  | "answer_markdown_changed"
  | "answer_status_changed"
  | "answer_confidence_changed"
  | "support_level_changed"
  | "core_claim_conflict"
  | "evidence_added"
  | "evidence_removed"
  | "missing_info_added"
  | "missing_info_removed"
  | "staleness_flag_added"
  | "staleness_flag_removed";

export interface AnswerComparisonChange {
  code: AnswerComparisonChangeCode;
  detail: string;
}

export interface AnswerComparisonRecord {
  comparisonId: string;
  targetId: string;
  priorTraceId: string;
  currentTraceId: string;
  summaryChanges: AnswerComparisonChange[];
  rawDelta: JsonValue;
  meaningfulChangeDetected: boolean;
  provenance: AnswerTrustRunProvenance;
  createdAt: Timestamp;
}

export type AnswerTrustState =
  | "stable"
  | "changed"
  | "aging"
  | "stale"
  | "superseded"
  | "contradicted"
  | "insufficient_evidence";

/**
 * Canonical ordering weight per trust state. Higher means "more trusted."
 *
 * Consumers that need to reason about trust-based ordering (ranking, selection,
 * de-emphasis) should read from this table instead of reimplementing the
 * switch. The numeric values are stable only in their relative ordering; treat
 * them as ordinals.
 */
export const TRUST_STATE_RANK: Readonly<Record<AnswerTrustState, number>> = Object.freeze({
  stable: 100,
  changed: 90,
  aging: 80,
  stale: 60,
  insufficient_evidence: 50,
  superseded: 40,
  contradicted: 20,
});

export type AnswerTrustScopeRelation =
  | "none"
  | "same_scope"
  | "changed_scope"
  | "backtested_old_scope";

export type AnswerTrustFacet =
  | "core_claim"
  | "answer_status"
  | "support_level"
  | "answer_confidence"
  | "evidence_set"
  | "missing_information"
  | "staleness"
  | "answer_markdown";

export type AnswerTrustReasonCode =
  | "no_meaningful_change"
  | "meaningful_change_detected"
  | "scope_changed"
  | "freshness_warning"
  | "freshness_expired"
  | "packet_staleness_flag"
  | "partial_evidence"
  | "best_effort_support"
  | "missing_information"
  | "query_evidence_mismatch"
  | "superseded_by_newer_run"
  | "conflicting_cluster_detected";

export interface AnswerTrustReason {
  code: AnswerTrustReasonCode;
  detail: string;
}

export interface AnswerTrustClusterRecord {
  clusterId: string;
  targetId: string;
  clusterKey: string;
  packetHash: string;
  supportLevel: SupportLevel;
  evidenceStatus: EvidenceStatus;
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
  runCount: number;
}

export interface AnswerTrustEvaluationRecord {
  evaluationId: string;
  targetId: string;
  traceId: string;
  comparisonId?: string;
  clusterId?: string;
  state: AnswerTrustState;
  reasons: AnswerTrustReason[];
  basisTraceIds: string[];
  conflictingFacets: AnswerTrustFacet[];
  scopeRelation: AnswerTrustScopeRelation;
  ageDays?: number;
  agingDays?: number;
  staleDays?: number;
  createdAt: Timestamp;
}

export interface AnswerTrustStateSnapshot {
  target: AnswerComparableTarget;
  run: AnswerTrustRun;
  evaluation: AnswerTrustEvaluationRecord;
  comparison: AnswerComparisonRecord | null;
  cluster: AnswerTrustClusterRecord | null;
}

export interface AnswerTrustStateHistory {
  target: AnswerComparableTarget;
  latestRun: AnswerTrustRun | null;
  latestEvaluation: AnswerTrustEvaluationRecord | null;
  evaluations: AnswerTrustEvaluationRecord[];
  clusters: AnswerTrustClusterRecord[];
  comparisons: AnswerComparisonRecord[];
}
