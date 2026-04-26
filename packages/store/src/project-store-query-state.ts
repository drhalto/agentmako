import { DatabaseSync } from "node:sqlite";
import type { AnswerResult, DbBindingTestStatus } from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";
import { getLatestIndexRunImpl, getScanStatsImpl } from "./project-store-index.js";
import type {
  DbBindingStateRecord,
  ProjectIndexStatus,
  ProjectProfileRecord,
  QueryAnswerTracesOptions,
  SavedAnswerTraceRecord,
  SaveAnswerTrustRunOptions,
} from "./types.js";
import { saveAnswerTrustRunImpl } from "./project-store-trust.js";

interface DbBindingStateRow {
  state_slot: number;
  last_tested_at: string | null;
  last_test_status: DbBindingTestStatus | null;
  last_test_error: string | null;
  last_test_server_version: string | null;
  last_test_current_user: string | null;
  last_verified_at: string | null;
  last_refreshed_at: string | null;
}

interface AnswerTraceRow {
  trace_id: string;
  query_kind: SavedAnswerTraceRecord["queryKind"];
  query_text: string;
  tier_used: SavedAnswerTraceRecord["tierUsed"];
  evidence_status: SavedAnswerTraceRecord["evidenceStatus"];
  support_level: SavedAnswerTraceRecord["supportLevel"];
  answer_confidence: number | null;
  packet_json: string;
  answer_markdown: string | null;
  created_at: string;
}

export function loadDbBindingStateImpl(db: DatabaseSync): DbBindingStateRecord {
  const row = db
    .prepare(`
      SELECT
        state_slot,
        last_tested_at,
        last_test_status,
        last_test_error,
        last_test_server_version,
        last_test_current_user,
        last_verified_at,
        last_refreshed_at
      FROM db_binding_state
      WHERE state_slot = 1
    `)
    .get() as DbBindingStateRow | undefined;

  if (!row) {
    return { lastTestStatus: "untested" };
  }

  return {
    lastTestStatus: row.last_test_status ?? "untested",
    lastTestedAt: row.last_tested_at ?? undefined,
    lastTestError: row.last_test_error ?? undefined,
    lastTestServerVersion: row.last_test_server_version ?? undefined,
    lastTestCurrentUser: row.last_test_current_user ?? undefined,
    lastVerifiedAt: row.last_verified_at ?? undefined,
    lastRefreshedAt: row.last_refreshed_at ?? undefined,
  };
}

export function saveDbBindingTestResultImpl(
  db: DatabaseSync,
  args: {
    status: DbBindingTestStatus;
    testedAt: string;
    error?: string;
    serverVersion?: string;
    currentUser?: string;
  },
): void {
  db
    .prepare(`
      INSERT INTO db_binding_state(
        state_slot,
        last_tested_at,
        last_test_status,
        last_test_error,
        last_test_server_version,
        last_test_current_user
      )
      VALUES(1, ?, ?, ?, ?, ?)
      ON CONFLICT(state_slot) DO UPDATE SET
        last_tested_at = excluded.last_tested_at,
        last_test_status = excluded.last_test_status,
        last_test_error = excluded.last_test_error,
        last_test_server_version = excluded.last_test_server_version,
        last_test_current_user = excluded.last_test_current_user
    `)
    .run(
      args.testedAt,
      args.status,
      args.error ?? null,
      args.serverVersion ?? null,
      args.currentUser ?? null,
    );
}

export function markDbBindingVerifiedImpl(db: DatabaseSync, args: { verifiedAt: string }): void {
  db
    .prepare(`
      INSERT INTO db_binding_state(state_slot, last_verified_at, last_test_status)
      VALUES(1, ?, 'untested')
      ON CONFLICT(state_slot) DO UPDATE SET
        last_verified_at = excluded.last_verified_at
    `)
    .run(args.verifiedAt);
}

export function markDbBindingRefreshedImpl(db: DatabaseSync, args: { refreshedAt: string }): void {
  db
    .prepare(`
      INSERT INTO db_binding_state(state_slot, last_refreshed_at, last_test_status)
      VALUES(1, ?, 'untested')
      ON CONFLICT(state_slot) DO UPDATE SET
        last_refreshed_at = excluded.last_refreshed_at
    `)
    .run(args.refreshedAt);
}

