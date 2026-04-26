import type {
  SchemaColumn,
  SchemaEnum,
  SchemaIR,
  SchemaNamespace,
  SchemaRpc,
  SchemaSourceRef,
  SchemaTable,
  SchemaView,
} from "@mako-ai/contracts";
import {
  fetchTableSchemas,
  PgConnectionError,
  withReadOnlyConnection,
  type PgReadContext,
  type PgResolvedTable,
  type PgTableSchemaResult,
} from "@mako-ai/extension-postgres";
import { ProjectCommandError } from "../errors.js";

export interface FetchLiveSchemaIROptions {
  databaseUrl: string;
  includedSchemas?: string[];
  statementTimeoutMs?: number;
}

interface SchemaNameRow {
  schema_name: string;
}

interface TableRow {
  schema_name: string;
  table_name: string;
  rel_kind: string;
  oid: number;
}

interface EnumRow {
  schema_name: string;
  enum_name: string;
  enum_value: string;
}

interface FunctionRow {
  schema_name: string;
  function_name: string;
  return_type: string | null;
  arg_types: string[];
}

const SYSTEM_SCHEMA_EXCLUSIONS = ["pg_catalog", "information_schema", "pg_toast"];

function buildDefaultSchemaFilterClause(schemaField: string): string {
  return `
    ${schemaField} NOT IN ('${SYSTEM_SCHEMA_EXCLUSIONS.join("','")}')
    AND ${schemaField} NOT LIKE 'pg\\_temp\\_%' ESCAPE '\\'
    AND ${schemaField} NOT LIKE 'pg\\_toast\\_temp\\_%' ESCAPE '\\'
  `;
}

function buildSchemaPredicate(schemaField: string, includedSchemas: string[] | undefined): string {
  if (includedSchemas && includedSchemas.length > 0) {
    return `${schemaField} = ANY($1::text[])`;
  }

  return buildDefaultSchemaFilterClause(schemaField);
}

function buildSchemaParams(includedSchemas: string[] | undefined): unknown[] {
  if (includedSchemas && includedSchemas.length > 0) {
    return [includedSchemas];
  }

  return [];
}

function makeLiveSourceRef(schemaName: string): SchemaSourceRef {
  return {
    kind: "live_catalog",
    path: `live:${schemaName}`,
  };
}

function emptyNamespace(): SchemaNamespace {
  return { tables: [], views: [], enums: [], rpcs: [] };
}

function ensureNamespace(ir: SchemaIR, schemaName: string): SchemaNamespace {
  let namespace = ir.schemas[schemaName];
  if (!namespace) {
    namespace = emptyNamespace();
    ir.schemas[schemaName] = namespace;
  }
  return namespace;
}

async function fetchSchemaNames(
  context: PgReadContext,
  includedSchemas: string[] | undefined,
): Promise<string[]> {
  const params = buildSchemaParams(includedSchemas);
  const result = await context.query<SchemaNameRow>(
    `SELECT nspname AS schema_name
     FROM pg_catalog.pg_namespace
     WHERE ${buildSchemaPredicate("nspname", includedSchemas)}
     ORDER BY nspname`,
    params,
  );

  return result.rows.map((row) => row.schema_name);
}

async function fetchTables(
  context: PgReadContext,
  includedSchemas: string[] | undefined,
): Promise<TableRow[]> {
  const params = buildSchemaParams(includedSchemas);
  const result = await context.query<TableRow>(
    `SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relkind::text AS rel_kind,
      c.oid::int AS oid
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm')
       AND ${buildSchemaPredicate("n.nspname", includedSchemas)}
     ORDER BY n.nspname, c.relname, c.oid`,
    params,
  );

  return result.rows;
}

