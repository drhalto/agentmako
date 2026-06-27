import { randomUUID } from "node:crypto";
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
  ContextPacketRoute,
  ContextPacketSymbol,
  ContextPacketToolInput,
  ContextPacketToolOutput,
  IndexFreshnessDetail,
  JsonObject,
  LiveTextSearchMatch,
  ProjectFact,
  ProjectFinding,
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
import { buildContextPacketRequestCoverage } from "./request-coverage.js";
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
import { rankContextCandidates } from "./ranking.js";
import { detectContextPacketRisks } from "./risks.js";
import { buildContextPacketRetrievalDiagnostics } from "./retrieval-diagnostics.js";
import { loadScopedInstructions } from "./scoped-instructions.js";
import type { ContextPacketCandidateSeed } from "./types.js";
import { isReefBackedToolViewEnabled } from "../reef/migration-flags.js";
import { buildReefToolExecution } from "../reef/tool-execution.js";

const DEFAULT_MAX_PRIMARY_CONTEXT = 8;
const DEFAULT_MAX_RELATED_CONTEXT = 16;
const DEFAULT_BUDGET_TOKENS = 2400;
const REEF_OVERLAY_FACT_QUERY_LIMIT = 10_000;
const ACTIVE_FINDINGS_PER_CONTEXT_FILE_LIMIT = 1000;
const LIVE_TEXT_QUERY_LIMIT = 3;
const LIVE_TEXT_MAX_MATCHES = 20;
const LIVE_TEXT_MAX_FILES = 10;
const LIVE_TEXT_SCOPE_LIMIT = 20;
const COVERAGE_EXPANDABLE_TOOL_LIMIT = 6;

interface ProviderSkipReason {
  reason: string;
  adaptive: boolean;
}

interface LiveTextProviderResult {
  candidates: ContextPacketCandidateSeed[];
  misses: ContextPacketLiveTextMiss[];
  warnings: string[];
  truncated: boolean;
  ran: boolean;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
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

function bestGraphAnchorFile(input: ContextPacketToolInput, graphSummary: ContextPacketGraphSummary): string | undefined {
  const anchor = graphSummary.anchorFiles[0];
  if (anchor) return normalizePath(anchor);
  const focusFile = input.focusFiles?.[0];
  if (focusFile) return normalizePath(focusFile);
  const changedFile = input.changedFiles?.[0];
  if (changedFile) return normalizePath(changedFile);
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
  return dedupeExpandableTools([
    ...scopedPrefix,
    ...(hasUnresolvedCoverage ? coverageTools : graphTools),
    ...(hasUnresolvedCoverage ? graphTools : coverageTools),
    ...remainingTools,
  ]);
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

function liveTextQueries(intent: ContextPacketIntent): string[] {
  return uniqueStrings(intent.entities.quotedText)
    .filter((value) => value.length >= 2 && value.length <= 160)
    .slice(0, LIVE_TEXT_QUERY_LIMIT);
}

function liveTextCandidateSeed(
  query: string,
  match: LiveTextSearchMatch,
  scopePath: string | undefined,
): ContextPacketCandidateSeed {
  return {
    id: `live_text_provider:${match.filePath}:${match.line}:${match.column}:${query}`,
    kind: "file",
    path: match.filePath,
    lineStart: match.line,
    lineEnd: match.line,
    source: "live_text_provider",
    strategy: "exact_match",
    whyIncluded: `Live filesystem text matched quoted literal "${query}".`,
    confidence: 0.94,
    baseScore: 68,
    metadata: {
      query,
      text: match.text,
      column: match.column,
      matchText: match.submatches[0]?.text ?? query,
      submatchCount: match.submatches.length,
      overlay: "live_filesystem",
      evidenceConfidenceLabel: "verified_live",
      liveTextProvider: "ripgrep",
      ...(scopePath ? { scopePath } : { scope: "project" }),
    },
  };
}

function liveTextMiss(query: string, scopePath: string | undefined): ContextPacketLiveTextMiss {
  return scopePath
    ? { query, scope: "file", scopePath }
    : { query, scope: "project" };
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
      "includeLiveHints=false disables live quoted-literal retrieval.",
    );
    args.enabledProviders.delete("hot_hint_index");
    return;
  }
}

function liveTextSatisfiedScopedLiteral(
  input: ContextPacketToolInput,
  result: LiveTextProviderResult,
): boolean {
  const scopes = new Set(liveTextScopes(input));
  if (!result.ran || scopes.size === 0 || result.candidates.length === 0) return false;

  return result.candidates.some((candidate) => {
    const scopePath = candidate.metadata?.scopePath;
    return typeof scopePath === "string" &&
      scopes.has(scopePath) &&
      candidate.path === scopePath;
  });
}

