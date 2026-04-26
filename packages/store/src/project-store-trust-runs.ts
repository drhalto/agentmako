import type { DatabaseSync } from "node:sqlite";
import type {
  AnswerEnvironmentFingerprint,
  AnswerResult,
  AnswerTrustRunProvenance,
} from "@mako-ai/contracts";
import { createId, hashText } from "./hash.js";
import { parseJson, stringifyJson } from "./json.js";
import type {
  AnswerComparableTargetRecord,
  AnswerTrustRunRecord,
  SaveAnswerTrustRunOptions,
} from "./types.js";
import {
  type AnswerComparableTargetRow,
  type ComparableAnswerLocator,
  type TrustBackfillRow,
  UNKNOWN_ENVIRONMENT_FINGERPRINT,
  buildComparableAnswerIdentity,
  buildEnvironmentFingerprint,
  findPreviousTrustRun,
  getPacketHashes,
  mapComparableTargetRow,
  normalizeEnvironmentFingerprint,
  parseStoredPacket,
} from "./project-store-trust-helpers.js";

interface AnswerTrustRunRow {
  trace_id: string;
  target_id: string;
  previous_trace_id: string | null;
  provenance: AnswerTrustRunProvenance;
  packet_hash: string;
  raw_packet_hash: string | null;
  previous_packet_hash: string | null;
  answer_hash: string | null;
  environment_fingerprint_json: string | null;
  created_at: string;
}

export function getAnswerComparableTargetImpl(
  db: DatabaseSync,
  targetId: string,
): AnswerComparableTargetRecord | null {
  const row = db
    .prepare(`
      SELECT
        target_id,
        project_id,
        query_kind,
        normalized_query_text,
        comparison_key,
        identity_json,
        first_seen_at,
        last_seen_at
      FROM answer_comparable_targets
      WHERE target_id = ?
    `)
    .get(targetId) as AnswerComparableTargetRow | undefined;

  return mapComparableTargetRow(row);
}

