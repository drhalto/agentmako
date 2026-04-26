import { DatabaseSync } from "node:sqlite";
import type {
  SchemaFreshnessStatus,
  SchemaIR,
  SchemaSnapshot,
  SchemaSnapshotWarning,
  SchemaSourceKind,
  SchemaSourceMode,
} from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";
import { deriveFunctionTableRefs } from "./sql-analysis.js";

interface SchemaSnapshotRow {
  snapshot_id: string;
  source_mode: SchemaSourceMode;
  generated_at: string;
  refreshed_at: string;
  verified_at: string | null;
  fingerprint: string;
  freshness_status: SchemaFreshnessStatus;
  drift_detected: number;
  drift_detected_at: string | null;
  ir_json: string;
  warnings_json: string;
}

interface SchemaSnapshotSourceRow {
  source_kind: SchemaSourceKind;
  source_path: string;
  content_sha256: string;
  last_modified_at: string | null;
  size_bytes: number | null;
}

const SCHEMA_SNAPSHOT_READ_MODEL_TABLES = [
  "schema_snapshot_function_refs",
  "schema_snapshot_rpcs",
  "schema_snapshot_enums",
  "schema_snapshot_views",
  "schema_snapshot_triggers",
  "schema_snapshot_rls_policies",
  "schema_snapshot_foreign_keys",
  "schema_snapshot_indexes",
  "schema_snapshot_primary_keys",
  "schema_snapshot_columns",
  "schema_snapshot_tables",
  "schema_snapshot_schemas",
] as const;

function clearSchemaSnapshotReadModel(db: DatabaseSync): void {
  for (const tableName of SCHEMA_SNAPSHOT_READ_MODEL_TABLES) {
    db.prepare(`DELETE FROM ${tableName} WHERE snapshot_slot = 1`).run();
  }
}

function rebuildFunctionRefReadModel(db: DatabaseSync): void {
  db.prepare("DELETE FROM schema_snapshot_function_refs WHERE snapshot_slot = 1").run();

  const insertFunctionRef = db.prepare(`
    INSERT OR IGNORE INTO schema_snapshot_function_refs(
      snapshot_slot,
      rpc_schema,
      rpc_name,
      rpc_kind,
      arg_types_json,
      target_schema,
      target_table
    )
    VALUES(1, ?, ?, ?, ?, ?, ?)
  `);

  const rpcRows = db
    .prepare(`
      SELECT schema_name, rpc_name, rpc_kind, arg_types_json, body_text
      FROM schema_snapshot_rpcs
      WHERE snapshot_slot = 1
        AND body_text IS NOT NULL
    `)
    .all() as Array<{
    schema_name: string;
    rpc_name: string;
    rpc_kind: "function" | "procedure";
    arg_types_json: string;
    body_text: string;
  }>;

  for (const row of rpcRows) {
    for (const ref of deriveFunctionTableRefs(row.body_text)) {
      insertFunctionRef.run(
        row.schema_name,
        row.rpc_name,
        row.rpc_kind,
        row.arg_types_json,
        ref.targetSchema,
        ref.targetTable,
      );
    }
  }
}

