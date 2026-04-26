# Phase 2 CC — Parallel Execution Safety

Status: `Complete`

## Deployment Observation

Claude Code fans out adjacent read-only tool calls in a single model
turn up to `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` (default **10**).
`CC/services/tools/toolOrchestration.ts:84-115` — `partitionToolCalls`
groups consecutive `isConcurrencySafe` blocks into a batch that runs
via `Promise.all`-style concurrency. In practice an agent that fires
`graph_path` + `schema_usage` + `lint_files` + `cross_search` in one
turn will have all four mako tool calls executing simultaneously in
the stdio subprocess.

Initial Testing Phase 2 introduced `ProjectStoreCache`
(`packages/store/src/project-store-cache.ts`). Every concurrent tool
call through the same MCP session borrows the **same** `ProjectStore`
handle — one `DatabaseSync` instance shared across all of them. Today
there is:

- **no smoke coverage** for concurrent `invokeTool` under a shared
  cache
- **no explicit documentation** of the serialization model we rely
  on (Node's single event loop, `DatabaseSync`'s synchronous
  prepare/step semantics)
- **no audit** of whether any store method does `await` between
  `db.prepare()` and `statement.all()` / `statement.get()`, which
  would interleave operations on the shared handle

The risk isn't hypothetical race conditions — `node:sqlite`'s
`DatabaseSync` API is synchronous, and Node's single event loop
serializes any call stack that doesn't await. The risk is a
**latent interleaving bug** introduced by a future refactor that adds
an `await` inside a store method, silently breaking under load only
when two tool calls hit it concurrently. A smoke that exercises the
concurrent path today makes that class of bug loud instead of silent.

## Goal

Prove the current cached-store + parallel-invocation path is correct,
document the invariants we rely on, and add regression coverage so
future refactors can't break it silently.

This is verification-and-harden work. No runtime behavior change —
the shipped concurrency path is already correct under today's store
methods. The deliverable is coverage + docs.

## Hard Decisions

- **Serialization guarantee comes from Node's event loop, not from
  mako.**
  Every store method in
  `packages/store/src/project-store-*.ts` uses synchronous
  `db.prepare(sql).get(...)` / `.all(...)` / `.run(...)` calls. As
  long as no store method `await`s between `db.prepare(...)` and the
  final `.get()` / `.all()` / `.run()`, Node guarantees sequential
  execution per handle. The phase codifies this as an explicit
  invariant in the cache's JSDoc so future contributors can't
  accidentally break it.

- **No per-store lock added.**
  Adding a mutex would be wrong: synchronous SQLite already serializes
  per handle within a single event-loop tick, and an explicit lock
  would just add overhead. If we ever need true concurrency across
  handles, that's a pool (one handle per worker), not a lock.

- **One concurrency smoke, covering two axes.**
  Axis 1: correctness — fire N parallel `invokeTool` calls; every
  call returns the same result it would have returned alone. Axis 2:
  stress — fire 20+ parallel calls under a shared cache; assert no
  exceptions, no corrupted state, no orphan handles.

- **`await` inside store methods is the audit line.**
  Slice 1 is a mechanical grep of `packages/store/src/*.ts` for
  `async function` + `await` inside prepare/get/all/run blocks.
  Zero tolerance: if any method does `await` between prepare and
  finalize, flag it in the phase doc and either rewrite it to be
  synchronous or explicitly note it as a follow-up.

- **Test runs concurrent invokeTool, not concurrent DB calls.**
  The value of the smoke is at the tool-plane level — that's the
  surface CC hits. A store-method-level concurrency smoke is a
  separate (less useful) test.

## Scope In

- audit `packages/store/src/*.ts` for any `async` boundaries between
  `db.prepare` and statement finalization; document findings in the
  phase doc appendix
- add explicit "synchronous per handle" JSDoc invariant to
  `ProjectStoreCache` in
  `packages/store/src/project-store-cache.ts`
- new smoke: `test/smoke/mcp-parallel-tool-execution.ts` — seed a
  project, fire N parallel `invokeTool` calls through a shared
  `projectStoreCache`, assert correctness and robustness
- extend perf smoke or add a stress-mode to assert 20+ concurrent
  calls don't blow through some threshold (e.g. no exception; total
  wall-clock roughly N × per-call cost if serialized, which tells us
  whether fan-out bought anything given SQLite's per-handle lock)

## Scope Out

- multi-handle pooling per project (would be a real perf change,
  separate phase if ever justified)
- adding process-level concurrency primitives — workers,
  `node:worker_threads`, etc.
- rewriting any currently-correct store method
- HTTP transport concurrency (request-scoped; different shape,
  separate phase if ever needed)
- testing concurrent WRITES from multiple MCP sessions against the
  same DB (separate concern; WAL mode + `busy_timeout` already
  handles it)

## Architecture Boundary

### Owns

- `packages/store/src/project-store-cache.ts` — JSDoc additions
  documenting the synchronous-per-handle invariant
- `test/smoke/mcp-parallel-tool-execution.ts` (new)
- audit notes in this phase doc appendix

### Does Not Own

- any store method behavior (this is verification, not change)
- the MCP SDK's request dispatch semantics (already correct; the
  SDK hands us sequential calls within its single handler)
- CC's concurrency scheduler (`partitionToolCalls`) — we observe
  its output, we don't change its input

## Contracts

No new types. The phase is verification + smoke + JSDoc. Surface of
`ProjectStoreCache` and `withProjectContext` stays identical.

## Execution Flow (slices)

1. **Store-method audit** — grep every file under
   `packages/store/src/` for `async function` within classes that
   operate on `this.db`. For each hit, confirm no `await` separates
   `db.prepare(...)` from its final `.get()` / `.all()` / `.run()`.
   Record the result (expected: zero violations). If any violation
   exists, document it and decide in-phase whether to rewrite or
   defer.
