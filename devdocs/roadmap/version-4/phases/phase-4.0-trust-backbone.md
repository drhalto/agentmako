# Phase 4.0 Trust Backbone

Status: `Completed`

Initial substrate slice shipped: `2026-04-18`

Latest hardening pass shipped: `2026-04-18`

This file is the canonical planning doc for Roadmap 4 Phase 4.0. It is the first trust-layer slice after Roadmap 3 closes and defines the storage/identity model every later Roadmap 4 phase depends on.

Use [../roadmap.md](../roadmap.md) for roadmap status and phase order. Use [../handoff.md](../handoff.md) for the current execution target.

## Shipped Outcome So Far

The 4.0 trust substrate is now landed in two slices.

What shipped:

- trust-layer contracts in `packages/contracts/src/answer.ts`
- migration `0018` in `packages/store/src/migration-sql.ts`
- migration `0019` in `packages/store/src/migration-sql.ts`
- `answer_comparable_targets` and `answer_trust_runs`
- `answer_traces.project_id` plus backfill for older rows
- a new trust store split in `packages/store/src/project-store-trust.ts`
- integration into `saveAnswerTrace(...)`
- reopen-time reconciliation for legacy `answer_traces`
- public store reads for:
  - trust run by trace id
  - comparable target by id
  - latest comparable run
  - comparable run history
- focused coverage in `test/smoke/trust-backbone.ts`
- deterministic identity inference for:
  - `trace_file`
  - `file_health`
  - `auth_path`
  - `route_trace`
  - `schema_usage`
  - `trace_table`
  - `preflight_table`
  - `trace_rpc`
  - `trace_edge`
  - `trace_error`
- stable fallback identity for unresolved/free-form runs
- canonical packet hashing plus raw packet hashing
- per-run previous-packet hash linkage
- stable nullable environment fingerprint capture:
  - `gitHead` when the project root is inside a git worktree
  - `schemaSnapshotId`
  - `schemaFingerprint`
  - `indexRunId`
- selective reopen-time reconciliation:
  - missing trust runs
  - pre-`0019` rows missing raw hash / fingerprint / packet-chain data
- honest legacy provenance fallback:
  - backfilled pre-trust rows default to `unknown`, not `interactive`

The current identity model is still intentionally conservative where the system does not have a deterministic target. Free-form or unresolved runs still use a normalized fallback key rather than inventing semantic equivalence.

## Remaining Work Inside 4.0

4.0 is not done yet. The remaining work is to tighten and lock the substrate, not to jump ahead into rerun/compare semantics.

Still in scope for 4.0:

- keep the trust record shape narrow and stable
- decide whether any live save paths should pass explicit structured identity instead of relying on deterministic inference
- document the intended strictness for schema-qualified versus unqualified identities
- thread provenance through the future eval runner instead of inventing a parallel trust-write path

Still out of scope for 4.0:

- compare artifacts
- contradiction/drift classification
- trust UI/API fields

## Goal

Create the stable trust record model that lets `mako-ai` treat answers as comparable objects over time instead of one-off outputs.

Specifically:

- give answer/investigation records a stable comparison identity
- define trust metadata that can survive reruns
- formalize how trust state is stored without inventing a second answer system
- leave later phases with one clean substrate for rerun/compare, contradiction, drift, and diagnostics

## Phase Outcome

By the end of 4.0, the system should have one answer-history backbone with three properties:

1. every saved answer run can be linked to a comparable subject
2. rerun/compare phases can query answer history without re-deriving identity ad hoc
3. trust metadata lives beside the shipped answer layer instead of forking into a second answer object

This phase should leave the codebase with a narrow but real trust storage seam, not a half-finished semantic engine.

## Why This Phase Exists

Roadmap 3 shipped typed answers and saved answer traces, but it did not define:

- when two answer runs are “the same question” for comparison purposes
- where trust metadata belongs
- how reruns should be linked
- how trust state should compose with the existing packet/result model

Without 4.0, every later trust feature would invent its own notion of identity and history.

## Prerequisites

- Roadmap 3 complete
- `AnswerPacket` / `AnswerResult` already shipped
- answer traces already persist locally
- benchmark storage already exists

## Explicit Non-Goals

This phase should not:

- execute reruns
- compute contradictions
- decide whether one answer is “better” than another
- add ranking/scoring UX
- add broad benchmark runner changes
- introduce hosted observability/eval dependencies

## Hard Decisions

1. **Trust extends the shipped answer layer.**
   - do not invent a second public answer object
2. **Comparison identity is explicit.**
   - do not rely on “same text” or “same tool name” only
3. **Trust metadata is local-first and append-only where practical.**
   - reuse the shipped SQLite backbone
4. **Do not solve contradiction logic here.**
   - 4.0 defines substrate, not final semantics
5. **Identity should be target-centric, but 4.0 may ship a conservative fallback for unresolved runs.**
   - the ideal state is normalized answer target plus tool/query family
   - deterministic families should write structured target identity now
   - unresolved/free-form paths still need a stable fallback key so trust history is not lost
