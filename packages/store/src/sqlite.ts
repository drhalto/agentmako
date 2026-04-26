import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_SYNCHRONOUS_MODES = {
  0: "OFF",
  1: "NORMAL",
  2: "FULL",
  3: "EXTRA",
} as const;

export interface SqliteOperationalState {
  filePath: string;
  journalMode: string;
  foreignKeys: boolean;
  busyTimeoutMs: number;
  synchronous: "OFF" | "NORMAL" | "FULL" | "EXTRA" | `UNKNOWN_${number}`;
}

export interface SqliteMigration {
  version: number;
  name: string;
  /**
   * The full SQL body for this migration. Inlined into the source rather than
   * loaded from disk at runtime — see `packages/store/src/migration-sql.ts`
   * for why (bundling hazard when the CLI is shipped as a single-file tarball).
   */
  sql: string;
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function getPragmaValue(db: DatabaseSync, pragmaName: string): string | number {
  const row = db.prepare(`PRAGMA ${pragmaName};`).get() as Record<string, string | number> | undefined;
  if (!row) {
    throw new Error(`Unable to read PRAGMA ${pragmaName}.`);
  }

  const value = Object.values(row)[0];
  if (value == null) {
    throw new Error(`PRAGMA ${pragmaName} returned no value.`);
  }

  return value;
}

function configureDatabase(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS};`);
  db.exec("PRAGMA synchronous = NORMAL;");
}

export function inspectSqliteOperationalState(db: DatabaseSync, filePath: string): SqliteOperationalState {
  const journalMode = String(getPragmaValue(db, "journal_mode")).toUpperCase();
  const foreignKeys = Number(getPragmaValue(db, "foreign_keys")) === 1;
  const busyTimeoutMs = Number(getPragmaValue(db, "busy_timeout"));
  const synchronousValue = Number(getPragmaValue(db, "synchronous"));
  const synchronous =
    SQLITE_SYNCHRONOUS_MODES[synchronousValue as keyof typeof SQLITE_SYNCHRONOUS_MODES] ??
    (`UNKNOWN_${synchronousValue}` as const);

  return {
    filePath,
    journalMode,
    foreignKeys,
    busyTimeoutMs,
    synchronous,
  };
}

function ensureMigrationsTable(db: DatabaseSync): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "version INTEGER PRIMARY KEY," +
      "name TEXT NOT NULL," +
      "applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP" +
      ");",
  );
}

function getAppliedMigrationVersions(db: DatabaseSync): Set<number> {
  const rows = db
    .prepare("SELECT version FROM schema_migrations")
    .all() as Array<{ version: number }>;
  return new Set(rows.map((row) => row.version));
}

function applyMigrations(db: DatabaseSync, migrations: SqliteMigration[]): void {
  ensureMigrationsTable(db);
  const applied = getAppliedMigrationVersions(db);
  const pending = [...migrations]
    .sort((left, right) => left.version - right.version)
    .filter((migration) => !applied.has(migration.version));

  for (const migration of pending) {
    const sql = migration.sql;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations(version, name) VALUES(?, ?)").run(
        migration.version,
        migration.name,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(
        `Failed to apply migration ${migration.version} (${migration.name}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export function openSqliteDatabase(filePath: string, migrations: SqliteMigration[]): DatabaseSync {
  ensureParentDirectory(filePath);

  const db = new DatabaseSync(filePath);
  configureDatabase(db);
  try {
    applyMigrations(db, migrations);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
