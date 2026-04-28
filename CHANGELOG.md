# Changelog

All notable changes to agentmako are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/) once
it reaches 1.0.

## [Unreleased]

## [0.2.0] - 2026-04-28

### Added

- Reef Engine v2 runtime with revisioned change sets, daemon lifecycle,
  root writer locking, catch-up cookies, recrawl reporting, calculation
  nodes, structural artifact backdating, and persisted operation logs.
- Durable Reef model-facing tools for agent loops, including
  `reef_agent_status`, `reef_known_issues`, `reef_where_used`,
  `reef_inspect`, `project_open_loops`, `verification_state`,
  `rule_memory`, `evidence_confidence`, and `evidence_conflicts`.
- Warm diagnostic ingestion and freshness tracking for TypeScript,
  ESLint, Oxlint, Biome, lint-file checks, schema-derived findings, and
  programmatic findings.
- Maintained structural/search knowledge for routes, imports, schema
  usage, RPC/table relationships, graph flows, change planning, and
  working-tree overlays.

### Changed

- `schema_usage` now fails closed to exact schema-object matches and
  documents that it reports direct app-code references only; use
  `trace_rpc`, `route_context`, `table_neighborhood`, or `flow_map` for
  RPC-mediated/transitive schema paths.
- `change_plan` now shares the same graph path behavior as `flow_map`
  for file-import-to-RPC-to-table paths and includes regression coverage.
- MCP/tool metadata and Claude guidance now describe the expanded
  Reef-backed workflow and direct-vs-transitive evidence semantics.

### Fixed

- Runtime telemetry smoke tests no longer register temporary projects in
  the real global project registry.
- Database refresh summaries now count indexes, foreign keys, triggers,
  RLS policies, enums, RPCs, and function table references consistently
  with the persisted facts.
- Stale diagnostic open loops are superseded by newer successful runs
  for the same source.

## [0.1.0] - 2026-04-25

Initial public release of `agentmako` under Apache-2.0.

### Added

- `agentmako` CLI with `connect`, `status`, `tool`, `dashboard`,
  `refresh`, `verify`, and `git precommit` commands.
- Stdio MCP server (`agentmako mcp`) exposing the Mako tool surface to
  Claude Code, Cursor, Codex, and other MCP clients.
- Reef Engine: durable local fact, finding, and rule layer backed by
  SQLite, with model-facing views and freshness tracking.
- Code intelligence tools: `context_packet`, `reef_scout`,
  `cross_search`, `live_text_search`, `ast_find_pattern`, `repo_map`,
  symbol/import/route/graph helpers, and composer traces.
- Diagnostic adapters for TypeScript, ESLint, Oxlint, Biome, and staged
  git pre-commit checks.
- Optional Postgres/Supabase awareness: schema snapshots, RLS/RPC
  inspection, and `db_review_comment` for local review notes.
- Local web dashboard (`agentmako dashboard`) and HTTP API/harness
  services.
- `mako-ai-claude-plugin` with Mako-specific Claude Code skills and
  bundled MCP wiring.

[Unreleased]: https://github.com/drhalto/agentmako/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/drhalto/agentmako/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/drhalto/agentmako/releases/tag/v0.1.0
