# Privacy

agentmako is a local-first developer tool. This document describes
what data the project handles, where it lives, and what it never
does.

## Summary

- agentmako runs **entirely on your machine**. There is no hosted
  agentmako service.
- The project does **not collect telemetry** of any kind. No analytics,
  no usage pings, no error reporting endpoint.
- Source code, schema snapshots, tool runs, and Reef Engine facts are
  stored in **local SQLite databases** under your project's `.mako/`
  directory. They are never uploaded.
- Database credentials, when used, are stored in your **OS keychain**
  via `@napi-rs/keyring`. Project config files store keychain
  references, not plaintext URLs.

## What agentmako reads

When you attach a project with `agentmako connect`, the indexer reads
files from your project's working tree to build a local index (code,
imports, routes, optional schema snapshots). Files matched by your
`.gitignore` and Mako's own ignore list are skipped.

When you attach a database, agentmako runs **read-only** introspection
queries (column metadata, indexes, RLS policies, function definitions)
to build a schema snapshot. It does not read row-level data unless a
specific tool you invoke explicitly does so. Live database tools remain
read-only unless a tool is explicitly designed and documented as a
mutation against agentmako's local store (e.g. `db_review_comment`
writes only to your local SQLite).

## What agentmako sends

Nothing, by default.

The CLI and MCP server make outbound network requests only when:

1. **You configure a model provider** (Anthropic, OpenAI, Ollama,
   LMStudio, etc.) for the optional harness. In that case, the harness
   talks to the provider you configured, on your behalf, with the
   prompts you submit. Provider keys are stored in your OS keychain.
2. **You explicitly use Supabase or Postgres tooling** that connects to
   your own database. agentmako talks only to the database you point
   it at.

There is no Anthropic-account-style identifier, no analytics endpoint,
and no automatic update mechanism beyond `npm install -g agentmako`.

## Where state lives

- **Per-project state**: `.mako/` inside your project root (SQLite
  files, indexes, tool run history, findings, Reef facts).
- **Global state**: `~/.mako/` on your machine (project registry,
  preferences).
- **Secrets**: OS keychain only. agentmako never writes plaintext
  database URLs or provider keys to disk.

You can delete any of these at any time. agentmako does not synchronize
state across machines.

## Telemetry

agentmako has no telemetry. There is no opt-in or opt-out flag because
there is nothing to opt out of.

If a future release ever adds telemetry, it will be **off by default**,
will require explicit opt-in, will be documented in CHANGELOG.md, and
will be limited to anonymous usage signals — never source code,
secrets, or database content.

## The Claude Code plugin (mako-ai)

The `mako-ai` Claude Code plugin (in
[`mako-ai-claude-plugin/`](./mako-ai-claude-plugin)) ships skills and an
`.mcp.json` that launches the `agentmako mcp` stdio server locally on
your machine. The plugin itself does not communicate with any service
operated by the agentmako project.

When the plugin is installed inside Claude Code, your interaction with
Claude Code is governed by Anthropic's privacy policy. agentmako does
not see, log, or proxy that interaction.

## Reporting a privacy issue

Use the repository's
[private vulnerability reporting form](https://github.com/drhalto/agentmako/security/advisories/new).
Privacy reports filed there are routed to the maintainers privately.

Please do not include real database URLs, provider keys, customer
data, or proprietary source code in privacy reports.
