import { DatabaseSync, type StatementSync } from "node:sqlite";
import { resolveProjectDbPath } from "@mako-ai/config";
import type { ProjectProfile } from "@mako-ai/contracts";
import { hashJson } from "./hash.js";
import { parseJson, stringifyJson } from "./json.js";
import {
  PROJECT_MIGRATION_0001_INIT_SQL,
  PROJECT_MIGRATION_0002_SCHEMA_SNAPSHOT_SQL,
  PROJECT_MIGRATION_0003_DB_BINDING_STATE_SQL,
  PROJECT_MIGRATION_0004_SCHEMA_SNAPSHOT_READ_MODEL_SQL,
  PROJECT_MIGRATION_0005_SCHEMA_SNAPSHOT_SOURCE_KIND_SQL,
  PROJECT_MIGRATION_0006_ACTION_LOGGING_SQL,
  PROJECT_MIGRATION_0007_BENCHMARK_STORAGE_SQL,
  PROJECT_MIGRATION_0008_HARNESS_SQL,
  PROJECT_MIGRATION_0009_HARNESS_DELETE_GUARDS_SQL,
  PROJECT_MIGRATION_0010_HARNESS_MEMORIES_SQL,
  PROJECT_MIGRATION_0011_HARNESS_EMBEDDINGS_SQL,
  PROJECT_MIGRATION_0012_HARNESS_MESSAGES_ARCHIVED_SQL,
  PROJECT_MIGRATION_0013_SCHEMA_SNAPSHOT_BODIES_SQL,
  PROJECT_MIGRATION_0014_CHUNK_SEARCH_TEXT_SQL,
  PROJECT_MIGRATION_0015_SCHEMA_FUNCTION_REFS_SIGNATURE_SQL,
  PROJECT_MIGRATION_0016_HARNESS_SEMANTIC_UNITS_SQL,
  PROJECT_MIGRATION_0017_PROVIDER_CALLS_USAGE_SQL,
  PROJECT_MIGRATION_0018_ANSWER_TRUST_BACKBONE_SQL,
  PROJECT_MIGRATION_0019_ANSWER_TRUST_HARDENING_SQL,
  PROJECT_MIGRATION_0020_ANSWER_TRUST_INDEX_CLEANUP_SQL,
  PROJECT_MIGRATION_0021_ANSWER_COMPARISONS_SQL,
  PROJECT_MIGRATION_0022_ANSWER_TRUST_STATE_SQL,
  PROJECT_MIGRATION_0023_ANSWER_TRUST_EVALUATION_METADATA_SQL,
  PROJECT_MIGRATION_0024_WORKFLOW_FOLLOWUPS_SQL,
  PROJECT_MIGRATION_0025_RUNTIME_TELEMETRY_SQL,
  PROJECT_MIGRATION_0026_FINDING_ACKS_SQL,
  PROJECT_MIGRATION_0027_RUNTIME_TELEMETRY_FINDING_ACK_KIND_SQL,
  PROJECT_MIGRATION_0028_ANSWER_TRACE_RECALL_FTS_SQL,
  PROJECT_MIGRATION_0029_RUNTIME_TELEMETRY_AGENT_FEEDBACK_KIND_SQL,
  PROJECT_MIGRATION_0030_REEF_FOUNDATION_SQL,
  PROJECT_MIGRATION_0031_REEF_DIAGNOSTIC_RUNS_SQL,
  PROJECT_MIGRATION_0033_REEF_REVISION_STATE_SQL,
  PROJECT_MIGRATION_0034_REEF_ARTIFACTS_SQL,
  PROJECT_MIGRATION_0035_REEF_REVISION_UNIQUENESS_SQL,
  PROJECT_MIGRATION_0036_REEF_ARTIFACT_TAG_REVISIONS_SQL,
  PROJECT_MIGRATION_0037_DB_REVIEW_COMMENTS_SQL,
} from "./migration-sql.js";
import {
  backfillChunkSearchTextImpl,
} from "./project-store-index.js";
import { backfillSchemaSnapshotFunctionRefsImpl } from "./project-store-snapshots.js";
import { backfillAnswerTrustRunsImpl } from "./project-store-trust.js";
import {
  inspectSqliteOperationalState,
  openSqliteDatabase,
  type SqliteMigration,
  type SqliteOperationalState,
} from "./sqlite.js";
import type { ProjectProfileRecord } from "./types.js";
import {
  projectStoreBenchmarkMethods,
  type ProjectStoreBenchmarkMethods,
} from "./project-store-methods-benchmarks.js";
import {
  projectStoreHarnessMethods,
  type ProjectStoreHarnessMethods,
} from "./project-store-methods-harness.js";
import {
  projectStoreIndexMethods,
  type ProjectStoreIndexMethods,
} from "./project-store-methods-index.js";
import {
  projectStoreQueryMethods,
  type ProjectStoreQueryMethods,
} from "./project-store-methods-query.js";
import {
  projectStoreRecallMethods,
  type ProjectStoreRecallMethods,
} from "./project-store-methods-recall.js";
import {
  projectStoreTrustMethods,
  type ProjectStoreTrustMethods,
} from "./project-store-methods-trust.js";
import {
  projectStoreReefMethods,
  type ProjectStoreReefMethods,
} from "./project-store-methods-reef.js";

