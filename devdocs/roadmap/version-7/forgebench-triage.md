# Roadmap 7 — Forgebench Triage

First run of the 7.0–7.4 artifact stack against the real `forgebench`
project (Next.js + Supabase, 136 indexed files). Purpose: produce a
prioritized list of what is genuinely useful, what is noise, and what is
broken — the 7.5 scope input.

Date: 2026-04-22.

## Run summary

- `scripts/forgebench-full-sweep.ts` — **39/39 tools OK** after input
  adjustments. All four 7.0–7.4 artifact tools added and reach a clean
  artifact through the shared tool plane.
- One-shot file-export probe — all four artifact families wrote canonical
  JSON + markdown to `forgebench/.mako/artifacts/<kind>/<artifactId>.{json,md}`.
  File sizes: 3065 / 8401 / 7764 / 4225 bytes JSON; 469 / 1496 / 1326 / 486
  bytes markdown. All JSON bodies carry the complete canonical projection;
  all `exportIntent` declare `{ exportable: true, defaultTargets: ["file_export"] }`.

## What actually works

- **Contracts hold up end-to-end.** Every artifact round-trips its own
  schema. The 7.0 `refineArtifactShape` subset rule and the 7.4
  `exportIntent` flip both validate cleanly against real generated output.
- **File export works against a real project.** `.mako/artifacts/<kind>/`
  directory convention, `<artifactId>` filenames, `tmp`+rename write.
