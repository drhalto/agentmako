CREATE TABLE IF NOT EXISTS schema_meta (
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
