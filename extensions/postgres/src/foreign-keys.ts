import type { PgReadContext } from "./connection.js";
import type { PgResolvedTable } from "./identifiers.js";

export interface PgForeignKeyOutbound {
  constraintName: string;
  columns: string[];
  targetSchema: string;
  targetTable: string;
  targetColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface PgForeignKeyInbound {
  constraintName: string;
  sourceSchema: string;
  sourceTable: string;
  sourceColumns: string[];
  columns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface PgForeignKeyResult {
  outbound: PgForeignKeyOutbound[];
  inbound: PgForeignKeyInbound[];
}

function mapFkAction(code: string | null): string {
  switch (code) {
    case "a":
      return "NO ACTION";
    case "r":
      return "RESTRICT";
    case "c":
      return "CASCADE";
    case "n":
      return "SET NULL";
    case "d":
      return "SET DEFAULT";
    default:
      return "NO ACTION";
  }
}

function emptyResult(): PgForeignKeyResult {
  return { outbound: [], inbound: [] };
}

function getOrCreate(map: Map<number, PgForeignKeyResult>, oid: number): PgForeignKeyResult {
  let entry = map.get(oid);
  if (!entry) {
    entry = emptyResult();
    map.set(oid, entry);
  }
  return entry;
}

export async function fetchForeignKeysBulk(
  context: PgReadContext,
  oids: number[],
): Promise<Map<number, PgForeignKeyResult>> {
  const result = new Map<number, PgForeignKeyResult>();
  if (oids.length === 0) {
    return result;
  }

  // Column names for each FK are resolved inline via ARRAY + unnest + JOIN
  // pg_attribute, so the whole bulk FK shape is one round trip regardless of
  // how many tables or FKs the schema contains. This replaces the old pattern
  // that ran 2 extra attribute-name lookups per FK row.
  const rows = await context.query<{
    conname: string;
    direction: "outbound" | "inbound";
    local_relid: number;
    local_cols: string[];
    remote_schema: string;
    remote_relname: string;
    remote_relid: number;
    remote_cols: string[];
    confupdtype: string;
    confdeltype: string;
  }>(
    `WITH fk_base AS (
       SELECT
         c.conname,
         c.conrelid,
         c.confrelid,
         c.conkey::int[] AS local_attnums,
         c.confkey::int[] AS remote_attnums,
         c.confupdtype::text AS confupdtype,
         c.confdeltype::text AS confdeltype
       FROM pg_catalog.pg_constraint c
       WHERE c.contype = 'f'
         AND (c.conrelid = ANY($1::int[]) OR c.confrelid = ANY($1::int[]))
     )
     SELECT
       fk.conname,
       'outbound'::text AS direction,
       fk.conrelid::int AS local_relid,
       COALESCE(
         ARRAY(
           SELECT a.attname::text
           FROM unnest(fk.local_attnums) WITH ORDINALITY AS k(attnum, ord)
           LEFT JOIN pg_catalog.pg_attribute a
             ON a.attrelid = fk.conrelid AND a.attnum = k.attnum
           WHERE a.attname IS NOT NULL
           ORDER BY k.ord
         ),
         ARRAY[]::text[]
       ) AS local_cols,
       fn.nspname AS remote_schema,
       fc.relname AS remote_relname,
       fk.confrelid::int AS remote_relid,
       COALESCE(
         ARRAY(
           SELECT a.attname::text
           FROM unnest(fk.remote_attnums) WITH ORDINALITY AS k(attnum, ord)
           LEFT JOIN pg_catalog.pg_attribute a
             ON a.attrelid = fk.confrelid AND a.attnum = k.attnum
           WHERE a.attname IS NOT NULL
           ORDER BY k.ord
         ),
         ARRAY[]::text[]
       ) AS remote_cols,
       fk.confupdtype,
       fk.confdeltype
     FROM fk_base fk
     INNER JOIN pg_catalog.pg_class fc ON fc.oid = fk.confrelid
     INNER JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
     WHERE fk.conrelid = ANY($1::int[])
     UNION ALL
     SELECT
       fk.conname,
       'inbound'::text AS direction,
       fk.conrelid::int AS local_relid,
       COALESCE(
         ARRAY(
           SELECT a.attname::text
           FROM unnest(fk.local_attnums) WITH ORDINALITY AS k(attnum, ord)
           LEFT JOIN pg_catalog.pg_attribute a
             ON a.attrelid = fk.conrelid AND a.attnum = k.attnum
           WHERE a.attname IS NOT NULL
           ORDER BY k.ord
         ),
         ARRAY[]::text[]
       ) AS local_cols,
       sn.nspname AS remote_schema,
       sc.relname AS remote_relname,
       fk.confrelid::int AS remote_relid,
       COALESCE(
         ARRAY(
           SELECT a.attname::text
           FROM unnest(fk.remote_attnums) WITH ORDINALITY AS k(attnum, ord)
           LEFT JOIN pg_catalog.pg_attribute a
             ON a.attrelid = fk.confrelid AND a.attnum = k.attnum
           WHERE a.attname IS NOT NULL
           ORDER BY k.ord
         ),
         ARRAY[]::text[]
       ) AS remote_cols,
       fk.confupdtype,
       fk.confdeltype
     FROM fk_base fk
     INNER JOIN pg_catalog.pg_class sc ON sc.oid = fk.conrelid
     INNER JOIN pg_catalog.pg_namespace sn ON sn.oid = sc.relnamespace
     WHERE fk.confrelid = ANY($1::int[])
     ORDER BY direction, conname`,
    [oids],
  );

  for (const row of rows.rows) {
    if (row.direction === "outbound") {
      const entry = getOrCreate(result, row.local_relid);
      entry.outbound.push({
        constraintName: row.conname,
        columns: row.local_cols,
        targetSchema: row.remote_schema,
        targetTable: row.remote_relname,
        targetColumns: row.remote_cols,
        onUpdate: mapFkAction(row.confupdtype),
        onDelete: mapFkAction(row.confdeltype),
      });
    } else {
      const entry = getOrCreate(result, row.remote_relid);
      entry.inbound.push({
        constraintName: row.conname,
        sourceSchema: row.remote_schema,
        sourceTable: row.remote_relname,
        sourceColumns: row.local_cols,
        columns: row.remote_cols,
        onUpdate: mapFkAction(row.confupdtype),
        onDelete: mapFkAction(row.confdeltype),
      });
    }
  }

  return result;
}

export async function fetchForeignKeys(
  context: PgReadContext,
  table: PgResolvedTable,
): Promise<PgForeignKeyResult> {
  const map = await fetchForeignKeysBulk(context, [table.oid]);
  return map.get(table.oid) ?? emptyResult();
}
