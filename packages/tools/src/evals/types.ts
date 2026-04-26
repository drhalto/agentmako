import type {
  AnswerTrustState,
  ArtifactExposureDecision,
  ArtifactPromotionMetrics,
  JsonObject,
  JsonValue,
  PowerWorkflowExposureDecision,
  PowerWorkflowPromotionMetrics,
  ToolName,
} from "@mako-ai/contracts";
import type { IndexSnapshot } from "@mako-ai/store";

export type TrustEvalSuiteKind =
  | "seeded_defect"
  | "vague_question"
  | "packet_snapshot"
  | "regression_compare";

export type TrustEvalCaseLifecycle = "active" | "retired" | "fixed_and_archived";

export type TrustEvalCaseOutcome = "pass" | "partial" | "miss" | "errored" | "skipped";

export type TrustEvalSuiteOutcome = "passed" | "partial" | "failed";

export type TrustEvalBaselineSelection =
  | "pinned"
  | "last_passed"
  | "last_partial"
  | "last_any"
  | "none";

export interface TrustEvalBaselineConfig {
  mode?: "heuristic" | "pinned";
  runId?: string;
}

export type TrustEvalAssertionType =
  | "selected_tool_equals"
  | "selected_family_equals"
  | "result_query_kind_equals"
  | "result_answer_contains"
  | "result_evidence_file_includes"
  | "result_evidence_file_excludes"
  | "result_evidence_source_ref_includes"
  | "result_evidence_source_ref_excludes"
  | "result_missing_info_includes"
  | "result_missing_info_excludes"
  | "trust_identity_kind_equals"
  | "trust_identity_equals"
  | "trust_provenance_equals"
  | "trust_state_equals"
  | "trust_reason_code_includes"
  | "trust_reason_code_excludes"
  | "diagnostic_code_includes"
  | "diagnostic_category_includes"
  | "ranking_deemphasized_equals"
  | "ranking_reason_code_includes"
  | "companion_packet_family_equals"
  | "companion_attachment_reason_contains"
  | "companion_handoff_present_equals"
  | "companion_handoff_current_contains"
  | "companion_handoff_stop_when_contains"
  | "workflow_usefulness_grade_equals"
  | "workflow_usefulness_reason_includes"
  | "rerun_older_trust_state_equals"
  | "rerun_newer_trust_state_equals"
  | "error_code_equals"
  | "packet_summary_equals";

export interface TrustEvalAssertionFixture {
  assertionId?: string;
  type: TrustEvalAssertionType;
  expectedValue: JsonValue;
  tolerance?: number;
  description?: string;
}

export interface TrustEvalSnapshotMutation {
  kind: "replace_index_snapshot";
  snapshot: IndexSnapshot;
  triggerSource?: string;
}

export interface TrustEvalRerunSpec {
  // Layer 1 runs against the in-memory replaceIndexSnapshot store, not fixture files.
  mutation: TrustEvalSnapshotMutation;
  expectedOlderState: AnswerTrustState;
  expectedNewerState: AnswerTrustState;
}

export interface TrustEvalCaseFixture {
  caseId: string;
  name: string;
  toolName: ToolName;
  input: JsonObject;
  assertions: TrustEvalAssertionFixture[];
  trustAgeDays?: number;
  lifecycle?: TrustEvalCaseLifecycle;
  family?: string;
  description?: string;
  tags?: string[];
  metadata?: JsonObject;
  rerun?: TrustEvalRerunSpec;
}

export interface TrustEvalSuiteFixture {
  suiteId: string;
  name: string;
  kind: TrustEvalSuiteKind;
  version: string;
  description?: string;
  tags?: string[];
  metadata?: JsonObject;
  baseline?: TrustEvalBaselineConfig;
  cases: TrustEvalCaseFixture[];
}

export interface TrustEvalPacketSummary extends JsonObject {
  queryKind: string;
  evidenceStatus: string;
  supportLevel: string;
  missingInformation: string[];
  stalenessFlags: string[];
  evidenceFiles: string[];
  evidenceSourceRefs: string[];
  identityKind: string | null;
  selectedFamily: string | null;
  selectedTool: string | null;
  diagnosticCodes: string[];
  rankingDeEmphasized: boolean | null;
}

export interface TrustEvalAssertionResult {
  assertionId: string;
  type: TrustEvalAssertionType;
  passed: boolean;
  actualValue: JsonValue;
  expectedValue: JsonValue;
  description?: string;
}

export interface TrustEvalCaseRunResult {
  caseId: string;
  name: string;
  lifecycle: TrustEvalCaseLifecycle;
  family?: string;
  toolName: ToolName;
  outcome: TrustEvalCaseOutcome;
  requestId?: string;
  toolRunId?: string;
  traceId?: string;
  targetId?: string;
  actualValue: JsonObject;
  assertions: TrustEvalAssertionResult[];
  failureReasons: TrustEvalAssertionType[];
  errorText?: string;
  errorCode?: string;
  rerunComparisonId?: string;
}

export interface TrustEvalFamilyDelta {
  family: string;
  improved: number;
  regressed: number;
  assertionDrift: number;
  unchanged: number;
  previousScore: number;
  currentScore: number;
}

export interface TrustEvalRunComparison {
  baselineRunId?: string;
  baselineSelection: TrustEvalBaselineSelection;
  improvedCaseIds: string[];
  regressedCaseIds: string[];
  assertionDriftCaseIds: string[];
  unchangedCaseIds: string[];
  newCaseIds: string[];
  familyDeltas: TrustEvalFamilyDelta[];
}

export interface TrustEvalWorkflowUsefulnessMetrics {
  eligibleCount: number;
  attachedCount: number;
  fullCount: number;
  partialCount: number;
  noCount: number;
  unexpectedAttachmentCount: number;
  missingExpectedAttachmentCount: number;
  actualFollowupTakenCount: number;
  packetHelpedNextStepRate: number | null;
  actualFollowupRate: number | null;
  noNoiseRate: number | null;
}

export interface TrustEvalPowerWorkflowUsefulnessMetrics {
  byTool: PowerWorkflowPromotionMetrics[];
  exposureDecisions: PowerWorkflowExposureDecision[];
}

// 7.5: artifact usefulness surfaces alongside power-workflow usefulness on
// the shared eval-runner summary. Per-kind metrics + exposure decisions,
// matching the R6 PowerWorkflow pattern.
export interface TrustEvalArtifactUsefulnessMetrics {
  byKind: ArtifactPromotionMetrics[];
  exposureDecisions: ArtifactExposureDecision[];
}

export interface TrustEvalRunSummary {
  runId: string;
  suiteId: string;
  outcome: TrustEvalSuiteOutcome;
  startedAt: string;
  finishedAt: string;
  counts: {
    active: number;
    pass: number;
    partial: number;
    miss: number;
    errored: number;
    skipped: number;
  };
  caseResults: TrustEvalCaseRunResult[];
  comparison: TrustEvalRunComparison;
  workflowUsefulness?: TrustEvalWorkflowUsefulnessMetrics;
  powerWorkflowUsefulness?: TrustEvalPowerWorkflowUsefulnessMetrics;
  artifactUsefulness?: TrustEvalArtifactUsefulnessMetrics;
}
