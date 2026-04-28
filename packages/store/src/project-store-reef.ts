import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  DbReviewCommentSchema,
  DbReviewTargetSchema,
  ProjectFactSchema,
  ProjectFindingSchema,
  ReefProjectEventSchema,
  ReefDiagnosticRunSchema,
  ReefRuleDescriptorSchema,
  ReefWorkspaceFileChangeSchema,
  ReefWorkspaceChangeSetSchema,
  type DbReviewComment,
  type DbReviewTarget,
  type FactSubject,
  type JsonObject,
  type JsonValue,
  type ProjectFact,
  type ProjectFinding,
  type ProjectFindingStatus,
  type ReefDiagnosticRun,
  type ReefRuleDescriptor,
} from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";
import type {
  ApplyReefChangeSetInput,
  EnsureReefAnalysisStateInput,
  AddReefArtifactTagInput,
  QueryReefDiagnosticRunsOptions,
  QueryDbReviewCommentsOptions,
  QueryReefArtifactsOptions,
  QueryReefArtifactTagsOptions,
  QueryReefFactsOptions,
  QueryReefFindingsOptions,
  DbReviewCommentRecord,
  InsertDbReviewCommentInput,
  MarkReefChangeSetFailedInput,
  MarkReefChangeSetMaterializedInput,
  MarkReefChangeSetSkippedInput,
  QueryReefAppliedChangeSetsOptions,
  ReefAnalysisStateRecord,
  ReefAppliedChangeSetRecord,
  ReefDiagnosticRunRecord,
  ReefFactRecord,
  ReefFindingRecord,
  ReefRuleDescriptorRecord,
  ReplaceReefFactsForSourceInput,
  ReplaceReefFindingsForSourceInput,
  ResolveReefFindingsForDeletedFilesInput,
  ReefArtifactKey,
  ReefArtifactRecord,
  ReefArtifactTagRecord,
  RecordReefWatcherRecrawlInput,
  RemoveReefArtifactTagsInput,
  RemoveReefArtifactTagsResult,
  SaveReefDiagnosticRunInput,
  UpsertReefArtifactInput,
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

interface ReefAnalysisStateRow {
  project_id: string;
  root: string;
  current_revision: number;
  materialized_revision: number | null;
  last_applied_change_set_id: string | null;
  last_applied_at: string | null;
  recomputation_generation: number;
  watcher_recrawl_count: number;
  last_recrawl_at: string | null;
  last_recrawl_reason: string | null;
  last_recrawl_warning: string | null;
  updated_at: string;
}

interface ReefAppliedChangeSetRow {
  change_set_id: string;
  project_id: string;
  root: string;
  base_revision: number;
  new_revision: number;
  observed_at: string;
  applied_at: string;
  generation: number;
  status: ReefAppliedChangeSetRecord["status"];
  refresh_mode: ReefAppliedChangeSetRecord["refreshMode"];
  fallback_reason: string | null;
  cause_count: number;
  file_change_count: number;
  causes_json: string;
  file_changes_json: string;
  data_json: string | null;
}

interface ReefArtifactRow {
  artifact_id: string;
  content_hash: string;
  artifact_kind: string;
  extractor_version: string;
  payload_json: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface ReefArtifactTagRow {
  tag_id: string;
  artifact_id: string;
  content_hash: string;
  artifact_kind: string;
  extractor_version: string;
  project_id: string;
  root: string;
  branch: string;
  worktree: string;
  overlay: ReefArtifactTagRecord["overlay"];
  path: string;
  last_verified_revision: number | null;
  last_changed_revision: number | null;
  created_at: string;
  updated_at: string;
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

export function computeReefArtifactId(input: ReefArtifactKey): string {
  return `reef_artifact_${reefHashJson(parseReefArtifactKey(input))}`;
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

export function loadReefAnalysisStateImpl(
  db: DatabaseSync,
  projectId: string,
  root: string,
): ReefAnalysisStateRecord | null {
  const row = db.prepare(`
    SELECT
      project_id,
      root,
      current_revision,
      materialized_revision,
      last_applied_change_set_id,
      last_applied_at,
      recomputation_generation,
      watcher_recrawl_count,
      last_recrawl_at,
      last_recrawl_reason,
      last_recrawl_warning,
      updated_at
    FROM reef_analysis_state
    WHERE project_id = ? AND root = ?
  `).get(projectId, root) as ReefAnalysisStateRow | undefined;

  return row ? mapReefAnalysisStateRow(row) : null;
}

export function ensureReefAnalysisStateImpl(
  db: DatabaseSync,
  input: EnsureReefAnalysisStateInput,
): ReefAnalysisStateRecord {
  const existing = loadReefAnalysisStateImpl(db, input.projectId, input.root);
  if (existing) {
    return existing;
  }

  const now = input.now ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO reef_analysis_state(
      project_id,
      root,
      current_revision,
      recomputation_generation,
      watcher_recrawl_count,
      updated_at
    )
    VALUES(?, ?, 0, 0, 0, ?)
    ON CONFLICT(project_id, root) DO NOTHING
  `).run(input.projectId, input.root, now);

  const created = loadReefAnalysisStateImpl(db, input.projectId, input.root);
  if (!created) {
    throw new Error("Reef analysis state was not initialized.");
  }
  return created;
}

export class ReefStaleBaseRevisionError extends Error {
  readonly code = "REEF_STALE_BASE_REVISION";
  constructor(readonly attempts: number, cause?: unknown) {
    super(`Reef change set could not be applied after ${attempts} attempts: another writer advanced the revision concurrently.`);
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

const REEF_APPLY_CHANGE_SET_MAX_ATTEMPTS = 4;

export function applyReefChangeSetImpl(
  db: DatabaseSync,
  input: ApplyReefChangeSetInput,
): ReefAppliedChangeSetRecord {
  const changeSet = ReefWorkspaceChangeSetSchema.parse(normalizeForReefStorage(input.changeSet));
  validateChangeSetCauses(changeSet);
  const appliedAt = input.appliedAt ?? new Date().toISOString();
  let lastConflict: unknown;

  for (let attempt = 1; attempt <= REEF_APPLY_CHANGE_SET_MAX_ATTEMPTS; attempt += 1) {
    let record: ReefAppliedChangeSetRecord | undefined;
    try {
      withTransaction(db, () => {
        const existing = loadReefAnalysisStateImpl(db, changeSet.projectId, changeSet.root);
        const baseRevision = existing?.currentRevision ?? 0;
        const newRevision = baseRevision + 1;
        const generation = (existing?.recomputationGeneration ?? 0) + 1;
        const now = new Date().toISOString();
        const data = changeSetData(changeSet);

        db.prepare(`
          INSERT INTO reef_applied_change_sets(
            change_set_id,
            project_id,
            root,
            base_revision,
            new_revision,
            observed_at,
            applied_at,
            generation,
            status,
            refresh_mode,
            fallback_reason,
            cause_count,
            file_change_count,
            causes_json,
            file_changes_json,
            data_json,
            created_at
          )
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          changeSet.changeSetId,
          changeSet.projectId,
          changeSet.root,
          baseRevision,
          newRevision,
          changeSet.observedAt,
          appliedAt,
          generation,
          input.refreshMode,
          input.fallbackReason ?? null,
          changeSet.causes.length,
          changeSet.fileChanges.length,
          stringifyJson(changeSet.causes),
          stringifyJson(changeSet.fileChanges),
          data ? stringifyJson(data) : null,
          now,
        );

        db.prepare(`
          INSERT INTO reef_analysis_state(
            project_id,
            root,
            current_revision,
            materialized_revision,
            last_applied_change_set_id,
            last_applied_at,
            recomputation_generation,
            watcher_recrawl_count,
            last_recrawl_at,
            last_recrawl_reason,
            last_recrawl_warning,
            updated_at
          )
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(project_id, root) DO UPDATE SET
            current_revision = excluded.current_revision,
            last_applied_change_set_id = excluded.last_applied_change_set_id,
            last_applied_at = excluded.last_applied_at,
            recomputation_generation = excluded.recomputation_generation,
            updated_at = excluded.updated_at
        `).run(
          changeSet.projectId,
          changeSet.root,
          newRevision,
          existing?.materializedRevision ?? null,
          changeSet.changeSetId,
          appliedAt,
          generation,
          existing?.watcherRecrawlCount ?? 0,
          existing?.lastRecrawlAt ?? null,
          existing?.lastRecrawlReason ?? null,
          existing?.lastRecrawlWarning ?? null,
          now,
        );

        record = {
          changeSetId: changeSet.changeSetId,
          projectId: changeSet.projectId,
          root: changeSet.root,
          baseRevision,
          newRevision,
          observedAt: changeSet.observedAt,
          appliedAt,
          generation,
          status: "applied",
          refreshMode: input.refreshMode,
          fallbackReason: input.fallbackReason,
          causeCount: changeSet.causes.length,
          fileChangeCount: changeSet.fileChanges.length,
          causes: changeSet.causes,
          fileChanges: changeSet.fileChanges,
          ...(data ? { data } : {}),
        };
      });
    } catch (error) {
      if (isReefRevisionUniqueConstraintError(error)) {
        lastConflict = error;
        continue;
      }
      throw error;
    }

    if (!record) {
      throw new Error("Reef change set was not applied.");
    }
    return record;
  }

  throw new ReefStaleBaseRevisionError(REEF_APPLY_CHANGE_SET_MAX_ATTEMPTS, lastConflict);
}

function isReefRevisionUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message;
  if (!message.includes("UNIQUE constraint failed")) {
    return false;
  }
  if (message.includes("reef_applied_change_sets.change_set_id")) {
    return false;
  }
  return message.includes("idx_reef_applied_change_sets_unique_revision")
    || (
      message.includes("reef_applied_change_sets.project_id")
      && message.includes("reef_applied_change_sets.root")
      && message.includes("reef_applied_change_sets.new_revision")
    );
}

export function markReefChangeSetMaterializedImpl(
  db: DatabaseSync,
  input: MarkReefChangeSetMaterializedInput,
): ReefAnalysisStateRecord {
  const materializedAt = input.materializedAt ?? new Date().toISOString();
  db.prepare(`
    UPDATE reef_applied_change_sets
    SET
      status = 'applied',
      refresh_mode = COALESCE(?, refresh_mode),
      fallback_reason = COALESCE(?, fallback_reason)
    WHERE change_set_id = ? AND project_id = ? AND root = ?
  `).run(
    input.refreshMode ?? null,
    input.fallbackReason ?? null,
    input.changeSetId,
    input.projectId,
    input.root,
  );
  db.prepare(`
    UPDATE reef_analysis_state
    SET
      materialized_revision = ?,
      updated_at = ?
    WHERE project_id = ? AND root = ?
  `).run(input.revision, materializedAt, input.projectId, input.root);

  const state = loadReefAnalysisStateImpl(db, input.projectId, input.root);
  if (!state) {
    throw new Error("Reef analysis state was not found after materialization.");
  }
  return state;
}

