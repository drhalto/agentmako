# Phase 9 CC - Claude Code Plugin Package

Status: `Complete`

## Why This Phase Exists

The CC roadmap now has a working typed MCP server, runtime telemetry,
feedback tools, recall tools, and live-session validation. The remaining gap
is not a lower-level SDK integration by default. The practical gap is
distribution and consistent Claude Code behavior:

- make Mako easy to install in Claude Code projects;
- teach Claude Code when to use each Mako tool;
- teach Claude Code when and how to log feedback;
- keep all actual repo intelligence behind typed MCP tools.

This phase packages Mako for Claude Code as a plugin whose main payload is a
Claude Code skill. The plugin handles installation/distribution. The skill
handles behavioral guidance. The MCP server continues to expose the actual
capabilities.

## Decision

Phase 9 should build a Claude Code plugin package, not an SDK rewrite.

The installable deliverable is one plugin (`mako-ai`) that ships a set of
focused, category-scoped skills. Mako has 53 MCP-visible tools across 12
cognitive categories; splitting guidance across ~8 skills matches
Anthropic's recommended progressive-disclosure pattern and lets Claude
Code's turn-0 skill discovery load only the guidance relevant to the
user's intent.

Per CC source (`skills/loadSkillsDir.ts:100-105`,
`utils/analyzeContext.ts:591`), only `[name, description, when_to_use]`
contributes to the always-loaded token cost. The full `SKILL.md` body
loads on invocation. At ~30 tokens of frontmatter per skill, an 8-skill
split costs ~240 tokens in the base prompt — negligible — while letting
each skill stay narrowly scoped and complete for its bucket.

The package should:

- configure the `mako-ai` stdio MCP server command via `.mcp.json` at the
  plugin root;
- ship category-scoped guidance skills — one entry skill plus one per
  major tool cluster — each invoked as `/mako-ai:<skill-name>`;
- cover every Mako capability at decision-guide depth without duplicating
  schemas (ToolSearch carries the live schemas);
- pre-approve MCP tool calls via `allowed-tools: mcp__mako-ai__*` in each
  skill's frontmatter so the agent is not permission-prompted per call;
- preserve typed MCP tools as the source of truth.

The package should not move Mako capabilities to the MCP skills surface.
Prior roadmap notes parked MCP skills because they are not typed tool
contracts. This phase uses Claude Code plugin skills as orchestration
guidance around typed tools, not as a replacement API surface.

## Official Claude Code Model

Claude Code's docs draw the boundary this way:

- standalone `.claude/` skills are best for personal workflows, project-specific
  customization, and quick experiments;
- plugins live in directories with `.claude-plugin/plugin.json` and are best
  for team sharing, versioned releases, marketplace distribution, and reuse
  across projects;
- plugin skills live under `skills/<skill-name>/SKILL.md` and are invoked with
  the plugin namespace, e.g. `/mako-ai:mako-guide`;
- plugin MCP servers can be configured in `.mcp.json` at the plugin root or
  inline in `plugin.json`.

Therefore Phase 9 should ship the plugin. A standalone/global skill may be used
while authoring the instructions, but it is not part of the final user-facing
installation path.

## Global Skill Versus Plugin

A standalone/global Claude Code skill is a good fast path for validating the
instructions in a live session. It is not the best final delivery shape because
it has weak versioning, weak team distribution, and no package metadata.

The plugin is the preferred final vehicle:

- the skill remains the behavior contract;
- the plugin owns installation, discoverability, and versioning;
- plugin skills are namespaced, e.g. `/mako-ai:mako-guide`, which avoids
  collisions with project or personal skills;
- teams can install the same guidance instead of copying a user-local file;
- future plugin assets can be added without changing the MCP server.

Implementation can still author the skill first and wrap it in the plugin
package second. That keeps the feedback loop short without making a user-local
skill the long-term product surface.

## Package Shape

Target shape:

```text
mako-ai-claude-plugin/
  .claude-plugin/
    plugin.json
  .mcp.json
  README.md
  skills/
    mako-guide/SKILL.md
    mako-discovery/SKILL.md
    mako-trace/SKILL.md
    mako-neighborhoods/SKILL.md
    mako-graph/SKILL.md
    mako-database/SKILL.md
    mako-code-intel/SKILL.md
    mako-workflow/SKILL.md
```

