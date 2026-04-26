# Phase 5.3 Workflow Recipes And Stop Conditions

Status: `Complete`

## Purpose

Add the explicit loop-style workflow layer.

This is the phase where Roadmap 5 stops being only “context packets” and starts
being “workflow assistance.”

## Phase Outcome

By the end of `5.3`, `mako-ai` should be able to produce `workflow_recipe`
packets that clearly describe:

- steps
- verification after each step
- when to continue
- when to stop
- edge-case checks

This phase is now shipped.

The built-in `workflow_recipe` generator produces compact loop packets on the
shared `WorkflowPacketInput` seam with:

- ordered recipe steps
- a stable five-step scaffold for the initial shipped loop families
- explicit `todo` / `in_progress` / `done` status
- exactly one active step by default
- per-step verification rules
- per-step stop conditions
- per-step rerun/refresh triggers
- a machine-readable `steps` section plus typed payload steps
- shared rendering that shows verify / stop / refresh rules directly to humans

The current built-in recipe kinds are intentionally small:

- `debug_fix`
- `rerun_verify`
- `review_verify`

## Workstreams

### A. Workflow Recipe Contract

Define the typed recipe shape:

- ordered steps
- status model
- verification rule(s)
- stop condition(s)
- rerun/refresh trigger(s)

The status model should stay intentionally small:

- `todo`
- `in_progress`
- `done`

and only one step should be active at a time unless a recipe explicitly
requires parallel work.

Each step should also carry:

- what to do
- how completion is verified
- what failure or block looks like

This is now implemented and enforced by packet integrity checks:

- recipe payloads must contain at least one step
- step ids must be unique
- every step must include verification rules
- every step must include stop conditions
- exactly one step must be `in_progress`

The initial shipped scaffold is intentionally uniform and position-stable.

That means recipe step ids stay tied to loop stage rather than step prose, so
later refreshes can treat “step 3” as the same stage even if the wording gets
refined.

### B. Common Recipe Families

Start with a small set of recipes such as:

- debug/fix loop
- review loop
- verify-after-change loop
- rerun-after-change loop

The shipped generator currently derives one of three practical recipe families
from the current answer context:

- `debug_fix` when diagnostics are present
- `rerun_verify` when trust/compare state implies refresh or drift
- `review_verify` when the answer is mostly inspection/review oriented

### C. Stop Condition Discipline

Recipes must not just be “next steps.”

They should say:

- what success looks like
- what failure looks like
- what should block progression
- what edge case or follow-up check must run before the recipe is really done

Recipes should behave like compact workflow loops, not free-form checklists.

The shipped recipe step structure explicitly carries:

- the step title
- verification rules
- stop conditions
- rerun/refresh triggers

so downstream consumers do not need to infer loop semantics from prose alone.

## Verification

- recipe smokes
- at least one case proving stop conditions are explicit and machine-readable
- at least one case proving the recipe status model is explicit and only one step is active
- consumer-fit checks from CLI/API/MCP views

Shipped verification:

- `test/smoke/workflow-packet-generators.ts`
  - `workflow_recipe` generation from a realistic trust/diagnostic context
  - direct `recipeKind` coverage for rich vs sparse packet inputs
  - exactly one `in_progress` step
  - non-empty verification and stop-condition rules on every step
  - rerun/refresh triggers present where trust/compare state warrants them
  - compact rendering through the shared packet formatter
- `test/smoke/workflow-packets.ts`
  - packet contract and integrity coverage on the shared packet seam

## Non-Goals

- no required automation engine
- no background workflow executor
- no full generated documents layer

## Exit State

Roadmap 5 has real workflow guidance, not just context bundles and static briefs.

This exit state is now met for the initial recipe layer. The next phase should
surface these packets cleanly rather than adding a second recipe system.
