# Reef 3 Working Tree And Staged Overlays

Status: `Shipped`

## Goal

Make project state views explicit. Mako should know whether a fact or
finding came from the indexed snapshot, current working tree, staged git
blob, or future preview overlay.

## Scope

- overlay-aware fact/finding queries
- project-root-scoped git staged blob reader
- staged-mode checks for `git_precommit_check`
- working-tree overlay for changed files without full reindex
- overlay metadata in relevant tool views

## Key Behavior

- `git_precommit_check` defaults to `staged`.
- `context_packet` defaults to `working_tree` with indexed fallback.
- `project_index_status` compares `indexed` to `working_tree`.
- `file_findings` can show indexed vs working-tree vs staged findings
  when they differ.
- `preview` remains in-memory and non-durable unless a later phase
  defines persistence rules.

## Rename Policy

Renames are modeled as delete+insert:

- delete old path facts and resolve/remove old path findings
- insert new path facts
- re-resolve import edges where safe
- emit warning facts for inbound edges that cannot be repaired safely

Do not make correctness depend on git's rename similarity score.

## Done When

- overlay contract is wired through facts and findings
- staged blob reads cannot escape the project root
- staged finding differs from working-tree finding in a smoke fixture
- deleted and renamed staged files follow the delete+insert policy
- tools that expose overlay state document their defaults

## Implementation Notes - 2026-04-25

Staged overlay hardening shipped:

- `git_precommit_check` now parses staged `name-status` records instead
  of only staged names, preserving `added`, `copied`, `modified`,
  `renamed`, and `deleted` status in `stagedChanges`.
- Staged blob reads remain project-root scoped. Deleted paths are never
  read from disk or the index.
- Deleted staged files resolve prior staged Reef findings for that file.
- Renamed staged files are modeled as old-path resolution plus new-path
  checking when the new path is inside the project root.
- `test/smoke/git-precommit-check.ts` now proves staged content can
  differ from the working tree and still be the source of truth, staged
  deletion resolves the deleted file's prior staged findings, and staged
  rename resolves the old path while checking the new path.

Working-tree overlay facts shipped:

- Added `working_tree_overlay`, an advisory mutation that snapshots
  project-root-scoped `working_tree` `file_snapshot` facts for explicit
  files, watcher-dirty paths, or non-fresh indexed paths.
- `file_snapshot` facts store present/deleted state plus size, mtime,
  line count, and sha256 when the file exists. The fact lifecycle remains
  replace-not-append by `(projectId, overlay, source, kind,
  subjectFingerprint)`.
- Added read-only `project_facts` and `file_facts` tools so agents and
  Studio can inspect the durable Reef fact substrate directly.
- `context_packet` remains read-only. It consumes existing
  `working_tree_overlay` facts, marks returned candidates with
  `metadata.overlay = "working_tree"` when a live overlay fact exists,
  falls back to `indexed` metadata otherwise, and recommends
  `working_tree_overlay` when `changedFiles` are present without overlay
  facts.
- `test/smoke/reef-working-tree-overlay.ts` covers changed-file fact
  replacement, deletion facts, file/project fact read tools, and batch
  access. `test/smoke/context-packet.ts` covers overlay metadata and the
  read-only recommendation path.
