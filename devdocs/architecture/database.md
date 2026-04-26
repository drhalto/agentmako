# Database Design

`mako-ai` uses two app-owned SQLite databases in the local-first architecture.

This is a product boundary, not just an implementation detail.

## Database Roles

### `global.db`

Purpose:

- settings
- attached project registry
- provider configuration
- credential references

This is user-scoped state. It exists even when no project is currently attached.

Initial schema:

- [storage/migrations/0001_global_init.sql](../../storage/migrations/0001_global_init.sql) (canonical runtime SQL is inlined in [packages/store/src/migration-sql.ts](../../packages/store/src/migration-sql.ts); see that file's header for why)

### `project.db`

Purpose:

- project profile cache
- index runs
- files and chunks
- symbols and import edges
- routes
- schema objects and schema usages
- graph nodes and graph edges
- findings
- answer traces and evidence blocks

This is project-scoped state. It must be safe to delete and rebuild.

Initial schema:

- [storage/migrations/0001_project_init.sql](../../storage/migrations/0001_project_init.sql), [storage/migrations/0002_project_schema_snapshot.sql](../../storage/migrations/0002_project_schema_snapshot.sql), [storage/migrations/0003_project_db_binding_state.sql](../../storage/migrations/0003_project_db_binding_state.sql) (canonical runtime SQL is inlined in [packages/store/src/migration-sql.ts](../../packages/store/src/migration-sql.ts); see that file's header for why)

## Operational Policy

The SQLite policy is mandatory and enforced through `packages/store`.

Required defaults:

- WAL mode
- `foreign_keys=ON`
- `busy_timeout=5000`
- `synchronous=NORMAL`

The policy is enforced in code by the centralized bootstrap:

- [../../packages/store/src/sqlite.ts](../../packages/store/src/sqlite.ts)

## Core Table Groups

### `global.db`

- `settings`
- `providers`
- `credentials`
- `projects`
- `project_aliases`

### `project.db`

- `project_profile`
- `index_runs`
- `files`
- `chunks` + `chunks_fts`
- `symbols`
- `import_edges`
- `routes`
- `schema_objects`
- `schema_usages`
- `graph_nodes`
- `graph_edges`
- `findings`
- `answer_traces`
- `evidence_blocks`

## Design Rules

- `global.db` never stores project analysis payloads
- `project.db` never stores provider secrets or user-global settings
- all SQLite access goes through the centralized store bootstrap
- store boundaries are enforced in code, not through ad hoc cross-database tricks
- relational storage is the default; vector or ML layers are optional later additions

## External Database Position

External application databases are not app-owned state.

They are treated as:

- source systems for read-only inspection
- optional later tool inputs
- never the primary location for `mako-ai` product state

That means:

- read-only schema tools can be added later
- live sync and write-side connectors stay deferred
- the core product still works without a live database connection

## Relationship To The Tool Roadmap

The current product stores enough indexed state to support:

- the existing high-level answer flows
- the first import and symbol tools

Later read-only DB tools should stay additive:

- configuration-driven
- safe when disconnected
- structured like the rest of the tool surface

Phase 3 uses the existing local-first architecture as-is:

- `global.db` and `project.db` remain app-owned state
- external Postgres/Supabase databases are optional read-only inspection targets
- DB tools must not turn external databases into required runtime dependencies
- live DB metadata is not cached in SQLite during Phase 3
- repo-derived schema understanding and live DB introspection stay separate

The storage design should support those additions without changing the core local-first model.
