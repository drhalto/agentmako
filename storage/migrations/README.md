# storage/migrations

**These SQL files are no longer the source of truth for mako-ai's SQLite migrations.** The canonical SQL lives inlined as string constants in `packages/store/src/migration-sql.ts`. That inlining was done in Phase 3.2.1 so the CLI bundle could ship as a self-contained tarball without runtime file-resolution to a migrations directory that doesn't exist in the published package.

These files are kept here for two reasons:

1. **Readability / reference.** Plain `.sql` in a real editor with syntax highlighting is easier to review than a template literal. When you need to change a migration, it's fine to draft the new SQL in the corresponding `.sql` file first, then copy the body into the constant in `packages/store/src/migration-sql.ts`. The `.ts` file is still the canonical source — the `.sql` files are follow-along mirrors.
2. **Smoke-test fixtures.** `test/smoke/core-mvp.ts` attaches the mako-ai repo itself as a project and runs `schema_usage projects` against it, expecting the indexer to find schema evidence derived from a real SQL file in the tree. These files satisfy that expectation without requiring the smoke harness to stand up a separate scratch fixture.

If you edit a migration, **edit both copies**. If those ever drift, the TS constant wins at runtime and the `.sql` files become stale documentation.
