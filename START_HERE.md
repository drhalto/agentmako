# Start Here

agentmako is a local-first project intelligence engine for coding agents.
Use it when an agent needs fast, evidence-backed context about a
codebase, database schema, diagnostics, prior tool runs, and Reef Engine
facts.

## Quick Links

| What | Where |
| --- | --- |
| Product overview | [README.md](./README.md) |
| Tool overview | [TOOLS.md](./TOOLS.md) |
| CLI package docs | [apps/cli/README.md](./apps/cli/README.md) |
| Agent guidance to paste into CLAUDE.md / AGENTS.md | [AGENTS.md](./AGENTS.md) |
| Claude Code plugin | [mako-ai-claude-plugin/README.md](./mako-ai-claude-plugin/README.md) |
| Contributing | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Security policy | [SECURITY.md](./SECURITY.md) |
| Changelog | [CHANGELOG.md](./CHANGELOG.md) |

## Current Status

- `main` contains the CLI, API, MCP server, web dashboard, harness
  packages, and Reef Engine.
- The optional Studio/Tauri/MSIX desktop work is not part of the main
  release surface.
- Released under Apache-2.0 as `agentmako`. See
  [CHANGELOG.md](./CHANGELOG.md) for the version history.

## First Local Run

```bash
corepack pnpm install
corepack pnpm run build
node apps/cli/dist/index.js connect . --no-db
node apps/cli/dist/index.js tool list
```

To launch the local dashboard:

```bash
node apps/cli/dist/index.js dashboard .
```

To launch the stdio MCP server from an MCP client:

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

## Verification

```bash
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm run test:smoke:reef-tooling
corepack pnpm run test:smoke:reef-model-facing-views
```

Run `corepack pnpm test` for the full smoke suite.
