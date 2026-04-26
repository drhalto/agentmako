import type { DatabaseSync } from "node:sqlite";
import type {
  AnswerComparisonChange,
  AnswerTrustFacet,
  AnswerTrustRunProvenance,
  AnswerTrustReason,
  AnswerTrustScopeRelation,
  AnswerTrustState,
  EvidenceStatus,
  JsonValue,
  SupportLevel,
} from "@mako-ai/contracts";
import { createId, hashJson } from "./hash.js";
import { parseJson, stringifyJson } from "./json.js";
import type {
  AnswerComparisonRecord as StoredAnswerComparisonRecord,
  AnswerTrustClusterRecord as StoredAnswerTrustClusterRecord,
  AnswerTrustEvaluationRecord as StoredAnswerTrustEvaluationRecord,
  SaveAnswerComparisonInput,
  SaveAnswerTrustEvaluationInput,
} from "./types.js";

interface AnswerComparisonRow {
  comparison_id: string;
  target_id: string;
  prior_trace_id: string;
  current_trace_id: string;
  provenance: AnswerTrustRunProvenance;
  raw_delta_json: string;
  summary_changes_json: string;
  meaningful_change_detected: number;
  created_at: string;
}

interface AnswerTrustClusterRow {
  cluster_id: string;
  target_id: string;
  cluster_key: string;
  packet_hash: string;
  support_level: SupportLevel;
  evidence_status: EvidenceStatus;
  first_seen_at: string;
  last_seen_at: string;
  run_count: number;
}

interface AnswerTrustEvaluationRow {
  evaluation_id: string;
  target_id: string;
  trace_id: string;
  comparison_id: string | null;
  cluster_id: string | null;
  state: AnswerTrustState;
  reasons_json: string;
  basis_trace_ids_json: string;
  conflicting_facets_json: string;
  scope_relation: AnswerTrustScopeRelation;
  age_days: number | null;
  aging_days: number | null;
  stale_days: number | null;
  created_at: string;
}

