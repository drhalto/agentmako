import type {
  AnswerTrustFacet,
  AnswerTrustClusterRecord,
  AnswerTrustEvaluationRecord,
  AnswerTrustReason,
  AnswerTrustScopeRelation,
  AnswerTrustState,
  JsonObject,
  ProjectLocatorInput,
  QueryKind,
} from "@mako-ai/contracts";
import { hashJson, type AnswerComparableTargetRecord, type AnswerComparisonRecord, type AnswerTrustRunRecord, type SavedAnswerTraceRecord } from "@mako-ai/store";
import { MakoToolError } from "../errors.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { DAY_MS } from "../time.js";
import { resolveTrustTargetAndRun } from "./common.js";

export const AGING_DAYS = 30;
export const STALE_DAYS = 90;
const GENERIC_QUERY_TERMS = new Set([
  "about",
  "already",
  "data",
  "does",
  "file",
  "from",
  "handled",
  "how",
  "into",
  "page",
  "route",
  "show",
  "table",
  "there",
  "this",
  "what",
  "where",
  "which",
  "why",
]);

export interface EvaluateTrustStateInput extends ProjectLocatorInput {
  traceId?: string;
  targetId?: string;
  evaluatedAt?: string;
}

export interface EvaluateTrustStateResult {
  target: AnswerComparableTargetRecord;
  subjectRun: AnswerTrustRunRecord;
  subjectTrace: SavedAnswerTraceRecord;
  subjectCluster: AnswerTrustClusterRecord;
  comparison: AnswerComparisonRecord | null;
  evaluation: AnswerTrustEvaluationRecord;
  relatedEvaluations: AnswerTrustEvaluationRecord[];
  clusters: AnswerTrustClusterRecord[];
}

function buildClusterKey(
  targetId: string,
  run: AnswerTrustRunRecord,
  trace: SavedAnswerTraceRecord,
): string {
  return hashJson({
    targetId,
    packetHash: run.packetHash,
    supportLevel: trace.supportLevel,
    evidenceStatus: trace.evidenceStatus,
  });
}

function normalizeEvaluationTime(value?: string): string {
  return value ?? new Date().toISOString();
}

function freshnessEnabled(queryKind: QueryKind): boolean {
  return queryKind !== "free_form";
}

function computeAgeDays(createdAt: string, evaluatedAt: string): number {
  const ageMs = new Date(evaluatedAt).getTime() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(ageMs / DAY_MS));
}

function isInsufficientEvidence(trace: SavedAnswerTraceRecord): boolean {
  return (
    trace.evidenceStatus === "partial" ||
    trace.packet.missingInformation.length > 0 ||
    trace.packet.evidence.length === 0 ||
    trace.supportLevel === "best_effort"
  );
}

function isExternalImportEvidence(
  block: SavedAnswerTraceRecord["packet"]["evidence"][number],
): boolean {
  // `blocksFromImportEdges` sets `stale: true` whenever the target of an
  // import is not in the local index — which is always the case for
  // node_modules / external packages. That's not content staleness, it's a
  // reflection of the indexer's scope. Treat those blocks as external rather
  // than stale so trust classification doesn't collapse to "stale" for every
  // answer that touches a file importing from any npm package.
  const metadata = block.metadata as { targetExists?: boolean } | undefined;
  return block.kind === "file" && metadata?.targetExists === false;
}

function hasExplicitStaleSignal(trace: SavedAnswerTraceRecord): boolean {
  if (trace.packet.stalenessFlags.length > 0) {
    return true;
  }
  return trace.packet.evidence.some(
    (block) => block.stale === true && !isExternalImportEvidence(block),
  );
}

