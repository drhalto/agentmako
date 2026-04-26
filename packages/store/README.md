# @mako-ai/store

SQLite persistence for the local-first Mako runtime.

## Operational Policy

All app-owned SQLite access must go through the centralized store bootstrap.

Current bootstrap defaults:

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`
- `PRAGMA busy_timeout = 5000`
- `PRAGMA synchronous = NORMAL`

The canonical policy lives in [handoff/v2/sqlite-operational-strategy.md](../../handoff/v2/sqlite-operational-strategy.md).