export function markReefChangeSetFailedImpl(
  db: DatabaseSync,
  input: MarkReefChangeSetFailedInput,
): void {
  db.prepare(`
    UPDATE reef_applied_change_sets
    SET
      status = 'failed',
      fallback_reason = ?
    WHERE change_set_id = ? AND project_id = ? AND root = ?
  `).run(input.errorText, input.changeSetId, input.projectId, input.root);
}

export function markReefChangeSetSkippedImpl(
  db: DatabaseSync,
  input: MarkReefChangeSetSkippedInput,
): void {
  db.prepare(`
    UPDATE reef_applied_change_sets
    SET
      status = 'skipped',
      fallback_reason = ?
    WHERE change_set_id = ? AND project_id = ? AND root = ?
  `).run(input.reason, input.changeSetId, input.projectId, input.root);
}

export function recordReefWatcherRecrawlImpl(
  db: DatabaseSync,
  input: RecordReefWatcherRecrawlInput,
): ReefAnalysisStateRecord {
  const observedAt = input.observedAt ?? new Date().toISOString();
  let updated: ReefAnalysisStateRecord | null = null;

  withTransaction(db, () => {
    ensureReefAnalysisStateImpl(db, {
      projectId: input.projectId,
      root: input.root,
    });
    db.prepare(`
      UPDATE reef_analysis_state
      SET
        watcher_recrawl_count = watcher_recrawl_count + 1,
        last_recrawl_at = ?,
        last_recrawl_reason = ?,
        last_recrawl_warning = ?,
        updated_at = ?
      WHERE project_id = ? AND root = ?
    `).run(
      observedAt,
      input.reason,
      input.warning ?? null,
      observedAt,
      input.projectId,
      input.root,
    );

    updated = loadReefAnalysisStateImpl(db, input.projectId, input.root);
  });
  if (!updated) {
    throw new Error("Reef analysis state was not available after recording watcher recrawl.");
  }
  return updated;
}

