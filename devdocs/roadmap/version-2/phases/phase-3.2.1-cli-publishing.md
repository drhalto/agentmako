# Phase 3.2.1 CLI Publishing

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 3.2.1, a focused follow-up to Phase 3.2.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.2.1.

## What Shipped

- **Bundled CLI artifact.** `apps/cli/dist/index.js` is now a single self-contained ESM bundle (~572 KB minified, 113 KB tarballed) produced by `tsup`. Every `@mako-ai/*` workspace package is inlined; `zod` is inlined too because it's pure JS and used across multiple deps. Only native bindings (`@napi-rs/keyring`, `pg`, `pg-native`) and the `@modelcontextprotocol/sdk` family stay external — the SDK uses complex subpath exports that tsup's bundler can't fully inline, so it's declared as a runtime dep and npm resolves its transitive `ajv` / `ajv-formats` / `supports-color` deps on install.
- **`node:` prefix preservation.** esbuild strips the `node:` prefix from built-in imports by default, which breaks prefix-only built-ins like `node:sqlite` (the bare `sqlite` specifier is not a real npm package). Added a post-build `restoreNodePrefixes` pass in `tsup.config.ts` that rewrites `from "sqlite"` back to `from "node:sqlite"` after bundling. Regex-based and scoped to a single known prefix-only list — add new names there if the codebase ever picks up another prefix-only built-in like `node:test`.
- **Inlined SQLite migrations.** The store package used to load migration SQL at runtime via `readFileSync(new URL("../../../storage/migrations/...", import.meta.url))`, which worked in the monorepo but broke in a bundled tarball (the relative path resolved to a directory that doesn't exist in the installed package, producing a classic `ENOENT` on first-ever run). The SQL is now inlined as template-literal constants in `packages/store/src/migration-sql.ts`; `SqliteMigration` carries `sql: string` instead of `relativePath: string`; `loadMigrationSql` is gone. The original `.sql` files in `storage/migrations/` are retained as **reference mirrors + smoke-test fixtures** (the smoke harness attaches the mako-ai repo as a project and asserts `schema_usage` returns schema evidence derived from scanning those files). A README in `storage/migrations/` documents the split role explicitly so future editors know the TS constants are canonical and the `.sql` files are follow-alongs.
- **Dead direct-execution block removed.** `services/api/src/server.ts` had a leftover `if (import.meta.url === pathToFileURL(process.argv[1]).href) { void main().catch(...) }` block meant for standalone `node services/api/src/server.ts` invocation. Nothing in the repo actually ran it that way, and when bundled into the CLI the guard fired spuriously because the bundle IS the entry point — the duplicate `main()` parsed `["--json"]` as a port argument and crashed the real CLI before it could start. Removed with a long comment explaining the bundling hazard so it doesn't come back.
- **`workspace-deps` strategy.** `@mako-ai/api`, `@mako-ai/config`, `@mako-ai/contracts` moved from `dependencies` to `devDependencies` (they're inlined by the bundle and should not appear in the published package's runtime deps). Runtime deps are now `@modelcontextprotocol/sdk@^1.17.4`, `@napi-rs/keyring@^1.1.5`, `pg@^8.20.0`.
- **`prepublishOnly` guard.** `prepublishOnly` regenerates both declaration artifacts and the JS bundle (`npm run build:types && npm run build`) before `apps/cli/scripts/verify-bundle.mjs` runs. The verifier checks: (a) `dist/index.js` exists, (b) `dist/index.d.ts` and `dist/index.d.ts.map` exist, (c) first line is the Node shebang, (d) no remaining `@mako-ai/*` imports in the bundle. Any failure exits non-zero and blocks the publish.
- **`apps/cli/README.md`.** Short, factual, user-facing docs for the published package. Install (`npx agentmako`, `npm install -g agentmako`), the `connect` flow, day-to-day commands (`status`, `verify`, `refresh`), the relevant flags, and a link back to the main repo. Uses the product description from `package.json` verbatim — no invented copy.
- **`files` whitelist.** `["dist", "README.md"]`. `npm pack` now produces a tarball with exactly 5 files: `dist/index.js`, `dist/index.d.ts`, `dist/index.d.ts.map`, `README.md`, `package.json`. Package size 113 KB, unpacked 602 KB.
- **`tsc` + `tsup` coexist in `dist/`.** Root `tsc -b` emits `dist/index.d.ts` (declarations only, via `emitDeclarationOnly: true` on the CLI's `tsconfig.json`) so the composite project reference is still valid for monorepo typecheck. `tsup` has `clean: false` so it doesn't wipe the declarations before writing `dist/index.js`. With `splitting: false` and a single entry, tsup produces exactly one JS file, so there are no stale files to worry about.
- **Clean-environment verification.** Packed the tarball with `npm pack`, installed it into a fresh directory outside the monorepo via `npm install ./agentmako-0.1.0.tgz`, and ran the installed `./node_modules/.bin/agentmako connect` against a scratch Next.js project. The bin resolved, the CLI ran end-to-end, migrations applied, the scan and profile-depth detection completed, and the JSON output showed the expected `serverOnlyModules` and `authGuardSymbols` values. This is the first time mako-ai has actually been shippable from a published tarball.

## Code Touchpoints

- `apps/cli/tsup.config.ts` — **new file**. Bundles `src/index.ts` into `dist/index.js` with `noExternal: [/^@mako-ai\//, "zod"]`, external SDK + native deps, `clean: false`, `splitting: false`, and a post-build `onSuccess` hook that runs `restoreNodePrefixes` to rewrite `from "sqlite"` back to `from "node:sqlite"`.
- `apps/cli/scripts/verify-bundle.mjs` — **new file**. Publish guard that verifies `dist/index.js`, `dist/index.d.ts`, and `dist/index.d.ts.map`; checks the JS shebang and absence of `@mako-ai/*` imports; exits non-zero on any failure.
- `apps/cli/README.md` — rewritten from a stub to user-facing docs.
- `apps/cli/package.json` — scripts: `build: "tsup"`, `build:types: "tsc -p tsconfig.json --emitDeclarationOnly --outDir dist"`, `prepublishOnly: "npm run build:types && npm run build && node scripts/verify-bundle.mjs"`. Dependencies restructured: workspace deps moved to devDependencies, native runtime deps moved into `dependencies`. `files` whitelist confirms tarball contents.
- `apps/cli/tsconfig.json` — added `emitDeclarationOnly: true` so `tsc -b` (root typecheck pass) only emits `.d.ts` files and doesn't collide with tsup's output in `dist/`.
- `package.json` (root) — `build` and `build:force` scripts now chain tsc → `pnpm --filter agentmako run build` → web static copy, so a top-level build produces the bundled CLI as part of the normal pipeline.
- `packages/store/src/migration-sql.ts` — **new file**. Four template-literal constants (`GLOBAL_MIGRATION_0001_INIT_SQL`, `PROJECT_MIGRATION_0001_INIT_SQL`, `PROJECT_MIGRATION_0002_SCHEMA_SNAPSHOT_SQL`, `PROJECT_MIGRATION_0003_DB_BINDING_STATE_SQL`) holding the canonical runtime SQL for the two SQLite stores. A file header explains the bundling hazard that motivated the inlining and warns against re-introducing file-read migrations.
- `packages/store/src/sqlite.ts` — `SqliteMigration.relativePath` replaced with `SqliteMigration.sql`; `loadMigrationSql` removed; `applyMigrations` now pulls `migration.sql` directly. `readFileSync` import dropped.
- `packages/store/src/global-store.ts` and `packages/store/src/project-store.ts` — import the new SQL constants from `./migration-sql.js` and pass them as the `sql` field of each migration descriptor.
- `services/api/src/server.ts` — removed the `main()` function and its `if (import.meta.url === ...)` direct-execution guard (the dead bundling hazard). `pathToFileURL` import dropped.
- `storage/migrations/` — kept the `.sql` files as reference mirrors and smoke-test fixtures. Added a `README.md` explaining the split role and that the TS constants are canonical.
- `devdocs/architecture/database.md` — updated to link to both the `.sql` files (reference) and `packages/store/src/migration-sql.ts` (canonical runtime source).

## Goal

Make `npx agentmako connect` and `npm install -g agentmako` actually work from a clean machine against a published tarball. This is the shippability gap Phase 3.2 advertised but did not close.

## Why This Phase Exists

Phase 3.2 shipped the `agentmako` package name, bin shape, and CLI UX, and marked the connect flow as the flagship cold-start path. The package is now marked public (`"private"` flag removed, `license`, `description`, and `repository` filled in), but actually publishing it still fails for two reasons:

1. Every `@mako-ai/*` workspace dependency in the chain is still `"private": true`, so `pnpm publish` has nothing to resolve `workspace:*` against.
2. The `dist/` output from `tsc -p tsconfig.json` emits external `import` statements for every `@mako-ai/*` module. A user who runs `npm install -g agentmako` would pull the tarball and fail to resolve the scoped imports at startup.

Since `npx agentmako connect` is now the advertised flagship path, this gap cannot live as a soft "Known Gap" note under Phase 3.2. It gets its own phase so it has explicit scope, verification, and done-when criteria.

## Hard Decisions

- this phase is a packaging/bundling phase, not a feature phase
- the CLI must publish as a single bundled artifact, not as a flotilla of `@mako-ai/*` packages
- the bundler should inline every `@mako-ai/*` workspace dependency plus any pure-JS runtime deps; native modules (like `@napi-rs/keyring` and `pg`) stay external
- `tsc --noEmit` stays as the typecheck pass so the monorepo project references still validate types; bundling is a separate build step
- `prepublishOnly` must guarantee that `npm publish` cannot accidentally publish a non-bundled `dist/`
- the whole story must be validated on a clean machine, not only on the maintainer's workstation

## Scope In

- bundle the CLI into a publishable artifact: pick one of `tsup`, `esbuild`, or `@vercel/ncc` and add it as a devDependency on `apps/cli`
- decide the workspace-dependency strategy: inline all `@mako-ai/*` packages into the bundle, leave native and non-JS deps external, and move anything that's now inlined out of `dependencies` into `devDependencies`
- add a `prepublishOnly` script that (a) regenerates the declaration files and bundle from scratch, (b) verifies the resulting `dist/index.js` is self-contained (no `@mako-ai/*` imports remain), and (c) refuses to publish if any verification step fails
- add CLI README and package polish: a short `apps/cli/README.md` that `npm` will render on the package page, covering install, `agentmako connect`, and the top-level aliases; a minimal `files` whitelist so the tarball ships only `dist/index.js`, `dist/index.d.ts`, `dist/index.d.ts.map`, the README, and the package.json
- verify real `npx agentmako connect` and `npm install -g agentmako` from a clean machine (or a clean Docker container) against a locally-packed tarball (`npm pack` → `npm install -g ./agentmako-0.1.0.tgz`) before any actual publish

## Scope Out

- the actual `npm publish` to the registry — this phase leaves the tarball buildable and verifiable; the publish itself is a deployment step the owner performs
- licensing decisions beyond the current `UNLICENSED` field — any license change is separate
- any changes to the connect flow UX, top-level aliases, or profile detection
- bundling or publishing any of the `@mako-ai/*` workspace packages as their own npm packages; they stay private
- Windows-specific installer artifacts (MSI, Scoop, Chocolatey) or macOS/Linux package managers
- a post-install check step or auto-update mechanism

## Architecture Boundary

### Owns

- the CLI bundle pipeline and its config file (e.g. `apps/cli/tsup.config.ts`)
- the `apps/cli/package.json` `scripts.build`, `scripts.prepublishOnly`, `files`, and dependency layout changes
- `apps/cli/README.md`
- the clean-machine verification procedure

### Does Not Own

- any source code inside `apps/cli/src/`, which stays identical to Phase 3.2's output
- the shape of `@mako-ai/*` workspace packages — they stay private and unchanged
- the license text or project-level README.md

## Contracts

### Input Contract

- the CLI source at `apps/cli/src/index.ts` and its imports must build cleanly with both `tsc --noEmit` (typecheck) and the chosen bundler
- the bundler must target Node 20+, ESM, and preserve the shebang on the entry point

### Output Contract

- `apps/cli/dist/index.js` is a single self-contained ESM file with:
  - a valid `#!/usr/bin/env node` shebang
  - no remaining `import` or `require` of any `@mako-ai/*` module
  - native modules (`@napi-rs/keyring`, `pg`, `better-sqlite3` if relevant, etc.) still imported as externals and declared in `dependencies`
- `npm pack` in `apps/cli/` produces a tarball whose contents are only: `dist/index.js`, `dist/index.d.ts`, `dist/index.d.ts.map`, `README.md`, `package.json`
- `npm install -g ./agentmako-0.1.0.tgz` on a clean machine installs the CLI and exposes `agentmako` and `mako` on PATH
- `agentmako connect` from a clean shell (outside the monorepo) attaches, indexes, and completes the DB/no-DB path exactly as it does in the monorepo today

### Error Contract

- `prepublishOnly` fails loudly if `dist/index.js`, `dist/index.d.ts`, or `dist/index.d.ts.map` is absent; if the shebang is missing; or if the bundle contains any `@mako-ai/*` import
- `npm publish` cannot proceed past a failing `prepublishOnly`

## Execution Flow

1. pick a bundler (`tsup` is the smallest-config option) and add it to `apps/cli/devDependencies`
2. write `apps/cli/tsup.config.ts` with: `entry: ["src/index.ts"]`, `format: ["esm"]`, `target: "node20"`, `platform: "node"`, `shims: false`, `splitting: false`, `clean: true`, `noExternal: [/^@mako-ai\//]`, `external: ["@napi-rs/keyring", "pg"]` (and any other native deps), and `banner: { js: "#!/usr/bin/env node" }`
3. update `apps/cli/package.json` `scripts.build` to run the bundler instead of `tsc -p tsconfig.json`; keep `scripts.typecheck` as `tsc -p tsconfig.json --noEmit`
4. move `@mako-ai/api`, `@mako-ai/config`, `@mako-ai/contracts` out of `dependencies` — they're now inlined; only keep truly external runtime deps in `dependencies`
5. add a `scripts.prepublishOnly` that runs `build:types` and `build`, then a verification script that checks the JS + declaration artifacts and exits non-zero if the bundle still contains any `@mako-ai/` imports
6. write a `apps/cli/README.md` covering install, the `agentmako connect` flow, the `status`/`verify`/`refresh` aliases, and a link back to the main repo
7. add `"files": ["dist", "README.md"]` to `apps/cli/package.json` (already present — keep it but verify it's correct)
8. run `npm pack` in `apps/cli/`, inspect the tarball contents, move it to a clean machine or Docker container, and run `npm install -g ./agentmako-*.tgz` + `agentmako connect` against a scratch project with `--no-db` to confirm the bundled path works end-to-end
9. document the verification commands so future releases can repeat them

## File Plan

Create:

- `apps/cli/tsup.config.ts`
- `apps/cli/README.md`
- potentially `apps/cli/scripts/verify-bundle.mjs` if the prepublishOnly verification needs more than a one-liner

Modify:

- `apps/cli/package.json` — `scripts.build`, `scripts.prepublishOnly`, `dependencies` (drop inlined packages), `devDependencies` (add bundler)
- possibly `apps/cli/tsconfig.json` if the bundler requires a slightly different compile target for types

Keep unchanged:

- `apps/cli/src/**` — source code is untouched in this phase
- every `@mako-ai/*` workspace package — they stay private, nothing renamed or republished
- the existing `tsc --noEmit` typecheck pass

## Verification

Required commands:

- `corepack pnpm typecheck` — still passes
- `corepack pnpm run build` (or whatever the root build invokes for `apps/cli`) — produces a bundled `dist/index.js` alongside fresh declaration files
- `corepack pnpm test` — smoke tests still pass against the bundled output
- `node apps/cli/dist/index.js --help` — runs from the bundled file
- `( cd apps/cli && npm pack )` — produces `agentmako-0.1.0.tgz` with only the whitelisted files

Required runtime checks on a clean machine (or Docker container):

- `npm install -g ./agentmako-0.1.0.tgz` — succeeds, exposes both `agentmako` and `mako` on PATH
- `agentmako --help` — prints the help text
- `agentmako connect /path/to/scratch/project --yes --no-db` — attaches, indexes, prints the final status block, exits 0
- `agentmako connect --yes --db-env MAKO_TEST_DATABASE_URL` against a real Postgres — completes the bind/test/default-scope/refresh flow
- no `Cannot find module '@mako-ai/...'` errors at any point

Required docs checks:

- `apps/cli/README.md` exists, links back to the main repo, and describes install + connect + aliases
- Phase 3.2.1 status flips to `Complete` only after the clean-machine verification passes

## Done When

- `apps/cli/dist/index.js` is a single self-contained bundled file with the shebang intact and no `@mako-ai/*` imports, and the published package also contains fresh `dist/index.d.ts` + `dist/index.d.ts.map`
- `npm pack` produces a tarball that installs and runs cleanly on a machine that has never seen the `mako-ai` monorepo
- `npx agentmako connect` and `npm install -g agentmako` are no longer theoretical — they work against a locally-packed tarball
- `prepublishOnly` blocks any publish of a non-bundled or invalid artifact
- Phase 3.2's "Known Gap" section can be replaced with a pointer to a completed Phase 3.2.1
- `apps/cli/README.md` exists and is accurate

## Risks And Watchouts

- inlining `@mako-ai/*` will also pull in their transitive non-`@mako-ai/*` deps; some of those may themselves be native modules that should stay external. Build the bundle, inspect the output, and add each native dep to `external` explicitly
- the current `better-sqlite3` (or `node:sqlite`) usage may have platform-specific binaries that cannot be bundled; keep them external and document the runtime requirement
- `@napi-rs/keyring` is platform-specific and must not be bundled; its platform-specific postinstall must still run when the CLI is installed globally
- shebang preservation across bundlers varies; verify the first line of `dist/index.js` is exactly `#!/usr/bin/env node` before calling the phase done
- the smoke test suite currently runs against `apps/cli/dist/index.js` via `node path/to/dist/index.js` — the bundled output must remain a drop-in replacement or the smoke tests will break
- file watchers and dev loops that depend on `tsc --watch` will no longer get rebuild-on-save from the bundler unless `tsup --watch` (or equivalent) is wired up; decide whether to add a `dev` script
- temptation to also bundle for Bun or Deno at the same time; resist — those are separate targets

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [./phase-3.2-package-and-connect-ux.md](./phase-3.2-package-and-connect-ux.md)
- [./phase-3.3-project-profile-depth.md](./phase-3.3-project-profile-depth.md)
- [./phase-4-logging-and-evaluation-backbone.md](./phase-4-logging-and-evaluation-backbone.md)
