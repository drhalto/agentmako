# Phase 4.1 Benchmark And Evaluation Storage

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 4.1.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 4.1.

## What Shipped

- Project migration `0007_project_benchmark_storage` added to `packages/store/src/migration-sql.ts`:
  - `tool_runs.payload_json` nullable column (ALTER TABLE) for sampled full-payload capture during benchmark runs
  - `benchmark_suites` — reusable suite definitions (suite_id UUID, name, description, version, config_json)
  - `benchmark_cases` — individual test cases within a suite (case_id UUID, suite_id FK, name, tool_name, input_json, expected_outcome)
  - `benchmark_assertions` — assertion templates for a case (assertion_id UUID, case_id FK, assertion_type, expected_value, tolerance)
  - `benchmark_runs` — execution records (run_id UUID, suite_id FK, started_at, finished_at, outcome, runner_version)
  - `benchmark_case_results` — per-case outcomes linked to tool_runs (case_result_id UUID, run_id FK, case_id FK, tool_run_id FK, outcome, actual_value)
  - `benchmark_assertion_results` — per-assertion outcomes (assertion_result_id UUID, case_result_id FK, assertion_id FK, passed, actual_value, expected_value)
  - Append-only immutability triggers (DELETE/UPDATE) on `benchmark_runs`, `benchmark_case_results`, `benchmark_assertion_results`
  - `benchmark_run_summaries` lightweight view
- `packages/store/src/types.ts` — benchmark record/insert/query types; extended `ToolRunRecord`/`ToolRunInsert` with optional `payload` field
- `packages/store/src/project-store.ts` — benchmark save/get/list methods for definition tables; insert/get/list methods for run and result tables; explicit `benchmark-link-failed` error when a case result points at a missing `tool_runs` row
- `test/smoke/core-mvp.ts` — round-trip benchmark suite coverage, case-result FK linkage against a real `tool_runs` row, assertion-result query coverage, immutability trigger checks, `payload_json` nullable/non-null coverage

Note: `evidence_alignment` was not added. The phase spec marks it optional and no concrete row contract was defined. It can be added in a later phase if Phase 5 ForgeBench needs it.

## Code Touchpoints

`packages/store/src/migration-sql.ts`
- Added migration `0007_project_benchmark_storage` with all seven benchmark DDL statements, the `tool_runs.payload_json` ALTER TABLE, immutability triggers, and the `benchmark_run_summaries` view

`packages/store/src/types.ts`
- Added `BenchmarkSuiteRecord`, `BenchmarkSuiteInsert`, `BenchmarkCaseRecord`, `BenchmarkCaseInsert`, `BenchmarkAssertionRecord`, `BenchmarkAssertionInsert`, `BenchmarkRunRecord`, `BenchmarkRunInsert`, `BenchmarkCaseResultRecord`, `BenchmarkCaseResultInsert`, `BenchmarkAssertionResultRecord`, `BenchmarkAssertionResultInsert` types
- Extended `ToolRunRecord` and `ToolRunInsert` with optional `payload_json` field

`packages/store/src/project-store.ts`
- Added benchmark CRUD and query methods for all six benchmark tables
- Added `benchmark-link-failed` typed error for FK integrity on case results

`test/smoke/core-mvp.ts`
- Added benchmark round-trip suite, case result FK linkage, assertion result query, immutability trigger rejection, and `payload_json` coverage tests

## Prerequisites

- Phase 4 (action and tool-run logging) must be complete — benchmark case results link to `tool_runs` rows by foreign key, so `tool_runs` must exist before benchmark result tables can reference it
- The `tool_runs` history from Phase 4 is the linkage substrate benchmark results point at; without it, Phase 4.1 cannot close the fact-to-result chain

## Goal

Make the product measurable by storing reusable benchmark definitions and linking execution results back to the tool-run history Phase 4 established.

## Hard Decisions