export function queryReefAppliedChangeSetsImpl(
  db: DatabaseSync,
  options: QueryReefAppliedChangeSetsOptions,
): ReefAppliedChangeSetRecord[] {
  const clauses = ["project_id = ?"];
  const values: Array<string | number> = [options.projectId];
  if (options.root) {
    clauses.push("root = ?");
    values.push(options.root);
  }
  if (options.changeSetId) {
    clauses.push("change_set_id = ?");
    values.push(options.changeSetId);
  }
  if (options.maxRevision !== undefined) {
    clauses.push("new_revision <= ?");
    values.push(options.maxRevision);
  }

  const rows = db.prepare(`
    SELECT
      change_set_id,
      project_id,
      root,
      base_revision,
      new_revision,
      observed_at,
      applied_at,
      generation,
      status,
      refresh_mode,
      fallback_reason,
      cause_count,
      file_change_count,
      causes_json,
      file_changes_json,
      data_json
    FROM reef_applied_change_sets
    WHERE ${clauses.join(" AND ")}
    ORDER BY new_revision DESC, applied_at DESC
    LIMIT ?
  `).all(...values, options.limit ?? 20) as unknown as ReefAppliedChangeSetRow[];

  return rows.map(mapReefAppliedChangeSetRow);
}

export function upsertReefArtifactImpl(
  db: DatabaseSync,
  input: UpsertReefArtifactInput,
): ReefArtifactRecord {
  const key = parseReefArtifactKey(input);
  const artifactId = input.artifactId ? normalizeNonEmptyString(input.artifactId, "artifactId") : computeReefArtifactId(key);
  const payload = normalizeForReefStorage(input.payload) as JsonValue;
  const metadata = input.metadata ? normalizeForReefStorage(input.metadata) as JsonObject : undefined;
  const now = input.now ?? new Date().toISOString();

  db.prepare(`
    INSERT INTO reef_artifacts(
      artifact_id,
      content_hash,
      artifact_kind,
      extractor_version,
      payload_json,
      metadata_json,
      created_at,
      updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(content_hash, artifact_kind, extractor_version) DO UPDATE SET
      payload_json = excluded.payload_json,
      metadata_json = COALESCE(excluded.metadata_json, reef_artifacts.metadata_json),
      updated_at = excluded.updated_at
  `).run(
    artifactId,
    key.contentHash,
    key.artifactKind,
    key.extractorVersion,
    stringifyJson(payload),
    metadata ? stringifyJson(metadata) : null,
    now,
    now,
  );

  const row = db.prepare(`
    SELECT
      artifact_id,
      content_hash,
      artifact_kind,
      extractor_version,
      payload_json,
      metadata_json,
      created_at,
      updated_at
    FROM reef_artifacts
    WHERE content_hash = ? AND artifact_kind = ? AND extractor_version = ?
  `).get(key.contentHash, key.artifactKind, key.extractorVersion) as ReefArtifactRow | undefined;

  if (!row) {
    throw new Error("Reef artifact was not persisted.");
  }
  return mapReefArtifactRow(row);
}