function environmentFingerprintsShareScope(
  olderRun: AnswerTrustRunRecord,
  newerRun: AnswerTrustRunRecord,
): boolean {
  const older = olderRun.environmentFingerprint;
  const newer = newerRun.environmentFingerprint;

  // `indexRunId` tracks refresh churn, not stable validity scope. Prefer durable
  // substrate markers when they exist, and treat missing markers as unknown rather
  // than "changed scope" by default.
  if (
    older.gitHead != null ||
    newer.gitHead != null ||
    older.schemaSnapshotId != null ||
    newer.schemaSnapshotId != null ||
    older.schemaFingerprint != null ||
    newer.schemaFingerprint != null
  ) {
    return (
      older.gitHead === newer.gitHead &&
      older.schemaSnapshotId === newer.schemaSnapshotId &&
      older.schemaFingerprint === newer.schemaFingerprint
    );
  }

  return true;
}

function isStrongComparable(trace: SavedAnswerTraceRecord): boolean {
  return trace.evidenceStatus === "complete" && trace.supportLevel !== "best_effort";
}

function deriveConflictingFacets(comparison: AnswerComparisonRecord | null): AnswerTrustFacet[] {
  const facets = new Set<AnswerTrustFacet>();

  for (const change of comparison?.summaryChanges ?? []) {
    switch (change.code) {
      case "core_claim_conflict":
        facets.add("core_claim");
        break;
      case "answer_status_changed":
        facets.add("answer_status");
        break;
      case "support_level_changed":
        facets.add("support_level");
        break;
      case "answer_confidence_changed":
        facets.add("answer_confidence");
        break;
      case "evidence_added":
      case "evidence_removed":
        facets.add("evidence_set");
        break;
      case "missing_info_added":
      case "missing_info_removed":
        facets.add("missing_information");
        break;
      case "staleness_flag_added":
      case "staleness_flag_removed":
        facets.add("staleness");
        break;
      case "answer_markdown_changed":
        facets.add("answer_markdown");
        break;
    }
  }

  return [...facets].sort((left, right) => left.localeCompare(right));
}

function resolveScopeRelation(scopeChanged: boolean): AnswerTrustScopeRelation {
  return scopeChanged ? "changed_scope" : "same_scope";
}

function hasCoreClaimConflict(comparison: AnswerComparisonRecord | null): boolean {
  return comparison?.summaryChanges.some((change) => change.code === "core_claim_conflict") ?? false;
}

function normalizeQueryTerms(queryText: string): string[] {
  return [...new Set(queryText.toLowerCase().match(/[a-z0-9_]+/g) ?? [])].filter(
    (term) => term.length >= 4 && !GENERIC_QUERY_TERMS.has(term),
  );
}

const QUERY_EVIDENCE_MISMATCH_KINDS: ReadonlySet<QueryKind> = new Set<QueryKind>([
  "free_form",
  "cross_search",
]);

function hasQueryEvidenceMismatch(trace: SavedAnswerTraceRecord): boolean {
  if (!QUERY_EVIDENCE_MISMATCH_KINDS.has(trace.queryKind) || trace.packet.evidence.length === 0) {
    return false;
  }

  const queryTerms = normalizeQueryTerms(trace.packet.queryText);
  if (queryTerms.length === 0) {
    return false;
  }

  const evidenceHaystack = trace.packet.evidence
    .map((block) => `${block.title} ${block.sourceRef} ${block.filePath ?? ""} ${block.content.slice(0, 400)}`)
    .join(" ")
    .toLowerCase();

  return !queryTerms.some((term) => evidenceHaystack.includes(term));
}

