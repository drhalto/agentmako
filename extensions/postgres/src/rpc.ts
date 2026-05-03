import type { PgReadContext } from "./connection.js";
import type { PgResolvedFunction } from "./identifiers.js";

export type PgRpcArgMode = "in" | "out" | "inout" | "variadic" | "table";

export interface PgRpcArgument {
  name: string | null;
  type: string;
  mode: PgRpcArgMode;
}

export type PgRpcVolatility = "immutable" | "stable" | "volatile";

export interface PgRpcResult {
  args: PgRpcArgument[];
  returns: string;
  language: string;
  securityDefiner: boolean;
  volatility: PgRpcVolatility;
  source: string | null;
}

export interface PgRpcListEntry {
  schema: string;
  name: string;
  kind: "function" | "procedure";
  argTypes: string[];
  args: PgRpcArgument[];
  returns: string;
  language: string;
  securityDefiner: boolean;
  volatility: PgRpcVolatility;
}

function mapArgMode(code: string): PgRpcArgMode {
  switch (code) {
    case "i":
      return "in";
    case "o":
      return "out";
    case "b":
      return "inout";
    case "v":
      return "variadic";
    case "t":
      return "table";
    default:
      return "in";
  }
}

function mapVolatility(code: string): PgRpcVolatility {
  switch (code) {
    case "i":
      return "immutable";
    case "s":
      return "stable";
    default:
      return "volatile";
  }
}

export interface FetchRpcOptions {
  includeSource?: boolean;
}

export interface FetchRpcsOptions {
  schema?: string;
  limit?: number;
  includeSystemSchemas?: boolean;
}

export async function fetchRpc(
  context: PgReadContext,
  target: PgResolvedFunction,
  options: FetchRpcOptions = {},
): Promise<PgRpcResult> {
  const result = await context.query<{
    arg_names: string[] | null;
    arg_types: string[] | null;
    arg_modes: string[] | null;
    returns: string;
    prokind: string;
    language: string;
    security_definer: boolean;
    volatility: string;
    source: string | null;
  }>(
    `SELECT
      COALESCE(p.proargnames, ARRAY[]::text[]) AS arg_names,
      COALESCE(
        ARRAY(
          SELECT format_type(t::oid, NULL)
          FROM unnest(
            COALESCE(p.proallargtypes::oid[], p.proargtypes::oid[])
          ) AS t
        ),
        ARRAY[]::text[]
      ) AS arg_types,
      COALESCE(p.proargmodes::text[], ARRAY[]::text[]) AS arg_modes,
      CASE
        WHEN p.prokind = 'p' THEN 'procedure'
        ELSE COALESCE(pg_catalog.pg_get_function_result(p.oid), 'void')
      END AS returns,
      p.prokind::text AS prokind,
      l.lanname AS language,
      p.prosecdef AS security_definer,
      p.provolatile::text AS volatility,
      CASE WHEN $2::boolean THEN p.prosrc ELSE NULL END AS source
     FROM pg_catalog.pg_proc p
     INNER JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE p.oid = $1`,
    [target.oid, Boolean(options.includeSource)],
  );

  const row = result.rows[0];
  if (!row) {
    return {
      args: [],
      returns: "void",
      language: "unknown",
      securityDefiner: false,
      volatility: "volatile",
      source: null,
    };
  }

  const names = row.arg_names ?? [];
  const types = row.arg_types ?? [];
  const modes = row.arg_modes ?? [];

  const args: PgRpcArgument[] = types.map((type, index) => ({
    name: names[index] ?? null,
    type,
    mode: mapArgMode(modes[index] ?? "i"),
  }));

  return {
    args,
    returns: row.prokind === "p" ? "procedure" : row.returns,
    language: row.language,
    securityDefiner: row.security_definer,
    volatility: mapVolatility(row.volatility),
    source: row.source ?? null,
  };
}

export async function fetchRpcs(
  context: PgReadContext,
  options: FetchRpcsOptions = {},
): Promise<{ rpcs: PgRpcListEntry[]; truncated: boolean; limit: number }> {
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1_000));
  const result = await context.query<{
    schema_name: string;
    rpc_name: string;
    kind: "function" | "procedure";
    arg_names: string[] | null;
    arg_types: string[] | null;
    input_arg_types: string[] | null;
    arg_modes: string[] | null;
    returns: string;
    language: string;
    security_definer: boolean;
    volatility: string;
  }>(
    `SELECT
      n.nspname AS schema_name,
      p.proname AS rpc_name,
      CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS kind,
      COALESCE(p.proargnames, ARRAY[]::text[]) AS arg_names,
      COALESCE(
        ARRAY(
          SELECT format_type(t::oid, NULL)
          FROM unnest(
            COALESCE(p.proallargtypes::oid[], p.proargtypes::oid[])
          ) AS t
        ),
        ARRAY[]::text[]
      ) AS arg_types,
      COALESCE(
        ARRAY(
          SELECT format_type(t::oid, NULL)
          FROM unnest(p.proargtypes::oid[]) AS t
        ),
        ARRAY[]::text[]
      ) AS input_arg_types,
      COALESCE(p.proargmodes::text[], ARRAY[]::text[]) AS arg_modes,
      CASE
        WHEN p.prokind = 'p' THEN 'procedure'
        ELSE COALESCE(pg_catalog.pg_get_function_result(p.oid), 'void')
      END AS returns,
      l.lanname AS language,
      p.prosecdef AS security_definer,
      p.provolatile::text AS volatility
     FROM pg_catalog.pg_proc p
     INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     INNER JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE p.prokind IN ('f', 'p')
       AND ($1::text IS NULL OR n.nspname = $1::text)
       AND (
         $1::text IS NOT NULL
         OR $2::boolean
         OR (n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%')
       )
     ORDER BY n.nspname, p.proname, p.oid
     LIMIT $3`,
    [options.schema ?? null, Boolean(options.includeSystemSchemas), limit + 1],
  );

  const rows = result.rows.slice(0, limit);
  return {
    rpcs: rows.map((row) => {
      const names = row.arg_names ?? [];
      const types = row.arg_types ?? [];
      const modes = row.arg_modes ?? [];
      return {
        schema: row.schema_name,
        name: row.rpc_name,
        kind: row.kind,
        argTypes: row.input_arg_types ?? [],
        args: types.map((type, index) => ({
          name: names[index] ?? null,
          type,
          mode: mapArgMode(modes[index] ?? "i"),
        })),
        returns: row.kind === "procedure" ? "procedure" : row.returns,
        language: row.language,
        securityDefiner: row.security_definer,
        volatility: mapVolatility(row.volatility),
      };
    }),
    truncated: result.rows.length > limit,
    limit,
  };
}