export function addReefArtifactTagImpl(
  db: DatabaseSync,
  input: AddReefArtifactTagInput,
): ReefArtifactTagRecord {
  const artifact = loadReefArtifactById(db, input.artifactId);
  if (!artifact) {
    throw new Error(`Reef artifact ${input.artifactId} does not exist.`);
  }

  const tag = parseReefArtifactTagInput(input, artifact);
  const now = input.now ?? new Date().toISOString();
  db.prepare(`
    INSERT INTO reef_artifact_tags(
      tag_id,
      artifact_id,
      content_hash,
      artifact_kind,
      extractor_version,
      project_id,
      root,
      branch,
      worktree,
      overlay,
      path,
      last_verified_revision,
      last_changed_revision,
      created_at,
      updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, root, branch, worktree, overlay, path, artifact_kind, extractor_version) DO UPDATE SET
      artifact_id = excluded.artifact_id,
      content_hash = excluded.content_hash,
      last_verified_revision = COALESCE(excluded.last_verified_revision, reef_artifact_tags.last_verified_revision),
      last_changed_revision = COALESCE(excluded.last_changed_revision, reef_artifact_tags.last_changed_revision),
      updated_at = excluded.updated_at
  `).run(
    tag.tagId,
    tag.artifactId,
    tag.contentHash,
    tag.artifactKind,
    tag.extractorVersion,
    tag.projectId,
    tag.root,
    tag.branch,
    tag.worktree,
    tag.overlay,
    tag.path,
    normalizeOptionalRevision(input.lastVerifiedRevision, "lastVerifiedRevision"),
    normalizeOptionalRevision(input.lastChangedRevision, "lastChangedRevision"),
    now,
    now,
  );

  const row = loadReefArtifactTagById(db, tag.tagId);
  if (!row) {
    throw new Error("Reef artifact tag was not persisted.");
  }
  return row;
}

export function queryReefArtifactsImpl(
  db: DatabaseSync,
  options: QueryReefArtifactsOptions = {},
): ReefArtifactRecord[] {
  const { artifactClauses, artifactValues, tagClauses, tagValues } = reefArtifactQueryParts(options);
  const joinsTags = tagClauses.length > 0;
  const clauses = [...artifactClauses, ...tagClauses];
  const rows = db.prepare(`
    SELECT DISTINCT
      a.artifact_id,
      a.content_hash,
      a.artifact_kind,
      a.extractor_version,
      a.payload_json,
      a.metadata_json,
      a.created_at,
      a.updated_at
    FROM reef_artifacts a
    ${joinsTags ? "JOIN reef_artifact_tags t ON t.artifact_id = a.artifact_id" : ""}
    WHERE ${clauses.length > 0 ? clauses.join(" AND ") : "1 = 1"}
    ORDER BY a.updated_at DESC, a.artifact_id DESC
    LIMIT ?
  `).all(...artifactValues, ...tagValues, options.limit ?? 100) as unknown as ReefArtifactRow[];

  return rows.map(mapReefArtifactRow);
}

export function queryReefArtifactTagsImpl(
  db: DatabaseSync,
  options: QueryReefArtifactTagsOptions = {},
): ReefArtifactTagRecord[] {
  return queryReefArtifactTagRows(db, options).map(mapReefArtifactTagRow);
}

export function removeReefArtifactTagsImpl(
  db: DatabaseSync,
  input: RemoveReefArtifactTagsInput,
): RemoveReefArtifactTagsResult {
  if (!input.tagId && !input.artifactId && !(input.projectId && input.root)) {
    throw new Error("removeReefArtifactTags requires tagId, artifactId, or projectId plus root.");
  }

  const rows = queryReefArtifactTagRows(db, input, { includeTagId: true, ignoreLimit: true });
  const artifactIds = [...new Set(rows.map((row) => row.artifact_id))];
  const result: RemoveReefArtifactTagsResult = {
    removedTagCount: rows.length,
    prunedArtifactCount: 0,
  };

  if (rows.length === 0) {
    return result;
  }

  withTransaction(db, () => {
    const deleteTag = db.prepare(`DELETE FROM reef_artifact_tags WHERE tag_id = ?`);
    for (const row of rows) {
      deleteTag.run(row.tag_id);
    }

    if (input.pruneArtifacts) {
      const hasTags = db.prepare(`
        SELECT 1
        FROM reef_artifact_tags
        WHERE artifact_id = ?
        LIMIT 1
      `);
      const deleteArtifact = db.prepare(`DELETE FROM reef_artifacts WHERE artifact_id = ?`);
      for (const artifactId of artifactIds) {
        if (!hasTags.get(artifactId)) {
          deleteArtifact.run(artifactId);
          result.prunedArtifactCount += 1;
        }
      }
    }
  });

  return result;
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
  } else if (options.sources) {
    addInClause(clauses, values, "source", options.sources);
  }
  if (options.filePath) {
    clauses.push("file_path = ?");
    values.push(options.filePath);
  } else if (options.filePaths) {
    addInClause(clauses, values, "file_path", options.filePaths);
  }
  if (options.severities) {
    addInClause(clauses, values, "severity", options.severities);
  }
  if (options.status === "resolved" || options.status === "suppressed") {
    clauses.push("status = ?");
    values.push(options.status);
  } else if (!options.includeResolved) {
    clauses.push("status = 'active'");
  }
  if (options.excludeAcknowledged) {
    clauses.push("NOT EXISTS (SELECT 1 FROM finding_acks fa WHERE fa.project_id = reef_findings.project_id AND fa.fingerprint = reef_findings.fingerprint)");
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, values };
}

