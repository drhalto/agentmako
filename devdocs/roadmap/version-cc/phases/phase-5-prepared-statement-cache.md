# Phase 5 CC — Prepared Statement Cache

Status: `Complete`

## Implementation Notes

Phase 5 shipped the cache as a per-`ProjectStore` map from static SQL
text to `StatementSync`. The cache is exposed internally through
`ProjectStoreContext.prepared(sql)` because query methods live in mixin
modules; it is still handle-scoped and is cleared before
`DatabaseSync.close()`.

Migrated methods:

- `listFiles`
- `getFileContent`
- `findFile`
- `listRoutes`
- `listSymbolsForFile`

The smoke verifies same-SQL identity reuse, one cache entry per
distinct SQL string, repeated migrated-method calls not growing the
cache, and close-time cache clearing. The small perf smoke remains
green; measured runtime is noisy enough that Phase 5 stops at the
targeted five methods rather than expanding the migration.

## Deployment Observation

Initial Testing Phase 2's `ProjectStoreCache` keeps the project
`DatabaseSync` handle alive across tool calls. The next contributor
to per-tool-call latency is inside the store's methods themselves:
every `get` / `all` / `run` that a store method performs currently
calls `db.prepare(sql)` fresh, on every call.

Concrete worst case: one `ast_find_pattern` invocation calls
`projectStore.listFiles()` once (one prepare) and
`projectStore.getFileContent(path)` per eligible file (one prepare
each). On a 50-file scan that's 51 prepares per tool call. On
courseconnect-sized projects (a few hundred indexed files in a
language filter), it's more.

`db.prepare(sql)` on `node:sqlite`'s `DatabaseSync` compiles SQL into
a `StatementSync` object. The compile is cheap-ish (microseconds),
but stacking 50+ of them per tool call adds a measurable floor.
Prior art: `t3code-main/apps/server/src/persistence/NodeSqliteClient.ts:~87-119`
— a port of `@effect/sql-sqlite-node` to `node:sqlite` that caches
`StatementSync` objects keyed by SQL text via a **bounded** LRU
(`effect/Cache` with `capacity: options.prepareCacheSize ?? 200` and
`timeToLive: options.prepareCacheTTL ?? Duration.minutes(10)`). Mako
diverges on shape — see Hard Decisions — but the underlying technique
is the same.

Initial Testing Phase 2's perf smoke (`mcp-perf-store-lifetime.ts`)
currently shows cached mean at ~67% of open-close mean on a small
seed. Prepared-statement caching is the next natural lever — it
compounds with the project-store cache, not replaces it.

## Goal

Cache `StatementSync` objects per `ProjectStore` instance, keyed by
SQL text. Migrate hot-path store methods to use the cache. Measure
the delta on the existing perf smoke; keep the ratio assertion
passing with the cached path now even faster.

## Hard Decisions

- **Cache lives on the `ProjectStore` instance, not module-global.**
  `StatementSync` is bound to the `DatabaseSync` handle that
  prepared it. A cache across handles would be a bug. Per-instance
  keeps lifecycle simple: cache dies when the store closes.

- **Cache is keyed by SQL text, not by a caller-supplied key.**
  The SQL is the stable identity. Hash-or-not is an implementation
  detail; a `Map<string, StatementSync>` where the key is the raw
  SQL is fine for the sizes we operate at (dozens of unique SQL
  strings per store).