The plugin lives in the mako-ai monorepo at `mako-ai-claude-plugin/` so
guidance and tool behavior version together. The important boundary is that
plugin files are packaging and instructions only. Runtime behavior still flows
through the existing MCP server:

```text
Claude Code -> skill auto-match on user intent -> MCP ToolSearch -> typed Mako tools
```

`.mcp.json` at the plugin root configures the existing `mako-ai` stdio
server command. Both `.mcp.json` and inline `mcpServers` in `plugin.json`
are valid paths per CC's loader (`utils/plugins/mcpPluginIntegration.ts`:
`.mcp.json` loads first, manifest `mcpServers` overrides on conflict).
We pick `.mcp.json` for file-level inspectability and to match the format
already documented in `devdocs/install-and-run.md`:

```json
{
  "mcpServers": {
    "mako-ai": {
      "command": "agentmako",
      "args": ["mcp"]
    }
  }
}
```

Prereq: `agentmako` must be on the user's `PATH`. The plugin README documents
this. If plugin-local executables are later bundled, use the
`${CLAUDE_PLUGIN_ROOT}` substitution — see
`utils/plugins/loadPluginCommands.ts:~340` for supported variables.

`plugin.json` names the plugin `mako-ai` so skills are invoked as
`/mako-ai:<skill>`:

```json
{
  "name": "mako-ai",
  "version": "0.1.0",
  "description": "Project intelligence tools and guidance for Claude Code via the mako-ai MCP server.",
  "author": { "name": "mako-ai", "url": "https://github.com/..." },
  "keywords": ["mcp", "code-intel", "project-intelligence", "mako"]
}
```

Per `PluginManifestMetadataSchema` (`CC/utils/plugins/schemas.ts:273-316`),
only `name` is required; the rest are optional but `version`, `description`,
and `author` all surface as validation warnings when missing. Plugin name
must be kebab-case (required for marketplace sync).

### Skill allocation

The 8 skills split Mako's 53 tools by cognitive bucket:

| Skill | Tool count | Coverage |
|---|---|---|
| `mako-guide` | 0 (meta) | Top-level entry; feedback + finding-ack policy |
| `mako-discovery` | 4 | `tool_search`, `repo_map`, `ask`, `cross_search` |
| `mako-trace` | 10 | Targeted + composer trace tools |
| `mako-neighborhoods` | 3 | `table_neighborhood`, `route_context`, `rpc_neighborhood` |
| `mako-graph` | 10 | Graph + imports + symbols |
| `mako-database` | 6 | `db_*` introspection |
| `mako-code-intel` | 2 | `ast_find_pattern`, `lint_files` |
| `mako-workflow` | 18 | Workflows + artifacts + recall + feedback/ack/telemetry tools |

Sum: 53. Every MCP-visible Mako tool belongs to exactly one skill except
`repo_map`, which appears as a pointer in `mako-code-intel` but primarily
lives in `mako-discovery`.

## Skill Content Contract

Each `SKILL.md` has two parts:

1. **YAML frontmatter** — controls auto-invocation match, permissions,
   and metadata. Parsed by `parseSkillFrontmatterFields`
   (`CC/skills/loadSkillsDir.ts:184-265`); unknown keys are silently
   stripped.
2. **Markdown body** — the decision guide. Only loads on invocation, so
   length is unconstrained by context budget. The 500-line soft cap in
   CC's docs is a readability guideline, not a token-cost constraint.

### Canonical frontmatter template

Every Mako skill uses this shape:

```yaml
---
description: <user-intent trigger; CC matches this on turn 0>
when_to_use: <optional secondary match text for edge cases>
allowed-tools: mcp__mako-ai__*
---
```

Notes:

- `description` drives turn-0 skill auto-match in
  `attachments.ts:766-816`. Write about USER PROBLEMS ("when the user
  asks about table relationships"), not TOOL NAMES. Follow the
  `TRIGGER when: ... / DO NOT TRIGGER when: ...` pattern from the
  bundled `claude-api` skill (`skills/bundled/claudeApi.ts:184-188`).
- `when_to_use` is appended to `description` in the match-text pool, so
  use it for edge cases the primary trigger does not cover.
- `allowed-tools: mcp__mako-ai__*` pre-approves every Mako MCP call
  while the skill is active (`loadSkillsDir.ts:383-391`) — the model
  is not permission-prompted per tool call during an invoked skill.
- Do NOT set `disable-model-invocation`; these skills should auto-invoke.
- Do NOT set `user-invocable: false`; keeping them in the `/` menu
  gives users an escape hatch.
- Do NOT set `paths`; Mako skills trigger on intent, not file-path
  globs.

### Content requirements per skill

Every category skill body must include:

- a one-paragraph overview of what this skill covers and when to prefer
  it over the other Mako skills;
- per-tool entries in the skill's bucket with decision semantics (when
  to use, when not to use, natural pairings);
- a **Feedback Logging** section (see below) that sits before "See Also"
  and reminds the model to log `agent_feedback` when a result was
  notably useful, partial, or wasted the turn;
- a "See Also" pointer to adjacent skills when an investigation spans
  buckets (e.g. `mako-trace` mentions `mako-neighborhoods` for
  entity-wide context).

`mako-guide` additionally carries the cross-cutting feedback and
finding-ack policy in full — category skills point to it for the
starter reason-code vocabulary and the complete rule set.

`mako-workflow` carries the `agent_feedback` / `agent_feedback_report` /
`finding_ack` / `finding_acks_report` tools themselves at tool-entry
depth. The category-skill Feedback Logging sections are short reminders
at the decision point; `mako-guide` is the canonical rulebook;
`mako-workflow` is where the tools live.

#### Feedback Logging section shape

The **Feedback Logging** section in every category skill must carry the
trigger conditions, the 2-step procedure, and a pointer to `mako-guide`
for the full rule set and reason-code vocabulary. `mako-code-intel` is
the only skill whose tools produce ackable findings
(`ast_find_pattern.ackableFingerprint`,
`lint_files.findings[*].identity.matchBasedId`); it carries an
additional paragraph that contrasts `agent_feedback` (rates the tool
run) with `finding_ack` (marks an individual static finding). The other
five category skills omit the finding-ack contrast to stay compact.

Compact template (five skills — `mako-discovery`, `mako-trace`,
`mako-neighborhoods`, `mako-graph`, `mako-database`):

```markdown
## Feedback Logging

Log `agent_feedback` when a result here was notably useful, partial,
noisy, stale, wrong, or wasted the turn. Skip routine calls.

Required procedure (see `/mako-ai:mako-guide` for full rules and
reason-code vocabulary):

1. Call `recall_tool_runs` to get the prior run's `requestId`. Do not
   fabricate one — if no run is recalled, skip feedback.
2. Call `agent_feedback` with `referencedToolName`,
   `referencedRequestId`, `grade: "full" | "partial" | "no"`,
   `reasonCodes` from the starter vocabulary in `/mako-ai:mako-guide`,
   and a short `reason`.
```

`mako-code-intel` adds the finding-ack contrast paragraph after step 2,
naming `ackableFingerprint` / `identity.matchBasedId` explicitly.

Skill bodies should not include:

- full JSON schemas — ToolSearch is the live source;
- speculative automation rules;
- routing rules that bypass ToolSearch when a tool is unknown;
- requirements to log feedback after every tool call;
- the full feedback policy or the full reason-code vocabulary in-line
  — those belong to `mako-guide` so a vocabulary change is a one-place
  edit.

### Per-skill description strings

Descriptions below are the authoritative turn-0 match text. Implementers
may tune phrasing during live-session validation, but the
TRIGGER-when / DO-NOT-TRIGGER-when pattern should survive.

- **`mako-guide`**: "Start here when working in a project with the
  mako-ai MCP server configured. Entry point that explains how mako's
  tool skills are organized and carries the policy for logging
  `agent_feedback` vs acknowledging static findings with `finding_ack`."
- **`mako-discovery`**: "TRIGGER when: user is working in an unfamiliar
  repo, asks 'where is X', 'what touches Y', needs broad search across
  code/schema/routes, or is unsure which mako tool fits the task.
  Covers `tool_search`, `repo_map`, `ask`, `cross_search`."
