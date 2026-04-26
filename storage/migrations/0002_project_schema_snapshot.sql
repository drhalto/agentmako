CREATE TABLE IF NOT EXISTS schema_snapshots (
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
    CHECK (source_kind IN ('sql_migration', 'generated_types', 'prisma_schema', 'drizzle_schema')),
  source_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  last_modified_at TEXT,
  size_bytes INTEGER,
  UNIQUE (snapshot_slot, source_path)
);

CREATE INDEX IF NOT EXISTS idx_schema_snapshot_sources_slot ON schema_snapshot_sources(snapshot_slot);
