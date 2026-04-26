# Product Vision

`mako-ai` is a local-first repo intelligence engine for JS/TS web projects, with optional Postgres/Supabase schema awareness.

Its job is to let a user or coding agent attach to a project, index the repo and schema shape, and get back fast, evidence-backed, structured answers in one round trip.

## Core Value

The product promise is not "more dashboards" or "more autonomous behavior."

The product promise is:

- one connection to the local project
- one fast structured call
- one evidence-backed answer that saves several minutes of manual repo digging

That value should work for:

- humans in the CLI or web client
- coding agents through MCP
- thin HTTP integrations

## Product Shape

`mako-ai` has two layers of value:

### 1. Core Repo Intelligence

- attach to a project
- index repo and schema structure
- answer high-value engineering questions
- return evidence, not guesses

### 2. Agent-Callable Tool Surface

- expose the useful capabilities through named tools
- keep tool outputs structured and schema-backed
- let an agent choose between exact tools and a thin `ask` router

The current answer flows are still part of the product. They are the proven high-value behaviors that the tool surface will wrap and extend:

- `route_trace`
- `schema_usage`
- `file_health`
- `auth_path`
- `free_form` only as conservative fallback

## Current Surface

The shipped low-friction front door is now Phase 4 `ask`:

- a thin `ask` router over the shipped named tools
- deterministic routing into the current tool families
- conservative fallback to `free_form` only when no named tool fits
- additive to the shipped local-first repo intelligence core

## Immediate Next Step

The next product step is Phase 5 public lock:

- install-and-run polish
- public-facing docs and examples
- agent config and tool-registry clarity
- public-ready framing around the shipped tool surface

## What Success Looks Like

Success is not measured by how many services or tools exist.

Success is:

- a coding agent can connect to local `mako-ai`
- call one named tool
- receive structured JSON with evidence
- and move on without spending five minutes grepping the repo

## Design Principles

- local-first by default
- deterministic indexing first
- evidence-backed answers first
- thin transport layers
- structured tool contracts
- expansion by seam, not by early coupling

## Non-Goals

- broad autonomous code mutation
- giant tool catalogs at launch
- ML-first product identity
- dashboard-first product identity
- platform sprawl before the agent-facing MVP is solid
