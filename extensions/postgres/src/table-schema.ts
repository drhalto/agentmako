import type { PgReadContext } from "./connection.js";
import { fetchColumnsBulk, type PgColumnDescriptor } from "./columns.js";
import { fetchForeignKeysBulk, type PgForeignKeyResult } from "./foreign-keys.js";
import { fetchRlsBulk, type PgRlsResult } from "./rls.js";
import type { PgResolvedTable } from "./identifiers.js";

export interface PgIndexDescriptor {
  name: string;
  unique: boolean;
  primary: boolean;
  columns: string[];
  definition: string | null;
}

export interface PgConstraintDescriptor {
  name: string;
  type: string;
  definition: string | null;
}

export interface PgTriggerDescriptor {
  name: string;
  enabled: boolean;
  enabledMode: "O" | "D" | "R" | "A";
  timing: string;
  events: string[];
}

export interface PgTableSchemaResult {
  columns: PgColumnDescriptor[];
  indexes: PgIndexDescriptor[];
  constraints: PgConstraintDescriptor[];
  foreignKeys: PgForeignKeyResult;
  rls: PgRlsResult;
  triggers: PgTriggerDescriptor[];
}

function mapConstraintType(code: string | null): string {
  switch (code) {
    case "p":
      return "PRIMARY KEY";
    case "u":
      return "UNIQUE";
    case "f":
      return "FOREIGN KEY";
    case "c":
      return "CHECK";
    case "x":
      return "EXCLUSION";
    case "t":
      return "TRIGGER";
    default:
      return code ?? "UNKNOWN";
  }
}

function mapTriggerTiming(tgtype: number): { timing: string; events: string[] } {
  const isBefore = (tgtype & (1 << 1)) !== 0;
  const isInsteadOf = (tgtype & (1 << 6)) !== 0;
  const isInsert = (tgtype & (1 << 2)) !== 0;
  const isDelete = (tgtype & (1 << 3)) !== 0;
  const isUpdate = (tgtype & (1 << 4)) !== 0;
  const isTruncate = (tgtype & (1 << 5)) !== 0;

  const timing = isInsteadOf ? "INSTEAD OF" : isBefore ? "BEFORE" : "AFTER";
  const events: string[] = [];
  if (isInsert) events.push("INSERT");
  if (isDelete) events.push("DELETE");
  if (isUpdate) events.push("UPDATE");
  if (isTruncate) events.push("TRUNCATE");

  return { timing, events };
}

async function fetchIndexesBulk(
  context: PgReadContext,
  oids: number[],
): Promise<Map<number, PgIndexDescriptor[]>> {
  const result = new Map<number, PgIndexDescriptor[]>();
  if (oids.length === 0) {
    return result;
  }

  const rows = await context.query<{
    relid: number;
    name: string;
    is_unique: boolean;
    is_primary: boolean;
    columns: string[];
    definition: string | null;
  }>(
    `SELECT
      i.indrelid::int AS relid,
      ic.relname AS name,
      i.indisunique AS is_unique,
      i.indisprimary AS is_primary,
      COALESCE(
        ARRAY(
          SELECT a.attname::text
          FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
          LEFT JOIN pg_catalog.pg_attribute a
            ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE k.attnum > 0
            AND a.attname IS NOT NULL
          ORDER BY k.ord
        ),
        ARRAY[]::text[]
      ) AS columns,
      pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
     FROM pg_catalog.pg_index i
     INNER JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
     WHERE i.indrelid = ANY($1::int[])
     ORDER BY i.indrelid, ic.relname`,
    [oids],
  );

  for (const row of rows.rows) {
    const descriptor: PgIndexDescriptor = {
      name: row.name,
      unique: row.is_unique,
      primary: row.is_primary,
      columns: row.columns,
      definition: row.definition ?? null,
    };
    const bucket = result.get(row.relid);
    if (bucket) {
      bucket.push(descriptor);
    } else {
      result.set(row.relid, [descriptor]);
    }
  }

  return result;
}