function ensureComparableTargetImpl(
  db: DatabaseSync,
  locator: ComparableAnswerLocator,
  seenAt: string,
): AnswerComparableTargetRecord {
  const identity = buildComparableAnswerIdentity(locator);
  const existing = db
    .prepare(`
      SELECT
        target_id,
        project_id,
        query_kind,
        normalized_query_text,
        comparison_key,
        identity_json,
        first_seen_at,
        last_seen_at
      FROM answer_comparable_targets
      WHERE comparison_key = ?
    `)
    .get(identity.comparisonKey) as AnswerComparableTargetRow | undefined;

  if (existing) {
    db.prepare(`
      UPDATE answer_comparable_targets
      SET
        normalized_query_text = ?,
        identity_json = ?,
        last_seen_at = CASE
          WHEN last_seen_at < ? THEN ?
          ELSE last_seen_at
        END
      WHERE target_id = ?
    `).run(
      identity.normalizedQueryText,
      stringifyJson(identity.identity),
      seenAt,
      seenAt,
      existing.target_id,
    );
    return getAnswerComparableTargetImpl(db, existing.target_id) as AnswerComparableTargetRecord;
  }

  const targetId = createId("answer_target");
  db.prepare(`
    INSERT INTO answer_comparable_targets(
      target_id,
      project_id,
      query_kind,
      normalized_query_text,
      comparison_key,
      identity_json,
      first_seen_at,
      last_seen_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    targetId,
    locator.projectId,
    locator.queryKind,
    identity.normalizedQueryText,
    identity.comparisonKey,
    stringifyJson(identity.identity),
    seenAt,
    seenAt,
  );

  return getAnswerComparableTargetImpl(db, targetId) as AnswerComparableTargetRecord;
}

function mapTrustRunRow(
  row: (AnswerTrustRunRow & AnswerComparableTargetRow) | undefined,
): AnswerTrustRunRecord | null {
  if (!row) return null;
  const target = mapComparableTargetRow(row);
  if (!target) return null;
  return {
    traceId: row.trace_id,
    targetId: row.target_id,
    previousTraceId: row.previous_trace_id ?? undefined,
    provenance: row.provenance,
    packetHash: row.packet_hash,
    rawPacketHash: row.raw_packet_hash ?? row.packet_hash,
    previousPacketHash: row.previous_packet_hash ?? undefined,
    answerHash: row.answer_hash ?? undefined,
    environmentFingerprint: normalizeEnvironmentFingerprint(
      parseJson<Partial<AnswerEnvironmentFingerprint>>(row.environment_fingerprint_json, UNKNOWN_ENVIRONMENT_FINGERPRINT),
    ),
    createdAt: row.created_at,
    target,
  };
}

export function saveAnswerTrustRunImpl(
  db: DatabaseSync,
  result: AnswerResult,
  options: SaveAnswerTrustRunOptions = {},
  createdAt = new Date().toISOString(),
): AnswerTrustRunRecord {
  const target = ensureComparableTargetImpl(
    db,
    {
      projectId: result.projectId,
      queryKind: result.queryKind,
      queryText: result.packet.queryText,
      identity: options.identity,
    },
    createdAt,
  );
  const previousRun = findPreviousTrustRun(db, target.targetId, result.queryId);
  const { packetHash, rawPacketHash } = getPacketHashes(result.packet);
  const environmentFingerprint = buildEnvironmentFingerprint(db, options.projectRoot);

  db.prepare(`
    INSERT INTO answer_trust_runs(
      trace_id,
      target_id,
      previous_trace_id,
      provenance,
      packet_hash,
      raw_packet_hash,
      previous_packet_hash,
      answer_hash,
      environment_fingerprint_json,
      created_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trace_id) DO UPDATE SET
      target_id = excluded.target_id,
      previous_trace_id = excluded.previous_trace_id,
      provenance = excluded.provenance,
      packet_hash = excluded.packet_hash,
      raw_packet_hash = excluded.raw_packet_hash,
      previous_packet_hash = excluded.previous_packet_hash,
      answer_hash = excluded.answer_hash,
      environment_fingerprint_json = excluded.environment_fingerprint_json,
      created_at = excluded.created_at
  `).run(
    result.queryId,
    target.targetId,
    previousRun?.traceId ?? null,
    options.provenance ?? "interactive",
    packetHash,
    rawPacketHash,
    previousRun?.packetHash ?? null,
    result.answer ? hashText(result.answer) : null,
    stringifyJson(environmentFingerprint),
    createdAt,
  );

  return getAnswerTrustRunImpl(db, result.queryId) as AnswerTrustRunRecord;
}

export function backfillAnswerTrustRunsImpl(db: DatabaseSync, projectRoot?: string): void {
  const pendingCount = db
    .prepare(`
      SELECT COUNT(*) AS pending
      FROM answer_traces traces
      LEFT JOIN answer_trust_runs runs ON runs.trace_id = traces.trace_id
      WHERE traces.project_id IS NULL
         OR runs.trace_id IS NULL
         OR runs.raw_packet_hash IS NULL
         OR runs.environment_fingerprint_json IS NULL
         OR (runs.previous_trace_id IS NOT NULL AND runs.previous_packet_hash IS NULL)
    `)
    .get() as { pending: number } | undefined;

  if (!pendingCount || pendingCount.pending === 0) {
    return;
  }

  db.prepare(`
    UPDATE answer_traces
    SET project_id = COALESCE(project_id, json_extract(packet_json, '$.projectId'))
    WHERE project_id IS NULL
  `).run();

  const rows = db
    .prepare(`
      SELECT
        traces.trace_id,
        traces.project_id,
        traces.query_kind,
        traces.query_text,
        traces.packet_json,
        traces.answer_markdown,
        runs.provenance,
        runs.environment_fingerprint_json,
        traces.created_at
      FROM answer_traces traces
      LEFT JOIN answer_trust_runs runs ON runs.trace_id = traces.trace_id
      WHERE runs.trace_id IS NULL
         OR runs.raw_packet_hash IS NULL
         OR runs.environment_fingerprint_json IS NULL
         OR (runs.previous_trace_id IS NOT NULL AND runs.previous_packet_hash IS NULL)
      ORDER BY traces.created_at ASC, traces.trace_id ASC
    `)
    .all() as unknown as TrustBackfillRow[];

  if (rows.length === 0) {
    return;
  }

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const packet = parseStoredPacket(row);
      if (!packet.projectId) {
        continue;
      }

      const target = ensureComparableTargetImpl(
        db,
        {
          projectId: packet.projectId,
          queryKind: row.query_kind,
          queryText: row.query_text,
        },
        row.created_at,
      );
      const previousRun = findPreviousTrustRun(db, target.targetId, row.trace_id);
      const { packetHash, rawPacketHash } = getPacketHashes(packet);
      const environmentFingerprint = normalizeEnvironmentFingerprint(
        row.environment_fingerprint_json == null
          ? buildEnvironmentFingerprint(db, projectRoot)
          : parseJson<Partial<AnswerEnvironmentFingerprint>>(row.environment_fingerprint_json, UNKNOWN_ENVIRONMENT_FINGERPRINT),
      );

      db.prepare(`
        INSERT INTO answer_trust_runs(
          trace_id,
          target_id,
          previous_trace_id,
          provenance,
          packet_hash,
          raw_packet_hash,
          previous_packet_hash,
          answer_hash,
          environment_fingerprint_json,
          created_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(trace_id) DO UPDATE SET
          target_id = excluded.target_id,
          previous_trace_id = excluded.previous_trace_id,
          provenance = excluded.provenance,
          packet_hash = excluded.packet_hash,
          raw_packet_hash = excluded.raw_packet_hash,
          previous_packet_hash = excluded.previous_packet_hash,
          answer_hash = excluded.answer_hash,
          environment_fingerprint_json = excluded.environment_fingerprint_json,
          created_at = excluded.created_at
      `).run(
        row.trace_id,
        target.targetId,
        previousRun?.traceId ?? null,
        row.provenance ?? "unknown",
        packetHash,
        rawPacketHash,
        previousRun?.packetHash ?? null,
        row.answer_markdown ? hashText(row.answer_markdown) : null,
        stringifyJson(environmentFingerprint),
        row.created_at,
      );
    }

    db.prepare(`
      DELETE FROM answer_comparable_targets
      WHERE target_id NOT IN (SELECT DISTINCT target_id FROM answer_trust_runs)
    `).run();

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getAnswerTrustRunImpl(db: DatabaseSync, traceId: string): AnswerTrustRunRecord | null {
  const row = db
    .prepare(`
      SELECT
        runs.trace_id,
        runs.target_id,
        runs.previous_trace_id,
        runs.provenance,
        runs.packet_hash,
        runs.raw_packet_hash,
        runs.previous_packet_hash,
        runs.answer_hash,
        runs.environment_fingerprint_json,
        runs.created_at,
        targets.project_id,
        targets.query_kind,
        targets.normalized_query_text,
        targets.comparison_key,
        targets.identity_json,
        targets.first_seen_at,
        targets.last_seen_at
      FROM answer_trust_runs runs
      INNER JOIN answer_comparable_targets targets ON targets.target_id = runs.target_id
      WHERE runs.trace_id = ?
    `)
    .get(traceId) as (AnswerTrustRunRow & AnswerComparableTargetRow) | undefined;

  return mapTrustRunRow(row);
}

export function getLatestComparableAnswerRunImpl(
  db: DatabaseSync,
  locator: ComparableAnswerLocator,
): AnswerTrustRunRecord | null {
  const identity = buildComparableAnswerIdentity(locator);
  const row = db
    .prepare(`
      SELECT
        runs.trace_id,
        runs.target_id,
        runs.previous_trace_id,
        runs.provenance,
        runs.packet_hash,
        runs.raw_packet_hash,
        runs.previous_packet_hash,
        runs.answer_hash,
        runs.environment_fingerprint_json,
        runs.created_at,
        targets.project_id,
        targets.query_kind,
        targets.normalized_query_text,
        targets.comparison_key,
        targets.identity_json,
        targets.first_seen_at,
        targets.last_seen_at
      FROM answer_trust_runs runs
      INNER JOIN answer_comparable_targets targets ON targets.target_id = runs.target_id
      WHERE targets.comparison_key = ?
      ORDER BY runs.created_at DESC, runs.trace_id DESC
      LIMIT 1
    `)
    .get(identity.comparisonKey) as (AnswerTrustRunRow & AnswerComparableTargetRow) | undefined;

  return mapTrustRunRow(row);
}

export function listComparableAnswerRunsImpl(
  db: DatabaseSync,
  args: ({ traceId: string; limit?: number } | ComparableAnswerLocator & { limit?: number }),
): AnswerTrustRunRecord[] {
  const limit = Math.max(1, Math.min(500, args.limit ?? 25));
  let comparisonKey: string | null = null;

  if ("traceId" in args) {
    const row = db
      .prepare(`
        SELECT targets.comparison_key
        FROM answer_trust_runs runs
        INNER JOIN answer_comparable_targets targets ON targets.target_id = runs.target_id
        WHERE runs.trace_id = ?
      `)
      .get(args.traceId) as { comparison_key: string } | undefined;
    comparisonKey = row?.comparison_key ?? null;
  } else {
    comparisonKey = buildComparableAnswerIdentity(args).comparisonKey;
  }

  if (!comparisonKey) {
    return [];
  }

  const rows = db
    .prepare(`
      SELECT
        runs.trace_id,
        runs.target_id,
        runs.previous_trace_id,
        runs.provenance,
        runs.packet_hash,
        runs.raw_packet_hash,
        runs.previous_packet_hash,
        runs.answer_hash,
        runs.environment_fingerprint_json,
        runs.created_at,
        targets.project_id,
        targets.query_kind,
        targets.normalized_query_text,
        targets.comparison_key,
        targets.identity_json,
        targets.first_seen_at,
        targets.last_seen_at
      FROM answer_trust_runs runs
      INNER JOIN answer_comparable_targets targets ON targets.target_id = runs.target_id
      WHERE targets.comparison_key = ?
      ORDER BY runs.created_at DESC, runs.trace_id DESC
      LIMIT ?
    `)
    .all(comparisonKey, limit) as unknown as Array<AnswerTrustRunRow & AnswerComparableTargetRow>;

  return rows
    .map((row) => mapTrustRunRow(row))
    .filter((row): row is AnswerTrustRunRecord => row != null);
}
