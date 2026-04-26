import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  DbReviewCommentSchema,
  DbReviewTargetSchema,
  ProjectFactSchema,
  ProjectFindingSchema,
  ReefDiagnosticRunSchema,
  ReefRuleDescriptorSchema,
  type DbReviewComment,
  type DbReviewTarget,
  type FactSubject,
  type ProjectFact,
  type ProjectFinding,
  type ProjectFindingStatus,
  type ReefDiagnosticRun,
  type ReefRuleDescriptor,
} from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";
import type {
  QueryReefDiagnosticRunsOptions,
  QueryDbReviewCommentsOptions,
  QueryReefFactsOptions,
  QueryReefFindingsOptions,
  DbReviewCommentRecord,
  InsertDbReviewCommentInput,
  ReefDiagnosticRunRecord,
  ReefFactRecord,
  ReefFindingRecord,
  ReefRuleDescriptorRecord,
  ReplaceReefFactsForSourceInput,
  ReplaceReefFindingsForSourceInput,
  ResolveReefFindingsForDeletedFilesInput,
  SaveReefDiagnosticRunInput,
} from "./types.js";

type StoredFindingStatus = Exclude<ProjectFindingStatus, "acknowledged">;

interface ReefFactRow {
  project_id: string;
  kind: string;
  subject_json: string;
  subject_fingerprint: string;
  overlay: ProjectFact["overlay"];
  source: string;
  confidence: number;
  fingerprint: string;
  freshness_json: string;
  provenance_json: string;
  data_json: string | null;
}

interface ReefFindingRow {
  project_id: string;
  fingerprint: string;
  source: string;
  subject_fingerprint: string;
  overlay: ProjectFinding["overlay"];
  severity: ProjectFinding["severity"];
  status: StoredFindingStatus;
  file_path: string | null;
  line: number | null;
  rule_id: string | null;
  documentation_url: string | null;
  suggested_fix_json: string | null;
  evidence_refs_json: string;
  freshness_json: string;
  captured_at: string;
  message: string;
  fact_fingerprints_json: string;
}

interface ReefRuleDescriptorRow {
  descriptor_json: string;
}

interface ReefDiagnosticRunRow {
  run_id: string;
  project_id: string;
  source: string;
  overlay: ReefDiagnosticRun["overlay"];
  status: ReefDiagnosticRun["status"];
  started_at: string;
  finished_at: string;
  duration_ms: number;
  checked_file_count: number | null;
  finding_count: number;
  persisted_finding_count: number;
  command: string | null;
  cwd: string | null;
  config_path: string | null;
  error_text: string | null;
  metadata_json: string | null;
}

interface DbReviewCommentRow {
  comment_id: string;
  project_id: string;
  target_fingerprint: string;
  target_json: string;
  category: DbReviewComment["category"];
  severity: DbReviewComment["severity"] | null;
  comment_text: string;
  tags_json: string;
  created_by: string | null;
  created_at: string;
  source_tool_name: string;
  metadata_json: string | null;
}

export function computeReefSubjectFingerprint(subject: FactSubject): string {
  return reefHashJson(subject);
}

export function computeDbReviewTargetFingerprint(target: DbReviewTarget): string {
  return reefHashJson(DbReviewTargetSchema.parse(normalizeForReefStorage(target)));
}

export function computeReefFactFingerprint(input: {
  projectId: string;
  kind: string;
  subjectFingerprint: string;
  overlay: ProjectFact["overlay"];
  source: string;
  data?: unknown;
}): string {
  return reefHashJson(input);
}

export function computeReefFindingFingerprint(input: {
  source: string;
  ruleId?: string;
  subjectFingerprint: string;
  message?: string;
  evidenceRefs?: string[];
}): string {
  return reefHashJson(input);
}

