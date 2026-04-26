# Known Issues

Small, non-blocking issues that are out of scope for whatever we're currently working on but shouldn't be forgotten. Each entry should be short enough that a future reader — or a future AI agent coming in fresh — can understand the problem and fix it without spelunking.

Add new entries at the top. Mark an entry as resolved by moving it under `## Resolved` with a short note and a date.

Format:

- **Title** — one short line naming the issue
- **Severity** — `low`, `medium`, `high`
- **Where** — file paths and line numbers where the bug lives
- **Symptom** — what the user or test sees
- **Root cause** — the real reason, one or two sentences
- **Fix** — the specific thing to change, scoped small
- **Why deferred** — why we haven't fixed it yet

---

_no open issues — add new entries above this line_

---

## Resolved

### Windows EBUSY on smoke test cleanup with shared GlobalStore — 2026-04-16

Fixed by adding a shared smoke cleanup helper (`test/smoke/state-cleanup.ts`) with retrying rmSync plus a Windows-only best-effort fallback for run-scoped temp state dirs. In-process services are now closed before cleanup in all smoke scripts. Directory scanning in `packages/store/src/path-utils.ts` ignores `.mako-ai-*` temp dirs so leftover smoke dirs don't contaminate indexing. Residual: Windows can still leave `~/.mako-ai-smoke-*` dirs behind if SQLite holds the WAL handle past the retry window — the suite no longer fails on that.

### Smoke test `project attach` assumes fresh `repo_only` mode on the mako-ai repo — 2026-04-15

Fixed by replacing the `cleanup()` function in `test/smoke/core-mvp.ts` with a backup-and-restore pair (`setupFreshState` / `teardownState`). Any pre-existing `.mako/` on the mako-ai repo or `apps/web` is now moved aside to `.mako.smoke-backup/` at test startup so the fresh-state assertions run against a clean slate; the backup is restored on teardown (including the error-path teardown). Also crash-safe — if a prior run died after the backup but before the restore, the next run restores the stale backup before starting over, so the maintainer's original state is never silently lost. Verified end-to-end by staging a sentinel `.mako/project.json`, running the full smoke suite, and confirming the sentinel was intact afterward.
