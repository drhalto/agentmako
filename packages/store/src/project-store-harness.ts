/**
 * Project-store accessors for the Roadmap 3 harness layer.
 *
 * Mirrors the split pattern established in Phase 5.2 (`project-store-*.ts`
 * concern-scoped helper modules with `*Impl` functions that `ProjectStore`
 * delegates to). Sessions, messages, message parts, session events,
 * permission decisions, and provider calls all live together because they
 * share the session context and are written in the same agent-turn code
 * path; splitting them further in Phase 3.0 would duplicate the session-id
 * mapping six times.
 */

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseJson, stringifyJson } from "./json.js";

// -----------------------------------------------------------------------------
// Types (kept local — harness-contracts holds the wire types; this file owns
// the SQL row shapes and the corresponding "record" return types for the core)
// -----------------------------------------------------------------------------

export type HarnessTier = "no-agent" | "local-agent" | "cloud-agent";
export type SessionStatus = "active" | "idle" | "closed" | "error";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type MessagePartKind = "text" | "tool_call" | "tool_result" | "reasoning" | "error";
export type PermissionAction = "allow" | "deny" | "ask";
export type PermissionScope = "turn" | "session" | "project" | "global";
export type CallerKind = "agent" | "chat";

export interface FallbackChainEntry {
  provider: string;
  model: string;
}

export interface HarnessSessionRecord {
  sessionId: string;
  projectId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  title: string | null;
  tier: HarnessTier;
  activeProvider: string | null;
  activeModel: string | null;
  fallbackChain: FallbackChainEntry[];
  status: SessionStatus;
  harnessVersion: string | null;
}

export interface CreateHarnessSessionInput {
  projectId?: string | null;
  parentId?: string | null;
  title?: string | null;
  tier: HarnessTier;
  activeProvider?: string | null;
  activeModel?: string | null;
  fallbackChain?: FallbackChainEntry[];
  harnessVersion?: string | null;
}

export interface UpdateHarnessSessionInput {
  title?: string | null;
  tier?: HarnessTier;
  activeProvider?: string | null;
  activeModel?: string | null;
  fallbackChain?: FallbackChainEntry[];
  status?: SessionStatus;
}

export interface HarnessMessageRecord {
  messageId: string;
  sessionId: string;
  parentId: string | null;
  role: MessageRole;
  ordinal: number;
  createdAt: string;
  archived: boolean;
}

export interface InsertHarnessMessageInput {
  sessionId: string;
  parentId?: string | null;
  role: MessageRole;
}

export interface HarnessMessagePartRecord {
  partId: string;
  messageId: string;
  kind: MessagePartKind;
  ordinal: number;
  payload: unknown;
}

export interface InsertHarnessMessagePartInput {
  messageId: string;
  kind: MessagePartKind;
  payload: unknown;
}

export interface HarnessSessionEventRow {
  sessionId: string;
  ordinal: number;
  kind: string;
  payload: unknown;
  createdAt: string;
}

export interface InsertHarnessSessionEventInput {
  sessionId: string;
  kind: string;
  payload: unknown;
}

export interface HarnessProviderCallInput {
  sessionId?: string | null;
  provider: string;
  model: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  latencyMs?: number | null;
  costHint?: number | null;
  costUsdMicro?: number | null;
  callerKind?: CallerKind;
  ok: boolean;
  errorText?: string | null;
}

export interface HarnessProviderCallRecord {
  callId: string;
  sessionId: string | null;
  provider: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  latencyMs: number | null;
  costHint: number | null;
  costUsdMicro: number | null;
  callerKind: CallerKind;
  ok: boolean;
  errorText: string | null;
  createdAt: string;
}

export interface HarnessPermissionDecisionRecord {
  decisionId: string;
  sessionId: string;
  toolName: string;
  pattern: string;
  action: PermissionAction;
  scope: PermissionScope;
  rememberedAt: string;
}