export function upsertReefFactsImpl(
  db: DatabaseSync,
  facts: ProjectFact[],
): ReefFactRecord[] {
  const parsed = facts.map(parseProjectFactForStorage);
  if (parsed.length === 0) {
    return [];
  }

  const statement = db.prepare(`
    INSERT INTO reef_facts(
      project_id,
      overlay,
      source,
      kind,
      subject_fingerprint,
      subject_json,
      confidence,
      fingerprint,
      freshness_json,
      provenance_json,
      data_json,
      captured_at,
      updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, overlay, source, kind, subject_fingerprint) DO UPDATE SET
      subject_json = excluded.subject_json,
      confidence = excluded.confidence,
      fingerprint = excluded.fingerprint,
      freshness_json = excluded.freshness_json,
      provenance_json = excluded.provenance_json,
      data_json = excluded.data_json,
      captured_at = excluded.captured_at,
      updated_at = excluded.updated_at
  `);

  withTransaction(db, () => {
    for (const fact of parsed) {
      statement.run(
        fact.projectId,
        fact.overlay,
        fact.source,
        fact.kind,
        fact.subjectFingerprint,
        stringifyJson(fact.subject),
        fact.confidence,
        fact.fingerprint,
        stringifyJson(fact.freshness),
        stringifyJson(fact.provenance),
        fact.data ? stringifyJson(fact.data) : null,
        fact.provenance.capturedAt,
        new Date().toISOString(),
      );
    }
  });

  return parsed;
}

export function replaceReefFactsForSourceImpl(
  db: DatabaseSync,
  input: ReplaceReefFactsForSourceInput,
): ReefFactRecord[] {
  assertPersistableOverlay(input.overlay);
  const parsed = input.facts.map(parseProjectFactForStorage);
  for (const fact of parsed) {
    if (
      fact.projectId !== input.projectId ||
      fact.overlay !== input.overlay ||
      fact.source !== input.source
    ) {
      throw new Error("replaceReefFactsForSource facts must match input projectId, overlay, and source.");
    }
  }

  const kindFilter = input.kinds && input.kinds.length > 0
    ? ` AND kind IN (${input.kinds.map(() => "?").join(", ")})`
    : "";
  const deleteParams = input.kinds && input.kinds.length > 0
    ? [input.projectId, input.overlay, input.source, ...input.kinds]
    : [input.projectId, input.overlay, input.source];

  const insert = db.prepare(`
    INSERT INTO reef_facts(
      project_id,
      overlay,
      source,
      kind,
      subject_fingerprint,
      subject_json,
      confidence,
      fingerprint,
      freshness_json,
      provenance_json,
      data_json,
      captured_at,
      updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, overlay, source, kind, subject_fingerprint) DO UPDATE SET
      subject_json = excluded.subject_json,
      confidence = excluded.confidence,
      fingerprint = excluded.fingerprint,
      freshness_json = excluded.freshness_json,
      provenance_json = excluded.provenance_json,
      data_json = excluded.data_json,
      captured_at = excluded.captured_at,
      updated_at = excluded.updated_at
  `);

  withTransaction(db, () => {
    db.prepare(`
      DELETE FROM reef_facts
      WHERE project_id = ? AND overlay = ? AND source = ?${kindFilter}
    `).run(...deleteParams);

    for (const fact of parsed) {
      insert.run(
        fact.projectId,
        fact.overlay,
        fact.source,
        fact.kind,
        fact.subjectFingerprint,
        stringifyJson(fact.subject),
        fact.confidence,
        fact.fingerprint,
        stringifyJson(fact.freshness),
        stringifyJson(fact.provenance),
        fact.data ? stringifyJson(fact.data) : null,
        fact.provenance.capturedAt,
        new Date().toISOString(),
      );
    }
  });

  return parsed;
}

export function queryReefFactsImpl(
  db: DatabaseSync,
  options: QueryReefFactsOptions,
): ReefFactRecord[] {
  const { sql, values } = reefFactWhere(options);
  const rows = db.prepare(`
    SELECT
      project_id, kind, subject_json, subject_fingerprint, overlay, source,
      confidence, fingerprint, freshness_json, provenance_json, data_json
    FROM reef_facts
    ${sql}
    ORDER BY updated_at DESC, kind ASC, subject_fingerprint ASC
    LIMIT ?
  `).all(...values, options.limit ?? 100) as unknown as ReefFactRow[];

  return rows.map(mapFactRow);
}

