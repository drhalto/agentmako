## Summary

<!-- One or two sentences on what this PR changes and why. -->

## Type of change

<!-- Check all that apply. -->

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] Tooling / CI
- [ ] Other (describe below)

## Verification

<!-- How did you verify this works? Paste relevant commands and results. -->

- [ ] `corepack pnpm run typecheck`
- [ ] `corepack pnpm run build`
- [ ] Smoke coverage for the touched surface (e.g. `corepack pnpm run test:smoke:reef-tooling`)
- [ ] Manual exercise of the affected CLI / MCP tool / dashboard view

## Notes for reviewers

<!-- Anything reviewers should pay extra attention to: tricky migration,
     contract change, perf concern, follow-ups intentionally deferred,
     etc. -->

## Checklist

- [ ] No `.env`, secrets, SQLite DB files, or `.mako/` runtime state included
- [ ] No live database URLs or provider keys in code, tests, fixtures, or docs
- [ ] Public-facing changes (CLI flags, MCP tool contracts, HTTP routes)
      are reflected in `TOOLS.md`, `apps/cli/README.md`, or `CHANGELOG.md`
      as applicable