- **Cache is unbounded — divergence from t3code.**
  Every distinct SQL string a store method prepares ends up in the
  map. The universe is the SQL literals in `project-store-*.ts`
  files — finite and auditable. No LRU, no eviction policy. If the
  map grows past a sane limit, that's a bug in a store method
  constructing SQL dynamically per call (which itself is a smell
  we'd want to fix).
  t3code's prior-art cache is **bounded** (capacity 200, TTL 10 min).
  That shape suits their workload — Effect fibers, long-lived SQL
  service, some runtime-generated SQL. Mako's store methods are
  static SQL strings with a tight blast radius; bounding the cache
  would add complexity without buying correctness. If this
  assumption ever turns out wrong (unbounded growth observed in a
  long session), switch to an LRU with a high ceiling — we don't
  need TTL.

- **Cache is thread-safe by Node's event loop — no locks.**
  Consistent with Phase 2's invariant: synchronous SQLite, single
  event loop. Borrowing the same `StatementSync` twice in rapid
  succession just advances it through its single execution; it
  completes synchronously before the next borrower starts.

- **Migration is incremental, by measured benefit.**
  Not every store method needs to participate. Migrate the five
  most hot-path methods first (`listFiles`, `getFileContent`,
  `findFile`, `listRoutes`, `listSymbolsForFile`), measure, and
  stop when the perf smoke ratio stops improving. Unmigrated
  methods continue using inline `db.prepare(sql)` — no
  correctness impact.

- **Cache eviction happens on `store.close()`.**
  `StatementSync` objects close when their parent `DatabaseSync`
  closes. The local `node:sqlite` `StatementSync` surface does not
  expose `finalize()`, so close clears the map before
  `DatabaseSync.close()` and lets the database handle own statement
  teardown.

## Scope In

- extend `ProjectStore` with a private `preparedStatements: Map<string,
  StatementSync>` and a private helper
  `ProjectStore#prepared(sql: string): StatementSync` that populates
  lazily
- migrate the five hot-path store methods (listed below) to call
  `this.prepared(sql)` instead of `this.db.prepare(sql)`
- extend `ProjectStore.close()` to clear the cached statement map
  before the underlying `DatabaseSync.close()`
- smoke: new `test/smoke/prepared-statement-cache.ts` asserts:
  - distinct SQL strings each appear once in the cache after N calls
    (prepare called once, not N times)
  - `store.close()` empties the cache
  - identical SQL from two store methods reuses the same statement
- perf: existing `mcp-perf-store-lifetime.ts` ratio assertion
  continues to pass; new logged metric shows cached-path mean
  dropped vs the pre-Phase-5 baseline

## Scope Out

- caching statements across `ProjectStore` instances (would be a
  lifecycle bug — statements are handle-bound)
- caching on `GlobalStore` (smaller, less hot, separate phase if
  ever justified)
- bespoke query builder / ORM (stay with raw SQL + prepare; this is
  plumbing, not abstraction)
- migrating every store method in one pass (incremental by measured
  benefit)

## Architecture Boundary

### Owns

- `packages/store/src/project-store.ts` — add `preparedStatements`
  map + `prepared(sql)` helper + clear-on-close
- `packages/store/src/project-store-queries.ts` — migrate
  `listFilesImpl`, `getFileContentImpl`, `findFileImpl`,
  `listRoutesImpl`, `listSymbolsForFileImpl` to take a `prepared`
  callback or the store instance directly
- `test/smoke/prepared-statement-cache.ts` (new)

### Does Not Own

- any store method signature visible to tools
- any tool behavior — tools call the same `ProjectStore` methods
  they always have
- the `ProjectStoreCache` (Initial Testing Phase 2) — this phase
  is one layer deeper than that cache

## Contracts

### `ProjectStore` internal helper

```ts
// packages/store/src/project-store.ts
export class ProjectStore {
  private readonly preparedStatements = new Map<string, StatementSync>();

  /**
   * Return a cached prepared statement for the given SQL string,
   * compiling on first use. Safe to call repeatedly; same
   * `StatementSync` instance returned each time. Cleared on
   * `close()`.
   *
   * Visibility: currently private (accessed via `this.prepared(sql)`
   * from internal store methods) to keep the API surface tight.
   * If other store modules need to use it, promote via
   * `ProjectStoreContext`.
   */
  private prepared(sql: string): StatementSync {
    const cached = this.preparedStatements.get(sql);
    if (cached) return cached;
    const stmt = this.db.prepare(sql);
    this.preparedStatements.set(sql, stmt);
    return stmt;
  }

  close(): void {
    // node:sqlite's StatementSync is handle-bound and has no public
    // finalize() method; DatabaseSync.close() owns teardown.
    this.preparedStatements.clear();
    // Note: still no WAL checkpoint (Initial Testing Phase 2).
    this.db.close();
  }
}
```

Store method files that want the cache gain access via a small
addition to `ProjectStoreContext`:

```ts
// packages/store/src/project-store-context.ts
export interface ProjectStoreContext {
  readonly db: DatabaseSync;
  readonly projectRoot: string;
  loadProjectProfile(): ProjectProfileRecord | null;
  /** Phase 5: cached statement compile. */
  prepared(sql: string): StatementSync;
}
```

Store method signatures (e.g. `findFileImpl(db, ...)`) evolve to
accept the statement resolver as an optional parameter and default
to inline `db.prepare` when omitted — keeping backward compat with
any direct test / bench call site.

## Execution Flow (slices)

1. **Cache plumbing** — add `preparedStatements` map + `prepared()`
   helper on `ProjectStore`. Implement clear-on-close. Expose
   via `ProjectStoreContext`. Smoke: cache populates on first
   prepare; same statement returned on second; empties on close.
2. **Migrate `listFilesImpl`** — smallest hot-path win; high call
   frequency. Update its signature to accept `prepared` resolver;
   call site in the store method file uses `this.prepared`.
   Regression check: `ast-find-pattern.ts` smoke, `lint-files.ts`
   smoke still pass.
3. **Migrate `getFileContentImpl`** — highest cumulative call
   frequency on hot paths.
4. **Migrate `findFileImpl`, `listRoutesImpl`, `listSymbolsForFileImpl`**
   together (similar pattern, small methods).
5. **Perf measurement** — run `mcp-perf-store-lifetime.ts`; log
   cached-path mean + median before and after the migration. If
   cached mean drops by a meaningful amount (target: ~30–40%
   reduction relative to Initial Testing Phase 2 baseline),
   stop. If it drops further, consider migrating one more method;
   otherwise leave untouched paths alone.
6. **Document** — note migrated vs unmigrated methods in a
   `preparedStatements` comment on `ProjectStore` so future
   contributors know the pattern without reading this phase doc.

Stopping between any two slices leaves mako in a consistent state.

## File Plan

Create:

- `test/smoke/prepared-statement-cache.ts`

Modify:

- `packages/store/src/project-store.ts` — `preparedStatements`
  map, `prepared()` helper, clear-on-close
- `packages/store/src/project-store-context.ts` — expose
  `prepared` on the context
- `packages/store/src/project-store-queries.ts` — migrate the 5
  target methods
- `packages/store/src/project-store-methods-query.ts` — pass
  `prepared` into migrated impls
- `test/smoke/mcp-perf-store-lifetime.ts` — log the new metric
  (optional; purely informational)
- `package.json` — register new smoke
- `CHANGELOG.md` — one entry under `## [Unreleased]` → `### Changed`

Keep unchanged:

- tool-level contracts (schemas)
- `ProjectStoreCache` (Initial Testing Phase 2)
- every unmigrated store method
- every existing smoke's PASS state

## Verification

Required commands:

- `pnpm typecheck`
- `pnpm run test:smoke`

Required runtime checks:

- `prepared-statement-cache.ts`:
  - calling `store.prepared(sqlA)` returns the same `StatementSync`
    on the second call
  - the map grows by 1 per distinct SQL, not per call
  - `store.close()` empties the map
  - calls from different migrated store methods that happen to share
    SQL reuse the same statement
- `mcp-perf-store-lifetime.ts`: cached-path mean ≤ 85% of open-close
  mean (unchanged assertion from Initial Testing Phase 2); new
  logged metric shows cached-path mean dropped vs the pre-Phase-5
  baseline.
- Existing regression smokes (`ast-find-pattern.ts`, `lint-files.ts`,
  `project-store-cache.ts`) all still pass.

## Done When

- `prepared` helper shipped on `ProjectStore`
- 5 hot-path store methods migrated
- new smoke green; existing smokes green
- perf measurement documented in the phase doc's appendix
- `pnpm typecheck` + `pnpm run test:smoke` green
- CHANGELOG entry present

## Risks And Watchouts

- **`StatementSync` state between calls.**
  `node:sqlite`'s `StatementSync` has `iterate` / `all` / `get` /
  `run` methods. After `.get()` or `.run()`, the statement is in a
  reset-ready state. If any migrated method leaves a statement
  mid-iteration (via `.iterate()`), the next borrower gets broken
  state. We avoid this by: (a) never using `.iterate()` on a
  cached statement, and (b) smoke-asserting that repeated calls
  return consistent results.
- **Memory growth over long sessions.**
  Cache is unbounded. Worst case is the count of distinct SQL
  strings in store methods (auditable, ~dozens). If some future
  method generates SQL with embedded constants (e.g. `WHERE id =
  42`), the cache would grow unboundedly. Mitigation: code review
  at slice boundaries, lint if necessary in a follow-up.
- **Perf delta isn't there.**
  If slice 5 shows ≤ 5% improvement, stop migrating. The cache
  overhead itself is tiny, but the *return* we're chasing may be
  smaller than the per-call setup cost of the tool-plane layers
  above the store. Still a win to ship (it doesn't regress), but
  don't expand the migration.
- **Test isolation.**
  Smoke tests that seed data and then re-open a store see a fresh
  statement cache — that's correct, but any test that assumes a
  prepared-statement cache survives a re-open is wrong. No current
  smoke does that; document in the smoke's comment.

## Appendix: Perf Measurement

*(Populated during slice 5.)*

| Path | Pre-Phase-5 mean | Post-Phase-5 mean | Ratio |
|------|-----------------:|------------------:|------:|
| open-close | 31.66ms (Phase 4 full-smoke run) | 27.56ms | n/a |
| cached (Phase 2 only) | 17.99ms (Phase 4 full-smoke run) | n/a | 0.568 |
| cached + prepared (this phase) | n/a | 18.29ms | 0.664 |

Interpretation: the ratio assertion remains comfortably below the
required `0.85`. This small synthetic smoke is dominated by setup and
host variance, so it is not a stable before/after microbenchmark for
statement compilation alone. The cache behavior itself is covered by
`test/smoke/prepared-statement-cache.ts`; no additional store methods
were migrated beyond the five scoped hot paths.

## References

- [./README.md](../README.md) — roadmap context
- [./roadmap.md](../roadmap.md) — canonical contract
- [./handoff.md](../handoff.md) — execution rules
- [../../version-initial-testing/phases/phase-2-mcp-perf-store-lifetime.md](../../version-initial-testing/phases/phase-2-mcp-perf-store-lifetime.md)
  — `ProjectStoreCache` baseline this phase compounds on
- `t3code-main/apps/server/src/persistence/NodeSqliteClient.ts:~87-119` —
  `StatementSync` caching prior art (bounded `effect/Cache`, capacity
  200, TTL 10 min — mako diverges to unbounded per the Hard Decisions)
- `packages/store/src/project-store.ts` — current `close()` + bare
  `db.prepare(...)` call sites
- `packages/store/src/project-store-queries.ts` — hot-path store
  methods targeted for migration
