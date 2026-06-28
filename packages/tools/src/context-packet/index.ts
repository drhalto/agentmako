import { randomUUID } from "node:crypto";
import { TOOL_BATCH_TOOL_NAMES } from "@mako-ai/contracts";
import type {
  ContextPacketDatabaseObject,
  ContextPacketEvidenceQuality,
  ContextPacketExpandableTool,
  ContextPacketGraphSummary,
  ContextPacketIntent,
  ContextPacketLiveTextMiss,
  ContextPacketProviderRunDetail,
  ContextPacketReadableCandidate,
  ContextPacketRequestCoverage,
  ContextPacketRetrievalDiagnostics,
  ContextPacketRoute,
  ContextPacketSymbol,
  ContextPacketToolInput,
  ContextPacketToolOutput,
  IndexFreshnessDetail,
  JsonObject,
  LiveTextSearchMatch,
  ProjectFact,
  ProjectFinding,
  ToolBatchToolName,
} from "@mako-ai/contracts";
import { assessFileFreshness, summarizeIndexFreshnessDetails } from "@mako-ai/indexer";
import type { ProjectStore } from "@mako-ai/store";
import { getDefaultHotIndexCache } from "../hot-index/index.js";
import { runRipgrepSearch } from "../live-text-search/index.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { ensureProjectFresh } from "../freshness/index.js";
import { detectContextPacketIntent } from "./intent.js";
import { buildRecommendedHarnessPattern } from "./harness-patterns.js";
import { assessContextPacketEvidenceQuality } from "./evidence-quality.js";
import { buildContextPacketGraphSummary } from "./graph-summary.js";
import { buildContextPacketRequestCoverage, type LiveTextCheckedQuery } from "./request-coverage.js";
import { buildExpandableTool } from "./expandable-tools-catalog.js";
import {
  CONTEXT_PACKET_PROVIDER_NAMES,
  contextPacketModePolicySummary,
  providerEnabled,
  resolveContextPacketModePolicy,
  type ContextPacketProviderName,
  type ContextPacketModePolicy,
} from "./modes.js";
import { collectContextPacketProviders } from "./providers.js";
import { rankContextCandidates, type RankedOmittedRequestedAnchor } from "./ranking.js";
import { detectContextPacketRisks } from "./risks.js";
import { buildContextPacketRetrievalDiagnostics } from "./retrieval-diagnostics.js";
import { loadScopedInstructions } from "./scoped-instructions.js";
import type { ContextPacketCandidateSeed } from "./types.js";
import { isReefBackedToolViewEnabled } from "../reef/migration-flags.js";
import { buildReefToolExecution } from "../reef/tool-execution.js";
import { getToolOperationalMetadata } from "../tool-operational-metadata.js";

const DEFAULT_MAX_PRIMARY_CONTEXT = 8;
const DEFAULT_MAX_RELATED_CONTEXT = 16;
const DEFAULT_BUDGET_TOKENS = 2400;
const REEF_OVERLAY_FACT_QUERY_LIMIT = 10_000;
const ACTIVE_FINDINGS_PER_CONTEXT_FILE_LIMIT = 1000;
const LIVE_TEXT_QUERY_LIMIT = 3;
const LIVE_TEXT_MAX_MATCHES = 20;
const LIVE_TEXT_MAX_FILES = 10;
const LIVE_TEXT_SCOPE_LIMIT = 20;
const LIVE_TEXT_MAX_CONCURRENT_SEARCHES = 4;
const COVERAGE_EXPANDABLE_TOOL_LIMIT = 6;
const BATCHED_EXPANDABLE_TOOL_LIMIT = 4;
const BATCHED_EXPANDABLE_TOOL_INSERT_AFTER = 4;
const BROAD_GRAPH_REQUEST_PATTERN =
  /\b(dependency|dependencies|dependent|dependents|imports?|imported|importing|callers?|call[- ]?sites?|downstream|upstream|impact|where used|references?|graph)\b|import graph/i;

interface ProviderSkipReason {
  reason: string;
  adaptive: boolean;
}

interface LiveTextProviderResult {
  candidates: ContextPacketCandidateSeed[];
  misses: ContextPacketLiveTextMiss[];
  checkedQueries: LiveTextCheckedQuery[];
  warnings: string[];
  truncated: boolean;
  ran: boolean;
}

type LiveTextQueryKind = "quoted_text" | "symbol";

interface LiveTextQuery {
  query: string;
  kind: LiveTextQueryKind;
}

interface LiveTextSearchJob {
  query: string;
  kind: LiveTextQueryKind;
  scopePath: string | undefined;
}