function mapAnswerComparisonRow(
  row: AnswerComparisonRow | undefined,
): StoredAnswerComparisonRecord | null {
  if (!row) return null;
  return {
    comparisonId: row.comparison_id,
    targetId: row.target_id,
    priorTraceId: row.prior_trace_id,
    currentTraceId: row.current_trace_id,
    summaryChanges: parseJson<AnswerComparisonChange[]>(row.summary_changes_json, []),
    rawDelta: parseJson<JsonValue>(row.raw_delta_json, {}),
    meaningfulChangeDetected: row.meaningful_change_detected === 1,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

function mapAnswerTrustClusterRow(
  row: AnswerTrustClusterRow | undefined,
): StoredAnswerTrustClusterRecord | null {
  if (!row) return null;
  return {
    clusterId: row.cluster_id,
    targetId: row.target_id,
    clusterKey: row.cluster_key,
    packetHash: row.packet_hash,
    supportLevel: row.support_level,
    evidenceStatus: row.evidence_status,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    runCount: row.run_count,
  };
}

function mapAnswerTrustEvaluationRow(
  row: AnswerTrustEvaluationRow | undefined,
): StoredAnswerTrustEvaluationRecord | null {
  if (!row) return null;
  return {
    evaluationId: row.evaluation_id,
    targetId: row.target_id,
    traceId: row.trace_id,
    comparisonId: row.comparison_id ?? undefined,
    clusterId: row.cluster_id ?? undefined,
    state: row.state,
    reasons: parseJson<AnswerTrustReason[]>(row.reasons_json, []),
    basisTraceIds: parseJson<string[]>(row.basis_trace_ids_json, []),
    conflictingFacets: parseJson<AnswerTrustFacet[]>(row.conflicting_facets_json, []),
    scopeRelation: row.scope_relation,
    ageDays: row.age_days ?? undefined,
    agingDays: row.aging_days ?? undefined,
    staleDays: row.stale_days ?? undefined,
    createdAt: row.created_at,
  };
}

function buildTrustClusterKey(args: {
  targetId: string;
  packetHash: string;
  supportLevel: SupportLevel;
  evidenceStatus: EvidenceStatus;
}): string {
  return hashJson(args);
}

export function ensureAnswerTrustClusterImpl(
  db: DatabaseSync,
  args: {
    targetId: string;
    packetHash: string;
    supportLevel: SupportLevel;
    evidenceStatus: EvidenceStatus;
    seenAt?: string;
    runCount?: number;
  },
): StoredAnswerTrustClusterRecord {
  const seenAt = args.seenAt ?? new Date().toISOString();
  const runCount = Math.max(1, args.runCount ?? 1);
  const clusterKey = buildTrustClusterKey({
    targetId: args.targetId,
    packetHash: args.packetHash,
    supportLevel: args.supportLevel,
    evidenceStatus: args.evidenceStatus,
  });
  const existing = db
    .prepare(`
      SELECT
        cluster_id,
        target_id,
        cluster_key,
        packet_hash,
        support_level,
        evidence_status,
        first_seen_at,
        last_seen_at,
        run_count
      FROM answer_trust_clusters
      WHERE target_id = ?
        AND cluster_key = ?
      LIMIT 1
    `)
    .get(args.targetId, clusterKey) as AnswerTrustClusterRow | undefined;

  if (existing) {
    db.prepare(`
      UPDATE answer_trust_clusters
      SET last_seen_at = ?,
          run_count = CASE
            WHEN run_count < ? THEN ?
            ELSE run_count
          END
      WHERE cluster_id = ?
    `).run(seenAt, runCount, runCount, existing.cluster_id);
    return getAnswerTrustClusterImpl(db, existing.cluster_id) as StoredAnswerTrustClusterRecord;
  }

  const clusterId = createId("answer_cluster");
  db.prepare(`
    INSERT INTO answer_trust_clusters(
      cluster_id,
      target_id,
      cluster_key,
      packet_hash,
      support_level,
      evidence_status,
      first_seen_at,
      last_seen_at,
      run_count
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    clusterId,
    args.targetId,
    clusterKey,
    args.packetHash,
    args.supportLevel,
    args.evidenceStatus,
    seenAt,
    seenAt,
    runCount,
  );

  return getAnswerTrustClusterImpl(db, clusterId) as StoredAnswerTrustClusterRecord;
}

export function insertAnswerComparisonImpl(
  db: DatabaseSync,
  input: SaveAnswerComparisonInput,
): StoredAnswerComparisonRecord {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const comparisonId = createId("answer_compare");
  db.prepare(`
    INSERT INTO answer_comparisons(
      comparison_id,
      target_id,
      prior_trace_id,
      current_trace_id,
      provenance,
      raw_delta_json,
      summary_changes_json,
      meaningful_change_detected,
      created_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    comparisonId,
    input.targetId,
    input.priorTraceId,
    input.currentTraceId,
    input.provenance,
    stringifyJson(input.rawDelta),
    stringifyJson(input.summaryChanges),
    input.meaningfulChangeDetected ? 1 : 0,
    createdAt,
  );

  return getAnswerComparisonImpl(db, comparisonId) as StoredAnswerComparisonRecord;
}

export function getAnswerComparisonImpl(
  db: DatabaseSync,
  comparisonId: string,
): StoredAnswerComparisonRecord | null {
  const row = db
    .prepare(`
      SELECT
        comparison_id,
        target_id,
        prior_trace_id,
        current_trace_id,
        provenance,
        raw_delta_json,
        summary_changes_json,
        meaningful_change_detected,
        created_at
      FROM answer_comparisons
      WHERE comparison_id = ?
    `)
    .get(comparisonId) as AnswerComparisonRow | undefined;

  return mapAnswerComparisonRow(row);
}

export function getAnswerComparisonByRunPairImpl(
  db: DatabaseSync,
  args: { priorTraceId: string; currentTraceId: string },
): StoredAnswerComparisonRecord | null {
  const row = db
    .prepare(`
      SELECT
        comparison_id,
        target_id,
        prior_trace_id,
        current_trace_id,
        provenance,
        raw_delta_json,
        summary_changes_json,
        meaningful_change_detected,
        created_at
      FROM answer_comparisons
      WHERE prior_trace_id = ?
        AND current_trace_id = ?
      LIMIT 1
    `)
    .get(args.priorTraceId, args.currentTraceId) as AnswerComparisonRow | undefined;

  return mapAnswerComparisonRow(row);
}

export function getLatestAnswerComparisonImpl(
  db: DatabaseSync,
  targetId: string,
): StoredAnswerComparisonRecord | null {
  const row = db
    .prepare(`
      SELECT
        comparison_id,
        target_id,
        prior_trace_id,
        current_trace_id,
        provenance,
        raw_delta_json,
        summary_changes_json,
        meaningful_change_detected,
        created_at
      FROM answer_comparisons
      WHERE target_id = ?
      ORDER BY created_at DESC, comparison_id DESC
      LIMIT 1
    `)
    .get(targetId) as AnswerComparisonRow | undefined;

  return mapAnswerComparisonRow(row);
}

export function listAnswerComparisonsImpl(
  db: DatabaseSync,
  args: { targetId: string; limit?: number },
): StoredAnswerComparisonRecord[] {
  const limit = Math.max(1, Math.min(500, args.limit ?? 25));
  const rows = db
    .prepare(`
      SELECT
        comparison_id,
        target_id,
        prior_trace_id,
        current_trace_id,
        provenance,
        raw_delta_json,
        summary_changes_json,
        meaningful_change_detected,
        created_at
      FROM answer_comparisons
      WHERE target_id = ?
      ORDER BY created_at DESC, comparison_id DESC
      LIMIT ?
    `)
    .all(args.targetId, limit) as unknown as AnswerComparisonRow[];

  return rows
    .map((row) => mapAnswerComparisonRow(row))
    .filter((row): row is StoredAnswerComparisonRecord => row != null);
}

export function insertAnswerTrustEvaluationImpl(
  db: DatabaseSync,
  input: SaveAnswerTrustEvaluationInput,
): StoredAnswerTrustEvaluationRecord {
  const latest = getLatestAnswerTrustEvaluationForTraceImpl(db, input.traceId);
  if (
    latest &&
    hashJson({
      targetId: latest.targetId,
      traceId: latest.traceId,
      comparisonId: latest.comparisonId ?? null,
      clusterId: latest.clusterId ?? null,
      state: latest.state,
      reasons: latest.reasons,
      basisTraceIds: latest.basisTraceIds,
      conflictingFacets: latest.conflictingFacets,
      scopeRelation: latest.scopeRelation,
      ageDays: latest.ageDays ?? null,
      agingDays: latest.agingDays ?? null,
      staleDays: latest.staleDays ?? null,
    }) ===
      hashJson({
        targetId: input.targetId,
        traceId: input.traceId,
        comparisonId: input.comparisonId ?? null,
        clusterId: input.clusterId ?? null,
        state: input.state,
        reasons: input.reasons,
        basisTraceIds: input.basisTraceIds ?? [],
        conflictingFacets: input.conflictingFacets ?? [],
        scopeRelation: input.scopeRelation ?? "none",
        ageDays: input.ageDays ?? null,
        agingDays: input.agingDays ?? null,
        staleDays: input.staleDays ?? null,
      })
  ) {
    return latest;
  }

  const evaluationId = createId("answer_trust");
  const createdAt = input.createdAt ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO answer_trust_evaluations(
      evaluation_id,
      target_id,
      trace_id,
      comparison_id,
      cluster_id,
      state,
      reasons_json,
      basis_trace_ids_json,
      conflicting_facets_json,
      scope_relation,
      age_days,
      aging_days,
      stale_days,
      created_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evaluationId,
    input.targetId,
    input.traceId,
    input.comparisonId ?? null,
    input.clusterId ?? null,
    input.state,
    stringifyJson(input.reasons),
    stringifyJson(input.basisTraceIds ?? []),
    stringifyJson(input.conflictingFacets ?? []),
    input.scopeRelation ?? "none",
    input.ageDays ?? null,
    input.agingDays ?? null,
    input.staleDays ?? null,
    createdAt,
  );

  return getAnswerTrustEvaluationImpl(db, evaluationId) as StoredAnswerTrustEvaluationRecord;
}

export function getAnswerTrustClusterImpl(
  db: DatabaseSync,
  clusterId: string,
): StoredAnswerTrustClusterRecord | null {
  const row = db
    .prepare(`
      SELECT
        cluster_id,
        target_id,
        cluster_key,
        packet_hash,
        support_level,
        evidence_status,
        first_seen_at,
        last_seen_at,
        run_count
      FROM answer_trust_clusters
      WHERE cluster_id = ?
      LIMIT 1
    `)
    .get(clusterId) as AnswerTrustClusterRow | undefined;

  return mapAnswerTrustClusterRow(row);
}

export function listAnswerTrustClustersImpl(
  db: DatabaseSync,
  args: { targetId: string; limit?: number },
): StoredAnswerTrustClusterRecord[] {
  const limit = Math.max(1, Math.min(500, args.limit ?? 25));
  const rows = db
    .prepare(`
      SELECT
        cluster_id,
        target_id,
        cluster_key,
        packet_hash,
        support_level,
        evidence_status,
        first_seen_at,
        last_seen_at,
        run_count
      FROM answer_trust_clusters
      WHERE target_id = ?
      ORDER BY last_seen_at DESC, cluster_id DESC
      LIMIT ?
    `)
    .all(args.targetId, limit) as unknown as AnswerTrustClusterRow[];

  return rows
    .map((row) => mapAnswerTrustClusterRow(row))
    .filter((row): row is StoredAnswerTrustClusterRecord => row != null);
}

export function getAnswerTrustEvaluationImpl(
  db: DatabaseSync,
  evaluationId: string,
): StoredAnswerTrustEvaluationRecord | null {
  const row = db
    .prepare(`
      SELECT
        evaluation_id,
        target_id,
        trace_id,
        comparison_id,
        cluster_id,
        state,
        reasons_json,
        basis_trace_ids_json,
        conflicting_facets_json,
        scope_relation,
        age_days,
        aging_days,
        stale_days,
        created_at
      FROM answer_trust_evaluations
      WHERE evaluation_id = ?
      LIMIT 1
    `)
    .get(evaluationId) as AnswerTrustEvaluationRow | undefined;

  return mapAnswerTrustEvaluationRow(row);
}

export function getLatestAnswerTrustEvaluationForTraceImpl(
  db: DatabaseSync,
  traceId: string,
): StoredAnswerTrustEvaluationRecord | null {
  const row = db
    .prepare(`
      SELECT
        evaluation_id,
        target_id,
        trace_id,
        comparison_id,
        cluster_id,
        state,
        reasons_json,
        basis_trace_ids_json,
        conflicting_facets_json,
        scope_relation,
        age_days,
        aging_days,
        stale_days,
        created_at
      FROM answer_trust_evaluations
      WHERE trace_id = ?
      ORDER BY created_at DESC, evaluation_id DESC
      LIMIT 1
    `)
    .get(traceId) as AnswerTrustEvaluationRow | undefined;

  return mapAnswerTrustEvaluationRow(row);
}

export function getLatestAnswerTrustEvaluationForTargetImpl(
  db: DatabaseSync,
  targetId: string,
): StoredAnswerTrustEvaluationRecord | null {
  const row = db
    .prepare(`
      SELECT
        evaluation_id,
        target_id,
        trace_id,
        comparison_id,
        cluster_id,
        state,
        reasons_json,
        basis_trace_ids_json,
        conflicting_facets_json,
        scope_relation,
        age_days,
        aging_days,
        stale_days,
        created_at
      FROM answer_trust_evaluations
      WHERE target_id = ?
      ORDER BY created_at DESC, evaluation_id DESC
      LIMIT 1
    `)
    .get(targetId) as AnswerTrustEvaluationRow | undefined;

  return mapAnswerTrustEvaluationRow(row);
}

export function listAnswerTrustEvaluationsImpl(
  db: DatabaseSync,
  args: { targetId: string; limit?: number },
): StoredAnswerTrustEvaluationRecord[] {
  const limit = Math.max(1, Math.min(500, args.limit ?? 50));
  const rows = db
    .prepare(`
      SELECT
        evaluation_id,
        target_id,
        trace_id,
        comparison_id,
        cluster_id,
        state,
        reasons_json,
        basis_trace_ids_json,
        conflicting_facets_json,
        scope_relation,
        age_days,
        aging_days,
        stale_days,
        created_at
      FROM answer_trust_evaluations
      WHERE target_id = ?
      ORDER BY created_at DESC, evaluation_id DESC
      LIMIT ?
    `)
    .all(args.targetId, limit) as unknown as AnswerTrustEvaluationRow[];

  return rows
    .map((row) => mapAnswerTrustEvaluationRow(row))
    .filter((row): row is StoredAnswerTrustEvaluationRecord => row != null);
}
