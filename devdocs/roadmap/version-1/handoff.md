# Lead Agent Implementation Brief

Use this brief if one strong agent is taking the next implementation pass.

## Objective

The initial roadmap is complete. If a new implementation pass starts, it should begin from a concrete-need gate or a new approved follow-on plan, not from unfinished Phase 5 work.

## Read First

- [./roadmap.md](./roadmap.md)
- [./initial-roadmap-complete.md](./initial-roadmap-complete.md)
- [./phases/phase-5-public-lock.md](./phases/phase-5-public-lock.md)
- [./phases/phase-4-ask-router.md](./phases/phase-4-ask-router.md)
- [./mvp.md](./mvp.md)
- [../../product/vision.md](../../product/vision.md)
- [../../architecture/overview.md](../../architecture/overview.md)
- [../../architecture/database.md](../../architecture/database.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)

## Available MCP Tools

Use the tools available in this environment aggressively for research and verification:

- Context7
- perplexity-comet
- supabase

Use them to confirm implementation choices instead of guessing when they can verify a fact, runtime behavior, or framework detail.

## Product Contract

- local-first repo intelligence engine
- narrow MVP: attach, index, answer, evidence
- current product step: initial roadmap complete; any new work reopens through concrete-need gates
- not an autonomous maintainer
- not an ML-first product
- keep the architecture clean and extensible

## Implementation Standard

- build for success
- keep the scope narrow
- do not overbuild
- do not create unnecessary cross-layer coupling
- prefer deterministic, operationally simple solutions
- follow `./roadmap.md` for the frozen Roadmap 1 state
- follow `./initial-roadmap-complete.md` for the completion summary and shipped surface
- treat `./phases/phase-5-public-lock.md` and `./phases/phase-4-ask-router.md` as shipped baseline context
- keep worker and live DB sync deferred unless the roadmap explicitly moves there

## Priority Order

1. worker, only if there is a concrete product need
2. live DB sync and write-side connectors, only if the read-only schema layer proves insufficient
3. ML/vector retrieval only if deterministic retrieval proves insufficient

## Must-Hold Decisions

- dual SQLite databases stay
- SQLite operational policy is mandatory
- deterministic indexing comes first
- Tree-sitter-first direction is preferred when strengthening parser strategy
- API, CLI, web, and MCP stay thin over the shared tool layer
- `/api/v1/answers` stays supported while the tool surface is added
- output schemas and read-only annotations are part of the transport contract
- worker and live DB sync stay deferred from the core roadmap
- the Phase 2, Phase 3, Phase 4, and Phase 5 surfaces are already shipped
- `ask` remains a thin router, not a second engine
- `free_form` remains a conservative fallback only
- new work should come from a new approved follow-on plan, not by pretending Phase 5 is still open

## Verification Minimum

Before calling the pass complete, verify:

- workspace typecheck/build
- existing answer flows still work
- the new tool surface works through its transport
- CLI flows still work
- API flows still work
- any new web path added
- any new smoke harnesses

## Finish Standard

The repo should be:

- stronger at the core
- clearer in its boundaries
- easier to continue from
- better documented

If the work makes the repo bigger but not clearer, it is not finished correctly.
