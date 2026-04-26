import type { PgReadContext } from "./connection.js";

export type PgPlatform = "postgres" | "supabase" | "unknown";

export interface PgPingResult {
  platform: PgPlatform;
  database: string;
  serverVersion: string;
  currentUser: string;
  readOnly: boolean;
  schemas: string[];
}

const SUPABASE_MARKER_SCHEMAS = new Set(["auth", "storage", "supabase_functions"]);

export async function fetchPingInfo(context: PgReadContext): Promise<PgPingResult> {
  const baseResult = await context.query<{
    database: string;
    server_version: string;
    current_user: string;
    transaction_read_only: string;
  }>(
    `SELECT
      current_database() AS database,
      current_setting('server_version') AS server_version,
      current_user AS current_user,
      current_setting('transaction_read_only') AS transaction_read_only`,
  );

  const base = baseResult.rows[0];
  const database = base?.database ?? "";
  const serverVersion = base?.server_version ?? "";
  const currentUser = base?.current_user ?? "";
  const readOnly = (base?.transaction_read_only ?? "off").toLowerCase() === "on";

  const schemasResult = await context.query<{ nspname: string }>(
    `SELECT nspname
     FROM pg_catalog.pg_namespace
     WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
       AND nspname <> 'information_schema'
     ORDER BY nspname`,
  );

  const schemas = schemasResult.rows.map((row) => row.nspname);
  const schemaSet = new Set(schemas);

  const supabaseMarkers = [...SUPABASE_MARKER_SCHEMAS].filter((name) => schemaSet.has(name));
  const platform: PgPlatform = supabaseMarkers.length >= 2 ? "supabase" : "postgres";

  return {
    platform,
    database,
    serverVersion,
    currentUser,
    readOnly,
    schemas,
  };
}