- **`mako-trace`**: "TRIGGER when: user asks to trace a specific route,
  schema object, file, table, RPC, or error string through its evidence.
  Covers `route_trace`, `schema_usage`, `file_health`, `auth_path`,
  `trace_file`, `preflight_table`, `trace_edge`, `trace_error`,
  `trace_table`, `trace_rpc`."
- **`mako-neighborhoods`**: "TRIGGER when: user wants entity-wide context
  for a table, route, or RPC — schema + RLS + readers + writers +
  downstream touches all at once. Covers `table_neighborhood`,
  `route_context`, `rpc_neighborhood`."
- **`mako-graph`**: "TRIGGER when: user asks about relationships,
  dependency paths, import hotspots or cycles, symbol impact, or blast
  radius of a proposed change. Covers `graph_neighbors`, `graph_path`,
  `flow_map`, `change_plan`, `imports_deps`, `imports_impact`,
  `imports_hotspots`, `imports_cycles`, `symbols_of`, `exports_of`."
- **`mako-database`**: "TRIGGER when: user asks about database schema,
  RLS policies, foreign keys, stored procedures, or table DDL directly.
  Covers `db_ping`, `db_columns`, `db_fk`, `db_rls`, `db_rpc`,
  `db_table_schema`."
- **`mako-code-intel`**: "TRIGGER when: user wants structural code
  pattern search (ast-grep) or static lint against selected files.
  Covers `ast_find_pattern`, `lint_files`."
- **`mako-workflow`**: "TRIGGER when: user wants an investigation
  packet, pre-ship artifact, recall of prior work or answers, or to log
  tool-run feedback / inspect telemetry. Covers `suggest`,
  `investigate`, `workflow_packet`, `tenant_leak_audit`, `health_trend`,
  `issues_next`, `session_handoff`, all four artifact tools,
  `recall_answers`, `recall_tool_runs`, `agent_feedback`,
  `agent_feedback_report`, `runtime_telemetry_report`, `finding_ack`,
  `finding_acks_report`."

## Tool Routing Guide

The skill should describe all Mako capabilities as decision guidance.

### Discovery And Orientation

Use these when the current task needs repo context or the right tool is not
yet obvious.

- `tool_search` - use when the task intent is clear but the exact Mako tool
  name or schema is unknown.
- `repo_map` - use for first-turn repo orientation, central files, major
  modules, and high-level structure.
- `ask` - use for a single evidence-backed engineering question when a compact
  answer loop is enough.
- `cross_search` - use for broad search across code, schema, routes, and type
  surfaces when the relevant implementation location is uncertain.

### Targeted Answer Tools

Use these when the question maps to one specific codebase concern.

- `route_trace` - find the route handler, surrounding files, and evidence for
  a route/API behavior.
- `schema_usage` - find where a schema object, table shape, or validation type
  is used.
- `file_health` - understand a file's role, dependents, risk profile, and
  likely blast radius.
- `auth_path` - inspect likely authentication/authorization boundaries for a
  feature or route.

### Composer Trace Tools

Use these for compact traces that combine evidence across related surfaces.

- `trace_file` - summarize a file's dependencies, consumers, and important
  symbols before editing.
- `preflight_table` - inspect table usage, RLS, relations, and common query
  paths before changing database-backed behavior.
- `trace_edge` - gather evidence for a relationship between two entities,
  files, routes, tables, or symbols.
- `trace_error` - investigate an error string, stack, or failure mode and
  produce likely causes with evidence.
- `trace_table` - trace a table through schema, code references, routes, and
  related RPCs.
- `trace_rpc` - trace a database RPC/function through schema and callers.

### Neighborhood Tools

Use these when a table, route, or RPC is the center of the investigation and
the caller needs surrounding context.

- `table_neighborhood` - default for table-centered questions; includes schema,
  RLS, readers, writers, routes, and RPC context.
- `route_context` - default for route-centered questions; includes handler,
  imports, database touchpoints, RPCs, and relevant policy context.
- `rpc_neighborhood` - default for RPC-centered questions; includes callers,
  touched tables, policy context, and nearby implementation evidence.

### Graph Tools

Use these when the question is about relationships, dependency paths, or
implementation planning across multiple files.

