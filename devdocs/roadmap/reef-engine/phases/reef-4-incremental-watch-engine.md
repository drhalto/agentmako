# Reef 4 Incremental Watch Engine

Status: `Shipped`

## Goal

Turn file changes into targeted fact invalidation and recomputation.
This is the live-engine slice, but correctness remains more important
than speed.

## Scope

- Reef event hooks added to the existing Initial Testing Phase 4
  project-local watcher
- changed-file fact replacement
- orphan cleanup for deleted files
- runtime consumer for the calculation-node dependency declarations
  defined in Reef 1
- dirty path queue with debounce and max delay
- single follow-up refresh queued under bursty edits
- engine status surface
- hot cache rebuild after restart

## Conservative Fallbacks

Use full refresh when:

- exports changed and dependent repair is uncertain
- import alias or tsconfig changed
- schema source changed
- generated types changed
- route conventions/config changed
- deleted files had unknown dependents
- parser errors prevent safe replacement

## Coordinator Interface Stability

Reef 4 absorbs the existing
`services/api/src/index-refresh-coordinator.ts`. The public interface
must stay stable across the absorption so Mako Studio (Studio 4 multi-
project workspace) and any other consumer keeps working:

- `coordinator.setActiveProject(project)` continues to drive the active
  project lifecycle.
- `coordinator.getWatchState(projectId?)` continues to return the same
  `ProjectIndexWatchState` shape.
- `coordinator.close()` continues to wait for in-flight refreshes
  before resolving.

Only the internal refresh logic changes (path-scoped vs full,
calculation-node dependency consumption, fact replacement). The
behavioral contract that smokes assert on remains unchanged.

Shipped implementation notes:

- The existing coordinator now snapshots dirty paths through
  `working_tree_overlay` before running the path-scoped index refresh.
- `ProjectIndexWatchState` exposes the last overlay fact update time,
  fact count, resolved finding count, duration, and non-blocking overlay
  error.
- Watch state now exposes the last refresh decision: `paths` vs `full`,
  fallback reason, refreshed path count, and deleted path count.
- Overlay fact failures are logged and surfaced in watch state, but they
  do not prevent the existing index refresh safety path from running.
- `test/smoke/mcp-index-watch.ts` asserts watcher edits write one
  replacement `working_tree` `file_snapshot` Reef fact and watcher
  deletes write a `deleted` snapshot fact for the changed file.
- Watcher deletes resolve active file-scoped Reef findings for
  `indexed` and `working_tree` overlays. Staged findings remain owned by
  the staged/git flow.
- `test/smoke/context-packet.ts` creates a fresh hot-index cache after
  the first packet call and proves hot hints rebuild from durable indexed
  facts, matching the no-daemon restart rule.
- `test/smoke/mcp-index-watch.ts` asserts changed-file overlay fact
  replacement reports a duration under the current 500 ms Reef budget on
  the watch smoke fixture. The 5k-file p95 budget remains a Reef 6
  profiling gate.

## Studio Token On HTTP Refresh Path

If Studio 1 ships the local-auth middleware on `services/api` (per
Mako Studio handoff working rule 2), the watcher's HTTP refresh path
must thread the per-launch Studio token through every call when the
shell launched the services. CLI and MCP launches keep using the open
path because no token is configured. Reef 4 must not regress this
distinction; the coordinator already runs in-process inside
`services/api`, so most refreshes are direct method calls and do not
need the token, but any path that goes back out through HTTP does.

## Done When

- the Phase 4 `index-refresh-coordinator` watcher is absorbed rather
  than duplicated
- edit file -> owned facts are replaced
- delete file -> owned facts/findings are removed or resolved
- burst edits queue one follow-up run
- restart rebuilds hot state from durable facts
- generated-output writes do not trigger loops
- large-repo cap and disabled state are documented
- edit -> changed-file fact replacement is measured against the
  roadmap budget
