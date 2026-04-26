# Roadmap Version Initial Testing Phases

These are the phase specs for the Initial Testing hardening roadmap.

Read in this order:

1. [phase-1-finding-acknowledgements.md](./phase-1-finding-acknowledgements.md)
2. [phase-2-mcp-perf-store-lifetime.md](./phase-2-mcp-perf-store-lifetime.md)
3. [phase-3-package-backed-search-and-parsing.md](./phase-3-package-backed-search-and-parsing.md)
4. [phase-4-index-freshness-and-auto-refresh.md](./phase-4-index-freshness-and-auto-refresh.md)
5. [phase-5-deterministic-context-packet-and-hot-retrieval.md](./phase-5-deterministic-context-packet-and-hot-retrieval.md)
6. [phase-6-parser-and-resolver-hardening.md](./phase-6-parser-and-resolver-hardening.md)

Current state:

- `Phase 1` — shipped (finding acknowledgement storage, tools, and
  consumer filtering).
- `Phase 2` — shipped (MCP stdio project-store lifetime and WAL
  checkpoint hardening).
- `Phase 3` — shipped (package-backed glob, live text search, Markdown
  knowledge parser foundation, TS / JS structural indexing, and
  Postgres parser experiment).
- `Phase 4` — shipped (code-index freshness metadata, MCP index refresh,
  and debounced MCP auto-refresh on file edits).
- `Phase 5` — shipped. Added deterministic `context_packet`, provider
  pipeline, hot retrieval hints, ranking, freshness enrichment,
  read-only `tool_batch`, triggered risks, scoped instructions, richer
  harness handoff, and path-scoped refresh foundation.
- `Phase 6` — shipped. Replaced more custom parser/resolver mechanics
  with package-backed implementations: Supabase generated types now use
  the TypeScript AST, repo SQL DDL object extraction uses
  `pgsql-parser`, schema usage prefers structured TS call detection,
  import resolution uses TypeScript's module resolver, and harness glob,
  diff, SSE, route, and concurrency helpers use focused packages.

Phases are added as deployment surfaces new gaps. The sequence stays
honest — if Phase N turns out to be wrong, a correction phase is added
rather than amending an earlier doc.
