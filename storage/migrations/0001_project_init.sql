CREATE TABLE IF NOT EXISTS schema_meta (
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
