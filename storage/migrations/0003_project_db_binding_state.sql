CREATE TABLE IF NOT EXISTS db_binding_state (
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
