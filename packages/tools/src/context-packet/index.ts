import { randomUUID } from "node:crypto";
import type {
  ContextPacketDatabaseObject,
  ContextPacketExpandableTool,
  ContextPacketReadableCandidate,
  ContextPacketRoute,
  ContextPacketSymbol,
  ContextPacketToolInput,
  ContextPacketToolOutput,
  IndexFreshnessDetail,
  JsonObject,
  ProjectFact,
  ProjectFinding,
} from "@mako-ai/contracts";
import { assessFileFreshness, summarizeIndexFreshnessDetails } from "@mako-ai/indexer";
import type { ProjectStore } from "@mako-ai/store";
import { getDefaultHotIndexCache } from "../hot-index/index.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { ensureProjectFresh } from "../freshness/index.js";
import { detectContextPacketIntent } from "./intent.js";
import { buildRecommendedHarnessPattern } from "./harness-patterns.js";
import { buildExpandableTool } from "./expandable-tools-catalog.js";
import {
  contextPacketModePolicySummary,
  providerEnabled,
  resolveContextPacketModePolicy,
  type ContextPacketModePolicy,
} from "./modes.js";
import { collectContextPacketProviders } from "./providers.js";
import { rankContextCandidates } from "./ranking.js";
import { detectContextPacketRisks } from "./risks.js";
import { loadScopedInstructions } from "./scoped-instructions.js";
import type { ContextPacketCandidateSeed } from "./types.js";
import { isReefBackedToolViewEnabled } from "../reef/migration-flags.js";
import { buildReefToolExecution } from "../reef/tool-execution.js";

const DEFAULT_MAX_PRIMARY_CONTEXT = 8;
const DEFAULT_MAX_RELATED_CONTEXT = 16;
const DEFAULT_BUDGET_TOKENS = 2400;
const REEF_OVERLAY_FACT_QUERY_LIMIT = 10_000;
const ACTIVE_FINDINGS_PER_CONTEXT_FILE_LIMIT = 1000;

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

function expandableTools(
  input: ContextPacketToolInput,
  projectId: string,
  args: { dirty: boolean; needsWorkingTreeOverlay: boolean; policy: ContextPacketModePolicy },
): ContextPacketExpandableTool[] {
  const ctx = { input, projectId };
  const tools: ContextPacketExpandableTool[] = args.policy.expandableTools.map(
    (name) => buildExpandableTool(name, ctx),
  );

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

  return tools;
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
    const includeRisks = input.includeRisks ?? policy.includeRisks;
    const risksMinConfidence = input.risksMinConfidence ?? 0;
    const includeInstructions = input.includeInstructions ?? policy.includeInstructions;
    const includeActiveFindings = policy.includeActiveFindings;
    const includeExpandableTools = policy.includeExpandableTools;
    const intent = detectContextPacketIntent(input);
    const freshnessGate = await ensureProjectFresh({
      project,
      projectStore,
      options,
      reason: input.freshnessPolicy === "prefer_fresh"
        ? "context_packet prefer_fresh"
        : "context_packet",
      waitWhenIdle: input.freshnessPolicy === "prefer_fresh",
    });
    const latestRun = projectStore.getLatestIndexRun();
    const hotIndexCache = options.hotIndexCache ?? getDefaultHotIndexCache();
    // Watcher-driven dirty paths trigger a path-scoped refresh in the
    // Phase 4 coordinator, which advances `latestRun.runId`. The hot
    // index keys on that runId, so a fresh index run automatically
    // invalidates and rebuilds — no explicit dirty marking needed.
    const hotIndex = hotIndexCache.getOrBuild({
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      projectStore,
      ...(latestRun?.runId ? { indexRunId: latestRun.runId } : {}),
    });

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
    const overlayCandidates = providerEnabled(policy, "working_tree_overlay")
      ? overlayFactCandidateSeeds({
          input,
          factsByPath: workingTreeOverlayFacts,
        })
      : [];
    const conventionCandidates = reefBacked && providerEnabled(policy, "reef_convention")
      ? conventionFactCandidateSeeds({
          input,
          projectStore,
          projectId: project.projectId,
        })
      : [];
    const candidateSeeds = [...collected.candidates, ...overlayCandidates, ...conventionCandidates];
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
    });
    const primaryContext = annotateContextOverlay(ranked.primaryContext, workingTreeOverlayFacts);
    const relatedContext = annotateContextOverlay(ranked.relatedContext, workingTreeOverlayFacts);
    const allContext = [...primaryContext, ...relatedContext];
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
    const warnings = [...collected.warnings, ...freshnessGate.warnings];
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
          })
        : [],
      freshnessGate,
      indexFreshness,
      reefExecution,
      limits: {
        budgetTokens,
        tokenEstimateMethod: "char_div_4",
        maxPrimaryContext,
        maxRelatedContext,
        providersRun: [
          ...collected.providersRun,
          ...(overlayCandidates.length > 0 ? ["working_tree_overlay"] : []),
          ...(conventionCandidates.length > 0 ? ["reef_convention"] : []),
        ],
        providersSkipped: [
          ...collected.providersSkipped,
          ...(!providerEnabled(policy, "working_tree_overlay") ? ["working_tree_overlay"] : []),
          ...(!providerEnabled(policy, "reef_convention") ? ["reef_convention"] : []),
        ],
        providersFailed: collected.providersFailed,
        candidatesConsidered: ranked.candidatesConsidered,
        candidatesReturned: ranked.candidatesReturned,
      },
      warnings,
    };
  });
}