export function saveAnswerTraceImpl(
  db: DatabaseSync,
  result: AnswerResult,
  options: SaveAnswerTrustRunOptions = {},
): SavedAnswerTraceRecord {
  const traceId = result.queryId;
  const createdAt = new Date().toISOString();

  db.exec("BEGIN");

  try {
    db
      .prepare(`
        INSERT OR REPLACE INTO answer_traces(
          trace_id,
          project_id,
          query_kind,
          query_text,
          tier_used,
          evidence_status,
          support_level,
          answer_confidence,
          packet_json,
          answer_markdown,
          created_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        traceId,
        result.projectId,
        result.queryKind,
        result.packet.queryText,
        result.tierUsed,
        result.evidenceStatus,
        result.supportLevel,
        result.answerConfidence ?? null,
        stringifyJson(result.packet),
        result.answer ?? null,
        createdAt,
      );

    db.prepare(`DELETE FROM evidence_blocks WHERE trace_id = ?`).run(traceId);

    const insertEvidenceBlock = db.prepare(`
      INSERT INTO evidence_blocks(
        block_id,
        trace_id,
        block_kind,
        title,
        source_ref,
        file_path,
        line,
        score,
        payload_json
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const block of result.packet.evidence) {
      insertEvidenceBlock.run(
        block.blockId,
        traceId,
        block.kind,
        block.title,
        block.sourceRef,
        block.filePath ?? null,
        block.line ?? null,
        block.score ?? null,
        stringifyJson(block),
      );
    }

    saveAnswerTrustRunImpl(db, result, options, createdAt);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getAnswerTraceImpl(db, traceId) as SavedAnswerTraceRecord;
}

export function getAnswerTraceImpl(db: DatabaseSync, traceId: string): SavedAnswerTraceRecord | null {
  const row = db
    .prepare(`
      SELECT
        trace_id,
        query_kind,
        query_text,
        tier_used,
        evidence_status,
        support_level,
        answer_confidence,
        packet_json,
        answer_markdown,
        created_at
      FROM answer_traces
      WHERE trace_id = ?
    `)
    .get(traceId) as AnswerTraceRow | undefined;

  if (!row) {
    return null;
  }

  const evidenceRows = db
    .prepare(`
      SELECT payload_json
      FROM evidence_blocks
      WHERE trace_id = ?
      ORDER BY score DESC, title ASC
    `)
    .all(traceId) as Array<{ payload_json: string }>;

  return {
    traceId: row.trace_id,
    queryKind: row.query_kind,
    queryText: row.query_text,
    tierUsed: row.tier_used,
    evidenceStatus: row.evidence_status,
    supportLevel: row.support_level,
    answerConfidence: row.answer_confidence ?? undefined,
    answerMarkdown: row.answer_markdown ?? undefined,
    packet: parseJson(row.packet_json, {} as SavedAnswerTraceRecord["packet"]),
    evidence: evidenceRows.map((item) =>
      parseJson(item.payload_json, {} as SavedAnswerTraceRecord["evidence"][number]),
    ),
    createdAt: row.created_at,
  };
}

export function listRecentAnswerTracesImpl(
  db: DatabaseSync,
  options: QueryAnswerTracesOptions = {},
): SavedAnswerTraceRecord[] {
  const limit = options.limit ?? 10;
  const rows = db
    .prepare(`
      SELECT trace_id
      FROM answer_traces
      ORDER BY created_at DESC, trace_id DESC
      LIMIT ?
    `)
    .all(limit) as Array<{ trace_id: string }>;

  return rows
    .map((row) => getAnswerTraceImpl(db, row.trace_id))
    .filter((row): row is SavedAnswerTraceRecord => row != null);
}

export function getStatusImpl(
  db: DatabaseSync,
  project: ProjectIndexStatus["project"],
  loadProjectProfile: () => ProjectProfileRecord | null,
): ProjectIndexStatus {
  const profile = loadProjectProfile();
  return {
    project,
    profile: profile?.profile ?? null,
    latestRun: getLatestIndexRunImpl(db),
    stats: getScanStatsImpl(db),
  };
}
