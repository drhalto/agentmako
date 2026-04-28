/**
 * Inline migration SQL for the global and project SQLite stores.
 *
 * These constants are the canonical source of truth for mako-ai's database
 * migrations. They used to live as standalone `.sql` files under
 * `storage/migrations/` and were loaded at runtime via `readFileSync` with a
 * path relative to the source file's `import.meta.url`. That worked in the
 * source tree and under `tsc` output, but broke as soon as the CLI was bundled
 * with tsup — the bundled `apps/cli/dist/index.js` carried a relative path
 * that pointed at a directory that didn't exist in the published tarball.
 *
 * Inlining the SQL as template literals sidesteps the file-resolution problem
 * entirely: the content travels with the bundle no matter how it's packaged.
 * When you need to change a migration, edit the constant here directly — do
 * not re-introduce the `.sql` files, as that would split the source of truth
 * and re-open the bundling hazard.
 */

export const GLOBAL_MIGRATION_0001_INIT_SQL = `CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES
  ('schema_name', 'global'),
  ('schema_version', '1');

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS providers (
  provider_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credentials (
  credential_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(provider_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  scope TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  canonical_path TEXT NOT NULL UNIQUE,
  last_seen_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'detached', 'archived')),
  support_target TEXT NOT NULL,
  profile_hash TEXT,
  attached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_indexed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_aliases (
  alias_path TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_last_seen_path ON projects(last_seen_path);
CREATE INDEX IF NOT EXISTS idx_credentials_provider_id ON credentials(provider_id);
CREATE INDEX IF NOT EXISTS idx_project_aliases_project_id ON project_aliases(project_id);

CREATE TRIGGER IF NOT EXISTS settings_touch_updated_at
AFTER UPDATE ON settings
FOR EACH ROW
BEGIN
  UPDATE settings
  SET updated_at = CURRENT_TIMESTAMP
  WHERE key = OLD.key;
END;

CREATE TRIGGER IF NOT EXISTS providers_touch_updated_at
AFTER UPDATE ON providers
FOR EACH ROW
BEGIN
  UPDATE providers
  SET updated_at = CURRENT_TIMESTAMP
  WHERE provider_id = OLD.provider_id;
END;

CREATE TRIGGER IF NOT EXISTS credentials_touch_updated_at
AFTER UPDATE ON credentials
FOR EACH ROW
BEGIN
  UPDATE credentials
  SET updated_at = CURRENT_TIMESTAMP
  WHERE credential_id = OLD.credential_id;
END;

CREATE TRIGGER IF NOT EXISTS projects_touch_updated_at
AFTER UPDATE ON projects
FOR EACH ROW
BEGIN
  UPDATE projects
  SET updated_at = CURRENT_TIMESTAMP
  WHERE project_id = OLD.project_id;
END;
`;

export const GLOBAL_MIGRATION_0002_TOOL_USAGE_STATS_SQL = `CREATE TABLE IF NOT EXISTS tool_usage_stats (
  tool_name TEXT PRIMARY KEY,
  call_count INTEGER NOT NULL DEFAULT 0,
  last_called_at TEXT NOT NULL,
  last_project_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_usage_stats_last_called_at
  ON tool_usage_stats(last_called_at DESC);
`;

export const PROJECT_MIGRATION_0001_INIT_SQL = `CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES
  ('schema_name', 'project'),
  ('schema_version', '1');

CREATE TABLE IF NOT EXISTS project_profile (
  profile_slot INTEGER PRIMARY KEY CHECK (profile_slot = 1),
  profile_hash TEXT NOT NULL,
  support_level TEXT NOT NULL
    CHECK (support_level IN ('native', 'adapted', 'best_effort')),
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS index_runs (
  run_id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stats_json TEXT CHECK (stats_json IS NULL OR json_valid(stats_json)),
  error_text TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
  file_id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  sha256 TEXT,
  language TEXT,
  size_bytes INTEGER,
  line_count INTEGER,
  is_generated INTEGER NOT NULL DEFAULT 0 CHECK (is_generated IN (0, 1)),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  last_modified_at TEXT,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  chunk_kind TEXT NOT NULL,
  name TEXT,
  line_start INTEGER,
  line_end INTEGER,
  content TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  path,
  name,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai
AFTER INSERT ON chunks
FOR EACH ROW
BEGIN
  INSERT INTO chunks_fts(rowid, content, path, name)
  VALUES (
    NEW.chunk_id,
    NEW.content,
    (SELECT path FROM files WHERE file_id = NEW.file_id),
    COALESCE(NEW.name, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad
AFTER DELETE ON chunks
FOR EACH ROW
BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, path, name)
  VALUES (
    'delete',
    OLD.chunk_id,
    OLD.content,
    (SELECT path FROM files WHERE file_id = OLD.file_id),
    COALESCE(OLD.name, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS chunks_au
AFTER UPDATE ON chunks
FOR EACH ROW
BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content, path, name)
  VALUES (
    'delete',
    OLD.chunk_id,
    OLD.content,
    (SELECT path FROM files WHERE file_id = OLD.file_id),
    COALESCE(OLD.name, '')
  );

  INSERT INTO chunks_fts(rowid, content, path, name)
  VALUES (
    NEW.chunk_id,
    NEW.content,
    (SELECT path FROM files WHERE file_id = NEW.file_id),
    COALESCE(NEW.name, '')
  );
END;

CREATE TABLE IF NOT EXISTS symbols (
  symbol_id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  export_name TEXT,
  line_start INTEGER,
  line_end INTEGER,
  signature_text TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  UNIQUE (file_id, name, kind, line_start)
);

CREATE TABLE IF NOT EXISTS import_edges (
  edge_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file_id INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  target_file_id INTEGER REFERENCES files(file_id) ON DELETE SET NULL,
  target_path TEXT NOT NULL,
  specifier TEXT NOT NULL,
  import_kind TEXT NOT NULL,
  is_type_only INTEGER NOT NULL DEFAULT 0 CHECK (is_type_only IN (0, 1)),
  line INTEGER
);

CREATE TABLE IF NOT EXISTS routes (
  route_id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_key TEXT NOT NULL UNIQUE,
  framework TEXT NOT NULL,
  file_id INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  method TEXT,
  handler_name TEXT,
  is_api INTEGER NOT NULL DEFAULT 0 CHECK (is_api IN (0, 1)),
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json))
);

CREATE TABLE IF NOT EXISTS schema_objects (
  object_id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_type TEXT NOT NULL
    CHECK (object_type IN ('schema', 'table', 'view', 'column', 'rpc', 'policy', 'trigger', 'enum')),
  schema_name TEXT NOT NULL DEFAULT 'public',
  object_name TEXT NOT NULL,
  parent_object_name TEXT,
  data_type TEXT,
  definition_json TEXT CHECK (definition_json IS NULL OR json_valid(definition_json))
);

CREATE TABLE IF NOT EXISTS schema_usages (
  usage_id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_object_id INTEGER NOT NULL REFERENCES schema_objects(object_id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
  symbol_id INTEGER REFERENCES symbols(symbol_id) ON DELETE SET NULL,
  usage_kind TEXT NOT NULL,
  line INTEGER,
  excerpt TEXT
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  node_key TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  label TEXT NOT NULL,
  file_path TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json))
);

CREATE TABLE IF NOT EXISTS graph_edges (
  source_key TEXT NOT NULL REFERENCES graph_nodes(node_key) ON DELETE CASCADE,
  target_key TEXT NOT NULL REFERENCES graph_nodes(node_key) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  PRIMARY KEY (source_key, target_key, relation)
);

CREATE TABLE IF NOT EXISTS findings (
  finding_id TEXT PRIMARY KEY,
  detector TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'ignored', 'fixed')),
  title TEXT NOT NULL,
  summary TEXT,
  primary_file_path TEXT,
  primary_symbol TEXT,
  evidence_json TEXT CHECK (evidence_json IS NULL OR json_valid(evidence_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS answer_traces (
  trace_id TEXT PRIMARY KEY,
  query_kind TEXT NOT NULL,
  query_text TEXT NOT NULL,
  tier_used TEXT NOT NULL CHECK (tier_used IN ('fast', 'standard', 'deep')),
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('complete', 'partial')),
  support_level TEXT NOT NULL
    CHECK (support_level IN ('native', 'adapted', 'best_effort')),
  answer_confidence REAL,
  packet_json TEXT NOT NULL CHECK (json_valid(packet_json)),
  answer_markdown TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evidence_blocks (
  block_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL REFERENCES answer_traces(trace_id) ON DELETE CASCADE,
  block_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  file_path TEXT,
  line INTEGER,
  score REAL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_import_edges_source_file_id ON import_edges(source_file_id);
CREATE INDEX IF NOT EXISTS idx_import_edges_target_file_id ON import_edges(target_file_id);
CREATE INDEX IF NOT EXISTS idx_routes_file_id ON routes(file_id);
CREATE INDEX IF NOT EXISTS idx_schema_objects_lookup ON schema_objects(object_type, schema_name, object_name);
CREATE INDEX IF NOT EXISTS idx_schema_usages_schema_object_id ON schema_usages(schema_object_id);
CREATE INDEX IF NOT EXISTS idx_schema_usages_file_id ON schema_usages(file_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target_key ON graph_edges(target_key);
CREATE INDEX IF NOT EXISTS idx_findings_detector ON findings(detector);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_answer_traces_query_kind ON answer_traces(query_kind);
CREATE INDEX IF NOT EXISTS idx_evidence_blocks_trace_id ON evidence_blocks(trace_id);

CREATE TRIGGER IF NOT EXISTS findings_touch_updated_at
AFTER UPDATE ON findings
FOR EACH ROW
BEGIN
  UPDATE findings
  SET updated_at = CURRENT_TIMESTAMP
  WHERE finding_id = OLD.finding_id;
END;
`;