export interface InsertHarnessPermissionDecisionInput {
  sessionId: string;
  toolName: string;
  pattern: string;
  action: PermissionAction;
  scope: PermissionScope;
}

// -----------------------------------------------------------------------------
// Row shapes + mappers
// -----------------------------------------------------------------------------

interface HarnessSessionRow {
  session_id: string;
  project_id: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  title: string | null;
  tier: HarnessTier;
  active_provider: string | null;
  active_model: string | null;
  fallback_chain_json: string;
  status: SessionStatus;
  harness_version: string | null;
}

function mapSessionRow(row: HarnessSessionRow | undefined): HarnessSessionRecord | null {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    projectId: row.project_id,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title,
    tier: row.tier,
    activeProvider: row.active_provider,
    activeModel: row.active_model,
    fallbackChain: parseJson<FallbackChainEntry[]>(row.fallback_chain_json, []),
    status: row.status,
    harnessVersion: row.harness_version ?? null,
  };
}

interface HarnessMessageRow {
  message_id: string;
  session_id: string;
  parent_id: string | null;
  role: MessageRole;
  ordinal: number;
  created_at: string;
  archived: number | null;
}

function mapMessageRow(row: HarnessMessageRow): HarnessMessageRecord {
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    parentId: row.parent_id,
    role: row.role,
    ordinal: row.ordinal,
    createdAt: row.created_at,
    archived: (row.archived ?? 0) === 1,
  };
}

interface HarnessMessagePartRow {
  part_id: string;
  message_id: string;
  kind: MessagePartKind;
  ordinal: number;
  payload_json: string;
}

function mapMessagePartRow(row: HarnessMessagePartRow): HarnessMessagePartRecord {
  return {
    partId: row.part_id,
    messageId: row.message_id,
    kind: row.kind,
    ordinal: row.ordinal,
    payload: parseJson<unknown>(row.payload_json, null),
  };
}

interface HarnessSessionEventRowRaw {
  session_id: string;
  ordinal: number;
  kind: string;
  payload_json: string;
  created_at: string;
}

function mapEventRow(row: HarnessSessionEventRowRaw): HarnessSessionEventRow {
  return {
    sessionId: row.session_id,
    ordinal: row.ordinal,
    kind: row.kind,
    payload: parseJson<unknown>(row.payload_json, null),
    createdAt: row.created_at,
  };
}

interface HarnessProviderCallRow {
  call_id: string;
  session_id: string | null;
  provider: string;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  latency_ms: number | null;
  cost_hint: number | null;
  cost_usd_micro: number | null;
  caller_kind: CallerKind | null;
  ok: number;
  error_text: string | null;
  created_at: string;
}

function mapProviderCallRow(row: HarnessProviderCallRow): HarnessProviderCallRecord {
  return {
    callId: row.call_id,
    sessionId: row.session_id,
    provider: row.provider,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    latencyMs: row.latency_ms,
    costHint: row.cost_hint,
    costUsdMicro: row.cost_usd_micro,
    callerKind: (row.caller_kind ?? "chat") as CallerKind,
    ok: row.ok === 1,
    errorText: row.error_text,
    createdAt: row.created_at,
  };
}

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------