export function replaceReefFindingsForSourceImpl(
  db: DatabaseSync,
  input: ReplaceReefFindingsForSourceInput,
): ReefFindingRecord[] {
  const now = new Date().toISOString();
  assertPersistableOverlay(input.overlay);
  const parsed = input.findings.map((finding) =>
    parseProjectFindingForStorage({
      ...finding,
      status: finding.status === "acknowledged" ? "active" : finding.status,
    }),
  );
  const subjectFingerprints = new Set(input.subjectFingerprints ?? parsed.map((finding) => finding.subjectFingerprint));
  const producedFingerprints = new Set(parsed.map((finding) => finding.fingerprint));

  const existingRows = new Map(
    db.prepare(`
      SELECT fingerprint, status
      FROM reef_findings
      WHERE project_id = ? AND source = ? AND overlay = ?
    `).all(input.projectId, input.source, input.overlay).map((row) => {
      const record = row as { fingerprint: string; status: StoredFindingStatus };
      return [record.fingerprint, record.status] as const;
    }),
  );

  const upsert = db.prepare(`
    INSERT INTO reef_findings(
      project_id,
      fingerprint,
      source,
      subject_fingerprint,
      overlay,
      severity,
      status,
      file_path,
      line,
      rule_id,
      documentation_url,
      suggested_fix_json,
      evidence_refs_json,
      freshness_json,
      captured_at,
      message,
      fact_fingerprints_json,
      updated_at,
      resolved_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, fingerprint) DO UPDATE SET
      source = excluded.source,
      subject_fingerprint = excluded.subject_fingerprint,
      overlay = excluded.overlay,
      severity = excluded.severity,
      status = excluded.status,
      file_path = excluded.file_path,
      line = excluded.line,
      rule_id = excluded.rule_id,
      documentation_url = excluded.documentation_url,
      suggested_fix_json = excluded.suggested_fix_json,
      evidence_refs_json = excluded.evidence_refs_json,
      freshness_json = excluded.freshness_json,
      captured_at = excluded.captured_at,
      message = excluded.message,
      fact_fingerprints_json = excluded.fact_fingerprints_json,
      updated_at = excluded.updated_at,
      resolved_at = excluded.resolved_at
  `);

  withTransaction(db, () => {
    for (const finding of parsed) {
      const storedStatus = toStoredFindingStatus(finding.status);
      upsert.run(
        finding.projectId,
        finding.fingerprint,
        finding.source,
        finding.subjectFingerprint,
        finding.overlay,
        finding.severity,
        storedStatus,
        finding.filePath ?? null,
        finding.line ?? null,
        finding.ruleId ?? null,
        finding.documentationUrl ?? null,
        finding.suggestedFix ? stringifyJson(finding.suggestedFix) : null,
        stringifyJson(finding.evidenceRefs ?? []),
        stringifyJson(finding.freshness),
        finding.capturedAt,
        finding.message,
        stringifyJson(finding.factFingerprints),
        now,
        storedStatus === "resolved" ? now : null,
      );
      const priorStatus = existingRows.get(finding.fingerprint);
      insertReefFindingEvent(db, {
        projectId: finding.projectId,
        fingerprint: finding.fingerprint,
        eventType: priorStatus ? "updated" : "created",
        priorStatus,
        nextStatus: storedStatus,
        reason: priorStatus ? "finding recomputed by source" : "finding created by source",
        createdAt: now,
      });
    }

    const activeRows = db.prepare(`
      SELECT fingerprint, subject_fingerprint, status
      FROM reef_findings
      WHERE project_id = ? AND source = ? AND overlay = ? AND status = 'active'
    `).all(input.projectId, input.source, input.overlay) as unknown as Array<{
      fingerprint: string;
      subject_fingerprint: string;
      status: StoredFindingStatus;
    }>;

    const resolve = db.prepare(`
      UPDATE reef_findings
      SET status = 'resolved', resolved_at = ?, updated_at = ?
      WHERE project_id = ? AND fingerprint = ? AND status = 'active'
    `);
    for (const row of activeRows) {
      if (!subjectFingerprints.has(row.subject_fingerprint) || producedFingerprints.has(row.fingerprint)) {
        continue;
      }
      const resolvedAt = input.resolvedAt ?? now;
      resolve.run(resolvedAt, now, input.projectId, row.fingerprint);
      insertReefFindingEvent(db, {
        projectId: input.projectId,
        fingerprint: row.fingerprint,
        eventType: "resolved",
        priorStatus: row.status,
        nextStatus: "resolved",
        reason: input.reason ?? "source no longer produced finding for scoped subject",
        createdAt: resolvedAt,
      });
    }
  });

  return queryReefFindingsImpl(db, {
    projectId: input.projectId,
    source: input.source,
    overlay: input.overlay,
    includeResolved: true,
    limit: Math.max(100, parsed.length + subjectFingerprints.size),
  });
}