export const PROJECT_MIGRATION_0002_SCHEMA_SNAPSHOT_SQL = `CREATE TABLE IF NOT EXISTS schema_snapshots (
  snapshot_slot INTEGER PRIMARY KEY CHECK (snapshot_slot = 1),
  snapshot_id TEXT NOT NULL,
  source_mode TEXT NOT NULL
    CHECK (source_mode IN ('repo_only', 'repo_plus_live_verify', 'live_refresh_enabled')),
  generated_at TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  verified_at TEXT,
  fingerprint TEXT NOT NULL,
  freshness_status TEXT NOT NULL
    CHECK (freshness_status IN ('unknown', 'fresh', 'stale', 'verified', 'drift_detected', 'refresh_required')),
  drift_detected INTEGER NOT NULL DEFAULT 0 CHECK (drift_detected IN (0, 1)),
  drift_detected_at TEXT,
  ir_json TEXT NOT NULL CHECK (json_valid(ir_json)),
  warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings_json))
);

CREATE TABLE IF NOT EXISTS schema_snapshot_sources (
  source_id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('sql_migration', 'generated_types', 'prisma_schema', 'drizzle_schema', 'live_catalog')),
  source_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  last_modified_at TEXT,
  size_bytes INTEGER,
  UNIQUE (snapshot_slot, source_path)
);

CREATE INDEX IF NOT EXISTS idx_schema_snapshot_sources_slot ON schema_snapshot_sources(snapshot_slot);
`;

export const PROJECT_MIGRATION_0003_DB_BINDING_STATE_SQL = `CREATE TABLE IF NOT EXISTS db_binding_state (
  state_slot INTEGER PRIMARY KEY CHECK (state_slot = 1),
  last_tested_at TEXT,
  last_test_status TEXT CHECK (last_test_status IN ('untested', 'success', 'failure')),
  last_test_error TEXT,
  last_test_server_version TEXT,
  last_test_current_user TEXT,
  last_verified_at TEXT,
  last_refreshed_at TEXT
);

INSERT OR IGNORE INTO db_binding_state(state_slot, last_test_status)
VALUES (1, 'untested');
`;

export const PROJECT_MIGRATION_0004_SCHEMA_SNAPSHOT_READ_MODEL_SQL = `CREATE TABLE IF NOT EXISTS schema_snapshot_schemas (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  PRIMARY KEY (snapshot_slot, schema_name)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_tables (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  PRIMARY KEY (snapshot_slot, schema_name, table_name)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_columns (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  ordinal_position INTEGER NOT NULL,
  data_type TEXT NOT NULL,
  nullable INTEGER NOT NULL CHECK (nullable IN (0, 1)),
  default_expression TEXT,
  is_primary_key INTEGER NOT NULL DEFAULT 0 CHECK (is_primary_key IN (0, 1)),
  PRIMARY KEY (snapshot_slot, schema_name, table_name, column_name)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_primary_keys (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  ordinal_position INTEGER NOT NULL,
  PRIMARY KEY (snapshot_slot, schema_name, table_name, ordinal_position)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_indexes (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  index_name TEXT NOT NULL,
  is_unique INTEGER NOT NULL CHECK (is_unique IN (0, 1)),
  is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
  definition TEXT,
  columns_json TEXT NOT NULL CHECK (json_valid(columns_json)),
  PRIMARY KEY (snapshot_slot, schema_name, table_name, index_name)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_foreign_keys (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  constraint_name TEXT NOT NULL,
  target_schema TEXT NOT NULL,
  target_table TEXT NOT NULL,
  on_update TEXT NOT NULL,
  on_delete TEXT NOT NULL,
  columns_json TEXT NOT NULL CHECK (json_valid(columns_json)),
  target_columns_json TEXT NOT NULL CHECK (json_valid(target_columns_json)),
  PRIMARY KEY (snapshot_slot, schema_name, table_name, constraint_name)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_rls_policies (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PERMISSIVE', 'RESTRICTIVE')),
  command TEXT NOT NULL,
  roles_json TEXT NOT NULL CHECK (json_valid(roles_json)),
  using_expression TEXT,
  with_check_expression TEXT,
  PRIMARY KEY (snapshot_slot, schema_name, table_name, policy_name)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_triggers (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  trigger_name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  enabled_mode TEXT NOT NULL CHECK (enabled_mode IN ('O', 'D', 'R', 'A')),
  timing TEXT NOT NULL,
  events_json TEXT NOT NULL CHECK (json_valid(events_json)),
  PRIMARY KEY (snapshot_slot, schema_name, table_name, trigger_name)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_views (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  view_name TEXT NOT NULL,
  PRIMARY KEY (snapshot_slot, schema_name, view_name)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_enums (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  enum_name TEXT NOT NULL,
  enum_value TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (snapshot_slot, schema_name, enum_name, sort_order)
);

CREATE TABLE IF NOT EXISTS schema_snapshot_rpcs (
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  schema_name TEXT NOT NULL,
  rpc_name TEXT NOT NULL,
  rpc_kind TEXT NOT NULL CHECK (rpc_kind IN ('function', 'procedure')),
  return_type TEXT,
  arg_types_json TEXT NOT NULL CHECK (json_valid(arg_types_json)),
  PRIMARY KEY (snapshot_slot, schema_name, rpc_name, rpc_kind, arg_types_json)
);

CREATE INDEX IF NOT EXISTS idx_schema_snapshot_tables_schema
  ON schema_snapshot_tables(snapshot_slot, schema_name, table_name);
CREATE INDEX IF NOT EXISTS idx_schema_snapshot_columns_table
  ON schema_snapshot_columns(snapshot_slot, schema_name, table_name, ordinal_position);
CREATE INDEX IF NOT EXISTS idx_schema_snapshot_enums_schema
  ON schema_snapshot_enums(snapshot_slot, schema_name, enum_name, sort_order);
CREATE INDEX IF NOT EXISTS idx_schema_snapshot_rpcs_schema
  ON schema_snapshot_rpcs(snapshot_slot, schema_name, rpc_name);
CREATE INDEX IF NOT EXISTS idx_schema_snapshot_policies_table
  ON schema_snapshot_rls_policies(snapshot_slot, schema_name, table_name, policy_name);
CREATE INDEX IF NOT EXISTS idx_schema_snapshot_triggers_table
  ON schema_snapshot_triggers(snapshot_slot, schema_name, table_name, trigger_name);
`;

export const PROJECT_MIGRATION_0005_SCHEMA_SNAPSHOT_SOURCE_KIND_SQL = `ALTER TABLE schema_snapshot_sources RENAME TO schema_snapshot_sources_old;

CREATE TABLE schema_snapshot_sources (
  source_id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_slot INTEGER NOT NULL REFERENCES schema_snapshots(snapshot_slot) ON DELETE CASCADE,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('sql_migration', 'generated_types', 'prisma_schema', 'drizzle_schema', 'live_catalog')),
  source_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  last_modified_at TEXT,
  size_bytes INTEGER,
  UNIQUE (snapshot_slot, source_path)
);

INSERT INTO schema_snapshot_sources(
  source_id,
  snapshot_slot,
  source_kind,
  source_path,
  content_sha256,
  last_modified_at,
  size_bytes
)
SELECT
  source_id,
  snapshot_slot,
  source_kind,
  source_path,
  content_sha256,
  last_modified_at,
  size_bytes
FROM schema_snapshot_sources_old;

DROP TABLE schema_snapshot_sources_old;

CREATE INDEX IF NOT EXISTS idx_schema_snapshot_sources_slot ON schema_snapshot_sources(snapshot_slot);
`;

