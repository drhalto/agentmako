import { DatabaseSync } from "node:sqlite";
import { resolveGlobalDbPath } from "@mako-ai/config";
import type { AttachedProject } from "@mako-ai/contracts";
import {
  GLOBAL_MIGRATION_0001_INIT_SQL,
  GLOBAL_MIGRATION_0002_TOOL_USAGE_STATS_SQL,
} from "./migration-sql.js";
import {
  inspectSqliteOperationalState,
  openSqliteDatabase,
  type SqliteMigration,
  type SqliteOperationalState,
} from "./sqlite.js";
import type { ProjectRegistrationInput, ToolUsageStatRecord } from "./types.js";

const GLOBAL_MIGRATIONS: SqliteMigration[] = [
  {
    version: 1,
    name: "0001_global_init",
    sql: GLOBAL_MIGRATION_0001_INIT_SQL,
  },
  {
    version: 2,
    name: "0002_global_tool_usage_stats",
    sql: GLOBAL_MIGRATION_0002_TOOL_USAGE_STATS_SQL,
  },
];

interface GlobalProjectRow {
  project_id: string;
  display_name: string;
  canonical_path: string;
  last_seen_path: string;
  status: AttachedProject["status"];
  support_target: string;
  profile_hash: string | null;
  attached_at: string;
  last_indexed_at: string | null;
}

interface GlobalProjectAliasRow extends GlobalProjectRow {
  alias_path: string | null;
}

interface ToolUsageStatRow {
  tool_name: string;
  call_count: number;
  last_called_at: string;
  last_project_id: string | null;
}

function mapProjectRow(row: GlobalProjectRow | undefined): AttachedProject | null {
  if (!row) {
    return null;
  }

  return {
    projectId: row.project_id,
    displayName: row.display_name,
    canonicalPath: row.canonical_path,
    lastSeenPath: row.last_seen_path,
    status: row.status,
    supportTarget: row.support_target,
    profileHash: row.profile_hash ?? undefined,
    attachedAt: row.attached_at,
    lastIndexedAt: row.last_indexed_at ?? undefined,
  };
}

function mapToolUsageStatRow(row: ToolUsageStatRow | undefined): ToolUsageStatRecord | null {
  if (!row) {
    return null;
  }

  return {
    toolName: row.tool_name,
    callCount: row.call_count,
    lastCalledAt: row.last_called_at,
    lastProjectId: row.last_project_id ?? undefined,
  };
}

export interface GlobalStoreOptions {
  homeDir?: string;
  stateDirName?: string;
  globalDbFilename?: string;
}

export interface GlobalProjectLookupOptions {
  includeDetached?: boolean;
}

export interface ProjectLocationMatch {
  project: AttachedProject;
  matchLength: number;
}

function createStatusClause(includeDetached: boolean): string {
  return includeDetached ? "" : "WHERE p.status = 'active'";
}

function createSingleStatusClause(includeDetached: boolean): string {
  return includeDetached ? "" : "AND status = 'active'";
}

function collectProjectRoots(row: GlobalProjectAliasRow): string[] {
  return [row.canonical_path, row.last_seen_path, row.alias_path ?? undefined].filter(
    (value): value is string => value != null,
  );
}

function matchProjectLocation(row: GlobalProjectAliasRow, projectPath: string): number {
  let longestMatch = -1;

  for (const candidateRoot of collectProjectRoots(row)) {
    if (projectPath === candidateRoot || projectPath.startsWith(`${candidateRoot}/`)) {
      longestMatch = Math.max(longestMatch, candidateRoot.length);
    }
  }

  return longestMatch;
}

export class GlobalStore {
  readonly db: DatabaseSync;
  readonly dbPath: string;

  constructor(options: GlobalStoreOptions = {}) {
    this.dbPath = resolveGlobalDbPath(options.homeDir, options.stateDirName, options.globalDbFilename);
    this.db = openSqliteDatabase(this.dbPath, GLOBAL_MIGRATIONS);
  }