6. **History storage should prefer references to large payload duplication.**
   - reuse saved answer trace/packet payloads
   - store compact trust metadata and linking keys, not a second full packet copy unless a phase explicitly needs it
7. **Canonical and raw packet identity are different things.**
   - canonical packet hash is for fast same-ish comparison
   - raw packet hash is for forensic/integrity support
   - neither replaces later answer-aware diff semantics
8. **Environment fingerprint shape should be stable even when fields are null.**
   - null means “unknown at write time”
   - call sites should not invent different provenance objects ad hoc

## Scope In

### 1. Trust record schema

Define the persisted record shape for:

- comparable answer identity
- run identity
- parent/previous run linkage
- trust metadata

The schema should separate:

- the stable comparable subject
- the individual run
- any future rerun/compare outputs that belong to the run pair, not the target itself

### 2. Comparison identity rules

Define how a comparable answer target is computed from:

- project
- query/tool kind
- normalized target/subject
- optional route/file/table/RPC/symbol identity

This should include explicit rules for at least:

- composer answers such as `trace_file`, `trace_table`, `trace_rpc`, `trace_edge`, `trace_error`, `preflight_table`
- `ask` answers that adapt into those tool/query families
- benchmark/eval-triggered answers versus interactive/user-triggered answers

The comparison key should ignore volatile fields like timestamps, request ids, and phrasing noise.

Current shipped fallback rule:

- `projectId + queryKind + normalized queryText`

Current shipped normalization:

- trim outer whitespace
- collapse internal whitespace
- strip composer-style `queryKind(...)` wrapper noise when present

This is deliberately narrower than the final target-centric ideal described above.

4.0 should now tighten this with a documented structured `identity_json` for deterministic families.

Minimum deterministic-family payloads to define in 4.0:

- `trace_file` → normalized file path
- `trace_table` / `preflight_table` → schema + table
- `trace_rpc` → schema + rpc name + arg types where available
- `trace_edge` → edge function name
- `trace_error` → normalized error subject

Free-form or unresolved `ask` paths should continue to use the fallback key rather than losing trust history entirely.

### 3. Persistence seam

Add the store methods and migration(s) needed to persist trust records cleanly alongside existing answer traces and benchmark data.

### 4. Minimal read path

Expose enough read APIs to support later phases:

- fetch latest comparable run
- fetch prior comparable runs
- fetch trust record by id

The read path should be sufficient for later phases to:

- list answer history for one comparable subject
- locate the previous run during rerun
- retrieve enough metadata to explain why two runs are comparable

## Scope Out

- rerun execution logic
- contradiction scoring
- drift interpretation
- alignment diagnostics
- web trust UI
- ranking/de-ranking

## Proposed Record Model

The exact table names can still change, but 4.0 should leave behind these logical objects:

### Comparable target

One record per stable answer subject, likely keyed by:

- `project_id`
- `answer_family` or `query_family`
- normalized target identity payload
- normalized comparison key/hash

This record answers: “what thing are we comparing over time?”

### Trust run

One record per saved answer execution, linked to:

- comparable target
- existing answer trace id or equivalent saved result id
- optional session/request/eval provenance
- previous comparable run id where present
- compact baseline trust metadata

This record answers: “what happened on this run?”

### Trust baseline metadata

4.0 should only store metadata that later phases need to compute richer semantics, for example:

- run timestamp
- packet/status hash
- target freshness snapshot if already available
- provenance such as `interactive`, `benchmark`, `seeded_eval`, `manual_rerun`

This record does not yet need contradiction or ranking output.

## Proposed Comparison Identity Rules

The implementation should document and test the normalization rules explicitly.

### Identity inputs that should matter

- project
- answer family or tool/query kind
- primary target object, such as file path, route path, table/schema pair, RPC signature, symbol, edge function, or error subject
- optional normalized supporting subject when the answer truly depends on it

### Inputs that should not matter

- request id
- session id by itself
- timestamps
- exact user phrasing if the normalized target is unchanged
- packet formatting differences

### Identity edge cases that need explicit calls

- `ask` routed from two different vague prompts into the same normalized target should compare if the resolved target is the same
- `trace_rpc(public.foo)` and `trace_rpc(private.foo)` should not compare
- overload-aware targets should preserve signature identity where the underlying substrate already supports it
- purely exploratory `cross_search` answers likely need a stricter rule or should remain non-comparable until a real target can be derived

## Workstreams

### Workstream A: contract and identity design

- extend the answer/trust contracts with a narrow internal trust record shape
- define the normalized comparison identity payload
- document how identity is computed for each deterministic current answer family
- define the fallback comparison-key rule for unresolved/free-form cases

Status: partial

### Workstream B: store and migration layer

- add migration(s) for trust target/run storage
- add narrow store helper(s) for save/load/list operations
- keep large answer payloads referenced through existing answer trace storage where possible

Status: shipped

Still to add in this workstream:

- canonical and raw packet hash columns/fields
- stable nullable environment fingerprint storage
- any small supporting columns needed for target identity hardening

### Workstream C: write-path integration

