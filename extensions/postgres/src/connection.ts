import { Client, type ClientConfig, type QueryResult, type QueryResultRow } from "pg";

export interface PgConnectionOptions {
  databaseUrl: string;
  statementTimeoutMs?: number;
}

export interface PgReadContext {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export class PgConnectionError extends Error {
  constructor(
    readonly code: "db_connect_failed" | "db_permission_denied" | "db_unsupported_target" | "db_query_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PgConnectionError";
  }
}

function buildClientConfig(options: PgConnectionOptions): ClientConfig {
  return {
    connectionString: options.databaseUrl,
    statement_timeout: options.statementTimeoutMs ?? 10_000,
    application_name: "mako-ai",
  };
}

function classifyPgError(error: unknown): PgConnectionError {
  const pgError = error as { code?: string; message?: string };
  const message = pgError?.message ?? "Unknown database error.";

  if (pgError?.code === "42501") {
    return new PgConnectionError("db_permission_denied", `Permission denied: ${message}`, error);
  }

  if (pgError?.code === "28P01" || pgError?.code === "28000") {
    return new PgConnectionError("db_connect_failed", `Database authentication failed: ${message}`, error);
  }

  if (pgError?.code === "3D000") {
    return new PgConnectionError("db_unsupported_target", `Database does not exist: ${message}`, error);
  }

  return new PgConnectionError("db_query_failed", message, error);
}

export async function withReadOnlyConnection<T>(
  options: PgConnectionOptions,
  callback: (context: PgReadContext) => Promise<T>,
): Promise<T> {
  const client = new Client(buildClientConfig(options));

  try {
    try {
      await client.connect();
    } catch (error) {
      throw new PgConnectionError("db_connect_failed", `Failed to connect to database: ${(error as Error)?.message ?? "unknown"}`, error);
    }

    try {
      await client.query("BEGIN READ ONLY");
    } catch (error) {
      throw classifyPgError(error);
    }

    try {
      const context: PgReadContext = {
        async query(text, values) {
          try {
            return await client.query(text, values);
          } catch (error) {
            throw classifyPgError(error);
          }
        },
      };
      const result = await callback(context);
      await client.query("COMMIT").catch(() => undefined);
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