async function fetchConstraintsBulk(
  context: PgReadContext,
  oids: number[],
): Promise<Map<number, PgConstraintDescriptor[]>> {
  const result = new Map<number, PgConstraintDescriptor[]>();
  if (oids.length === 0) {
    return result;
  }

  const rows = await context.query<{
    relid: number;
    name: string;
    contype: string;
    definition: string | null;
  }>(
    `SELECT
      conrelid::int AS relid,
      conname AS name,
      contype::text AS contype,
      pg_catalog.pg_get_constraintdef(oid) AS definition
     FROM pg_catalog.pg_constraint
     WHERE conrelid = ANY($1::int[])
     ORDER BY conrelid, conname`,
    [oids],
  );

  for (const row of rows.rows) {
    const descriptor: PgConstraintDescriptor = {
      name: row.name,
      type: mapConstraintType(row.contype),
      definition: row.definition ?? null,
    };
    const bucket = result.get(row.relid);
    if (bucket) {
      bucket.push(descriptor);
    } else {
      result.set(row.relid, [descriptor]);
    }
  }

  return result;
}

async function fetchTriggersBulk(
  context: PgReadContext,
  oids: number[],
): Promise<Map<number, PgTriggerDescriptor[]>> {
  const result = new Map<number, PgTriggerDescriptor[]>();
  if (oids.length === 0) {
    return result;
  }

  const rows = await context.query<{
    relid: number;
    name: string;
    enabled_mode: string;
    tgtype: number;
  }>(
    `SELECT
      tgrelid::int AS relid,
      tgname AS name,
      tgenabled::text AS enabled_mode,
      tgtype::int AS tgtype
     FROM pg_catalog.pg_trigger
     WHERE tgrelid = ANY($1::int[])
       AND NOT tgisinternal
     ORDER BY tgrelid, tgname`,
    [oids],
  );

  for (const row of rows.rows) {
    const { timing, events } = mapTriggerTiming(row.tgtype);
    const enabledMode = ["O", "D", "R", "A"].includes(row.enabled_mode)
      ? (row.enabled_mode as "O" | "D" | "R" | "A")
      : "O";
    const descriptor: PgTriggerDescriptor = {
      name: row.name,
      enabled: enabledMode !== "D",
      enabledMode,
      timing,
      events,
    };
    const bucket = result.get(row.relid);
    if (bucket) {
      bucket.push(descriptor);
    } else {
      result.set(row.relid, [descriptor]);
    }
  }

  return result;
}

function emptyTableSchemaResult(): PgTableSchemaResult {
  return {
    columns: [],
    indexes: [],
    constraints: [],
    foreignKeys: { outbound: [], inbound: [] },
    rls: { rlsEnabled: false, forceRls: false, policies: [] },
    triggers: [],
  };
}

// Fetch the full schema shape for every passed table in a bounded number of
// round trips (6 bulk queries total, regardless of how many tables are in the
// scope). Sequential awaits because pg single-client can't multiplex; they
// serialize at the protocol level anyway. Replaces the per-table loop that
// used to cost ~7-15 round trips per table.
export async function fetchTableSchemas(
  context: PgReadContext,
  tables: PgResolvedTable[],
): Promise<Map<number, PgTableSchemaResult>> {
  const result = new Map<number, PgTableSchemaResult>();
  if (tables.length === 0) {
    return result;
  }

  const oids = tables.map((table) => table.oid);
  const columnsMap = await fetchColumnsBulk(context, oids);
  const indexesMap = await fetchIndexesBulk(context, oids);
  const constraintsMap = await fetchConstraintsBulk(context, oids);
  const foreignKeysMap = await fetchForeignKeysBulk(context, oids);
  const rlsMap = await fetchRlsBulk(context, oids);
  const triggersMap = await fetchTriggersBulk(context, oids);

  for (const table of tables) {
    result.set(table.oid, {
      columns: columnsMap.get(table.oid) ?? [],
      indexes: indexesMap.get(table.oid) ?? [],
      constraints: constraintsMap.get(table.oid) ?? [],
      foreignKeys: foreignKeysMap.get(table.oid) ?? { outbound: [], inbound: [] },
      rls: rlsMap.get(table.oid) ?? { rlsEnabled: false, forceRls: false, policies: [] },
      triggers: triggersMap.get(table.oid) ?? [],
    });
  }

  return result;
}

export async function fetchTableSchema(
  context: PgReadContext,
  table: PgResolvedTable,
): Promise<PgTableSchemaResult> {
  const map = await fetchTableSchemas(context, [table]);
  return map.get(table.oid) ?? emptyTableSchemaResult();
}
