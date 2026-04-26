# Contributing

Mako is a TypeScript monorepo. The public contract is the CLI, MCP tool
surface, HTTP API, dashboard, contracts package, and local SQLite stores.

## Local Setup

```bash
corepack pnpm install
corepack pnpm run build
```

For day-to-day local usage:

```bash
node apps/cli/dist/index.js connect . --no-db
node apps/cli/dist/index.js tool list
```

## Change Discipline

- Keep changes scoped to the requested behavior.
- Prefer existing contracts, store helpers, and tool patterns over new
  abstractions.
- Add or update focused smoke coverage for tool contracts, migrations,
  or user-visible behavior.
- Do not commit local state, generated bundles, SQLite DB files, logs,
  `.env` files, provider keys, database URLs, or agent worktrees.
- Keep live database access read-only unless a tool is explicitly
  designed and documented as a mutation against Mako's local store.

## Verification

Run these before submitting changes:

```bash
corepack pnpm run typecheck
corepack pnpm run build
```

For Reef/MCP/tool changes, also run the focused smoke that covers the
surface you touched. Common examples:

```bash
corepack pnpm run test:smoke:reef-tooling
corepack pnpm run test:smoke:reef-model-facing-views
node --import tsx test/smoke/mcp-tool-metadata.ts
node --import tsx test/smoke/mcp-server-instructions.ts
```

Full verification:

```bash
corepack pnpm test
```

## Security And Secrets

Mako is local-first and often runs near source code, databases, and
provider credentials. Treat secret handling as part of correctness:

- never commit `.env` or local runtime DB files;
- prefer keychain/env-var references over plaintext storage;
- do not paste live provider keys or database URLs into issues, tests,
  docs, telemetry fixtures, or review comments;
- keep examples fake and clearly marked as fake.
