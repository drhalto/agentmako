# Installing agentmako (for AI agents and one-click installers)

agentmako is a local-first codebase intelligence MCP server distributed as
the npm package [`agentmako`](https://www.npmjs.com/package/agentmako).
Tools return structured context packets, code/schema search results,
diagnostics, and findings instead of forcing the agent to grep-walk a repo.

## Add to your MCP client config

Add this entry to your MCP client's config (Claude Desktop, Claude Code,
Cline, Cursor, Continue, etc.). Every client uses the same shape:

```json
{
  "mcpServers": {
    "agentmako": {
      "command": "npx",
      "args": ["-y", "agentmako", "mcp"]
    }
  }
}
```

Requirements:

- Node.js 20+ on `PATH` (npx will fetch and cache `agentmako` automatically;
  no separate `npm install -g` is needed).

## One-time project attach

Before tools return useful results for a given repo, attach it once:

```bash
npx agentmako connect /absolute/path/to/your/project --no-db
```

This indexes the repo into a local SQLite store at
`<projectRoot>/.mako-ai/project.db`. Use `--no-db` for the initial run; you
can add Postgres/Supabase awareness later with `npx agentmako connect .`
(interactive) if needed. Project DB secrets are stored in the OS keychain,
not in plaintext.

## What you get

Once attached and the MCP server is connected, an agent can call:

- `tool_search` — find the right Mako tool for an intent
- `context_packet` — starting context for a coding task
- `reef_scout` — ranked project facts, findings, and history
- `ask` — natural-language repo question answering
- `cross_search`, `live_text_search`, `ast_find_pattern`, `repo_map` — code
  structure and search
- TypeScript / ESLint / Oxlint / Biome / staged-git diagnostics
- Optional Postgres/Supabase schema snapshots and read-only DB inspection

## Claude Code specifically

If the client is Claude Code, prefer installing the published plugin
`mako-ai` from the Claude Code plugin marketplace — it bundles the same
MCP wiring above plus skills that teach Claude *when* to use which Mako
tool.

## Verification

After config + attach, the agent should be able to run `tool_search`
without errors and see Mako's tool catalog. If `tools/list` returns the
Mako toolset over MCP, install is complete.

## Links

- npm: https://www.npmjs.com/package/agentmako
- GitHub: https://github.com/drhalto/agentmako
- Glama: https://glama.ai/mcp/servers/drhalto/agentmako
- License: Apache-2.0