function buildLatestReasons(args: {
  state: Exclude<AnswerTrustState, "superseded" | "contradicted">;
  trace: SavedAnswerTraceRecord;
  comparison: AnswerComparisonRecord | null;
  ageDays?: number;
  scopeChanged?: boolean;
}): AnswerTrustReason[] {
  const reasons: AnswerTrustReason[] = [];

  switch (args.state) {
    case "stable":
      reasons.push({ code: "no_meaningful_change", detail: "latest comparable run did not produce a meaningful change." });
      break;
    case "changed":
      reasons.push({
        code: "meaningful_change_detected",
        detail: "latest comparable run changed evidence or support materially without meeting contradiction rules.",
      });
      if (args.scopeChanged) {
        reasons.push({
          code: "scope_changed",
          detail: "the latest comparable run was evaluated under a different environment fingerprint than the prior run.",
        });
      }
      break;
    case "aging":
      reasons.push({
        code: "freshness_warning",
        detail: `latest comparable run is ${args.ageDays ?? 0} days old, beyond the aging threshold.`,
      });
      break;
    case "stale":
      if (hasExplicitStaleSignal(args.trace)) {
        reasons.push({
          code: "packet_staleness_flag",
          detail: "packet staleness flags or stale evidence blocks were present on the latest run.",
        });
      } else {
        reasons.push({
          code: "freshness_expired",
          detail: `latest comparable run is ${args.ageDays ?? 0} days old, beyond the stale threshold.`,
        });
      }
      break;
    case "insufficient_evidence":
      if (args.trace.evidenceStatus === "partial") {
        reasons.push({ code: "partial_evidence", detail: "latest comparable run still has partial evidence coverage." });
      }
      if (args.trace.packet.missingInformation.length > 0) {
        reasons.push({
          code: "missing_information",
          detail: `latest comparable run still reports missing information: ${args.trace.packet.missingInformation.join(", ")}.`,
        });
      }
      if (args.trace.supportLevel === "best_effort") {
        reasons.push({
          code: "best_effort_support",
          detail: "latest comparable run is only supported at best-effort level.",
        });
      }
      if (hasQueryEvidenceMismatch(args.trace)) {
        reasons.push({
          code: "query_evidence_mismatch",
          detail: "latest comparable run used evidence that does not directly overlap the key query terms.",
        });
      }
      break;
  }

  if (args.comparison?.meaningfulChangeDetected) {
    reasons.push({
      code: "meaningful_change_detected",
      detail: `comparison ${args.comparison.comparisonId} recorded a meaningful change against the previous run.`,
    });
  }

  return reasons;
}

function buildOlderReasons(args: {
  state: "superseded" | "contradicted" | "changed";
  newerRun: AnswerTrustRunRecord;
  comparison: AnswerComparisonRecord | null;
  scopeChanged?: boolean;
}): AnswerTrustReason[] {
  const reasons: AnswerTrustReason[] = [];

  if (args.state === "changed") {
    reasons.push({
      code: "scope_changed",
      detail: `a newer comparable run (${args.newerRun.traceId}) was evaluated under a different environment fingerprint for the same target.`,
    });
  } else {
    reasons.push({
      code: "superseded_by_newer_run",
      detail: `a newer comparable run (${args.newerRun.traceId}) exists for this target.`,
    });
  }

  if (args.state === "contradicted") {
    reasons.push({
      code: "conflicting_cluster_detected",
      detail: "a newer strong comparable run produced a materially different packet for the same target.",
    });
  }

  if (args.comparison?.meaningfulChangeDetected) {
    reasons.push({
      code: "meaningful_change_detected",
      detail: `comparison ${args.comparison.comparisonId} recorded a meaningful change against the newer run.`,
    });
  }

  return reasons;
}

function shouldMarkOlderRunContradicted(args: {
  olderTrace: SavedAnswerTraceRecord;
  newerTrace: SavedAnswerTraceRecord;
  olderRun: AnswerTrustRunRecord;
  newerRun: AnswerTrustRunRecord;
  comparison: AnswerComparisonRecord | null;
}): boolean {
  // Older runs are classified as changed/superseded/contradicted before any newer insufficiency heuristics apply.
  if (!args.comparison?.meaningfulChangeDetected) {
    return false;
  }

  if (args.olderRun.packetHash === args.newerRun.packetHash) {
    return false;
  }

  if (!hasCoreClaimConflict(args.comparison)) {
    return false;
  }

  return isStrongComparable(args.olderTrace) && isStrongComparable(args.newerTrace);
}

