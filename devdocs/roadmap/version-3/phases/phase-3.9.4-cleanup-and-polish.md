# Phase 3.9.4 Cleanup And Polish

Status: `Complete` (shipped 2026-04-18)

This file is the canonical ship doc for Roadmap 3 Phase 3.9.4. It is a narrow cleanup/polish follow-up after 3.9.3, not a new capability phase.

Use [../roadmap.md](../roadmap.md) for roadmap status and phase order. Use [../handoff.md](../handoff.md) for the final Roadmap 3 handoff state.

## Shipped Outcome

3.9.4 is the final cleanup/refactor pass before Roadmap 4 opens.

It intentionally stayed narrow:

1. **Shared tool-search catalog plumbing**
   - `packages/tools/src/tool-exposure.ts` now owns the shared `ToolSearchCatalogEntry` type plus the registry-catalog helpers:
     - `formatToolExposureReason(...)`
     - `buildRegistryToolSearchCatalog(...)`
   - this removes duplicate registry-to-search-catalog mapping logic from:
     - `packages/harness-core/src/tool-exposure-plan.ts`
     - `services/api/src/mcp.ts`

2. **Small planner/harness cleanup**
   - harness-side `tool_search` now uses the same shared catalog entry shape as MCP
   - reason formatting is normalized through one helper instead of adapter-local string rewriting

3. **Repository hygiene**
   - removed the temporary seeded-eval artifact `tmp-seeded-eval-followup.json`

This phase did **not** add or redesign tools. It only tightened the cleanup seams left behind by the 3.9.2/3.9.3 work.

## Why This Phase Exists

3.9.3 closed the real external-agent validation and the final retrieval hardening. After that, the remaining justified work was codebase cleanliness:

- reduce duplicated planner/search-catalog mapping
- normalize small adapter seams before Roadmap 4 builds on them
- remove temporary eval residue from the repo root

That is small work, but it is worth shipping explicitly so Roadmap 4 starts from a cleaner base.

## Verification At Ship Time

- `corepack pnpm run typecheck`
- `corepack pnpm --filter @mako-ai/tools run build`
- `corepack pnpm --filter @mako-ai/harness-core run build`
- `node --import tsx test/smoke/harness-calls-registry-tool.ts`
- `node --import tsx test/smoke/core-mvp.ts`

## Decision

Roadmap 3 closes on 3.9.4.

No further Phase 3 follow-up is justified. The next work belongs in Roadmap 4.
