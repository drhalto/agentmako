# Phase 5 Public Lock Specification

This file is the exact implementation spec for the shipped Phase 5 build target.

Use [../roadmap.md](../roadmap.md) for phase order and status. Use [../initial-roadmap-complete.md](../initial-roadmap-complete.md) for the completion summary and build debrief.

## Goal

Turn the shipped local-first MVP into a public-ready, easy-to-start, easy-to-connect product surface.

Phase 5 is not about widening capability. It is about making the shipped capability legible, installable, and trustworthy for humans and coding agents.

## Hard Decisions

- Phase 5 does not add major new tool families
- Phase 5 does not add new transports
- Phase 5 does not reopen Phase 3 or Phase 4 except for bug fixes
- Phase 5 does not change the core product contract
- Phase 5 treats the shipped named tools and `ask` router as the public MVP surface
- Phase 5 keeps `/api/v1/answers` supported, but presents the tool surface as the primary public entry point
- Phase 5 is documentation, packaging, and release-facing polish over the shipped implementation

## Why This Phase Exists

The product value is now present:

- local attach and indexing
- named structured tools
- read-only DB schema tools
- MCP transport
- thin `ask` router

What is still missing is public lock:

- one clean install-and-run path
- one clear tool registry
- one clear agent connection story
- one clear explanation of what is shipped, what is optional, and what is deferred

Phase 5 solves the "can someone actually start and trust this?" problem.

## Deliverables

### README Public Front Door

The root README must become the fastest path to understanding and starting `mako-ai`.

It should clearly cover:

- what `mako-ai` is
- who it is for
- the local-first value proposition
- the primary surfaces:
  - MCP
  - HTTP tool routes
  - CLI
  - thin web client
- the fastest start path
- where to go next in the docs

### Install And Run Guide

There must be one canonical install-and-run page for the MVP.

It should cover:

- prerequisites
- install
- build
- start
- attach and index
- how to point an agent at `/mcp`
- how to run smoke verification
- how DB tools are enabled optionally

This guide should be optimized for a clean checkout and a local machine, not for platform sprawl.

### Agent Config Examples

Phase 5 should provide public-ready agent configuration examples for the shipped MCP surface.

At minimum, documentation should cover:

- Claude Code style `.mcp.json`
- at least one additional agent/client example if the shape differs materially
- local MCP URL
- local-only assumption
- optional project DB bind pattern via env-var ref (for example `SUPABASE_DB_URL`)

Examples must match the actual shipped `/mcp` contract.

### Tool Registry

There should be one human-facing registry page for the public tool surface.

That registry should:

- group tools by family
- present `ask` as the low-friction front door
- keep named tools visible as canonical direct surfaces
- describe each tool in one sentence
- show the common question shape each tool answers

This should reduce tool-sprawl confusion without collapsing the surface into mega-tools.

### Tool Description Polish

Public-facing tool descriptions should become more explicit and easier for agents to choose from.

Phase 5 polish includes:

- family-aware wording
- read-only scope clarity
- sharper distinction between overlapping import tools
- sharper distinction between:
  - `db_columns`
  - `db_table_schema`
  - `symbols_of`
  - `exports_of`

### Doc Pointer Cleanup

Current-phase pointers must be consistent across:

- `README.md`
- `START_HERE.md`
- the v1 roadmap and handoff under `devdocs/roadmap/version-1/`
- `devdocs/architecture/overview.md` and `devdocs/architecture/database.md`

Phase 5 should leave no ambiguity about:

- what is shipped
- what the current phase is
- which doc is the exact Phase 5 brief

## Public MVP Story

By the end of Phase 5, the public story should be:

1. install `mako-ai`
2. run the local server
3. attach and index a project
4. point a coding agent at `/mcp`
5. call `ask` or a named tool
6. get structured JSON with evidence or typed tool output

That story should be visible without reading the whole repo.

## Required Outputs

Phase 5 should produce or tighten:

- root README
- install-and-run guidance
- tool registry documentation
- agent config examples
- current-phase handoff pointers
- public-facing wording around the shipped tool families

It may also include:

- release notes or versioned docs framing
- a first formal release checklist

## Verification

Phase 5 verification should prove the public lock is real, not just described.

Minimum verification:

- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- follow the documented quick-start flow from a clean checkout
- confirm the documented MCP URL and example config are correct
- confirm the documented tool list matches the shipped registry
- confirm the public docs consistently point to the current phase

## Done When

Phase 5 is done when:

- the root README is strong enough to serve as the public front door
- a new user can install, start, and connect an agent without repo archaeology
- tool families are documented clearly enough that the public surface feels intentional
- Phase 4 is treated as shipped baseline, not current implementation target
- the doc tree clearly distinguishes:
  - canonical roadmap
  - current phase brief
  - handoff package
  - supporting references

## Out Of Scope

- new DB tool expansion beyond bug-fix polish
- LLM routing upgrades inside `ask`
- new indexing architecture work
- worker implementation
- live DB sync
- write-side DB connectors
- ML/vector work
- platform or dashboard expansion

## Reference Position

Use these as shipped baselines during Phase 5:

- [phase-4-ask-router.md](./phase-4-ask-router.md)
- [phase-3-db-tools.md](./phase-3-db-tools.md)

Phase 5 should polish what is shipped, not blur the boundaries around it.