function rebuildSchemaSnapshotReadModel(db: DatabaseSync, snapshot: SchemaSnapshot): void {
  clearSchemaSnapshotReadModel(db);

  const insertSchema = db.prepare(`
    INSERT INTO schema_snapshot_schemas(snapshot_slot, schema_name)
    VALUES(1, ?)
  `);
  const insertTable = db.prepare(`
    INSERT INTO schema_snapshot_tables(snapshot_slot, schema_name, table_name)
    VALUES(1, ?, ?)
  `);
  const insertColumn = db.prepare(`
    INSERT INTO schema_snapshot_columns(
      snapshot_slot,
      schema_name,
      table_name,
      column_name,
      ordinal_position,
      data_type,
      nullable,
      default_expression,
      is_primary_key
    )
    VALUES(1, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPrimaryKey = db.prepare(`
    INSERT INTO schema_snapshot_primary_keys(
      snapshot_slot,
      schema_name,
      table_name,
      column_name,
      ordinal_position
    )
    VALUES(1, ?, ?, ?, ?)
  `);
  const insertIndex = db.prepare(`
    INSERT INTO schema_snapshot_indexes(
      snapshot_slot,
      schema_name,
      table_name,
      index_name,
      is_unique,
      is_primary,
      definition,
      columns_json
    )
    VALUES(1, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertForeignKey = db.prepare(`
    INSERT INTO schema_snapshot_foreign_keys(
      snapshot_slot,
      schema_name,
      table_name,
      constraint_name,
      target_schema,
      target_table,
      on_update,
      on_delete,
      columns_json,
      target_columns_json
    )
    VALUES(1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPolicy = db.prepare(`
    INSERT INTO schema_snapshot_rls_policies(
      snapshot_slot,
      schema_name,
      table_name,
      policy_name,
      mode,
      command,
      roles_json,
      using_expression,
      with_check_expression
    )
    VALUES(1, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTrigger = db.prepare(`
    INSERT INTO schema_snapshot_triggers(
      snapshot_slot,
      schema_name,
      table_name,
      trigger_name,
      enabled,
      enabled_mode,
      timing,
      events_json,
      body_text
    )
    VALUES(1, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertView = db.prepare(`
    INSERT INTO schema_snapshot_views(snapshot_slot, schema_name, view_name)
    VALUES(1, ?, ?)
  `);
  const insertEnum = db.prepare(`
    INSERT INTO schema_snapshot_enums(
      snapshot_slot,
      schema_name,
      enum_name,
      enum_value,
      sort_order
    )
    VALUES(1, ?, ?, ?, ?)
  `);
  const insertRpc = db.prepare(`
    INSERT INTO schema_snapshot_rpcs(
      snapshot_slot,
      schema_name,
      rpc_name,
      rpc_kind,
      return_type,
      arg_types_json,
      body_text
    )
    VALUES(1, ?, ?, ?, ?, ?, ?)
  `);
  for (const [schemaName, namespace] of Object.entries(snapshot.ir.schemas)) {
    insertSchema.run(schemaName);

    for (const table of namespace.tables) {
      insertTable.run(schemaName, table.name);

      table.columns.forEach((column, index) => {
        insertColumn.run(
          schemaName,
          table.name,
          column.name,
          index + 1,
          column.dataType,
          column.nullable ? 1 : 0,
          column.defaultExpression ?? null,
          column.isPrimaryKey ? 1 : 0,
        );
      });

      table.primaryKey?.forEach((columnName, index) => {
        insertPrimaryKey.run(schemaName, table.name, columnName, index + 1);
      });

      table.indexes?.forEach((index) => {
        insertIndex.run(
          schemaName,
          table.name,
          index.name,
          index.unique ? 1 : 0,
          index.primary ? 1 : 0,
          index.definition ?? null,
          stringifyJson(index.columns),
        );
      });

      table.foreignKeys?.outbound.forEach((fk) => {
        insertForeignKey.run(
          schemaName,
          table.name,
          fk.constraintName,
          fk.targetSchema,
          fk.targetTable,
          fk.onUpdate,
          fk.onDelete,
          stringifyJson(fk.columns),
          stringifyJson(fk.targetColumns),
        );
      });

      table.rls?.policies.forEach((policy) => {
        insertPolicy.run(
          schemaName,
          table.name,
          policy.name,
          policy.mode,
          policy.command,
          stringifyJson(policy.roles),
          policy.usingExpression ?? null,
          policy.withCheckExpression ?? null,
        );
      });

      table.triggers?.forEach((trigger) => {
        insertTrigger.run(
          schemaName,
          table.name,
          trigger.name,
          trigger.enabled ? 1 : 0,
          trigger.enabledMode,
          trigger.timing,
          stringifyJson(trigger.events),
          trigger.bodyText ?? null,
        );
      });
    }

    namespace.views.forEach((view) => {
      insertView.run(schemaName, view.name);
    });

    namespace.enums.forEach((enumDef) => {
      enumDef.values.forEach((value, index) => {
        insertEnum.run(schemaName, enumDef.name, value, index + 1);
      });
    });

    namespace.rpcs.forEach((rpc) => {
      insertRpc.run(
        schemaName,
        rpc.name,
        rpc.returnType === "procedure" ? "procedure" : "function",
        rpc.returnType ?? null,
        stringifyJson(rpc.argTypes ?? []),
        rpc.bodyText ?? null,
      );
    });
  }

  rebuildFunctionRefReadModel(db);
}

export function saveSchemaSnapshotImpl(db: DatabaseSync, snapshot: SchemaSnapshot): void {
  db.exec("BEGIN");

  try {
    db
      .prepare(`
        INSERT INTO schema_snapshots(
          snapshot_slot,
          snapshot_id,
          source_mode,
          generated_at,
          refreshed_at,
          verified_at,
          fingerprint,
          freshness_status,
          drift_detected,
          drift_detected_at,
          ir_json,
          warnings_json
        )
        VALUES(1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(snapshot_slot) DO UPDATE SET
          snapshot_id = excluded.snapshot_id,
          source_mode = excluded.source_mode,
          generated_at = excluded.generated_at,
          refreshed_at = excluded.refreshed_at,
          verified_at = excluded.verified_at,
          fingerprint = excluded.fingerprint,
          freshness_status = excluded.freshness_status,
          drift_detected = excluded.drift_detected,
          drift_detected_at = excluded.drift_detected_at,
          ir_json = excluded.ir_json,
          warnings_json = excluded.warnings_json
      `)
      .run(
        snapshot.snapshotId,
        snapshot.sourceMode,
        snapshot.generatedAt,
        snapshot.refreshedAt,
        snapshot.verifiedAt ?? null,
        snapshot.fingerprint,
        snapshot.freshnessStatus,
        snapshot.driftDetected ? 1 : 0,
        snapshot.driftDetectedAt ?? null,
        stringifyJson(snapshot.ir),
        stringifyJson(snapshot.warnings),
      );

    db.prepare(`DELETE FROM schema_snapshot_sources WHERE snapshot_slot = 1`).run();

    const insertSource = db.prepare(`
      INSERT INTO schema_snapshot_sources(
        snapshot_slot,
        source_kind,
        source_path,
        content_sha256,
        last_modified_at,
        size_bytes
      )
      VALUES(1, ?, ?, ?, ?, ?)
    `);

    for (const source of snapshot.sources) {
      insertSource.run(
        source.kind,
        source.path,
        source.sha256,
        source.lastModifiedAt ?? null,
        source.sizeBytes ?? null,
      );
    }

    rebuildSchemaSnapshotReadModel(db, snapshot);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function backfillSchemaSnapshotFunctionRefsImpl(db: DatabaseSync): void {
  rebuildFunctionRefReadModel(db);
}

export function loadSchemaSnapshotImpl(db: DatabaseSync): SchemaSnapshot | null {
  const row = db
    .prepare(`
      SELECT
        snapshot_id,
        source_mode,
        generated_at,
        refreshed_at,
        verified_at,
        fingerprint,
        freshness_status,
        drift_detected,
        drift_detected_at,
        ir_json,
        warnings_json
      FROM schema_snapshots
      WHERE snapshot_slot = 1
    `)
    .get() as SchemaSnapshotRow | undefined;

  if (!row) {
    return null;
  }

  const sourceRows = db
    .prepare(`
      SELECT source_kind, source_path, content_sha256, last_modified_at, size_bytes
      FROM schema_snapshot_sources
      WHERE snapshot_slot = 1
      ORDER BY source_path ASC
    `)
    .all() as unknown as SchemaSnapshotSourceRow[];

  const ir = parseJson<SchemaIR>(row.ir_json, { version: "1.0.0", schemas: {} });
  const warnings = parseJson<SchemaSnapshotWarning[]>(row.warnings_json, []);

  return {
    snapshotId: row.snapshot_id,
    sourceMode: row.source_mode,
    generatedAt: row.generated_at,
    refreshedAt: row.refreshed_at,
    verifiedAt: row.verified_at ?? undefined,
    fingerprint: row.fingerprint,
    freshnessStatus: row.freshness_status,
    driftDetected: row.drift_detected === 1,
    driftDetectedAt: row.drift_detected_at ?? undefined,
    sources: sourceRows.map((source) => ({
      kind: source.source_kind,
      path: source.source_path,
      sha256: source.content_sha256,
      lastModifiedAt: source.last_modified_at ?? undefined,
      sizeBytes: source.size_bytes ?? undefined,
    })),
    warnings: Array.isArray(warnings) ? warnings : [],
    ir: ir ?? { version: "1.0.0", schemas: {} },
  };
}

export function clearSchemaSnapshotImpl(db: DatabaseSync): void {
  db.exec("BEGIN");

  try {
    db.prepare(`DELETE FROM schema_snapshots WHERE snapshot_slot = 1`).run();
    clearSchemaSnapshotReadModel(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markSchemaSnapshotVerifiedImpl(db: DatabaseSync, args: { verifiedAt: string }): void {
  db
    .prepare(`
      UPDATE schema_snapshots
      SET
        source_mode = CASE
          WHEN source_mode = 'repo_only' THEN 'repo_plus_live_verify'
          ELSE source_mode
        END,
        verified_at = ?,
        drift_detected = 0,
        drift_detected_at = NULL,
        freshness_status = 'verified'
      WHERE snapshot_slot = 1
    `)
    .run(args.verifiedAt);
}

export function markSchemaSnapshotDriftImpl(db: DatabaseSync, args: { driftDetectedAt: string }): void {
  db
    .prepare(`
      UPDATE schema_snapshots
      SET
        source_mode = CASE
          WHEN source_mode = 'repo_only' THEN 'repo_plus_live_verify'
          ELSE source_mode
        END,
        verified_at = ?,
        drift_detected = 1,
        drift_detected_at = ?,
        freshness_status = 'drift_detected'
      WHERE snapshot_slot = 1
    `)
    .run(args.driftDetectedAt, args.driftDetectedAt);
}
