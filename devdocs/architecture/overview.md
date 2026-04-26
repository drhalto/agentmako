# Architecture Overview

This file describes the current `mako-ai` architecture with the shipped Roadmap 1 foundation and the current Roadmap 2 planning docs living under `devdocs/`.

For phase order and scope, use [../roadmap/version-2/roadmap.md](../roadmap/version-2/roadmap.md).

## Current Repo Shape

```text
apps/
  cli/
  web/
packages/
  config/
  contracts/
  sdk/
  store/
  tools/
services/
  api/
  engine/
  indexer/
  worker/      # deferred groundwork
storage/
  migrations/
extensions/
```

`packages/tools` is not transport code. It is the invariant business-logic layer that MCP, HTTP, and CLI adapt over.

## Boundary Model

- `apps/` are user-facing clients
- `packages/contracts` defines shared types and schemas
- `packages/store` owns SQLite bootstrap and persistence access
- `services/indexer` owns deterministic extraction
- `services/engine` owns synthesis over indexed facts
- `services/api` owns transport only
- `packages/tools` owns agent-facing typed tool functions
- `services/worker` is deferred until there is a concrete need
- `extensions/` are future seams, not core assumptions

## Current Request Flow

The current request flow is:

1. agent, CLI, or HTTP client calls a named tool, the `ask` router, or the legacy answer route
2. `services/api` or `apps/cli` forwards into `packages/tools`
3. tool functions resolve the target project and use store/indexer/engine seams as needed
4. transports return structured JSON with explicit output schemas
5. answer-backed tools persist answer traces to `project.db`

The existing high-level answer kinds remain:

- `route_trace`
- `schema_usage`
- `file_health`
- `auth_path`
- `free_form`

This keeps business logic out of transports and lets the same capability surface through:

- MCP
- thin HTTP tool routes
- CLI commands

The current low-friction router is:

- `ask`

## Transport Architecture

Current transport:

- local HTTP server
- Streamable HTTP MCP endpoint on the same long-lived server process
- thin web client over that server
- CLI commands for operator workflows

Transport rules:

- bind to `127.0.0.1`
- validate `Origin` on MCP requests
- use `createMcpExpressApp()` so localhost host-header validation is enabled by default
- reserve stdout for protocol traffic when MCP is active
- use output schemas on every tool
- mark non-destructive tools as read-only

## Ask Router Boundary

The Phase 4 ask router extends the existing architecture without reshaping it.

It remains:

- thin
- deterministic first
- additive to the shipped tool layer
- explicit about which named tool it selected
- conservative when falling back to `free_form`

Ask router rule:

- `packages/tools/src/ask/` owns routing, extraction, and selected-tool orchestration
- the named tool modules still own the actual answers
- transports stay thin over the same shared registry pattern
- `ask` does not become a second synthesis engine

## Architectural Priorities

The architecture is intentionally built in this order:

1. store
2. indexer
3. engine
4. API
5. CLI and web
6. tool layer and agent transport
7. additive DB schema tools over the shipped tool surface
8. thin `ask` routing over the shipped tool families
9. public lock and release polish over the shipped tool surface

That order matters. The product only expands once the evidence-producing core is stable.