- **Graph-derived move surfaces are real.** When the graph has a path, the
  `likelyMoveSurfaces` / `reviewSurfaces` arrays carry actionable file
  names with rationales ("`lib/events/actions.ts` is the starting surface
  for the selected graph path", "`app/api/events/route.ts` sits adjacent
  via imports").
- **Provenance is complete.** Every artifact points back to its basis
  fingerprints; re-runs with unchanged basis produce stable artifactIds.

## Findings to triage (highest value first)

### 1. Graph entity resolution for routes and RPCs — **SHIPPED**

**Evidence.** Probed six realistic entity pairs against forgebench:

| pair                                                        | direction | result                           |
|-------------------------------------------------------------|-----------|----------------------------------|
| `route:GET /api/events` → `table:public.events`             | any       | `start_not_resolved`             |
| `route:GET /api/events` → `rpc:public.get_visible_events`   | any       | `start_not_resolved`             |
| `rpc:public.get_visible_events` → `table:public.events`     | any       | `start_not_resolved`             |
| `file:app/events/[id]/page.tsx` → `table:public.events`     | any       | `disconnected`                   |
| `file:lib/events/actions.ts` → `table:public.events`        | any       | `disconnected`                   |
| `file:lib/events/actions.ts` → `file:lib/events/queries.ts` | `both`    | **pathFound=true, hops=2** ✓     |

Route and RPC entities do not resolve as graph nodes. File→table pairs
return `disconnected` because schema-usage edges are not in the graph.
Only file→file `direction="both"` traversal finds a path today.

**Impact.** The *natural* user story for `task_preflight` /
`review_bundle` is "I'm about to change this route / RPC — what touches it
and what should I verify?" That story is currently unreachable because
the graph can't resolve those entity kinds. The artifact tools work, but
only on the pairs that never hit the graph resolver.

**Resolution (shipped).** Three distinct gaps, each fixed:

1. **Route locator UX normalization.** The indexer stores route keys as
   `route:<pattern>:<method>` (API) and `page:<pattern>` (pages), but
   callers naturally write `"GET /api/events"` or `"/dashboard/admin"` —
   matching what `route_trace` accepts. `normalizeGraphNodeLocator` in
   `packages/tools/src/graph/traversal.ts` now handles the `route` kind by
   consulting `projectStore.listRoutes()` and translating human-friendly
   forms (with or without method) to the stored key. Already-stored keys
   pass through unchanged.

2. **RPC locator UX normalization.** The graph stores RPC keys as
   `<schema>.<name>(<argTypes>)` (e.g. `public.get_visible_events()`,
   `extensions.armor(bytea)`), but callers write the bare
   `<schema>.<name>` form. `resolveGraphNodeLocator` in the same file
   now falls back to prefix-matching on `<schema>.<name>(` when exact
   match fails, preferring the no-arg overload then the
   alphabetically-first key.

3. **RPC body extraction (the real indexer bug).** `function_table_refs`
   was empty because every RPC body in every forgebench migration was
   being silently dropped. Two root causes chained:
   - `extractPgObjectsFromSql` in
     `services/indexer/src/extract-pg-functions.ts` anchored the head
     regex at `^\s*CREATE`, which failed when Supabase-flavoured
     migrations prefix each statement with a `-- ========== name ==========`
     banner. Added `stripLeadingSqlComments` so the head regex matches
     against a comment-stripped view while bodies are still extracted
     from the original text (dollar quotes intact).
   - `mergeIRInto` in `services/indexer/src/schema-snapshot.ts` merged
     `argTypes` and `returnType` across schema sources but never merged
     `bodyText`. A `parseSupabaseTypesSchemaSource` entry (from
     `types/supabase.ts`, which carries no body) was processed first and
     became the merge winner; the SQL-extractor body was silently
     discarded. Added `bodyText` to the merge policy.

**Verification against forgebench (after fix).** Same sweep, same project:

| tool                        | before                               | after                                                              |
|-----------------------------|--------------------------------------|--------------------------------------------------------------------|
| `graph_path` route→table    | `disconnected`                       | `pathFound=true, hops=3, heuristic=true`                           |
| `flow_map` route→table      | `steps=0`                            | `steps=4, boundaries=[entry,file,rpc,data]`                        |
| `change_plan` route→table   | `direct=0, dependent=0`              | `direct=4, dependent=6, steps=10`                                  |
| `tenant_leak_audit`         | `direct=0, weak=0`                   | `direct=4, weak=32`                                                |
| `task_preflight_artifact`   | `surfaces=0` (empty-state)           | `surfaces=5, readFirst=4, verify=4`                                |
| `review_bundle_artifact`    | `surfaces=0, direct=0, weak=0`       | `surfaces=5, direct=4, weak=4`                                     |
| `verification_bundle_artifact` | `direct=0`                        | `direct=4`                                                         |

The `tenant_leak_audit` jump (`0/0 → 4/32` direct/weak findings) is
especially telling: forgebench has tenant-sensitive RPC code that the
operator couldn't see before because the bodies weren't analyzable.
**The whole power-workflow / artifact stack inherits a material signal
upgrade from this one fix.** Smoke regression coverage lives in
`test/smoke/graph-tools.ts` (route/RPC locator normalization) and the
existing `test/smoke/schema-snapshot-bodies.ts` (now exercising the
fixed extraction path).

### 2. Artifact prose is templated, not project-specific

**Evidence.** Sample from `task_preflight` exported markdown:

> Start in lib/events/actions.ts. Preserve Symbols in lib/events/actions.ts.
> ...
> - Preserve Symbols in lib/events/actions.ts as the canonical shared path.
> - Check Symbols in lib/events/actions.ts still matches the edited flow.

Strings like *"Preserve Symbols in X as the canonical shared path"* and
*"X resolves cleanly after the edit"* are mechanical phrasings that
don't carry project-specific insight. The file list and the flow are
real; the prose wrapping them is generic.

`review_bundle` is worse: only 2 reviewer checks surface
(`"Preserve Symbols..."` and `"Trace X again after the edit..."`), both
templated.

`implementation_handoff` is thinnest: 3 key-context bullets, 1 follow-up
— no carry-over of "what's been tried, what's been ruled out, what state
is currently in play."

**Impact.** Artifacts validate, compile, export — but do they add value
over reading the underlying packets directly? Only marginally, because
the *information* in the artifacts is the packet content. The composed
presentation helps slightly, but not enough to justify their own layer if
the packet prose stays this generic.

**Scope.** Root cause is in the packet generators
(`implementation_brief`, `verification_plan`) — upstream of the artifact
layer. A packet-prose uplift is Roadmap 5 territory or a new deliberate
phase.

**Priority: MEDIUM-HIGH.** Directly answers the 7.5 question "are
artifacts useful on their own."

### 3. `min(1)` on `likelyMoveSurfaces` / `reviewSurfaces` crashes when graph returns empty — **SHIPPED**

**Evidence.** `task_preflight_artifact` and `review_bundle_artifact`
threw `payload.likelyMoveSurfaces: Array must contain at least 1
element(s)` when run against route→table inputs that returned
`pathFound=false` from `change_plan`. The error is a generic "Tool input
validation failed" because the artifact schema enforces `.min(1)` at
output-parse time.

**Impact.** Legitimate questions that produce no graph surfaces hard-fail
instead of returning a degraded-but-useful artifact. Users see "tool
validation failed" with no hint that the real issue is a missing graph
path.

**Resolution (shipped).** Option (a) from the original sketch. Schemas
for `likelyMoveSurfaces` / `reviewSurfaces` now allow `[]`; the markdown
renderers emit `_No graph-derived <…> surfaces — widen traversalDepth,
pick closer entities, or verify the graph indexes the start/target
kinds._` when empty. Verified against real forgebench: the route→table
pair that previously crashed now ships an artifact with `surfaces=0`,
and the markdown preserves the rest of the preflight context (readFirst,
verifyBeforeStart, activeRisks) which remain genuinely useful even
without graph surfaces. Regression coverage in
`test/smoke/artifact-generators.ts`.

### 4. `review_bundle` feels thin

**Evidence.** Real forgebench review_bundle output ships only 2
`reviewerChecks` and 5 `reviewSurfaces` that overlap heavily with
`task_preflight`. For a real reviewer, the expected differential vs
preflight is: "what specifically to watch for in this change," not "same
file list with slightly different headers."

**Impact.** `review_bundle` as shipped is close to a cosmetic rename of
`task_preflight`. The 7.0 rule "one canonical artifact per workflow
shape" hasn't been violated, but the two artifacts carry almost-identical
information.

**Scope.** Either the composer logic for `review_bundle` needs to mine
packet context harder (pull risks, invariants, diagnostics more
aggressively) or the two artifacts should be merged / clarified.

**Priority: MEDIUM.** Related to Finding 2 — if packet prose improves,
this may resolve itself.

### 5. `implementation_handoff` does not carry real session state — **SHIPPED**

**Evidence.** For a family whose basis is
`implementation_brief + session_handoff`, the output markdown contains 3
generic bullets copied from the brief and 1 verification bullet. The
session handoff says `focus=trust_insufficient_evidence:cross_search(refresh_events)`
— concrete session state — but none of that surfaces in the artifact's
`keyContext` or `followUps`.

**Impact.** For an agent-to-agent handoff, the thing another agent
needs is *"what I've been working on and where I left off."*
`implementation_handoff` ships without that. The session handoff basis
is composed but under-projected.

**Resolution (shipped).** `createImplementationHandoffPayload` now
prepends a `Current focus: <queryText> — <reason>` entry to `keyContext`
when `session_handoff.currentFocus` is set, tagged to the session_handoff
basis ref. When the session summary has unresolved queries or active
follow-ups, a `Session momentum: N recent, M unresolved, K with
follow-ups` entry is appended. Brief-derived entries (summary, change
areas, invariants) fill the remaining capacity up to a `.slice(0, 5)`
cap. Session entries take precedence so a receiving agent sees
what's-in-flight before what's-in-the-brief.

The threshold check (`unresolvedQueryCount > 0 || queriesWithFollowups >
0`) intentionally suppresses the momentum entry when the session is
quiet — no "Session momentum: 0 unresolved, 0 follow-ups" noise. At
verification time, the forgebench session happened to be exactly that:
8 recent queries, 0 unresolved. So the live-probe showed the feature
correctly inactive; the smoke (with a synthetic session carrying an
explicit currentFocus) proves the active path works.

### 6. File export worked cleanly, but basis-check for export wasn't exercised

**Evidence.** All four families exported correctly against real
forgebench. `exportIntent` correctly declares `file_export`.
`consumerTargets` include `file_export`. refineArtifactShape subset rule
holds.

**Impact.** Nothing broken. Observation only: the 7.4 exported files can
be parsed back through a projection schema, but nobody's doing that yet.
No consumer currently reads `.mako/artifacts/*.json`. The openclaw
If-Match-on-read pattern (see `future-ideas.md`) would enable that, but
until a concrete caller asks, the files are write-only from mako's
perspective.

**Priority: LOW.** Observation, not a gap.

## Proposed post-forgebench scope

Ordered by expected usefulness per hour of work:

1. ~~**Finding 3** — relax / graceful-fail empty surfaces.~~ **SHIPPED.**
2. ~~**Finding 5** — surface session focus in `implementation_handoff`
   payload.~~ **SHIPPED.**
3. ~~**Finding 1** — graph entity resolution for routes / RPCs,
   schema-usage edges for file→table.~~ **SHIPPED.** Turned out to be
   three chained bugs (route locator UX, RPC locator UX, RPC body
   extraction) rather than the "days of graph work" originally
   estimated. Total cost: an afternoon. Biggest single upgrade to the
   end-to-end signal observed against forgebench.
4. **Finding 2 + 4** — packet prose quality / `review_bundle`
   distinctness. Bigger question: do we invest in richer packets, or
   accept that 7.5 eval will say "artifacts add marginal value over
   packets" and let that signal route the next roadmap? With Finding 1
   shipped, the artifacts now carry real graph-derived structure, so
   this question may feel less urgent — rerun 7.5 eval against the
   current state before committing.

## Findings surfaced by the post-Finding-1 re-read

Running the full artifact stack against forgebench with the now-working
route→table pair uncovered three small bugs in the operator/indexer
plumbing. All three **SHIPPED** alongside the Finding 1 work.

### A. Duplicate operator findings in artifact payloads — **SHIPPED**

`tenant_leak_audit` emits one weak finding per (call site, protected
table) pair. When an RPC touches multiple protected tables, the finding
messages are identical (the message only references the call site and
RPC, not the table). The artifact composer previously surfaced all of
them, producing repeated bullets in the rendered markdown.

Fix: `createTenantAuditFindingEntries` in
`packages/tools/src/artifacts/index.ts` now dedupes by message before
projecting into `weakOperatorSignals` / `directOperatorFindings`. Smoke
regression in `test/smoke/artifact-generators.ts`.

### B. Double schema qualification in RPC finding messages — **SHIPPED**

`collectRpcFindings` in `packages/tools/src/operators/index.ts` built
`rpcSurfaceKey` as `${ref.rpcSchema}.${buildRpcKey(...)}`, but
`buildRpcKey` already embeds the schema. Every tenant-audit finding
message about an RPC read `public.public.name(...)`. Also broke
cross-linking against the graph's rpc node key format. Fix: single
assignment. Smoke regression in `test/smoke/tenant-leak-audit.ts`.

### C. Docs-file false positives in RPC usage detection — **SHIPPED**

`collectSchemaUsages` in `services/indexer/src/schema-scan.ts` scanned
every indexed file's content with `\b<rpcName>\b` regardless of
language. Markdown docs that mentioned RPC names (e.g.
`docs/benchmark-answer-key.md`) produced false usage references that
flowed into `calls_rpc` graph edges and `tenant_leak_audit` weak
signals. Fix: a `SCHEMA_USAGE_CODE_LANGUAGES` allowlist restricts
scanning to typescript / tsx / javascript / jsx / esm / commonjs / sql.
New focused smoke at `test/smoke/schema-scan-usage.ts`.

**Combined impact against forgebench:** weak-signal count dropped from
32 (mostly docs-prose noise) to 4 unique genuine call sites. Direct
operator findings (4 tables with RLS-enabled-but-no-policies) now
surface in `review_bundle.directOperatorFindings` because they're no
longer crowded out by the `slice(0, 4)` cap. The operator's signal
density and signal-to-noise ratio both improved materially.

What to *avoid* doing without more signal: any speculative work from
`future-ideas.md`. The forgebench run didn't surface a caller that
actually needs If-Match-on-read, projection round-trip, or
`consumerTargets` overrides. Keep those parked.