  close(): void {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Best-effort — checkpoint failure must not prevent close.
    }
    this.db.close();
  }

  getOperationalState(): SqliteOperationalState {
    return inspectSqliteOperationalState(this.db, this.dbPath);
  }

  private selectProjectAliasRows(includeDetached: boolean): GlobalProjectAliasRow[] {
    const rows = this.db
      .prepare(`
        SELECT
          p.project_id,
          p.display_name,
          p.canonical_path,
          p.last_seen_path,
          p.status,
          p.support_target,
          p.profile_hash,
          p.attached_at,
          p.last_indexed_at,
          a.alias_path
        FROM projects p
        LEFT JOIN project_aliases a ON a.project_id = p.project_id
        ${createStatusClause(includeDetached)}
        ORDER BY p.updated_at DESC, p.attached_at DESC
      `)
      .all() as unknown as GlobalProjectAliasRow[];

    return rows;
  }

  listProjects(): AttachedProject[] {
    const rows = this.selectProjectAliasRows(false);

    const deduped = new Map<string, AttachedProject>();
    for (const row of rows) {
      if (!deduped.has(row.project_id)) {
        const project = mapProjectRow(row);
        if (project) {
          deduped.set(row.project_id, project);
        }
      }
    }

    return [...deduped.values()];
  }

  getProjectById(projectId: string, options: GlobalProjectLookupOptions = {}): AttachedProject | null {
    const includeDetached = options.includeDetached ?? false;
    const row = this.db
      .prepare(`
        SELECT
          project_id,
          display_name,
          canonical_path,
          last_seen_path,
          status,
          support_target,
          profile_hash,
          attached_at,
          last_indexed_at
        FROM projects
        WHERE project_id = ?
          ${createSingleStatusClause(includeDetached)}
      `)
      .get(projectId) as unknown as GlobalProjectRow | undefined;

    return mapProjectRow(row);
  }

  getProjectByPath(projectPath: string, options: GlobalProjectLookupOptions = {}): AttachedProject | null {
    const includeDetached = options.includeDetached ?? false;
    const row = this.db
      .prepare(`
        SELECT DISTINCT
          p.project_id,
          p.display_name,
          p.canonical_path,
          p.last_seen_path,
          p.status,
          p.support_target,
          p.profile_hash,
          p.attached_at,
          p.last_indexed_at
        FROM projects p
        LEFT JOIN project_aliases a ON a.project_id = p.project_id
        WHERE (
          p.canonical_path = ?
          OR p.last_seen_path = ?
          OR a.alias_path = ?
        )
          ${includeDetached ? "" : "AND p.status = 'active'"}
        LIMIT 1
      `)
      .get(projectPath, projectPath, projectPath) as unknown as GlobalProjectRow | undefined;

    return mapProjectRow(row);
  }

  findProjectMatchesByLocation(
    projectPath: string,
    options: GlobalProjectLookupOptions = {},
  ): ProjectLocationMatch[] {
    const includeDetached = options.includeDetached ?? false;
    const rows = this.selectProjectAliasRows(includeDetached);
    const matches = new Map<string, ProjectLocationMatch>();

    for (const row of rows) {
      const matchLength = matchProjectLocation(row, projectPath);
      if (matchLength < 0) {
        continue;
      }

      const project = mapProjectRow(row);
      if (!project) {
        continue;
      }

      const existing = matches.get(project.projectId);
      if (!existing || existing.matchLength < matchLength) {
        matches.set(project.projectId, { project, matchLength });
      }
    }

    return [...matches.values()].sort((left, right) => right.matchLength - left.matchLength);
  }

  findBestProjectByLocation(
    projectPath: string,
    options: GlobalProjectLookupOptions = {},
  ): AttachedProject | null {
    const matches = this.findProjectMatchesByLocation(projectPath, options);
    if (matches.length === 0) {
      return null;
    }

    if (matches.length > 1 && matches[0]?.matchLength === matches[1]?.matchLength) {
      return null;
    }

    return matches[0]?.project ?? null;
  }

  saveProject(input: ProjectRegistrationInput): AttachedProject {
    const existing =
      this.getProjectById(input.projectId, { includeDetached: true }) ??
      this.getProjectByPath(input.canonicalPath, { includeDetached: true });

    if (existing) {
      this.db
        .prepare(`
          UPDATE projects
          SET
            display_name = ?,
            canonical_path = ?,
            last_seen_path = ?,
            status = ?,
            support_target = ?,
            profile_hash = ?
          WHERE project_id = ?
        `)
        .run(
          input.displayName,
          input.canonicalPath,
          input.lastSeenPath,
          input.status ?? existing.status,
          input.supportTarget,
          input.profileHash ?? null,
          existing.projectId,
        );

      this.db
        .prepare(`
          INSERT INTO project_aliases(alias_path, project_id, observed_at)
          VALUES(?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(alias_path) DO UPDATE SET
            project_id = excluded.project_id,
            observed_at = excluded.observed_at
        `)
        .run(input.lastSeenPath, existing.projectId);

      return this.getProjectById(existing.projectId) as AttachedProject;
    }

    this.db
      .prepare(`
        INSERT INTO projects(
          project_id,
          display_name,
          canonical_path,
          last_seen_path,
          status,
          support_target,
          profile_hash
        )
        VALUES(?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.projectId,
        input.displayName,
        input.canonicalPath,
        input.lastSeenPath,
        input.status ?? "active",
        input.supportTarget,
        input.profileHash ?? null,
      );

    this.db
      .prepare(`
        INSERT INTO project_aliases(alias_path, project_id)
        VALUES(?, ?)
        ON CONFLICT(alias_path) DO UPDATE SET
          project_id = excluded.project_id,
          observed_at = CURRENT_TIMESTAMP
      `)
        .run(input.lastSeenPath, input.projectId);

    return this.getProjectById(input.projectId) as AttachedProject;
  }

  detachProject(projectId: string): AttachedProject | null {
    const existing = this.getProjectById(projectId, { includeDetached: true });
    if (!existing) {
      return null;
    }

    this.db
      .prepare(`
        UPDATE projects
        SET status = 'detached'
        WHERE project_id = ?
      `)
      .run(projectId);

    return this.getProjectById(projectId, { includeDetached: true });
  }

  removeProject(projectId: string): void {
    this.db
      .prepare(`
        DELETE FROM projects
        WHERE project_id = ?
      `)
      .run(projectId);
  }

  markProjectIndexed(projectId: string, indexedAt: string = new Date().toISOString()): void {
    this.db
      .prepare(`
        UPDATE projects
        SET
          status = 'active',
          last_indexed_at = ?
        WHERE project_id = ?
      `)
      .run(indexedAt, projectId);
  }

  upsertToolUsageStat(toolName: string, projectId?: string): ToolUsageStatRecord {
    const lastCalledAt = new Date().toISOString();

    this.db
      .prepare(`
        INSERT INTO tool_usage_stats(tool_name, call_count, last_called_at, last_project_id)
        VALUES(?, 1, ?, ?)
        ON CONFLICT(tool_name) DO UPDATE SET
          call_count = tool_usage_stats.call_count + 1,
          last_called_at = excluded.last_called_at,
          last_project_id = excluded.last_project_id
      `)
      .run(toolName, lastCalledAt, projectId ?? null);

    return this.getToolUsageStat(toolName) as ToolUsageStatRecord;
  }

  getToolUsageStats(): ToolUsageStatRecord[] {
    const rows = this.db
      .prepare(`
        SELECT tool_name, call_count, last_called_at, last_project_id
        FROM tool_usage_stats
        ORDER BY call_count DESC, last_called_at DESC, tool_name ASC
      `)
      .all() as unknown as ToolUsageStatRow[];

    return rows
      .map((row) => mapToolUsageStatRow(row))
      .filter((row): row is ToolUsageStatRecord => row !== null);
  }

  getToolUsageStat(toolName: string): ToolUsageStatRecord | null {
    const row = this.db
      .prepare(`
        SELECT tool_name, call_count, last_called_at, last_project_id
        FROM tool_usage_stats
        WHERE tool_name = ?
      `)
      .get(toolName) as ToolUsageStatRow | undefined;

    return mapToolUsageStatRow(row);
  }
}

export function openGlobalStore(options: GlobalStoreOptions = {}): GlobalStore {
  return new GlobalStore(options);
}
