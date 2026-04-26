# Reef 8 Open Loops And Verification State

Status: `Shipped`

## Goal

Teach Reef about unfinished work, not just static repo facts. Reef should
track unresolved investigation state, verification gaps, evidence
conflicts, failed checks, and "changed after check" conditions so agents
do not lose operational context between tool calls or sessions.

## Problem

Most code intelligence tools answer "what exists?" Reef can go further
and answer "what work is still open?" Examples:

- a tool result was contradicted by a later live check
- a finding was acknowledged but the same pattern reappeared elsewhere
- a file changed after the last successful typecheck
- an auth-related task completed without auth-relevant verification
- an agent started investigating a route and stopped before checking the
  dependent server action or table usage

This is not task management. It is source-grounded work-state memory.

## New Concepts

### Reef Open Loop

An open loop is a project-scoped, source-grounded item that should be
resolved, verified, acknowledged, or deliberately ignored.

Examples:

- `verification_gap:file_changed_after_check`
- `evidence_conflict:index_vs_live`
- `task_gap:auth_changed_without_auth_check`
- `stale_context:packet_used_stale_candidate`

Open loops should have:

- stable fingerprint
- subject
- source facts/tool runs
- status: `open`, `resolved`, `acknowledged`
- suggested action
- age and freshness

### Verification State

Verification state answers:

- which checks last ran successfully?
- which files changed since those checks?
- which active findings remain relevant?
- what check is most likely to reduce risk next?

## Inputs

- `tool_runs`
- `mako_usefulness_events`
- `finding_acks`
- Reef facts/findings
- watcher dirty paths
- diagnostic run rows
- index freshness rows
- git staged/working-tree overlays

## Tooling Shape

Candidate surfaces:

- `project_open_loops`
- `file_open_loops`
- `verification_state`
- `verification_gaps`

These should be read-only views. Any resolution or acknowledgement should
reuse existing append-only ledgers where possible.

## Done When

- Reef can report files changed after the last successful relevant
  diagnostic run.
- Reef can report stale/contradicted evidence as an open loop.
- `context_packet` can include high-priority open loops for its
  candidate files.
- a smoke proves edit -> stale verification state -> rerun diagnostic ->
  resolved verification gap.
- open loops do not create a second finding ack source of truth.

## Shipped Implementation Notes

- `project_open_loops` derives open work from active Reef findings,
  stale/unknown facts, stale diagnostic runs, and failed/unavailable
  diagnostic runs.
- `verification_state` summarizes per-source diagnostic freshness and
  reports files whose working-tree overlay `lastModifiedAt` is newer
  than the latest successful diagnostic run.
- `context_packet` now recommends `project_open_loops` and
  `verification_state` as expandable read-only follow-up tools.
- Open-loop views remain read-only and continue to derive acknowledged
  status from the existing `finding_acks` ledger.
- `test/smoke/reef-model-facing-views.ts` covers stale facts, failed
  diagnostic runs, changed-after-check reporting, and batch access.