export function queryReefFindingsImpl(
  db: DatabaseSync,
  options: QueryReefFindingsOptions,
): ReefFindingRecord[] {
  const { sql, values } = reefFindingWhere(options);
  const rows = db.prepare(`
    SELECT
      project_id, fingerprint, source, subject_fingerprint, overlay, severity,
      status, file_path, line, rule_id, documentation_url, suggested_fix_json,
      evidence_refs_json, freshness_json, captured_at, message,
      fact_fingerprints_json
    FROM reef_findings
    ${sql}
    ORDER BY
      CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      updated_at DESC,
      fingerprint ASC
    LIMIT ?
  `).all(...values, options.limit ?? 100) as unknown as ReefFindingRow[];

  const acknowledged = loadAcknowledgedReefFingerprints(db, options.projectId, rows.map((row) => row.fingerprint));
  return rows
    .map((row) => mapFindingRow(row, acknowledged))
    .filter((finding) => matchesDerivedFindingStatus(finding, options.status));
}

export function resolveReefFindingsForDeletedFilesImpl(
  db: DatabaseSync,
  input: ResolveReefFindingsForDeletedFilesInput,
): number {
  const filePaths = [...new Set(input.filePaths.filter((filePath) => filePath.trim().length > 0))];
  const overlays = [
    ...new Set<ProjectFinding["overlay"]>(
      input.overlays ?? (["indexed", "working_tree"] as ProjectFinding["overlay"][]),
    ),
  ];
  for (const filePath of filePaths) {
    assertRelativeProjectPath(filePath, "deleted file path");
  }
  for (const overlay of overlays) {
    assertPersistableOverlay(overlay);
  }
  if (filePaths.length === 0 || overlays.length === 0) {
    return 0;
  }

  const filePlaceholders = filePaths.map(() => "?").join(", ");
  const overlayPlaceholders = overlays.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT fingerprint, status
    FROM reef_findings
    WHERE project_id = ?
      AND file_path IN (${filePlaceholders})
      AND overlay IN (${overlayPlaceholders})
      AND status = 'active'
  `).all(input.projectId, ...filePaths, ...overlays) as unknown as Array<{
    fingerprint: string;
    status: StoredFindingStatus;
  }>;
  if (rows.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();
  const resolvedAt = input.resolvedAt ?? now;
  const resolve = db.prepare(`
    UPDATE reef_findings
    SET status = 'resolved', resolved_at = ?, updated_at = ?
    WHERE project_id = ? AND fingerprint = ? AND status = 'active'
  `);

  withTransaction(db, () => {
    for (const row of rows) {
      resolve.run(resolvedAt, now, input.projectId, row.fingerprint);
      insertReefFindingEvent(db, {
        projectId: input.projectId,
        fingerprint: row.fingerprint,
        eventType: "resolved",
        priorStatus: row.status,
        nextStatus: "resolved",
        reason: input.reason ?? "file deleted from working tree",
        createdAt: resolvedAt,
      });
    }
  });

  return rows.length;
}

export function saveReefRuleDescriptorsImpl(
  db: DatabaseSync,
  descriptors: ReefRuleDescriptor[],
): ReefRuleDescriptorRecord[] {
  const parsed = descriptors.map((descriptor) => ReefRuleDescriptorSchema.parse(normalizeForReefStorage(descriptor)));
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO reef_rule_descriptors(
      rule_id,
      source,
      source_namespace,
      version,
      descriptor_json,
      enabled_by_default,
      updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(rule_id) DO UPDATE SET
      source = excluded.source,
      source_namespace = excluded.source_namespace,
      version = excluded.version,
      descriptor_json = excluded.descriptor_json,
      enabled_by_default = excluded.enabled_by_default,
      updated_at = excluded.updated_at
  `);

  withTransaction(db, () => {
    for (const descriptor of parsed) {
      statement.run(
        descriptor.id,
        descriptor.source,
        descriptor.sourceNamespace,
        descriptor.version,
        stringifyJson(descriptor),
        descriptor.enabledByDefault ? 1 : 0,
        now,
      );
    }
  });

  return parsed;
}