- hook trust-run persistence into the existing answer save path
- ensure benchmark/eval writes can use the same path with explicit provenance
- avoid double writes for the same answer event

Status: shipped

Still to add in this workstream:

- deterministic-family structured identity writes
- fallback identity writes for unresolved/free-form runs
- canonical packet hashing
- environment fingerprint capture

### Workstream D: read APIs

- fetch trust run by id
- fetch latest comparable run
- list comparable run history
- fetch the comparable target metadata itself

Status: shipped

### Workstream E: baseline tests

- unit coverage for comparison-key normalization
- persistence tests for save/load/list
- regression tests proving comparable and non-comparable cases stay distinct

Status: first pass shipped via `test/smoke/trust-backbone.ts`

### Workstream F: canonicalization contract

- define the canonical packet strip list for volatile fields
- define the raw packet hash alongside the canonical hash
- keep these rules documented so 4.2 compare logic inherits one baseline instead of reinventing it

## File Plan

### Likely modify

- `packages/contracts/src/answer.ts`
- `packages/store/src/migration-sql.ts`
- `packages/store/src/project-store.ts`
- `packages/store/src/project-store-queries.ts`
- new narrow trust store helper(s) under `packages/store/src/`
- any narrow API/schema exports needed for trust-record access
- any answer/composer seam that can already provide deterministic target identity

### Reuse

- `packages/tools/src/answers/index.ts`
- `packages/tools/src/composers/_shared/packet.ts`
- existing answer trace save/load seams

### Likely add

- one store split file for trust writes/queries
- one test file focused on comparison-key normalization and round-trip persistence

Shipped additions:

- `packages/store/src/project-store-trust.ts`
- `test/smoke/trust-backbone.ts`

## Acceptance Criteria

This phase is complete when:

- comparable answer identity is defined explicitly and documented
- trust records persist locally through the existing store layer
- later phases can query comparable prior runs without inventing their own storage
- no second public answer contract was introduced
- the save path for shipped answer packets can emit trust-run records without changing answer semantics
- there are tests proving the same target links across reruns and different targets do not

Current status against those criteria:

- persisted trust records: done
- public store history reads: done
- save-path integration: done
- baseline tests: done
- final identity/shape lock: remaining
- canonical/hash/fingerprint substrate: remaining

## Risks

- **Over-modeling.** The trust record should be small and real, not a speculative ontology.
- **Identity drift.** If comparison identity is too weak, later contradiction logic will be noisy; if too strict, comparable reruns will never link.
- **Bootstrap key ossification.** If the fallback `queryText` key becomes the de facto permanent identity, later phases will inherit avoidable blind spots.
- **Parallel answer system.** If trust state forks away from the shipped answer layer, the roadmap has already failed.
- **Payload duplication.** If trust storage starts copying full answer payloads indiscriminately, storage and migration complexity will drift fast.
- **Hash noise.** If canonicalization is not defined here, later compare logic will inherit volatile packet churn.
- **Missing historical context.** If freshness/environment fingerprint is not captured at write time, later stale/drift interpretation will guess.

## Verification Plan

This phase should ship with concrete verification, not only docs.

### Minimum checks

- normalize the same target twice and prove the comparison key is stable
- normalize nearby but different targets and prove the keys differ
- save a trust run and reload it through the public store surface
- save multiple comparable runs and verify ordering/history lookup
- prove an existing answer trace can be linked without duplicating the answer contract
- prove a deterministic family writes a structured target identity payload
- prove unresolved/free-form fallback still yields stable trust history
- prove canonical and raw packet hashes can differ when only volatile fields change
- prove environment fingerprint shape stays stable when fields are null

Current verification already landed:

- `corepack pnpm run typecheck`
- `node --import tsx test/smoke/trust-backbone.ts`
- `node --import tsx test/smoke/composer-trace-file.ts`
- `node --import tsx test/smoke/harness-calls-registry-tool.ts`
- `node --import tsx test/smoke/core-mvp.ts`

### Good stress cases

- same `trace_file` target across two different sessions
- same `ask` target reached through different vague phrasing
- schema-qualified versus unqualified table/RPC references
- overload-aware RPC identity where supported by Roadmap 3 substrate

## Exit State For 4.1 And 4.2

When 4.0 is done, 4.1 and 4.2 should be able to assume:

- there is one stable comparable-target key
- every saved answer run can be located by that key
- trust history can be queried without scraping benchmark tables or session logs
- future comparison output can hang off real trust runs instead of bespoke temporary structures
- canonical packet identity exists as a stable baseline for later diff work
- environment fingerprint is already available for later stale/drift interpretation

## Immediate Starting Files

- `packages/contracts/src/answer.ts`
- `packages/store/src/project-store.ts`
- `packages/store/src/project-store-trust.ts`
- `packages/store/src/migration-sql.ts`
- `packages/tools/src/composers/_shared/packet.ts`
- `test/smoke/trust-backbone.ts`
- `devdocs/roadmap/version-4/roadmap.md`
- `devdocs/roadmap/version-4/handoff.md`
