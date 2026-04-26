# Reef 5 Tool View Migration

Status: `Shipped`

## Goal

Move high-value MCP and CLI tools onto Reef-backed views. Existing tool
contracts should stay stable while implementations become thinner and
more consistent.

## Candidate Tools

- `context_packet`
- `ast_find_pattern`
- `schema_usage`
- `route_context`
- `route_trace`
- `git_precommit_check`
- `project_index_status`
- `live_text_search`
- `list_reef_rules` — already shipped as a stub in Reef 1; Reef 5
  populates it with real rule descriptors as `ReefRule` instances are
  registered, and may add filters (by source, severity, fact-kind) once
  consumers ask for them
- findings-management CLI/API surfaces: list, ack, resolve, dismiss,
  export
- future `lint_files`
- future `project_findings` and `file_findings`

## Shipped Implementation

Reef 5 migrates four high-value views with additive contracts and a
one-release rollback switch:

- `context_packet`
  - reads `working_tree_overlay` `file_snapshot` facts and active
    `ProjectFinding` rows
  - defaults to indexed candidates with working-tree overlay enrichment
    when a matching live fact exists
  - returns additive `activeFindings` alongside existing context,
    freshness, risks, instructions, and expandable tools
  - fallback: set `MAKO_REEF_BACKED=legacy` or omit `context_packet`
    from a comma-delimited `MAKO_REEF_BACKED` allowlist to keep base
    deterministic providers without Reef enrichment
- `ast_find_pattern`
  - reads indexed files, but uses Reef/index freshness before parsing
    each file
  - default overlay is indexed, guarded against stale/deleted/unknown
    file metadata
  - stale indexed files are skipped with a warning instead of returning
    phantom structural matches
  - fallback: `MAKO_REEF_BACKED=legacy`
- `project_index_status`
  - still reports file-index freshness, latest run, unindexed scan, and
    watch state
  - now also reports additive `reefFacts` for working-tree
    `file_snapshot` facts so file freshness and fact freshness are both
    visible
  - fallback: `MAKO_REEF_BACKED=legacy` omits the Reef fact summary
- `git_precommit_check`
  - reads staged git blobs and persists staged `ProjectFinding` rows plus
    rule descriptors
  - staged delete/rename resolution remains Reef-backed by default
  - fallback: `MAKO_REEF_BACKED=legacy` keeps the hook/check output but
    skips Reef persistence

`project_findings`, `file_findings`, `project_facts`, `file_facts`,
`list_reef_rules`, `project_diagnostic_runs`, `finding_ack`, and
`finding_acks_report` are the shipped API/MCP findings-management path.
CLI users can reach the same path through `agentmako tool call`; a
dedicated `agentmako findings` facade is left as UI ergonomics, not a
Reef storage requirement.

Rollback semantics:

- unset `MAKO_REEF_BACKED`: migrated Reef-backed views are enabled
- `MAKO_REEF_BACKED=legacy`, `off`, `false`, `0`, or `none`: disable
  migrated Reef enrichments
- `MAKO_REEF_BACKED=all`: enable all Reef-backed views
- `MAKO_REEF_BACKED=context_packet,project_index_status`: enable only
  the listed migrated views

## Migration Rule

Each migrated tool must state:

- what Reef facts it reads
- what overlay it uses by default
- how it handles stale facts
- what fallback path remains if Reef state is unavailable
- how parity with the old behavior was tested
- what feature flag or per-tool setting rolls it back for one release

Legacy code paths stay compiled for the first release of a migrated
tool. They can be deleted only after the Reef-backed path has production
signal and parity smokes.

## Context Packet Boundary

Reef facts and findings become the canonical substrate.
`ContextPacketCandidate` remains the agent-facing consumer view.

The migration must preserve:

- existing context packet source labels
- candidate fingerprints
- freshness metadata
- risk and scoped-instruction enrichment
- normal harness handoff recommendations

## Done When

- at least three high-value tools are Reef-backed: shipped
  (`context_packet`, `ast_find_pattern`, `project_index_status`,
  `git_precommit_check`)
- public contracts remain stable or additive: shipped (`activeFindings`
  and `reefFacts` are additive)
- migrated tools have rollback switches: shipped through
  `MAKO_REEF_BACKED`
- stale indexed facts cannot produce phantom AST/search results: shipped
  through the `ast_find_pattern` Reef freshness guard
- context packets include active findings and overlay/freshness metadata:
  shipped
- findings-management ergonomics have a planned or shipped CLI/API path:
  shipped through Reef MCP/API tools, with a dedicated CLI facade parked
  as UI ergonomics
- parity smokes compare old and new paths where practical: shipped in
  `project-index-freshness`, `context-packet`, `git-precommit-check`,
  and `reef-performance-boundary`
