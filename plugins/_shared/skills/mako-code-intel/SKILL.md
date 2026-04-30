---
description: >-
  TRIGGER when: user wants structural code pattern search (ast-grep) or static
  lint against selected files, or wants to turn a fix diff into a rule-pack
  draft. Covers `ast_find_pattern`, `lint_files`, `extract_rule_template`.
when_to_use: >-
  Use when text search is too weak for a syntax pattern, when the user wants
  focused diagnostics/static findings for known files, or after fixing a bug
  shape that should become project knowledge.
allowed-tools: "mcp__mako-ai__*"
---

# Mako Code Intel

Use this skill for static code queries that are best answered by syntax-aware
search or diagnostics. It is not the general repo-orientation skill; use
`repo_map` through `/mako-ai:mako-discovery` for that.

## Tools

### `ast_find_pattern`

Use for structural code pattern search over indexed TypeScript, TSX,
JavaScript, and JSX files.

- Best for finding syntax shapes that text search may miss.
- Use for patterns such as function calls, JSX attributes, hook usage,
  imports, conditionals, or unsafe constructs.
- Keep searches bounded with focused patterns and file scopes when possible.
- TSX/JSX snippets starting with `{`, `[`, or `<` also run with parser
  context, so callers usually do not need to wrap lone object or JSX patterns.
  Check `patternAttempts` and match `patternVariant` when you need to know
  whether the original or auto-anchored form matched.
- List metavariables in `captures` when you need captured values returned.
- If the result is a false positive that should not recur, use `finding_ack`
  from `/mako-ai:mako-workflow` with the returned `ackableFingerprint`.

### `lint_files`

Use for focused lint/static diagnostics against selected files.

- Best after editing files or when reviewing a known suspect area.
- Defaults to compact output; pass `verbosity: "full"` or `maxFindings` when
  broad diagnostics are actually needed.
- YAML rule packs under `.mako/rules` hot-reload in long-running MCP sessions.
- For helper-bypass checks, rule packs may declare `canonicalHelper` with a
  helper `symbol` and optional `path`; matching files that already reference
  the helper are suppressed, while bypasses emit producer/consumer context.
- Use the returned finding identity/fingerprint when acknowledging reviewed
  diagnostics.
- Do not use `agent_feedback` to suppress a diagnostic; use `finding_ack`.

### `extract_rule_template`

Use after a fix lands and the removed shape should become future project
knowledge.

- Pass the local git `fixCommit`; optionally pass `baseCommit`, `filePath`, and
  `ruleIdPrefix`.
- Treat the returned `draftYaml` as a draft. Review broad patterns and caveats
  before placing it under `.mako/rules`.
- Follow with `rule_pack_validate` and a focused `lint_files` run before relying
  on the new rule.

## Feedback Logging

Log `agent_feedback` when a tool run here was notably useful, partial,
noisy, stale, wrong, or wasted the turn. Skip routine calls.

Required procedure (see `/mako-ai:mako-guide` for full rules and
reason-code vocabulary):

1. Call `recall_tool_runs` to get the prior run's `requestId`. Do not
   fabricate one — if no run is recalled, skip feedback.
2. Call `agent_feedback` with `referencedToolName`,
   `referencedRequestId`, `grade: "full" | "partial" | "no"`,
   `reasonCodes` from the starter vocabulary in `/mako-ai:mako-guide`,
   and a short `reason`.

For individual false-positive or reviewed-accepted static findings from
`ast_find_pattern` or `lint_files`, use `finding_ack` with the returned
`ackableFingerprint` (ast) or `identity.matchBasedId` (lint) — never
`agent_feedback` to suppress static findings. Rate the tool run's
usefulness with `agent_feedback`; mark individual findings with
`finding_ack`. See `/mako-ai:mako-workflow` for `finding_ack` usage.

## See Also

- Use `/mako-ai:mako-discovery` for repo orientation and broad cross-surface
  search.
- Use `/mako-ai:mako-graph` for import impact, cycles, hotspots, and symbols.
- Use `/mako-ai:mako-workflow` for `finding_ack` and finding ack reports.
