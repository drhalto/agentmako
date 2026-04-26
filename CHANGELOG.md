# Changelog

All notable changes to agentmako are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/) once
it reaches 1.0.

## [Unreleased]

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

[Unreleased]: https://github.com/drhalto/agentmako/compare/beta-v0.1.0...HEAD
[0.1.0]: https://github.com/drhalto/agentmako/releases/tag/beta-v0.1.0
