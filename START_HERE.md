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
| Reef Engine docs | [devdocs/roadmap/reef-engine/README.md](./devdocs/roadmap/reef-engine/README.md) |
| Open source release guide | [docs/open-source-release.md](./docs/open-source-release.md) |
| Contributing | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Changelog | [CHANGELOG.md](./CHANGELOG.md) |

## Current Status

- `main` contains the CLI, API, MCP server, web dashboard, harness
  packages, and Reef Engine.
- The optional Studio/Tauri/MSIX desktop work is not part of the main
  release surface.
- The repository is being prepared for a clean Apache-2.0 public release
  as `agentmako`, with no private development history.

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
