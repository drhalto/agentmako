import type {
  ContextPacketToolInput,
  LiveTextSearchToolOutput,
  NeighborhoodSection,
  ProjectFact,
  ProjectFactsToolOutput,
  ProjectFinding,
  ProjectFindingsToolOutput,
  ProjectLocatorInput,
  ProjectOpenLoopsToolOutput,
  ReefAskConfidence,
  ReefAskDatabaseObjectSummary,
  ReefAskDecisionTrace,
  ReefAskDiagnosticSummary,
  ReefAskEvidenceMode,
  ReefAskFindingsSummary,
  ReefAskGraphSummary,
  ReefAskInventorySummary,
  ReefAskLiteralMatchesSummary,
  ReefAskMode,
  ReefAskNextQuery,
  ReefAskPlannedCalculation,
  ReefAskWhereUsedSummary,
  ReefEvidenceGraph,
  ReefStructuralTargetKind,
  ReefAskToolInput,
  ReefAskToolOutput,
  ReefWhereUsedToolOutput,
  RouteContextToolOutput,
  RpcNeighborhoodToolOutput,
  TableNeighborhoodToolOutput,
  VerificationStateToolOutput,
} from "@mako-ai/contracts";
import { contextPacketTool } from "../context-packet/index.js";
import { liveTextSearchTool } from "../live-text-search/index.js";
import { routeContextTool, rpcNeighborhoodTool, tableNeighborhoodTool } from "../neighborhoods/index.js";
import { type ToolServiceOptions, withProjectContext } from "../runtime.js";
import { projectFactsTool, projectFindingsTool } from "./base-tools.js";
import {
  REEF_ACTIVE_FINDING_STATUS_NODE,
  REEF_ACTIVE_FINDING_STATUS_QUERY_KIND,
  REEF_DIAGNOSTIC_COVERAGE_NODE,
  REEF_DIAGNOSTIC_COVERAGE_QUERY_KIND,
  REEF_DUPLICATE_CANDIDATES_NODE,
  REEF_DUPLICATE_CANDIDATES_QUERY_KIND,
  REEF_IMPACT_NODE,
  REEF_IMPACT_QUERY_KIND,
  REEF_ROUTE_CONTEXT_NODE,
  REEF_ROUTE_CONTEXT_QUERY_KIND,
  REEF_RPC_NEIGHBORHOOD_NODE,
  REEF_RPC_NEIGHBORHOOD_QUERY_KIND,
  REEF_TABLE_NEIGHBORHOOD_NODE,
  REEF_TABLE_NEIGHBORHOOD_QUERY_KIND,
  REEF_WHERE_USED_NODE,
  REEF_WHERE_USED_QUERY_KIND,
} from "./calculation-nodes.js";
import {
  collectFocusedConventionGraphEvidence,
  type ReefConventionGraphEvidence,
} from "./convention-graph-evidence.js";
import { buildReefEvidenceGraph } from "./evidence-graph.js";
import {
  collectFocusedIndexedGraphEvidence,
  type ReefIndexedGraphEvidence,
} from "./indexed-graph-evidence.js";
import { projectOpenLoopsTool } from "./open-loops.js";
import {
  collectFocusedOperationalGraphEvidence,
  type ReefOperationalGraphEvidence,
} from "./operational-graph-evidence.js";
import { reefWhereUsedTool } from "./structural-knowledge.js";
import {
  calculateActiveFindingStatus,
  calculateDuplicateCandidates,
  type ReefActiveFindingStatusOutput,
  type ReefDuplicateCandidatesOutput,
} from "./status-calculations.js";
import { buildReefToolExecution } from "./tool-execution.js";
import { verificationStateTool } from "./verification.js";

const DEFAULT_BUDGET_TOKENS = 5000;
const DEFAULT_MAX_PRIMARY_CONTEXT = 10;
const DEFAULT_MAX_RELATED_CONTEXT = 18;
const DEFAULT_MAX_OPEN_LOOPS = 8;
const DEFAULT_EVIDENCE_MODE: ReefAskEvidenceMode = "compact";
const DEFAULT_MAX_EVIDENCE_ITEMS_PER_SECTION = 40;
const LIVE_TEXT_MAX_MATCHES = 80;
const LIVE_TEXT_MAX_FILES = 40;
const REEF_FACT_QUERY_LIMIT = 80;
const PROJECT_FINDINGS_QUERY_LIMIT = 80;
const ANSWER_INVENTORY_ITEM_LIMIT = 20;
const ANSWER_FINDING_ITEM_LIMIT = 12;
const ANSWER_LITERAL_FILE_LIMIT = 20;
const ANSWER_WHERE_USED_DEFINITION_LIMIT = 10;
const ANSWER_WHERE_USED_USAGE_LIMIT = 20;
const WHERE_USED_QUERY_LIMIT = 60;
const DATABASE_OBJECT_FACT_SCAN_LIMIT = 2000;
const ANSWER_DATABASE_COLUMN_LIMIT = 80;
const ANSWER_DATABASE_RELATION_LIMIT = 40;
const ANSWER_DIAGNOSTIC_SOURCE_LIMIT = 12;
const ANSWER_DIAGNOSTIC_RUN_LIMIT = 8;
const ANSWER_DIAGNOSTIC_FILE_LIMIT = 10;
const ANSWER_DIAGNOSTIC_LOOP_LIMIT = 10;
const NEIGHBORHOOD_QUERY_MAX_PER_SECTION = 20;
const ACTIVE_FINDING_STATUS_LIMIT = 500;
const DUPLICATE_CANDIDATE_LIMIT = 20;
const DATABASE_OBJECT_FACT_KINDS = [
  "db_table",
  "db_column",
  "db_index",
  "db_foreign_key",
  "db_rls_policy",
  "db_trigger",
  "db_usage",
] as const;

export type ReefCompiledQuery = Omit<ReefAskToolOutput, "toolName">;

export interface CompileReefQueryOptions {
  executionToolName?: string;
}

type ContextPacketResult = Awaited<ReturnType<typeof contextPacketTool>>;

export interface ReefQueryEnginePlan {
  mode: ReefAskMode;
  includeOpenLoops: boolean;
  includeVerification: boolean;
  maxOpenLoops: number;
  maxPrimaryContext: number;
  maxRelatedContext: number;
  budgetTokens: number;
  evidenceMode: ReefAskEvidenceMode;
  maxEvidenceItemsPerSection: number;
  contextInput: ContextPacketToolInput;
  verificationFiles: string[];
  liveTextSearch?: {
    query: string;
    reason: string;
  };
  reefFactQueries: Array<{
    kind: string;
    reason: string;
    limit: number;
  }>;
  projectFindings?: {
    reason: string;
    limit: number;
  };
  databaseObject?: {
    objectName: string;
    schemaName?: string;
    reason: string;
    limit: number;
  };
  tableNeighborhood?: {
    tableName: string;
    schemaName?: string;
    reason: string;
    maxPerSection: number;
  };
  rpcNeighborhood?: {
    rpcName: string;
    schemaName?: string;
    argTypes?: string[];
    reason: string;
    maxPerSection: number;
  };
  routeContext?: {
    route: string;
    reason: string;
    maxPerSection: number;
  };
  whereUsed?: {
    query: string;
    targetKind?: ReefStructuralTargetKind;
    reason: string;
    limit: number;
  };
  duplicateCandidates?: {
    reason: string;
    limit: number;
  };
}

export interface ReefQueryEvidenceBundle {
  context: ContextPacketResult;
  indexedGraph?: ReefIndexedGraphEvidence;
  indexedGraphWarnings?: string[];
  conventionGraph?: ReefConventionGraphEvidence;
  conventionGraphWarnings?: string[];
  operationalGraph?: ReefOperationalGraphEvidence;
  operationalGraphWarnings?: string[];
  openLoops?: ProjectOpenLoopsToolOutput;
  verification?: VerificationStateToolOutput;
  liveTextSearch?: LiveTextSearchToolOutput;
  liveTextSearchWarnings?: string[];
  reefFacts?: ProjectFactsToolOutput[];
  reefFactWarnings?: string[];
  databaseObjectQuery?: ReefQueryEnginePlan["databaseObject"];
  databaseObjectFacts?: ProjectFact[];
  databaseObjectWarnings?: string[];
  tableNeighborhood?: TableNeighborhoodToolOutput;
  tableNeighborhoodWarnings?: string[];
  rpcNeighborhood?: RpcNeighborhoodToolOutput;
  rpcNeighborhoodWarnings?: string[];
  routeContext?: RouteContextToolOutput;
  routeContextWarnings?: string[];
  projectFindings?: ProjectFindingsToolOutput;
  projectFindingsWarnings?: string[];
  whereUsed?: ReefWhereUsedToolOutput;
  whereUsedWarnings?: string[];
  activeFindingStatus?: ReefActiveFindingStatusOutput;
  duplicateCandidates?: ReefDuplicateCandidatesOutput;
  statusCalculationWarnings?: string[];
}

interface LiveTextSearchEvidenceResult {
  liveTextSearch?: LiveTextSearchToolOutput;
  liveTextSearchWarnings?: string[];
}

interface ReefFactEvidenceResult {
  reefFacts?: ProjectFactsToolOutput[];
  reefFactWarnings?: string[];
}

interface ProjectFindingsEvidenceResult {
  projectFindings?: ProjectFindingsToolOutput;
  projectFindingsWarnings?: string[];
}

interface DatabaseObjectEvidenceResult {
  databaseObjectQuery?: ReefQueryEnginePlan["databaseObject"];
  databaseObjectFacts?: ProjectFact[];
  databaseObjectWarnings?: string[];
}

interface NeighborhoodEvidenceResult {
  tableNeighborhood?: TableNeighborhoodToolOutput;
  tableNeighborhoodWarnings?: string[];
  rpcNeighborhood?: RpcNeighborhoodToolOutput;
  rpcNeighborhoodWarnings?: string[];
  routeContext?: RouteContextToolOutput;
  routeContextWarnings?: string[];
}

interface WhereUsedEvidenceResult {
  whereUsed?: ReefWhereUsedToolOutput;
  whereUsedWarnings?: string[];
}

interface FindingCalculationEvidenceResult {
  activeFindingStatus?: ReefActiveFindingStatusOutput;
  duplicateCandidates?: ReefDuplicateCandidatesOutput;
  statusCalculationWarnings?: string[];
}

interface IndexedGraphEvidenceResult {
  indexedGraph?: ReefIndexedGraphEvidence;
  indexedGraphWarnings?: string[];
}

interface ConventionGraphEvidenceResult {
  conventionGraph?: ReefConventionGraphEvidence;
  conventionGraphWarnings?: string[];
}

interface OperationalGraphEvidenceResult {
  operationalGraph?: ReefOperationalGraphEvidence;
  operationalGraphWarnings?: string[];
}

export interface ReefQueryConfidenceScore {
  confidence: ReefAskConfidence;
  reasons: string[];
}

function locator(input: ProjectLocatorInput): ProjectLocatorInput {
  return {
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.projectRef ? { projectRef: input.projectRef } : {}),
  };
}

function inferMode(question: string): ReefAskMode {
  const lower = question.toLowerCase();
  if (/\b(verify|verification|test|diagnostic|lint|typecheck|close out)\b/.test(lower)) return "verify";
  if (/\b(review|audit|risk|regression|safe)\b/.test(lower)) return "review";
  if (/\b(implement|fix|change|edit|add|remove|refactor)\b/.test(lower)) return "implement";
  if (/\b(plan|approach|design|scope|impact)\b/.test(lower)) return "plan";
  return "explore";
}

function contextMode(mode: ReefAskMode): ContextPacketToolInput["mode"] {
  return mode === "verify" ? "review" : mode;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function verificationFiles(input: ReefAskToolInput): string[] {
  return unique([
    ...(input.changedFiles ?? []),
    ...(input.focusFiles ?? []),
  ]);
}

function indexedGraphFreshness(context: ContextPacketResult): ProjectFact["freshness"] {
  const state = context.indexFreshness?.state === "fresh"
    ? "fresh"
    : context.indexFreshness?.state === "dirty"
      ? "stale"
      : "unknown";
  return {
    state,
    checkedAt: context.indexFreshness?.checkedAt ?? new Date().toISOString(),
    reason: context.indexFreshness
      ? `Project index freshness gate reported ${context.indexFreshness.state}.`
      : "No project index freshness summary was attached to this context packet.",
  };
}

function focusedIndexedGraphFiles(
  context: ContextPacketResult,
  plan: ReefQueryEnginePlan,
): string[] {
  return unique([
    ...(plan.contextInput.focusFiles ?? []),
    ...(plan.contextInput.changedFiles ?? []),
    ...plan.verificationFiles,
    ...context.primaryContext.flatMap((candidate) => candidate.path ? [candidate.path] : []),
    ...context.relatedContext.flatMap((candidate) => candidate.path ? [candidate.path] : []),
    ...context.symbols.flatMap((symbol) => symbol.path ? [symbol.path] : []),
    ...context.routes.flatMap((route) => route.path ? [route.path] : []),
    ...context.activeFindings.flatMap((finding) => finding.filePath ? [finding.filePath] : []),
  ]);
}

function focusedIndexedGraphDatabaseObjects(
  context: ContextPacketResult,
  plan: ReefQueryEnginePlan,
): string[] {
  return unique([
    ...(plan.contextInput.focusDatabaseObjects ?? []),
    ...(plan.databaseObject
      ? [plan.databaseObject.schemaName
          ? `${plan.databaseObject.schemaName}.${plan.databaseObject.objectName}`
          : plan.databaseObject.objectName]
      : []),
    ...context.databaseObjects.flatMap((object) => [
      object.objectName,
      ...(object.schemaName ? [`${object.schemaName}.${object.objectName}`] : []),
      `${object.objectType}:${object.schemaName ? `${object.schemaName}.` : ""}${object.objectName}`,
    ]),
  ]);
}

function evidenceLanes(args: {
  context: ContextPacketResult;
  indexedGraph?: ReefIndexedGraphEvidence;
  indexedGraphWarnings?: string[];
  conventionGraph?: ReefConventionGraphEvidence;
  conventionGraphWarnings?: string[];
  operationalGraph?: ReefOperationalGraphEvidence;
  operationalGraphWarnings?: string[];
  openLoops?: ProjectOpenLoopsToolOutput;
  verification?: VerificationStateToolOutput;
  liveTextSearch?: LiveTextSearchToolOutput;
  liveTextSearchWarnings?: string[];
  reefFacts?: ProjectFactsToolOutput[];
  reefFactWarnings?: string[];
  databaseObjectFacts?: ProjectFact[];
  databaseObjectWarnings?: string[];
  tableNeighborhood?: TableNeighborhoodToolOutput;
  tableNeighborhoodWarnings?: string[];
  rpcNeighborhood?: RpcNeighborhoodToolOutput;
  rpcNeighborhoodWarnings?: string[];
  routeContext?: RouteContextToolOutput;
  routeContextWarnings?: string[];
  projectFindings?: ProjectFindingsToolOutput;
  projectFindingsWarnings?: string[];
  activeFindingStatus?: ReefActiveFindingStatusOutput;
  duplicateCandidates?: ReefDuplicateCandidatesOutput;
  statusCalculationWarnings?: string[];
  whereUsed?: ReefWhereUsedToolOutput;
  whereUsedWarnings?: string[];
}): string[] {
  const lanes = new Set<string>(["codebase"]);
  if (
    args.indexedGraph &&
    (
      args.indexedGraph.files.length > 0 ||
      args.indexedGraph.imports.length > 0 ||
      args.indexedGraph.symbols.length > 0 ||
      args.indexedGraph.routes.length > 0 ||
      args.indexedGraph.schemaUsages.length > 0
    )
  ) {
    lanes.add("graph");
  }
  if (
    args.context.databaseObjects.length > 0 ||
    (args.reefFacts ?? []).some((result) => result.facts.some((fact) => fact.kind.startsWith("db_"))) ||
    (args.databaseObjectFacts ?? []).some((fact) => fact.kind.startsWith("db_")) ||
    Boolean(args.tableNeighborhood || args.rpcNeighborhood)
  ) {
    lanes.add("database");
  }
  if (
    args.context.activeFindings.length > 0 ||
    (args.projectFindings?.findings.length ?? 0) > 0 ||
    Boolean(args.activeFindingStatus || args.duplicateCandidates) ||
    (args.openLoops?.summary.total ?? 0) > 0
  ) {
    lanes.add("findings");
  }
  if (args.routeContext || (args.routeContextWarnings?.length ?? 0) > 0) lanes.add("routes");
  if (args.context.risks.length > 0) lanes.add("risks");
  if (args.context.scopedInstructions.length > 0) lanes.add("instructions");
  if ((args.conventionGraph?.conventions.length ?? 0) > 0 || (args.conventionGraphWarnings?.length ?? 0) > 0) {
    lanes.add("conventions");
  }
  if (
    (args.operationalGraph?.diagnosticRuns.length ?? 0) > 0 ||
    (args.operationalGraph?.toolRuns.length ?? 0) > 0 ||
    (args.operationalGraphWarnings?.length ?? 0) > 0
  ) {
    lanes.add("operations");
  }
  if (args.verification) lanes.add("diagnostics");
  if (args.liveTextSearch || (args.liveTextSearchWarnings?.length ?? 0) > 0) lanes.add("live_text");
  if (
    (args.reefFacts?.length ?? 0) > 0 ||
    (args.reefFactWarnings?.length ?? 0) > 0 ||
    (args.databaseObjectFacts?.length ?? 0) > 0 ||
    (args.databaseObjectWarnings?.length ?? 0) > 0
  ) {
    lanes.add("facts");
  }
  if (args.whereUsed || (args.whereUsedWarnings?.length ?? 0) > 0) lanes.add("usage");
  return [...lanes];
}

function graphSummary(graph: ReefEvidenceGraph): ReefAskGraphSummary {
  return {
    returnedNodes: graph.truncated.returnedNodes,
    totalNodes: graph.truncated.totalNodes,
    droppedNodes: graph.truncated.droppedNodes,
    returnedEdges: graph.truncated.returnedEdges,
    totalEdges: graph.truncated.totalEdges,
    droppedEdges: graph.truncated.droppedEdges,
    truncated: graph.truncated.nodes || graph.truncated.edges,
    nodeKinds: graph.coverage.nodeKinds,
    edgeKinds: graph.coverage.edgeKinds,
    sourceCounts: graph.coverage.sourceCounts,
  };
}

function extractQuotedLiteral(question: string): string | undefined {
  const quotedMatches = question.matchAll(/"([^"\r\n]{1,512})"|'([^'\r\n]{1,512})'|`([^`\r\n]{1,512})`/g);
  for (const match of quotedMatches) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value.length > 0) return value;
  }
  return undefined;
}

