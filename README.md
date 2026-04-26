# Mako AI

Mako AI is a local-first codebase intelligence engine for AI coding
tools.

It gives agents like Codex, Claude Code, Cursor, and local harnesses a
typed MCP toolset for understanding a project before they edit it. Mako
indexes your repo, builds local SQLite-backed facts, tracks diagnostics
and review notes, and returns structured context packets instead of
making the agent rediscover everything with raw grep.

Mako is built for the first mile of coding-agent work:

> What files matter? What routes, symbols, tables, diagnostics, and prior
> findings are relevant? What should the agent read next?

## What You Get

- MCP server for coding agents: `agentmako mcp`
- Local dashboard: `agentmako dashboard`
- Deterministic context packets: `context_packet`, `reef_scout`
- Code search and structure tools: `cross_search`, `live_text_search`,
  `ast_find_pattern`, `repo_map`
- Reef Engine facts and findings across indexed, working-tree, and staged
  state
- TypeScript, ESLint, Oxlint, Biome, and staged git diagnostic ingestion
- Optional Postgres/Supabase schema snapshots and read-only DB inspection
- Local DB review comments for notes on tables, RLS, triggers,
  publications, subscriptions, and replication
- Recall, acknowledgements, and agent feedback for repeated review work

Everything important runs locally. No hosted Mako service is required.

## Happy Path Setup

This is the recommended setup while Mako is pre-1.0 and being run from
source.

### 1. Install prerequisites

Install:

- Node.js 20 or newer
- Git
- Corepack, included with modern Node.js

Enable Corepack if needed:

```bash
corepack enable
```

### 2. Clone and build Mako

```bash
git clone <your-mako-repo-url> mako-ai
cd mako-ai
corepack pnpm install
corepack pnpm run build
npm link ./apps/cli
```

Confirm the CLI is available:

```bash
agentmako --help
```

`npm link ./apps/cli` makes the local source-built CLI available as
`agentmako`. Re-run `corepack pnpm run build` after pulling changes.

### 3. Attach your real project

Go to the project you want Mako to understand:

```bash
cd C:/path/to/your/project
```

Attach and index it:

```bash
agentmako connect . --no-db
```

Use `--no-db` for the first run. It gets the code intelligence path
working before adding database scope.

### 4. Confirm Mako sees the project

```bash
agentmako status .
agentmako tool list
```

Run a real scout query:

```bash
agentmako --json tool call . reef_scout "{\"query\":\"where should I inspect auth route state?\"}"
```

If that returns ranked candidates, facts, or findings, the core setup is
working.

### 5. Configure your MCP client

Add this to your MCP client config:

```json
{
  "mcpServers": {
    "mako-ai": {
      "command": "agentmako",
      "args": ["mcp"]
    }
  }
}
```

Restart the MCP client and confirm the `mako-ai` server starts.

In the agent, start with one of these tools:

- `tool_search` when you need to find the right Mako tool
- `context_packet` when you have a coding task and want starting context
- `reef_scout` when you want ranked project facts/findings/history
- `ask` when you have a natural-language repo question

### 6. Optional: launch the dashboard

From your target project:

```bash
agentmako dashboard .
```

This starts the local API, harness service, and web dashboard.

### 7. Optional: add Supabase/Postgres awareness

Mako works without a database. Add this only after code intelligence is
working.

For a one-time interactive setup:

```bash
agentmako connect .
```

For CI or scripted setup using an environment variable:

```bash
set DATABASE_URL=postgres://...
agentmako connect . --db-env DATABASE_URL --yes
```

Then refresh and verify the local schema snapshot:

```bash
agentmako refresh .
agentmako verify .
```

Interactive mode stores database secrets in your OS keychain by default.
Project config stores references, not plaintext DB URLs.

## Normal Daily Loop

From the target project:

```bash
agentmako status .
agentmako dashboard .
agentmako --json tool call . context_packet "{\"query\":\"fix the broken auth callback route\"}"
```

For staged review checks:

```bash
agentmako git precommit . --json
```

For database review notes:

```bash
agentmako --json tool call . db_review_comment "{\"objectType\":\"replication\",\"objectName\":\"supabase_database_replication\",\"category\":\"review\",\"comment\":\"Check publication coverage before relying on realtime events.\",\"tags\":[\"supabase\",\"replication\"]}"
```

## When Published To npm

After `agentmako` is published, replace the source checkout and
`npm link ./apps/cli` step with:

```bash
npm install -g agentmako
```

All commands and the MCP config stay the same.

## Development Checks

From the Mako repo:

```bash
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm run test:smoke:reef-tooling
corepack pnpm run test:smoke:reef-model-facing-views
```

Full verification:

```bash
corepack pnpm test
```

## Repository Layout

```text
apps/
  cli/        agentmako CLI and MCP entrypoint
  web/        local dashboard
packages/
  contracts/  public TypeScript contracts and tool schemas
  store/      SQLite stores, migrations, and query helpers
  tools/      shared tool implementations
  harness-*   local agent harness contracts/runtime/action tools
services/
  api/        local API and MCP transports
  harness/    local harness HTTP service
  indexer/    repo and schema indexing logic
extensions/   provider and integration packages
test/smoke/   smoke coverage
devdocs/      roadmap and design records
```

## More Docs

- [Tool overview](./TOOLS.md)
- [CLI docs](./apps/cli/README.md)
- [Reef Engine](./devdocs/roadmap/reef-engine/README.md)
- [Contributing](./CONTRIBUTING.md)
- [Open source release guide](./docs/open-source-release.md)

## License

Apache-2.0. See [LICENSE](./LICENSE).