function applyScopedLiveTextProviderPruning(args: {
  input: ContextPacketToolInput;
  liveTextResult: LiveTextProviderResult;
  enabledProviders: Set<ContextPacketProviderName>;
  skipReasons: Map<ContextPacketProviderName, ProviderSkipReason>;
}): void {
  if (!liveTextSatisfiedScopedLiteral(args.input, args.liveTextResult)) return;

  for (const provider of [
    "hot_hint_index",
    "repo_map_provider",
    "file_provider",
    "route_provider",
    "schema_provider",
    "symbol_provider",
    "import_graph_provider",
  ] as const) {
    if (!args.enabledProviders.has(provider)) continue;
    args.enabledProviders.delete(provider);
    addProviderSkipReason(
      args.skipReasons,
      provider,
      provider === "hot_hint_index"
        ? "Scoped live quoted-literal matches already identify current file evidence; broad hot hint retrieval was skipped."
        : provider === "repo_map_provider"
          ? "Scoped live quoted-literal matches already identify current file evidence; centrality-ranked repo map context was skipped."
          : "Scoped live quoted-literal matches already identify current file evidence; semantic indexed providers were skipped.",
      true,
    );
  }
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

async function liveTextCandidateSeeds(args: {
  projectRoot: string;
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
}): Promise<LiveTextProviderResult> {
  const queries = liveTextQueries(args.intent);
  if (queries.length === 0) {
    return { candidates: [], misses: [], warnings: [], truncated: false, ran: false };
  }

  const candidates: ContextPacketCandidateSeed[] = [];
  const misses: ContextPacketLiveTextMiss[] = [];
  const warnings: string[] = [];
  let truncated = false;
  const scopes = liveTextScopes(args.input);
  if ((args.input.focusFiles?.length ?? 0) + (args.input.changedFiles?.length ?? 0) > LIVE_TEXT_SCOPE_LIMIT) {
    warnings.push(`live_text_provider: scoped literal search capped at ${LIVE_TEXT_SCOPE_LIMIT} focus/changed file(s).`);
  }
  for (const query of queries) {
    const scopePaths = scopes.length > 0 ? scopes : [undefined];
    for (const scopePath of scopePaths) {
      const result = await runRipgrepSearch(args.projectRoot, {
        query,
        ...(scopePath ? { pathGlob: scopePath } : {}),
        fixedStrings: true,
        maxMatches: scopePath ? Math.min(LIVE_TEXT_MAX_MATCHES, 5) : LIVE_TEXT_MAX_MATCHES,
        maxFiles: scopePath ? 1 : LIVE_TEXT_MAX_FILES,
      });
      if (result.matches.length === 0) {
        misses.push(liveTextMiss(query, scopePath));
      }
      candidates.push(...result.matches.map((match) => liveTextCandidateSeed(query, match, scopePath)));
      warnings.push(...result.warnings.map((warning) => `live_text_provider: ${warning}`));
      truncated ||= result.truncated;
    }
  }

  return { candidates, misses, warnings, truncated, ran: true };
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
    const literalQueries = liveTextQueries(intent);
    const runLiveTextProvider = enabledProviders.has("live_text_provider") &&
      input.includeLiveHints !== false &&
      literalQueries.length > 0;
    const liveTextProvidersFailed: string[] = [];
    const liveTextProviderRunDetails: ContextPacketProviderRunDetail[] = [];
    let liveTextResult: LiveTextProviderResult = {
      candidates: [],
      misses: [],
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
      liveTextResult,
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
    });
    const requestCoverage = buildContextPacketRequestCoverage({
      input,
      intent,
      candidates: allContext,
      liveTextMisses: liveTextResult.misses,
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

    emitContextPacketTelemetry({
      projectStore,
      projectId: project.projectId,
      requestId: options.requestContext?.requestId,
      grade: primaryContext.length > 0 ? "full" : relatedContext.length > 0 ? "partial" : "no",
      reasonCodes: [
        primaryContext.length > 0 ? "primary_context_returned" : "no_primary_context",
        dirty ? "dirty_index_reported" : "freshness_reported",
      ],
      reason: `context_packet returned ${allContext.length} readable candidate(s).`,
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
        literalQueries.length > 0
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
    const retrievalDiagnostics = buildContextPacketRetrievalDiagnostics({
      providerRunDetails: providersRunDetail,
      providersFailed,
      providersSkippedDetail,
      liveTextMisses: liveTextResult.misses,
      totalContextCount: allContext.length,
      budgetExhausted: ranked.budgetExhausted,
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
      expandableTools: includeExpandableTools
        ? expandableTools(input, project.projectId, {
            dirty: dirty || freshnessGate.status === "stale" || freshnessGate.status === "degraded",
            needsWorkingTreeOverlay: changedFilesMissingOverlay.length > 0,
            policy,
            intent,
            liveTextMisses: liveTextResult.misses,
            requestCoverage,
            graphSummary,
            graphQuality: evidenceQuality.graph,
          })
        : [],
      freshnessGate,
      indexFreshness,
      evidenceQuality,
      retrievalDiagnostics,
      reefExecution,
      limits: {
        budgetTokens,
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
        candidatesReturned: ranked.candidatesReturned,
      },
      warnings,
    };
  });
}