function looksLikeCodeLiteral(term: string): boolean {
  if (term.length < 2 || term.length > 512) return false;
  return /[./_:@()[\]{}<>=`'"-]/.test(term) ||
    /[a-z][A-Z]/.test(term) ||
    /^[A-Z][A-Za-z0-9_]*$/.test(term) ||
    /^[A-Z0-9_]{3,}$/.test(term);
}

function normalizeBareLiteral(term: string): string {
  return term
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[?,;!]+$/g, "");
}

function stripLiteralSearchPrefix(value: string): string {
  let result = value.trim();
  for (let index = 0; index < 4; index += 1) {
    const next = result.replace(
      /^(?:for|of|the|a|an|exact(?:\s+string)?|literal(?:\s+string)?|string|term|symbol)\s+/i,
      "",
    ).trim();
    if (next === result) return result;
    result = next;
  }
  return result;
}

function inferLiveTextSearch(question: string): ReefQueryEnginePlan["liveTextSearch"] {
  const quoted = extractQuotedLiteral(question);
  if (quoted) {
    return {
      query: quoted,
      reason: "The question contains a quoted literal, so Reef can check current disk directly.",
    };
  }

  const cueMatch = question.match(
    /\b(?:search|find|grep|rg|look\s+for|literal(?:ly)?|exact(?:\s+string)?|occurrences?\s+of|call\s+sites?\s+for)\b(?<tail>[^?\r\n]{1,200})/i,
  );
  const tail = cueMatch?.groups?.tail
    ? stripLiteralSearchPrefix(cueMatch.groups.tail)
    : undefined;
  const token = normalizeBareLiteral(tail?.split(/\s+/)[0] ?? "");
  if (looksLikeCodeLiteral(token)) {
    return {
      query: token,
      reason: "The question uses exact-search wording with a code-shaped term.",
    };
  }

  return undefined;
}

function wantsInventory(question: string): boolean {
  return /\b(list|enumerate|inventory|catalog|show|which|what|all|every)\b/i.test(question);
}

function inferReefFactQueries(question: string): ReefQueryEnginePlan["reefFactQueries"] {
  const lower = question.toLowerCase();
  if (!wantsInventory(question)) return [];

  const queries: ReefQueryEnginePlan["reefFactQueries"] = [];
  if (/\b(rpcs?|stored\s+procedures?|database\s+functions?|postgres\s+functions?)\b/.test(lower)) {
    queries.push({
      kind: "db_rpc",
      reason: "The question asks for an RPC/function inventory, so Reef can enumerate stored DB function facts.",
      limit: REEF_FACT_QUERY_LIMIT,
    });
  }
  if (/\b(tables?|relations?)\b/.test(lower)) {
    queries.push({
      kind: "db_table",
      reason: "The question asks for a table inventory, so Reef can enumerate DB table facts.",
      limit: REEF_FACT_QUERY_LIMIT,
    });
  }
  if (/\b(views?)\b/.test(lower)) {
    queries.push({
      kind: "db_view",
      reason: "The question asks for a view inventory, so Reef can enumerate DB view facts.",
      limit: REEF_FACT_QUERY_LIMIT,
    });
  }
  if (/\b(rls|polic(?:y|ies))\b/.test(lower)) {
    queries.push({
      kind: "db_rls_policy",
      reason: "The question asks for RLS/policy inventory, so Reef can enumerate DB policy facts.",
      limit: REEF_FACT_QUERY_LIMIT,
    });
  }

  return queries;
}

function inferProjectFindings(question: string): ReefQueryEnginePlan["projectFindings"] {
  const lower = question.toLowerCase();
  if (/\b(findings?|known\s+issues?|issues?|risks?|bugs?|warnings?|errors?|audit|review|duplicates?|duplication|drift|bypass(?:es)?|violations?)\b/.test(lower)) {
    return {
      reason: "The question asks for known findings, risks, drift, duplication, or audit evidence, so Reef can read durable project findings.",
      limit: PROJECT_FINDINGS_QUERY_LIMIT,
    };
  }
  return undefined;
}

function looksLikeWhereUsedQuestion(question: string): boolean {
  return /\b(where\s+(?:is|are).+\bused|what\s+uses|who\s+uses|callers?\s+(?:of|for)|references?\s+(?:to|of|for)|usages?\s+(?:of|for)|dependents?\s+(?:of|for)|impact\s+(?:of|for)|what\s+breaks|break\s+if|change\s+impact)\b/i.test(question);
}

function structuralTargetKindFor(query: string): ReefStructuralTargetKind {
  if (/^\/[A-Za-z0-9_./:[\]-]*$/.test(query)) return "route";
  if (/[\\/]/.test(query) || /\.[cm]?[tj]sx?$/i.test(query)) return "file";
  if (/^[A-Z][A-Za-z0-9_$]*$/.test(query)) return "component";
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(query)) return "symbol";
  return "pattern";
}

function extractWhereUsedTarget(question: string): string | undefined {
  const quoted = extractQuotedLiteral(question);
  if (quoted) return quoted;
  const patterns = [
    /\b(?:what|who)\s+uses\s+(?<target>[A-Za-z0-9_$./@:[\]-]+)/i,
    /\bwhere\s+(?:is|are)\s+(?<target>[A-Za-z0-9_$./@:[\]-]+)\s+used\b/i,
    /\b(?:callers?|references?|usages?|dependents?)\s+(?:of|to|for)\s+(?<target>[A-Za-z0-9_$./@:[\]-]+)/i,
    /\bimpact\s+(?:of|for)\s+(?<target>[A-Za-z0-9_$./@:[\]-]+)/i,
    /\b(?:what\s+breaks|break\s+if|change\s+impact).*?\b(?<target>[A-Za-z0-9_$./@:[\]-]+\.[cm]?[tj]sx?)\b/i,
  ];
  for (const pattern of patterns) {
    const target = question.match(pattern)?.groups?.target;
    if (target) return normalizeBareLiteral(target);
  }
  return undefined;
}

function inferWhereUsed(input: ReefAskToolInput): ReefQueryEnginePlan["whereUsed"] {
  const question = input.question;
  if (input.focusSymbols?.[0] && looksLikeWhereUsedQuestion(question)) {
    const query = input.focusSymbols[0];
    return {
      query,
      targetKind: structuralTargetKindFor(query),
      reason: "The question asks for usages and supplies a focus symbol.",
      limit: WHERE_USED_QUERY_LIMIT,
    };
  }
  const focusFile = input.focusFiles?.[0] ?? input.changedFiles?.[0];
  if (focusFile && looksLikeWhereUsedQuestion(question)) {
    return {
      query: focusFile,
      targetKind: "file",
      reason: "The question asks for usage or impact and supplies a focus file.",
      limit: WHERE_USED_QUERY_LIMIT,
    };
  }
  if (input.focusRoutes?.[0] && looksLikeWhereUsedQuestion(question)) {
    return {
      query: input.focusRoutes[0],
      targetKind: "route",
      reason: "The question asks for usages and supplies a focus route.",
      limit: WHERE_USED_QUERY_LIMIT,
    };
  }
  if (!looksLikeWhereUsedQuestion(question)) return undefined;
  const query = extractWhereUsedTarget(question);
  if (!query) return undefined;
  return {
    query,
    targetKind: structuralTargetKindFor(query),
    reason: "The question asks for usages, references, callers, dependents, or change impact.",
    limit: WHERE_USED_QUERY_LIMIT,
  };
}

function looksLikeDatabaseObjectQuestion(question: string): boolean {
  return /\b(database|db|schema|table|rpcs?|functions?|procedures?|columns?|indexes?|foreign\s+keys?|fks?|rls|polic(?:y|ies)|triggers?|relations?|constraints?)\b/i
    .test(question);
}

function parseDatabaseObjectRef(value: string): { schemaName?: string; objectName: string } | undefined {
  const normalized = value.trim().replace(/^(?:table|view|schema_object|relation):/i, "");
  const match = normalized.match(/^(?:(?<schema>[A-Za-z_][A-Za-z0-9_]*)\.)?(?<object>[A-Za-z_][A-Za-z0-9_]*)$/);
  const objectName = match?.groups?.object;
  if (!objectName) return undefined;
  return {
    ...(match.groups?.schema ? { schemaName: match.groups.schema } : {}),
    objectName,
  };
}

function extractDatabaseObjectTarget(question: string): { schemaName?: string; objectName: string } | undefined {
  const qualified = question.match(/\b(?<schema>[A-Za-z_][A-Za-z0-9_]*)\.(?<object>[A-Za-z_][A-Za-z0-9_]*)\b/);
  if (qualified?.groups?.object) {
    return {
      schemaName: qualified.groups.schema,
      objectName: qualified.groups.object,
    };
  }

  const objectAfterCue = question.match(
    /\b(?:table|relation|schema|rpcs?|functions?|procedures?|columns?|indexes?|foreign\s+keys?|fks?|rls|polic(?:y|ies)|triggers?|on|for)\s+(?<object>[A-Za-z_][A-Za-z0-9_]*)\b/i,
  )?.groups?.object;
  if (objectAfterCue && !/^(?:the|a|an|and|or|this|that|all|every|which|what|in|table|schema|rpcs?|functions?|procedures?|columns?|indexes?|rls|polic(?:y|ies))$/i.test(objectAfterCue)) {
    return { objectName: objectAfterCue };
  }

  const underscoreToken = question.match(/\b(?<object>[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]*)\b/)?.groups?.object;
  return underscoreToken ? { objectName: underscoreToken } : undefined;
}

function inferDatabaseObject(input: ReefAskToolInput): ReefQueryEnginePlan["databaseObject"] {
  const focusObject = input.focusDatabaseObjects?.map(parseDatabaseObjectRef).find(Boolean);
  if (focusObject && looksLikeDatabaseObjectQuestion(input.question)) {
    return {
      ...focusObject,
      reason: "The question asks for database object detail and supplies a focus database object.",
      limit: DATABASE_OBJECT_FACT_SCAN_LIMIT,
    };
  }
  if (!looksLikeDatabaseObjectQuestion(input.question)) return undefined;
  const target = extractDatabaseObjectTarget(input.question);
  if (!target) return undefined;
  return {
    ...target,
    reason: "The question asks for schema, column, RLS, index, FK, trigger, or database object detail.",
    limit: DATABASE_OBJECT_FACT_SCAN_LIMIT,
  };
}

function looksLikeRpcQuestion(question: string): boolean {
  return /\b(rpcs?|functions?|procedures?)\b/i.test(question);
}

function inferTableNeighborhood(
  input: ReefAskToolInput,
  databaseObject: ReefQueryEnginePlan["databaseObject"],
): ReefQueryEnginePlan["tableNeighborhood"] {
  if (!databaseObject || looksLikeRpcQuestion(input.question)) return undefined;
  return {
    tableName: databaseObject.objectName,
    ...(databaseObject.schemaName ? { schemaName: databaseObject.schemaName } : {}),
    reason: "The question asks for a specific database table/object, so Reef can calculate schema, app usage, dependent RPC, route, and RLS neighborhood evidence.",
    maxPerSection: NEIGHBORHOOD_QUERY_MAX_PER_SECTION,
  };
}

function inferRpcNeighborhood(
  input: ReefAskToolInput,
  databaseObject: ReefQueryEnginePlan["databaseObject"],
): ReefQueryEnginePlan["rpcNeighborhood"] {
  if (!databaseObject || !looksLikeRpcQuestion(input.question)) return undefined;
  return {
    rpcName: databaseObject.objectName,
    ...(databaseObject.schemaName ? { schemaName: databaseObject.schemaName } : {}),
    reason: "The question asks for a specific database RPC/function, so Reef can calculate callers, touched tables, and RLS neighborhood evidence.",
    maxPerSection: NEIGHBORHOOD_QUERY_MAX_PER_SECTION,
  };
}

function extractRouteTarget(question: string): string | undefined {
  const quoted = extractQuotedLiteral(question);
  if (quoted?.startsWith("/") || /^(?:GET|POST|PUT|PATCH|DELETE)\s+\//i.test(quoted ?? "")) {
    return quoted;
  }
  const methodPath = question.match(/\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9_.\/:\[\]{}-]+/i)?.[0];
  if (methodPath) return methodPath;
  const path = question.match(/\b\/(?:api\/)?[A-Za-z0-9_.\/:\[\]{}-]+\b/)?.[0];
  return path;
}

function inferRouteContext(input: ReefAskToolInput): ReefQueryEnginePlan["routeContext"] {
  const route = input.focusRoutes?.[0] ?? extractRouteTarget(input.question);
  if (!route) return undefined;
  return {
    route,
    reason: "The question names or focuses a route, so Reef can calculate handler, import, downstream schema, RPC, and RLS context.",
    maxPerSection: NEIGHBORHOOD_QUERY_MAX_PER_SECTION,
  };
}

function inferDuplicateCandidates(question: string): ReefQueryEnginePlan["duplicateCandidates"] {
  if (!/\b(duplicates?|duplication|near[- ]?twins?|copy[- ]?paste|clones?|drift)\b/i.test(question)) {
    return undefined;
  }
  return {
    reason: "The question asks for duplicate, near-twin, clone, copy-paste, or drift evidence, so Reef can calculate duplicate candidates from durable findings.",
    limit: DUPLICATE_CANDIDATE_LIMIT,
  };
}

function reefFacts(evidence: ReefQueryEvidenceBundle): ProjectFact[] {
  const byFingerprint = new Map<string, ProjectFact>();
  for (const result of evidence.reefFacts ?? []) {
    for (const fact of result.facts) {
      byFingerprint.set(fact.fingerprint, fact);
    }
  }
  for (const fact of evidence.databaseObjectFacts ?? []) {
    byFingerprint.set(fact.fingerprint, fact);
  }
  return [...byFingerprint.values()];
}

function mergedFindings(evidence: ReefQueryEvidenceBundle): ProjectFinding[] {
  const byFingerprint = new Map<string, ProjectFinding>();
  for (const finding of evidence.context.activeFindings) {
    byFingerprint.set(finding.fingerprint, finding);
  }
  for (const finding of evidence.projectFindings?.findings ?? []) {
    byFingerprint.set(finding.fingerprint, finding);
  }
  for (const finding of evidence.whereUsed?.relatedFindings ?? []) {
    byFingerprint.set(finding.fingerprint, finding);
  }
  return [...byFingerprint.values()];
}

function severityRank(severity: ProjectFinding["severity"]): number {
  switch (severity) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
    default: {
      const exhaustive: never = severity;
      return exhaustive;
    }
  }
}

function jsonString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function jsonOptionalString(value: unknown): string | undefined {
  return value === null ? undefined : jsonString(value);
}

function jsonNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function jsonBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function jsonStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function factSchemaName(fact: ProjectFact): string | undefined {
  if (fact.subject.kind === "schema_object") return fact.subject.schemaName;
  return jsonString(fact.data?.schemaName) ?? jsonString(fact.data?.rpcSchema);
}

function factDisplayName(fact: ProjectFact): string {
  const schemaName = factSchemaName(fact);
  switch (fact.kind) {
    case "db_rpc": {
      const rpcName = jsonString(fact.data?.rpcName) ??
        (fact.subject.kind === "schema_object" ? fact.subject.objectName : fact.subjectFingerprint);
      const argTypes = jsonStringArray(fact.data?.argTypes);
      const signature = `${rpcName}(${argTypes.join(", ")})`;
      return schemaName ? `${schemaName}.${signature}` : signature;
    }
    case "db_table": {
      const tableName = jsonString(fact.data?.tableName) ?? jsonString(fact.data?.objectName);
      return tableName ? (schemaName ? `${schemaName}.${tableName}` : tableName) : fact.subjectFingerprint;
    }
    case "db_view": {
      const viewName = jsonString(fact.data?.viewName) ?? jsonString(fact.data?.objectName);
      return viewName ? (schemaName ? `${schemaName}.${viewName}` : viewName) : fact.subjectFingerprint;
    }
    case "db_rls_policy": {
      const tableName = jsonString(fact.data?.tableName);
      const policyName = jsonString(fact.data?.policyName) ?? jsonString(fact.data?.name);
      const base = [schemaName, tableName, policyName].filter(Boolean).join(".");
      return base || fact.subjectFingerprint;
    }
    default:
      if (fact.subject.kind === "schema_object") {
        return `${fact.subject.schemaName}.${fact.subject.objectName}`;
      }
      return fact.subjectFingerprint;
  }
}

function compileInventorySummary(facts: ProjectFact[]): ReefAskInventorySummary | undefined {
  if (facts.length === 0) return undefined;
  const byKind: Record<string, number> = {};
  for (const fact of facts) {
    byKind[fact.kind] = (byKind[fact.kind] ?? 0) + 1;
  }
  const sorted = [...facts].sort((left, right) =>
    left.kind.localeCompare(right.kind) ||
    factDisplayName(left).localeCompare(factDisplayName(right))
  );
  return {
    total: facts.length,
    byKind,
    staleCount: facts.filter((fact) => fact.freshness.state !== "fresh").length,
    items: sorted.slice(0, ANSWER_INVENTORY_ITEM_LIMIT).map((fact) => ({
      kind: fact.kind,
      name: factDisplayName(fact),
      ...(factSchemaName(fact) ? { schemaName: factSchemaName(fact) } : {}),
      freshness: fact.freshness,
    })),
    truncated: facts.length > ANSWER_INVENTORY_ITEM_LIMIT,
  };
}

function compileDatabaseObjectSummary(
  facts: ProjectFact[],
  query: ReefQueryEnginePlan["databaseObject"],
): ReefAskDatabaseObjectSummary | undefined {
  if (!query) return undefined;
  const objectFacts = facts.filter((fact) => factMatchesDatabaseObject(fact, query));
  if (objectFacts.length === 0) return undefined;

  const tableFact = objectFacts.find((fact) => fact.kind === "db_table");
  const columnsAll = objectFacts
    .filter((fact) => fact.kind === "db_column")
    .map((fact) => ({
      name: jsonString(fact.data?.columnName) ?? factDisplayName(fact),
      ...(jsonString(fact.data?.dataType) ? { dataType: jsonString(fact.data?.dataType) } : {}),
      ...(jsonBoolean(fact.data?.nullable) !== undefined ? { nullable: jsonBoolean(fact.data?.nullable) } : {}),
      ...(jsonOptionalString(fact.data?.defaultExpression)
        ? { defaultExpression: jsonOptionalString(fact.data?.defaultExpression) }
        : {}),
      ...(jsonBoolean(fact.data?.isPrimaryKey) !== undefined ? { isPrimaryKey: jsonBoolean(fact.data?.isPrimaryKey) } : {}),
      freshness: fact.freshness,
    }))
    .sort((left, right) =>
      Number(right.isPrimaryKey ?? false) - Number(left.isPrimaryKey ?? false) ||
      left.name.localeCompare(right.name)
    );
  const indexesAll = objectFacts
    .filter((fact) => fact.kind === "db_index")
    .map((fact) => ({
      name: jsonString(fact.data?.indexName) ?? factDisplayName(fact),
      ...(jsonBoolean(fact.data?.unique) !== undefined ? { unique: jsonBoolean(fact.data?.unique) } : {}),
      ...(jsonBoolean(fact.data?.primary) !== undefined ? { primary: jsonBoolean(fact.data?.primary) } : {}),
      columns: jsonStringArray(fact.data?.columns),
      ...(jsonOptionalString(fact.data?.definition) ? { definition: jsonOptionalString(fact.data?.definition) } : {}),
      freshness: fact.freshness,
    }))
    .sort((left, right) => Number(right.primary ?? false) - Number(left.primary ?? false) || left.name.localeCompare(right.name));
  const foreignKeysAll = objectFacts
    .filter((fact) => fact.kind === "db_foreign_key")
    .map((fact) => ({
      ...(jsonString(fact.data?.direction) ? { direction: jsonString(fact.data?.direction) } : {}),
      constraintName: jsonString(fact.data?.constraintName) ?? factDisplayName(fact),
      columns: jsonStringArray(fact.data?.columns),
      ...(jsonString(fact.data?.targetSchema) ? { targetSchema: jsonString(fact.data?.targetSchema) } : {}),
      ...(jsonString(fact.data?.targetTable) ? { targetTable: jsonString(fact.data?.targetTable) } : {}),
      targetColumns: jsonStringArray(fact.data?.targetColumns),
      ...(jsonString(fact.data?.sourceSchema) ? { sourceSchema: jsonString(fact.data?.sourceSchema) } : {}),
      ...(jsonString(fact.data?.sourceTable) ? { sourceTable: jsonString(fact.data?.sourceTable) } : {}),
      sourceColumns: jsonStringArray(fact.data?.sourceColumns),
      ...(jsonString(fact.data?.onUpdate) ? { onUpdate: jsonString(fact.data?.onUpdate) } : {}),
      ...(jsonString(fact.data?.onDelete) ? { onDelete: jsonString(fact.data?.onDelete) } : {}),
      freshness: fact.freshness,
    }))
    .sort((left, right) =>
      (left.direction ?? "").localeCompare(right.direction ?? "") ||
      left.constraintName.localeCompare(right.constraintName)
    );
  const rlsPoliciesAll = objectFacts
    .filter((fact) => fact.kind === "db_rls_policy")
    .map((fact) => ({
      name: jsonString(fact.data?.policyName) ?? factDisplayName(fact),
      ...(jsonString(fact.data?.mode) ? { mode: jsonString(fact.data?.mode) } : {}),
      ...(jsonString(fact.data?.command) ? { command: jsonString(fact.data?.command) } : {}),
      roles: jsonStringArray(fact.data?.roles),
      ...(jsonOptionalString(fact.data?.usingExpression)
        ? { usingExpression: jsonOptionalString(fact.data?.usingExpression) }
        : {}),
      ...(jsonOptionalString(fact.data?.withCheckExpression)
        ? { withCheckExpression: jsonOptionalString(fact.data?.withCheckExpression) }
        : {}),
      freshness: fact.freshness,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const triggersAll = objectFacts
    .filter((fact) => fact.kind === "db_trigger")
    .map((fact) => ({
      name: jsonString(fact.data?.triggerName) ?? factDisplayName(fact),
      ...(jsonBoolean(fact.data?.enabled) !== undefined ? { enabled: jsonBoolean(fact.data?.enabled) } : {}),
      ...(jsonString(fact.data?.enabledMode) ? { enabledMode: jsonString(fact.data?.enabledMode) } : {}),
      ...(jsonString(fact.data?.timing) ? { timing: jsonString(fact.data?.timing) } : {}),
      events: jsonStringArray(fact.data?.events),
      ...(jsonBoolean(fact.data?.hasBodyText) !== undefined ? { hasBodyText: jsonBoolean(fact.data?.hasBodyText) } : {}),
      freshness: fact.freshness,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const usagesAll = objectFacts
    .filter((fact) => fact.kind === "db_usage")
    .map((fact) => {
      const line = jsonNumber(fact.data?.line);
      return {
        filePath: jsonString(fact.data?.filePath) ?? factDisplayName(fact),
        ...(line && line > 0 ? { line } : {}),
        ...(jsonString(fact.data?.usageKind) ? { usageKind: jsonString(fact.data?.usageKind) } : {}),
        ...(jsonOptionalString(fact.data?.excerpt) ? { excerpt: jsonOptionalString(fact.data?.excerpt) } : {}),
        freshness: fact.freshness,
      };
    })
    .sort((left, right) => left.filePath.localeCompare(right.filePath) || (left.line ?? 0) - (right.line ?? 0));

  const schemaName = query.schemaName ?? factSchemaName(tableFact ?? objectFacts[0]);
  return {
    ...(schemaName ? { schemaName } : {}),
    objectName: query.objectName,
    factCount: objectFacts.length,
    staleCount: objectFacts.filter((fact) => fact.freshness.state !== "fresh").length,
    ...(tableFact
      ? {
          table: {
            ...(jsonNumber(tableFact.data?.columnCount) !== undefined ? { columnCount: jsonNumber(tableFact.data?.columnCount) } : {}),
            primaryKey: jsonStringArray(tableFact.data?.primaryKey),
            ...(jsonNumber(tableFact.data?.indexCount) !== undefined ? { indexCount: jsonNumber(tableFact.data?.indexCount) } : {}),
            ...(jsonNumber(tableFact.data?.outboundForeignKeyCount) !== undefined
              ? { outboundForeignKeyCount: jsonNumber(tableFact.data?.outboundForeignKeyCount) }
              : {}),
            ...(jsonNumber(tableFact.data?.inboundForeignKeyCount) !== undefined
              ? { inboundForeignKeyCount: jsonNumber(tableFact.data?.inboundForeignKeyCount) }
              : {}),
            ...(jsonBoolean(tableFact.data?.rlsEnabled) !== undefined ? { rlsEnabled: jsonBoolean(tableFact.data?.rlsEnabled) } : {}),
            ...(jsonBoolean(tableFact.data?.forceRls) !== undefined ? { forceRls: jsonBoolean(tableFact.data?.forceRls) } : {}),
            ...(jsonNumber(tableFact.data?.policyCount) !== undefined ? { policyCount: jsonNumber(tableFact.data?.policyCount) } : {}),
            ...(jsonNumber(tableFact.data?.triggerCount) !== undefined ? { triggerCount: jsonNumber(tableFact.data?.triggerCount) } : {}),
            freshness: tableFact.freshness,
          },
        }
      : {}),
    columns: columnsAll.slice(0, ANSWER_DATABASE_COLUMN_LIMIT),
    indexes: indexesAll.slice(0, ANSWER_DATABASE_RELATION_LIMIT),
    foreignKeys: foreignKeysAll.slice(0, ANSWER_DATABASE_RELATION_LIMIT),
    rlsPolicies: rlsPoliciesAll.slice(0, ANSWER_DATABASE_RELATION_LIMIT),
    triggers: triggersAll.slice(0, ANSWER_DATABASE_RELATION_LIMIT),
    usages: usagesAll.slice(0, ANSWER_DATABASE_RELATION_LIMIT),
    truncated: columnsAll.length > ANSWER_DATABASE_COLUMN_LIMIT ||
      indexesAll.length > ANSWER_DATABASE_RELATION_LIMIT ||
      foreignKeysAll.length > ANSWER_DATABASE_RELATION_LIMIT ||
      rlsPoliciesAll.length > ANSWER_DATABASE_RELATION_LIMIT ||
      triggersAll.length > ANSWER_DATABASE_RELATION_LIMIT ||
      usagesAll.length > ANSWER_DATABASE_RELATION_LIMIT,
  };
}

function emptyDiagnosticSourceCounts(): ReefAskDiagnosticSummary["sourceCounts"] {
  return {
    fresh: 0,
    stale: 0,
    unknown: 0,
    failed: 0,
    unavailable: 0,
  };
}

function emptyOpenLoopCounts(): ReefAskDiagnosticSummary["openLoopCounts"] {
  return {
    total: 0,
    errors: 0,
    warnings: 0,
    infos: 0,
  };
}

function compileDiagnosticSummary(evidence: ReefQueryEvidenceBundle): ReefAskDiagnosticSummary | undefined {
  const verification = evidence.verification;
  const openLoops = evidence.openLoops;
  if (!verification && !openLoops) return undefined;

  const sourceCounts = emptyDiagnosticSourceCounts();
  for (const source of verification?.sources ?? []) {
    sourceCounts[source.status] += 1;
  }

  const openLoopCounts = openLoops?.summary ?? emptyOpenLoopCounts();
  const changedFileCount = verification?.changedFiles.length ?? 0;
  const refreshLoopCount = (openLoops?.loops ?? []).filter((loop) =>
    loop.kind === "stale_fact" ||
    loop.kind === "unknown_fact" ||
    loop.kind === "stale_diagnostic_run" ||
    loop.kind === "failed_diagnostic_run" ||
    loop.kind === "unverified_change"
  ).length;
  const blockerCount = openLoopCounts.errors +
    sourceCounts.failed +
    (verification?.status === "failed" ? 1 : 0);
  const needsRefreshCount = changedFileCount +
    sourceCounts.stale +
    sourceCounts.unknown +
    sourceCounts.unavailable +
    refreshLoopCount +
    (verification && verification.status !== "fresh" && verification.status !== "failed" ? 1 : 0);

  const gate: ReefAskDiagnosticSummary["gate"] = blockerCount > 0
    ? "blocked"
    : needsRefreshCount > 0
      ? "needs_refresh"
      : openLoopCounts.total > 0
        ? "review_required"
        : verification
          ? "clear"
          : "unknown";

  const suggestedActions = unique([
    ...(verification?.suggestedActions ?? []),
    ...(openLoops?.loops.flatMap((loop) => loop.suggestedActions) ?? []),
  ]);
  if (gate === "clear") {
    suggestedActions.push("No cached Reef diagnostic blockers were found; run project tests when runtime behavior changed.");
  }
  if (gate === "unknown") {
    suggestedActions.push("Run verification_state or diagnostic_refresh before claiming the work is verified.");
  }

  const sources = (verification?.sources ?? []).slice(0, ANSWER_DIAGNOSTIC_SOURCE_LIMIT).map((source) => ({
    source: source.source,
    status: source.status,
    reason: source.reason,
    ...(source.lastRun?.status ? { lastRunStatus: source.lastRun.status } : {}),
    ...(source.lastRun?.finishedAt ? { lastRunFinishedAt: source.lastRun.finishedAt } : {}),
    ...(source.lastRun?.findingCount !== undefined ? { findingCount: source.lastRun.findingCount } : {}),
    ...(source.lastRun?.persistedFindingCount !== undefined ? { persistedFindingCount: source.lastRun.persistedFindingCount } : {}),
    ...(source.lastRun?.checkedFileCount !== undefined ? { checkedFileCount: source.lastRun.checkedFileCount } : {}),
  }));
  const recentRuns = (verification?.recentRuns ?? []).slice(0, ANSWER_DIAGNOSTIC_RUN_LIMIT).map((run) => ({
    source: run.source,
    status: run.status,
    finishedAt: run.finishedAt,
    findingCount: run.findingCount,
    persistedFindingCount: run.persistedFindingCount,
    ...(run.checkedFileCount !== undefined ? { checkedFileCount: run.checkedFileCount } : {}),
  }));
  const changedFiles = (verification?.changedFiles ?? []).slice(0, ANSWER_DIAGNOSTIC_FILE_LIMIT).map((file) => ({
    filePath: file.filePath,
    lastModifiedAt: file.lastModifiedAt,
    staleForSources: file.staleForSources,
  }));
  const loopSummaries = (openLoops?.loops ?? []).slice(0, ANSWER_DIAGNOSTIC_LOOP_LIMIT).map((loop) => ({
    kind: loop.kind,
    severity: loop.severity,
    source: loop.source,
    title: loop.title,
    ...(loop.filePath ? { filePath: loop.filePath } : {}),
    reason: loop.reason,
  }));

  return {
    gate,
    canClaimVerified: gate === "clear",
    verificationStatus: verification?.status ?? "skipped",
    sourceCounts,
    openLoopCounts,
    changedFileCount,
    blockerCount,
    sources,
    recentRuns,
    changedFiles,
    openLoops: loopSummaries,
    suggestedActions: suggestedActions.slice(0, 10),
    truncated: (verification?.sources.length ?? 0) > ANSWER_DIAGNOSTIC_SOURCE_LIMIT ||
      (verification?.recentRuns.length ?? 0) > ANSWER_DIAGNOSTIC_RUN_LIMIT ||
      (verification?.changedFiles.length ?? 0) > ANSWER_DIAGNOSTIC_FILE_LIMIT ||
      (openLoops?.loops.length ?? 0) > ANSWER_DIAGNOSTIC_LOOP_LIMIT,
  };
}

function compileFindingsSummary(findings: ProjectFinding[]): ReefAskFindingsSummary | undefined {
  if (findings.length === 0) return undefined;
  const bySeverity: ReefAskFindingsSummary["bySeverity"] = {
    info: 0,
    warning: 0,
    error: 0,
  };
  const bySource: Record<string, number> = {};
  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    bySource[finding.source] = (bySource[finding.source] ?? 0) + 1;
  }
  const sorted = [...findings].sort((left, right) =>
    severityRank(right.severity) - severityRank(left.severity) ||
    (left.filePath ?? "").localeCompare(right.filePath ?? "") ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.message.localeCompare(right.message)
  );
  return {
    total: findings.length,
    bySeverity,
    bySource,
    staleCount: findings.filter((finding) => finding.freshness.state !== "fresh").length,
    items: sorted.slice(0, ANSWER_FINDING_ITEM_LIMIT).map((finding) => ({
      fingerprint: finding.fingerprint,
      source: finding.source,
      ...(finding.ruleId ? { ruleId: finding.ruleId } : {}),
      severity: finding.severity,
      status: finding.status,
      ...(finding.filePath ? { filePath: finding.filePath } : {}),
      ...(finding.line ? { line: finding.line } : {}),
      message: finding.message,
      freshness: finding.freshness,
    })),
    truncated: findings.length > ANSWER_FINDING_ITEM_LIMIT,
  };
}

function compileLiteralMatchesSummary(
  liveTextSearch: LiveTextSearchToolOutput | undefined,
): ReefAskLiteralMatchesSummary | undefined {
  if (!liveTextSearch) return undefined;
  const byFile = new Map<string, { matchCount: number; firstLine?: number }>();
  for (const match of liveTextSearch.matches) {
    const current = byFile.get(match.filePath) ?? { matchCount: 0 };
    current.matchCount += 1;
    current.firstLine = current.firstLine === undefined ? match.line : Math.min(current.firstLine, match.line);
    byFile.set(match.filePath, current);
  }
  const files = [...byFile.entries()]
    .map(([filePath, value]) => ({
      filePath,
      matchCount: value.matchCount,
      ...(value.firstLine ? { firstLine: value.firstLine } : {}),
    }))
    .sort((left, right) => right.matchCount - left.matchCount || left.filePath.localeCompare(right.filePath));
  return {
    query: liveTextSearch.query,
    totalMatches: liveTextSearch.matches.length,
    fileCount: liveTextSearch.filesMatched.length,
    files: files.slice(0, ANSWER_LITERAL_FILE_LIMIT),
    truncated: liveTextSearch.truncated || files.length > ANSWER_LITERAL_FILE_LIMIT,
  };
}

function emptyUsageKindCounts(): ReefAskWhereUsedSummary["byUsageKind"] {
  return {
    import: 0,
    dependent: 0,
    route_owner: 0,
    definition: 0,
    text_reference: 0,
  };
}

function compileWhereUsedSummary(whereUsed: ReefWhereUsedToolOutput | undefined): ReefAskWhereUsedSummary | undefined {
  if (!whereUsed) return undefined;
  const byUsageKind = emptyUsageKindCounts();
  for (const usage of whereUsed.usages) {
    byUsageKind[usage.usageKind] += 1;
  }
  return {
    query: whereUsed.query,
    ...(whereUsed.targetKind ? { targetKind: whereUsed.targetKind } : {}),
    definitionCount: whereUsed.definitions.length,
    usageCount: whereUsed.usages.length,
    relatedFindingCount: whereUsed.relatedFindings.length,
    byUsageKind,
    definitions: whereUsed.definitions.slice(0, ANSWER_WHERE_USED_DEFINITION_LIMIT).map((definition) => ({
      filePath: definition.filePath,
      name: definition.name,
      kind: definition.kind,
      ...(definition.lineStart ? { lineStart: definition.lineStart } : {}),
    })),
    usages: whereUsed.usages.slice(0, ANSWER_WHERE_USED_USAGE_LIMIT).map((usage) => ({
      filePath: usage.filePath,
      usageKind: usage.usageKind,
      ...(usage.targetPath ? { targetPath: usage.targetPath } : {}),
      ...(usage.line ? { line: usage.line } : {}),
      reason: usage.reason,
    })),
    truncated: whereUsed.definitions.length > ANSWER_WHERE_USED_DEFINITION_LIMIT ||
      whereUsed.usages.length > ANSWER_WHERE_USED_USAGE_LIMIT,
    ...(whereUsed.fallbackRecommendation ? { fallbackRecommendation: whereUsed.fallbackRecommendation } : {}),
  };
}

function compileNextQueries(args: {
  evidence: ReefQueryEvidenceBundle;
  facts: ProjectFact[];
  findings: ProjectFinding[];
}): ReefAskNextQuery[] {
  const next: ReefAskNextQuery[] = [];
  const noEvidence = args.evidence.context.primaryContext.length === 0 &&
    args.evidence.context.relatedContext.length === 0 &&
    args.facts.length === 0 &&
    args.findings.length === 0 &&
    (args.evidence.liveTextSearch?.matches.length ?? 0) === 0;
  if (noEvidence) {
    next.push({
      reason: "No deterministic evidence matched the current question.",
      question: `Broaden context for: ${args.evidence.context.request}`,
    });
  }
  if (args.evidence.liveTextSearch?.truncated) {
    next.push({
      reason: "The literal match lane was truncated.",
      question: `Narrow exact search for ${JSON.stringify(args.evidence.liveTextSearch.query)} to a file or directory scope.`,
    });
  }
  if (args.evidence.whereUsed?.fallbackRecommendation) {
    next.push({
      reason: "The where-used lane did not find maintained structural usage evidence.",
      question: args.evidence.whereUsed.fallbackRecommendation,
    });
  }
  if (args.evidence.databaseObjectQuery && (args.evidence.databaseObjectFacts?.length ?? 0) === 0) {
    next.push({
      reason: "The database object lane did not find materialized facts for the requested object.",
      question: `Refresh DB Reef facts and ask again for ${args.evidence.databaseObjectQuery.objectName}.`,
    });
  }
  if (args.facts.some((fact) => fact.freshness.state !== "fresh")) {
    next.push({
      reason: "Some materialized fact inventory evidence is stale or unknown.",
      question: "Refresh database Reef facts and rerun this inventory question.",
    });
  }
  if (args.findings.some((finding) => finding.freshness.state !== "fresh")) {
    next.push({
      reason: "Some durable finding evidence is stale or unknown.",
      question: "Refresh focused diagnostics for the files referenced by the stale findings.",
    });
  }
  if (args.evidence.context.indexFreshness?.state && args.evidence.context.indexFreshness.state !== "fresh") {
    next.push({
      reason: `Indexed code evidence is ${args.evidence.context.indexFreshness.state}.`,
      question: "Check project index freshness before trusting indexed line numbers.",
    });
  }
  return next.slice(0, 6);
}

function candidateLabel(candidate: ContextPacketResult["primaryContext"][number]): string {
  if (candidate.path) return candidate.path;
  if (candidate.routeKey) return candidate.routeKey;
  if (candidate.databaseObjectName) return candidate.databaseObjectName;
  if (candidate.symbolName) return candidate.symbolName;
  return candidate.id;
}

function buildSummary(args: {
  context: ContextPacketResult;
  openLoops?: ProjectOpenLoopsToolOutput;
  verification?: VerificationStateToolOutput;
  liveTextSearch?: LiveTextSearchToolOutput;
  reefFacts?: ProjectFactsToolOutput[];
  databaseObjectQuery?: ReefQueryEnginePlan["databaseObject"];
  databaseObjectFacts?: ProjectFact[];
  projectFindings?: ProjectFindingsToolOutput;
  whereUsed?: ReefWhereUsedToolOutput;
}, diagnosticSummary?: ReefAskDiagnosticSummary): string {
  const totalContext = args.context.primaryContext.length + args.context.relatedContext.length;
  const liveTextMatchCount = args.liveTextSearch?.matches.length ?? 0;
  const allFacts = [
    ...(args.reefFacts ?? []).flatMap((result) => result.facts),
    ...(args.databaseObjectFacts ?? []),
  ];
  const reefFactCount = allFacts.length;
  const durableFindingCount = args.projectFindings?.findings.length ?? 0;
  const whereUsedCount = args.whereUsed?.totalReturned ?? 0;
  if (totalContext === 0 && liveTextMatchCount === 0 && reefFactCount === 0 && durableFindingCount === 0 && whereUsedCount === 0) {
    return "Reef did not find deterministic project context for this question. Use the warnings and suggested actions to broaden the query or fall back to exact live search.";
  }

  const primary = args.context.primaryContext.slice(0, 5).map(candidateLabel);
  const parts = totalContext > 0
    ? [
        `Reef found ${args.context.primaryContext.length} primary and ${args.context.relatedContext.length} related context item(s).`,
        primary.length > 0
          ? `Primary anchors: ${primary.join(", ")}.`
          : "No primary anchors were selected; related context carried the indexed evidence.",
      ]
    : [
        reefFactCount > 0 || durableFindingCount > 0 || whereUsedCount > 0
          ? "Reef did not find indexed code context, but materialized fact evidence matched the question."
          : "Reef did not find indexed project context, but live text evidence matched current disk.",
      ];

  if (args.context.databaseObjects.length > 0) {
    parts.push(`Database evidence is present for ${args.context.databaseObjects.length} object(s).`);
  }
  if (args.databaseObjectQuery && (args.databaseObjectFacts?.length ?? 0) > 0) {
    const qualifiedName = args.databaseObjectQuery.schemaName
      ? `${args.databaseObjectQuery.schemaName}.${args.databaseObjectQuery.objectName}`
      : args.databaseObjectQuery.objectName;
    parts.push(`Database object detail returned ${args.databaseObjectFacts?.length ?? 0} materialized fact(s) for ${qualifiedName}.`);
  }
  if (args.context.activeFindings.length > 0) {
    parts.push(`${args.context.activeFindings.length} active finding(s) are attached to the selected context.`);
  }
  if (durableFindingCount > 0) {
    parts.push(`Durable Reef findings returned ${durableFindingCount} active item(s) for the project.`);
  }
  if (args.openLoops && args.openLoops.summary.total > 0) {
    parts.push(`${args.openLoops.summary.total} open loop(s) remain in the bounded Reef status view.`);
  }
  if (args.verification) {
    parts.push(`Diagnostic verification state is ${args.verification.status}.`);
  }
  if (diagnosticSummary) {
    parts.push(`Diagnostic gate is ${diagnosticSummary.gate}; verified claim is ${diagnosticSummary.canClaimVerified ? "allowed" : "not allowed"}.`);
  }
  if (args.liveTextSearch) {
    parts.push(
      `Live text search found ${args.liveTextSearch.matches.length} match(es) across ${args.liveTextSearch.filesMatched.length} file(s) for ${JSON.stringify(args.liveTextSearch.query)}.`,
    );
  }
  if (args.whereUsed) {
    parts.push(
      `Where-used evidence found ${args.whereUsed.definitions.length} definition(s), ${args.whereUsed.usages.length} usage(s), and ${args.whereUsed.relatedFindings.length} related finding(s) for ${JSON.stringify(args.whereUsed.query)}.`,
    );
  }
  if (reefFactCount > 0) {
    const byKind = new Map<string, number>();
    for (const fact of allFacts) {
      byKind.set(fact.kind, (byKind.get(fact.kind) ?? 0) + 1);
    }
    const kindSummary = [...byKind.entries()].map(([kind, count]) => `${count} ${kind}`).join(", ");
    parts.push(`Materialized Reef facts returned ${reefFactCount} item(s): ${kindSummary}.`);
  }

  return parts.join(" ");
}

export function scoreReefQueryConfidence(evidence: ReefQueryEvidenceBundle): ReefQueryConfidenceScore {
  const reasons: string[] = [];
  const codeFreshness = evidence.context.indexFreshness?.state ?? "unknown";
  let score = 0;

  if (evidence.context.primaryContext.length > 0) {
    score += 2;
    reasons.push("primary deterministic context was returned");
  } else if (evidence.context.relatedContext.length > 0) {
    score += 1;
    reasons.push("only related deterministic context was returned");
  } else {
    reasons.push("no deterministic context matched the question");
  }

  if (codeFreshness === "fresh") {
    score += 1;
    reasons.push("indexed code evidence is fresh");
  } else {
    score -= 1;
    reasons.push(`indexed code evidence is ${codeFreshness}`);
  }

  if (evidence.context.databaseObjects.length > 0) {
    score += 1;
    reasons.push("database objects were connected into the packet");
  }
  if (evidence.tableNeighborhood || evidence.rpcNeighborhood || evidence.routeContext) {
    score += 1;
    reasons.push("focused Reef neighborhood calculations matched the question");
  }

  const factCount = reefFacts(evidence).length;
  if (factCount > 0) {
    score += 2;
    reasons.push("materialized Reef facts matched the question");
  } else if ((evidence.reefFacts?.length ?? 0) > 0 || evidence.databaseObjectQuery) {
    reasons.push("materialized Reef fact queries returned no facts");
  }

  const findingCount = evidence.projectFindings?.findings.length ?? 0;
  if (findingCount > 0) {
    score += 2;
    reasons.push("durable project findings matched the question");
  } else if (evidence.projectFindings) {
    reasons.push("durable project findings query returned no findings");
  }

  if (evidence.whereUsed) {
    if (evidence.whereUsed.totalReturned > 0) {
      score += 2;
      reasons.push("where-used structural evidence matched the question");
    } else {
      reasons.push("where-used structural evidence returned no maintained matches");
    }
  }

  if (evidence.liveTextSearch) {
    if (evidence.liveTextSearch.matches.length > 0) {
      score += 2;
      reasons.push("live exact text evidence matched current disk");
    } else {
      reasons.push("live exact text evidence found no current-disk matches");
    }
    if (evidence.liveTextSearch.truncated) {
      score -= 1;
      reasons.push("live exact text evidence was truncated");
    }
  }

  if (evidence.verification?.status === "fresh") {
    score += 1;
    reasons.push("diagnostic verification is fresh");
  } else if (evidence.verification) {
    score -= 1;
    reasons.push(`diagnostic verification is ${evidence.verification.status}`);
  }

  if ((evidence.openLoops?.summary.errors ?? 0) > 0) {
    score -= 1;
    reasons.push("open-loop errors are present");
  }

  if (evidence.context.warnings.length > 0) {
    score -= 1;
    reasons.push("context warnings are present");
  }
  if ((evidence.liveTextSearch?.warnings.length ?? 0) > 0 || (evidence.liveTextSearchWarnings?.length ?? 0) > 0) {
    score -= 1;
    reasons.push("live text search warnings are present");
  }
  if ((evidence.reefFacts ?? []).some((result) => result.warnings.length > 0) ||
    (evidence.reefFactWarnings?.length ?? 0) > 0 ||
    (evidence.databaseObjectWarnings?.length ?? 0) > 0 ||
    (evidence.tableNeighborhood?.warnings.length ?? 0) > 0 ||
    (evidence.tableNeighborhoodWarnings?.length ?? 0) > 0 ||
    (evidence.rpcNeighborhood?.warnings.length ?? 0) > 0 ||
    (evidence.rpcNeighborhoodWarnings?.length ?? 0) > 0 ||
    (evidence.routeContext?.warnings.length ?? 0) > 0 ||
    (evidence.routeContextWarnings?.length ?? 0) > 0) {
    score -= 1;
    reasons.push("materialized Reef fact warnings are present");
  }
  if ((evidence.projectFindings?.warnings.length ?? 0) > 0 ||
    (evidence.projectFindingsWarnings?.length ?? 0) > 0) {
    score -= 1;
    reasons.push("durable project findings warnings are present");
  }
  if ((evidence.whereUsed?.warnings.length ?? 0) > 0 || (evidence.whereUsedWarnings?.length ?? 0) > 0) {
    score -= 1;
    reasons.push("where-used warnings are present");
  }

  if (score >= 4) return { confidence: "high", reasons };
  if (score >= 1) return { confidence: "medium", reasons };
  return { confidence: "low", reasons };
}

function suggestedActions(args: {
  context: ContextPacketResult;
  openLoops?: ProjectOpenLoopsToolOutput;
  verification?: VerificationStateToolOutput;
  liveTextSearch?: LiveTextSearchToolOutput;
  reefFacts?: ProjectFactsToolOutput[];
  databaseObjectQuery?: ReefQueryEnginePlan["databaseObject"];
  databaseObjectFacts?: ProjectFact[];
  projectFindings?: ProjectFindingsToolOutput;
  whereUsed?: ReefWhereUsedToolOutput;
}): string[] {
  const actions = [
    ...args.context.recommendedHarnessPattern.slice(0, 4),
    ...(args.verification?.suggestedActions ?? []),
    ...(args.openLoops?.loops.flatMap((loop) => loop.suggestedActions).slice(0, 6) ?? []),
  ];
  if (args.liveTextSearch?.truncated) {
    actions.push("Narrow the literal search scope before trusting the complete match inventory.");
  }
  if (args.liveTextSearch && args.liveTextSearch.matches.length === 0) {
    actions.push("Broaden the question beyond exact text if the term may be generated, aliased, or indexed structurally.");
  }
  if ((args.reefFacts ?? []).some((result) => result.facts.length === 0)) {
    actions.push("Refresh DB Reef facts if the inventory should exist but the materialized fact lane returned no rows.");
  }
  if (args.databaseObjectQuery && (args.databaseObjectFacts?.length ?? 0) === 0) {
    actions.push(`Refresh DB Reef facts if ${args.databaseObjectQuery.objectName} should have materialized schema evidence.`);
  }
  if (args.projectFindings && args.projectFindings.findings.length === 0) {
    actions.push("Run focused diagnostics or project findings refresh if durable findings should exist for this question.");
  }
  if (args.whereUsed?.fallbackRecommendation) {
    actions.push(args.whereUsed.fallbackRecommendation);
  }
  return unique(actions).slice(0, 10);
}

function neighborhoodSectionCount(section: { entries: readonly unknown[] } | undefined): number {
  return section?.entries.length ?? 0;
}

function tableNeighborhoodEvidenceCount(output: TableNeighborhoodToolOutput | undefined): number {
  if (!output) return 0;
  return (output.table ? 1 : 0) +
    (output.rls ? 1 : 0) +
    neighborhoodSectionCount(output.reads) +
    neighborhoodSectionCount(output.writes) +
    neighborhoodSectionCount(output.dependentRpcs) +
    neighborhoodSectionCount(output.dependentRoutes);
}

function rpcNeighborhoodEvidenceCount(output: RpcNeighborhoodToolOutput | undefined): number {
  if (!output) return 0;
  return (output.rpc ? 1 : 0) +
    neighborhoodSectionCount(output.callers) +
    neighborhoodSectionCount(output.tablesTouched) +
    neighborhoodSectionCount(output.rlsPolicies);
}

function routeContextEvidenceCount(output: RouteContextToolOutput | undefined): number {
  if (!output) return 0;
  return (output.resolvedRoute ? 1 : 0) +
    (output.handlerFile ? 1 : 0) +
    neighborhoodSectionCount(output.outboundImports) +
    neighborhoodSectionCount(output.inboundImports) +
    neighborhoodSectionCount(output.downstreamTables) +
    neighborhoodSectionCount(output.downstreamRpcs) +
    neighborhoodSectionCount(output.rlsPolicies);
}

function verificationEvidenceCount(output: VerificationStateToolOutput | undefined): number {
  return (output?.sources.length ?? 0) + (output?.changedFiles.length ?? 0);
}

function whereUsedEvidenceCount(output: ReefWhereUsedToolOutput | undefined): number {
  return (output?.definitions.length ?? 0) +
    (output?.usages.length ?? 0) +
    (output?.relatedFindings.length ?? 0);
}

function looksLikeImpactQuestion(question: string): boolean {
  return /\b(impact|what\s+breaks|break\s+if|change\s+impact|downstream|affected|dependents?)\b/i.test(question);
}

function engineSteps(args: {
  context: ContextPacketResult;
  indexedGraph?: ReefIndexedGraphEvidence;
  indexedGraphWarnings?: string[];
  conventionGraph?: ReefConventionGraphEvidence;
  conventionGraphWarnings?: string[];
  operationalGraph?: ReefOperationalGraphEvidence;
  operationalGraphWarnings?: string[];
  includeOpenLoops: boolean;
  openLoops?: ProjectOpenLoopsToolOutput;
  includeVerification: boolean;
  verification?: VerificationStateToolOutput;
  liveTextSearchPlan?: ReefQueryEnginePlan["liveTextSearch"];
  liveTextSearch?: LiveTextSearchToolOutput;
  liveTextSearchWarnings?: string[];
  reefFactQueries: ReefQueryEnginePlan["reefFactQueries"];
  reefFacts?: ProjectFactsToolOutput[];
  reefFactWarnings?: string[];
  databaseObjectPlan?: ReefQueryEnginePlan["databaseObject"];
  databaseObjectFacts?: ProjectFact[];
  databaseObjectWarnings?: string[];
  tableNeighborhoodPlan?: ReefQueryEnginePlan["tableNeighborhood"];
  tableNeighborhood?: TableNeighborhoodToolOutput;
  tableNeighborhoodWarnings?: string[];
  rpcNeighborhoodPlan?: ReefQueryEnginePlan["rpcNeighborhood"];
  rpcNeighborhood?: RpcNeighborhoodToolOutput;
  rpcNeighborhoodWarnings?: string[];
  routeContextPlan?: ReefQueryEnginePlan["routeContext"];
  routeContext?: RouteContextToolOutput;
  routeContextWarnings?: string[];
  projectFindingsPlan?: ReefQueryEnginePlan["projectFindings"];
  projectFindings?: ProjectFindingsToolOutput;
  projectFindingsWarnings?: string[];
  whereUsedPlan?: ReefQueryEnginePlan["whereUsed"];
  whereUsed?: ReefWhereUsedToolOutput;
  whereUsedWarnings?: string[];
}) {
  return [
    {
      name: "context_compile",
      status: "included" as const,
      reason: "Compiled ranked codebase, route, symbol, database, finding, risk, freshness, and instruction evidence.",
      returnedCount: args.context.primaryContext.length +
        args.context.relatedContext.length +
        args.context.databaseObjects.length +
        args.context.activeFindings.length +
        args.context.risks.length,
    },
    {
      name: "focused_indexed_graph",
      status: args.indexedGraph ? "included" as const : "skipped" as const,
      reason: args.indexedGraph
        ? "Enriched selected files and database objects with bounded indexed imports, exports, symbols, routes, and schema usage edges."
        : "Skipped because focused indexed graph enrichment was unavailable.",
      returnedCount: args.indexedGraph
        ? args.indexedGraph.files.length +
          args.indexedGraph.symbols.length +
          args.indexedGraph.imports.length +
          args.indexedGraph.routes.length +
          args.indexedGraph.schemaUsages.length
        : 0,
    },
    {
      name: "project_conventions",
      status: args.conventionGraph ? "included" as const : "skipped" as const,
      reason: args.conventionGraph
        ? "Enriched the evidence graph with focused project conventions and rule-derived convention candidates."
        : "Skipped because focused convention graph enrichment was unavailable.",
      returnedCount: args.conventionGraph?.conventions.length ?? 0,
    },
    {
      name: "reef_operations_graph",
      status: args.operationalGraph ? "included" as const : "skipped" as const,
      reason: args.operationalGraph
        ? "Enriched the evidence graph with recent diagnostic commands, test commands, sessions, and tool-run activity."
        : "Skipped because focused operational graph enrichment was unavailable.",
      returnedCount: (args.operationalGraph?.diagnosticRuns.length ?? 0) +
        (args.operationalGraph?.toolRuns.length ?? 0),
    },
    {
      name: "live_text_search",
      status: args.liveTextSearchPlan ? "included" as const : "skipped" as const,
      reason: args.liveTextSearchPlan
        ? `${args.liveTextSearchPlan.reason} Query: ${JSON.stringify(args.liveTextSearchPlan.query)}.`
        : "Skipped because the question did not look like a bounded literal current-disk lookup.",
      returnedCount: args.liveTextSearch?.matches.length ?? 0,
    },
    {
      name: "reef_fact_inventory",
      status: args.reefFactQueries.length > 0 ? "included" as const : "skipped" as const,
      reason: args.reefFactQueries.length > 0
        ? `Queried materialized Reef fact kind(s): ${args.reefFactQueries.map((query) => query.kind).join(", ")}.`
        : "Skipped because the question did not ask for a supported materialized fact inventory.",
      returnedCount: (args.reefFacts ?? []).reduce((sum, result) => sum + result.facts.length, 0),
    },
    {
      name: "reef_database_object",
      status: args.databaseObjectPlan ? "included" as const : "skipped" as const,
      reason: args.databaseObjectPlan
        ? `${args.databaseObjectPlan.reason} Object: ${JSON.stringify(args.databaseObjectPlan.schemaName ? `${args.databaseObjectPlan.schemaName}.${args.databaseObjectPlan.objectName}` : args.databaseObjectPlan.objectName)}.`
        : "Skipped because the question did not ask for detail about a specific database object.",
      returnedCount: args.databaseObjectFacts?.length ?? 0,
    },
    {
      name: "reef_table_neighborhood",
      status: args.tableNeighborhoodPlan ? "included" as const : "skipped" as const,
      reason: args.tableNeighborhoodPlan
        ? `${args.tableNeighborhoodPlan.reason} Table: ${JSON.stringify(args.tableNeighborhoodPlan.schemaName ? `${args.tableNeighborhoodPlan.schemaName}.${args.tableNeighborhoodPlan.tableName}` : args.tableNeighborhoodPlan.tableName)}.`
        : "Skipped because the question did not ask for detail about a specific table-like database object.",
      returnedCount: tableNeighborhoodEvidenceCount(args.tableNeighborhood),
    },
    {
      name: "reef_rpc_neighborhood",
      status: args.rpcNeighborhoodPlan ? "included" as const : "skipped" as const,
      reason: args.rpcNeighborhoodPlan
        ? `${args.rpcNeighborhoodPlan.reason} RPC: ${JSON.stringify(args.rpcNeighborhoodPlan.schemaName ? `${args.rpcNeighborhoodPlan.schemaName}.${args.rpcNeighborhoodPlan.rpcName}` : args.rpcNeighborhoodPlan.rpcName)}.`
        : "Skipped because the question did not ask for detail about a specific RPC/function object.",
      returnedCount: rpcNeighborhoodEvidenceCount(args.rpcNeighborhood),
    },
    {
      name: "reef_route_context",
      status: args.routeContextPlan ? "included" as const : "skipped" as const,
      reason: args.routeContextPlan
        ? `${args.routeContextPlan.reason} Route: ${JSON.stringify(args.routeContextPlan.route)}.`
        : "Skipped because the question did not name or focus a specific route.",
      returnedCount: routeContextEvidenceCount(args.routeContext),
    },
    {
      name: "project_findings",
      status: args.projectFindingsPlan ? "included" as const : "skipped" as const,
      reason: args.projectFindingsPlan
        ? args.projectFindingsPlan.reason
        : "Skipped because the question did not ask for durable finding, duplicate, drift, bypass, or audit evidence.",
      returnedCount: args.projectFindings?.findings.length ?? 0,
    },
    {
      name: "reef_where_used",
      status: args.whereUsedPlan ? "included" as const : "skipped" as const,
      reason: args.whereUsedPlan
        ? `${args.whereUsedPlan.reason} Query: ${JSON.stringify(args.whereUsedPlan.query)}.`
        : "Skipped because the question did not ask for usages, callers, dependents, references, or change impact.",
      returnedCount: args.whereUsed?.totalReturned ?? 0,
    },
    {
      name: "open_loops",
      status: args.includeOpenLoops ? "included" as const : "skipped" as const,
      reason: args.includeOpenLoops
        ? "Included bounded unresolved finding, stale fact, and failed diagnostic state."
        : "Skipped because includeOpenLoops=false.",
      returnedCount: args.openLoops?.summary.total ?? 0,
    },
    {
      name: "verification_state",
      status: args.includeVerification ? "included" as const : "skipped" as const,
      reason: args.includeVerification
        ? "Included cached diagnostic coverage and changed-file verification state."
        : "Skipped because includeVerification=false.",
      returnedCount: (args.verification?.sources.length ?? 0) +
        (args.verification?.changedFiles.length ?? 0),
    },
  ];
}

function engineStepsForPlan(plan: ReefQueryEnginePlan, evidence: ReefQueryEvidenceBundle) {
  return engineSteps({
    context: evidence.context,
    indexedGraph: evidence.indexedGraph,
    indexedGraphWarnings: evidence.indexedGraphWarnings,
    conventionGraph: evidence.conventionGraph,
    conventionGraphWarnings: evidence.conventionGraphWarnings,
    operationalGraph: evidence.operationalGraph,
    operationalGraphWarnings: evidence.operationalGraphWarnings,
    includeOpenLoops: plan.includeOpenLoops,
    openLoops: evidence.openLoops,
    includeVerification: plan.includeVerification,
    verification: evidence.verification,
    liveTextSearchPlan: plan.liveTextSearch,
    liveTextSearch: evidence.liveTextSearch,
    liveTextSearchWarnings: evidence.liveTextSearchWarnings,
    reefFactQueries: plan.reefFactQueries,
    reefFacts: evidence.reefFacts,
    reefFactWarnings: evidence.reefFactWarnings,
    databaseObjectPlan: plan.databaseObject,
    databaseObjectFacts: evidence.databaseObjectFacts,
    databaseObjectWarnings: evidence.databaseObjectWarnings,
    tableNeighborhoodPlan: plan.tableNeighborhood,
    tableNeighborhood: evidence.tableNeighborhood,
    tableNeighborhoodWarnings: evidence.tableNeighborhoodWarnings,
    rpcNeighborhoodPlan: plan.rpcNeighborhood,
    rpcNeighborhood: evidence.rpcNeighborhood,
    rpcNeighborhoodWarnings: evidence.rpcNeighborhoodWarnings,
    routeContextPlan: plan.routeContext,
    routeContext: evidence.routeContext,
    routeContextWarnings: evidence.routeContextWarnings,
    projectFindingsPlan: plan.projectFindings,
    projectFindings: evidence.projectFindings,
    projectFindingsWarnings: evidence.projectFindingsWarnings,
    whereUsedPlan: plan.whereUsed,
    whereUsed: evidence.whereUsed,
    whereUsedWarnings: evidence.whereUsedWarnings,
  });
}

function fallbackForDecisionLane(args: {
  lane: string;
  status: "included" | "skipped";
  evidenceCount: number;
  evidence: ReefQueryEvidenceBundle;
}): string | undefined {
  switch (args.lane) {
    case "context_compile":
      return args.evidenceCount === 0
        ? "Broaden the question or pass focusFiles, focusRoutes, focusSymbols, or focusDatabaseObjects to anchor the context packet."
        : undefined;
    case "live_text_search":
      if (args.status === "skipped") {
        return "Ask with a quoted literal for a bounded exact current-disk lookup, or use live_text_search/shell rg for regex and custom globs.";
      }
      return args.evidence.liveTextSearch?.truncated
        ? "Narrow the literal search by file or directory scope before treating the match set as complete."
        : args.evidenceCount === 0
          ? "If the term may be generated, aliased, or structural, use context or AST search rather than exact text."
          : undefined;
    case "reef_fact_inventory":
      return args.status === "skipped"
        ? "Ask for a supported inventory such as RPCs, tables, views, or RLS policies to use the materialized fact inventory lane."
        : args.evidenceCount === 0
          ? "Refresh DB Reef facts if this inventory should exist, then rerun the question."
          : undefined;
    case "reef_database_object":
      return args.status === "skipped"
        ? "Ask about one specific database object, for example public.users columns or RLS policies, or pass focusDatabaseObjects."
        : args.evidenceCount === 0
          ? "Refresh DB Reef facts or use live DB schema tools when a named object should have schema evidence."
          : undefined;
    case "reef_table_neighborhood":
      return args.status === "skipped"
        ? "Ask about a specific table or pass focusDatabaseObjects to calculate table schema, usage, route, RPC, and RLS neighborhood evidence."
        : args.evidenceCount === 0
          ? "Refresh schema and usage indexes when a named table should have neighborhood evidence."
          : undefined;
    case "reef_rpc_neighborhood":
      return args.status === "skipped"
        ? "Ask about a specific RPC/function or pass focusDatabaseObjects to calculate callers, touched tables, and RLS evidence."
        : args.evidenceCount === 0
          ? "Refresh schema and usage indexes when a named RPC should have neighborhood evidence."
          : undefined;
    case "reef_route_context":
      return args.status === "skipped"
        ? "Ask with a concrete route such as GET /api/users or pass focusRoutes to calculate handler and downstream context."
        : args.evidenceCount === 0
          ? "Refresh the route and import indexes when a named route should have handler context."
          : undefined;
    case "project_findings":
      return args.status === "skipped"
        ? "Ask for findings, risks, duplicates, drift, bypasses, audit evidence, or known issues to query durable project findings."
        : args.evidenceCount === 0
          ? "Run focused diagnostics if durable findings should exist for this question."
          : undefined;
    case "reef_where_used":
      return args.status === "skipped"
        ? "Ask a usage, caller, reference, dependent, or impact question with a concrete symbol, file, route, or component."
        : args.evidence.whereUsed?.fallbackRecommendation ??
          (args.evidenceCount === 0 ? "Use live_text_search or ast_find_pattern if maintained structural usage evidence is absent." : undefined);
    case "open_loops":
      return args.status === "skipped"
        ? "Set includeOpenLoops=true when unresolved findings, stale facts, or failed diagnostic state should affect the answer."
        : args.evidence.openLoops && args.evidence.openLoops.summary.total > 0
          ? "Resolve, acknowledge, or refresh the returned open loops before claiming the project state is clean."
          : undefined;
    case "verification_state":
      return args.status === "skipped"
        ? "Set includeVerification=true when diagnostic freshness should gate the answer."
        : args.evidence.verification && args.evidence.verification.status !== "fresh"
          ? "Run diagnostic_refresh for stale, failed, unknown, or unavailable sources before claiming verification."
          : undefined;
    default:
      return undefined;
  }
}

function uniqueNextQueries(values: ReefAskNextQuery[]): ReefAskNextQuery[] {
  const seen = new Set<string>();
  const out: ReefAskNextQuery[] = [];
  for (const value of values) {
    const key = `${value.reason}\0${value.question}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function plannedCalculation(args: {
  nodeId: string;
  queryKind: string;
  lane: string;
  included: boolean;
  includedReason: string;
  skippedReason: string;
  returnedCount: number;
}): ReefAskPlannedCalculation {
  return {
    nodeId: args.nodeId,
    queryKind: args.queryKind,
    lane: args.lane,
    status: args.included ? "included" : "skipped",
    reason: args.included ? args.includedReason : args.skippedReason,
    returnedCount: args.included ? args.returnedCount : 0,
  };
}

function plannedCalculationsForPlan(
  plan: ReefQueryEnginePlan,
  evidence: ReefQueryEvidenceBundle,
): ReefAskPlannedCalculation[] {
  const impactRequested = Boolean(plan.whereUsed && looksLikeImpactQuestion(plan.contextInput.request));
  return [
    plannedCalculation({
      nodeId: REEF_WHERE_USED_NODE.id,
      queryKind: REEF_WHERE_USED_QUERY_KIND,
      lane: "usage",
      included: Boolean(plan.whereUsed),
      includedReason: plan.whereUsed
        ? `${plan.whereUsed.reason} Query: ${JSON.stringify(plan.whereUsed.query)}.`
        : "",
      skippedReason: "Skipped because the question did not ask for usages, callers, dependents, references, or change impact.",
      returnedCount: whereUsedEvidenceCount(evidence.whereUsed),
    }),
    plannedCalculation({
      nodeId: REEF_IMPACT_NODE.id,
      queryKind: REEF_IMPACT_QUERY_KIND,
      lane: "usage",
      included: false,
      includedReason: "",
      skippedReason: impactRequested
        ? "The question has impact/downstream intent, but reef_ask only includes maintained where-used evidence; call reef_diff_impact for changed-file impact calculation."
        : "Skipped because the question did not ask for downstream impact or affected dependents.",
      returnedCount: 0,
    }),
    plannedCalculation({
      nodeId: REEF_TABLE_NEIGHBORHOOD_NODE.id,
      queryKind: REEF_TABLE_NEIGHBORHOOD_QUERY_KIND,
      lane: "database",
      included: Boolean(plan.tableNeighborhood),
      includedReason: plan.tableNeighborhood
        ? `${plan.tableNeighborhood.reason} Table: ${JSON.stringify(plan.tableNeighborhood.schemaName ? `${plan.tableNeighborhood.schemaName}.${plan.tableNeighborhood.tableName}` : plan.tableNeighborhood.tableName)}.`
        : "",
      skippedReason: "Skipped because the question did not ask for detail about a specific table-like database object.",
      returnedCount: tableNeighborhoodEvidenceCount(evidence.tableNeighborhood),
    }),
    plannedCalculation({
      nodeId: REEF_RPC_NEIGHBORHOOD_NODE.id,
      queryKind: REEF_RPC_NEIGHBORHOOD_QUERY_KIND,
      lane: "database",
      included: Boolean(plan.rpcNeighborhood),
      includedReason: plan.rpcNeighborhood
        ? `${plan.rpcNeighborhood.reason} RPC: ${JSON.stringify(plan.rpcNeighborhood.schemaName ? `${plan.rpcNeighborhood.schemaName}.${plan.rpcNeighborhood.rpcName}` : plan.rpcNeighborhood.rpcName)}.`
        : "",
      skippedReason: "Skipped because the question did not ask for detail about a specific RPC/function object.",
      returnedCount: rpcNeighborhoodEvidenceCount(evidence.rpcNeighborhood),
    }),
    plannedCalculation({
      nodeId: REEF_ROUTE_CONTEXT_NODE.id,
      queryKind: REEF_ROUTE_CONTEXT_QUERY_KIND,
      lane: "routes",
      included: Boolean(plan.routeContext),
      includedReason: plan.routeContext
        ? `${plan.routeContext.reason} Route: ${JSON.stringify(plan.routeContext.route)}.`
        : "",
      skippedReason: "Skipped because the question did not name or focus a specific route.",
      returnedCount: routeContextEvidenceCount(evidence.routeContext),
    }),
    plannedCalculation({
      nodeId: REEF_DIAGNOSTIC_COVERAGE_NODE.id,
      queryKind: REEF_DIAGNOSTIC_COVERAGE_QUERY_KIND,
      lane: "diagnostics",
      included: plan.includeVerification,
      includedReason: "The planner included diagnostic coverage to gate whether the answer can claim verification.",
      skippedReason: "Skipped because includeVerification=false.",
      returnedCount: verificationEvidenceCount(evidence.verification),
    }),
    plannedCalculation({
      nodeId: REEF_ACTIVE_FINDING_STATUS_NODE.id,
      queryKind: REEF_ACTIVE_FINDING_STATUS_QUERY_KIND,
      lane: "findings",
      included: Boolean(plan.projectFindings),
      includedReason: plan.projectFindings
        ? "The question asks for durable findings, so Reef calculated active finding status grouped by severity, source, rule, and file."
        : "",
      skippedReason: "Skipped because the question did not ask for durable finding, risk, audit, duplicate, drift, or bypass status.",
      returnedCount: evidence.activeFindingStatus?.totalActive ?? 0,
    }),
    plannedCalculation({
      nodeId: REEF_DUPLICATE_CANDIDATES_NODE.id,
      queryKind: REEF_DUPLICATE_CANDIDATES_QUERY_KIND,
      lane: "findings",
      included: Boolean(plan.duplicateCandidates),
      includedReason: plan.duplicateCandidates
        ? plan.duplicateCandidates.reason
        : "",
      skippedReason: "Skipped because the question did not ask for duplicate, near-twin, clone, copy-paste, or drift evidence.",
      returnedCount: evidence.duplicateCandidates?.candidates.length ?? 0,
    }),
  ];
}

function compileDecisionTrace(args: {
  plan: ReefQueryEnginePlan;
  evidence: ReefQueryEvidenceBundle;
  confidence: ReefAskConfidence;
  nextQueries: ReefAskNextQuery[];
}): ReefAskDecisionTrace {
  const calculations = plannedCalculationsForPlan(args.plan, args.evidence);
  const entries = engineStepsForPlan(args.plan, args.evidence).map((step) => {
    const fallback = fallbackForDecisionLane({
      lane: step.name,
      status: step.status,
      evidenceCount: step.returnedCount,
      evidence: args.evidence,
    });
    return {
      lane: step.name,
      status: step.status,
      reason: step.reason,
      evidenceCount: step.returnedCount,
      ...(fallback ? { fallback } : {}),
    };
  });
  const lowConfidenceFallbacks = args.confidence === "low"
    ? uniqueNextQueries([
        ...args.nextQueries,
        ...entries
          .filter((entry) => entry.fallback)
          .map((entry) => ({
            reason: `${entry.lane} fallback`,
            question: entry.fallback as string,
          })),
      ]).slice(0, 6)
    : [];

  return {
    entries,
    calculations,
    lowConfidenceFallbacks,
  };
}

function databaseFreshness(args: {
  context: ContextPacketResult;
  openLoops?: ProjectOpenLoopsToolOutput;
  facts?: ProjectFact[];
}): string {
  const dbLoop = args.openLoops?.loops.find((loop) => {
    const freshnessState = loop.metadata?.freshnessState;
    return loop.source === "db_reef_refresh" ||
      (typeof freshnessState === "string" && loop.id.includes("db_reef_refresh"));
  });
  if (dbLoop) return dbLoop.kind === "stale_fact" ? "stale" : "unknown";
  if ((args.facts ?? []).some((fact) => fact.kind.startsWith("db_"))) return "materialized";
  return args.context.databaseObjects.length > 0 ? "indexed" : "not_requested";
}

function evidenceCap(plan: ReefQueryEnginePlan): number | undefined {
  return plan.evidenceMode === "full" ? undefined : plan.maxEvidenceItemsPerSection;
}

function capEvidenceArray<T>(
  sections: ReefCompiledQuery["evidence"]["sections"],
  name: string,
  items: readonly T[],
  limit: number | undefined,
): T[] {
  const returnedItems = limit === undefined ? [...items] : items.slice(0, limit);
  sections[name] = {
    returned: returnedItems.length,
    total: items.length,
    truncated: returnedItems.length < items.length,
  };
  return returnedItems;
}

function capNeighborhoodSection<T>(
  sections: ReefCompiledQuery["evidence"]["sections"],
  name: string,
  section: NeighborhoodSection<T>,
  limit: number | undefined,
): NeighborhoodSection<T> {
  const entries = limit === undefined ? [...section.entries] : section.entries.slice(0, limit);
  const truncated = section.truncated || entries.length < section.entries.length || entries.length < section.totalCount;
  sections[name] = {
    returned: entries.length,
    total: section.totalCount,
    truncated,
  };
  return {
    entries,
    truncated,
    totalCount: section.totalCount,
  };
}

function anyEvidenceSectionTruncated(sections: ReefCompiledQuery["evidence"]["sections"]): boolean {
  return Object.values(sections).some((section) => section.truncated);
}

function buildReefAskEvidenceOutput(args: {
  plan: ReefQueryEnginePlan;
  context: ContextPacketResult;
  indexedGraph?: ReefIndexedGraphEvidence;
  conventionGraph?: ReefConventionGraphEvidence;
  operationalGraph?: ReefOperationalGraphEvidence;
  openLoops?: ProjectOpenLoopsToolOutput;
  verification?: VerificationStateToolOutput;
  liveTextSearch?: LiveTextSearchToolOutput;
  facts: ProjectFact[];
  findings: ProjectFinding[];
  tableNeighborhood?: TableNeighborhoodToolOutput;
  rpcNeighborhood?: RpcNeighborhoodToolOutput;
  routeContext?: RouteContextToolOutput;
  whereUsed?: ReefWhereUsedToolOutput;
  revision?: number;
}): ReefCompiledQuery["evidence"] {
  const limit = evidenceCap(args.plan);
  const sections: ReefCompiledQuery["evidence"]["sections"] = {};
  const primaryContext = capEvidenceArray(sections, "primaryContext", args.context.primaryContext, limit);
  const relatedContext = capEvidenceArray(sections, "relatedContext", args.context.relatedContext, limit);
  const symbols = capEvidenceArray(sections, "symbols", args.context.symbols, limit);
  const routes = capEvidenceArray(sections, "routes", args.context.routes, limit);
  const databaseObjects = capEvidenceArray(sections, "databaseObjects", args.context.databaseObjects, limit);
  const findings = capEvidenceArray(sections, "findings", args.findings, limit);
  const risks = capEvidenceArray(sections, "risks", args.context.risks, limit);
  const instructions = capEvidenceArray(sections, "instructions", args.context.scopedInstructions, limit);
  const openLoops = capEvidenceArray(sections, "openLoops", args.openLoops?.loops ?? [], limit);
  const facts = capEvidenceArray(sections, "facts", args.facts, limit);
  const tableNeighborhood = args.tableNeighborhood
    ? {
        ...args.tableNeighborhood,
        reads: capNeighborhoodSection(sections, "tableNeighborhood.reads", args.tableNeighborhood.reads, limit),
        writes: capNeighborhoodSection(sections, "tableNeighborhood.writes", args.tableNeighborhood.writes, limit),
        dependentRpcs: capNeighborhoodSection(
          sections,
          "tableNeighborhood.dependentRpcs",
          args.tableNeighborhood.dependentRpcs,
          limit,
        ),
        dependentRoutes: capNeighborhoodSection(
          sections,
          "tableNeighborhood.dependentRoutes",
          args.tableNeighborhood.dependentRoutes,
          limit,
        ),
        evidenceRefs: capEvidenceArray(sections, "tableNeighborhood.evidenceRefs", args.tableNeighborhood.evidenceRefs, limit),
      }
    : undefined;
  const rpcNeighborhood = args.rpcNeighborhood
    ? {
        ...args.rpcNeighborhood,
        callers: capNeighborhoodSection(sections, "rpcNeighborhood.callers", args.rpcNeighborhood.callers, limit),
        tablesTouched: capNeighborhoodSection(
          sections,
          "rpcNeighborhood.tablesTouched",
          args.rpcNeighborhood.tablesTouched,
          limit,
        ),
        rlsPolicies: capNeighborhoodSection(sections, "rpcNeighborhood.rlsPolicies", args.rpcNeighborhood.rlsPolicies, limit),
        evidenceRefs: capEvidenceArray(sections, "rpcNeighborhood.evidenceRefs", args.rpcNeighborhood.evidenceRefs, limit),
      }
    : undefined;
  const routeContext = args.routeContext
    ? {
        ...args.routeContext,
        outboundImports: capNeighborhoodSection(sections, "routeContext.outboundImports", args.routeContext.outboundImports, limit),
        inboundImports: capNeighborhoodSection(sections, "routeContext.inboundImports", args.routeContext.inboundImports, limit),
        downstreamTables: capNeighborhoodSection(sections, "routeContext.downstreamTables", args.routeContext.downstreamTables, limit),
        downstreamRpcs: capNeighborhoodSection(sections, "routeContext.downstreamRpcs", args.routeContext.downstreamRpcs, limit),
        rlsPolicies: capNeighborhoodSection(sections, "routeContext.rlsPolicies", args.routeContext.rlsPolicies, limit),
        evidenceRefs: capEvidenceArray(sections, "routeContext.evidenceRefs", args.routeContext.evidenceRefs, limit),
      }
    : undefined;
  const verificationSources = capEvidenceArray(sections, "verification.sources", args.verification?.sources ?? [], limit);
  const verificationChangedFiles = capEvidenceArray(
    sections,
    "verification.changedFiles",
    args.verification?.changedFiles ?? [],
    limit,
  );
  const verificationSuggestedActions = capEvidenceArray(
    sections,
    "verification.suggestedActions",
    args.verification?.suggestedActions ?? [],
    limit,
  );

  const whereUsed = args.whereUsed
    ? {
        query: args.whereUsed.query,
        ...(args.whereUsed.targetKind ? { targetKind: args.whereUsed.targetKind } : {}),
        definitions: capEvidenceArray(sections, "whereUsed.definitions", args.whereUsed.definitions, limit),
        usages: capEvidenceArray(sections, "whereUsed.usages", args.whereUsed.usages, limit),
        relatedFindings: capEvidenceArray(sections, "whereUsed.relatedFindings", args.whereUsed.relatedFindings, limit),
        coverage: args.whereUsed.coverage,
        ...(args.whereUsed.fallbackRecommendation ? { fallbackRecommendation: args.whereUsed.fallbackRecommendation } : {}),
        warnings: args.whereUsed.warnings,
      }
    : undefined;
  const liveTextSearch = args.liveTextSearch
    ? {
        query: args.liveTextSearch.query,
        matches: capEvidenceArray(sections, "liveTextSearch.matches", args.liveTextSearch.matches, limit),
        filesMatched: capEvidenceArray(sections, "liveTextSearch.filesMatched", args.liveTextSearch.filesMatched, limit),
        truncated: args.liveTextSearch.truncated ||
          (sections["liveTextSearch.matches"]?.truncated ?? false) ||
          (sections["liveTextSearch.filesMatched"]?.truncated ?? false),
        warnings: args.liveTextSearch.warnings,
      }
    : undefined;
  const verification = args.verification
    ? {
        status: args.verification.status,
        sources: verificationSources,
        changedFiles: verificationChangedFiles,
        suggestedActions: verificationSuggestedActions,
      }
    : {
        status: "unknown" as const,
        sources: [],
        changedFiles: [],
        suggestedActions: [],
      };
  const graph = buildReefEvidenceGraph({
    ...(args.revision !== undefined ? { revision: args.revision } : {}),
    primaryContext: args.context.primaryContext,
    relatedContext: args.context.relatedContext,
    symbols: args.context.symbols,
    routes: args.context.routes,
    databaseObjects: args.context.databaseObjects,
    findings: args.findings,
    risks: args.context.risks,
    instructions: args.context.scopedInstructions,
    openLoops: args.openLoops?.loops ?? [],
    facts: args.facts,
    ...(args.indexedGraph ? { indexedGraph: args.indexedGraph } : {}),
    ...(args.conventionGraph ? { conventionGraph: args.conventionGraph } : {}),
    ...(args.operationalGraph ? { operationalGraph: args.operationalGraph } : {}),
    ...(args.whereUsed
      ? {
          whereUsed: {
            query: args.whereUsed.query,
            ...(args.whereUsed.targetKind ? { targetKind: args.whereUsed.targetKind } : {}),
            definitions: args.whereUsed.definitions,
            usages: args.whereUsed.usages,
            relatedFindings: args.whereUsed.relatedFindings,
          },
        }
      : {}),
    ...(args.liveTextSearch
      ? {
          liveTextSearch: {
            query: args.liveTextSearch.query,
            matches: args.liveTextSearch.matches,
            filesMatched: args.liveTextSearch.filesMatched,
          },
        }
      : {}),
    verification: {
      status: args.verification?.status ?? "unknown",
      sources: args.verification?.sources ?? [],
      changedFiles: args.verification?.changedFiles ?? [],
      suggestedActions: args.verification?.suggestedActions ?? [],
    },
    ...(limit !== undefined ? { nodeLimit: limit, edgeLimit: limit } : {}),
  });
  sections["graph.nodes"] = {
    returned: graph.truncated.returnedNodes,
    total: graph.truncated.totalNodes,
    truncated: graph.truncated.nodes,
  };
  sections["graph.edges"] = {
    returned: graph.truncated.returnedEdges,
    total: graph.truncated.totalEdges,
    truncated: graph.truncated.edges,
  };

  return {
    mode: args.plan.evidenceMode,
    sections,
    primaryContext,
    relatedContext,
    symbols,
    routes,
    databaseObjects,
    findings,
    risks,
    instructions,
    openLoops,
    facts,
    graph,
    ...(tableNeighborhood ? { tableNeighborhood } : {}),
    ...(rpcNeighborhood ? { rpcNeighborhood } : {}),
    ...(routeContext ? { routeContext } : {}),
    ...(whereUsed ? { whereUsed } : {}),
    ...(liveTextSearch ? { liveTextSearch } : {}),
    verification,
  };
}

export function planReefQuery(input: ReefAskToolInput): ReefQueryEnginePlan {
  const mode = input.mode ?? inferMode(input.question);
  const includeOpenLoops = input.includeOpenLoops ?? true;
  const includeVerification = input.includeVerification ?? true;
  const maxOpenLoops = input.maxOpenLoops ?? DEFAULT_MAX_OPEN_LOOPS;
  const maxPrimaryContext = input.maxPrimaryContext ?? DEFAULT_MAX_PRIMARY_CONTEXT;
  const maxRelatedContext = input.maxRelatedContext ?? DEFAULT_MAX_RELATED_CONTEXT;
  const budgetTokens = input.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const evidenceMode = input.evidenceMode ?? DEFAULT_EVIDENCE_MODE;
  const maxEvidenceItemsPerSection = input.maxEvidenceItemsPerSection ?? DEFAULT_MAX_EVIDENCE_ITEMS_PER_SECTION;
  const liveTextSearch = inferLiveTextSearch(input.question);
  const reefFactQueries = inferReefFactQueries(input.question);
  const projectFindings = inferProjectFindings(input.question);
  const databaseObject = inferDatabaseObject(input);
  const whereUsed = inferWhereUsed(input);
  const tableNeighborhood = inferTableNeighborhood(input, databaseObject);
  const rpcNeighborhood = inferRpcNeighborhood(input, databaseObject);
  const routeContext = inferRouteContext(input);
  const duplicateCandidates = inferDuplicateCandidates(input.question);

  return {
    mode,
    includeOpenLoops,
    includeVerification,
    maxOpenLoops,
    maxPrimaryContext,
    maxRelatedContext,
    budgetTokens,
    evidenceMode,
    maxEvidenceItemsPerSection,
    contextInput: {
      ...locator(input),
      request: input.question,
      mode: contextMode(mode),
      ...(input.focusFiles ? { focusFiles: input.focusFiles } : {}),
      ...(input.changedFiles ? { changedFiles: input.changedFiles } : {}),
      ...(input.focusRoutes ? { focusRoutes: input.focusRoutes } : {}),
      ...(input.focusSymbols ? { focusSymbols: input.focusSymbols } : {}),
      ...(input.focusDatabaseObjects ? { focusDatabaseObjects: input.focusDatabaseObjects } : {}),
      includeInstructions: input.includeInstructions ?? true,
      includeRisks: input.includeRisks ?? true,
      includeLiveHints: true,
      freshnessPolicy: input.freshnessPolicy ?? "prefer_fresh",
      budgetTokens,
      maxPrimaryContext,
      maxRelatedContext,
      risksMinConfidence: input.risksMinConfidence ?? 0.6,
    },
    verificationFiles: verificationFiles(input),
    ...(liveTextSearch ? { liveTextSearch } : {}),
    reefFactQueries,
    ...(projectFindings ? { projectFindings } : {}),
    ...(databaseObject ? { databaseObject } : {}),
    ...(tableNeighborhood ? { tableNeighborhood } : {}),
    ...(rpcNeighborhood ? { rpcNeighborhood } : {}),
    ...(routeContext ? { routeContext } : {}),
    ...(whereUsed ? { whereUsed } : {}),
    ...(duplicateCandidates ? { duplicateCandidates } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function factDatabaseObjectName(fact: ProjectFact): string | undefined {
  return jsonString(fact.data?.tableName) ??
    jsonString(fact.data?.objectName) ??
    jsonString(fact.data?.viewName) ??
    (fact.subject.kind === "schema_object" ? fact.subject.objectName.split(".")[0] : undefined);
}

function factMatchesDatabaseObject(fact: ProjectFact, query: ReefQueryEnginePlan["databaseObject"]): boolean {
  if (!query) return false;
  const objectName = factDatabaseObjectName(fact);
  if (objectName !== query.objectName) return false;
  if (!query.schemaName) return true;
  return factSchemaName(fact) === query.schemaName;
}

async function collectDatabaseObjectEvidence(
  query: ReefQueryEnginePlan["databaseObject"],
  locatorInput: ProjectLocatorInput,
  options: ToolServiceOptions,
): Promise<DatabaseObjectEvidenceResult> {
  if (!query) return {};
  return await withProjectContext(locatorInput, options, ({ project, projectStore }) => {
    const byFingerprint = new Map<string, ProjectFact>();
    const warnings: string[] = [];
    for (const kind of DATABASE_OBJECT_FACT_KINDS) {
      const facts = projectStore.queryReefFacts({
        projectId: project.projectId,
        kind,
        limit: query.limit,
      });
      if (facts.length >= query.limit) {
        warnings.push(`Scanned the first ${query.limit} ${kind} fact(s) while looking for ${query.objectName}; results may be incomplete.`);
      }
      for (const fact of facts) {
        if (factMatchesDatabaseObject(fact, query)) {
          byFingerprint.set(fact.fingerprint, fact);
        }
      }
    }
    const databaseObjectFacts = [...byFingerprint.values()].sort((left, right) =>
      left.kind.localeCompare(right.kind) ||
      factDisplayName(left).localeCompare(factDisplayName(right))
    );
    return {
      databaseObjectQuery: query,
      databaseObjectFacts,
      ...(warnings.length > 0 ? { databaseObjectWarnings: warnings } : {}),
    };
  });
}

async function collectNeighborhoodEvidence(
  plan: ReefQueryEnginePlan,
  locatorInput: ProjectLocatorInput,
  options: ToolServiceOptions,
): Promise<NeighborhoodEvidenceResult> {
  const tablePlan = plan.tableNeighborhood;
  const rpcPlan = plan.rpcNeighborhood;
  const routePlan = plan.routeContext;

  const tablePromise: Promise<NeighborhoodEvidenceResult> | undefined = tablePlan
    ? tableNeighborhoodTool({
        ...locatorInput,
        tableName: tablePlan.tableName,
        ...(tablePlan.schemaName ? { schemaName: tablePlan.schemaName } : {}),
        maxPerSection: tablePlan.maxPerSection,
      }, options)
        .then((tableNeighborhood) => ({ tableNeighborhood }))
        .catch((error: unknown) => ({
          tableNeighborhoodWarnings: [
            `table neighborhood calculation failed for ${JSON.stringify(tablePlan.tableName)}: ${errorMessage(error)}`,
          ],
        }))
    : undefined;

  const rpcPromise: Promise<NeighborhoodEvidenceResult> | undefined = rpcPlan
    ? rpcNeighborhoodTool({
        ...locatorInput,
        rpcName: rpcPlan.rpcName,
        ...(rpcPlan.schemaName ? { schemaName: rpcPlan.schemaName } : {}),
        ...(rpcPlan.argTypes ? { argTypes: rpcPlan.argTypes } : {}),
        maxPerSection: rpcPlan.maxPerSection,
      }, options)
        .then((rpcNeighborhood) => ({ rpcNeighborhood }))
        .catch((error: unknown) => ({
          rpcNeighborhoodWarnings: [
            `rpc neighborhood calculation failed for ${JSON.stringify(rpcPlan.rpcName)}: ${errorMessage(error)}`,
          ],
        }))
    : undefined;

  const routePromise: Promise<NeighborhoodEvidenceResult> | undefined = routePlan
    ? routeContextTool({
        ...locatorInput,
        route: routePlan.route,
        maxPerSection: routePlan.maxPerSection,
      }, options)
        .then((routeContext) => ({ routeContext }))
        .catch((error: unknown) => ({
          routeContextWarnings: [
            `route context calculation failed for ${JSON.stringify(routePlan.route)}: ${errorMessage(error)}`,
          ],
        }))
    : undefined;

  const [tableResult, rpcResult, routeResult] = await Promise.all([
    tablePromise,
    rpcPromise,
    routePromise,
  ]);

  return {
    ...(tableResult?.tableNeighborhood ? { tableNeighborhood: tableResult.tableNeighborhood } : {}),
    ...(tableResult?.tableNeighborhoodWarnings?.length
      ? { tableNeighborhoodWarnings: tableResult.tableNeighborhoodWarnings }
      : {}),
    ...(rpcResult?.rpcNeighborhood ? { rpcNeighborhood: rpcResult.rpcNeighborhood } : {}),
    ...(rpcResult?.rpcNeighborhoodWarnings?.length
      ? { rpcNeighborhoodWarnings: rpcResult.rpcNeighborhoodWarnings }
      : {}),
    ...(routeResult?.routeContext ? { routeContext: routeResult.routeContext } : {}),
    ...(routeResult?.routeContextWarnings?.length
      ? { routeContextWarnings: routeResult.routeContextWarnings }
      : {}),
  };
}

async function collectFindingCalculationEvidence(
  plan: ReefQueryEnginePlan,
  locatorInput: ProjectLocatorInput,
  options: ToolServiceOptions,
): Promise<FindingCalculationEvidenceResult> {
  if (!plan.projectFindings && !plan.duplicateCandidates) return {};
  return await withProjectContext(locatorInput, options, ({ project, projectStore }) => {
    const result: FindingCalculationEvidenceResult = {};
    if (plan.projectFindings) {
      result.activeFindingStatus = calculateActiveFindingStatus({
        projectStore,
        projectId: project.projectId,
        limit: ACTIVE_FINDING_STATUS_LIMIT,
      });
    }
    if (plan.duplicateCandidates) {
      result.duplicateCandidates = calculateDuplicateCandidates({
        projectStore,
        projectId: project.projectId,
        limit: plan.duplicateCandidates.limit,
      });
    }
    return result;
  }).catch((error: unknown) => ({
    statusCalculationWarnings: [
      `finding status calculations failed: ${errorMessage(error)}`,
    ],
  }));
}

export async function collectReefQueryEvidence(
  plan: ReefQueryEnginePlan,
  options: ToolServiceOptions,
): Promise<ReefQueryEvidenceBundle> {
  const context = await contextPacketTool(plan.contextInput, options);

  const projectLocator = { projectId: context.projectId };
  const focusedGraphFiles = focusedIndexedGraphFiles(context, plan);
  const focusedGraphDatabaseObjects = focusedIndexedGraphDatabaseObjects(context, plan);
  const indexedGraphPromise: Promise<IndexedGraphEvidenceResult> = withProjectContext(
    projectLocator,
    options,
    ({ project, projectStore }) => ({
      indexedGraph: collectFocusedIndexedGraphEvidence({
        projectStore,
        projectId: project.projectId,
        root: project.canonicalPath,
        focusFiles: focusedGraphFiles,
        focusDatabaseObjects: focusedGraphDatabaseObjects,
        freshness: indexedGraphFreshness(context),
      }),
    }),
  ).catch((error: unknown) => ({
    indexedGraphWarnings: [
      `focused indexed graph enrichment failed: ${errorMessage(error)}`,
    ],
  }));
  const conventionGraphPromise: Promise<ConventionGraphEvidenceResult> = withProjectContext(
    projectLocator,
    options,
    ({ project, projectStore }) => ({
      conventionGraph: collectFocusedConventionGraphEvidence({
        projectStore,
        projectId: project.projectId,
        focusFiles: focusedGraphFiles,
        freshness: indexedGraphFreshness(context),
      }),
    }),
  ).catch((error: unknown) => ({
    conventionGraphWarnings: [
      `focused convention graph enrichment failed: ${errorMessage(error)}`,
    ],
  }));
  const operationalGraphPromise: Promise<OperationalGraphEvidenceResult> = withProjectContext(
    projectLocator,
    options,
    ({ project, projectStore }) => ({
      operationalGraph: collectFocusedOperationalGraphEvidence({
        projectStore,
        projectId: project.projectId,
        focusFiles: focusedGraphFiles,
        freshness: indexedGraphFreshness(context),
      }),
    }),
  ).catch((error: unknown) => ({
    operationalGraphWarnings: [
      `focused operational graph enrichment failed: ${errorMessage(error)}`,
    ],
  }));
  const openLoopsPromise = plan.includeOpenLoops
    ? projectOpenLoopsTool({
        ...projectLocator,
        limit: plan.maxOpenLoops,
      }, options)
    : undefined;
  const verificationPromise = plan.includeVerification
    ? verificationStateTool({
        ...projectLocator,
        ...(plan.verificationFiles.length > 0 ? { files: plan.verificationFiles } : {}),
        limit: 50,
      }, options)
    : undefined;
  const liveTextSearchPromise: Promise<LiveTextSearchEvidenceResult> | undefined = plan.liveTextSearch
    ? liveTextSearchTool({
        ...projectLocator,
        query: plan.liveTextSearch.query,
        fixedStrings: true,
        maxMatches: LIVE_TEXT_MAX_MATCHES,
        maxFiles: LIVE_TEXT_MAX_FILES,
      }, options)
        .then((liveTextSearch) => ({ liveTextSearch }))
        .catch((error: unknown) => ({
          liveTextSearchWarnings: [
            `live_text_search failed for planned literal query ${JSON.stringify(plan.liveTextSearch?.query)}: ${errorMessage(error)}`,
          ],
        }))
    : undefined;
  const reefFactsPromise: Promise<ReefFactEvidenceResult> | undefined = plan.reefFactQueries.length > 0
    ? Promise.all(plan.reefFactQueries.map((query) =>
        projectFactsTool({
          ...projectLocator,
          kind: query.kind,
          freshnessPolicy: "allow_stale_labeled",
          limit: query.limit,
        }, options)
          .then((result) => ({ result }))
          .catch((error: unknown) => ({
            warning: `project_facts failed for planned fact kind ${JSON.stringify(query.kind)}: ${errorMessage(error)}`,
          }))
      )).then((results) => ({
        reefFacts: results.flatMap((result) => "result" in result ? [result.result] : []),
        reefFactWarnings: results.flatMap((result) => "warning" in result ? [result.warning] : []),
      }))
    : undefined;
  const projectFindingsPromise: Promise<ProjectFindingsEvidenceResult> | undefined = plan.projectFindings
    ? projectFindingsTool({
        ...projectLocator,
        status: "active",
        includeResolved: false,
        freshnessPolicy: "allow_stale_labeled",
        limit: plan.projectFindings.limit,
      }, options)
        .then((projectFindings) => ({ projectFindings }))
        .catch((error: unknown) => ({
          projectFindingsWarnings: [
            `project_findings failed for planned durable findings query: ${errorMessage(error)}`,
          ],
        }))
    : undefined;
  const databaseObjectPlan = plan.databaseObject;
  const databaseObjectPromise: Promise<DatabaseObjectEvidenceResult> | undefined = databaseObjectPlan
    ? collectDatabaseObjectEvidence(databaseObjectPlan, projectLocator, options)
        .catch((error: unknown) => ({
          databaseObjectQuery: databaseObjectPlan,
          databaseObjectWarnings: [
            `reef database object fact lookup failed for ${JSON.stringify(databaseObjectPlan.objectName)}: ${errorMessage(error)}`,
          ],
        }))
    : undefined;
  const neighborhoodPromise: Promise<NeighborhoodEvidenceResult> | undefined =
    plan.tableNeighborhood || plan.rpcNeighborhood || plan.routeContext
      ? collectNeighborhoodEvidence(plan, projectLocator, options)
      : undefined;
  const whereUsedPromise: Promise<WhereUsedEvidenceResult> | undefined = plan.whereUsed
    ? reefWhereUsedTool({
        ...projectLocator,
        query: plan.whereUsed.query,
        ...(plan.whereUsed.targetKind ? { targetKind: plan.whereUsed.targetKind } : {}),
        freshnessPolicy: "allow_stale_labeled",
        limit: plan.whereUsed.limit,
      }, options)
        .then((whereUsed) => ({ whereUsed }))
        .catch((error: unknown) => ({
          whereUsedWarnings: [
            `reef_where_used failed for planned usage query ${JSON.stringify(plan.whereUsed?.query)}: ${errorMessage(error)}`,
          ],
        }))
    : undefined;
  const findingCalculationPromise: Promise<FindingCalculationEvidenceResult> | undefined =
    plan.projectFindings || plan.duplicateCandidates
      ? collectFindingCalculationEvidence(plan, projectLocator, options)
      : undefined;

  const [
    indexedGraphResult,
    conventionGraphResult,
    operationalGraphResult,
    openLoops,
    verification,
    liveTextSearchResult,
    reefFactResult,
    projectFindingsResult,
    databaseObjectResult,
    neighborhoodResult,
    whereUsedResult,
    findingCalculationResult,
  ] = await Promise.all([
    indexedGraphPromise,
    conventionGraphPromise,
    operationalGraphPromise,
    openLoopsPromise,
    verificationPromise,
    liveTextSearchPromise,
    reefFactsPromise,
    projectFindingsPromise,
    databaseObjectPromise,
    neighborhoodPromise,
    whereUsedPromise,
    findingCalculationPromise,
  ]);

  return {
    context,
    ...(indexedGraphResult.indexedGraph ? { indexedGraph: indexedGraphResult.indexedGraph } : {}),
    ...(indexedGraphResult.indexedGraphWarnings?.length
      ? { indexedGraphWarnings: indexedGraphResult.indexedGraphWarnings }
      : {}),
    ...(conventionGraphResult.conventionGraph ? { conventionGraph: conventionGraphResult.conventionGraph } : {}),
    ...(conventionGraphResult.conventionGraphWarnings?.length
      ? { conventionGraphWarnings: conventionGraphResult.conventionGraphWarnings }
      : {}),
    ...(operationalGraphResult.operationalGraph ? { operationalGraph: operationalGraphResult.operationalGraph } : {}),
    ...(operationalGraphResult.operationalGraphWarnings?.length
      ? { operationalGraphWarnings: operationalGraphResult.operationalGraphWarnings }
      : {}),
    ...(openLoops ? { openLoops } : {}),
    ...(verification ? { verification } : {}),
    ...(liveTextSearchResult?.liveTextSearch ? { liveTextSearch: liveTextSearchResult.liveTextSearch } : {}),
    ...(liveTextSearchResult?.liveTextSearchWarnings
      ? { liveTextSearchWarnings: liveTextSearchResult.liveTextSearchWarnings }
      : {}),
    ...(reefFactResult?.reefFacts ? { reefFacts: reefFactResult.reefFacts } : {}),
    ...(reefFactResult?.reefFactWarnings?.length
      ? { reefFactWarnings: reefFactResult.reefFactWarnings }
      : {}),
    ...(projectFindingsResult?.projectFindings ? { projectFindings: projectFindingsResult.projectFindings } : {}),
    ...(projectFindingsResult?.projectFindingsWarnings
      ? { projectFindingsWarnings: projectFindingsResult.projectFindingsWarnings }
      : {}),
    ...(databaseObjectResult?.databaseObjectQuery
      ? { databaseObjectQuery: databaseObjectResult.databaseObjectQuery }
      : {}),
    ...(databaseObjectResult?.databaseObjectFacts
      ? { databaseObjectFacts: databaseObjectResult.databaseObjectFacts }
      : {}),
    ...(databaseObjectResult?.databaseObjectWarnings
      ? { databaseObjectWarnings: databaseObjectResult.databaseObjectWarnings }
      : {}),
    ...(neighborhoodResult?.tableNeighborhood ? { tableNeighborhood: neighborhoodResult.tableNeighborhood } : {}),
    ...(neighborhoodResult?.tableNeighborhoodWarnings
      ? { tableNeighborhoodWarnings: neighborhoodResult.tableNeighborhoodWarnings }
      : {}),
    ...(neighborhoodResult?.rpcNeighborhood ? { rpcNeighborhood: neighborhoodResult.rpcNeighborhood } : {}),
    ...(neighborhoodResult?.rpcNeighborhoodWarnings
      ? { rpcNeighborhoodWarnings: neighborhoodResult.rpcNeighborhoodWarnings }
      : {}),
    ...(neighborhoodResult?.routeContext ? { routeContext: neighborhoodResult.routeContext } : {}),
    ...(neighborhoodResult?.routeContextWarnings
      ? { routeContextWarnings: neighborhoodResult.routeContextWarnings }
      : {}),
    ...(whereUsedResult?.whereUsed ? { whereUsed: whereUsedResult.whereUsed } : {}),
    ...(whereUsedResult?.whereUsedWarnings
      ? { whereUsedWarnings: whereUsedResult.whereUsedWarnings }
      : {}),
    ...(findingCalculationResult?.activeFindingStatus
      ? { activeFindingStatus: findingCalculationResult.activeFindingStatus }
      : {}),
    ...(findingCalculationResult?.duplicateCandidates
      ? { duplicateCandidates: findingCalculationResult.duplicateCandidates }
      : {}),
    ...(findingCalculationResult?.statusCalculationWarnings
      ? { statusCalculationWarnings: findingCalculationResult.statusCalculationWarnings }
      : {}),
  };
}

export function compileReefQueryAnswer(
  evidence: ReefQueryEvidenceBundle,
  plan: ReefQueryEnginePlan,
): ReefCompiledQuery["answer"] {
  const confidenceResult = scoreReefQueryConfidence(evidence);
  const facts = reefFacts(evidence);
  const findings = mergedFindings(evidence);
  const inventorySummary = compileInventorySummary(facts);
  const databaseObjectSummary = compileDatabaseObjectSummary(facts, evidence.databaseObjectQuery);
  const diagnosticSummary = compileDiagnosticSummary(evidence);
  const findingsSummary = compileFindingsSummary(findings);
  const literalMatchesSummary = compileLiteralMatchesSummary(evidence.liveTextSearch);
  const whereUsedSummary = compileWhereUsedSummary(evidence.whereUsed);
  const nextQueries = compileNextQueries({ evidence, facts, findings });
  const decisionTrace = compileDecisionTrace({
    plan,
    evidence,
    confidence: confidenceResult.confidence,
    nextQueries,
  });
  return {
    summary: buildSummary(evidence, diagnosticSummary),
    confidence: confidenceResult.confidence,
    confidenceReasons: confidenceResult.reasons,
    ...(inventorySummary ? { inventorySummary } : {}),
    ...(databaseObjectSummary ? { databaseObjectSummary } : {}),
    ...(diagnosticSummary ? { diagnosticSummary } : {}),
    ...(findingsSummary ? { findingsSummary } : {}),
    ...(literalMatchesSummary ? { literalMatchesSummary } : {}),
    ...(whereUsedSummary ? { whereUsedSummary } : {}),
    decisionTrace,
    nextQueries,
    suggestedNextActions: suggestedActions(evidence),
  };
}

function evidenceWarnings(evidence: ReefQueryEvidenceBundle): string[] {
  return [
    ...evidence.context.warnings,
    ...(evidence.indexedGraphWarnings ?? []),
    ...(evidence.conventionGraphWarnings ?? []),
    ...(evidence.operationalGraphWarnings ?? []),
    ...(evidence.openLoops?.warnings ?? []),
    ...(evidence.verification?.warnings ?? []),
    ...(evidence.liveTextSearch?.warnings ?? []),
    ...(evidence.liveTextSearchWarnings ?? []),
    ...(evidence.reefFacts?.flatMap((result) => result.warnings) ?? []),
    ...(evidence.reefFactWarnings ?? []),
    ...(evidence.databaseObjectWarnings ?? []),
    ...(evidence.tableNeighborhood?.warnings ?? []),
    ...(evidence.tableNeighborhoodWarnings ?? []),
    ...(evidence.rpcNeighborhood?.warnings ?? []),
    ...(evidence.rpcNeighborhoodWarnings ?? []),
    ...(evidence.routeContext?.warnings ?? []),
    ...(evidence.routeContextWarnings ?? []),
    ...(evidence.projectFindings?.warnings ?? []),
    ...(evidence.projectFindingsWarnings ?? []),
    ...(evidence.whereUsed?.warnings ?? []),
    ...(evidence.whereUsedWarnings ?? []),
    ...(evidence.duplicateCandidates?.warnings ?? []),
    ...(evidence.statusCalculationWarnings ?? []),
  ];
}

function staleEvidenceLabeled(evidence: ReefQueryEvidenceBundle): number {
  return evidence.context.primaryContext.filter((candidate) =>
    candidate.freshness && candidate.freshness.state !== "fresh"
  ).length +
    evidence.context.relatedContext.filter((candidate) =>
      candidate.freshness && candidate.freshness.state !== "fresh"
    ).length +
    (evidence.verification?.sources.filter((source) => source.status !== "fresh").length ?? 0) +
    reefFacts(evidence).filter((fact) => fact.freshness.state !== "fresh").length +
    (evidence.projectFindings?.findings.filter((finding) => finding.freshness.state !== "fresh").length ?? 0) +
    (evidence.whereUsed?.relatedFindings.filter((finding) => finding.freshness.state !== "fresh").length ?? 0) +
    (evidence.openLoops?.loops.filter((loop) =>
      loop.kind === "stale_fact" ||
      loop.kind === "unknown_fact" ||
      loop.kind === "stale_diagnostic_run"
    ).length ?? 0);
}

function returnedEvidenceCount(evidence: ReefQueryEvidenceBundle): number {
  const indexedGraphCount = evidence.indexedGraph
    ? evidence.indexedGraph.files.length +
      evidence.indexedGraph.symbols.length +
      evidence.indexedGraph.imports.length +
      evidence.indexedGraph.routes.length +
      evidence.indexedGraph.schemaUsages.length
    : 0;
  const conventionGraphCount = evidence.conventionGraph?.conventions.length ?? 0;
  const operationalGraphCount = (evidence.operationalGraph?.diagnosticRuns.length ?? 0) +
    (evidence.operationalGraph?.toolRuns.length ?? 0);
  return evidence.context.primaryContext.length +
    evidence.context.relatedContext.length +
    evidence.context.databaseObjects.length +
    indexedGraphCount +
    conventionGraphCount +
    operationalGraphCount +
    mergedFindings(evidence).length +
    evidence.context.risks.length +
    (evidence.liveTextSearch?.matches.length ?? 0) +
    reefFacts(evidence).length +
    (evidence.openLoops?.summary.total ?? 0) +
    (evidence.verification?.sources.length ?? 0) +
    (evidence.verification?.changedFiles.length ?? 0) +
    tableNeighborhoodEvidenceCount(evidence.tableNeighborhood) +
    rpcNeighborhoodEvidenceCount(evidence.rpcNeighborhood) +
    routeContextEvidenceCount(evidence.routeContext) +
    (evidence.whereUsed?.definitions.length ?? 0) +
    (evidence.whereUsed?.usages.length ?? 0) +
    (evidence.whereUsed?.relatedFindings.length ?? 0) +
    (evidence.activeFindingStatus?.totalActive ?? 0) +
    (evidence.duplicateCandidates?.candidates.length ?? 0);
}

async function buildReefQueryExecution(args: {
  evidence: ReefQueryEvidenceBundle;
  options: ToolServiceOptions;
  startedAtMs: number;
  compileOptions: CompileReefQueryOptions;
}) {
  return buildReefToolExecution({
    toolName: args.compileOptions.executionToolName ?? "reef_query_engine",
    projectId: args.evidence.context.projectId,
    projectRoot: args.evidence.context.projectRoot,
    options: args.options,
    startedAtMs: args.startedAtMs,
    freshnessPolicy: "allow_stale_labeled",
    queryPath: "reef_materialized_view",
    staleEvidenceLabeled: staleEvidenceLabeled(args.evidence),
    returnedCount: returnedEvidenceCount(args.evidence),
  });
}

export async function compileReefQuery(
  input: ReefAskToolInput,
  options: ToolServiceOptions,
  compileOptions: CompileReefQueryOptions = {},
): Promise<ReefCompiledQuery> {
  const startedAtMs = Date.now();
  const plan = planReefQuery(input);
  const evidence = await collectReefQueryEvidence(plan, options);
  const answer = compileReefQueryAnswer(evidence, plan);
  const reefExecution = await buildReefQueryExecution({
    evidence,
    options,
    startedAtMs,
    compileOptions,
  });
  const warnings = [...evidenceWarnings(evidence)];

  const {
    context,
    indexedGraph,
    conventionGraph,
    operationalGraph,
    openLoops,
    verification,
    liveTextSearch,
    reefFacts: reefFactOutputs,
    databaseObjectFacts,
    tableNeighborhood,
    rpcNeighborhood,
    routeContext,
    projectFindings,
    whereUsed,
  } = evidence;
  const materializedFacts = reefFacts(evidence);
  const durableFindings = mergedFindings(evidence);
  const graphRevision = reefExecution.snapshot.revision ?? reefExecution.snapshot.materializedRevision;
  const outputEvidence = buildReefAskEvidenceOutput({
    plan,
    context,
    indexedGraph,
    conventionGraph,
    operationalGraph,
    openLoops,
    verification,
    liveTextSearch,
    facts: materializedFacts,
    findings: durableFindings,
    tableNeighborhood,
    rpcNeighborhood,
    routeContext,
    whereUsed,
    ...(graphRevision !== undefined ? { revision: graphRevision } : {}),
  });
  warnings.push(...outputEvidence.graph.warnings);
  if (anyEvidenceSectionTruncated(outputEvidence.sections)) {
    warnings.push(
      `reef_ask evidence payload compacted with maxEvidenceItemsPerSection=${plan.maxEvidenceItemsPerSection}; set evidenceMode="full" for uncapped raw evidence.`,
    );
  }

  return {
    projectId: context.projectId,
    projectRoot: context.projectRoot,
    question: input.question,
    answer,
    queryPlan: {
      mode: plan.mode,
      intent: context.intent,
      evidenceLanes: evidenceLanes({
        context,
        indexedGraph,
        indexedGraphWarnings: evidence.indexedGraphWarnings,
        conventionGraph,
        conventionGraphWarnings: evidence.conventionGraphWarnings,
        operationalGraph,
        operationalGraphWarnings: evidence.operationalGraphWarnings,
        openLoops,
        verification,
        liveTextSearch,
        liveTextSearchWarnings: evidence.liveTextSearchWarnings,
        reefFacts: reefFactOutputs,
        reefFactWarnings: evidence.reefFactWarnings,
        databaseObjectFacts,
        databaseObjectWarnings: evidence.databaseObjectWarnings,
        tableNeighborhood,
        tableNeighborhoodWarnings: evidence.tableNeighborhoodWarnings,
        rpcNeighborhood,
        rpcNeighborhoodWarnings: evidence.rpcNeighborhoodWarnings,
        routeContext,
        routeContextWarnings: evidence.routeContextWarnings,
        projectFindings,
        projectFindingsWarnings: evidence.projectFindingsWarnings,
        activeFindingStatus: evidence.activeFindingStatus,
        duplicateCandidates: evidence.duplicateCandidates,
        statusCalculationWarnings: evidence.statusCalculationWarnings,
        whereUsed,
        whereUsedWarnings: evidence.whereUsedWarnings,
      }),
      graphSummary: graphSummary(outputEvidence.graph),
      assumptions: [
        "Reef query engine v0 compiles maintained Reef/context evidence into a normalized evidence graph; it does not execute live diagnostics or mutate project state.",
        plan.liveTextSearch
          ? "The planner detected a bounded literal lookup and checked current disk through the internal live_text_search lane."
          : "Exact current-disk text is checked internally only when the question looks like a bounded literal lookup.",
        plan.reefFactQueries.length > 0
          ? "The planner detected a supported inventory question and queried materialized Reef facts directly."
          : "Materialized Reef fact inventory is queried internally only for supported inventory-style questions.",
        plan.databaseObject
          ? "The planner detected a specific database object question and queried materialized schema/RLS facts directly."
          : "Database object detail is queried internally only for specific table, column, RLS, index, FK, trigger, or schema questions.",
        plan.tableNeighborhood || plan.rpcNeighborhood || plan.routeContext
          ? "The planner selected cached Reef calculation nodes for focused neighborhood context."
          : "Focused neighborhood calculations are selected internally only for specific table, RPC, or route questions.",
        plan.projectFindings
          ? "The planner detected a durable-findings question and queried project findings directly."
          : "Durable project findings are queried internally only for finding, risk, audit, duplicate, drift, or bypass questions.",
        conventionGraph
          ? "Focused project conventions and rule-derived convention candidates were compiled into the normalized evidence graph."
          : "Project conventions are graph-enriched internally when focused convention evidence is available.",
        operationalGraph
          ? "Recent diagnostic commands, test commands, sessions, and tool runs were compiled into the normalized evidence graph."
          : "Recent operational activity is graph-enriched internally when focused session or diagnostic evidence is available.",
        plan.whereUsed
          ? "The planner detected a usage/impact question and queried maintained where-used evidence directly."
          : "Where-used evidence is queried internally only for usage, caller, dependent, reference, or impact questions.",
      ],
      engineSteps: engineStepsForPlan(plan, evidence),
      calculations: plannedCalculationsForPlan(plan, evidence),
    },
    evidence: outputEvidence,
    freshness: {
      code: context.indexFreshness?.state ?? "unknown",
      database: databaseFreshness({ context, openLoops, facts: materializedFacts }),
      diagnostics: verification?.status ?? "skipped",
    },
    reefExecution,
    limits: {
      budgetTokens: plan.budgetTokens,
      maxPrimaryContext: plan.maxPrimaryContext,
      maxRelatedContext: plan.maxRelatedContext,
      maxOpenLoops: plan.maxOpenLoops,
      evidenceMode: plan.evidenceMode,
      maxEvidenceItemsPerSection: plan.maxEvidenceItemsPerSection,
    },
    warnings,
  };
}
