# Mako AI Claude Code Plugin

This plugin packages Mako guidance and MCP wiring for Claude Code.

It does not replace Mako's typed MCP tools. It teaches Claude Code when to use
them, while `.mcp.json` starts the existing `agentmako mcp` stdio server.

## Prerequisites

- Claude Code installed.
- Node.js 20+ on `PATH` (the plugin's `.mcp.json` runs `npx -y agentmako mcp`,
  which fetches and caches the published `agentmako` package automatically).
- A Mako project already attached or initialized for the repo you are using.

## Local Development

From the Mako repo root:

```powershell
claude plugin validate .\mako-ai-claude-plugin
claude --plugin-dir .\mako-ai-claude-plugin
```

Inside Claude Code, the skills appear under the `mako-ai` namespace:

- `/mako-ai:mako-guide`
- `/mako-ai:mako-discovery`
- `/mako-ai:mako-trace`
- `/mako-ai:mako-neighborhoods`
- `/mako-ai:mako-graph`
- `/mako-ai:mako-database`
- `/mako-ai:mako-code-intel`
- `/mako-ai:mako-workflow`

Use `/mcp` in Claude Code to verify the plugin-provided `mako-ai` MCP server is
connected.

## Skill Layout

`mako-guide` is the entry skill and owns cross-cutting feedback policy.
The remaining skills are category-scoped so Claude Code can load only the
guidance relevant to the user's intent.

Live tool schemas come from MCP ToolSearch and `tools/list`. The skills should
not be treated as schema references.

## Feedback Policy

Use `agent_feedback` selectively, not after every call. First use
`recall_tool_runs` to find the prior run and copy its `requestId` into
`agent_feedback.referencedRequestId`.

Use `finding_ack` only for reviewed static findings from tools such as
`ast_find_pattern` and `lint_files`; do not use it to rate tool usefulness.