export const PROJECT_MIGRATION_0006_ACTION_LOGGING_SQL = `CREATE TABLE IF NOT EXISTS lifecycle_events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'project_attach',
      'project_detach',
      'project_index',
      'schema_snapshot_build',
      'schema_snapshot_refresh',
      'db_verify',
      'db_test',
      'db_bind',
      'db_unbind'
    )),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed', 'skipped')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  error_text TEXT
);

CREATE TABLE IF NOT EXISTS tool_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT,
  tool_name TEXT NOT NULL,
  input_summary_json TEXT NOT NULL CHECK (json_valid(input_summary_json)),
  output_summary_json TEXT CHECK (output_summary_json IS NULL OR json_valid(output_summary_json)),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed', 'error')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  request_id TEXT,
  error_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_type_started_at
  ON lifecycle_events(event_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_outcome_started_at
  ON lifecycle_events(outcome, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_runs_tool_name_started_at
  ON tool_runs(tool_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_runs_request_id
  ON tool_runs(request_id);

CREATE TRIGGER IF NOT EXISTS lifecycle_events_no_update
BEFORE UPDATE ON lifecycle_events
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'lifecycle_events rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS lifecycle_events_no_delete
BEFORE DELETE ON lifecycle_events
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'lifecycle_events rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS tool_runs_no_update
BEFORE UPDATE ON tool_runs
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'tool_runs rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS tool_runs_no_delete
BEFORE DELETE ON tool_runs
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'tool_runs rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0007_BENCHMARK_STORAGE_SQL = `ALTER TABLE tool_runs
ADD COLUMN payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json));

CREATE TABLE IF NOT EXISTS benchmark_suites (
  suite_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json))
);