- `graph_neighbors` - inspect immediate graph neighbors for a file, symbol,
  route, table, or RPC.
- `graph_path` - find evidence-backed paths between two known nodes.
- `flow_map` - map a higher-level flow across routes, components, services,
  tables, and RPCs.
- `change_plan` - produce an evidence-backed edit plan and expected blast
  radius before implementation.

### Imports And Symbols

Use these for module dependency, symbol, and export/import questions.

- `imports_deps` - inspect direct import dependencies for one or more files.
- `imports_impact` - estimate what may be affected by changing a file/module.
- `imports_hotspots` - identify highly connected import hotspots.
- `imports_cycles` - detect or inspect import cycles.
- `symbols_of` - list important symbols defined in a file.
- `exports_of` - list exports from a file or module.

### Database Tools

Use these for focused database introspection when the task does not require a
larger trace.

- `db_ping` - verify database connectivity and project wiring.
- `db_columns` - inspect columns for one or more tables.
- `db_fk` - inspect foreign keys and relationships.
- `db_rls` - inspect row-level security policies.
- `db_rpc` - inspect database RPC/function definitions.
- `db_table_schema` - inspect table DDL-level shape.

### Code Intelligence Tools

Use these for static code queries and repository checks.

- `ast_find_pattern` - find structural code patterns that text search may miss.
- `lint_files` - run focused lint/static checks against selected files.
- `repo_map` - use here as a code-intel entry point when the task starts from
  unfamiliar repository structure.

### Workflow And Operator Tools

Use these when the user needs an investigation packet, operational summary, or
multi-step workflow output rather than a single trace.

- `suggest` - propose next useful Mako queries or investigation directions.
- `investigate` - run a broader investigation workflow around a target.
- `workflow_packet` - produce a bundled workflow summary from gathered context.
- `tenant_leak_audit` - inspect likely tenant-boundary and data-leak risks.
- `health_trend` - summarize health trends from recorded signals.
- `issues_next` - identify likely next issues or triage targets.
- `session_handoff` - produce a concise handoff for later continuation.

### Artifact Tools

Use these to create structured, reusable task artifacts.

- `task_preflight_artifact` - create pre-implementation context and risks for a
  task.
- `implementation_handoff_artifact` - summarize implementation context for a
  coding handoff.
- `review_bundle_artifact` - prepare review findings, evidence, and risks.
- `verification_bundle_artifact` - summarize verification steps, outcomes, and
  remaining gaps.

### Recall Tools

Use these to avoid repeating work and to connect feedback to the correct prior
tool run.

- `recall_answers` - retrieve prior answer artifacts relevant to the current
  task.
- `recall_tool_runs` - retrieve recent Mako tool runs, including request IDs
  needed for feedback.

### Feedback, Telemetry, And Finding Acks

Use these for append-only quality signals and reviewed static-finding state.

- `agent_feedback` - log whether a specific prior Mako tool run was useful.
- `agent_feedback_report` - inspect feedback events by referenced tool, grade,
  time window, and aggregate counts.
- `runtime_telemetry_report` - inspect runtime telemetry aggregates, including
  `agent_feedback` events.
- `finding_ack` - acknowledge a specific static finding as reviewed,
  accepted-risk, false-positive, or otherwise handled.
- `finding_acks_report` - inspect acknowledged finding history.

## Feedback Logging Policy

The skill should tell Claude Code to log feedback selectively, not
mechanically.

Log `agent_feedback` when:

- a tool result materially accelerated the task;
- a result was partially useful but noisy, stale, incomplete, or missing an
  important edge;
- a result was wrong, misleading, or wasted the turn;
- a user explicitly comments on tool quality;
- a live-test or review asks for feedback capture.

Do not log `agent_feedback` when:

- no Mako tool was used;
- the result was ordinary and not worth a quality signal;
- the prior run cannot be identified;
- the feedback is about a static finding rather than tool usefulness.

When logging feedback:

1. Use `recall_tool_runs` to find the relevant recent run.
2. Prefer filtering by `toolName` and a recent ISO time window.
3. Use a small `limit` first to avoid unnecessary recall noise.
4. Copy the recalled `requestId` into `referencedRequestId`.
5. Set `referencedToolName` to the tool being rated.
6. Use `grade: "full" | "partial" | "no"`.
7. Include concise `reasonCodes` from the recommended vocabulary when
   available.
