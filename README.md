<p align="center">
  <img src="apps/web/public/agentmako.png" alt="agentmako logo" width="180" />
</p>

# agentmako

[![npm version](https://img.shields.io/npm/v/agentmako.svg?logo=npm)](https://www.npmjs.com/package/agentmako)
[![Smoke Tests](https://github.com/drhalto/agentmako/actions/workflows/smoke.yml/badge.svg)](https://github.com/drhalto/agentmako/actions/workflows/smoke.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![agentmako MCP server](https://glama.ai/mcp/servers/drhalto/agentmako/badges/score.svg)](https://glama.ai/mcp/servers/drhalto/agentmako)

agentmako is a local-first codebase intelligence engine for AI coding
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
- Queryable workflow orientation: `mako_help`
- Deterministic context packets: `context_packet`, `reef_scout`
- `_hints` on tool results so agents get result-specific next steps
- Central MCP annotations so clients can distinguish safe reads, live reads,
  and local-state mutations
- Code search and structure tools: `cross_search`, `live_text_search`,
  `ast_find_pattern`, `repo_map`
- [Reef Engine](./docs/reef-engine.md) facts and findings across indexed,
  working-tree, and staged state
- Reef convention extraction for auth guards, runtime boundaries, generated
  paths, route patterns, and schema usage
- TypeScript, ESLint, Oxlint, Biome, and staged git diagnostic ingestion
- Hot-reloaded `.mako/rules` YAML rule packs, including primitive
  cross-file helper-bypass rules via `canonicalHelper`
- Optional Postgres/Supabase schema snapshots and read-only DB inspection
- Local DB review comments for notes on tables, RLS, triggers,
  publications, subscriptions, and replication
- Recall, acknowledgements, and agent feedback for repeated review work

Everything important runs locally. No hosted service is required.

## Install

Requires **Node.js 20 or newer**.

```bash
npm install -g agentmako
```

Confirm the CLI is available:

```bash
agentmako --version
agentmako doctor
```

You should see green checks for configuration and the local API service.

> Prefer to build from source (e.g. to contribute)?  See
> [Develop From Source](#develop-from-source) at the bottom of this
> file.

## Happy Path Setup

### 1. Attach your real project

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

### 2. Confirm Mako sees the project

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

`reef_scout` classifies broad requests before ranking. App-flow questions favor
file, route, and finding evidence; RLS/schema questions favor database facts
and review comments. To inspect project rules of thumb directly:

```bash
agentmako --json tool call . project_conventions "{}"
```

### 3. Configure your MCP client

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
- `reef_scout` when you want intent-ranked project facts/findings/history
- `file_preflight` before editing one risky file and you need findings,
  diagnostic freshness, conventions, recent runs, and ack history together
- `reef_diff_impact` mid-edit or before review when you need changed-file
  callers, caller findings, and convention risks in one packet
- `extract_rule_template` after a fix lands and you want a reviewable
  `.mako/rules` YAML draft for the same bug shape next time
- `project_conventions` when you need discovered auth, runtime, route,
  generated-file, or schema-usage conventions
- `ask` when you have a natural-language repo question

### 4. Optional: use an agent plugin

Plain MCP works anywhere, but the bundled plugins add Mako-specific skills and
include the same `agentmako mcp` wiring.

Prerequisites:

- Claude Code installed
- Node.js 20+ on `PATH` (the plugin runs `npx -y agentmako mcp`, which fetches
  the published `agentmako` package automatically — no separate global install
  required)
- Your target project already attached with `agentmako connect`

Claude Code stable path:

```powershell
claude plugin validate .\mako-ai-claude-plugin
claude --plugin-dir .\mako-ai-claude-plugin
```

New generated plugin layouts:

```bash
claude plugin validate ./plugins/claude-code
codex marketplace add ./plugins
ln -s "$(pwd)/plugins/cursor" ~/.cursor/plugins/local/mako-ai
gemini extensions install ./plugins/gemini
```

Inside the agent, confirm the `mako-ai` MCP server is connected.

The plugin exposes these skills:

- `/mako-ai:mako-guide`
- `/mako-ai:mako-discovery`
- `/mako-ai:mako-trace`
- `/mako-ai:mako-neighborhoods`
- `/mako-ai:mako-graph`
- `/mako-ai:mako-database`
- `/mako-ai:mako-code-intel`
- `/mako-ai:mako-workflow`

Use the plugin when you want Claude Code to load Mako-specific guidance for
which tools to call and how to interpret their results.

### 5. Optional: launch the dashboard

From your target project:

```bash
agentmako dashboard .
```

This starts the local API, harness service, and web dashboard.

### 6. Optional: add Supabase/Postgres awareness

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

## Develop From Source

If you want to hack on Mako itself, clone and build instead of installing
from npm.

Prerequisites:

- Node.js 20 or newer
- Git
- Corepack (`corepack enable`, included with modern Node.js)

```bash
git clone https://github.com/drhalto/agentmako.git
cd agentmako
corepack pnpm install
corepack pnpm run build
npm link ./apps/cli
```

`npm link ./apps/cli` makes the source-built CLI available as
`agentmako` on your `PATH`, replacing any global npm install. Re-run
`corepack pnpm run build` after pulling changes.

To go back to the published version: `npm install -g agentmako`.

### Development Checks

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
  cli/              agentmako CLI and MCP entrypoint (the published package)
  web/              local dashboard
packages/
  contracts/        public TypeScript contracts and tool schemas
  config/           shared config helpers
  logger/           shared logger
  sdk/              programmatic SDK
  store/            SQLite stores, migrations, and query helpers
  tools/            shared tool implementations
  harness-core/     local agent harness runtime
  harness-tools/    action tools available to the harness
  harness-contracts/ harness contracts and provider catalog
services/
  api/              local API and MCP transports
  engine/           Reef Engine fact/finding pipeline
  harness/          local harness HTTP service
  indexer/          repo and schema indexing logic
  worker/           background worker
extensions/         provider and integration packages
storage/            schema migrations, models, queries
test/smoke/         smoke coverage
mako-ai-claude-plugin/ Claude Code plugin with Mako skills
```

## More Docs

- [Tool overview](./TOOLS.md)
- [CLI docs](./apps/cli/README.md)
- [Reef Engine](./docs/reef-engine.md)
- [Tool annotations](./docs/tool-annotations.md)
- [Write tool convention](./docs/write-tool-convention.md)
- [Claude Code plugin](./mako-ai-claude-plugin/README.md)
- [Agent guidance to paste into CLAUDE.md / AGENTS.md](./AGENTS.md)
- [Contributing](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

## License

Apache-2.0. See [LICENSE](./LICENSE).