2. **JSDoc invariant** — update `ProjectStoreCache` header to state
   explicitly: *"Pooled stores are a single shared handle per
   project. Concurrent `borrow()` from multiple tool-plane invokers
   is safe only because every store method completes its DB access
   synchronously — no `await` between `db.prepare()` and statement
   finalization. Future contributors must preserve this invariant."*
3. **Concurrency correctness smoke** — new
   `test/smoke/mcp-parallel-tool-execution.ts`:
   - seed a moderately-sized project (50 files, indexed)
   - create a `ProjectStoreCache`
   - fire 5 parallel `invokeTool("ast_find_pattern", ...)` calls with
     the same projectId
   - assert each returns the same match count and identical match
     fingerprints
   - run the same assertion for a heterogeneous mix:
     `ast_find_pattern`, `lint_files`, `repo_map`,
     `imports_deps`, `schema_usage`
   - close the cache; assert no errors
4. **Stress mode** — same smoke, crank to 20 parallel calls. Assert
   no exceptions; total wall-clock is within a loose regression bound:
   `max(10_000ms, one_call_ms × 20 × 4)`. The bound intentionally
   catches hangs and severe serialization regressions without turning
   CI host noise into flakes.

Each slice is independently verifiable. Slice 1's finding may loop
back into a correction commit before slices 3–4 land.

## File Plan

Create:

- `test/smoke/mcp-parallel-tool-execution.ts`

Modify:

- `packages/store/src/project-store-cache.ts` — JSDoc addition
- `package.json` — register smoke
- `CHANGELOG.md` — one entry under `## [Unreleased]` → `### Changed`
  (this is a hardening change, not a feature)
- this phase doc — appendix with audit findings after slice 1

Keep unchanged:

- every store method implementation
- every tool implementation
- `ProjectStoreCache` API

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required runtime checks:

- audit appendix lists every `async` store method reviewed with a
  one-line verdict per method (`safe — no await between prepare and
  finalize`, or a specific violation + disposition)
- parallel smoke: 5 concurrent `ast_find_pattern` calls return
  bitwise-identical match sets (same `ackableFingerprint` for the
  same matches across all 5 returns)
- parallel smoke: heterogeneous 5-tool mix completes with no
  exceptions
- stress mode: 20 concurrent calls complete; total wall-clock under
  documented threshold
- ProjectStoreCache JSDoc contains the synchronous-per-handle
  invariant text

## Done When

- audit appendix populated in this phase doc
- JSDoc invariant documented on `ProjectStoreCache`
- new smoke green (correctness + stress)
- existing smokes (including `project-store-cache.ts` and
  `mcp-perf-store-lifetime.ts`) still green
- `pnpm typecheck` + `pnpm run test:smoke` green
- CHANGELOG entry present

## Risks And Watchouts

- **Slice 1 uncovers a real violation.**
  If some existing store method does `await` between prepare and
  finalize, this phase needs either a rewrite or a narrowly-scoped
  correction commit. Don't paper over it with a mutex — either
  rewrite the method to complete synchronously, or isolate the
  violation in its own fresh-store path.
- **Stress smoke flakes on CI.**
  20 concurrent calls + a threshold assertion is a classic flake
  source. Mitigate by asserting *ratio* (N-call wall-clock / 1-call
  wall-clock) rather than absolute ms, and by giving a loose upper
  bound (say, 6× serial) so only real regressions trigger it.
- **Claude Code raises concurrency from 10.**
  `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` is configurable and could
  rise. The phase's stress mode at 20 already gives headroom, but
  the upper bound is worth revisiting if CC's default changes.
- **Future store methods with genuine async work** (e.g. file IO,
  network calls before a DB write) — when those arrive, they can't
  just borrow a cached store and interleave with prepare/finalize.
  The phase's invariant catches that at the contributor's JSDoc
  read; a lint rule is a future follow-up if violations appear in
  practice.

## Appendix: Store Method Audit

Audit command:

- `rg -n "\basync\b|\bawait\b" packages\store\src -S`

Result: no matches.

Verdict:

- No store-layer file under `packages/store/src` contains `async` or
  `await`, so there are no `async`-capable store methods to review.
- `packages/store/src/project-store.ts` and every
  `project-store-*.ts` accessor module currently satisfy the Phase 2
  invariant: no method can yield between `db.prepare()` and the final
  `.get()` / `.all()` / `.run()`.
- `packages/tools/src/tool-invocation-logging.ts` is outside the
  store-layer audit. It borrows `ProjectStoreCache` when one is
  provided and otherwise keeps the open-close fallback, so tool-run
  writes do not weaken the shared cached-store read invariant.
- Future changes that introduce store-layer `async` / `await` must
  rerun this audit and either preserve synchronous statement
  finalization or avoid the shared-cache path.
- Implemented stress threshold:
  `max(10_000ms, one_call_ms × 20 × 4)` for the 20-call
  `ast_find_pattern` fan-out.

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- [./phase-1-tool-discoverability.md](./phase-1-tool-discoverability.md)
- [../../version-initial-testing/phases/phase-2-mcp-perf-store-lifetime.md](../../version-initial-testing/phases/phase-2-mcp-perf-store-lifetime.md)
  — `ProjectStoreCache` origin
- `CC/services/tools/toolOrchestration.ts:84-115` —
  `partitionToolCalls` + `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`
- `CC/services/tools/StreamingToolExecutor.ts:77-188` — CC's
  streaming executor that drives concurrent tool calls
- `packages/store/src/project-store-cache.ts` — current cache
  implementation
- `packages/tools/src/entity-resolver.ts:137` —
  `withProjectContext` cache borrow
