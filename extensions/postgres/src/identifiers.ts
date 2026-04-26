import type { PgReadContext } from "./connection.js";

export type PgObjectKind = "table" | "view" | "function" | "procedure";

export interface PgResolvedTable {
  schema: string;
  table: string;
  oid: number;
}

export interface PgResolvedFunction {
  schema: string;
  name: string;
  oid: number;
  kind: "function" | "procedure";
  argTypes: string[];
  signature: string;
}

export interface PgTableObjectCandidate {
  schema: string;
  name: string;
  kind: "table" | "view";
}

export interface PgRoutineCandidate {
  schema: string;
  name: string;
  kind: "function" | "procedure";
  argTypes: string[];
  signature: string;
}

export type PgObjectCandidate = PgTableObjectCandidate | PgRoutineCandidate;

export interface PgResolveResult<T> {
  resolved: T | null;
  candidates: PgObjectCandidate[];
  requested: {
    schema: string | null;
    name: string;
    argTypes?: string[] | null;
  };
}

export async function resolveTable(
  context: PgReadContext,
  table: string,
  schema?: string,
): Promise<PgResolveResult<PgResolvedTable>> {
  const requested = { schema: schema ?? null, name: table };

  const result = await context.query<{
    schema_name: string;
    table_name: string;
    oid: number;
    relkind: string;
  }>(
    `SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.oid::int AS oid,
      c.relkind AS relkind
     FROM pg_catalog.pg_class c
     INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = $1
       AND c.relkind IN ('r','p','v','m','f')
       AND ($2::text IS NULL OR n.nspname = $2)
       AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
       AND n.nspname <> 'information_schema'
     ORDER BY n.nspname, c.relname`,
    [table, schema ?? null],
  );

  if (result.rows.length === 1) {
    const row = result.rows[0];
    return {
      resolved: {
        schema: row.schema_name,
        table: row.table_name,
        oid: row.oid,
      },
      candidates: [],
      requested,
    };
  }

  const candidates = result.rows.map<PgTableObjectCandidate>((row) => ({
    schema: row.schema_name,
    name: row.table_name,
    kind: row.relkind === "v" || row.relkind === "m" ? "view" : "table",
  }));

  return {
    resolved: null,
    candidates,
    requested,
  };
}

export async function resolveFunction(
  context: PgReadContext,
  name: string,
  schema?: string,
  argTypes?: string[],
): Promise<PgResolveResult<PgResolvedFunction>> {
  const requested = { schema: schema ?? null, name, argTypes: argTypes ?? null };

  const result = await context.query<{
    schema_name: string;
    proname: string;
    oid: number;
    prokind: string;
    arg_types: string[];
    signature: string;
  }>(
    `SELECT
       n.nspname AS schema_name,
       p.proname AS proname,
       p.oid::int AS oid,
       p.prokind AS prokind,
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
       ) AS arg_types,
       CASE
         WHEN pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
           THEN format('%I()', p.proname)
         ELSE format('%I(%s)', p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))
       END AS signature
      FROM pg_catalog.pg_proc p
      INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = $1
        AND ($2::text IS NULL OR n.nspname = $2)
        AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
        AND n.nspname <> 'information_schema'
      ORDER BY n.nspname, p.proname, signature, p.prokind`,
    [name, schema ?? null],
  );

  const rows =
    argTypes == null
      ? result.rows
      : result.rows.filter(
          (row) => row.arg_types.length === argTypes.length && row.arg_types.every((type, index) => type === argTypes[index]),
        );

  if (rows.length === 1) {
    const row = rows[0];
    return {
      resolved: {
        schema: row.schema_name,
        name: row.proname,
        oid: row.oid,
        kind: row.prokind === "p" ? "procedure" : "function",
        argTypes: row.arg_types,
        signature: row.signature,
      },
      candidates: [],
      requested,
    };
  }

  const candidates = rows.map<PgRoutineCandidate>((row) => ({
    schema: row.schema_name,
    name: row.proname,
    kind: row.prokind === "p" ? "procedure" : "function",
    argTypes: row.arg_types,
    signature: row.signature,
  }));

  return {
    resolved: null,
    candidates,
    requested,
  };
}
