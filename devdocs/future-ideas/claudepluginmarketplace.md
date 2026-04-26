# Roadmap Version CC - Future Ideas

These are parked follow-ups for the Claude Code Native roadmap. They are not
part of the completed Phase 1-9 implementation unless explicitly reopened.

## Phase 9.1 - Claude Plugin Distribution And Discovery

**Trigger.** Phase 9 ships `mako-ai-claude-plugin/` in the repo and validates
locally with `claude plugin validate`, but a normal `npm install -g agentmako`
user does not automatically discover or install that plugin.

**Problem.** Today the CLI package publishes `dist` and `README.md` only. The
Claude Code plugin is versioned in the monorepo, but it is not surfaced through
the published `agentmako` package, CLI help, post-connect hints, or a Claude
Code marketplace flow.

**Why this is parked.** Phase 9's acceptance was to create the plugin package
and guidance skills. Distribution UX is a separate packaging problem with a
different verification surface: npm tarball contents, CLI commands, install
docs, and possibly marketplace metadata.

**Likely shape.**

- Include the Claude Code plugin in the published `agentmako` package, probably
  under `apps/cli/claude-plugin/` or another path included by
  `apps/cli/package.json#files`.
- Add a CLI command such as `agentmako claude plugin-path` that prints the
  resolved installed plugin directory.
- Add a setup helper such as `agentmako claude setup` that prints the exact
  `claude --plugin-dir "<path>"` command and verifies `agentmako` is on `PATH`.
- Add a short post-`agentmako connect` hint for Claude Code users pointing at
  the setup command.
- Update `devdocs/install-and-run.md`, the root README, and the CLI package
  README with the plugin install path.
- Later, add Claude Code marketplace metadata so users can install with
  `/plugin marketplace add` and `/plugin install mako-ai@...`.

**Done when.**

- A clean-machine `npm pack` / install contains the plugin files.
- A normal user can run one documented command to find or enable the plugin.
- `claude plugin validate <installed-plugin-path>` passes from the installed
  package.
- The install docs explain both the raw MCP `.mcp.json` path and the richer
  Claude Code plugin path.

  Minor optional polish (non-blockers)

  - plugin.json author — currently { "name": "mako-ai" }. For public release, add "url": "https://github.com/..." once the repo URL is stable. Not required; PluginAuthorSchema only requires name.
  - README.md could include validate output — a note like "Expected: Valid plugin manifest" helps users know what success looks like. Optional.
  - Consider adding a LICENSE file at plugin root — not required by CC loader but good for public distribution.

  