async function fetchEnums(
  context: PgReadContext,
  includedSchemas: string[] | undefined,
): Promise<EnumRow[]> {
  const params = buildSchemaParams(includedSchemas);
  const result = await context.query<EnumRow>(
    `SELECT
      n.nspname AS schema_name,
      t.typname AS enum_name,
      e.enumlabel AS enum_value
     FROM pg_catalog.pg_type t
     JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
     JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
     WHERE t.typtype = 'e'
       AND ${buildSchemaPredicate("n.nspname", includedSchemas)}
     ORDER BY n.nspname, t.typname, e.enumsortorder`,
    params,
  );

  return result.rows;
}

async function fetchFunctions(
  context: PgReadContext,
  includedSchemas: string[] | undefined,
): Promise<FunctionRow[]> {
  const params = buildSchemaParams(includedSchemas);
  const result = await context.query<FunctionRow>(
    `SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      CASE
        WHEN p.prokind = 'p' THEN 'procedure'
        ELSE COALESCE(pg_catalog.pg_get_function_result(p.oid), 'void')
      END AS return_type,
      COALESCE(
        ARRAY(
          SELECT pg_catalog.format_type(arg_oid::oid, NULL)
          FROM unnest(
            CASE
              WHEN btrim(COALESCE(p.proargtypes::text, '')) = '' THEN ARRAY[]::text[]
              ELSE string_to_array(p.proargtypes::text, ' ')
            END
          ) WITH ORDINALITY AS args(arg_oid, ord)
          ORDER BY ord
        ),
        ARRAY[]::text[]
      ) AS arg_types
     FROM pg_catalog.pg_proc p
     JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prokind IN ('f', 'p')
       AND ${buildSchemaPredicate("n.nspname", includedSchemas)}
     ORDER BY n.nspname, p.proname, p.oid`,
    params,
  );

  return result.rows;
}

function emptyTableShape(): PgTableSchemaResult {
  return {
    columns: [],
    indexes: [],
    constraints: [],
    foreignKeys: { outbound: [], inbound: [] },
    rls: { rlsEnabled: false, forceRls: false, policies: [] },
    triggers: [],
  };
}