export function listReefRuleDescriptorsImpl(db: DatabaseSync): ReefRuleDescriptorRecord[] {
  const rows = db.prepare(`
    SELECT descriptor_json
    FROM reef_rule_descriptors
    ORDER BY source_namespace ASC, rule_id ASC
  `).all() as unknown as ReefRuleDescriptorRow[];
  return rows.map((row) => ReefRuleDescriptorSchema.parse(parseJson(row.descriptor_json, {})));
}

export function saveReefDiagnosticRunImpl(
  db: DatabaseSync,
  input: SaveReefDiagnosticRunInput,
): ReefDiagnosticRunRecord {
  const run = ReefDiagnosticRunSchema.parse(normalizeForReefStorage({
    ...input,
    runId: input.runId ?? `reef_diagnostic_run_${randomUUID()}`,
  }));
  assertPersistableOverlay(run.overlay);
  db.prepare(`
    INSERT INTO reef_diagnostic_runs(
      run_id,
      project_id,
      source,
      overlay,
      status,
      started_at,
      finished_at,
      duration_ms,
      checked_file_count,
      finding_count,
      persisted_finding_count,
      command,
      cwd,
      config_path,
      error_text,
      metadata_json
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.runId,
    run.projectId,
    run.source,
    run.overlay,
    run.status,
    run.startedAt,
    run.finishedAt,
    run.durationMs,
    run.checkedFileCount ?? null,
    run.findingCount,
    run.persistedFindingCount,
    run.command ?? null,
    run.cwd ?? null,
    run.configPath ?? null,
    run.errorText ?? null,
    run.metadata ? stringifyJson(run.metadata) : null,
  );
  return run;
}

export function queryReefDiagnosticRunsImpl(
  db: DatabaseSync,
  options: QueryReefDiagnosticRunsOptions,
): ReefDiagnosticRunRecord[] {
  const clauses = ["project_id = ?"];
  const values: Array<string | number> = [options.projectId];
  if (options.source) {
    clauses.push("source = ?");
    values.push(options.source);
  }
  if (options.status) {
    clauses.push("status = ?");
    values.push(options.status);
  }
  const rows = db.prepare(`
    SELECT
      run_id, project_id, source, overlay, status, started_at, finished_at,
      duration_ms, checked_file_count, finding_count, persisted_finding_count,
      command, cwd, config_path, error_text, metadata_json
    FROM reef_diagnostic_runs
    WHERE ${clauses.join(" AND ")}
    ORDER BY finished_at DESC, run_id DESC
    LIMIT ?
  `).all(...values, options.limit ?? 20) as unknown as ReefDiagnosticRunRow[];
  return rows.map(mapDiagnosticRunRow);
}

export function insertDbReviewCommentImpl(
  db: DatabaseSync,
  input: InsertDbReviewCommentInput,
): DbReviewCommentRecord {
  const target = DbReviewTargetSchema.parse(normalizeForReefStorage(input.target));
  const comment = DbReviewCommentSchema.parse(normalizeForReefStorage({
    commentId: `db_review_comment_${randomUUID()}`,
    projectId: input.projectId,
    target,
    targetFingerprint: computeDbReviewTargetFingerprint(target),
    category: input.category,
    severity: input.severity,
    comment: input.comment,
    tags: input.tags ?? [],
    createdBy: input.createdBy,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sourceToolName: input.sourceToolName,
    metadata: input.metadata,
  }));

  db.prepare(`
    INSERT INTO db_review_comments(
      comment_id,
      project_id,
      target_fingerprint,
      object_type,
      schema_name,
      object_name,
      parent_object_name,
      target_json,
      category,
      severity,
      comment_text,
      tags_json,
      created_by,
      created_at,
      source_tool_name,
      metadata_json
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    comment.commentId,
    comment.projectId,
    comment.targetFingerprint,
    comment.target.objectType,
    comment.target.schemaName ?? null,
    comment.target.objectName,
    comment.target.parentObjectName ?? null,
    stringifyJson(comment.target),
    comment.category,
    comment.severity ?? null,
    comment.comment,
    stringifyJson(comment.tags),
    comment.createdBy ?? null,
    comment.createdAt,
    comment.sourceToolName,
    comment.metadata ? stringifyJson(comment.metadata) : null,
  );

  return comment;
}

export function queryDbReviewCommentsImpl(
  db: DatabaseSync,
  options: QueryDbReviewCommentsOptions,
): DbReviewCommentRecord[] {
  const clauses = ["project_id = ?"];
  const values: Array<string | number> = [options.projectId];
  if (options.targetFingerprint) {
    clauses.push("target_fingerprint = ?");
    values.push(options.targetFingerprint);
  }
  if (options.objectType) {
    clauses.push("object_type = ?");
    values.push(options.objectType);
  }
  if (options.schemaName) {
    clauses.push("schema_name = ?");
    values.push(options.schemaName);
  }
  if (options.objectName) {
    clauses.push("object_name = ?");
    values.push(options.objectName);
  }
  if (options.parentObjectName) {
    clauses.push("parent_object_name = ?");
    values.push(options.parentObjectName);
  }
  if (options.category) {
    clauses.push("category = ?");
    values.push(options.category);
  }
  if (options.query) {
    const pattern = `%${escapeLikePattern(options.query)}%`;
    clauses.push(`(
      comment_text LIKE ? ESCAPE '\\'
      OR object_name LIKE ? ESCAPE '\\'
      OR COALESCE(schema_name, '') LIKE ? ESCAPE '\\'
      OR COALESCE(parent_object_name, '') LIKE ? ESCAPE '\\'
    )`);
    values.push(pattern, pattern, pattern, pattern);
  }

  const rows = db.prepare(`
    SELECT
      comment_id, project_id, target_fingerprint, target_json, category,
      severity, comment_text, tags_json, created_by, created_at,
      source_tool_name, metadata_json
    FROM db_review_comments
    WHERE ${clauses.join(" AND ")}
    ORDER BY created_at DESC, comment_id DESC
    LIMIT ?
  `).all(...values, options.limit ?? 100) as unknown as DbReviewCommentRow[];

  return rows.map(mapDbReviewCommentRow);
}

function reefFactWhere(options: QueryReefFactsOptions): { sql: string; values: Array<string | number> } {
  const clauses = ["project_id = ?"];
  const values: Array<string | number> = [options.projectId];
  if (options.overlay) {
    clauses.push("overlay = ?");
    values.push(options.overlay);
  }
  if (options.source) {
    clauses.push("source = ?");
    values.push(options.source);
  }
  if (options.kind) {
    clauses.push("kind = ?");
    values.push(options.kind);
  }
  if (options.subjectFingerprint) {
    clauses.push("subject_fingerprint = ?");
    values.push(options.subjectFingerprint);
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, values };
}

function reefFindingWhere(options: QueryReefFindingsOptions): { sql: string; values: Array<string | number> } {
  const clauses = ["project_id = ?"];
  const values: Array<string | number> = [options.projectId];
  if (options.overlay) {
    clauses.push("overlay = ?");
    values.push(options.overlay);
  }
  if (options.source) {
    clauses.push("source = ?");
    values.push(options.source);
  }
  if (options.filePath) {
    clauses.push("file_path = ?");
    values.push(options.filePath);
  }
  if (options.status === "resolved" || options.status === "suppressed") {
    clauses.push("status = ?");
    values.push(options.status);
  } else if (!options.includeResolved) {
    clauses.push("status = 'active'");
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, values };
}

function mapFactRow(row: ReefFactRow): ReefFactRecord {
  return ProjectFactSchema.parse({
    projectId: row.project_id,
    kind: row.kind,
    subject: parseJson(row.subject_json, {}),
    subjectFingerprint: row.subject_fingerprint,
    overlay: row.overlay,
    source: row.source,
    confidence: row.confidence,
    fingerprint: row.fingerprint,
    freshness: parseJson(row.freshness_json, {}),
    provenance: parseJson(row.provenance_json, {}),
    data: row.data_json ? parseJson(row.data_json, {}) : undefined,
  });
}

function mapFindingRow(
  row: ReefFindingRow,
  acknowledged: Set<string>,
): ReefFindingRecord {
  const status = row.status === "active" && acknowledged.has(row.fingerprint) ? "acknowledged" : row.status;
  return ProjectFindingSchema.parse({
    projectId: row.project_id,
    fingerprint: row.fingerprint,
    source: row.source,
    subjectFingerprint: row.subject_fingerprint,
    overlay: row.overlay,
    severity: row.severity,
    status,
    filePath: row.file_path ?? undefined,
    line: row.line ?? undefined,
    ruleId: row.rule_id ?? undefined,
    documentationUrl: row.documentation_url ?? undefined,
    suggestedFix: row.suggested_fix_json ? parseJson(row.suggested_fix_json, undefined) : undefined,
    evidenceRefs: parseJson<string[]>(row.evidence_refs_json, []),
    freshness: parseJson(row.freshness_json, {}),
    capturedAt: row.captured_at,
    message: row.message,
    factFingerprints: parseJson<string[]>(row.fact_fingerprints_json, []),
  });
}

function mapDiagnosticRunRow(row: ReefDiagnosticRunRow): ReefDiagnosticRunRecord {
  return ReefDiagnosticRunSchema.parse({
    runId: row.run_id,
    projectId: row.project_id,
    source: row.source,
    overlay: row.overlay,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    checkedFileCount: row.checked_file_count ?? undefined,
    findingCount: row.finding_count,
    persistedFindingCount: row.persisted_finding_count,
    command: row.command ?? undefined,
    cwd: row.cwd ?? undefined,
    configPath: row.config_path ?? undefined,
    errorText: row.error_text ?? undefined,
    metadata: row.metadata_json ? parseJson(row.metadata_json, {}) : undefined,
  });
}

function mapDbReviewCommentRow(row: DbReviewCommentRow): DbReviewCommentRecord {
  return DbReviewCommentSchema.parse({
    commentId: row.comment_id,
    projectId: row.project_id,
    target: parseJson(row.target_json, {}),
    targetFingerprint: row.target_fingerprint,
    category: row.category,
    severity: row.severity ?? undefined,
    comment: row.comment_text,
    tags: parseJson<string[]>(row.tags_json, []),
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    sourceToolName: row.source_tool_name,
    metadata: row.metadata_json ? parseJson(row.metadata_json, {}) : undefined,
  });
}

function loadAcknowledgedReefFingerprints(
  db: DatabaseSync,
  projectId: string,
  fingerprints: string[],
): Set<string> {
  const unique = [...new Set(fingerprints)];
  if (unique.length === 0) {
    return new Set();
  }
  const placeholders = unique.map(() => "?").join(", ");
  const rows = db.prepare(`
    SELECT DISTINCT fingerprint
    FROM finding_acks
    WHERE project_id = ? AND fingerprint IN (${placeholders})
  `).all(projectId, ...unique) as unknown as Array<{ fingerprint: string }>;
  return new Set(rows.map((row) => row.fingerprint));
}

function matchesDerivedFindingStatus(
  finding: ReefFindingRecord,
  status: ProjectFindingStatus | undefined,
): boolean {
  return !status || finding.status === status;
}

function toStoredFindingStatus(status: ProjectFindingStatus): StoredFindingStatus {
  return status === "acknowledged" ? "active" : status;
}

function parseProjectFactForStorage(fact: ProjectFact): ProjectFact {
  const parsed = ProjectFactSchema.parse(normalizeForReefStorage(fact));
  assertPersistableOverlay(parsed.overlay);
  assertProjectScopedFactSubject(parsed.subject);
  return parsed;
}

function parseProjectFindingForStorage(finding: ProjectFinding): ProjectFinding {
  const parsed = ProjectFindingSchema.parse(normalizeForReefStorage(finding));
  assertPersistableOverlay(parsed.overlay);
  if (parsed.filePath) {
    assertRelativeProjectPath(parsed.filePath, "finding filePath");
  }
  return parsed;
}

function assertPersistableOverlay(overlay: ProjectFact["overlay"] | ProjectFinding["overlay"]): void {
  if (overlay === "preview") {
    throw new Error("Reef overlay `preview` is reserved for in-memory callers and cannot be persisted.");
  }
}

function assertProjectScopedFactSubject(subject: FactSubject): void {
  switch (subject.kind) {
    case "file":
    case "symbol":
    case "diagnostic":
      assertRelativeProjectPath(subject.path, `${subject.kind} subject path`);
      return;
    case "import_edge":
      assertRelativeProjectPath(subject.sourcePath, "import edge sourcePath");
      assertRelativeProjectPath(subject.targetPath, "import edge targetPath");
      return;
    case "route":
    case "schema_object":
      return;
  }
}

function assertRelativeProjectPath(value: string, label: string): void {
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.trim().length === 0 ||
    normalized.includes("\0") ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`Reef ${label} must be a project-relative path.`);
  }
}