8. Include a short human-readable `reason`.

If no `requestId` is available, do not fabricate one. Either skip feedback or
use `recall_tool_runs` with a better filter.

Recommended reason-code vocabulary is guidance, not a hard enum. The skill
must use the **exact vocabulary the shipped `agent_feedback` tool
description advertises** (see `packages/tools/src/tool-definitions.ts`
entry for `agent_feedback`) so the model sees one consistent starter set
across both the skill and the tool's own description:

- `grade: "full"` → `answer_complete`, `evidence_sufficient`,
  `trust_matches`
- `grade: "partial"` → `partial_coverage`, `noisy`, `stale_evidence`,
  `missing_known_caller`, `top_not_useful`
- `grade: "no"` → `answer_wrong`, `wasted_turn`, `tool_did_nothing`,
  `schema_missing`

Codes are snake_case (not kebab-case) and bucketed by grade. The agent
may invent new codes when none fit; the starter set is a seed, not a
hard enum. If the tool description ever changes its vocabulary, update
this section in the same commit.

## Finding Acks Versus Tool Feedback

The skill must distinguish these surfaces:

- Use `agent_feedback` for rating a Mako tool run's usefulness.
- Use `finding_ack` for recording a decision about a specific lint/AST/static
  finding.

Do not use `finding_ack` to rate search/trace quality. Do not use
`agent_feedback` to suppress or accept a static finding.

## Telemetry Inspection Policy

`agent_feedback_report` and `runtime_telemetry_report` are inspection tools.
They should not automatically change routing behavior in Phase 9.

Use them when:

- reviewing whether feedback capture is working;
- summarizing tool quality over a time window;
- debugging whether a live session recorded events;
- preparing roadmap or implementation review notes.

Do not use them as an automatic ranking system for tool selection until a
future phase explicitly implements that behavior.

## Non-Goals

Phase 9 does not:

- replace the MCP server with an SDK;
- replace typed tools with MCP skills/resources;
- change server-side tool behavior;
- introduce automatic model routing based on feedback;
- add a second telemetry pipeline;
- require feedback after every Mako call.

## Done When

Phase 9 is complete when:

- a Claude Code plugin package exists at `mako-ai-claude-plugin/` and is
  installable locally via `claude --plugin-dir`;
- the plugin ships all 8 skills listed in **Package Shape → Skill
  allocation**: `mako-guide`, `mako-discovery`, `mako-trace`,
  `mako-neighborhoods`, `mako-graph`, `mako-database`, `mako-code-intel`,
  `mako-workflow`;
- each `SKILL.md` carries the canonical frontmatter template
  (`description`, `when_to_use`, `allowed-tools: mcp__mako-ai__*`) and the
  description strings match the authoritative set in **Skill Content
  Contract → Per-skill description strings**;
- the plugin manifest lives at `.claude-plugin/plugin.json` with `name`,
  `version`, `description`, `author`, and `keywords` populated;
- MCP configuration lives at `.mcp.json` at the plugin root (not inline
  in `plugin.json`);
- every MCP-visible Mako tool (52 registry tools + `tool_search` = 53
  total) is covered by at least one skill's decision guidance;
- `mako-guide` carries the cross-cutting feedback + finding-ack policy,
  and its reason-code vocabulary matches the shipped `agent_feedback`
  tool description verbatim (snake_case, bucketed by grade);
- every category skill (`mako-discovery`, `mako-trace`,
  `mako-neighborhoods`, `mako-graph`, `mako-database`, `mako-code-intel`)
  carries a **Feedback Logging** section before its "See Also" with the
  trigger condition, the 2-step `recall_tool_runs` → `agent_feedback`
  procedure, and a pointer to `/mako-ai:mako-guide` for the full rule
  set and reason-code vocabulary (see **Skill Content Contract →
  Feedback Logging section shape**);
- `mako-code-intel` additionally includes the `agent_feedback` /
  `finding_ack` contrast paragraph naming `ackableFingerprint` and
  `identity.matchBasedId`;