const PROJECT_MIGRATIONS: SqliteMigration[] = [
  { version: 1, name: "0001_project_init", sql: PROJECT_MIGRATION_0001_INIT_SQL },
  { version: 2, name: "0002_project_schema_snapshot", sql: PROJECT_MIGRATION_0002_SCHEMA_SNAPSHOT_SQL },
  { version: 3, name: "0003_project_db_binding_state", sql: PROJECT_MIGRATION_0003_DB_BINDING_STATE_SQL },
  { version: 4, name: "0004_project_schema_snapshot_read_model", sql: PROJECT_MIGRATION_0004_SCHEMA_SNAPSHOT_READ_MODEL_SQL },
  { version: 5, name: "0005_project_schema_snapshot_source_kind", sql: PROJECT_MIGRATION_0005_SCHEMA_SNAPSHOT_SOURCE_KIND_SQL },
  { version: 6, name: "0006_project_action_logging", sql: PROJECT_MIGRATION_0006_ACTION_LOGGING_SQL },
  { version: 7, name: "0007_project_benchmark_storage", sql: PROJECT_MIGRATION_0007_BENCHMARK_STORAGE_SQL },
  { version: 8, name: "0008_project_harness", sql: PROJECT_MIGRATION_0008_HARNESS_SQL },
  { version: 9, name: "0009_project_harness_delete_guards", sql: PROJECT_MIGRATION_0009_HARNESS_DELETE_GUARDS_SQL },
  { version: 10, name: "0010_project_harness_memories", sql: PROJECT_MIGRATION_0010_HARNESS_MEMORIES_SQL },
  { version: 11, name: "0011_project_harness_embeddings", sql: PROJECT_MIGRATION_0011_HARNESS_EMBEDDINGS_SQL },
  { version: 12, name: "0012_project_harness_messages_archived", sql: PROJECT_MIGRATION_0012_HARNESS_MESSAGES_ARCHIVED_SQL },
  { version: 13, name: "0013_project_schema_snapshot_bodies", sql: PROJECT_MIGRATION_0013_SCHEMA_SNAPSHOT_BODIES_SQL },
  { version: 14, name: "0014_project_chunk_search_text", sql: PROJECT_MIGRATION_0014_CHUNK_SEARCH_TEXT_SQL },
  { version: 15, name: "0015_project_schema_function_refs_signature", sql: PROJECT_MIGRATION_0015_SCHEMA_FUNCTION_REFS_SIGNATURE_SQL },
  { version: 16, name: "0016_project_harness_semantic_units", sql: PROJECT_MIGRATION_0016_HARNESS_SEMANTIC_UNITS_SQL },
  { version: 17, name: "0017_project_provider_calls_usage", sql: PROJECT_MIGRATION_0017_PROVIDER_CALLS_USAGE_SQL },
  { version: 18, name: "0018_project_answer_trust_backbone", sql: PROJECT_MIGRATION_0018_ANSWER_TRUST_BACKBONE_SQL },
  { version: 19, name: "0019_project_answer_trust_hardening", sql: PROJECT_MIGRATION_0019_ANSWER_TRUST_HARDENING_SQL },
  { version: 20, name: "0020_project_answer_trust_index_cleanup", sql: PROJECT_MIGRATION_0020_ANSWER_TRUST_INDEX_CLEANUP_SQL },
  { version: 21, name: "0021_project_answer_comparisons", sql: PROJECT_MIGRATION_0021_ANSWER_COMPARISONS_SQL },
  { version: 22, name: "0022_project_answer_trust_state", sql: PROJECT_MIGRATION_0022_ANSWER_TRUST_STATE_SQL },
  { version: 23, name: "0023_project_answer_trust_evaluation_metadata", sql: PROJECT_MIGRATION_0023_ANSWER_TRUST_EVALUATION_METADATA_SQL },
  { version: 24, name: "0024_project_workflow_followups", sql: PROJECT_MIGRATION_0024_WORKFLOW_FOLLOWUPS_SQL },
  { version: 25, name: "0025_project_runtime_telemetry", sql: PROJECT_MIGRATION_0025_RUNTIME_TELEMETRY_SQL },
  { version: 26, name: "0026_project_finding_acks", sql: PROJECT_MIGRATION_0026_FINDING_ACKS_SQL },
  {
    version: 27,
    name: "0027_project_runtime_telemetry_finding_ack_kind",
    sql: PROJECT_MIGRATION_0027_RUNTIME_TELEMETRY_FINDING_ACK_KIND_SQL,
  },
  {
    version: 28,
    name: "0028_project_answer_trace_recall_fts",
    sql: PROJECT_MIGRATION_0028_ANSWER_TRACE_RECALL_FTS_SQL,
  },
  {
    version: 29,
    name: "0029_project_runtime_telemetry_agent_feedback_kind",
    sql: PROJECT_MIGRATION_0029_RUNTIME_TELEMETRY_AGENT_FEEDBACK_KIND_SQL,
  },
  {
    version: 30,
    name: "0030_project_reef_foundation",
    sql: PROJECT_MIGRATION_0030_REEF_FOUNDATION_SQL,
  },
  {
    version: 31,
    name: "0031_project_reef_diagnostic_runs",
    sql: PROJECT_MIGRATION_0031_REEF_DIAGNOSTIC_RUNS_SQL,
  },
  {
    version: 33,
    name: "0033_project_reef_revision_state",
    sql: PROJECT_MIGRATION_0033_REEF_REVISION_STATE_SQL,
  },
  {
    version: 34,
    name: "0034_project_reef_artifacts",
    sql: PROJECT_MIGRATION_0034_REEF_ARTIFACTS_SQL,
  },
  {
    version: 35,
    name: "0035_project_reef_revision_uniqueness",
    sql: PROJECT_MIGRATION_0035_REEF_REVISION_UNIQUENESS_SQL,
  },
  {
    version: 36,
    name: "0036_project_reef_artifact_tag_revisions",
    sql: PROJECT_MIGRATION_0036_REEF_ARTIFACT_TAG_REVISIONS_SQL,
  },
  {
    version: 37,
    name: "0037_project_db_review_comments",
    sql: PROJECT_MIGRATION_0037_DB_REVIEW_COMMENTS_SQL,
  },
];