function insertReefFindingEvent(
  db: DatabaseSync,
  input: {
    projectId: string;
    fingerprint: string;
    eventType: "created" | "updated" | "resolved" | "suppressed";
    priorStatus?: string;
    nextStatus: string;
    reason: string;
    createdAt: string;
  },
): void {
  db.prepare(`
    INSERT INTO reef_finding_events(
      event_id,
      project_id,
      fingerprint,
      event_type,
      prior_status,
      next_status,
      reason,
      created_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `reef_event_${randomUUID()}`,
    input.projectId,
    input.fingerprint,
    input.eventType,
    input.priorStatus ?? null,
    input.nextStatus,
    input.reason,
    input.createdAt,
  );
}

function withTransaction(db: DatabaseSync, action: () => void): void {
  db.exec("BEGIN");
  try {
    action();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function reefHashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortForReefHash(normalizeForReefHash(value)))).digest("hex");
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function normalizeForReefStorage(value: unknown): unknown {
  if (typeof value === "string") {
    return value.normalize("NFC");
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForReefStorage);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key.normalize("NFC"), normalizeForReefStorage(item)]),
    );
  }
  return value;
}

function normalizeForReefHash(value: unknown): unknown {
  if (typeof value === "string") {
    return value.normalize("NFC");
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForReefHash);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key.normalize("NFC"), normalizeForReefHash(item)]),
    );
  }
  return value;
}

function sortForReefHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForReefHash);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortForReefHash((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}
