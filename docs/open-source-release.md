# Open Source Release Guide

This guide prepares Mako for a clean public repository with no private
development history.

Mako is licensed under Apache-2.0. The Apache Software Foundation's
guidance for applying Apache-2.0 is to include one copy of the license
text in a top-level `LICENSE` file. This repository does that.

## Current Release Posture

- Root license file: `LICENSE`
- Root package license: `Apache-2.0`
- CLI package license: `Apache-2.0`
- Root package remains `"private": true` to prevent accidental npm
  publication of the monorepo.
- Publishable CLI package: `apps/cli` / `agentmako`

Before the first public push, confirm the final copyright owner name you
want associated with the release. The license is in place, but the public
repository description, package repository URL, and any copyright notice
should match the final owner/org.

## What Must Not Ship

Do not copy these into the clean public repository:

- `.git/` from this private working repo
- `.env`, `.env.*`, local database URLs, provider keys, or CI secrets
- `.mako/`, `.mako-ai-*`, `.mako-ai-runtime/`
- `.claude/`, `.tmp-live-test/`, Playwright/MCP local state
- `node_modules/`
- generated `dist/`, `build/`, coverage, logs, SQLite DB/WAL/SHM files
- local worktrees, test scratch projects, or packaged installers from
  private experiments

The tracked `.gitignore` should exclude these going forward, but the
export check below is still mandatory.

## Release Checks

Run from the private working repo after the final release-prep commit:

```bash
corepack pnpm install
corepack pnpm run typecheck
corepack pnpm run build
corepack pnpm run test:smoke:reef-tooling
corepack pnpm run test:smoke:reef-model-facing-views
```

Optional full verification:

```bash
corepack pnpm test
```

Check tracked files for obvious local state:

```bash
git ls-files | rg '(^|/)(\.env|.*\.db|.*\.sqlite|.*\.sqlite3|.*\.pem|.*\.key|.*\.pfx|.*\.p12|\.claude/|\.tmp-live-test/)'
```

Check current content for accidental high-signal secret markers. Expect
some false positives in tests/docs; inspect every non-fixture hit:

```bash
rg -n "SUPABASE_SERVICE_ROLE|service_role|OPENAI_API_KEY|ANTHROPIC_API_KEY|sk-[A-Za-z0-9]|password|secret|token" -g "!node_modules/**" -g "!dist/**"
```

## Clean-History Export

Use `git archive` from a clean commit. Do not copy the working directory
by hand and do not push this repository's existing `.git` history.

PowerShell example:

```powershell
$target = "C:\Users\Dustin\mako-ai-public"
if (Test-Path $target) { throw "Destination already exists: $target" }

git diff --quiet
if ($LASTEXITCODE -ne 0) { throw "Commit or stash working-tree changes before export." }

git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { throw "Commit or unstage staged changes before export." }

New-Item -ItemType Directory -Path $target | Out-Null
git archive --format=tar HEAD | tar -x -C $target

Push-Location $target
git init
git add .
git commit -m "Initial open source release"
Pop-Location
```

Then run the release checks again inside `$target`.

## Public Repo Setup

After creating the new repository:

- set the repository license to Apache-2.0;
- update package `repository.url` fields if the final GitHub org/name is
  different from the private repo;
- enable branch protection before accepting outside contributions;
- enable Dependabot or a similar dependency alert workflow;
- enable private vulnerability reporting if GitHub supports it for the
  repository;
- keep any signing keys, package publish tokens, provider keys, database
  URLs, and Supabase credentials in CI/repository secrets only.

## First Public Commit

The first public commit should contain source, docs, tests, migrations,
and lockfile only. It should not contain old roadmap scratch state that
is no longer useful to users, local agent state, generated bundles, or
private history.