export function createHarnessSessionImpl(
  db: DatabaseSync,
  input: CreateHarnessSessionInput,
): HarnessSessionRecord {
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  db
    .prepare(
      `
      INSERT INTO harness_sessions(
        session_id, project_id, parent_id, created_at, updated_at, title,
        tier, active_provider, active_model, fallback_chain_json, status, harness_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      sessionId,
      input.projectId ?? null,
      input.parentId ?? null,
      now,
      now,
      input.title ?? null,
      input.tier,
      input.activeProvider ?? null,
      input.activeModel ?? null,
      stringifyJson(input.fallbackChain ?? []),
      "active",
      input.harnessVersion ?? null,
    );

  return getHarnessSessionImpl(db, sessionId) as HarnessSessionRecord;
}

export function getHarnessSessionImpl(
  db: DatabaseSync,
  sessionId: string,
): HarnessSessionRecord | null {
  const row = db
    .prepare(`SELECT * FROM harness_sessions WHERE session_id = ?`)
    .get(sessionId) as unknown as HarnessSessionRow | undefined;
  return mapSessionRow(row);
}

export function listHarnessSessionsImpl(
  db: DatabaseSync,
  options: { projectId?: string | null; limit?: number } = {},
): HarnessSessionRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number | null> = [];
  if (options.projectId !== undefined) {
    clauses.push("project_id IS ?");
    values.push(options.projectId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(
      `SELECT * FROM harness_sessions ${where} ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...values, limit) as unknown as HarnessSessionRow[];
  return rows.map((r) => mapSessionRow(r)).filter((r): r is HarnessSessionRecord => r !== null);
}

export function updateHarnessSessionImpl(
  db: DatabaseSync,
  sessionId: string,
  input: UpdateHarnessSessionInput,
): HarnessSessionRecord {
  const existing = getHarnessSessionImpl(db, sessionId);
  if (!existing) {
    throw new Error(`harness_session not found: ${sessionId}`);
  }
  const next = { ...existing, ...input };
  const now = new Date().toISOString();
  db
    .prepare(
      `UPDATE harness_sessions SET
        title = ?, tier = ?, active_provider = ?, active_model = ?,
        fallback_chain_json = ?, status = ?, updated_at = ?
      WHERE session_id = ?`,
    )
    .run(
      next.title ?? null,
      next.tier,
      next.activeProvider ?? null,
      next.activeModel ?? null,
      stringifyJson(next.fallbackChain),
      next.status,
      now,
      sessionId,
    );
  return getHarnessSessionImpl(db, sessionId) as HarnessSessionRecord;
}

export function deleteHarnessSessionImpl(db: DatabaseSync, sessionId: string): void {
  db.prepare(`DELETE FROM harness_sessions WHERE session_id = ?`).run(sessionId);
}

// -----------------------------------------------------------------------------
// Messages + parts
// -----------------------------------------------------------------------------