async function assembleLiveIR(
  context: PgReadContext,
  schemaNames: string[],
  tableRows: TableRow[],
  enumRows: EnumRow[],
  functionRows: FunctionRow[],
): Promise<SchemaIR> {
  const ir: SchemaIR = { version: "1.0.0", schemas: {} };

  for (const schemaName of schemaNames) {
    ensureNamespace(ir, schemaName);
  }

  // Batch-fetch per-table shapes for every concrete relation in scope. This
  // replaces the old per-table loop that used to run ~7-15 sequential round
  // trips per table. Views and materialized views don't participate — they go
  // straight into the `views` namespace list with just a source ref.
  const concreteTables = tableRows.filter((row) => row.rel_kind === "r" || row.rel_kind === "p");
  const tableShapes = await fetchTableSchemas(
    context,
    concreteTables.map((row) => ({
      schema: row.schema_name,
      table: row.table_name,
      oid: row.oid,
    })) satisfies PgResolvedTable[],
  );

  for (const row of tableRows) {
    const namespace = ensureNamespace(ir, row.schema_name);
    const sourceRef = makeLiveSourceRef(row.schema_name);

    if (row.rel_kind === "v" || row.rel_kind === "m") {
      const view: SchemaView = {
        name: row.table_name,
        schema: row.schema_name,
        sources: [sourceRef],
      };
      namespace.views.push(view);
      continue;
    }

    const tableShape = tableShapes.get(row.oid) ?? emptyTableShape();
    const primaryKey = tableShape.columns.filter((column) => column.isPrimaryKey).map((column) => column.name);

    const table: SchemaTable = {
      name: row.table_name,
      schema: row.schema_name,
      columns: tableShape.columns.map<SchemaColumn>((column) => ({
        name: column.name,
        dataType: column.type,
        nullable: column.nullable,
        defaultExpression: column.default ?? undefined,
        isPrimaryKey: column.isPrimaryKey || undefined,
        sources: [sourceRef],
      })),
      ...(primaryKey.length > 0 ? { primaryKey } : {}),
      indexes: tableShape.indexes.map((index) => ({
        name: index.name,
        unique: index.unique,
        primary: index.primary,
        columns: [...index.columns],
        definition: index.definition ?? null,
      })),
      foreignKeys: {
        outbound: tableShape.foreignKeys.outbound.map((fk) => ({
          constraintName: fk.constraintName,
          columns: [...fk.columns],
          targetSchema: fk.targetSchema,
          targetTable: fk.targetTable,
          targetColumns: [...fk.targetColumns],
          onUpdate: fk.onUpdate,
          onDelete: fk.onDelete,
        })),
        inbound: tableShape.foreignKeys.inbound.map((fk) => ({
          constraintName: fk.constraintName,
          sourceSchema: fk.sourceSchema,
          sourceTable: fk.sourceTable,
          sourceColumns: [...fk.sourceColumns],
          columns: [...fk.columns],
          onUpdate: fk.onUpdate,
          onDelete: fk.onDelete,
        })),
      },
      rls: {
        rlsEnabled: tableShape.rls.rlsEnabled,
        forceRls: tableShape.rls.forceRls,
        policies: tableShape.rls.policies.map((policy) => ({
          name: policy.name,
          mode: policy.mode,
          command: policy.command,
          roles: [...policy.roles],
          usingExpression: policy.usingExpression,
          withCheckExpression: policy.withCheckExpression,
        })),
      },
      triggers: tableShape.triggers.map((trigger) => ({
        name: trigger.name,
        enabled: trigger.enabled,
        enabledMode: trigger.enabledMode,
        timing: trigger.timing,
        events: [...trigger.events],
      })),
      sources: [sourceRef],
    };
    namespace.tables.push(table);
  }

  const enumIndex = new Map<string, SchemaEnum>();
  for (const row of enumRows) {
    const key = `${row.schema_name}.${row.enum_name}`;
    let enumDef = enumIndex.get(key);
    if (!enumDef) {
      enumDef = {
        name: row.enum_name,
        schema: row.schema_name,
        values: [],
        sources: [makeLiveSourceRef(row.schema_name)],
      };
      enumIndex.set(key, enumDef);
      const namespace = ensureNamespace(ir, row.schema_name);
      namespace.enums.push(enumDef);
    }
    enumDef.values.push(row.enum_value);
  }

  for (const row of functionRows) {
    const namespace = ensureNamespace(ir, row.schema_name);
    const rpc: SchemaRpc = {
      name: row.function_name,
      schema: row.schema_name,
      sources: [makeLiveSourceRef(row.schema_name)],
    };
    if (row.return_type) {
      rpc.returnType = row.return_type;
    }
    if (row.arg_types.length > 0) {
      rpc.argTypes = [...row.arg_types];
    }
    namespace.rpcs.push(rpc);
  }

  return ir;
}

export async function fetchLiveSchemaIR(options: FetchLiveSchemaIROptions): Promise<SchemaIR> {
  try {
    return await withReadOnlyConnection(
      {
        databaseUrl: options.databaseUrl,
        statementTimeoutMs: options.statementTimeoutMs ?? 30_000,
      },
      async (context) => {
        const schemaNames = await fetchSchemaNames(context, options.includedSchemas);
        const tableRows = await fetchTables(context, options.includedSchemas);
        const enumRows = await fetchEnums(context, options.includedSchemas);
        const functionRows = await fetchFunctions(context, options.includedSchemas);
        return assembleLiveIR(context, schemaNames, tableRows, enumRows, functionRows);
      },
    );
  } catch (error) {
    if (error instanceof PgConnectionError) {
      throw new ProjectCommandError(
        500,
        "db_connection_test_failed",
        `Failed to read live catalog: ${error.message}`,
        { code: error.code },
      );
    }
    throw error;
  }
}