interface ProjectProfileRow {
  profile_hash: string;
  support_level: ProjectProfile["supportLevel"];
  profile_json: string;
  detected_at: string;
}

export interface ProjectStoreOptions {
  projectRoot: string;
  stateDirName?: string;
  projectDbFilename?: string;
}

export class ProjectStore {
  readonly db: DatabaseSync;
  readonly dbPath: string;
  readonly projectRoot: string;
  private readonly preparedStatements = new Map<string, StatementSync>();

  constructor(options: ProjectStoreOptions) {
    this.projectRoot = options.projectRoot;
    this.dbPath = resolveProjectDbPath(
      options.projectRoot,
      options.stateDirName,
      options.projectDbFilename,
    );
    this.db = openSqliteDatabase(this.dbPath, PROJECT_MIGRATIONS);
    backfillChunkSearchTextImpl(this.db);
    backfillSchemaSnapshotFunctionRefsImpl(this.db);
    backfillAnswerTrustRunsImpl(this.db, this.projectRoot);
  }

  /**
   * Run a WAL checkpoint. Call this explicitly at server shutdown or
   * when you know you want the WAL flushed — close() no longer does it
   * implicitly, because forcing TRUNCATE on every close is the
   * dominant source of per-tool-call latency on larger project DBs
   * (Initial Testing roadmap Phase 2).
   *
   * - `truncate: false` (default) runs a PASSIVE checkpoint. Does not
   *   block readers, does not shrink the WAL file, fsyncs durable
   *   pages into the main DB.
   * - `truncate: true` runs a TRUNCATE checkpoint. Fsyncs the WAL and
   *   resets the WAL file to empty. Appropriate at clean process exit
   *   (MCP stdio server SIGINT / SIGTERM handler, CLI command exit).
   *
   * Best-effort: failures are swallowed so checkpoint calls never
   * prevent shutdown.
   */
  checkpoint(options: { truncate?: boolean } = {}): void {
    const mode = options.truncate === true ? "TRUNCATE" : "PASSIVE";
    try {
      this.db.exec(`PRAGMA wal_checkpoint(${mode})`);
    } catch {
      // Best-effort — a checkpoint failure must not prevent the caller
      // from proceeding.
    }
  }

