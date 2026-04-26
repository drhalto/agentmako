# apps/web

Thin local web client over the existing HTTP API.

Current scope:

- health and API connection status
- attached project list
- attach and index actions
- selected project status
- query form
- answer and evidence rendering

Run locally:

- `corepack pnpm build`
- `node apps/web/scripts/serve.mjs`

Boundary:

- local API only
- no direct database access
- no indexing logic
- no answer orchestration
- no provider-specific behavior