function addInClause(
  clauses: string[],
  values: Array<string | number>,
  column: string,
  items: readonly string[],
): void {
  if (items.length === 0) {
    clauses.push("1 = 0");
    return;
  }
  clauses.push(`${column} IN (${items.map(() => "?").join(", ")})`);
  values.push(...items);
}

function reefArtifactQueryParts(options: QueryReefArtifactsOptions): {
  artifactClauses: string[];
  artifactValues: Array<string | number>;
  tagClauses: string[];
  tagValues: Array<string | number>;
} {
  const artifactClauses: string[] = [];
  const artifactValues: Array<string | number> = [];
  addArtifactKeyClauses("a", artifactClauses, artifactValues, options);
  if (options.artifactId !== undefined) {
    artifactClauses.push("a.artifact_id = ?");
    artifactValues.push(normalizeNonEmptyString(options.artifactId, "artifactId"));
  }

  const tagClauses: string[] = [];
  const tagValues: Array<string | number> = [];
  addArtifactTagClauses("t", tagClauses, tagValues, options);
  return { artifactClauses, artifactValues, tagClauses, tagValues };
}

function queryReefArtifactTagRows(
  db: DatabaseSync,
  options: QueryReefArtifactTagsOptions & { tagId?: string },
  behavior: { includeTagId?: boolean; ignoreLimit?: boolean } = {},
): ReefArtifactTagRow[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (behavior.includeTagId && options.tagId) {
    clauses.push("tag_id = ?");
    values.push(options.tagId);
  }
  if (options.artifactId !== undefined) {
    clauses.push("artifact_id = ?");
    values.push(normalizeNonEmptyString(options.artifactId, "artifactId"));
  }
  addArtifactKeyClauses(undefined, clauses, values, options);
  addArtifactTagClauses(undefined, clauses, values, options);

  const sql = `
    SELECT
      tag_id,
      artifact_id,
      content_hash,
      artifact_kind,
      extractor_version,
      project_id,
      root,
      branch,
      worktree,
      overlay,
      path,
      last_verified_revision,
      last_changed_revision,
      created_at,
      updated_at
    FROM reef_artifact_tags
    WHERE ${clauses.length > 0 ? clauses.join(" AND ") : "1 = 1"}
    ORDER BY updated_at DESC, tag_id DESC
    ${behavior.ignoreLimit ? "" : "LIMIT ?"}
  `;

  const args = behavior.ignoreLimit ? values : [...values, options.limit ?? 100];
  return db.prepare(sql).all(...args) as unknown as ReefArtifactTagRow[];
}

function addArtifactKeyClauses(
  alias: string | undefined,
  clauses: string[],
  values: Array<string | number>,
  options: Partial<ReefArtifactKey>,
): void {
  const prefix = alias ? `${alias}.` : "";
  if (options.contentHash !== undefined) {
    clauses.push(`${prefix}content_hash = ?`);
    values.push(normalizeNonEmptyString(options.contentHash, "contentHash"));
  }
  if (options.artifactKind !== undefined) {
    clauses.push(`${prefix}artifact_kind = ?`);
    values.push(normalizeNonEmptyString(options.artifactKind, "artifactKind"));
  }
  if (options.extractorVersion !== undefined) {
    clauses.push(`${prefix}extractor_version = ?`);
    values.push(normalizeNonEmptyString(options.extractorVersion, "extractorVersion"));
  }
}

