import type { EvidenceStatus, JsonObject, SupportLevel } from "./common.js";
import type {
  AnswerComparisonChange,
  AnswerSurfaceIssueCategory,
  AnswerSurfaceIssueConfidence,
  AnswerSurfaceIssueSeverity,
  AnswerTrustFacet,
  AnswerTrustReasonCode,
  AnswerTrustScopeRelation,
  AnswerTrustState,
  QueryKind,
} from "./answer.js";

export type WorkflowContextItemKind =
  | "answer_packet"
  | "file"
  | "symbol"
  | "route"
  | "rpc"
  | "table"
  | "reference_precedent"
  | "diagnostic"
  | "trust_evaluation"
  | "comparison";

export type WorkflowContextItemSource =
  | "answer_result"
  | "evidence"
  | "reference_repo"
  | "trust"
  | "diagnostic"
  | "comparison";

export interface WorkflowContextItemBase<
  TKind extends WorkflowContextItemKind,
  TData,
> {
  itemId: string;
  kind: TKind;
  title: string;
  summary?: string;
  projectId: string;
  queryId: string;
  source: WorkflowContextItemSource;
  sourceRefs: string[];
  data: TData;
  metadata?: JsonObject;
}

export interface WorkflowAnswerPacketContextData {
  queryKind: QueryKind;
  queryText: string;
  supportLevel: SupportLevel;
  evidenceStatus: EvidenceStatus;
  evidenceConfidence: number;
  answerConfidence: number | null;
  stalenessFlags: string[];
  candidateActionIds: string[];
  rankingDeEmphasized: boolean | null;
  rankingReasonCodes: string[];
}

export type WorkflowAnswerPacketContextItem = WorkflowContextItemBase<
  "answer_packet",
  WorkflowAnswerPacketContextData
>;

export interface WorkflowFileContextData {
  filePath: string;
  line: number | null;
}

export type WorkflowFileContextItem = WorkflowContextItemBase<"file", WorkflowFileContextData>;

export interface WorkflowSymbolContextData {
  symbolName: string;
  filePath: string | null;
  line: number | null;
  exportName: string | null;
}

export type WorkflowSymbolContextItem = WorkflowContextItemBase<"symbol", WorkflowSymbolContextData>;

export interface WorkflowRouteContextData {
  routeKey: string;
  pattern: string;
  method: string | null;
  filePath: string | null;
  handlerName: string | null;
  isApi: boolean | null;
}

export type WorkflowRouteContextItem = WorkflowContextItemBase<"route", WorkflowRouteContextData>;

export interface WorkflowRpcContextData {
  schemaName: string | null;
  rpcName: string;
  argTypes: string[];
}

export type WorkflowRpcContextItem = WorkflowContextItemBase<"rpc", WorkflowRpcContextData>;

export interface WorkflowTableContextData {
  schemaName: string | null;
  tableName: string;
}

export type WorkflowTableContextItem = WorkflowContextItemBase<"table", WorkflowTableContextData>;

export type WorkflowReferenceSearchKind = "ref_ask" | "ref_search" | "ref_file";

export interface WorkflowReferencePrecedentInput {
  repoName: string;
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
  searchKind: WorkflowReferenceSearchKind;
  score?: number | null;
  vecRank?: number | null;
  ftsRank?: number | null;
}

export interface WorkflowReferencePrecedentContextData extends WorkflowReferencePrecedentInput {}

export type WorkflowReferencePrecedentContextItem = WorkflowContextItemBase<
  "reference_precedent",
  WorkflowReferencePrecedentContextData
>;

export interface WorkflowDiagnosticContextData {
  code: string;
  category: AnswerSurfaceIssueCategory;
  severity: AnswerSurfaceIssueSeverity;
  confidence: AnswerSurfaceIssueConfidence;
  path: string | null;
  producerPath: string | null;
  consumerPath: string | null;
  line: number | null;
}

export type WorkflowDiagnosticContextItem = WorkflowContextItemBase<
  "diagnostic",
  WorkflowDiagnosticContextData
>;

export interface WorkflowTrustEvaluationContextData {
  state: AnswerTrustState;
  reasonCodes: AnswerTrustReasonCode[];
  scopeRelation: AnswerTrustScopeRelation;
  basisTraceIds: string[];
  conflictingFacets: AnswerTrustFacet[];
  comparisonId: string | null;
  clusterId: string | null;
}

export type WorkflowTrustEvaluationContextItem = WorkflowContextItemBase<
  "trust_evaluation",
  WorkflowTrustEvaluationContextData
>;

export interface WorkflowComparisonContextData {
  comparisonId: string | null;
  summaryChanges: AnswerComparisonChange[];
}

export type WorkflowComparisonContextItem = WorkflowContextItemBase<
  "comparison",
  WorkflowComparisonContextData
>;

export type WorkflowContextItem =
  | WorkflowAnswerPacketContextItem
  | WorkflowFileContextItem
  | WorkflowSymbolContextItem
  | WorkflowRouteContextItem
  | WorkflowRpcContextItem
  | WorkflowTableContextItem
  | WorkflowReferencePrecedentContextItem
  | WorkflowDiagnosticContextItem
  | WorkflowTrustEvaluationContextItem
  | WorkflowComparisonContextItem;

export interface WorkflowContextBundle {
  queryId: string;
  projectId: string;
  items: WorkflowContextItem[];
  primaryItemIds: string[];
  supportingItemIds: string[];
  openQuestions: string[];
}

export type WorkflowPacketFamily =
  | "implementation_brief"
  | "impact_packet"
  | "precedent_pack"
  | "verification_plan"
  | "workflow_recipe";

export type WorkflowPacketScope = "primary" | "all";

export type WorkflowPacketWatchMode = "off" | "watch";

export interface WorkflowPacketRequest {
  family: WorkflowPacketFamily;
  scope?: WorkflowPacketScope;
  focusItemIds?: string[];
  focusKinds?: WorkflowContextItemKind[];
  referencePrecedents?: WorkflowReferencePrecedentInput[];
  watchMode?: WorkflowPacketWatchMode;
}

export interface WorkflowPacketInput {
  family: WorkflowPacketFamily;
  queryId: string;
  projectId: string;
  scope: WorkflowPacketScope;
  watchMode: WorkflowPacketWatchMode;
  selectedItems: WorkflowContextItem[];
  selectedItemIds: string[];
  primaryItemIds: string[];
  supportingItemIds: string[];
  focusedItemIds: string[];
  openQuestions: string[];
}
