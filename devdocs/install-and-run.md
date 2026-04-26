# Install And Run

This is the canonical install-and-run path for the shipped local-first MVP.

It is optimized for:

- a clean checkout
- one local machine
- the shipped MCP, HTTP, CLI, and thin web surfaces

## Prerequisites

- Node.js 22+
- Corepack enabled
- `pnpm` via Corepack

## 1. Install Dependencies

```bash
corepack pnpm install
```

## 2. Build The Workspace

```bash
corepack pnpm run build
```

This produces the built CLI entrypoint at `apps/cli/dist/index.js` and the static web assets used by the thin web client.

## 3. Start The Local Server

```bash
node apps/cli/dist/index.js serve --port 3017 --host 127.0.0.1
```

Notes:

- the default local host is `127.0.0.1`
- the default port is `3017`
- MCP is served from the same long-lived process at `http://127.0.0.1:3017/mcp`
- the server is local-only by design

## 4. Attach And Index A Project

The intended cold-start path is the top-level `connect` command. From the repo you want to inspect:

```bash
node apps/cli/dist/index.js connect .
```

When the CLI is published and installed via `npm install -g agentmako` (or run via `npx agentmako`), the same flow becomes:

```bash
agentmako connect
```

`connect` attaches the project, indexes it, optionally walks you through a secure live-database hookup (OS keychain storage by default, `--db-env <VAR>` for non-interactive / CI use), persists a default schema scope for later verify/refresh, and prints a final status block. `--no-db` skips the live DB step.

After connecting, day-to-day commands are:

```bash
node apps/cli/dist/index.js status .
node apps/cli/dist/index.js verify .
node apps/cli/dist/index.js refresh .
```

These are top-level aliases that delegate to the lower-level `project` substrate while respecting the saved schema scope. Advanced users can still call the substrate directly: `project attach`, `project index`, `project db bind`, `project db test`, `project db verify`, `project db refresh`.

The initial connect creates or reuses the local `mako-ai` state, indexes the repo, and returns a `projectId`. Use that returned `projectId` or the project's canonical absolute path for HTTP and MCP payloads. Do not send `"projectRef":"."` over HTTP or MCP, because the server resolves relative paths from its own working directory, not the caller's shell.

## 5. Call The Shipped Tool Surface

CLI examples:

```bash
node apps/cli/dist/index.js --json tool list
node apps/cli/dist/index.js --json tool call . ask "{\"question\":\"where is /api/v1/projects handled\"}"
node apps/cli/dist/index.js --json tool call . route_trace "{\"route\":\"/api/v1/projects\"}"
```

HTTP examples:

```bash
curl http://127.0.0.1:3017/api/v1/tools
curl -X POST http://127.0.0.1:3017/api/v1/tools/ask -H "content-type: application/json" -d "{\"projectId\":\"<project-id-from-project-attach>\",\"question\":\"what depends on services/api/src/server.ts\"}"
```

`/api/v1/answers` is still supported for the original answer flows, but the public MVP surface is `ask` plus the named tools.

## 6. Connect An Agent To MCP

Two transports ship. Pick based on how many agent windows you run at once.

### Option A — stdio (recommended for single-agent use)

The client spawns `agentmako mcp` as a child process; when the client
closes, the server exits. No separate `agentmako serve` needed, no port
to manage. Same tool surface as HTTP, minus the web dashboard.

Claude Code `.mcp.json`:

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

VS Code `.vscode/mcp.json`:

```json
{
  "servers": {
    "mako-ai": {
      "command": "agentmako",
      "args": ["mcp"]
    }
  }
}
```

Notes on stdio:

- stdout is the JSON-RPC channel. Logs go to stderr; `MAKO_LOG_LEVEL`
  still controls verbosity.
- every agent window spawns its own mako process. Shared state
  (`project.db`, telemetry, answer traces) is file-backed, so multiple
  concurrent agents see a consistent view without coordination.
- the stdio server reuses the same tool registry as HTTP — every tool
  you can call over `/mcp` is also callable over stdio.

### Option B — HTTP (for multiple concurrent agents + web dashboard)

Run one shared `agentmako serve` in a terminal (or as a system service).
Agents connect to `http://127.0.0.1:3017/mcp`.

Claude Code `.mcp.json`:

```json
{
  "mcpServers": {
    "mako-ai": {
      "type": "http",
      "url": "http://127.0.0.1:3017/mcp"
    }
  }
}
```

VS Code `.vscode/mcp.json`:

```json
{
  "servers": {
    "mako-ai": {
      "type": "http",
      "url": "http://127.0.0.1:3017/mcp"
    }
  }
}
```

Notes on HTTP:

- keep the server URL on `127.0.0.1`
- no extra auth headers are required for the local default flow
- the agent config points at the same shipped `/mcp` contract verified
  by the smoke harness
- the web dashboard (`agentmako dashboard`) needs the HTTP server running

## 7. Optional Database Schema Tools

The core repo-intelligence flow works without any live database connection.

If you want the shipped read-only DB schema tools as well:

- enable them on the server with `MAKO_DB_TOOLS_ENABLED=1`
- bind the project to a live DB URL with `mako project db bind`

Bash example:

```bash
export MAKO_DB_TOOLS_ENABLED=1
export SUPABASE_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
node apps/cli/dist/index.js serve --port 3017 --host 127.0.0.1
mako project db bind . --strategy env_var_ref --ref SUPABASE_DB_URL
```

PowerShell example:

```powershell
$env:MAKO_DB_TOOLS_ENABLED = "1"
$env:SUPABASE_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
node apps/cli/dist/index.js serve --port 3017 --host 127.0.0.1
mako project db bind . --strategy env_var_ref --ref SUPABASE_DB_URL
```

The agent config does not change. DB access is project-scoped now: the server
resolves the current project's live DB binding instead of reading a process-global
database URL.

## 8. Optional Thin Web Client

With the API server still running, start the web client in a second terminal:

```bash
node apps/web/scripts/serve.mjs 4174
```

Then open `http://127.0.0.1:4174` and point it at `http://127.0.0.1:3017`.

## 9. Run Verification

Minimum verification for this MVP:

```bash
corepack pnpm typecheck
corepack pnpm run build
corepack pnpm test
```

Focused smoke-only verification:

```bash
corepack pnpm run test:smoke
corepack pnpm run test:smoke:web
```

## 10. Next Docs

- [Tool registry](../TOOLS.md)
- [Master plan](./master-plan.md)
- [Roadmap Version 2](./roadmap/version-2/roadmap.md)
- [Phase 1 implementation brief](./roadmap/version-2/phases/phase-1-project-contract-and-attach-ux.md)
- [START_HERE.md](../START_HERE.md)