  close(): void {
    // Phase 5 CC: cached StatementSync objects are bound to this
    // DatabaseSync handle. node:sqlite owns finalization on db.close();
    // clearing first prevents accidental reuse after close in tests and
    // documents the lifecycle boundary for borrowed stores.
    this.preparedStatements.clear();
    // Note: no WAL checkpoint here. SQLite's auto-checkpoint (1000-page
    // default) keeps the WAL bounded during normal operation; callers
    // that want a full flush call `checkpoint({ truncate: true })`
    // explicitly. See Phase 2 phase doc.
    this.db.close();
  }

  /**
   * Return a cached prepared statement for a static SQL string.
   *
   * Prepared statements are cached per ProjectStore instance because
   * StatementSync is handle-bound. Keep callers on static SQL literals;
   * interpolating runtime constants into SQL would grow this unbounded map
   * and should be treated as a bug.
   */
  prepared(sql: string): StatementSync {
    const cached = this.preparedStatements.get(sql);
    if (cached) {
      return cached;
    }
    const statement = this.db.prepare(sql);
    this.preparedStatements.set(sql, statement);
    return statement;
  }

  getOperationalState(): SqliteOperationalState {
    return inspectSqliteOperationalState(this.db, this.dbPath);
  }

  loadProjectProfile(): ProjectProfileRecord | null {
    const row = this.db
      .prepare(`
        SELECT profile_hash, support_level, profile_json, detected_at
        FROM project_profile
        WHERE profile_slot = 1
      `)
      .get() as ProjectProfileRow | undefined;

    if (!row) {
      return null;
    }

    return {
      profileHash: row.profile_hash,
      supportLevel: row.support_level,
      profile: parseJson<ProjectProfile>(row.profile_json, {} as ProjectProfile),
      detectedAt: row.detected_at,
    };
  }

  saveProjectProfile(profile: ProjectProfile): ProjectProfileRecord {
    const profileHash = hashJson(profile);
    this.db
      .prepare(`
        INSERT INTO project_profile(profile_slot, profile_hash, support_level, profile_json, detected_at)
        VALUES(1, ?, ?, ?, ?)
        ON CONFLICT(profile_slot) DO UPDATE SET
          profile_hash = excluded.profile_hash,
          support_level = excluded.support_level,
          profile_json = excluded.profile_json,
          detected_at = excluded.detected_at
      `)
      .run(profileHash, profile.supportLevel, stringifyJson(profile), profile.detectedAt);

    return {
      profile,
      profileHash,
      supportLevel: profile.supportLevel,
      detectedAt: profile.detectedAt,
    };
  }
}

export interface ProjectStore
  extends ProjectStoreIndexMethods,
    ProjectStoreBenchmarkMethods,
    ProjectStoreQueryMethods,
    ProjectStoreRecallMethods,
    ProjectStoreTrustMethods,
    ProjectStoreHarnessMethods,
    ProjectStoreReefMethods {}

Object.assign(
  ProjectStore.prototype,
  projectStoreIndexMethods,
  projectStoreBenchmarkMethods,
  projectStoreQueryMethods,
  projectStoreRecallMethods,
  projectStoreTrustMethods,
  projectStoreHarnessMethods,
  projectStoreReefMethods,
);

export function openProjectStore(options: ProjectStoreOptions): ProjectStore {
  return new ProjectStore(options);
}