export function insertHarnessMessageImpl(
  db: DatabaseSync,
  input: InsertHarnessMessageInput,
): HarnessMessageRecord {
  const messageId = randomUUID();
  const next = db
    .prepare(
      `SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM harness_messages WHERE session_id = ?`,
    )
    .get(input.sessionId) as { next: number };
  db
    .prepare(
      `INSERT INTO harness_messages(message_id, session_id, parent_id, role, ordinal)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(messageId, input.sessionId, input.parentId ?? null, input.role, next.next);
  const row = db
    .prepare(`SELECT * FROM harness_messages WHERE message_id = ?`)
    .get(messageId) as unknown as HarnessMessageRow;
  return mapMessageRow(row);
}

export function listHarnessMessagesImpl(
  db: DatabaseSync,
  sessionId: string,
  options: { includeArchived?: boolean } = {},
): HarnessMessageRecord[] {
  const includeArchived = options.includeArchived ?? true;
  const sql = includeArchived
    ? `SELECT * FROM harness_messages WHERE session_id = ? ORDER BY ordinal ASC`
    : `SELECT * FROM harness_messages WHERE session_id = ? AND archived = 0 ORDER BY ordinal ASC`;
  const rows = db.prepare(sql).all(sessionId) as unknown as HarnessMessageRow[];
  return rows.map(mapMessageRow);
}

/**
 * Phase 3.4 compaction: mark a set of message rows as archived. The rows are
 * kept in `harness_messages` for audit; `buildHistory` skips them when
 * assembling model context. Append-only invariants still hold for
 * `harness_message_parts` — no parts are touched.
 */
export function markHarnessMessagesArchivedImpl(
  db: DatabaseSync,
  messageIds: string[],
): number {
  if (messageIds.length === 0) return 0;
  const placeholders = messageIds.map(() => "?").join(",");
  const result = db
    .prepare(
      `UPDATE harness_messages SET archived = 1 WHERE message_id IN (${placeholders})`,
    )
    .run(...messageIds);
  return Number(result.changes);
}

export function insertHarnessMessagePartImpl(
  db: DatabaseSync,
  input: InsertHarnessMessagePartInput,
): HarnessMessagePartRecord {
  const partId = randomUUID();
  const next = db
    .prepare(
      `SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM harness_message_parts WHERE message_id = ?`,
    )
    .get(input.messageId) as { next: number };
  db
    .prepare(
      `INSERT INTO harness_message_parts(part_id, message_id, kind, ordinal, payload_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(partId, input.messageId, input.kind, next.next, stringifyJson(input.payload));
  const row = db
    .prepare(`SELECT * FROM harness_message_parts WHERE part_id = ?`)
    .get(partId) as unknown as HarnessMessagePartRow;
  return mapMessagePartRow(row);
}

export function listHarnessMessagePartsImpl(
  db: DatabaseSync,
  messageId: string,
): HarnessMessagePartRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM harness_message_parts WHERE message_id = ? ORDER BY ordinal ASC`,
    )
    .all(messageId) as unknown as HarnessMessagePartRow[];
  return rows.map(mapMessagePartRow);
}

// -----------------------------------------------------------------------------
// Session events (append-only, SSE spine)
// -----------------------------------------------------------------------------

export function insertHarnessSessionEventImpl(
  db: DatabaseSync,
  input: InsertHarnessSessionEventInput,
): HarnessSessionEventRow {
  const next = db
    .prepare(
      `SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM harness_session_events WHERE session_id = ?`,
    )
    .get(input.sessionId) as { next: number };
  db
    .prepare(
      `INSERT INTO harness_session_events(session_id, ordinal, kind, payload_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(input.sessionId, next.next, input.kind, stringifyJson(input.payload));
  const row = db
    .prepare(
      `SELECT * FROM harness_session_events WHERE session_id = ? AND ordinal = ?`,
    )
    .get(input.sessionId, next.next) as unknown as HarnessSessionEventRowRaw;
  return mapEventRow(row);
}

export function listHarnessSessionEventsImpl(
  db: DatabaseSync,
  sessionId: string,
  afterOrdinal?: number,
): HarnessSessionEventRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM harness_session_events
       WHERE session_id = ? AND ordinal > ?
       ORDER BY ordinal ASC`,
    )
    .all(sessionId, afterOrdinal ?? -1) as unknown as HarnessSessionEventRowRaw[];
  return rows.map(mapEventRow);
}

// -----------------------------------------------------------------------------
// Provider calls
// -----------------------------------------------------------------------------

export function insertHarnessProviderCallImpl(
  db: DatabaseSync,
  input: HarnessProviderCallInput,
): void {
  db
    .prepare(
      `INSERT INTO harness_provider_calls(
        call_id, session_id, provider, model,
        prompt_tokens, completion_tokens,
        reasoning_tokens, cache_read_tokens, cache_write_tokens,
        latency_ms, cost_hint, cost_usd_micro, caller_kind,
        ok, error_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.sessionId ?? null,
      input.provider,
      input.model,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.reasoningTokens ?? null,
      input.cacheReadTokens ?? null,
      input.cacheWriteTokens ?? null,
      input.latencyMs ?? null,
      input.costHint ?? null,
      input.costUsdMicro ?? null,
      input.callerKind ?? "chat",
      input.ok ? 1 : 0,
      input.errorText ?? null,
    );
}

export function listHarnessProviderCallsImpl(
  db: DatabaseSync,
  sessionId: string,
): HarnessProviderCallRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM harness_provider_calls WHERE session_id = ? ORDER BY created_at ASC, call_id ASC`,
    )
    .all(sessionId) as unknown as HarnessProviderCallRow[];
  return rows.map(mapProviderCallRow);
}

export interface HarnessProviderCallFilter {
  sinceIso?: string;
  projectId?: string | null;
}

/**
 * Phase 3.9: scan `harness_provider_calls` joined to `harness_sessions` so the
 * usage rollup can filter by project and a since-cutoff without the server
 * loading every row. Ok calls only — errors are excluded from dollar/token
 * totals (they shouldn't have meaningful usage numbers anyway).
 */
export function listHarnessProviderCallsForUsageImpl(
  db: DatabaseSync,
  filter: HarnessProviderCallFilter = {},
): HarnessProviderCallRecord[] {
  const clauses: string[] = ["c.ok = 1"];
  const values: Array<string | number | null> = [];
  if (filter.sinceIso) {
    clauses.push("c.created_at >= ?");
    values.push(filter.sinceIso);
  }
  if (filter.projectId !== undefined && filter.projectId !== null) {
    clauses.push("s.project_id = ?");
    values.push(filter.projectId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT c.* FROM harness_provider_calls c
       LEFT JOIN harness_sessions s ON s.session_id = c.session_id
       ${where}
       ORDER BY c.created_at ASC`,
    )
    .all(...values) as unknown as HarnessProviderCallRow[];
  return rows.map(mapProviderCallRow);
}