function addArtifactTagClauses(
  alias: string | undefined,
  clauses: string[],
  values: Array<string | number>,
  options: {
    projectId?: string;
    root?: string;
    branch?: string;
    worktree?: string;
    overlay?: ReefArtifactTagRecord["overlay"];
    path?: string;
  },
): void {
  const prefix = alias ? `${alias}.` : "";
  if (options.projectId !== undefined) {
    clauses.push(`${prefix}project_id = ?`);
    values.push(normalizeNonEmptyString(options.projectId, "projectId"));
  }
  if (options.root !== undefined) {
    clauses.push(`${prefix}root = ?`);
    values.push(normalizeNonEmptyString(options.root, "root"));
  }
  if (options.branch !== undefined) {
    clauses.push(`${prefix}branch = ?`);
    values.push(normalizeTagDimension(options.branch));
  }
  if (options.worktree !== undefined) {
    clauses.push(`${prefix}worktree = ?`);
    values.push(normalizeTagDimension(options.worktree));
  }
  if (options.overlay) {
    clauses.push(`${prefix}overlay = ?`);
    values.push(options.overlay);
  }
  if (options.path !== undefined) {
    assertRelativeProjectPath(options.path, "artifact tag path");
    clauses.push(`${prefix}path = ?`);
    values.push(options.path.replaceAll("\\", "/"));
  }
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

function mapReefAnalysisStateRow(row: ReefAnalysisStateRow): ReefAnalysisStateRecord {
  return {
    projectId: row.project_id,
    root: row.root,
    currentRevision: row.current_revision,
    ...(row.materialized_revision != null ? { materializedRevision: row.materialized_revision } : {}),
    ...(row.last_applied_change_set_id ? { lastAppliedChangeSetId: row.last_applied_change_set_id } : {}),
    ...(row.last_applied_at ? { lastAppliedAt: row.last_applied_at } : {}),
    recomputationGeneration: row.recomputation_generation,
    watcherRecrawlCount: row.watcher_recrawl_count,
    ...(row.last_recrawl_at ? { lastRecrawlAt: row.last_recrawl_at } : {}),
    ...(row.last_recrawl_reason ? { lastRecrawlReason: row.last_recrawl_reason } : {}),
    ...(row.last_recrawl_warning ? { lastRecrawlWarning: row.last_recrawl_warning } : {}),
    updatedAt: row.updated_at,
  };
}

function mapReefAppliedChangeSetRow(row: ReefAppliedChangeSetRow): ReefAppliedChangeSetRecord {
  return {
    changeSetId: row.change_set_id,
    projectId: row.project_id,
    root: row.root,
    baseRevision: row.base_revision,
    newRevision: row.new_revision,
    observedAt: row.observed_at,
    appliedAt: row.applied_at,
    generation: row.generation,
    status: row.status,
    refreshMode: row.refresh_mode,
    ...(row.fallback_reason ? { fallbackReason: row.fallback_reason } : {}),
    causeCount: row.cause_count,
    fileChangeCount: row.file_change_count,
    causes: parseJson<unknown[]>(row.causes_json, []).map((cause) => ReefProjectEventSchema.parse(cause)),
    fileChanges: parseJson<unknown[]>(row.file_changes_json, []).map((fileChange) =>
      ReefWorkspaceFileChangeSchema.parse(fileChange)
    ),
    ...(row.data_json ? { data: parseJson(row.data_json, {}) as JsonObject } : {}),
  };
}

function mapReefArtifactRow(row: ReefArtifactRow): ReefArtifactRecord {
  return {
    artifactId: row.artifact_id,
    contentHash: row.content_hash,
    artifactKind: row.artifact_kind,
    extractorVersion: row.extractor_version,
    payload: parseJson<JsonValue>(row.payload_json, null),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json, {}) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReefArtifactTagRow(row: ReefArtifactTagRow): ReefArtifactTagRecord {
  return {
    tagId: row.tag_id,
    artifactId: row.artifact_id,
    contentHash: row.content_hash,
    artifactKind: row.artifact_kind,
    extractorVersion: row.extractor_version,
    projectId: row.project_id,
    root: row.root,
    ...(row.branch ? { branch: row.branch } : {}),
    ...(row.worktree ? { worktree: row.worktree } : {}),
    overlay: row.overlay,
    path: row.path,
    ...(row.last_verified_revision != null ? { lastVerifiedRevision: row.last_verified_revision } : {}),
    ...(row.last_changed_revision != null ? { lastChangedRevision: row.last_changed_revision } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function parseReefArtifactKey(input: ReefArtifactKey): ReefArtifactKey {
  return {
    contentHash: normalizeNonEmptyString(input.contentHash, "contentHash"),
    artifactKind: normalizeNonEmptyString(input.artifactKind, "artifactKind"),
    extractorVersion: normalizeNonEmptyString(input.extractorVersion, "extractorVersion"),
  };
}

function loadReefArtifactById(db: DatabaseSync, artifactId: string): ReefArtifactRecord | null {
  const row = db.prepare(`
    SELECT
      artifact_id,
      content_hash,
      artifact_kind,
      extractor_version,
      payload_json,
      metadata_json,
      created_at,
      updated_at
    FROM reef_artifacts
    WHERE artifact_id = ?
  `).get(artifactId) as ReefArtifactRow | undefined;
  return row ? mapReefArtifactRow(row) : null;
}

function loadReefArtifactTagById(db: DatabaseSync, tagId: string): ReefArtifactTagRecord | null {
  const row = db.prepare(`
    SELECT
      tag_id,
      artifact_id,
      content_hash,
      artifact_kind,
      extractor_version,
      project_id,
      root,
      branch,
      worktree,
      overlay,
      path,
      last_verified_revision,
      last_changed_revision,
      created_at,
      updated_at
    FROM reef_artifact_tags
    WHERE tag_id = ?
  `).get(tagId) as ReefArtifactTagRow | undefined;
  return row ? mapReefArtifactTagRow(row) : null;
}

function parseReefArtifactTagInput(
  input: AddReefArtifactTagInput,
  artifact: ReefArtifactRecord,
): Omit<ReefArtifactTagRecord, "createdAt" | "updatedAt"> & { branch: string; worktree: string } {
  assertRelativeProjectPath(input.path, "artifact tag path");
  const branch = normalizeTagDimension(input.branch);
  const worktree = normalizeTagDimension(input.worktree);
  const pathValue = input.path.replaceAll("\\", "/");
  const tagIdentity = {
    projectId: normalizeNonEmptyString(input.projectId, "projectId"),
    root: normalizeNonEmptyString(input.root, "root"),
    branch,
    worktree,
    overlay: input.overlay,
    path: pathValue,
    artifactKind: artifact.artifactKind,
    extractorVersion: artifact.extractorVersion,
  };
  return {
    tagId: `reef_artifact_tag_${reefHashJson(tagIdentity)}`,
    artifactId: artifact.artifactId,
    contentHash: artifact.contentHash,
    ...tagIdentity,
  };
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

function validateChangeSetCauses(
  changeSet: ReturnType<typeof ReefWorkspaceChangeSetSchema.parse>,
): void {
  for (const cause of changeSet.causes) {
    if (cause.projectId !== changeSet.projectId) {
      throw new Error("Reef change-set cause projectId must match the change set projectId.");
    }
    if (cause.root !== changeSet.root) {
      throw new Error("Reef change-set cause root must match the change set root.");
    }
  }
  for (const fileChange of changeSet.fileChanges) {
    assertRelativeProjectPath(fileChange.path, "change-set file path");
    if (fileChange.priorPath) {
      assertRelativeProjectPath(fileChange.priorPath, "change-set prior file path");
    }
  }
}

function changeSetData(
  changeSet: ReturnType<typeof ReefWorkspaceChangeSetSchema.parse>,
): JsonObject | undefined {
  const data: Record<string, unknown> = {};
  if (changeSet.git) {
    data.git = changeSet.git;
  }
  if (changeSet.schema) {
    data.schema = changeSet.schema;
  }
  return Object.keys(data).length > 0 ? data as JsonObject : undefined;
}

function assertPersistableOverlay(overlay: ProjectFact["overlay"] | ProjectFinding["overlay"]): void {
  if (overlay === "preview") {
    throw new Error("Reef overlay `preview` is reserved for in-memory callers and cannot be persisted.");
  }
}

function normalizeNonEmptyString(value: string, label: string): string {
  const normalized = value.normalize("NFC").trim();
  if (normalized.length === 0) {
    throw new Error(`Reef ${label} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeTagDimension(value: string | undefined): string {
  return value ? value.normalize("NFC").trim() : "";
}

function normalizeOptionalRevision(value: number | undefined, label: string): number | null {
  if (value === undefined) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Reef ${label} must be a non-negative integer.`);
  }
  return value;
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
  db.exec("BEGIN IMMEDIATE");
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