interface LiveTextSearchJobResult {
  job: LiveTextSearchJob;
  result: Awaited<ReturnType<typeof runRipgrepSearch>>;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeLoose(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRouteAnchor(value: string): string {
  return normalizeLoose(value)
    .replace(/^nextjs:/, "")
    .replace(/^(get|post|put|patch|delete|options|head):/, "$1 ")
    .replace(/\s+/g, " ");
}

function normalizeDatabaseObjectAnchor(value: string): string {
  return normalizeLoose(value).replace(/["'`]/g, "");
}

function freshnessDetailsForCandidates(
  projectRoot: string,
  filesByPath: Map<string, ReturnType<import("@mako-ai/store").ProjectStore["listFiles"]>[number]>,
  candidates: readonly ContextPacketCandidateSeed[],
): Map<string, IndexFreshnessDetail> {
  const details = new Map<string, IndexFreshnessDetail>();
  for (const candidate of candidates) {
    if (!candidate.path || details.has(candidate.path)) continue;
    const file = filesByPath.get(candidate.path);
    details.set(candidate.path, assessFileFreshness({
      projectRoot,
      filePath: candidate.path,
      indexedAt: file?.indexedAt,
      indexedMtime: file?.lastModifiedAt,
      indexedSizeBytes: file?.sizeBytes,
    }));
  }
  return details;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(value);
  }
  return out;
}

function collectSymbols(candidates: readonly ContextPacketReadableCandidate[]): ContextPacketSymbol[] {
  return uniqueBy(
    candidates
      .filter((candidate) => candidate.kind === "symbol" && candidate.symbolName)
      .map((candidate) => ({
        name: candidate.symbolName ?? "",
        kind: String(candidate.metadata?.symbolKind ?? candidate.metadata?.chunkKind ?? "symbol"),
        ...(candidate.path ? { path: candidate.path } : {}),
        ...(candidate.lineStart != null ? { lineStart: candidate.lineStart } : {}),
        source: candidate.source,
        whyIncluded: candidate.whyIncluded,
        confidence: candidate.confidence,
      })),
    (symbol) => `${symbol.path ?? ""}:${symbol.name}:${symbol.lineStart ?? ""}`,
  );
}

function collectRoutes(candidates: readonly ContextPacketReadableCandidate[]): ContextPacketRoute[] {
  return uniqueBy(
    candidates
      .filter((candidate) => candidate.kind === "route" && candidate.routeKey)
      .map((candidate) => ({
        routeKey: candidate.routeKey ?? "",
        ...(candidate.path ? { path: candidate.path } : {}),
        ...(typeof candidate.metadata?.method === "string" && candidate.metadata.method
          ? { method: candidate.metadata.method }
          : {}),
        source: candidate.source,
        whyIncluded: candidate.whyIncluded,
        confidence: candidate.confidence,
      })),
    (route) => `${route.routeKey}:${route.path ?? ""}:${route.method ?? ""}`,
  );
}

function normalizeObjectType(value: unknown): ContextPacketDatabaseObject["objectType"] {
  switch (value) {
    case "schema":
    case "table":
    case "view":
    case "rpc":
    case "function":
    case "policy":
    case "trigger":
    case "column":
    case "enum":
      return value;
    default:
      return "unknown";
  }
}

function collectDatabaseObjects(
  candidates: readonly ContextPacketReadableCandidate[],
): ContextPacketDatabaseObject[] {
  return uniqueBy(
    candidates
      .filter((candidate) => candidate.kind === "database_object" && candidate.databaseObjectName)
      .map((candidate) => {
        const objectName = candidate.databaseObjectName ?? "";
        const [schemaName, ...rest] = objectName.split(".");
        const unqualifiedName = rest.length > 0 ? rest.join(".") : objectName;
        return {
          objectType: normalizeObjectType(candidate.metadata?.objectType),
          ...(rest.length > 0 ? { schemaName } : {}),
          objectName: unqualifiedName,
          source: candidate.source,
          whyIncluded: candidate.whyIncluded,
          confidence: candidate.confidence,
        };
      }),
    (object) => `${object.schemaName ?? ""}:${object.objectName}:${object.objectType}`,
  );
}

function databaseNeighborhoodArgs(projectId: string, value: string): JsonObject {
  const parts = value.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      projectId,
      schemaName: parts[0],
      tableName: parts.slice(1).join("."),
      maxPerSection: 20,
    } as unknown as JsonObject;
  }
  return { projectId, tableName: value, maxPerSection: 20 } as unknown as JsonObject;
}

function coverageExpandableTools(
  projectId: string,
  coverage: ContextPacketRequestCoverage,
): ContextPacketExpandableTool[] {
  const tools: ContextPacketExpandableTool[] = [];
  for (const item of coverage.items.filter((entry) => entry.status !== "covered")) {
    switch (item.kind) {
      case "file":
        tools.push({
          toolName: "cross_search",
          suggestedArgs: { projectId, term: item.value, limit: 20, verbosity: "compact" } as unknown as JsonObject,
          reason: `Requested file anchor "${item.value}" was not covered; search indexed paths and content for the missing anchor.`,
          whenToUse: "Use before assuming a requested file does not exist or before choosing replacement anchors.",
          readOnly: true,
        });
        break;
      case "symbol":
        tools.push({
          toolName: "reef_where_used",
          suggestedArgs: { projectId, query: item.value, targetKind: "symbol", limit: 50 } as unknown as JsonObject,
          reason: `Requested symbol "${item.value}" was not covered; inspect maintained definitions and usages.`,
          whenToUse: "Use before editing call sites or concluding the symbol is absent.",
          readOnly: true,
        });
        break;
      case "route":
        tools.push({
          toolName: "route_context",
          suggestedArgs: { projectId, route: item.value, maxPerSection: 20 } as unknown as JsonObject,
          reason: `Requested route "${item.value}" was not covered; resolve the route handler and downstream contracts.`,
          whenToUse: "Use before making route-level claims or choosing fallback handlers.",
          readOnly: true,
        });
        break;
      case "database_object":
        tools.push({
          toolName: "table_neighborhood",
          suggestedArgs: databaseNeighborhoodArgs(projectId, item.value),
          reason: `Requested database object "${item.value}" was not covered; inspect indexed table usage and policy neighbors.`,
          whenToUse: "Use before changing schema/RLS-sensitive code or assuming no app usage exists.",
          readOnly: true,
        });
        break;
      case "quoted_text":
        tools.push({
          toolName: "live_text_search",
          suggestedArgs: {
            projectId,
            query: item.value,
            fixedStrings: true,
            maxMatches: 50,
          } as unknown as JsonObject,
          reason: item.status === "not_checked"
            ? `Requested literal "${item.value}" was not checked against current files; run live text search.`
            : `Requested literal "${item.value}" was not covered; broaden current-files search.`,
          whenToUse: "Use before relying on indexed text or concluding the literal is absent.",
          readOnly: true,
        });
        break;
    }
    if (tools.length >= COVERAGE_EXPANDABLE_TOOL_LIMIT) break;
  }
  return tools;
}

function omittedRequestedAnchorExpandableTools(
  projectId: string,
  anchors: readonly RankedOmittedRequestedAnchor[],
): ContextPacketExpandableTool[] {
  const tools: ContextPacketExpandableTool[] = [];
  for (const anchor of anchors) {
    const reasonSuffix = anchor.reason === "budget"
      ? "budgetTokens"
      : "maxPrimaryContext/maxRelatedContext limits";
    switch (anchor.kind) {
      case "file":
        tools.push({
          toolName: "cross_search",
          suggestedArgs: { projectId, term: anchor.value, limit: 20, verbosity: "compact" } as unknown as JsonObject,
          reason: `Requested file anchor "${anchor.value}" was ranked but omitted from returned context by ${reasonSuffix}; search indexed paths and content for the omitted anchor.`,
          whenToUse: "Use before assuming the requested file was absent from retrieval or before relying on broader fallback files.",
          readOnly: true,
        });
        break;
      case "symbol":
        tools.push({
          toolName: "reef_where_used",
          suggestedArgs: { projectId, query: anchor.value, targetKind: "symbol", limit: 50 } as unknown as JsonObject,
          reason: `Requested symbol "${anchor.value}" was ranked but omitted from returned context by ${reasonSuffix}; inspect maintained definitions and usages.`,
          whenToUse: "Use before editing callers or concluding the requested symbol has no relevant evidence.",
          readOnly: true,
        });
        break;
      case "route":
        tools.push({
          toolName: "route_context",
          suggestedArgs: { projectId, route: anchor.value, maxPerSection: 20 } as unknown as JsonObject,
          reason: `Requested route "${anchor.value}" was ranked but omitted from returned context by ${reasonSuffix}; resolve the route handler and downstream contracts.`,
          whenToUse: "Use before making route-level claims when the packet reports omitted requested route evidence.",
          readOnly: true,
        });
        break;
      case "database_object":
        tools.push({
          toolName: "table_neighborhood",
          suggestedArgs: databaseNeighborhoodArgs(projectId, anchor.value),
          reason: `Requested database object "${anchor.value}" was ranked but omitted from returned context by ${reasonSuffix}; inspect indexed table usage and policy neighbors.`,
          whenToUse: "Use before changing schema/RLS-sensitive code or assuming no app usage exists.",
          readOnly: true,
        });
        break;
    }
    if (tools.length >= COVERAGE_EXPANDABLE_TOOL_LIMIT) break;
  }
  return tools;
}

function bestGraphAnchorFile(input: ContextPacketToolInput, graphSummary: ContextPacketGraphSummary): string | undefined {
  const returnedAnchor = graphSummary.files.find((file) => file.relation === "anchor")?.filePath;
  if (returnedAnchor) return normalizePath(returnedAnchor);
  const anchor = graphSummary.anchorFiles.find((filePath) =>
    graphSummary.files.some((file) => file.filePath === filePath)
  );
  if (anchor) return normalizePath(anchor);
  const focusFile = input.focusFiles?.[0];
  if (focusFile && graphSummary.files.some((file) => file.filePath === normalizePath(focusFile))) {
    return normalizePath(focusFile);
  }
  const changedFile = input.changedFiles?.[0];
  if (changedFile && graphSummary.files.some((file) => file.filePath === normalizePath(changedFile))) {
    return normalizePath(changedFile);
  }
  return undefined;
}

function whereUsedGraphGapArgs(
  projectId: string,
  input: ContextPacketToolInput,
  intent: ContextPacketIntent,
  anchorFile: string | undefined,
): JsonObject {
  const symbol = input.focusSymbols?.[0] ?? intent.entities.symbols[0];
  if (symbol) {
    return { projectId, query: symbol, targetKind: "symbol", limit: 50 } as unknown as JsonObject;
  }
  const route = input.focusRoutes?.[0] ?? intent.entities.routes[0];
  if (route) {
    return { projectId, query: route, targetKind: "route", limit: 50 } as unknown as JsonObject;
  }
  if (anchorFile) {
    return { projectId, query: anchorFile, targetKind: "file", limit: 50 } as unknown as JsonObject;
  }
  return { projectId, query: input.request, targetKind: "pattern", limit: 50 } as unknown as JsonObject;
}

function graphGapExpandableTools(
  projectId: string,
  input: ContextPacketToolInput,
  args: {
    intent: ContextPacketIntent;
    graphSummary: ContextPacketGraphSummary;
    graphQuality: ContextPacketEvidenceQuality["graph"];
  },
): ContextPacketExpandableTool[] {
  if (args.graphQuality.status !== "missing" && args.graphQuality.status !== "isolated") {
    return [];
  }

  const anchorFile = bestGraphAnchorFile(input, args.graphSummary);
  const statusReason = args.graphQuality.status === "isolated"
    ? "Dependency/impact request returned only isolated graph evidence"
    : "Dependency/impact request did not return usable graph evidence";
  const tools: ContextPacketExpandableTool[] = [];

  if (anchorFile) {
    tools.push({
      toolName: "imports_deps",
      suggestedArgs: { projectId, file: anchorFile } as unknown as JsonObject,
      reason: `${statusReason}; inspect direct imports for ${anchorFile}.`,
      whenToUse: "Use before claiming that the file has no dependencies or before choosing adjacent files to inspect.",
      readOnly: true,
    });
    tools.push({
      toolName: "imports_impact",
      suggestedArgs: { projectId, file: anchorFile, depth: 3 } as unknown as JsonObject,
      reason: `${statusReason}; inspect downstream dependents of ${anchorFile}.`,
      whenToUse: "Use before making caller, blast-radius, or regression-risk claims.",
      readOnly: true,
    });
  }

  tools.push({
    toolName: "repo_map",
    suggestedArgs: {
      projectId,
      ...(anchorFile ? { focusFiles: [anchorFile] } : {}),
      ...((input.focusRoutes?.length ?? 0) > 0 ? { focusRoutes: input.focusRoutes } : {}),
      ...((input.focusSymbols?.length ?? 0) > 0 ? { focusSymbols: input.focusSymbols } : {}),
      ...((input.focusDatabaseObjects?.length ?? 0) > 0 ? { focusDatabaseObjects: input.focusDatabaseObjects } : {}),
    } as unknown as JsonObject,
    reason: `${statusReason}; rerank the project graph around the strongest available anchors.`,
    whenToUse: "Use when context_packet has too little connected graph evidence for dependency reasoning.",
    readOnly: true,
  });
  tools.push({
    toolName: "reef_where_used",
    suggestedArgs: whereUsedGraphGapArgs(projectId, input, args.intent, anchorFile),
    reason: `${statusReason}; inspect maintained usage evidence for the strongest anchor.`,
    whenToUse: "Use before concluding an anchor is unused or before editing dependents.",
    readOnly: true,
  });

  return tools;
}

function dedupeExpandableTools(tools: readonly ContextPacketExpandableTool[]): ContextPacketExpandableTool[] {
  const seen = new Set<string>();
  const out: ContextPacketExpandableTool[] = [];
  for (const tool of tools) {
    const key = `${tool.toolName}:${JSON.stringify(tool.suggestedArgs)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tool);
  }
  return out;
}

const TOOL_BATCH_TOOL_NAME_SET = new Set<string>(TOOL_BATCH_TOOL_NAMES);

function isBatchableExpandableTool(
  tool: ContextPacketExpandableTool,
): tool is ContextPacketExpandableTool & { toolName: ToolBatchToolName } {
  if (tool.toolName === "tool_batch") return false;
  if (!tool.readOnly) return false;
  if (!TOOL_BATCH_TOOL_NAME_SET.has(tool.toolName)) return false;
  return !("mutation" in getToolOperationalMetadata(tool.toolName).annotations);
}

function buildBatchExpandableTool(
  projectId: string,
  tools: readonly ContextPacketExpandableTool[],
): ContextPacketExpandableTool | undefined {
  const ops = tools
    .filter(isBatchableExpandableTool)
    .slice(0, BATCHED_EXPANDABLE_TOOL_LIMIT)
    .map((tool, index) => ({
      label: `${tool.toolName}_${index + 1}`,
      tool: tool.toolName,
      args: tool.suggestedArgs,
      resultMode: "summary" as const,
    }));

  if (ops.length < 2) return undefined;

  return {
    toolName: "tool_batch",
    suggestedArgs: {
      projectId,
      verbosity: "compact",
      continueOnError: true,
      maxConcurrency: Math.min(8, Math.max(1, ops.length)),
      ops,
    } as unknown as JsonObject,
    reason: `Run ${ops.length} independent read-only follow-up tools with bounded concurrency in one compact round-trip.`,
    whenToUse: "Use when several read-only expansions from this packet are useful and compact summaries are enough.",
    readOnly: true,
  };
}

function withBatchExpandableTool(
  projectId: string,
  tools: readonly ContextPacketExpandableTool[],
): ContextPacketExpandableTool[] {
  const batchTool = buildBatchExpandableTool(projectId, tools);
  if (!batchTool) return [...tools];

  const insertAt = Math.min(BATCHED_EXPANDABLE_TOOL_INSERT_AFTER, tools.length);
  return [
    ...tools.slice(0, insertAt),
    batchTool,
    ...tools.slice(insertAt),
  ];
}

function batchOpCount(tool: ContextPacketExpandableTool): number {
  const ops = (tool.suggestedArgs as { ops?: unknown }).ops;
  return Array.isArray(ops) ? ops.length : 0;
}

function withBatchRetrievalRecommendation(args: {
  diagnostics: ContextPacketRetrievalDiagnostics;
  expandableTools: readonly ContextPacketExpandableTool[];
  evidenceLabel: ContextPacketEvidenceQuality["label"];
}): ContextPacketRetrievalDiagnostics {
  const batchTool = args.expandableTools.find((tool) => tool.toolName === "tool_batch");
  if (!batchTool || args.diagnostics.recommendations.some((recommendation) => recommendation.includes("tool_batch"))) {
    return args.diagnostics;
  }

  const opCount = batchOpCount(batchTool);
  if (opCount < 2) return args.diagnostics;

  const recommendation = args.evidenceLabel === "strong"
    ? `Optional: use the tool_batch expansion to run ${opCount} read-only follow-up(s) in one compact call when broader context is needed.`
    : `Use the tool_batch expansion to run ${opCount} read-only follow-up(s) in one compact call before relying on broader claims.`;

  return {
    ...args.diagnostics,
    recommendations: [
      recommendation,
      ...args.diagnostics.recommendations,
    ],
  };
}

function expandableTools(
  input: ContextPacketToolInput,
  projectId: string,
  args: {
    dirty: boolean;
    needsWorkingTreeOverlay: boolean;
    policy: ContextPacketModePolicy;
    intent: ContextPacketIntent;
    liveTextMisses: readonly ContextPacketLiveTextMiss[];
    requestCoverage: ContextPacketRequestCoverage;
    omittedRequestedAnchors: readonly RankedOmittedRequestedAnchor[];
    graphSummary: ContextPacketGraphSummary;
    graphQuality: ContextPacketEvidenceQuality["graph"];
  },
): ContextPacketExpandableTool[] {
  const ctx = { input, projectId, intent: args.intent };
  const tools: ContextPacketExpandableTool[] = [];
  for (const name of args.policy.expandableTools) {
    const tool = buildExpandableTool(name, ctx);
    if (tool) tools.push(tool);
  }
  const scopedLiveTextMiss = args.liveTextMisses.find((miss) => miss.scope === "file");
  if (scopedLiveTextMiss) {
    const withoutGenericLiveSearch = tools.filter((tool) => tool.toolName !== "live_text_search");
    tools.splice(0, tools.length, {
      toolName: "live_text_search",
      suggestedArgs: {
        projectId,
        query: scopedLiveTextMiss.query,
        fixedStrings: true,
        maxMatches: 50,
      } as unknown as JsonObject,
      reason: `Scoped live search did not find "${scopedLiveTextMiss.query}" in ${scopedLiveTextMiss.scopePath}; broaden to the project filesystem.`,
      whenToUse: "Use when the literal may have moved, been renamed, or appears outside the scoped file.",
      readOnly: true,
    }, ...withoutGenericLiveSearch);
  }

  if (args.needsWorkingTreeOverlay) {
    tools.unshift({
      toolName: "working_tree_overlay",
      suggestedArgs: {
        projectId,
        files: (input.changedFiles ?? []).map(normalizePath),
      } as unknown as JsonObject,
      reason: "Snapshot working-tree file facts for changed files before relying on indexed fallback.",
      whenToUse: "Use when changed files are present but context_packet has no working-tree overlay fact for them.",
      readOnly: false,
    });
  }

  if (args.dirty) {
    tools.unshift({
      toolName: "project_index_status",
      suggestedArgs: { projectId, includeUnindexed: true } as unknown as JsonObject,
      reason: "Inspect stale, deleted, unknown, or unindexed files before using indexed evidence.",
      whenToUse: "Use when the packet reports dirty index freshness.",
      readOnly: true,
    });
    tools.push({
      toolName: "project_index_refresh",
      suggestedArgs: {
        projectId,
        mode: "if_stale",
        reason: "context_packet reported dirty index freshness",
      } as unknown as JsonObject,
      reason: "Refresh indexed evidence when the packet marks stale or unindexed files.",
      whenToUse: "Use before relying on indexed AST, route, import, or schema evidence.",
      readOnly: false,
    });
  }

  const coverageTools = coverageExpandableTools(projectId, args.requestCoverage)
    .filter((tool) =>
      !(
        scopedLiveTextMiss &&
        tool.toolName === "live_text_search" &&
        (tool.suggestedArgs as { query?: unknown }).query === scopedLiveTextMiss.query
      )
    );
  const omittedAnchorTools = omittedRequestedAnchorExpandableTools(projectId, args.omittedRequestedAnchors);
  const graphTools = graphGapExpandableTools(projectId, input, {
    intent: args.intent,
    graphSummary: args.graphSummary,
    graphQuality: args.graphQuality,
  });
  const scopedPrefix = scopedLiveTextMiss && tools[0]?.toolName === "live_text_search"
    ? tools.slice(0, 1)
    : [];
  const remainingTools = scopedPrefix.length > 0 ? tools.slice(1) : tools;
  const hasUnresolvedCoverage = args.requestCoverage.uncoveredCount + args.requestCoverage.notCheckedCount > 0;
  const orderedTools = dedupeExpandableTools([
    ...scopedPrefix,
    ...omittedAnchorTools,
    ...(hasUnresolvedCoverage ? coverageTools : graphTools),
    ...(hasUnresolvedCoverage ? graphTools : coverageTools),
    ...remainingTools,
  ]);
  return withBatchExpandableTool(projectId, orderedTools);
}

function collectWorkingTreeOverlayFacts(
  projectStore: ProjectStore,
  projectId: string,
): Map<string, ProjectFact> {
  const facts = projectStore.queryReefFacts({
    projectId,
    overlay: "working_tree",
    source: "working_tree_overlay",
    kind: "file_snapshot",
    limit: REEF_OVERLAY_FACT_QUERY_LIMIT,
  });
  const byPath = new Map<string, ProjectFact>();
  for (const fact of facts) {
    if (fact.subject.kind !== "file") continue;
    byPath.set(fact.subject.path, fact);
  }
  return byPath;
}

function overlayFileState(fact: ProjectFact): string {
  const state = fact.data?.state;
  return typeof state === "string" ? state : "unknown";
}

function overlayFactCandidateSeeds(args: {
  input: ContextPacketToolInput;
  factsByPath: Map<string, ProjectFact>;
}): ContextPacketCandidateSeed[] {
  const changedFiles = new Set((args.input.changedFiles ?? []).map(normalizePath));
  const focusFiles = new Set((args.input.focusFiles ?? []).map(normalizePath));
  const requestedPaths = uniqueBy(
    [...changedFiles, ...focusFiles],
    (filePath) => filePath,
  );
  const out: ContextPacketCandidateSeed[] = [];

  for (const filePath of requestedPaths) {
    const fact = args.factsByPath.get(filePath);
    if (!fact) continue;
    out.push({
      id: `working_tree_overlay:${filePath}`,
      kind: "file",
      path: filePath,
      source: "working_tree_overlay",
      strategy: "overlay_fact",
      whyIncluded: `Working-tree overlay fact exists for ${filePath}.`,
      confidence: changedFiles.has(filePath) ? 0.9 : 0.82,
      baseScore: changedFiles.has(filePath) ? 50 : 30,
      metadata: {
        overlay: "working_tree",
        overlaySource: "working_tree_overlay",
        overlayFactFingerprint: fact.fingerprint,
        overlayFileState: overlayFileState(fact),
        evidenceConfidenceLabel: fact.freshness.state === "fresh" ? "verified_live" : "unknown",
      },
    });
  }

  return out;
}

function conventionFactCandidateSeeds(args: {
  input: ContextPacketToolInput;
  projectStore: ProjectStore;
  projectId: string;
}): ContextPacketCandidateSeed[] {
  const requestTokens = new Set(args.input.request.toLowerCase().split(/[^a-z0-9_./-]+/).filter((token) => token.length >= 2));
  const focusFiles = new Set((args.input.focusFiles ?? []).map(normalizePath));
  const changedFiles = new Set((args.input.changedFiles ?? []).map(normalizePath));
  const seeds: ContextPacketCandidateSeed[] = [];

  for (const fact of args.projectStore.queryReefFacts({ projectId: args.projectId, limit: 1000 })) {
    const conventionKind = conventionKindForFact(fact);
    if (!conventionKind) continue;
    const filePath = filePathForConventionFact(fact);
    const status = stringDataValue(fact.data, "status") ?? "candidate";
    const searchText = [
      conventionKind,
      stringDataValue(fact.data, "title") ?? "",
      stringDataValue(fact.data, "reason") ?? "",
      filePath ?? "",
    ].join(" ").toLowerCase();
    const requestMatch = [...requestTokens].some((token) => searchText.includes(token));
    const fileMatch = filePath ? focusFiles.has(filePath) || changedFiles.has(filePath) : false;
    if (!requestMatch && !fileMatch) continue;

    seeds.push({
      id: `reef_convention:${fact.fingerprint}`,
      kind: "file",
      ...(filePath ? { path: filePath } : {}),
      source: "reef_convention",
      strategy: "convention_memory",
      whyIncluded: `${status} project convention ${conventionKind} applies to this request.`,
      confidence: status === "accepted" ? Math.max(0.75, fact.confidence) : Math.min(0.7, fact.confidence),
      baseScore: status === "accepted" ? 34 : 20,
      metadata: {
        overlay: fact.overlay,
        conventionKind,
        conventionStatus: status,
        conventionFactFingerprint: fact.fingerprint,
        evidenceConfidenceLabel: fact.overlay === "working_tree" && fact.freshness.state === "fresh"
          ? "verified_live"
          : fact.freshness.state === "stale"
            ? "stale_indexed"
            : "unknown",
      },
    });
  }

  return uniqueBy(seeds, (seed) => seed.id ?? `${seed.source}:${seed.path ?? ""}`);
}

function annotateContextOverlay(
  candidates: readonly ContextPacketReadableCandidate[],
  factsByPath: Map<string, ProjectFact>,
): ContextPacketReadableCandidate[] {
  return candidates.map((candidate) => {
    if (!candidate.path) {
      return {
        ...candidate,
        metadata: {
          ...(candidate.metadata ?? {}),
          overlay: candidate.metadata?.overlay ?? "indexed",
          evidenceConfidenceLabel: candidate.metadata?.evidenceConfidenceLabel ?? (
            candidate.freshness?.state === "fresh"
              ? "fresh_indexed"
              : candidate.freshness?.state
                ? "stale_indexed"
                : "unknown"
          ),
        },
      };
    }
    const fact = factsByPath.get(candidate.path);
    if (!fact) {
      return {
        ...candidate,
        metadata: {
          ...(candidate.metadata ?? {}),
          overlay: candidate.metadata?.overlay ?? "indexed",
          evidenceConfidenceLabel: candidate.metadata?.evidenceConfidenceLabel ?? (
            candidate.freshness?.state === "fresh"
              ? "fresh_indexed"
              : candidate.freshness?.state
                ? "stale_indexed"
                : "unknown"
          ),
        },
      };
    }
    return {
      ...candidate,
      metadata: {
        ...(candidate.metadata ?? {}),
        overlay: "working_tree",
        overlaySource: "working_tree_overlay",
        overlayFactFingerprint: fact.fingerprint,
        overlayFileState: overlayFileState(fact),
        evidenceConfidenceLabel: candidate.metadata?.evidenceConfidenceLabel
          ?? (fact.freshness.state === "fresh" ? "verified_live" : "unknown"),
      },
    };
  });
}

function conventionKindForFact(fact: ProjectFact): string | undefined {
  return stringDataValue(fact.data, "conventionKind")
    ?? (fact.kind.startsWith("convention:") ? fact.kind.slice("convention:".length) : undefined);
}

function filePathForConventionFact(fact: ProjectFact): string | undefined {
  if (fact.subject.kind === "file" || fact.subject.kind === "symbol" || fact.subject.kind === "diagnostic") {
    return fact.subject.path;
  }
  return stringDataValue(fact.data, "filePath") ?? stringDataValue(fact.data, "path");
}

function stringDataValue(data: JsonObject | undefined, key: string): string | undefined {
  if (!data) return undefined;
  const value = data[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function missingChangedOverlayFacts(
  input: ContextPacketToolInput,
  factsByPath: Map<string, ProjectFact>,
): string[] {
  return (input.changedFiles ?? [])
    .map(normalizePath)
    .filter((filePath) => !factsByPath.has(filePath));
}

function collectRelevantActiveFindings(args: {
  input: ContextPacketToolInput;
  projectStore: ProjectStore;
  projectId: string;
  candidates: readonly ContextPacketReadableCandidate[];
}): ProjectFinding[] {
  const contextPaths = new Set(
    [
      ...args.candidates.flatMap((candidate) => candidate.path ? [candidate.path] : []),
      ...(args.input.focusFiles ?? []).map(normalizePath),
      ...(args.input.changedFiles ?? []).map(normalizePath),
    ],
  );
  if (contextPaths.size === 0) return [];

  const byFingerprint = new Map<string, ProjectFinding>();
  for (const filePath of contextPaths) {
    const findings = args.projectStore.queryReefFindings({
      projectId: args.projectId,
      status: "active",
      includeResolved: false,
      filePath,
      limit: ACTIVE_FINDINGS_PER_CONTEXT_FILE_LIMIT,
    });
    for (const finding of findings) {
      byFingerprint.set(finding.fingerprint, finding);
    }
  }

  return [...byFingerprint.values()]
    .sort((left, right) => {
      const severityRank = { error: 3, warning: 2, info: 1 };
      return (
        severityRank[right.severity] - severityRank[left.severity] ||
        right.capturedAt.localeCompare(left.capturedAt) ||
        left.fingerprint.localeCompare(right.fingerprint)
      );
    })
    .slice(0, 20);
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))];
}

function elapsedMs(startMs: number): number {
  return Math.max(0, Date.now() - startMs);
}

function providerRunDetail(args: {
  provider: string;
  status: ContextPacketProviderRunDetail["status"];
  candidateCount: number;
  startedAtMs: number;
}): ContextPacketProviderRunDetail {
  return {
    provider: args.provider,
    status: args.status,
    candidateCount: args.candidateCount,
    durationMs: elapsedMs(args.startedAtMs),
  };
}

function liveTextQueries(input: ContextPacketToolInput, intent: ContextPacketIntent): LiveTextQuery[] {
  const scopes = liveTextScopes(input);
  const scopedExplicitSymbolQueries = scopes.length === 0
    ? []
    : uniqueStrings(input.focusSymbols ?? [])
        .filter((query) => /^[A-Za-z_$][A-Za-z0-9_$]{2,}$/.test(query))
        .map((query) => ({ query, kind: "symbol" as const }));
  const quotedTextQueries = uniqueStrings(intent.entities.quotedText)
    .map((query) => ({ query, kind: "quoted_text" as const }));
  const scopedInferredSymbolQueries = scopes.length === 0
    ? []
    : uniqueStrings(intent.entities.symbols)
        .filter((query) => /^[A-Za-z_$][A-Za-z0-9_$]{2,}$/.test(query))
        .map((query) => ({ query, kind: "symbol" as const }));

  return uniqueBy(
    [...scopedExplicitSymbolQueries, ...quotedTextQueries, ...scopedInferredSymbolQueries]
      .filter(({ query }) => query.length >= 2 && query.length <= 160),
    (query) => `${query.kind}:${query.query.toLowerCase()}`,
  )
    .slice(0, LIVE_TEXT_QUERY_LIMIT);
}

function liveTextCandidateSeed(
  job: LiveTextSearchJob,
  match: LiveTextSearchMatch,
): ContextPacketCandidateSeed {
  return {
    id: `live_text_provider:${match.filePath}:${match.line}:${match.column}:${job.kind}:${job.query}`,
    kind: job.kind === "symbol" ? "symbol" : "file",
    path: match.filePath,
    lineStart: match.line,
    lineEnd: match.line,
    ...(job.kind === "symbol" ? { symbolName: job.query } : {}),
    source: "live_text_provider",
    strategy: "exact_match",
    whyIncluded: job.kind === "symbol"
      ? `Live filesystem text matched symbol "${job.query}".`
      : `Live filesystem text matched quoted literal "${job.query}".`,
    confidence: 0.94,
    baseScore: 68,
    metadata: {
      query: job.query,
      queryKind: job.kind,
      text: match.text,
      column: match.column,
      matchText: match.submatches[0]?.text ?? job.query,
      submatchCount: match.submatches.length,
      overlay: "live_filesystem",
      evidenceConfidenceLabel: "verified_live",
      liveTextProvider: "ripgrep",
      ...(job.scopePath ? { scopePath: job.scopePath } : { scope: "project" }),
    },
  };
}

function liveTextMiss(
  query: string,
  queryKind: LiveTextQueryKind,
  scopePath: string | undefined,
): ContextPacketLiveTextMiss {
  return scopePath
    ? { query, queryKind, scope: "file", scopePath }
    : { query, queryKind, scope: "project" };
}

function liveTextScopes(input: ContextPacketToolInput): string[] {
  return uniqueStrings([
    ...(input.focusFiles ?? []),
    ...(input.changedFiles ?? []),
  ].map(normalizePath)).slice(0, LIVE_TEXT_SCOPE_LIMIT);
}

function addProviderSkipReason(
  reasons: Map<ContextPacketProviderName, ProviderSkipReason>,
  provider: ContextPacketProviderName,
  reason: string,
  adaptive = false,
): void {
  if (reasons.has(provider)) return;
  reasons.set(provider, { reason, adaptive });
}

function applyAdaptiveProviderRouting(args: {
  input: ContextPacketToolInput;
  enabledProviders: Set<ContextPacketProviderName>;
  skipReasons: Map<ContextPacketProviderName, ProviderSkipReason>;
}): void {
  if (args.input.includeLiveHints === false) {
    addProviderSkipReason(
      args.skipReasons,
      "hot_hint_index",
      "includeLiveHints=false disables hot hint retrieval.",
    );
    addProviderSkipReason(
      args.skipReasons,
      "live_text_provider",
      "includeLiveHints=false disables live exact-text retrieval.",
    );
    args.enabledProviders.delete("hot_hint_index");
    return;
  }
}

function liveTextSatisfiedScopedExactMatch(
  input: ContextPacketToolInput,
  result: LiveTextProviderResult,
): boolean {
  const scopes = new Set(liveTextScopes(input));
  if (!result.ran || scopes.size === 0 || result.candidates.length === 0) return false;
  if (result.misses.some((miss) => miss.scope === "file" && (!miss.scopePath || scopes.has(miss.scopePath)))) {
    return false;
  }

  return result.candidates.some((candidate) => {
    const scopePath = candidate.metadata?.scopePath;
    return typeof scopePath === "string" &&
      scopes.has(scopePath) &&
      candidate.path === scopePath;
  });
}

function applyScopedLiveTextProviderPruning(args: {
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
  liveTextResult: LiveTextProviderResult;
  enabledProviders: Set<ContextPacketProviderName>;
  skipReasons: Map<ContextPacketProviderName, ProviderSkipReason>;
}): void {
  if (!liveTextSatisfiedScopedExactMatch(args.input, args.liveTextResult)) return;

  const keepGraphProviders = requestNeedsBroadGraphRetrieval(args.input, args.intent);
  for (const provider of [
    "hot_hint_index",
    "file_provider",
    "route_provider",
    "schema_provider",
    "symbol_provider",
    ...(keepGraphProviders ? [] : [
      "import_graph_provider",
      "repo_map_provider",
    ] as const),
  ] as const) {
    if (!args.enabledProviders.has(provider)) continue;
    args.enabledProviders.delete(provider);
    addProviderSkipReason(
      args.skipReasons,
      provider,
      provider === "hot_hint_index"
        ? keepGraphProviders
          ? "Scoped live exact matches already identify current file evidence; broad hot hint retrieval was skipped while graph providers stayed enabled for requested graph evidence."
          : "Scoped live exact matches already identify current file evidence; broad hot hint retrieval was skipped."
        : provider === "repo_map_provider"
          ? "Scoped live exact matches already identify current file evidence; centrality-ranked repo map context was skipped."
          : keepGraphProviders
            ? "Scoped live exact matches already identify current file evidence; semantic indexed providers were skipped while graph providers stayed enabled for requested graph evidence."
            : "Scoped live exact matches already identify current file evidence; semantic indexed providers were skipped.",
      true,
    );
  }
}

function hasIndexedFocusFileAnchor(
  projectStore: ProjectStore,
  input: ContextPacketToolInput,
): boolean {
  return uniqueStrings([
    ...(input.focusFiles ?? []),
    ...(input.changedFiles ?? []),
  ].map(normalizePath)).some((filePath) =>
    normalizePath(projectStore.findFile(filePath)?.path ?? "") === filePath
  );
}

function requestNeedsBroadGraphRetrieval(
  input: ContextPacketToolInput,
  intent: ContextPacketIntent,
): boolean {
  return intent.primaryFamily === "find_precedent" || BROAD_GRAPH_REQUEST_PATTERN.test(input.request);
}

function applyFocusedFileProviderPruning(args: {
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
  liveTextResult: LiveTextProviderResult;
  projectStore: ProjectStore;
  enabledProviders: Set<ContextPacketProviderName>;
  skipReasons: Map<ContextPacketProviderName, ProviderSkipReason>;
}): void {
  if (!args.enabledProviders.has("repo_map_provider")) return;
  if (requestNeedsBroadGraphRetrieval(args.input, args.intent)) return;
  if (args.liveTextResult.ran && args.liveTextResult.misses.length > 0) return;
  if (!hasIndexedFocusFileAnchor(args.projectStore, args.input)) return;

  args.enabledProviders.delete("repo_map_provider");
  addProviderSkipReason(
    args.skipReasons,
    "repo_map_provider",
    "Indexed focus/changed file anchors identify local edit context; broad repo-map centrality ranking was skipped until graph, precedent, dependency, or impact evidence is requested.",
    true,
  );
}

function providerSkipDetails(args: {
  skippedProviders: readonly string[];
  policy: ContextPacketModePolicy;
  skipReasons: Map<ContextPacketProviderName, ProviderSkipReason>;
}): Array<{ provider: string; reason: string; adaptive: boolean }> {
  const policyProviders = new Set(args.policy.enabledProviders);
  return uniqueStrings(args.skippedProviders).map((provider) => {
    const typedProvider = CONTEXT_PACKET_PROVIDER_NAMES.find((name) => name === provider);
    const explicitReason = typedProvider ? args.skipReasons.get(typedProvider) : undefined;
    if (explicitReason) {
      return { provider, ...explicitReason };
    }
    if (!policyProviders.has(provider as ContextPacketProviderName)) {
      return {
        provider,
        reason: `Provider is disabled by ${args.policy.mode} mode policy.`,
        adaptive: false,
      };
    }
    return {
      provider,
      reason: "Provider was skipped by context_packet routing.",
      adaptive: false,
    };
  });
}

function liveTextSearchJobKey(job: LiveTextSearchJob): string {
  return `${job.query.toLowerCase()}\0${job.scopePath ?? ""}`;
}

async function runLiveTextSearchJobs(
  projectRoot: string,
  jobs: readonly LiveTextSearchJob[],
): Promise<LiveTextSearchJobResult[]> {
  const uniqueJobs = uniqueBy(jobs, liveTextSearchJobKey);
  const resultsByKey = new Map<string, Awaited<ReturnType<typeof runRipgrepSearch>>>();
  let nextIndex = 0;
  const workerCount = Math.min(LIVE_TEXT_MAX_CONCURRENT_SEARCHES, uniqueJobs.length);

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const job = uniqueJobs[index];
      if (!job) return;

      const result = await runRipgrepSearch(projectRoot, {
        query: job.query,
        ...(job.scopePath ? { pathGlob: job.scopePath } : {}),
        fixedStrings: true,
        maxMatches: job.scopePath ? Math.min(LIVE_TEXT_MAX_MATCHES, 5) : LIVE_TEXT_MAX_MATCHES,
        maxFiles: job.scopePath ? 1 : LIVE_TEXT_MAX_FILES,
      });
      resultsByKey.set(liveTextSearchJobKey(job), result);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return jobs.flatMap((job) => {
    const result = resultsByKey.get(liveTextSearchJobKey(job));
    return result ? [{ job, result }] : [];
  });
}

async function liveTextCandidateSeeds(args: {
  projectRoot: string;
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
}): Promise<LiveTextProviderResult> {
  const queries = liveTextQueries(args.input, args.intent);
  if (queries.length === 0) {
    return { candidates: [], misses: [], checkedQueries: [], warnings: [], truncated: false, ran: false };
  }

  const candidates: ContextPacketCandidateSeed[] = [];
  const misses: ContextPacketLiveTextMiss[] = [];
  const warnings: string[] = [];
  const warningSearchKeys = new Set<string>();
  let truncated = false;
  const checkedQuotedTextCount = queries.filter((query) => query.kind === "quoted_text").length;
  if (args.intent.entities.quotedText.length > checkedQuotedTextCount) {
    warnings.push(
      `live_text_provider: quoted literal search capped at ${checkedQuotedTextCount} of ${args.intent.entities.quotedText.length} literal(s); unsearched literals are marked not_checked.`,
    );
  }
  const scopes = liveTextScopes(args.input);
  if ((args.input.focusFiles?.length ?? 0) + (args.input.changedFiles?.length ?? 0) > LIVE_TEXT_SCOPE_LIMIT) {
    warnings.push(`live_text_provider: scoped live exact search capped at ${LIVE_TEXT_SCOPE_LIMIT} focus/changed file(s).`);
  }
  const scopePaths = scopes.length > 0 ? scopes : [undefined];
  const jobs = queries.flatMap((query) =>
    scopePaths.map((scopePath): LiveTextSearchJob => ({ ...query, scopePath }))
  );
  for (const { job, result } of await runLiveTextSearchJobs(args.projectRoot, jobs)) {
    const searchKey = liveTextSearchJobKey(job);
    if (result.matches.length === 0) {
      misses.push(liveTextMiss(job.query, job.kind, job.scopePath));
    }
    candidates.push(...result.matches.map((match) => liveTextCandidateSeed(job, match)));
    if (!warningSearchKeys.has(searchKey)) {
      warningSearchKeys.add(searchKey);
      warnings.push(...result.warnings.map((warning) => `live_text_provider: ${warning}`));
    }
    truncated ||= result.truncated;
  }

  return {
    candidates,
    misses,
    checkedQueries: queries.map((query) => ({ query: query.query, queryKind: query.kind })),
    warnings,
    truncated,
    ran: true,
  };
}

function emitContextPacketTelemetry(args: {
  projectStore: import("@mako-ai/store").ProjectStore;
  projectId: string;
  requestId?: string;
  grade: "full" | "partial" | "no";
  reasonCodes: string[];
  reason?: string;
}): void {
  try {
    args.projectStore.insertUsefulnessEvent({
      eventId: randomUUID(),
      projectId: args.projectId,
      requestId: args.requestId ?? `req_${randomUUID()}`,
      decisionKind: "packet_usefulness",
      family: "context_packet",
      toolName: "context_packet",
      grade: args.grade,
      reasonCodes: args.reasonCodes,
      reason: args.reason,
    });
  } catch {
    // Telemetry must never affect the tool result.
  }
}

function contextPacketTelemetryReasonCodes(args: {
  primaryContextCount: number;
  relatedContextCount: number;
  dirty: boolean;
  evidenceQuality: ContextPacketEvidenceQuality;
  retrievalDiagnostics: ContextPacketRetrievalDiagnostics;
  budgetExhausted: boolean;
  selectionLimitHit: boolean;
  requestedAnchorsOmitted: number;
  supportingSignalsOmitted: number;
}): string[] {
  const plan = args.retrievalDiagnostics.retrievalPlan;
  return uniqueStrings([
    args.primaryContextCount > 0 ? "primary_context_returned" : "no_primary_context",
    args.relatedContextCount > 0 ? "related_context_returned" : "no_related_context",
    args.dirty ? "dirty_index_reported" : "freshness_reported",
    `evidence_label_${args.evidenceQuality.label}`,
    `request_coverage_${args.evidenceQuality.requestCoverage.status}`,
    `graph_evidence_${args.evidenceQuality.graph.status}`,
    args.evidenceQuality.graph.requested && args.evidenceQuality.graph.warningCount > 0
      ? "graph_evidence_warning_labeled"
      : "",
    `retrieval_level_${plan.level}`,
    `retrieval_strategy_${plan.strategy}`,
    `evidence_gate_${plan.evidenceGate.status}`,
    plan.evidenceGate.canAnswerFromPacket ? "can_answer_from_packet" : "cannot_answer_from_packet",
    plan.evidenceGate.canEditFromPacket ? "can_edit_from_packet" : "cannot_edit_from_packet",
    plan.recommendedFollowUps.length > 0 ? "recommended_followups_available" : "no_recommended_followups",
    ...plan.evidenceGaps.flatMap((gap) => [
      `evidence_gap_${gap.kind}`,
      `evidence_gap_${gap.kind}_${gap.severity}`,
    ]),
    args.retrievalDiagnostics.failedProviders.length > 0 ? "retrieval_providers_failed" : "",
    args.retrievalDiagnostics.adaptiveSkippedProviders.length > 0 ? "adaptive_providers_skipped" : "",
    args.budgetExhausted ? "budget_exhausted" : "",
    args.selectionLimitHit ? "selection_limit_hit" : "",
    args.requestedAnchorsOmitted > 0 ? "requested_anchors_omitted" : "",
    args.supportingSignalsOmitted > 0 ? "supporting_signals_omitted" : "",
  ]);
}

export async function contextPacketTool(
  input: ContextPacketToolInput,
  options: ToolServiceOptions = {},
): Promise<ContextPacketToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const reefBacked = isReefBackedToolViewEnabled("context_packet");
    const policy = resolveContextPacketModePolicy(input.mode);
    const enabledProviders = new Set(policy.enabledProviders);
    const skipReasons = new Map<ContextPacketProviderName, ProviderSkipReason>();
    const includeRisks = input.includeRisks ?? policy.includeRisks;
    const risksMinConfidence = input.risksMinConfidence ?? 0;
    const includeInstructions = input.includeInstructions ?? policy.includeInstructions;
    const includeActiveFindings = policy.includeActiveFindings;
    const includeExpandableTools = policy.includeExpandableTools;
    const intent = detectContextPacketIntent(input);
    applyAdaptiveProviderRouting({
      input,
      enabledProviders,
      skipReasons,
    });
    const freshnessGate = await ensureProjectFresh({
      project,
      projectStore,
      options,
      reason: input.freshnessPolicy === "prefer_fresh"
        ? "context_packet prefer_fresh"
        : "context_packet",
      waitWhenIdle: input.freshnessPolicy === "prefer_fresh",
    });
    const liveQueries = liveTextQueries(input, intent);
    const runLiveTextProvider = enabledProviders.has("live_text_provider") &&
      input.includeLiveHints !== false &&
      liveQueries.length > 0;
    const liveTextProvidersFailed: string[] = [];
    const liveTextProviderRunDetails: ContextPacketProviderRunDetail[] = [];
    let liveTextResult: LiveTextProviderResult = {
      candidates: [],
      misses: [],
      checkedQueries: [],
      warnings: [],
      truncated: false,
      ran: false,
    };
    if (runLiveTextProvider) {
      const liveTextStartedAtMs = Date.now();
      try {
        liveTextResult = await liveTextCandidateSeeds({
          projectRoot: project.canonicalPath,
          input,
          intent,
        });
        liveTextProviderRunDetails.push(providerRunDetail({
          provider: "live_text_provider",
          status: "success",
          candidateCount: liveTextResult.candidates.length,
          startedAtMs: liveTextStartedAtMs,
        }));
      } catch (error) {
        liveTextProvidersFailed.push("live_text_provider");
        liveTextResult = {
          candidates: [],
          misses: [],
          checkedQueries: [],
          warnings: [`live_text_provider failed: ${error instanceof Error ? error.message : String(error)}`],
          truncated: false,
          ran: false,
        };
        liveTextProviderRunDetails.push(providerRunDetail({
          provider: "live_text_provider",
          status: "failed",
          candidateCount: 0,
          startedAtMs: liveTextStartedAtMs,
        }));
      }
    }
    applyScopedLiveTextProviderPruning({
      input,
      intent,
      liveTextResult,
      enabledProviders,
      skipReasons,
    });
    applyFocusedFileProviderPruning({
      input,
      intent,
      liveTextResult,
      projectStore,
      enabledProviders,
      skipReasons,
    });

    const latestRun = projectStore.getLatestIndexRun();
    const includeHotHints = enabledProviders.has("hot_hint_index");
    // Watcher-driven dirty paths trigger a path-scoped refresh in the
    // Phase 4 coordinator, which advances `latestRun.runId`. The hot
    // index keys on that runId, so a fresh index run automatically
    // invalidates and rebuilds — no explicit dirty marking needed.
    const hotIndex = includeHotHints
      ? (options.hotIndexCache ?? getDefaultHotIndexCache()).getOrBuild({
          projectId: project.projectId,
          projectRoot: project.canonicalPath,
          projectStore,
          ...(latestRun?.runId ? { indexRunId: latestRun.runId } : {}),
        })
      : undefined;

    const collected = collectContextPacketProviders({
      input,
      intent,
      projectStore,
      hotIndex,
      enabledProviders,
    });
    const workingTreeOverlayFacts = reefBacked
      ? collectWorkingTreeOverlayFacts(projectStore, project.projectId)
      : new Map<string, ProjectFact>();
    const runWorkingTreeOverlayProvider = enabledProviders.has("working_tree_overlay");
    const overlayStartedAtMs = Date.now();
    const overlayCandidates = runWorkingTreeOverlayProvider
      ? overlayFactCandidateSeeds({
          input,
          factsByPath: workingTreeOverlayFacts,
        })
      : [];
    const overlayProviderRunDetails = runWorkingTreeOverlayProvider
      ? [providerRunDetail({
          provider: "working_tree_overlay",
          status: "success",
          candidateCount: overlayCandidates.length,
          startedAtMs: overlayStartedAtMs,
        })]
      : [];
    const runConventionProvider = reefBacked && enabledProviders.has("reef_convention");
    const conventionStartedAtMs = Date.now();
    const conventionCandidates = runConventionProvider
      ? conventionFactCandidateSeeds({
          input,
          projectStore,
          projectId: project.projectId,
        })
      : [];
    const conventionProviderRunDetails = runConventionProvider
      ? [providerRunDetail({
          provider: "reef_convention",
          status: "success",
          candidateCount: conventionCandidates.length,
          startedAtMs: conventionStartedAtMs,
        })]
      : [];
    const candidateSeeds = [
      ...liveTextResult.candidates,
      ...collected.candidates,
      ...overlayCandidates,
      ...conventionCandidates,
    ];
    const filesByPath = new Map(projectStore.listFiles().map((file) => [file.path, file] as const));
    const freshnessByPath = freshnessDetailsForCandidates(project.canonicalPath, filesByPath, candidateSeeds);
    const indexFreshness = summarizeIndexFreshnessDetails([...freshnessByPath.values()]);
    const dirty = indexFreshness.state !== "fresh";
    const changedFilesMissingOverlay = missingChangedOverlayFacts(input, workingTreeOverlayFacts);
    const maxPrimaryContext = input.maxPrimaryContext ?? policy.defaultMaxPrimaryContext ?? DEFAULT_MAX_PRIMARY_CONTEXT;
    const maxRelatedContext = input.maxRelatedContext ?? policy.defaultMaxRelatedContext ?? DEFAULT_MAX_RELATED_CONTEXT;
    const budgetTokens = input.budgetTokens ?? policy.defaultBudgetTokens ?? DEFAULT_BUDGET_TOKENS;
    const ranked = rankContextCandidates(candidateSeeds, {
      maxPrimaryContext,
      maxRelatedContext,
      budgetTokens,
      freshnessPolicy: input.freshnessPolicy ?? "report",
      freshnessByPath,
      focusFiles: new Set((input.focusFiles ?? []).map(normalizePath)),
      changedFiles: new Set((input.changedFiles ?? []).map(normalizePath)),
      focusSymbols: new Set((input.focusSymbols ?? []).map(normalizeLoose)),
      focusRoutes: new Set((input.focusRoutes ?? []).map(normalizeRouteAnchor)),
      focusDatabaseObjects: new Set((input.focusDatabaseObjects ?? []).map(normalizeDatabaseObjectAnchor)),
      request: input.request,
      intent,
    });
    const primaryContext = annotateContextOverlay(ranked.primaryContext, workingTreeOverlayFacts);
    const relatedContext = annotateContextOverlay(ranked.relatedContext, workingTreeOverlayFacts);
    const allContext = [...primaryContext, ...relatedContext];
    const graphProvidersRan = collected.providersRun.includes("import_graph_provider") ||
      collected.providersRun.includes("repo_map_provider");
    const graphSummary = buildContextPacketGraphSummary({
      input,
      intent,
      candidates: allContext,
      graphProvidersRan,
      providerWarnings: collected.warnings,
    });
    const requestCoverage = buildContextPacketRequestCoverage({
      input,
      intent,
      // Coverage is derived from what was retrieved (signals intact), not the
      // budget-trimmed payload, so a signal dropped only to fit budgetTokens
      // doesn't read as an uncovered anchor.
      candidates: ranked.coverageContext,
      liveTextMisses: liveTextResult.misses,
      liveTextCheckedQueries: liveTextResult.checkedQueries,
      liveTextRan: liveTextResult.ran,
    });
    const rawActiveFindings = reefBacked && (includeActiveFindings || includeRisks)
      ? collectRelevantActiveFindings({
          input,
          projectStore,
          projectId: project.projectId,
          candidates: allContext,
        })
      : [];
    const relevantFreshFindings = rawActiveFindings.filter((finding) => finding.freshness.state === "fresh");
    const activeFindings = includeActiveFindings ? relevantFreshFindings : [];
    const staleActiveFindingsDropped = rawActiveFindings.length - relevantFreshFindings.length;
    const warnings = [...collected.warnings, ...liveTextResult.warnings, ...freshnessGate.warnings];
    if (ranked.budgetExhausted) {
      warnings.push("context packet was truncated by budgetTokens.");
    }
    if (ranked.selectionLimitHit) {
      warnings.push(`${ranked.candidatesOmittedByLimit} ranked candidate(s) were omitted by maxPrimaryContext/maxRelatedContext limits.`);
    }
    if (ranked.requestedAnchorsOmitted > 0) {
      warnings.push(`${ranked.requestedAnchorsOmitted} requested anchor(s) were ranked but omitted from returned context.`);
    }
    if (ranked.supportingSignalsOmitted > 0) {
      warnings.push(`${ranked.supportingSignalsOmitted} supporting signal(s) were omitted to stay within budgetTokens.`);
    }
    if (dirty) {
      warnings.push("one or more indexed context files are stale, deleted, unindexed, or unknown; verify before relying on indexed evidence.");
    }
    if (changedFilesMissingOverlay.length > 0) {
      warnings.push(`${changedFilesMissingOverlay.length} changed file(s) have no working-tree overlay facts; context_packet is using indexed fallback where available.`);
    }
    if (allContext.length === 0) {
      warnings.push("no deterministic context candidates matched the request.");
    }
    if (!reefBacked) {
      warnings.push("Reef-backed context enrichments are disabled by MAKO_REEF_BACKED.");
    }
    if (staleActiveFindingsDropped > 0) {
      warnings.push(`Dropped ${staleActiveFindingsDropped} stale active finding(s) from edit-guiding context.`);
    }
    if (freshnessGate.status === "stale" || freshnessGate.status === "degraded") {
      warnings.push(`Project freshness gate is ${freshnessGate.status}: ${freshnessGate.reason}`);
    }
    const risks = !includeRisks
      ? []
      : detectContextPacketRisks({
          request: input.request,
          intent,
          candidates: allContext,
          indexFreshness,
          activeFindings: relevantFreshFindings,
        }).filter((risk) => risk.confidence >= risksMinConfidence);
    const scopedInstructions = !includeInstructions
      ? []
      : loadScopedInstructions({
          projectRoot: project.canonicalPath,
          candidates: allContext,
        });

    const staleContextItems = allContext.filter((candidate) =>
      candidate.freshness?.state !== undefined && candidate.freshness.state !== "fresh"
    ).length;
    const evidenceQuality = assessContextPacketEvidenceQuality({
      request: input.request,
      primaryContext,
      relatedContext,
      graphSummary,
      freshnessGate,
      indexFreshness,
      providersFailed: [
        ...collected.providersFailed,
        ...liveTextProvidersFailed,
      ],
      budgetExhausted: ranked.budgetExhausted,
      selectionLimitHit: ranked.selectionLimitHit,
      requestedAnchorsOmitted: ranked.requestedAnchorsOmitted,
      supportingSignalsOmitted: ranked.supportingSignalsOmitted,
      changedFilesMissingOverlayCount: changedFilesMissingOverlay.length,
      requestCoverage,
    });
    const reefExecution = await buildReefToolExecution({
      toolName: "context_packet",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "allow_stale_labeled",
      queryPath: reefBacked ? "reef_materialized_view" : "direct_live",
      staleEvidenceDropped: staleActiveFindingsDropped,
      staleEvidenceLabeled: staleContextItems,
      returnedCount: allContext.length + activeFindings.length,
    });
    const providersSkipped = uniqueStrings([
      ...collected.providersSkipped,
      ...(providerEnabled(policy, "live_text_provider") &&
        input.includeLiveHints === false &&
        liveQueries.length > 0
        ? ["live_text_provider"]
        : []),
      ...(!providerEnabled(policy, "working_tree_overlay") ? ["working_tree_overlay"] : []),
      ...(!providerEnabled(policy, "reef_convention") ? ["reef_convention"] : []),
    ]);
    const providersRunDetail = [
      ...liveTextProviderRunDetails,
      ...collected.providersRunDetail,
      ...overlayProviderRunDetails,
      ...conventionProviderRunDetails,
    ];
    const providersFailed = [
      ...collected.providersFailed,
      ...liveTextProvidersFailed,
    ];
    const providersSkippedDetail = providerSkipDetails({
      skippedProviders: providersSkipped,
      policy,
      skipReasons,
    });
    const expandableToolList = includeExpandableTools
      ? expandableTools(input, project.projectId, {
          dirty: dirty || freshnessGate.status === "stale" || freshnessGate.status === "degraded",
          needsWorkingTreeOverlay: changedFilesMissingOverlay.length > 0,
          policy,
          intent,
          liveTextMisses: liveTextResult.misses,
          requestCoverage,
          omittedRequestedAnchors: ranked.omittedRequestedAnchors,
          graphSummary,
          graphQuality: evidenceQuality.graph,
        })
      : [];
    const retrievalDiagnostics = withBatchRetrievalRecommendation({
      diagnostics: buildContextPacketRetrievalDiagnostics({
        mode: policy.mode,
        intent,
        requestCoverage,
        graphQuality: evidenceQuality.graph,
        changedFileCount: input.changedFiles?.length ?? 0,
        focusFileCount: input.focusFiles?.length ?? 0,
        expandableTools: expandableToolList,
        providerRunDetails: providersRunDetail,
        providersFailed,
        providersSkippedDetail,
        liveTextMisses: liveTextResult.misses,
        totalContextCount: allContext.length,
        budgetExhausted: ranked.budgetExhausted,
        selectionLimitHit: ranked.selectionLimitHit,
        candidatesOmittedByLimit: ranked.candidatesOmittedByLimit,
        requestedAnchorsOmitted: ranked.requestedAnchorsOmitted,
        omittedRequestedAnchors: ranked.omittedRequestedAnchors,
        supportingSignalsOmitted: ranked.supportingSignalsOmitted,
      }),
      expandableTools: expandableToolList,
      evidenceLabel: evidenceQuality.label,
    });

    emitContextPacketTelemetry({
      projectStore,
      projectId: project.projectId,
      requestId: options.requestContext?.requestId,
      grade: primaryContext.length > 0 ? "full" : relatedContext.length > 0 ? "partial" : "no",
      reasonCodes: contextPacketTelemetryReasonCodes({
        primaryContextCount: primaryContext.length,
        relatedContextCount: relatedContext.length,
        dirty,
        evidenceQuality,
        retrievalDiagnostics,
        budgetExhausted: ranked.budgetExhausted,
        selectionLimitHit: ranked.selectionLimitHit,
        requestedAnchorsOmitted: ranked.requestedAnchorsOmitted,
        supportingSignalsOmitted: ranked.supportingSignalsOmitted,
      }),
      reason: `context_packet returned ${allContext.length} readable candidate(s); retrieval gate ${retrievalDiagnostics.retrievalPlan.evidenceGate.status}.`,
    });

    return {
      toolName: "context_packet",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      request: input.request,
      mode: policy.mode,
      modePolicy: contextPacketModePolicySummary({
        policy,
        includeInstructions,
        includeRisks,
        includeActiveFindings,
        includeExpandableTools,
      }),
      intent,
      primaryContext,
      relatedContext,
      activeFindings,
      symbols: collectSymbols(allContext),
      routes: collectRoutes(allContext),
      databaseObjects: collectDatabaseObjects(allContext),
      graphSummary,
      requestCoverage,
      risks,
      scopedInstructions,
      recommendedHarnessPattern: buildRecommendedHarnessPattern({
        intent,
        candidates: allContext,
        risks,
        indexFreshness,
      }),
      expandableTools: expandableToolList,
      freshnessGate,
      indexFreshness,
      evidenceQuality,
      retrievalDiagnostics,
      reefExecution,
      limits: {
        budgetTokens,
        returnedTokenEstimate: ranked.returnedTokenEstimate,
        tokenEstimateMethod: "char_div_4",
        maxPrimaryContext,
        maxRelatedContext,
        providersRun: [
          ...(liveTextResult.ran ? ["live_text_provider"] : []),
          ...collected.providersRun,
          ...(runWorkingTreeOverlayProvider ? ["working_tree_overlay"] : []),
          ...(runConventionProvider ? ["reef_convention"] : []),
        ],
        providersRunDetail: [
          ...providersRunDetail,
        ],
        providersSkipped: [
          ...providersSkipped,
        ],
        providersSkippedDetail,
        providersFailed,
        candidatesConsidered: ranked.candidatesConsidered,
        rankedCandidateCount: ranked.rankedCandidateCount,
        candidatesReturned: ranked.candidatesReturned,
        selectionLimitHit: ranked.selectionLimitHit,
        candidatesOmittedByLimit: ranked.candidatesOmittedByLimit,
        requestedAnchorsOmitted: ranked.requestedAnchorsOmitted,
        omittedRequestedAnchors: ranked.omittedRequestedAnchors,
        supportingSignalsOmitted: ranked.supportingSignalsOmitted,
      },
      warnings,
    };
  });
}
