import type { PgReadContext } from "./connection.js";
import type { PgResolvedTable } from "./identifiers.js";

export interface PgRlsPolicy {
  name: string;
  mode: "PERMISSIVE" | "RESTRICTIVE";
  command: string;
  roles: string[];
  usingExpression: string | null;
  withCheckExpression: string | null;
}

export interface PgRlsResult {
  rlsEnabled: boolean;
  forceRls: boolean;
  policies: PgRlsPolicy[];
}

function mapPolicyCommand(cmd: string | null): string {
  switch (cmd) {
    case "r":
      return "SELECT";
    case "a":
      return "INSERT";
    case "w":
      return "UPDATE";
    case "d":
      return "DELETE";
    case "*":
      return "ALL";
    default:
      return "ALL";
  }
}

function mapPolicyMode(permissive: boolean | null): "PERMISSIVE" | "RESTRICTIVE" {
  return permissive === false ? "RESTRICTIVE" : "PERMISSIVE";
}

function emptyRlsResult(): PgRlsResult {
  return { rlsEnabled: false, forceRls: false, policies: [] };
}

export async function fetchRlsBulk(
  context: PgReadContext,
  oids: number[],
): Promise<Map<number, PgRlsResult>> {
  const result = new Map<number, PgRlsResult>();
  if (oids.length === 0) {
    return result;
  }

  const relResult = await context.query<{
    relid: number;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `SELECT oid::int AS relid, relrowsecurity, relforcerowsecurity
     FROM pg_catalog.pg_class
     WHERE oid = ANY($1::int[])`,
    [oids],
  );

  for (const row of relResult.rows) {
    result.set(row.relid, {
      rlsEnabled: row.relrowsecurity,
      forceRls: row.relforcerowsecurity,
      policies: [],
    });
  }

  const policyResult = await context.query<{
    relid: number;
    polname: string;
    polpermissive: boolean | null;
    polcmd: string | null;
    roles: string[];
    using_expr: string | null;
    check_expr: string | null;
  }>(
    `SELECT
      pol.polrelid::int AS relid,
      pol.polname,
      pol.polpermissive,
      pol.polcmd::text AS polcmd,
      COALESCE(
        ARRAY(
          SELECT CASE
            WHEN selected.role_oid = 0 THEN 'PUBLIC'
            ELSE roles.rolname::text
          END
          FROM unnest(pol.polroles) WITH ORDINALITY AS selected(role_oid, ord)
          LEFT JOIN pg_catalog.pg_roles roles ON roles.oid = selected.role_oid
          ORDER BY selected.ord
        ),
        ARRAY[]::text[]
      ) AS roles,
      pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expr,
      pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
     FROM pg_catalog.pg_policy pol
     WHERE pol.polrelid = ANY($1::int[])
     ORDER BY pol.polrelid, pol.polname`,
    [oids],
  );

  for (const row of policyResult.rows) {
    let entry = result.get(row.relid);
    if (!entry) {
      entry = emptyRlsResult();
      result.set(row.relid, entry);
    }
    entry.policies.push({
      name: row.polname,
      mode: mapPolicyMode(row.polpermissive),
      command: mapPolicyCommand(row.polcmd),
      roles: row.roles,
      usingExpression: row.using_expr ?? null,
      withCheckExpression: row.check_expr ?? null,
    });
  }

  return result;
}

export async function fetchRls(
  context: PgReadContext,
  table: PgResolvedTable,
): Promise<PgRlsResult> {
  const map = await fetchRlsBulk(context, [table.oid]);
  return map.get(table.oid) ?? emptyRlsResult();
}