export async function evaluateTrustState(
  input: EvaluateTrustStateInput,
  options: ToolServiceOptions = {},
): Promise<EvaluateTrustStateResult> {
  const evaluatedAt = normalizeEvaluationTime(input.evaluatedAt);

  return withProjectContext(input, options, async ({ projectStore }) => {
    const { run: subjectRun } = resolveTrustTargetAndRun(projectStore, input);
    const target = subjectRun.target;
    const subjectTrace = projectStore.getAnswerTrace(subjectRun.traceId);
    if (!subjectTrace) {
      throw new MakoToolError(404, "trust_run_not_found", `Missing answer trace for trust run ${subjectRun.traceId}.`);
    }

    const history = projectStore.listComparableAnswerRuns({ traceId: subjectRun.traceId, limit: 200 });
    const subjectIndex = history.findIndex((run) => run.traceId === subjectRun.traceId);
    if (subjectIndex < 0) {
      throw new Error(`Comparable history for ${subjectRun.traceId} did not include the subject run.`);
    }

    const traceById = new Map<string, SavedAnswerTraceRecord>();
    for (const run of history) {
      const trace = projectStore.getAnswerTrace(run.traceId);
      if (!trace) {
        throw new Error(`Comparable history is missing trace ${run.traceId}.`);
      }
      traceById.set(run.traceId, trace);
    }

    const clusterCounts = new Map<string, number>();
    for (const run of history) {
      const trace = traceById.get(run.traceId) as SavedAnswerTraceRecord;
      const key = buildClusterKey(target.targetId, run, trace);
      clusterCounts.set(key, (clusterCounts.get(key) ?? 0) + 1);
    }

    const clusterByTraceId = new Map<string, AnswerTrustClusterRecord>();
    for (const run of history) {
      const trace = traceById.get(run.traceId) as SavedAnswerTraceRecord;
      const clusterKey = buildClusterKey(target.targetId, run, trace);
      const cluster = projectStore.ensureAnswerTrustCluster({
        targetId: target.targetId,
        packetHash: run.packetHash,
        supportLevel: trace.supportLevel,
        evidenceStatus: trace.evidenceStatus,
        seenAt: evaluatedAt,
        runCount: clusterCounts.get(clusterKey) ?? 1,
      });
      clusterByTraceId.set(run.traceId, cluster);
    }

    const latestRun = history[0] as AnswerTrustRunRecord;
    const latestTrace = traceById.get(latestRun.traceId) as SavedAnswerTraceRecord;
    const subjectCluster = clusterByTraceId.get(subjectRun.traceId) as AnswerTrustClusterRecord;
    const relatedEvaluations: AnswerTrustEvaluationRecord[] = [];

    let comparison: AnswerComparisonRecord | null = null;
    let state: AnswerTrustState;
    let reasons: AnswerTrustReason[];
    let basisTraceIds: string[] = [];
    let conflictingFacets: AnswerTrustFacet[] = [];
    let scopeRelation: AnswerTrustScopeRelation = "none";
    let ageDays: number | undefined;
    let agingDays: number | undefined;
    let staleDays: number | undefined;

    if (subjectIndex > 0) {
      const newerRun = history[subjectIndex - 1] as AnswerTrustRunRecord;
      const newerTrace = traceById.get(newerRun.traceId) as SavedAnswerTraceRecord;
      const scopeChanged = !environmentFingerprintsShareScope(subjectRun, newerRun);
      scopeRelation = resolveScopeRelation(scopeChanged);
      comparison = projectStore.getAnswerComparisonByRunPair({
        priorTraceId: subjectRun.traceId,
        currentTraceId: newerRun.traceId,
      });
      basisTraceIds = [newerRun.traceId];
      conflictingFacets = deriveConflictingFacets(comparison);
      if (
        !scopeChanged &&
        shouldMarkOlderRunContradicted({
          olderTrace: subjectTrace,
          newerTrace,
          olderRun: subjectRun,
          newerRun,
          comparison,
        })
      ) {
        state = "contradicted";
      } else if (scopeChanged && comparison?.meaningfulChangeDetected) {
        state = "changed";
      } else {
        state = "superseded";
      }
      reasons = buildOlderReasons({ state, newerRun, comparison, scopeChanged });
    } else {
      const previousRun = history[1] ?? null;
      const scopeChanged = previousRun
        ? !environmentFingerprintsShareScope(previousRun, subjectRun)
        : false;
      scopeRelation = previousRun ? resolveScopeRelation(scopeChanged) : "none";
      comparison = previousRun
        ? projectStore.getAnswerComparisonByRunPair({
            priorTraceId: previousRun.traceId,
            currentTraceId: subjectRun.traceId,
          })
        : null;
      basisTraceIds = previousRun ? [previousRun.traceId] : [];
      conflictingFacets = deriveConflictingFacets(comparison);

      if (freshnessEnabled(subjectTrace.queryKind)) {
        ageDays = computeAgeDays(subjectRun.createdAt, evaluatedAt);
        agingDays = AGING_DAYS;
        staleDays = STALE_DAYS;
      }

      if (isInsufficientEvidence(subjectTrace) || hasQueryEvidenceMismatch(subjectTrace)) {
        state = "insufficient_evidence";
      } else if ((ageDays != null && ageDays >= STALE_DAYS) || hasExplicitStaleSignal(subjectTrace)) {
        state = "stale";
      } else if (ageDays != null && ageDays >= AGING_DAYS) {
        state = "aging";
      } else if (comparison?.meaningfulChangeDetected) {
        state = "changed";
      } else {
        state = "stable";
      }

      reasons = buildLatestReasons({
        state,
        trace: subjectTrace,
        comparison,
        ageDays,
        scopeChanged,
      });

      if (previousRun) {
        const previousTrace = traceById.get(previousRun.traceId) as SavedAnswerTraceRecord;
        const previousCluster = clusterByTraceId.get(previousRun.traceId) as AnswerTrustClusterRecord;
        const previousScopeChanged = !environmentFingerprintsShareScope(previousRun, latestRun);
        const previousState: AnswerTrustState =
          !previousScopeChanged &&
          shouldMarkOlderRunContradicted({
            olderTrace: previousTrace,
            newerTrace: latestTrace,
            olderRun: previousRun,
            newerRun: latestRun,
            comparison,
          })
            ? "contradicted"
            : previousScopeChanged && comparison?.meaningfulChangeDetected
              ? "changed"
              : "superseded";
        relatedEvaluations.push(
          projectStore.insertAnswerTrustEvaluation({
            targetId: target.targetId,
            traceId: previousRun.traceId,
            comparisonId: comparison?.comparisonId,
            clusterId: previousCluster.clusterId,
            state: previousState,
            reasons: buildOlderReasons({
              state: previousState as "superseded" | "contradicted" | "changed",
              newerRun: latestRun,
              comparison,
              scopeChanged: previousScopeChanged,
            }),
            basisTraceIds: [latestRun.traceId],
            conflictingFacets,
            scopeRelation: resolveScopeRelation(previousScopeChanged),
            createdAt: evaluatedAt,
          }),
        );
      }
    }

    const evaluation = projectStore.insertAnswerTrustEvaluation({
      targetId: target.targetId,
      traceId: subjectRun.traceId,
      comparisonId: comparison?.comparisonId,
      clusterId: subjectCluster.clusterId,
      state,
      reasons,
      basisTraceIds,
      conflictingFacets,
      scopeRelation,
      ageDays,
      agingDays,
      staleDays,
      createdAt: evaluatedAt,
    });

    return {
      target,
      subjectRun,
      subjectTrace,
      subjectCluster,
      comparison,
      evaluation,
      relatedEvaluations,
      clusters: projectStore.listAnswerTrustClusters(target.targetId),
    };
  });
}