CREATE TABLE IF NOT EXISTS benchmark_cases (
  case_id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL REFERENCES benchmark_suites(suite_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  expected_outcome TEXT NOT NULL CHECK (json_valid(expected_outcome))
);

CREATE TABLE IF NOT EXISTS benchmark_assertions (
  assertion_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES benchmark_cases(case_id) ON DELETE CASCADE,
  assertion_type TEXT NOT NULL,
  expected_value TEXT NOT NULL CHECK (json_valid(expected_value)),
  tolerance REAL
);

CREATE TABLE IF NOT EXISTS benchmark_runs (
  run_id TEXT PRIMARY KEY,
  suite_id TEXT NOT NULL REFERENCES benchmark_suites(suite_id),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  runner_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_case_results (
  case_result_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES benchmark_runs(run_id),
  case_id TEXT NOT NULL REFERENCES benchmark_cases(case_id),
  tool_run_id TEXT NOT NULL REFERENCES tool_runs(run_id),
  outcome TEXT NOT NULL,
  actual_value TEXT CHECK (actual_value IS NULL OR json_valid(actual_value))
);

CREATE TABLE IF NOT EXISTS benchmark_assertion_results (
  assertion_result_id TEXT PRIMARY KEY,
  case_result_id TEXT NOT NULL REFERENCES benchmark_case_results(case_result_id),
  assertion_id TEXT NOT NULL REFERENCES benchmark_assertions(assertion_id),
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  actual_value TEXT CHECK (actual_value IS NULL OR json_valid(actual_value)),
  expected_value TEXT NOT NULL CHECK (json_valid(expected_value))
);

CREATE INDEX IF NOT EXISTS idx_benchmark_cases_suite_id
  ON benchmark_cases(suite_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_assertions_case_id
  ON benchmark_assertions(case_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_suite_finished_at
  ON benchmark_runs(suite_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_case_results_run_id
  ON benchmark_case_results(run_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_case_results_case_id
  ON benchmark_case_results(case_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_case_results_tool_run_id
  ON benchmark_case_results(tool_run_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_assertion_results_case_result_id
  ON benchmark_assertion_results(case_result_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_assertion_results_assertion_id
  ON benchmark_assertion_results(assertion_id);

CREATE VIEW IF NOT EXISTS benchmark_run_summaries AS
SELECT
  runs.run_id,
  runs.suite_id,
  suites.name AS suite_name,
  suites.version AS suite_version,
  runs.outcome,
  runs.runner_version,
  runs.started_at,
  runs.finished_at,
  COUNT(DISTINCT case_results.case_result_id) AS case_count,
  COUNT(DISTINCT CASE WHEN case_results.outcome = 'passed' THEN case_results.case_result_id END) AS passed_case_count,
  COUNT(assertion_results.assertion_result_id) AS assertion_count,
  COALESCE(SUM(CASE WHEN assertion_results.passed = 1 THEN 1 ELSE 0 END), 0) AS passed_assertion_count
FROM benchmark_runs runs
INNER JOIN benchmark_suites suites ON suites.suite_id = runs.suite_id
LEFT JOIN benchmark_case_results case_results ON case_results.run_id = runs.run_id
LEFT JOIN benchmark_assertion_results assertion_results
  ON assertion_results.case_result_id = case_results.case_result_id
GROUP BY
  runs.run_id,
  runs.suite_id,
  suites.name,
  suites.version,
  runs.outcome,
  runs.runner_version,
  runs.started_at,
  runs.finished_at;

CREATE TRIGGER IF NOT EXISTS benchmark_runs_no_update
BEFORE UPDATE ON benchmark_runs
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'benchmark_runs rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS benchmark_runs_no_delete
BEFORE DELETE ON benchmark_runs
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'benchmark_runs rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS benchmark_case_results_no_update
BEFORE UPDATE ON benchmark_case_results
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'benchmark_case_results rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS benchmark_case_results_no_delete
BEFORE DELETE ON benchmark_case_results
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'benchmark_case_results rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS benchmark_assertion_results_no_update
BEFORE UPDATE ON benchmark_assertion_results
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'benchmark_assertion_results rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS benchmark_assertion_results_no_delete
BEFORE DELETE ON benchmark_assertion_results
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'benchmark_assertion_results rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0008_HARNESS_SQL = `CREATE TABLE IF NOT EXISTS harness_sessions (
  session_id TEXT PRIMARY KEY,
  project_id TEXT,
  parent_id TEXT REFERENCES harness_sessions(session_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  title TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('no-agent', 'local-agent', 'cloud-agent')),
  active_provider TEXT,
  active_model TEXT,
  fallback_chain_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(fallback_chain_json)),
  status TEXT NOT NULL CHECK (status IN ('active', 'idle', 'closed', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_harness_sessions_project_id ON harness_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_harness_sessions_parent_id ON harness_sessions(parent_id);

CREATE TABLE IF NOT EXISTS harness_messages (
  message_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES harness_sessions(session_id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES harness_messages(message_id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  ordinal INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_harness_messages_session_id ON harness_messages(session_id, ordinal);

CREATE TRIGGER IF NOT EXISTS harness_messages_no_update
BEFORE UPDATE ON harness_messages
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_messages rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS harness_messages_no_delete_except_cascade
BEFORE DELETE ON harness_messages
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM harness_sessions WHERE session_id = OLD.session_id) > 0
BEGIN
  SELECT RAISE(FAIL, 'harness_messages rows are append-only');
END;

CREATE TABLE IF NOT EXISTS harness_message_parts (
  part_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES harness_messages(message_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'tool_call', 'tool_result', 'reasoning', 'error')),
  ordinal INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  UNIQUE(message_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_harness_message_parts_message_id ON harness_message_parts(message_id, ordinal);

CREATE TRIGGER IF NOT EXISTS harness_message_parts_no_update
BEFORE UPDATE ON harness_message_parts
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_message_parts rows are append-only');
END;

CREATE TABLE IF NOT EXISTS harness_session_events (
  session_id TEXT NOT NULL REFERENCES harness_sessions(session_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_harness_session_events_kind ON harness_session_events(session_id, kind);

CREATE TRIGGER IF NOT EXISTS harness_session_events_no_update
BEFORE UPDATE ON harness_session_events
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_session_events rows are append-only');
END;

CREATE TABLE IF NOT EXISTS harness_permission_decisions (
  decision_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES harness_sessions(session_id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('allow', 'deny', 'ask')),
  scope TEXT NOT NULL CHECK (scope IN ('turn', 'session', 'project', 'global')),
  remembered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS harness_provider_calls (
  call_id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES harness_sessions(session_id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  cost_hint REAL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_harness_provider_calls_session ON harness_provider_calls(session_id, created_at);

CREATE TRIGGER IF NOT EXISTS harness_provider_calls_no_update
BEFORE UPDATE ON harness_provider_calls
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_provider_calls rows are append-only');
END;
`;

/**
 * Phase 3.0 hotfix: append-only DELETE protection.
 *
 * The original Phase 3.0 migration shipped BEFORE UPDATE triggers on
 * harness_message_parts, harness_session_events, harness_provider_calls,
 * and (implicitly) harness_permission_decisions, but no DELETE protection.
 * That meant `DELETE FROM harness_session_events WHERE ...` was silently
 * accepted, breaking the append-only audit guarantee the phase doc promised.
 *
 * Fix: BEFORE DELETE triggers using the same cascade-safe `WHEN parent
 * still exists` pattern that `harness_messages_no_delete_except_cascade`
 * established. Direct deletes fail; ON DELETE CASCADE from the parent
 * (harness_sessions / harness_messages) is unaffected because by the time
 * the cascade reaches a child, the parent row is already gone — the WHEN
 * guard returns false and the trigger doesn't fire.
 *
 * For harness_provider_calls.session_id (nullable), we extend the guard
 * to also fail when session_id IS NULL, since null-session provider calls
 * are never cascaded (no parent to cascade from) and should be append-only
 * just like everything else.
 *
 * Migration is idempotent via `CREATE TRIGGER IF NOT EXISTS`, safe to apply
 * to fresh and existing project.db files alike.
 */
export const PROJECT_MIGRATION_0009_HARNESS_DELETE_GUARDS_SQL = `CREATE TRIGGER IF NOT EXISTS harness_message_parts_no_delete_except_cascade
BEFORE DELETE ON harness_message_parts
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM harness_messages WHERE message_id = OLD.message_id) > 0
BEGIN
  SELECT RAISE(FAIL, 'harness_message_parts rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS harness_session_events_no_delete_except_cascade
BEFORE DELETE ON harness_session_events
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM harness_sessions WHERE session_id = OLD.session_id) > 0
BEGIN
  SELECT RAISE(FAIL, 'harness_session_events rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS harness_provider_calls_no_delete_except_cascade
BEFORE DELETE ON harness_provider_calls
FOR EACH ROW
WHEN (
  OLD.session_id IS NULL
  OR (SELECT COUNT(*) FROM harness_sessions WHERE session_id = OLD.session_id) > 0
)
BEGIN
  SELECT RAISE(FAIL, 'harness_provider_calls rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS harness_permission_decisions_no_update
BEFORE UPDATE ON harness_permission_decisions
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_permission_decisions rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS harness_permission_decisions_no_delete_except_cascade
BEFORE DELETE ON harness_permission_decisions
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM harness_sessions WHERE session_id = OLD.session_id) > 0
BEGIN
  SELECT RAISE(FAIL, 'harness_permission_decisions rows are append-only');
END;
`;

/**
 * Phase 3.3: harness_memories and its FTS5 contentless-synced mirror.
 *
 * `harness_memories` is the canonical append-only store of human-curated or
 * agent-authored memory facts. It is scoped by `project_id` (nullable to
 * support global-scope memories, which are not used in 3.3 but kept room for).
 *
 * The FTS5 virtual table `harness_memories_fts` rides `content='harness_memories'`
 * and `content_rowid='memory_rowid'`. An AFTER INSERT trigger keeps the FTS
 * index in sync; no DELETE or UPDATE sync triggers exist because memories are
 * append-only (enforced by BEFORE UPDATE / BEFORE DELETE triggers below).
 *
 * FTS5 tokenizer is `unicode61` — default for English/Latin scripts. Non-English
 * projects can override in a future migration without losing prior content by
 * rebuilding via `INSERT INTO harness_memories_fts(harness_memories_fts) VALUES('rebuild');`.
 */
export const PROJECT_MIGRATION_0010_HARNESS_MEMORIES_SQL = `CREATE TABLE IF NOT EXISTS harness_memories (
  memory_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  text TEXT NOT NULL,
  category TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_harness_memories_project ON harness_memories(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_harness_memories_category ON harness_memories(category);

CREATE VIRTUAL TABLE IF NOT EXISTS harness_memories_fts USING fts5(
  text,
  content='harness_memories',
  content_rowid='memory_rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS harness_memories_fts_insert
AFTER INSERT ON harness_memories
BEGIN
  INSERT INTO harness_memories_fts(rowid, text) VALUES (new.memory_rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS harness_memories_no_update
BEFORE UPDATE ON harness_memories
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_memories rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS harness_memories_no_delete
BEFORE DELETE ON harness_memories
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_memories rows are append-only');
END;
`;

/**
 * Phase 3.3: harness_embeddings — append-only vector storage as Float32 BLOBs.
 *
 * Vectors are stored as raw little-endian Float32 bytes (dim * 4 bytes). Cosine
 * similarity is computed in Node at query time. This is the "Node-side cosine
 * fallback over BLOB columns" path the Phase 3.3 spec permits; it lets the
 * feature ship on every platform without the `sqlite-vec` native extension,
 * which has Windows x64 binding risk and platform-specific build concerns.
 *
 * Every row carries its `provider` and `model`. Recall always filters by
 * `model` so mixing embedding models never causes dimension mismatches — old
 * vectors remain on disk but are not surfaced once the active model changes.
 * `dim` is redundant with vector length but lets queries reject malformed rows
 * cheaply without materializing the BLOB.
 *
 * `owner_kind` allows future phases to embed files and symbols without adding
 * a new table. Phase 3.3 ships only `owner_kind='memory'`.
 */
export const PROJECT_MIGRATION_0011_HARNESS_EMBEDDINGS_SQL = `CREATE TABLE IF NOT EXISTS harness_embeddings (
  embedding_id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('memory', 'file', 'symbol')),
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL CHECK (dim > 0),
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_harness_embeddings_owner_model
  ON harness_embeddings(owner_kind, model, owner_id);

CREATE INDEX IF NOT EXISTS idx_harness_embeddings_owner_ref
  ON harness_embeddings(owner_kind, owner_id);

CREATE TRIGGER IF NOT EXISTS harness_embeddings_no_update
BEFORE UPDATE ON harness_embeddings
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_embeddings rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS harness_embeddings_no_delete
BEFORE DELETE ON harness_embeddings
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_embeddings rows are append-only');
END;
`;

/**
 * Phase 3.4: session archival + harness version fence.
 *
 * `harness_messages.archived` lets compaction mark old turns as excluded from
 * model context without deleting them — the originals stay in `project.db`
 * for audit. `buildHistory` filters `archived = 0` when assembling a turn's
 * message list for the provider.
 *
 * Migration 0008 shipped a blanket `harness_messages_no_update` trigger that
 * rejected every UPDATE on `harness_messages`. Compaction needs to flip
 * `archived` from 0 → 1 on existing rows, so 0012 swaps the blanket trigger
 * for a targeted version that still refuses writes to every other column. The
 * `WHEN` clause uses `OLD.col IS NOT NEW.col` so NULL-vs-NULL compares as
 * equal (SQLite tri-valued logic makes `=` unsafe here).
 *
 * `harness_sessions.harness_version` stamps the running harness's semver at
 * session-creation time. `agentmako session resume` compares the stamp's
 * major component against the running binary and refuses on mismatch (event
 * semantics may have shifted between major versions).
 *
 * The migration runner's version-gate guarantees this runs at most once per
 * database file, so ALTER TABLE ADD COLUMN is safe to leave non-idempotent.
 */
export const PROJECT_MIGRATION_0012_HARNESS_MESSAGES_ARCHIVED_SQL = `ALTER TABLE harness_messages
  ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_harness_messages_archived
  ON harness_messages(session_id, archived);

DROP TRIGGER IF EXISTS harness_messages_no_update;

CREATE TRIGGER IF NOT EXISTS harness_messages_no_update_except_archived
BEFORE UPDATE ON harness_messages
FOR EACH ROW
WHEN (
  OLD.message_id IS NOT NEW.message_id
  OR OLD.session_id IS NOT NEW.session_id
  OR OLD.parent_id IS NOT NEW.parent_id
  OR OLD.role IS NOT NEW.role
  OR OLD.ordinal IS NOT NEW.ordinal
  OR OLD.created_at IS NOT NEW.created_at
)
BEGIN
  SELECT RAISE(FAIL, 'harness_messages rows are append-only (except archived)');
END;

ALTER TABLE harness_sessions
  ADD COLUMN harness_version TEXT;
`;

export const PROJECT_MIGRATION_0013_SCHEMA_SNAPSHOT_BODIES_SQL = `-- Phase 3.6.0 Workstream C: persist PL/pgSQL function + trigger body text so
-- composers can answer "which RPC references table X" and "which trigger
-- invokes function Y" without hitting a live DB.

ALTER TABLE schema_snapshot_rpcs
  ADD COLUMN body_text TEXT;

ALTER TABLE schema_snapshot_triggers
  ADD COLUMN body_text TEXT;

CREATE TABLE IF NOT EXISTS schema_snapshot_function_refs (
  snapshot_slot INTEGER NOT NULL DEFAULT 1,
  rpc_schema TEXT NOT NULL,
  rpc_name TEXT NOT NULL,
  target_schema TEXT NOT NULL,
  target_table TEXT NOT NULL,
  PRIMARY KEY (snapshot_slot, rpc_schema, rpc_name, target_schema, target_table)
);

CREATE INDEX IF NOT EXISTS idx_schema_snapshot_function_refs_rpc
  ON schema_snapshot_function_refs(rpc_schema, rpc_name);

CREATE INDEX IF NOT EXISTS idx_schema_snapshot_function_refs_target
  ON schema_snapshot_function_refs(target_schema, target_table);
`;

export const PROJECT_MIGRATION_0014_CHUNK_SEARCH_TEXT_SQL = `-- Phase 3.6.0.x: add a derived search_text column for chunk names so FTS can
-- match camelCase identifiers through natural-language queries ("get user by
-- email" -> getUserByEmail). Rebuild chunks_fts to index that derived text.

ALTER TABLE chunks
  ADD COLUMN search_text TEXT;

DROP TRIGGER IF EXISTS chunks_ai;
DROP TRIGGER IF EXISTS chunks_ad;
DROP TRIGGER IF EXISTS chunks_au;

DROP TABLE IF EXISTS chunks_fts;

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  path,
  name,
  search_text,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai
AFTER INSERT ON chunks
FOR EACH ROW
BEGIN
  INSERT INTO chunks_fts(rowid, content, path, name, search_text)
  VALUES (
    NEW.chunk_id,
    NEW.content,
    (SELECT path FROM files WHERE file_id = NEW.file_id),
    COALESCE(NEW.name, ''),
    COALESCE(NEW.search_text, '')
  );
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad
AFTER DELETE ON chunks
FOR EACH ROW
BEGIN
  DELETE FROM chunks_fts
  WHERE rowid = OLD.chunk_id;
END;

CREATE TRIGGER IF NOT EXISTS chunks_au
AFTER UPDATE ON chunks
FOR EACH ROW
BEGIN
  DELETE FROM chunks_fts
  WHERE rowid = OLD.chunk_id;

  INSERT INTO chunks_fts(rowid, content, path, name, search_text)
  VALUES (
    NEW.chunk_id,
    NEW.content,
    (SELECT path FROM files WHERE file_id = NEW.file_id),
    COALESCE(NEW.name, ''),
    COALESCE(NEW.search_text, '')
  );
END;
`;

export const PROJECT_MIGRATION_0015_SCHEMA_FUNCTION_REFS_SIGNATURE_SQL = `-- Phase 3.6.0.x: preserve overloaded RPC identity in the derived
-- function-ref edge table. The read model is derived from schema_snapshot_rpcs,
-- so it is safe to rebuild this table in place.

DROP INDEX IF EXISTS idx_schema_snapshot_function_refs_rpc;
DROP INDEX IF EXISTS idx_schema_snapshot_function_refs_target;
DROP TABLE IF EXISTS schema_snapshot_function_refs;

CREATE TABLE IF NOT EXISTS schema_snapshot_function_refs (
  snapshot_slot INTEGER NOT NULL DEFAULT 1,
  rpc_schema TEXT NOT NULL,
  rpc_name TEXT NOT NULL,
  rpc_kind TEXT NOT NULL CHECK (rpc_kind IN ('function', 'procedure')),
  arg_types_json TEXT NOT NULL CHECK (json_valid(arg_types_json)),
  target_schema TEXT NOT NULL,
  target_table TEXT NOT NULL,
  PRIMARY KEY (
    snapshot_slot,
    rpc_schema,
    rpc_name,
    rpc_kind,
    arg_types_json,
    target_schema,
    target_table
  )
);

CREATE INDEX IF NOT EXISTS idx_schema_snapshot_function_refs_rpc
  ON schema_snapshot_function_refs(rpc_schema, rpc_name, rpc_kind, arg_types_json);

CREATE INDEX IF NOT EXISTS idx_schema_snapshot_function_refs_target
  ON schema_snapshot_function_refs(target_schema, target_table);
`;

export const PROJECT_MIGRATION_0016_HARNESS_SEMANTIC_UNITS_SQL = `-- Phase 3.7: widen harness_embeddings.owner_kind for semantic units and add a
-- rebuildable semantic-unit read model with FTS search.

DROP TRIGGER IF EXISTS harness_embeddings_no_update;
DROP TRIGGER IF EXISTS harness_embeddings_no_delete;
DROP INDEX IF EXISTS idx_harness_embeddings_owner_model;
DROP INDEX IF EXISTS idx_harness_embeddings_owner_ref;

ALTER TABLE harness_embeddings RENAME TO harness_embeddings_old;

CREATE TABLE harness_embeddings (
  embedding_id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('memory', 'file', 'symbol', 'semantic_unit')),
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL CHECK (dim > 0),
  vector BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO harness_embeddings(
  embedding_id,
  owner_kind,
  owner_id,
  provider,
  model,
  dim,
  vector,
  created_at
)
SELECT
  embedding_id,
  owner_kind,
  owner_id,
  provider,
  model,
  dim,
  vector,
  created_at
FROM harness_embeddings_old;

DROP TABLE harness_embeddings_old;

CREATE INDEX idx_harness_embeddings_owner_model
  ON harness_embeddings(owner_kind, model, owner_id);

CREATE INDEX idx_harness_embeddings_owner_ref
  ON harness_embeddings(owner_kind, owner_id);

CREATE TRIGGER harness_embeddings_no_update
BEFORE UPDATE ON harness_embeddings
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_embeddings rows are append-only');
END;

CREATE TRIGGER harness_embeddings_no_delete
BEFORE DELETE ON harness_embeddings
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'harness_embeddings rows are append-only');
END;

CREATE TABLE harness_semantic_units (
  unit_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  unit_kind TEXT NOT NULL CHECK (unit_kind IN ('code_symbol', 'doc_chunk')),
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  file_path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  owner_ref TEXT NOT NULL,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  source_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_harness_semantic_units_kind
  ON harness_semantic_units(unit_kind, file_path, line_start);

CREATE INDEX idx_harness_semantic_units_owner_ref
  ON harness_semantic_units(owner_ref);

CREATE VIRTUAL TABLE harness_semantic_units_fts USING fts5(
  title,
  text,
  file_path,
  content='harness_semantic_units',
  content_rowid='unit_rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER harness_semantic_units_ai
AFTER INSERT ON harness_semantic_units
FOR EACH ROW
BEGIN
  INSERT INTO harness_semantic_units_fts(rowid, title, text, file_path)
  VALUES (NEW.unit_rowid, NEW.title, NEW.text, COALESCE(NEW.file_path, ''));
END;

CREATE TRIGGER harness_semantic_units_ad
AFTER DELETE ON harness_semantic_units
FOR EACH ROW
BEGIN
  INSERT INTO harness_semantic_units_fts(harness_semantic_units_fts, rowid, title, text, file_path)
  VALUES ('delete', OLD.unit_rowid, OLD.title, OLD.text, COALESCE(OLD.file_path, ''));
END;

CREATE TRIGGER harness_semantic_units_au
AFTER UPDATE ON harness_semantic_units
FOR EACH ROW
BEGIN
  INSERT INTO harness_semantic_units_fts(harness_semantic_units_fts, rowid, title, text, file_path)
  VALUES ('delete', OLD.unit_rowid, OLD.title, OLD.text, COALESCE(OLD.file_path, ''));

  INSERT INTO harness_semantic_units_fts(rowid, title, text, file_path)
  VALUES (NEW.unit_rowid, NEW.title, NEW.text, COALESCE(NEW.file_path, ''));
END;
`;

/**
 * Phase 3.9: per-call usage detail and caller-kind classification.
 *
 * Existing `harness_provider_calls` rows carry `prompt_tokens` and
 * `completion_tokens` only. 3.9 adds:
 *
 *   - reasoning_tokens     — reasoning-capable models (Claude 3.7, GPT-o-series)
 *   - cache_read_tokens    — prompt-cache hit tokens (charged at reduced rate)
 *   - cache_write_tokens   — prompt-cache write tokens
 *   - cost_usd_micro       — micro-USD (1 USD = 1_000_000); computed at
 *                            write time against the active catalog so history
 *                            stays accurate to what was true when the call
 *                            happened (rates drift; we never backfill)
 *   - caller_kind          — 'chat' for turns initiated from the Vite web
 *                            chat surface; 'agent' for non-web agent clients
 *                            / runtimes (Codex, Claude Code, OpenCode,
 *                            MCP-style callers, backend automation)
 *
 * All columns are nullable / defaulted so existing rows stay valid.
 * caller_kind defaults to 'chat' (existing rows were all from the web chat
 * before 3.9 shipped).
 *
 * CHECK constraints on ALTER-added columns are supported in SQLite and the
 * BEFORE UPDATE trigger still blocks mutation on new columns.
 */
export const PROJECT_MIGRATION_0017_PROVIDER_CALLS_USAGE_SQL = `ALTER TABLE harness_provider_calls
  ADD COLUMN reasoning_tokens INTEGER DEFAULT NULL;

ALTER TABLE harness_provider_calls
  ADD COLUMN cache_read_tokens INTEGER DEFAULT NULL;

ALTER TABLE harness_provider_calls
  ADD COLUMN cache_write_tokens INTEGER DEFAULT NULL;

ALTER TABLE harness_provider_calls
  ADD COLUMN cost_usd_micro INTEGER DEFAULT NULL;

ALTER TABLE harness_provider_calls
  ADD COLUMN caller_kind TEXT NOT NULL DEFAULT 'chat'
    CHECK (caller_kind IN ('agent', 'chat'));

CREATE INDEX IF NOT EXISTS idx_harness_provider_calls_kind_model
  ON harness_provider_calls(caller_kind, provider, model, created_at);
`;

export const PROJECT_MIGRATION_0018_ANSWER_TRUST_BACKBONE_SQL = `ALTER TABLE answer_traces
  ADD COLUMN project_id TEXT;

UPDATE answer_traces
SET project_id = COALESCE(project_id, json_extract(packet_json, '$.projectId'))
WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_answer_traces_project_kind_created_at
  ON answer_traces(project_id, query_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS answer_comparable_targets (
  target_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  query_kind TEXT NOT NULL,
  normalized_query_text TEXT NOT NULL,
  comparison_key TEXT NOT NULL UNIQUE,
  identity_json TEXT NOT NULL CHECK (json_valid(identity_json)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS answer_trust_runs (
  trace_id TEXT PRIMARY KEY REFERENCES answer_traces(trace_id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES answer_comparable_targets(target_id) ON DELETE CASCADE,
  previous_trace_id TEXT REFERENCES answer_trust_runs(trace_id) ON DELETE SET NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('interactive', 'manual_rerun', 'benchmark', 'seeded_eval', 'unknown')),
  packet_hash TEXT NOT NULL,
  answer_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_answer_comparable_targets_project_kind
  ON answer_comparable_targets(project_id, query_kind, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_answer_comparable_targets_comparison_key
  ON answer_comparable_targets(comparison_key);
CREATE INDEX IF NOT EXISTS idx_answer_trust_runs_target_created_at
  ON answer_trust_runs(target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_answer_trust_runs_previous_trace_id
  ON answer_trust_runs(previous_trace_id);
`;

export const PROJECT_MIGRATION_0019_ANSWER_TRUST_HARDENING_SQL = `ALTER TABLE answer_trust_runs
  ADD COLUMN raw_packet_hash TEXT;

ALTER TABLE answer_trust_runs
  ADD COLUMN previous_packet_hash TEXT;

ALTER TABLE answer_trust_runs
  ADD COLUMN environment_fingerprint_json TEXT CHECK (
    environment_fingerprint_json IS NULL OR json_valid(environment_fingerprint_json)
  );
`;

export const PROJECT_MIGRATION_0020_ANSWER_TRUST_INDEX_CLEANUP_SQL = `DROP INDEX IF EXISTS idx_answer_comparable_targets_comparison_key;
`;

export const PROJECT_MIGRATION_0021_ANSWER_COMPARISONS_SQL = `CREATE TABLE IF NOT EXISTS answer_comparisons (
  comparison_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES answer_comparable_targets(target_id) ON DELETE CASCADE,
  prior_trace_id TEXT NOT NULL REFERENCES answer_trust_runs(trace_id) ON DELETE CASCADE,
  current_trace_id TEXT NOT NULL UNIQUE REFERENCES answer_trust_runs(trace_id) ON DELETE CASCADE,
  provenance TEXT NOT NULL CHECK (provenance IN ('interactive', 'manual_rerun', 'benchmark', 'seeded_eval', 'unknown')),
  raw_delta_json TEXT NOT NULL CHECK (json_valid(raw_delta_json)),
  summary_changes_json TEXT NOT NULL CHECK (json_valid(summary_changes_json)),
  meaningful_change_detected INTEGER NOT NULL CHECK (meaningful_change_detected IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_comparisons_run_pair
  ON answer_comparisons(prior_trace_id, current_trace_id);

CREATE INDEX IF NOT EXISTS idx_answer_comparisons_target_created_at
  ON answer_comparisons(target_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS answer_comparisons_no_update
BEFORE UPDATE ON answer_comparisons
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'answer_comparisons rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS answer_comparisons_no_delete
BEFORE DELETE ON answer_comparisons
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'answer_comparisons rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0022_ANSWER_TRUST_STATE_SQL = `CREATE TABLE IF NOT EXISTS answer_trust_clusters (
  cluster_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES answer_comparable_targets(target_id) ON DELETE CASCADE,
  cluster_key TEXT NOT NULL,
  packet_hash TEXT NOT NULL,
  support_level TEXT NOT NULL CHECK (support_level IN ('native', 'adapted', 'best_effort')),
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('complete', 'partial')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  run_count INTEGER NOT NULL CHECK (run_count >= 1),
  UNIQUE(target_id, cluster_key)
);

CREATE INDEX IF NOT EXISTS idx_answer_trust_clusters_target_last_seen
  ON answer_trust_clusters(target_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS answer_trust_evaluations (
  evaluation_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES answer_comparable_targets(target_id) ON DELETE CASCADE,
  trace_id TEXT NOT NULL REFERENCES answer_trust_runs(trace_id) ON DELETE CASCADE,
  comparison_id TEXT REFERENCES answer_comparisons(comparison_id) ON DELETE SET NULL,
  cluster_id TEXT REFERENCES answer_trust_clusters(cluster_id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('stable', 'changed', 'aging', 'stale', 'superseded', 'contradicted', 'insufficient_evidence')),
  reasons_json TEXT NOT NULL CHECK (json_valid(reasons_json)),
  age_days INTEGER,
  aging_days INTEGER,
  stale_days INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_answer_trust_evaluations_trace_created_at
  ON answer_trust_evaluations(trace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_answer_trust_evaluations_target_created_at
  ON answer_trust_evaluations(target_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS answer_trust_evaluations_no_update
BEFORE UPDATE ON answer_trust_evaluations
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'answer_trust_evaluations rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS answer_trust_evaluations_no_delete
BEFORE DELETE ON answer_trust_evaluations
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'answer_trust_evaluations rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0023_ANSWER_TRUST_EVALUATION_METADATA_SQL = `ALTER TABLE answer_trust_evaluations
  ADD COLUMN basis_trace_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(basis_trace_ids_json));

ALTER TABLE answer_trust_evaluations
  ADD COLUMN conflicting_facets_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(conflicting_facets_json));

ALTER TABLE answer_trust_evaluations
  ADD COLUMN scope_relation TEXT NOT NULL DEFAULT 'none' CHECK (
    scope_relation IN ('none', 'same_scope', 'changed_scope', 'backtested_old_scope')
  );
`;

export const PROJECT_MIGRATION_0024_WORKFLOW_FOLLOWUPS_SQL = `CREATE TABLE IF NOT EXISTS workflow_followups (
  followup_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  origin_query_id TEXT NOT NULL,
  origin_action_id TEXT NOT NULL,
  origin_packet_id TEXT,
  origin_packet_family TEXT NOT NULL CHECK (
    origin_packet_family IN ('implementation_brief', 'impact_packet', 'precedent_pack', 'verification_plan', 'workflow_recipe')
  ),
  origin_query_kind TEXT NOT NULL CHECK (
    origin_query_kind IN ('route_trace', 'schema_usage', 'auth_path', 'file_health', 'free_form', 'trace_file', 'preflight_table', 'cross_search', 'trace_edge', 'trace_error', 'trace_table', 'trace_rpc')
  ),
  executed_tool_name TEXT NOT NULL,
  executed_input_json TEXT NOT NULL CHECK (json_valid(executed_input_json)),
  result_packet_id TEXT NOT NULL,
  result_packet_family TEXT NOT NULL CHECK (
    result_packet_family IN ('implementation_brief', 'impact_packet', 'precedent_pack', 'verification_plan', 'workflow_recipe')
  ),
  result_query_id TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_followups_origin_query
  ON workflow_followups(origin_query_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_followups_origin_action
  ON workflow_followups(origin_action_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_followups_request_id
  ON workflow_followups(request_id);

CREATE TRIGGER IF NOT EXISTS workflow_followups_no_update
BEFORE UPDATE ON workflow_followups
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'workflow_followups rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS workflow_followups_no_delete
BEFORE DELETE ON workflow_followups
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'workflow_followups rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0025_RUNTIME_TELEMETRY_SQL = `-- Phase 8.1a: append-only runtime usefulness telemetry table.
--
-- Mirrors the eval runner's typed output (see evals/runner.ts) so 8.1b
-- write paths can persist RuntimeUsefulnessEvent rows at decision sites
-- without inventing a parallel grading vocabulary.
--
-- Append-only: compaction is an operator action via rollup extraction
-- or archival export, never a default delete policy.
CREATE TABLE IF NOT EXISTS mako_usefulness_events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  trace_id TEXT,
  captured_at TEXT NOT NULL,
  decision_kind TEXT NOT NULL CHECK (decision_kind IN (
    'artifact_usefulness',
    'power_workflow_usefulness',
    'packet_usefulness',
    'wrapper_usefulness'
  )),
  family TEXT NOT NULL,
  tool_name TEXT,
  grade TEXT NOT NULL CHECK (grade IN ('full', 'partial', 'no')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reason_codes_json)),
  observed_followup_linked INTEGER CHECK (observed_followup_linked IS NULL OR observed_followup_linked IN (0, 1)),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_mako_usefulness_events_project_captured_at
  ON mako_usefulness_events(project_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_mako_usefulness_events_decision_family
  ON mako_usefulness_events(decision_kind, family, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_mako_usefulness_events_request_id
  ON mako_usefulness_events(request_id);

CREATE TRIGGER IF NOT EXISTS mako_usefulness_events_no_update
BEFORE UPDATE ON mako_usefulness_events
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'mako_usefulness_events rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS mako_usefulness_events_no_delete
BEFORE DELETE ON mako_usefulness_events
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'mako_usefulness_events rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0026_FINDING_ACKS_SQL = `-- Initial Testing Phase 1: operator-facing finding acknowledgement ledger.
--
-- Unified storage for "this AST match / diagnostic finding is verified
-- safe." Two identity sources share the table: ast_match rows carry a
-- location-aware fingerprint computed by computeAstMatchFingerprint;
-- diagnostic_issue rows carry AnswerSurfaceIssue.identity.matchBasedId.
--
-- Filter dedupes by (project_id, category, fingerprint) regardless of
-- status. Append-only with no-update / no-delete triggers, matching
-- tool_runs and mako_usefulness_events.
CREATE TABLE IF NOT EXISTS finding_acks (
  ack_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('ast_match', 'diagnostic_issue')),
  file_path TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ignored', 'accepted')),
  reason TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  snippet TEXT,
  source_tool_name TEXT,
  source_rule_id TEXT,
  source_identity_match_based_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_finding_acks_project_category_fingerprint
  ON finding_acks(project_id, category, fingerprint);

CREATE INDEX IF NOT EXISTS idx_finding_acks_project_subject_kind
  ON finding_acks(project_id, subject_kind, acknowledged_at DESC);

CREATE INDEX IF NOT EXISTS idx_finding_acks_project_file_path
  ON finding_acks(project_id, file_path, acknowledged_at DESC);

CREATE INDEX IF NOT EXISTS idx_finding_acks_project_acknowledged_at
  ON finding_acks(project_id, acknowledged_at DESC);

CREATE TRIGGER IF NOT EXISTS finding_acks_no_update
BEFORE UPDATE ON finding_acks
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'finding_acks rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS finding_acks_no_delete
BEFORE DELETE ON finding_acks
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'finding_acks rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0027_RUNTIME_TELEMETRY_FINDING_ACK_KIND_SQL = `-- Initial Testing Phase 1: widen mako_usefulness_events.decision_kind
-- CHECK so finding_ack decision rows can land. SQLite does not support
-- ALTER TABLE on CHECK constraints, so this uses the canonical
-- create-new / copy / drop-old / rename dance. No foreign keys reference
-- this table, so foreign-key toggling is not needed.
CREATE TABLE mako_usefulness_events_v2 (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  trace_id TEXT,
  captured_at TEXT NOT NULL,
  decision_kind TEXT NOT NULL CHECK (decision_kind IN (
    'artifact_usefulness',
    'power_workflow_usefulness',
    'packet_usefulness',
    'wrapper_usefulness',
    'finding_ack'
  )),
  family TEXT NOT NULL,
  tool_name TEXT,
  grade TEXT NOT NULL CHECK (grade IN ('full', 'partial', 'no')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reason_codes_json)),
  observed_followup_linked INTEGER CHECK (observed_followup_linked IS NULL OR observed_followup_linked IN (0, 1)),
  reason TEXT
);

INSERT INTO mako_usefulness_events_v2(
  event_id,
  project_id,
  request_id,
  trace_id,
  captured_at,
  decision_kind,
  family,
  tool_name,
  grade,
  reason_codes_json,
  observed_followup_linked,
  reason
)
SELECT
  event_id,
  project_id,
  request_id,
  trace_id,
  captured_at,
  decision_kind,
  family,
  tool_name,
  grade,
  reason_codes_json,
  observed_followup_linked,
  reason
FROM mako_usefulness_events;

DROP TABLE mako_usefulness_events;
ALTER TABLE mako_usefulness_events_v2 RENAME TO mako_usefulness_events;

CREATE INDEX IF NOT EXISTS idx_mako_usefulness_events_project_captured_at
  ON mako_usefulness_events(project_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_mako_usefulness_events_decision_family
  ON mako_usefulness_events(decision_kind, family, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_mako_usefulness_events_request_id
  ON mako_usefulness_events(request_id);

CREATE TRIGGER IF NOT EXISTS mako_usefulness_events_no_update
BEFORE UPDATE ON mako_usefulness_events
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'mako_usefulness_events rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS mako_usefulness_events_no_delete
BEFORE DELETE ON mako_usefulness_events
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'mako_usefulness_events rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0028_ANSWER_TRACE_RECALL_FTS_SQL = `-- CC roadmap Phase 6: searchable answer-recall index.
-- External-content FTS keeps answer_traces as the source of truth while
-- making free-text recall fast. Triggers keep inserts, direct updates, and
-- deletes in sync; callers still keep a LIKE fallback for exact identifiers.
CREATE VIRTUAL TABLE IF NOT EXISTS answer_traces_fts USING fts5(
  query_text,
  answer_markdown,
  content='answer_traces'
);

INSERT INTO answer_traces_fts(answer_traces_fts) VALUES('rebuild');

CREATE TRIGGER IF NOT EXISTS answer_traces_fts_ai
AFTER INSERT ON answer_traces
FOR EACH ROW
BEGIN
  INSERT INTO answer_traces_fts(rowid, query_text, answer_markdown)
  VALUES(new.rowid, new.query_text, COALESCE(new.answer_markdown, ''));
END;

CREATE TRIGGER IF NOT EXISTS answer_traces_fts_ad
AFTER DELETE ON answer_traces
FOR EACH ROW
BEGIN
  INSERT INTO answer_traces_fts(answer_traces_fts, rowid, query_text, answer_markdown)
  VALUES('delete', old.rowid, old.query_text, COALESCE(old.answer_markdown, ''));
END;

CREATE TRIGGER IF NOT EXISTS answer_traces_fts_au
AFTER UPDATE OF query_text, answer_markdown ON answer_traces
FOR EACH ROW
BEGIN
  INSERT INTO answer_traces_fts(answer_traces_fts, rowid, query_text, answer_markdown)
  VALUES('delete', old.rowid, old.query_text, COALESCE(old.answer_markdown, ''));
  INSERT INTO answer_traces_fts(rowid, query_text, answer_markdown)
  VALUES(new.rowid, new.query_text, COALESCE(new.answer_markdown, ''));
END;
`;

export const PROJECT_MIGRATION_0029_RUNTIME_TELEMETRY_AGENT_FEEDBACK_KIND_SQL = `-- CC roadmap Phase 8: widen mako_usefulness_events.decision_kind
-- CHECK so direct agent feedback rows can land. Mirrors migration 0027's
-- create-new / copy / drop-old / rename pattern for SQLite CHECK changes.
CREATE TABLE mako_usefulness_events_v2 (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  trace_id TEXT,
  captured_at TEXT NOT NULL,
  decision_kind TEXT NOT NULL CHECK (decision_kind IN (
    'artifact_usefulness',
    'power_workflow_usefulness',
    'packet_usefulness',
    'wrapper_usefulness',
    'finding_ack',
    'agent_feedback'
  )),
  family TEXT NOT NULL,
  tool_name TEXT,
  grade TEXT NOT NULL CHECK (grade IN ('full', 'partial', 'no')),
  reason_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reason_codes_json)),
  observed_followup_linked INTEGER CHECK (observed_followup_linked IS NULL OR observed_followup_linked IN (0, 1)),
  reason TEXT
);

INSERT INTO mako_usefulness_events_v2(
  event_id,
  project_id,
  request_id,
  trace_id,
  captured_at,
  decision_kind,
  family,
  tool_name,
  grade,
  reason_codes_json,
  observed_followup_linked,
  reason
)
SELECT
  event_id,
  project_id,
  request_id,
  trace_id,
  captured_at,
  decision_kind,
  family,
  tool_name,
  grade,
  reason_codes_json,
  observed_followup_linked,
  reason
FROM mako_usefulness_events;

DROP TABLE mako_usefulness_events;
ALTER TABLE mako_usefulness_events_v2 RENAME TO mako_usefulness_events;

CREATE INDEX IF NOT EXISTS idx_mako_usefulness_events_project_captured_at
  ON mako_usefulness_events(project_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_mako_usefulness_events_decision_family
  ON mako_usefulness_events(decision_kind, family, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_mako_usefulness_events_request_id
  ON mako_usefulness_events(request_id);

CREATE TRIGGER IF NOT EXISTS mako_usefulness_events_no_update
BEFORE UPDATE ON mako_usefulness_events
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'mako_usefulness_events rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS mako_usefulness_events_no_delete
BEFORE DELETE ON mako_usefulness_events
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'mako_usefulness_events rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0030_REEF_FOUNDATION_SQL = `-- Reef Engine phase 1: durable fact and active finding substrate.
CREATE TABLE IF NOT EXISTS reef_facts (
  project_id TEXT NOT NULL,
  overlay TEXT NOT NULL CHECK (overlay IN ('indexed', 'working_tree', 'staged', 'preview')),
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject_fingerprint TEXT NOT NULL,
  subject_json TEXT NOT NULL CHECK (json_valid(subject_json)),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  fingerprint TEXT NOT NULL,
  freshness_json TEXT NOT NULL CHECK (json_valid(freshness_json)),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  data_json TEXT CHECK (data_json IS NULL OR json_valid(data_json)),
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, overlay, source, kind, subject_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_reef_facts_project_kind
  ON reef_facts(project_id, overlay, kind);

CREATE INDEX IF NOT EXISTS idx_reef_facts_project_source
  ON reef_facts(project_id, overlay, source);

CREATE INDEX IF NOT EXISTS idx_reef_facts_fingerprint
  ON reef_facts(project_id, fingerprint);

CREATE TABLE IF NOT EXISTS reef_findings (
  project_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  subject_fingerprint TEXT NOT NULL,
  overlay TEXT NOT NULL CHECK (overlay IN ('indexed', 'working_tree', 'staged', 'preview')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'suppressed')),
  file_path TEXT,
  line INTEGER,
  rule_id TEXT,
  documentation_url TEXT,
  suggested_fix_json TEXT CHECK (suggested_fix_json IS NULL OR json_valid(suggested_fix_json)),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_refs_json)),
  freshness_json TEXT NOT NULL CHECK (json_valid(freshness_json)),
  captured_at TEXT NOT NULL,
  message TEXT NOT NULL,
  fact_fingerprints_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(fact_fingerprints_json)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  PRIMARY KEY(project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_reef_findings_project_status
  ON reef_findings(project_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reef_findings_project_file
  ON reef_findings(project_id, file_path, status);

CREATE INDEX IF NOT EXISTS idx_reef_findings_project_source_subject
  ON reef_findings(project_id, source, overlay, subject_fingerprint);

CREATE TABLE IF NOT EXISTS reef_finding_events (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'updated', 'resolved', 'suppressed')),
  prior_status TEXT,
  next_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reef_finding_events_finding
  ON reef_finding_events(project_id, fingerprint, created_at DESC);

CREATE TABLE IF NOT EXISTS reef_rule_descriptors (
  rule_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_namespace TEXT NOT NULL,
  version TEXT NOT NULL,
  descriptor_json TEXT NOT NULL CHECK (json_valid(descriptor_json)),
  enabled_by_default INTEGER NOT NULL CHECK (enabled_by_default IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reef_rule_descriptors_namespace
  ON reef_rule_descriptors(source_namespace, rule_id);
`;

export const PROJECT_MIGRATION_0031_REEF_DIAGNOSTIC_RUNS_SQL = `-- Reef Engine phase 2: durable diagnostic source run status.
CREATE TABLE IF NOT EXISTS reef_diagnostic_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  overlay TEXT NOT NULL CHECK (overlay IN ('indexed', 'working_tree', 'staged', 'preview')),
  status TEXT NOT NULL CHECK (status IN ('unavailable', 'ran_with_error', 'succeeded')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  checked_file_count INTEGER CHECK (checked_file_count IS NULL OR checked_file_count >= 0),
  finding_count INTEGER NOT NULL CHECK (finding_count >= 0),
  persisted_finding_count INTEGER NOT NULL CHECK (persisted_finding_count >= 0),
  command TEXT,
  cwd TEXT,
  config_path TEXT,
  error_text TEXT,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reef_diagnostic_runs_project_source
  ON reef_diagnostic_runs(project_id, source, finished_at DESC);

CREATE INDEX IF NOT EXISTS idx_reef_diagnostic_runs_project_status
  ON reef_diagnostic_runs(project_id, status, finished_at DESC);
`;

// Originally introduced at slot 32, but slot 32 was previously consumed by a different
// migration (0032_project_studio_events) that has since been removed from source. DBs that
// applied the older slot 32 would never run this SQL again, leaving db_review_comments missing.
// Re-registered at slot 37 so existing DBs catch up; CREATE IF NOT EXISTS keeps it idempotent.
export const PROJECT_MIGRATION_0037_DB_REVIEW_COMMENTS_SQL = `-- DB review comments: append-only operator/AI notes attached to database objects.
CREATE TABLE IF NOT EXISTS db_review_comments (
  comment_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  target_fingerprint TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN (
    'database',
    'schema',
    'table',
    'view',
    'column',
    'index',
    'foreign_key',
    'rpc',
    'function',
    'policy',
    'rls_policy',
    'trigger',
    'enum',
    'publication',
    'subscription',
    'replication_slot',
    'replication',
    'unknown'
  )),
  schema_name TEXT,
  object_name TEXT NOT NULL,
  parent_object_name TEXT,
  target_json TEXT NOT NULL CHECK (json_valid(target_json)),
  category TEXT NOT NULL CHECK (category IN ('note', 'review', 'risk', 'decision', 'todo')),
  severity TEXT CHECK (severity IS NULL OR severity IN ('info', 'warning', 'error')),
  comment_text TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_tool_name TEXT NOT NULL,
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json))
);

CREATE INDEX IF NOT EXISTS idx_db_review_comments_project_target
  ON db_review_comments(project_id, target_fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_db_review_comments_project_object
  ON db_review_comments(project_id, object_type, schema_name, object_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_db_review_comments_project_category
  ON db_review_comments(project_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_db_review_comments_project_created_at
  ON db_review_comments(project_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS db_review_comments_no_update
BEFORE UPDATE ON db_review_comments
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'db_review_comments rows are append-only');
END;

CREATE TRIGGER IF NOT EXISTS db_review_comments_no_delete
BEFORE DELETE ON db_review_comments
FOR EACH ROW
BEGIN
  SELECT RAISE(FAIL, 'db_review_comments rows are append-only');
END;
`;

export const PROJECT_MIGRATION_0033_REEF_REVISION_STATE_SQL = `-- Reef Engine v2.4: revisioned analysis state and applied change-set history.
CREATE TABLE IF NOT EXISTS reef_analysis_state (
  project_id TEXT NOT NULL,
  root TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  materialized_revision INTEGER CHECK (materialized_revision IS NULL OR materialized_revision >= 0),
  last_applied_change_set_id TEXT,
  last_applied_at TEXT,
  recomputation_generation INTEGER NOT NULL DEFAULT 0 CHECK (recomputation_generation >= 0),
  watcher_recrawl_count INTEGER NOT NULL DEFAULT 0 CHECK (watcher_recrawl_count >= 0),
  last_recrawl_at TEXT,
  last_recrawl_reason TEXT,
  last_recrawl_warning TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, root)
);

CREATE TABLE IF NOT EXISTS reef_applied_change_sets (
  change_set_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  root TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  new_revision INTEGER NOT NULL CHECK (new_revision >= 0),
  observed_at TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  status TEXT NOT NULL CHECK (status IN ('applied', 'skipped', 'failed')),
  refresh_mode TEXT NOT NULL CHECK (refresh_mode IN ('path_scoped', 'full')),
  fallback_reason TEXT,
  cause_count INTEGER NOT NULL CHECK (cause_count >= 0),
  file_change_count INTEGER NOT NULL CHECK (file_change_count >= 0),
  causes_json TEXT NOT NULL CHECK (json_valid(causes_json)),
  file_changes_json TEXT NOT NULL CHECK (json_valid(file_changes_json)),
  data_json TEXT CHECK (data_json IS NULL OR json_valid(data_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reef_applied_change_sets_project_revision
  ON reef_applied_change_sets(project_id, root, new_revision DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reef_applied_change_sets_unique_revision
  ON reef_applied_change_sets(project_id, root, new_revision);

CREATE INDEX IF NOT EXISTS idx_reef_applied_change_sets_project_applied_at
  ON reef_applied_change_sets(project_id, root, applied_at DESC);
`;

export const PROJECT_MIGRATION_0034_REEF_ARTIFACTS_SQL = `-- Reef Engine v2.4: content-addressed artifact identity and projection tags.
CREATE TABLE IF NOT EXISTS reef_artifacts (
  artifact_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  metadata_json TEXT CHECK (metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(content_hash, artifact_kind, extractor_version)
);

CREATE TABLE IF NOT EXISTS reef_artifact_tags (
  tag_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES reef_artifacts(artifact_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  project_id TEXT NOT NULL,
  root TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT '',
  worktree TEXT NOT NULL DEFAULT '',
  overlay TEXT NOT NULL CHECK (overlay IN ('indexed', 'working_tree', 'staged', 'preview')),
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, root, branch, worktree, overlay, path, artifact_kind, extractor_version)
);

CREATE INDEX IF NOT EXISTS idx_reef_artifacts_content_key
  ON reef_artifacts(content_hash, artifact_kind, extractor_version);

CREATE INDEX IF NOT EXISTS idx_reef_artifact_tags_artifact
  ON reef_artifact_tags(artifact_id);

CREATE INDEX IF NOT EXISTS idx_reef_artifact_tags_projection
  ON reef_artifact_tags(project_id, root, branch, worktree, overlay, path);
`;

export const PROJECT_MIGRATION_0035_REEF_REVISION_UNIQUENESS_SQL = `-- Reef Engine v2.4: enforce one applied change set per revision.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reef_applied_change_sets_unique_revision
  ON reef_applied_change_sets(project_id, root, new_revision);
`;

export const PROJECT_MIGRATION_0036_REEF_ARTIFACT_TAG_REVISIONS_SQL = `-- Reef Engine v2.4: record calculation tag verification/change revisions.
ALTER TABLE reef_artifact_tags ADD COLUMN last_verified_revision INTEGER CHECK (last_verified_revision IS NULL OR last_verified_revision >= 0);
ALTER TABLE reef_artifact_tags ADD COLUMN last_changed_revision INTEGER CHECK (last_changed_revision IS NULL OR last_changed_revision >= 0);
`;