- Benchmark definitions and execution results are separate layers — you define a suite once, execute it many times, and each execution produces its own result rows
- Benchmark case results link to `tool_runs` rows by foreign key, not to opaque JSON blobs; if you cannot point at a `tool_runs` row, you do not have a result
- Assertion results are individual queryable rows, not packed inside a result JSON
- Summary views are derived and subordinate to raw facts; they do not replace the underlying result rows
- Optional payload capture for benchmark runs is handled by a `payload_json` nullable column on Phase 4's `tool_runs` table (added via ALTER TABLE migration), not a separate subsystem
- Immutability enforcement follows the same trigger pattern as Phase 4: DELETE and UPDATE triggers reject mutations on all result tables

## Why This Phase Exists

Phase 4 gives the product structured, durable action history. Phase 4.1 gives that history a purpose by making it the ground truth that benchmark results reference.

Without Phase 4.1, benchmark execution lives outside the fact log — either in test files that are not linked to run history, or in ad hoc manual inspection. Phase 4.1 closes that gap: benchmark definitions are stored and reusable, execution results are structured rows, and each result is traceable back to the exact tool invocations that produced it.

Phase 5 (ForgeBench validation) needs this substrate in place before it can store repeatable validation results.

## Scope In

- `benchmark_suites` table — reusable suite definitions: `suite_id` (UUID), `name`, `description`, `version`, `config_json`
- `benchmark_cases` table — individual test cases within a suite: `case_id` (UUID), `suite_id` FK, `name`, `tool_name`, `input_json`, `expected_outcome`
- `benchmark_assertions` table — assertion templates for a case: `assertion_id` (UUID), `case_id` FK, `assertion_type`, `expected_value`, `tolerance`
- `benchmark_runs` table — execution records for a suite: `run_id` (UUID), `suite_id` FK, `started_at`, `finished_at`, `outcome`, `runner_version`
- `benchmark_case_results` table — per-case outcomes: `case_result_id` (UUID), `run_id` FK, `case_id` FK, `tool_run_id` FK referencing Phase 4's `tool_runs`, `outcome`, `actual_value`
- `benchmark_assertion_results` table — per-assertion outcomes: `assertion_result_id` (UUID), `case_result_id` FK, `assertion_id` FK, `passed`, `actual_value`, `expected_value`
- Optional `evidence_alignment` rows for benchmark types that need grounding checks
- Optional `payload_json` nullable column on Phase 4's `tool_runs` table (via ALTER TABLE migration in the new Phase 4.1 migration) for sampled or redacted inspectable payloads when a benchmark run needs full I/O
- Lightweight summary views or derived tables subordinate to raw facts
- Immutability enforcement on all benchmark result tables (`benchmark_runs`, `benchmark_case_results`, `benchmark_assertion_results`) using the same DELETE/UPDATE trigger pattern as Phase 4

## Scope Out

- Contradiction engine
- Ranking engine and score history
- AI/ML behavior
- Hot-path rollup triggers
- Per-tool benchmark logic — benchmarks are generic, driven by suite definitions
- CLI commands for benchmark management (may arrive in Phase 5, not Phase 4.1)

## Architecture Boundary

### Owns

- `benchmark_suites`, `benchmark_cases`, `benchmark_assertions` definition tables
- `benchmark_runs`, `benchmark_case_results`, `benchmark_assertion_results` result tables
- Optional `evidence_alignment` rows
- The `payload_json` column addition to Phase 4's `tool_runs`
- Immutability triggers on all result tables
- ProjectStore CRUD and query methods for all benchmark tables

### Does Not Own

- Phase 4's `lifecycle_events` and `tool_runs` tables (they predate Phase 4.1 and are read-only from this phase's perspective, except the `payload_json` column addition)
- CLI surface for benchmark invocation
- Tool registry and indexer paths
- Live catalog

## Contracts

### Input Contract

Benchmark storage should be able to express:

- a reusable suite definition (name, version, config)
- an individual test case within a suite (tool name, input args, expected outcome)
- an assertion template for a case (assertion type, expected value, tolerance)
- a benchmark run (which suite, when it ran, runner version)
- a per-case result (which run, which case, which `tool_runs` row, actual outcome)
- a per-assertion result (which case result, which assertion, pass/fail, actual vs expected)

### Output Contract

The phase leaves behind:

- stored benchmark suite and case definitions that can be rerun without redefining
- benchmark execution records where each case result points at a `tool_runs` row
- assertion outcomes that are queryable as individual rows without unpacking a result blob
- a `payload_json` column on `tool_runs` for sampled full-payload capture when benchmarks need it
- immutable historical result rows enforced at the storage layer
- enough structure for Phase 5 ForgeBench validation to record its runs as queryable facts

### Error Contract

- `benchmark-record-failed` — an insert into a benchmark table fails; surface the error, do not silently drop the result
- `benchmark-link-failed` — a `case_result` cannot link to a valid `tool_runs` row; this is a data-integrity error, not a silent skip

## Execution Flow

1. Define benchmark definition tables (`benchmark_suites`, `benchmark_cases`, `benchmark_assertions`) via new project migration
2. Define benchmark result tables (`benchmark_runs`, `benchmark_case_results`, `benchmark_assertion_results`) in the same migration
3. Add immutability triggers on result tables
4. Add the `payload_json` nullable column to `tool_runs` via ALTER TABLE in the migration
5. Add ProjectStore methods for benchmark CRUD and query
6. Add smoke test coverage verifying suite definition, run record, case result linkage to `tool_runs`, and assertion result storage

## File Plan

Create:

- New project migration in `packages/store/src/migration-sql.ts`

Modify:

- `packages/store/src/project-store.ts` — benchmark CRUD and query methods
- `test/smoke/core-mvp.ts` — benchmark storage smoke tests (suite round-trip, case result linkage to `tool_runs`, assertion result query)

Keep unchanged:

- Phase 4's `lifecycle_events` and `tool_runs` tables (except the `payload_json` column addition)
- CLI surface — no benchmark management commands in this phase
- Tool registry, indexer, live catalog

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- Define a benchmark suite, insert it, read it back — confirm round-trip without data loss
- Create a benchmark case result with a valid `tool_run_id` FK — confirm the link resolves
- Create a benchmark assertion result — confirm it is queryable as an individual row
- Attempt to DELETE a `benchmark_runs` row — must fail with a trigger error
- Attempt to UPDATE a `benchmark_case_results` row — must fail with a trigger error
- Insert a `tool_runs` row with a `payload_json` value — confirm the column exists and is nullable

Required docs checks:

- Phase 5 prerequisite list includes Phase 4.1
- Roadmap 2 docs reflect the Phase 4 / Phase 4.1 split

## Done When

- Benchmark suites can be defined, stored, and rerun without redefining
- Benchmark execution results link back to `tool_runs` history via foreign key
- Assertion outcomes are queryable as individual rows
- Immutable historical rows are enforced on all result tables
- Phase 5 ForgeBench validation has a usable storage substrate to record repeatable runs

## Risks And Watchouts

- Benchmark case results that cannot link to a `tool_runs` row are a data integrity hole — enforce the FK and surface the error rather than allowing orphan rows
- The `payload_json` column on `tool_runs` is nullable and should be populated only when a benchmark explicitly samples it; do not default to capturing full payloads on every tool call
- Benchmark definitions changing between runs (schema drift in `benchmark_cases`) can make cross-run comparison ambiguous — treat `suite_id` + `version` as the stable identity, not just `name`

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [../../../master-plan.md](../../../master-plan.md)
- [./phase-4-logging-and-evaluation-backbone.md](./phase-4-logging-and-evaluation-backbone.md)
- [./phase-5-forgebench-validation-and-roadmap-2-lock.md](./phase-5-forgebench-validation-and-roadmap-2-lock.md)
