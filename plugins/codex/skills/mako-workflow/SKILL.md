---
description: >-
  TRIGGER when: user wants an investigation packet, pre-ship artifact, recall
  of prior work or answers, or to log tool-run feedback / inspect telemetry.
  Covers `suggest`, `investigate`, `workflow_packet`, `tenant_leak_audit`,
  `health_trend`, `issues_next`, `session_handoff`, all four artifact tools,
  `recall_answers`, `recall_tool_runs`, `agent_feedback`,
  `agent_feedback_report`, `runtime_telemetry_report`, `finding_ack`,
  `finding_acks_report`.
when_to_use: >-
  Use for multi-step workflows, durable task artifacts, prior-session memory,
  feedback logging, telemetry inspection, and reviewed static-finding state.
allowed-tools: "mcp__mako-ai__*"
---

# Mako Workflow

Use this skill when the user needs a workflow output rather than a single trace:
investigation packets, pre-implementation or review artifacts, prior-session
recall, feedback, telemetry, or finding acknowledgements.

## Operator And Workflow Tools

### `suggest`

Use to propose useful Mako queries or investigation directions.

### `investigate`

Use to run a broader bounded investigation workflow around a target.

### `workflow_packet`

Use to produce a bundled workflow summary from gathered context.

### `tenant_leak_audit`

Use to inspect likely tenant-boundary and data-leak risks.

- Pair with `db_rls`, `route_context`, `rpc_neighborhood`, or review artifacts
  when the user is evaluating security-sensitive changes.

### `health_trend`

Use to summarize health trends from recorded project signals.

### `issues_next`

Use to identify likely next issues or triage targets.

### `session_handoff`

Use to produce a concise handoff for later continuation.

## Artifact Tools

### `task_preflight_artifact`

Use before implementation to create task context, risks, likely move surfaces,
and verification plan.

### `implementation_handoff_artifact`

Use when handing coding work to another agent or future session.

### `review_bundle_artifact`

Use for pre-ship review findings, evidence, and risks.

### `verification_bundle_artifact`

Use to summarize verification steps, outcomes, trust state, and remaining gaps.

## Recall Tools

### `recall_answers`

Use to retrieve prior answer artifacts relevant to the current task.

### `recall_tool_runs`

Use to retrieve recent Mako tool runs.

- Use this before `agent_feedback`.
- Copy the returned `requestId` into `agent_feedback.referencedRequestId`.
- Default limit is 50 and max is 500; use a smaller limit first when locating a
  recent run.

## Feedback And Telemetry

### `agent_feedback`

Use to log whether a specific prior Mako tool run was useful.

- Use sparingly for notable full, partial, or no-usefulness cases.
- Requires both `referencedToolName` and `referencedRequestId`.
- Do not call after every Mako tool.
- Use `recall_tool_runs` first; do not fabricate request IDs.

Starter reason codes:

- `full`: `answer_complete`, `evidence_sufficient`, `trust_matches`
- `partial`: `partial_coverage`, `noisy`, `stale_evidence`,
  `missing_known_caller`, `top_not_useful`
- `no`: `answer_wrong`, `wasted_turn`, `tool_did_nothing`, `schema_missing`

### `agent_feedback_report`

Use to inspect feedback events by referenced tool, grade, time window, and
aggregate counts.

### `runtime_telemetry_report`

Use to inspect runtime telemetry aggregates and event lists.

- Use for review/debugging, not automatic tool selection.

## Finding Acknowledgements

### `finding_ack`

Use to acknowledge a specific static finding as reviewed, accepted-risk,
false-positive, or otherwise handled.

- Use for findings from `ast_find_pattern` and `lint_files`.
- Do not use it to rate Mako search or trace quality.
- Defaults to preview. Re-call with `preview: false` only after the
  acknowledgement is intentionally being applied.

### `finding_ack_batch`

Use to acknowledge multiple reviewed findings at once.

- Defaults to preview and returns `wouldApply` plus rejected rows.
- Re-call with `preview: false` only when the batch suppression is intentional.

### `finding_acks_report`

Use to inspect acknowledged finding history and trends.

## See Also

- Use `/mako-ai:mako-guide` for the full feedback versus finding-ack policy.
- Use `/mako-ai:mako-trace`, `/mako-ai:mako-neighborhoods`, and
  `/mako-ai:mako-graph` to gather evidence before producing artifacts.
