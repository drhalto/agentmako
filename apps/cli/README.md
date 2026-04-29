# agentmako

[![npm version](https://img.shields.io/npm/v/agentmako.svg?logo=npm)](https://www.npmjs.com/package/agentmako)
[![Glama](https://img.shields.io/badge/dynamic/json?url=https://glama.ai/mcp/servers/agentmako/badge&query=$.grade&label=glama)](https://glama.ai/mcp/servers/agentmako)

Agentmako is a local project intelligence CLI and MCP server for codebases and databases, with repo-aware indexing, schema snapshots, and secure live database connectivity.

## Install

One-off run via `npx` (no global install needed):

```bash
npx agentmako connect
```

Or install globally:

```bash
npm install -g agentmako
agentmako connect
```

## Get started

From inside a project you want to attach:

```bash
agentmako connect
```

`connect` walks you through:

1. Attaching the project and indexing its code and schema sources
2. Optionally connecting a live database — interactive mode captures the URL with hidden input and stores it in your OS keychain
3. Testing the connection and auto-discovering all non-system schemas
4. Refreshing the local schema snapshot from the live database
5. Printing a final status block with next steps

## Day-to-day commands

```bash
agentmako status     # project state, schema snapshot, db binding
agentmako verify     # compare local snapshot against the live db (uses saved scope)
agentmako refresh    # refresh the local snapshot from the live db (uses saved scope)
```

Advanced substrate commands are still available under `agentmako project …` for scripting and debugging.

## Flags worth knowing

- `--no-db` — skip the live database step
- `--db-env <VAR>` — non-interactive / CI; reads the DB URL from env var, binds as `env_var_ref`
- `--keychain-from-env <VAR>` — non-interactive / CI; reads the DB URL from env var, stores in OS keychain
- `--schemas a,b` — override auto-discovered schema scope
- `--yes` — skip interactive prompts
- `--json` — machine-readable output on every command

## More

The `agentmako` CLI is one surface of the mako-ai project. For the full architecture, roadmap, and contributor docs, see the [main repository](https://github.com/dustin/mako-ai).