- feedback instructions use `recall_tool_runs` to locate the correct
  `referencedRequestId` before calling `agent_feedback`;
- finding acknowledgements (`finding_ack`) are documented separately
  from tool-run feedback (`agent_feedback`);
- local validation passes: `claude plugin validate
  <plugin-dir>` with zero errors (warnings tolerated);
- a live Claude Code session loaded via `claude --plugin-dir
  <plugin-dir>` can:
  - auto-invoke the right skill for a user query (turn-0 match),
  - call Mako MCP tools without per-call permission prompts,
  - log one `agent_feedback` row scoped to a real `requestId`,
  - inspect that row via `agent_feedback_report`,
  - do all of this without reading the roadmap docs manually.

## SDK In-Process Mode Remains Parked

The earlier Phase 9 candidate was an in-process SDK mode to avoid JSON-RPC
stdio overhead. That remains parked.

Reasons:

- live end-to-end testing showed the feedback path works through stdio MCP;
- there is no current evidence that subprocess or pipe overhead dominates
  latency;
- the SDK route would add a second integration surface and more lifecycle
  complexity;
- the plugin skill solves the immediate product gap: installation and
  consistent Claude Code behavior.

Reopen SDK work only if measurements show that the current stdio MCP boundary
is the dominant performance or reliability bottleneck.

## Official References

- [Create plugins](https://code.claude.com/docs/en/plugins) - plugin versus
  standalone configuration, `.claude-plugin/plugin.json`, plugin skills, and
  local testing with `claude --plugin-dir`.
- [Extend Claude with skills](https://code.claude.com/docs/en/skills) - skill
  locations, `SKILL.md`, plugin skill namespacing, frontmatter, and invocation.
- [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp) -
  plugin-provided MCP servers and `.mcp.json`.
- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) -
  plugin structure, MCP config placement, validation, debugging, and versioning.

## CC source references (verified via codexref)

The design in this doc was validated against these CC source files — cite
them when implementing if the docs diverge:

- `CC/utils/plugins/schemas.ts:273-316` — `PluginManifestMetadataSchema`
  (only `name` required; kebab-case required for marketplace sync).
- `CC/utils/plugins/schemas.ts:884-899` — `PluginManifestSchema`
  composition of 11 sub-schemas (hooks, commands, agents, skills,
  outputStyles, channels, mcpServers, lspServers, settings, userConfig).
- `CC/utils/plugins/mcpPluginIntegration.ts:131-163` — MCP server
  precedence: `.mcp.json` first, manifest `mcpServers` overrides on
  conflict.
- `CC/utils/plugins/loadPluginCommands.ts:780-834` — plugin skill
  loading; skills auto-discovered at `skills/<name>/SKILL.md`; invoked as
  `/<plugin>:<skill>`.
- `CC/utils/plugins/loadPluginCommands.ts:~329-340` — plugin variable
  substitution in skill bodies: `${CLAUDE_PLUGIN_ROOT}`,
  `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_SKILL_DIR}`,
  `${CLAUDE_SESSION_ID}`, `${user_config.X}`.
- `CC/skills/loadSkillsDir.ts:184-265` — `parseSkillFrontmatterFields`;
  canonical list of frontmatter fields CC parses.
- `CC/skills/loadSkillsDir.ts:100-105` and
  `CC/utils/analyzeContext.ts:591` — only `[name, description,
  when_to_use]` enters the always-loaded token budget; body loads on
  invocation.
- `CC/skills/loadSkillsDir.ts:383-391` — `allowed-tools` is
  session-scoped pre-approval via
  `toolPermissionContext.alwaysAllowRules.command` when the skill is
  active.
- `CC/utils/attachments.ts:766-816` — turn-0 skill auto-match against
  user input; this is why `description` must describe user intent, not
  tool names.
- `CC/skills/bundled/claudeApi.ts:184-188` — canonical
  `TRIGGER when: … / DO NOT TRIGGER when: …` description pattern to
  mirror.
- `CC/utils/plugins/validatePlugin.ts:247-305`,
  `CC/utils/plugins/validatePlugin.ts:716` — what `claude plugin
  validate` checks (manifest schema, frontmatter YAML, component paths;
  skills require `<name>/SKILL.md`, loose `.md` files not accepted).
