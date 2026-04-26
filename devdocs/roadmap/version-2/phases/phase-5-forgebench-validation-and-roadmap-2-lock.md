# Phase 5 ForgeBench Validation And Roadmap 2 Lock

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 5.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 5.

## Prerequisites

- Phase 4 (action and tool-run logging) must be complete — validation runs need durable `tool_runs` rows to trace benchmark results back to
- Phase 4.1 (benchmark and evaluation storage) must be complete — Phase 5 records ForgeBench validation runs as structured `benchmark_runs`, `benchmark_case_results`, and `benchmark_assertion_results` rows; without the storage substrate from Phase 4.1, validation results can only be observed informally

## Goal

Prove the Roadmap 2 backbone works against ForgeBench and lock the roadmap with repeatable validation.

## Hard Decisions

- Roadmap 2 is not complete until ForgeBench proves it
- validation must be repeatable
- operator flow and docs are part of the lock criteria

## Why This Phase Exists

Roadmap 2 is infrastructure-heavy.

Without a real controlled target proving attach, binding, snapshot, and logging behavior end to end, the roadmap is still only half-real.

## Scope In

- repeatable ForgeBench attach flow
- repeatable ForgeBench DB binding flow
- repeatable refresh flow
- benchmark verification against answer-key docs
- benchmark suite/run/result flow using the Roadmap 2 evaluation model
- operator docs and lock criteria

## Scope Out

- new investigation families
- contradiction engine
- AI/ML work

## Architecture Boundary

### Owns

- Roadmap 2 validation flow
- benchmark operator path
- lock criteria and docs

### Does Not Own

- later roadmap features
- major new substrate systems outside validation needs

## Contracts

### Input Contract

The validation path should be able to start from:

- a detached or fresh ForgeBench project
- an unconfigured live DB binding
- benchmark docs under `devdocs/test-project/`

### Output Contract

Roadmap 2 lock should leave behind:

- repeatable operator steps
- stored benchmark runs
- stored benchmark definitions and assertion outcomes
- clear lock criteria

### Error Contract

- validation-flow-failed
- benchmark-mismatch
- lock-criteria-not-met

## Execution Flow

1. attach ForgeBench from scratch
2. verify manifest and project metadata
3. enable and test live DB binding
4. build or refresh local schema state
5. run benchmark flow and store suite/run/result facts
6. lock docs and operator guidance

## File Plan

Create:

- validation or operator docs as needed

Modify:

- Roadmap 2 docs where lock criteria and operator flow need to be finalized

Keep unchanged:

- roadmap scope; do not widen functionality under cover of validation

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- ForgeBench can be attached from scratch
- live DB binding works
- schema refresh works
- benchmark records can be stored and reviewed
- benchmark case and assertion results are queryable
- benchmark results can be traced back to the underlying tool-run history when relevant

Required docs checks:

- operator docs are sufficient to repeat the whole Roadmap 2 flow

## Done When

- ForgeBench proves the attach/bind/refresh path end to end
- benchmark data can be recorded and reviewed
- benchmark definitions, results, and assertion outcomes form a repeatable evaluation record
- Roadmap 2 docs are strong enough to hand off cleanly

## Risks And Watchouts

- declaring victory without repeatable validation
- quietly widening roadmap scope during lock
- letting validation live only in a person’s head

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [./phase-4-logging-and-evaluation-backbone.md](./phase-4-logging-and-evaluation-backbone.md)
- [./phase-4.1-benchmark-and-evaluation-storage.md](./phase-4.1-benchmark-and-evaluation-storage.md)
- [../../../test-project/benchmark-answer-key.md](../../../test-project/benchmark-answer-key.md)
