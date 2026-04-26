<p align="center">
  <img src="../public/reef-engine.png" alt="Reef Engine" />
</p>

# Reef Engine

Reef Engine is agentmako's durable project memory layer. It turns the things
Mako already calculated about a repository into queryable facts and findings
that coding agents can use without starting from raw search every time.

In practical terms, Reef answers questions like:

- Which files, routes, symbols, tables, and diagnostics are relevant here?
- Is this evidence from the indexed snapshot, the working tree, or staged git
  state?
- Is the evidence still fresh compared with disk?
- Has this finding already been reviewed, acknowledged, or resolved?

Reef is local-first. Its state lives in the local Mako SQLite store for the
attached project. It is not a hosted service and it is not an LLM.

## Why Reef Exists

AI coding tools are strong once they have the right context, but they spend a
lot of early tool calls rediscovering the shape of the project. Reef gives the
agent a calculated starting point:

```text
project files + schema + diagnostics + git state + review notes
  -> Reef facts and findings
  -> ranked tool results and context packets
  -> agent reads, edits, and verifies with better aim
```

The goal is not to replace normal agent workflow. The agent should still read
files, inspect references, run tests, and verify changes. Reef makes the first
move sharper by returning structured evidence with source labels and freshness
signals.

## Facts And Findings

Reef stores two main kinds of data.

Facts are calculated observations about the project:

- file metadata and freshness
- symbols and import edges
- routes and route handlers
- schema objects, functions, policies, triggers, and table relationships
- diagnostics from TypeScript, ESLint, Biome, Oxlint, and staged git checks
- database review comments added through Mako tools

Findings are actionable or reviewable results derived from facts:

- lint or type errors
- staged pre-commit boundary/auth issues
- acknowledged static findings
- database review notes
- higher-level tool findings returned by model-facing views

Findings keep stable fingerprints where possible so acknowledgements can
survive future scans.

## Overlays

Reef separates evidence by overlay so agents know what they are looking at:

- `indexed`: the last indexed project snapshot
- `working_tree`: current files on disk
- `staged`: git staged state for pre-commit review

This matters because a bug report may need working-tree evidence, while a
pre-commit check should care about staged files.

## Freshness

Reef tracks whether indexed evidence still matches disk. If a file has changed
after indexing, tools can mark the evidence as stale or suggest a refresh.

Use this when an indexed tool result seems suspicious:

```bash
agentmako --json tool call . project_index_status "{}"
agentmako --json tool call . project_index_refresh "{\"mode\":\"if_stale\"}"
```

For exact current text after edits, use live search:

```bash
agentmako --json tool call . live_text_search "{\"query\":\"useSession\",\"fixedStrings\":true}"
```

## Agent-Facing Tools

The most direct Reef tools are:

- `reef_scout`: ranked facts, findings, and likely next reads for a task
- `project_findings`: active project findings across sources
- `file_findings`: findings for a specific file
- `project_facts`: raw Reef facts for a project
- `file_facts`: facts for a specific file
- `working_tree_overlay`: working-tree status as Reef evidence
- `list_reef_rules`: known rule descriptors

Reef also strengthens higher-level tools such as `context_packet`,
`cross_search`, `lint_files`, and `git_precommit_check`.

## Common Use

Start with a scout query:

```bash
agentmako --json tool call . reef_scout "{\"query\":\"why is the auth callback route broken?\"}"
```

Then read the primary files it returns, use normal search or references for
verification, and run focused checks after edits.

For staged review:

```bash
agentmako git precommit . --json
```

For project-wide findings:

```bash
agentmako --json tool call . project_findings "{\"limit\":20}"
```

## Boundary

Reef is a context and evidence engine. It does not decide the final code change
for the agent, and it should not be treated as more authoritative than current
file reads or test output. If live files and Reef disagree, refresh the index or
use live tools to confirm the current state.