/**
 * Phase 3.9: project-scope 30d rolling cost for the dashboard status card.
 * SUM(cost_usd_micro) — NULLs are ignored naturally by SUM; sessions without
 * any cost-computed rows contribute 0.
 */
export function sumProjectCostUsdMicroImpl(
  db: DatabaseSync,
  projectId: string,
  sinceIso: string,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(c.cost_usd_micro), 0) AS total
       FROM harness_provider_calls c
       INNER JOIN harness_sessions s ON s.session_id = c.session_id
       WHERE s.project_id = ? AND c.ok = 1 AND c.created_at >= ?`,
    )
    .get(projectId, sinceIso) as { total: number | bigint | null } | undefined;
  if (!row || row.total === null || row.total === undefined) return 0;
  return Number(row.total);
}

// -----------------------------------------------------------------------------
// Permission decisions
// -----------------------------------------------------------------------------

interface HarnessPermissionDecisionRow {
  decision_id: string;
  session_id: string;
  tool_name: string;
  pattern: string;
  action: PermissionAction;
  scope: PermissionScope;
  remembered_at: string;
}

function mapPermissionDecisionRow(
  row: HarnessPermissionDecisionRow,
): HarnessPermissionDecisionRecord {
  return {
    decisionId: row.decision_id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    pattern: row.pattern,
    action: row.action,
    scope: row.scope,
    rememberedAt: row.remembered_at,
  };
}

export function insertHarnessPermissionDecisionImpl(
  db: DatabaseSync,
  input: InsertHarnessPermissionDecisionInput,
): HarnessPermissionDecisionRecord {
  const decisionId = randomUUID();
  db
    .prepare(
      `INSERT INTO harness_permission_decisions(
        decision_id, session_id, tool_name, pattern, action, scope
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      decisionId,
      input.sessionId,
      input.toolName,
      input.pattern,
      input.action,
      input.scope,
    );
  const row = db
    .prepare(`SELECT * FROM harness_permission_decisions WHERE decision_id = ?`)
    .get(decisionId) as unknown as HarnessPermissionDecisionRow;
  return mapPermissionDecisionRow(row);
}

export function listHarnessPermissionDecisionsImpl(
  db: DatabaseSync,
  sessionId: string,
): HarnessPermissionDecisionRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM harness_permission_decisions
       WHERE session_id = ?
       ORDER BY remembered_at DESC`,
    )
    .all(sessionId) as unknown as HarnessPermissionDecisionRow[];
  return rows.map(mapPermissionDecisionRow);
}
