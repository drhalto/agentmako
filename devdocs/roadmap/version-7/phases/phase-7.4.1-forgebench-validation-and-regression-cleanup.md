# Phase 7.4.1 Forgebench Validation And Regression Cleanup

Status: `Complete`

## Goal

Run the shipped 7.0–7.4 artifact stack against a real project
(`forgebench`) and fix every gap that surfaces. Close real correctness
and UX bugs before 7.5 starts measuring "is any of this useful."

7.4.1 is **not** a new-feature phase. It exists because the post-7.4
forgebench sweep turned up a chain of issues that, once fixed, made the
difference between "artifacts validate" and "artifacts carry real,
actionable, project-specific content."

## Rules

- pin every fix to a concrete signal observed in the forgebench run
- no speculative generalization — if a fix isn't driven by a real
  observation, defer it
- prefer a graceful degrade over a hard failure when real project state
  produces unusual inputs (empty graph paths, session-less runs)
- the full smoke suite stays green after every fix

## Product Boundary

This phase should answer:

- when the shipped 7.0–7.4 tools run against a realistic Next.js +
  Supabase project, do they produce content a developer would act on?
- where does the stack hit corners the synthetic smokes missed?

This is a repair phase. It should close gaps, not open new surfaces.

## Non-Goals

- no new artifact families
- no new tool registrations
- no new wrapper surfaces
- no eval infrastructure (that's 7.5)
- no learned rollout logic

## Success Criteria

- the four artifact families produce non-empty, project-specific output
  against a real route→table pair
- operator findings carry correctly-formatted references without
  cosmetic noise or duplicate bullets
- the full `pnpm test:smoke` suite is green
- every fix has regression smoke coverage

## Current Shipped Slice

All findings from `forgebench-triage.md` closed. Six named findings
plus one pre-existing FTS regression fixed during this phase.

### Forgebench triage findings (artifact-layer surface)

- **Finding 3 — graceful empty-surface rendering.** Relaxed the
  `.min(1)` schema on `likelyMoveSurfaces` / `reviewSurfaces` and
  updated the markdown renderers to emit a clear empty-state message
  (`_No graph-derived <…> surfaces — widen traversalDepth, pick closer
  entities, or verify the graph indexes the start/target kinds._`) when
  `change_plan` legitimately returns zero surfaces. The artifact still
  ships; callers see a real hint instead of a generic validation error.
- **Finding 5 — session focus in `implementation_handoff`.** The
  generator now prepends `Current focus: <queryText> — <reason>` to
  `keyContext` (tagged to the `session_handoff` basis ref) when one
  exists, and appends a session-momentum summary when the session has
  unresolved queries or active follow-ups. Brief-derived entries fill
  remaining capacity. Session-less sessions still produce a clean
  handoff; the new entries only appear when there's real state to
  surface.

### Forgebench triage finding 1 — graph-layer repairs (three chained bugs)

- **Route locator normalization.** `normalizeGraphNodeLocator` now
  accepts human-friendly forms (`"GET /api/events"`,
  `"/dashboard/admin"`) and resolves them against
  `projectStore.listRoutes()` to the stored `route:<pattern>:<method>`
  / `page:<pattern>` keys. Already-stored keys pass through unchanged.
- **RPC locator normalization.** `resolveGraphNodeLocator` falls back
  to prefix-matching on `<schema>.<name>(` when exact match fails,
  preferring the no-arg overload and falling back to the
  alphabetically-first variant for determinism.
- **RPC body extraction (the real indexer bug).** Two nested causes:
  `extractPgObjectsFromSql` anchored its head regex at `^\s*CREATE`,
  which failed for every Supabase-flavoured migration that prefixes a
  statement with a `-- ========== name ==========` banner; fixed by
  stripping leading whitespace + comments before head matching while
  preserving the original text for dollar-quoted body extraction.
  Then `mergeIRInto` in `schema-snapshot.ts` merged `argTypes` and
  `returnType` across schema sources but never `bodyText`, so a
  `generated_types` entry (from `types/supabase.ts`, which carries no
  body) was the merge winner and silently discarded the SQL-extractor
  body; fixed by adding `bodyText` to the merge policy.

### Post-Finding-1 artifact re-read (operator cleanup)

- **Finding A — operator finding dedup.** The artifact composer now
  dedupes tenant-audit findings by message before projecting into
  `weakOperatorSignals` / `directOperatorFindings`. Same call site
  touching multiple protected tables previously rendered as duplicate
  bullets.
- **Finding B — schema double-qualification.**
  `collectRpcFindings` built `rpcSurfaceKey` as
  `${schema}.${buildRpcKey(...)}` but `buildRpcKey` already embeds the
  schema, producing `public.public.name(...)` in every RPC finding
  message and breaking cross-linking with graph rpc node keys. Fixed:
  single-qualified, aligned with graph keys.
- **Finding C — non-code RPC usage false positives.**
  `collectSchemaUsages` previously scanned every indexed file's
  content for `\b<rpcName>\b`, so markdown docs like
  `docs/benchmark-answer-key.md` that merely *mention* RPC names
  produced false usage references. A `SCHEMA_USAGE_CODE_LANGUAGES`
  allowlist now restricts scanning to typescript / tsx / javascript /
  jsx / esm / commonjs / sql.

### Full-smoke regression (pre-existing, uncovered by this pass)

- **`chunks.search_text` missing symbol-name expansion.** A regression
  smoke (`test/smoke/tool-call-legacy-chunk-fts.ts`) was failing even
  at `HEAD~1` — meaning it pre-dated this phase's scope. Rather than
  defer, fixed it: `buildChunkSearchText` now folds each file's symbol
  names through the existing camelCase-aware splitter, so an
  identifier like `loadUsers` becomes reachable via a natural phrase
  search (`"load users"`). Both the fresh-insert path
  (`replaceIndexSnapshot`) and the legacy-repair backfill
  (`backfillChunkSearchTextImpl`) build the same symbol-aware
  search_text — legacy project DBs heal on next store open.

## Measured Impact Against Forgebench

Before/after the 7.4.1 fixes, same sweep same project:

| tool                           | before                          | after                                                 |
|--------------------------------|---------------------------------|-------------------------------------------------------|
| `graph_path` route→table       | `disconnected`                  | `pathFound=true, hops=3, heuristic=true`              |
| `flow_map` route→table         | `steps=0`                       | `steps=4, boundaries=[entry,file,rpc,data]`           |
| `change_plan` route→table      | `direct=0, dependent=0`         | `direct=4, dependent=6, steps=10`                     |
| `tenant_leak_audit`            | `direct=0, weak=0`              | `direct=4, weak=20` (down from 32 noisy to 20 real)   |
| `task_preflight_artifact`      | `surfaces=0` (empty-state)      | `surfaces=5, readFirst=4, verify=4, risks=1`          |
| `review_bundle_artifact`       | `surfaces=0, direct=0, weak=0`  | `surfaces=5, checks=3, direct=4, weak=4`              |
| `verification_bundle_artifact` | `direct=0`                      | `direct=4`                                            |
| `function_table_refs` table    | 0 rows                          | 9 rows (rpc → table edges)                            |
| docs-file RPC false positives  | several                         | 0                                                     |
| `public.public.` in messages   | every RPC finding               | 0                                                     |

The `tenant_leak_audit` weak-signal count dropping from 32 to 20 is the
cleanest single indicator: the 32 was mostly markdown-doc noise and
duplicate-per-table entries; the 20 is real call-site findings minus
that false-signal. Four direct operator findings now surface in
`review_bundle` because they're no longer crowded out by duplicate
weak signals in the `slice(0, 4)` cap.

## Verification

- `test/smoke/artifacts-contract.ts` — contract-level assertions, plus
  the 7.0 refinements exercised through the export/consumer-target flip.
- `test/smoke/artifact-generators.ts` — empty-surface graceful render
  for task_preflight and review_bundle; session-focus + session-momentum
  entries in implementation_handoff keyContext; duplicate-message dedup
  on tenant-audit findings.
- `test/smoke/artifact-file-export.ts` — file export path still clean
  against the richer content.
- `test/smoke/graph-tools.ts` — route and RPC locator normalization
  against real-indexer key formats (including page routes, method case
  insensitivity, and no-arg RPC overload preference).
- `test/smoke/tenant-leak-audit.ts` — Finding B regression (no
  `public.public.` in surface keys or finding messages).
- `test/smoke/schema-scan-usage.ts` (new) — Finding C regression
  (typescript/sql files tracked, markdown/yaml excluded).
- `test/smoke/tool-call-legacy-chunk-fts.ts` — symbol-aware
  `search_text` repair path.
- `pnpm test:smoke` — full suite green (~50 smokes) after every fix.

## Follow-Up State

- **Triage findings 2 + 4** (packet prose quality, review_bundle
  distinctness) remain open as 7.5 eval questions. With the graph and
  operator fixes landed, the artifacts now carry real project-specific
  structural content, so the earlier "is this useful over raw packets?"
  concern is better answered by measured usage data than by further
  speculative investment.
- **Future-ideas entries** (`devdocs/roadmap/version-7/future-ideas.md`)
  stay parked: no forgebench consumer surfaced that needs If-Match-on-read
  live freshness, projection round-trip, or `consumerTargets` overrides.
