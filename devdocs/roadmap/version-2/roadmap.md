# Roadmap Version 2

This file is the canonical roadmap for the next `mako-ai` build cycle after the initial shipped rebuild.

If another Roadmap 2 doc disagrees with this file about what the roadmap is for, what phase is current, or what is deferred, this roadmap wins.

Source inputs:

- [../../master-plan.md](../../master-plan.md)
- [../../scratch/fenrir-lessons.md](../../scratch/fenrir-lessons.md)
- [../../test-project/setup.md](../../test-project/setup.md)
- [../../test-project/architecture.md](../../test-project/architecture.md)
- [../../test-project/benchmark-answer-key.md](../../test-project/benchmark-answer-key.md)

## Roadmap Contract

Roadmap 2 is the `Project And Data Backbone` roadmap.

Its job is to make `mako-ai`:

- project-aware
- schema-snapshot-aware
- explicitly bindable to live DB access
- measurable through logging and evaluation
- ready for stronger typed investigation composition in the next roadmap

This roadmap is not primarily about shipping many new public tools.

This roadmap is primarily about making the substrate trustworthy enough that later investigation tools can be powerful without becoming sloppy.

## Roadmap 2 Status: Complete

Phases 1 through 5.2 have shipped. Phase 5.2 was the one-time approved exception: a deeper behavior-preserving module split deferred from Phase 5.1 because the highest-risk concentration points warranted their own dedicated pass. Roadmap 2 is now locked for good and Roadmap 3 begins. No further Roadmap 2 phases will be opened.

## Current Status

Roadmap 1 is complete and shipped.

`mako-ai` already has:

- local-first indexing
- shared typed tool contracts
- MCP, HTTP, CLI, and thin web surfaces
- answer/import/symbol/database tool families
- a thin `ask` router
- public install and tool docs

The current gap is at the project-contract and data-backbone layer:

- project attachment exists, but not yet as a full long-term project contract
- the current DB access model is still process-global
- schema shape is not yet treated as a first-class local snapshot system
- logging and benchmark storage are not yet mature enough for the trust layer that follows later

## Why This Roadmap Comes Next

This roadmap comes next because later Fenrir-class investigation tooling depends on a stronger substrate.

If we skip straight to deeper investigation tools:

- project targeting stays weaker than it should be
- schema shape stays too dependent on ad hoc source reading or live DB calls
- logging stays too weak for contradiction and ranking work
- benchmarking stays informal

That would repeat Fenrir's biggest mistake:

- rebuild the magic before the backbone is ready

Roadmap 2 exists to prevent that.

## Core Product Decision

Roadmap 2 adopts this rule:

`mako` should know a project mostly from explicit project attachment, repo-derived metadata, and maintained local snapshots. Live database access is a human-enabled capability, not the default source of truth for every answer.

That means:

- project attachment becomes a first-class contract
- repo-derived schema sources become first-class
- local snapshots become durable assets
- live DB access becomes project-scoped and opt-in
- logging becomes part of the substrate

## Human Connection Model

### Repo Connection

Repo connection is explicit.

The human attaches a project root.

`mako` then:

- resolves the canonical path
- detects project metadata
- creates or updates the global project registry entry
- creates or updates the project-local manifest
- creates or updates the local project SQLite state

Default CLI behavior should move toward repo-local ergonomics:

- `mako project attach` uses the current working directory when no path is passed
- `mako project detach` uses the current working directory when no ref is passed
- `mako project status` uses the current working directory when no ref is passed
- `mako project index` uses the current working directory when no ref is passed

Explicit refs should still be supported.

### MCP Project Context Resolution

Roadmap 2 should adopt a layered project-context resolution chain for MCP and other clients.

Recommended order:

1. explicit tool arg such as `projectRef` or `projectId`
2. session-scoped active project
3. MCP `roots`
4. client-provided `_meta.cwd`
5. clear error

Rule:

- project context resolution may be automatic
- project attachment is never automatic

That means:

- `roots` and `_meta.cwd` may help `mako` resolve which attached project the client means
- they must not silently register a new project
- if the resolved project is not attached, return a clear project-context error

Why this is the right model:

- `roots` is the protocol-native workspace signal
- session state is useful for explicit agent pinning
- `_meta.cwd` is a good fallback for weaker clients
- explicit per-tool override is still needed for one-off calls and multi-project sessions

### Database Connection

Database connection is explicit and human-enabled.

`mako` should not silently bind live DB access during project attach.

The recommended model is:

1. attach the repo
2. detect likely DB kind and local schema sources
3. mark live DB access as `unconfigured` by default
4. let the human opt in to a project-scoped live DB binding
5. use that binding for read-only verification and snapshot refresh

Roadmap 2 should treat binding as a strategy-based capability, not one hard-coded storage path.

Preferred strategy for an interactive local workstation:

- OS keychain reference

Required fallback strategy:

- environment-variable reference

Allowed later extension:

- encrypted binding file reference

Roadmap 2 should not make plaintext SQLite secret storage the default or recommended pattern.

### Connection Modes

Roadmap 2 should support these modes clearly:

#### 1. Repo-only

Default mode.

Used when:

- migrations
- generated types
- schema files

are enough.

#### 2. Repo + live schema verification

Human enables read-only DB access to confirm or compare schema state.

#### 3. Repo + live schema refresh

Human enables read-only refresh of the local schema snapshot from the live catalog.

This is still read-only.

Roadmap 2 stops here.

It does not include row-data sync, continuous DB mirroring, or live DB as the default answer path.

## Roadmap 2 Standalone Deliverables

Roadmap 2 should leave behind twelve major deliverables plus four targeted follow-up slices.

### 1. Project Connection System

A durable system for attaching, tracking, detaching, and re-opening projects.

It should include:

- global project registry
- project IDs
- canonical path handling
- project status
- project capability metadata
- project-local manifest/config

### 2. Schema Snapshot System

A durable system for representing schema shape locally.

It should include:

- one canonical normalized schema IR
- repo-derived schema sources
- snapshot persistence
- snapshot source metadata
- source-mode metadata
- timestamps and freshness state
- verification state
- drift state
- diff groundwork
- controlled refresh behavior

### 3. Live DB Binding System

A safe project-scoped system for enabling read-only DB access.

It should include:

- per-project DB capability metadata
- binding mode
- env-var or credential-ref strategy
- connection test flow
- import or refresh flow

### 3.1. Project Setup And Binding UX

A first-class operator flow for connecting a repo, understanding its state, and optionally enabling live DB access without already knowing the low-level `mako` sequence.

It should include:

- repo-local defaults for core project commands
- a setup-oriented front door such as `project connect` or `project init`
- setup-time metadata detection and presentation
- optional DB-binding guidance
- clear post-setup status output
- a scriptable path that still preserves the same explicit underlying contracts

### 3.2. Package And Connect UX

A professional package-level onboarding flow where the normal human path is one connect command that can attach a repo, index it, optionally connect a live database, and leave behind saved defaults instead of repeated operator friction.

It should include:

- a public package and bin shape aligned with `agentmako`
- a first-class `connect` command as the intended cold-start path
- secure interactive DB URL capture with keychain-first local storage
- env-var fallback for non-interactive and CI use
- default schema-scope persistence in the project manifest
- product-level day-to-day command direction such as `status`, `verify`, and `refresh`

### 3.2.1. CLI Publishing

A focused follow-up that closes the gap between Phase 3.2's advertised `npx agentmako connect` path and the actual publishability of the CLI package, so the flagship cold-start path works against a real npm tarball from a clean machine.

It should include:

- a bundled single-file CLI artifact with every `@mako-ai/*` workspace dep inlined and native modules kept external
- a `workspace:*` dependency strategy documented and enforced by the build
- a `prepublishOnly` guard that blocks publish if the bundle is invalid
- `apps/cli/README.md` and a tight `files` whitelist for the tarball
- clean-machine verification via `npm pack` + `npm install -g` on a fresh environment

### 3.3. Project Profile Depth

An honest project profile that downstream tools and the Phase 4 logging substrate can rely on, replacing the filename-heuristic stubs with real signal derived from the code and the already-indexed import graph.

It should include:

- middleware detection that recognizes both `middleware.ts` and `proxy.ts` (Next.js 16), restricted to top-level files, and validated by file body content rather than filename alone
- a `serverOnlyModules` list derived from import-graph closure over framework server primitives (`next/headers`, `"use server"`, `cookies()`, `headers()`, `unstable_cache`, `revalidatePath`, `revalidateTag`)
- an `authGuardSymbols` list containing real exported symbol names from the server-only module set, filtered by the auth verb-prefix × auth-substring naming convention
- explicit deferral of the SQL-side authz shape (role table, role column, admin check template) to a later phase

### 3.4. Profile Polish

A narrow follow-up to Phase 3.3 that closes two real quality gaps in the profile contract before Phase 4 starts logging against it.

It should include:

- resolved TypeScript path aliases (`baseUrl` + `compilerOptions.paths` joined to absolute filesystem paths, not raw target strings)
- a more complete `entryPoints` list that includes `next.config.*` files and the detected `middleware.ts` / `proxy.ts` entries
- a conditional profile cache with source-file mtime invalidation — shipped **only** if a measured attach/connect latency on a real project exceeds a documented threshold, so the invalidation risk is taken on for a real reason, not preemptively
- no new semantic profile fields — `appDir`, `authProvider`, route runtime detection, and similar expansions are explicitly deferred to a later pass

### 3.6. CLI UX Production Polish

A net-reduction polish pass that removes friction and dead surface area from the CLI before Phase 4 starts logging operator workflows.

It should include:

- schema auto-import on connect: all non-system schemas imported by default; interactive schema picker removed
- `--keychain-from-env <VAR>` flag on `connect` for one-command non-interactive keychain bind (CI path)
- hard deletion of `project init` and all supporting private functions; smoke tests migrated to `connect --yes --no-db` + `project db bind`
- context-sensitive bare `agentmako` no-arg behavior: status in an attached project, connect suggestion in an unattached repo, project list elsewhere
- help text consistency pass across connect, verify, and refresh

### 4. Action And Tool-Run Logging

A durable system for recording every meaningful `mako` action and tool invocation as structured, immutable facts in `project.db`.

It should include:

- append-only `lifecycle_events` table covering project attach/detach/index, schema snapshot build/refresh, and DB verify/test/bind/unbind
- append-only `tool_runs` table covering every `invokeTool` call, logged generically at the registry level so new tools are automatically covered without per-tool logging code
- immutability enforcement via SQLite triggers (DELETE and UPDATE rejection on both tables)
- closure of the Phase 2 snapshot-build-warning gap via `lifecycle_events.metadata_json`
- ProjectStore insert and query methods for both tables

### 4.1. Benchmark And Evaluation Storage

A durable system for storing reusable benchmark definitions and linking execution results back to the tool-run history from Phase 4.

It should include:

- `benchmark_suites`, `benchmark_cases`, and `benchmark_assertions` definition tables
- `benchmark_runs`, `benchmark_case_results`, and `benchmark_assertion_results` result tables linked to Phase 4's `tool_runs` by foreign key
- optional `evidence_alignment` rows for grounding checks
- optional `payload_json` column on `tool_runs` for sampled full-payload capture during benchmark runs
- immutability enforcement on all result tables
- ProjectStore CRUD and query methods for benchmark tables

### 5. ForgeBench Validation Harness

A controlled system for proving Roadmap 2 works against a real target.

It should include:

- repeatable attach flow
- repeatable DB binding flow
- repeatable refresh flow
- benchmark verification against the answer-key docs
- stored validation runs

### 5.1. Codebase Hygiene

A no-new-feature refactoring pass that pays down Phase 3.x–4.1 debt and leaves the codebase clean enough for Roadmap 3 to extend without inheriting accumulated patterns.

It should include:

- extraction of duplicated `durationMs` helpers across the indexer service layer into a shared utility
- a `withProjectContext` or `withStores` helper that replaces the repeated `loadConfig + openGlobalStore + openProjectStore` open/try/finally/close boilerplate
- CLI modularization: `apps/cli/src/index.ts` split into command modules under `apps/cli/src/commands/`, with `main()` as a thin dispatcher
- postgres extension bulk/single helper consolidation where the single wrapper adds no clarity
- barrel file cleanup across `packages/store`, `packages/contracts`, `packages/tools`, `services/indexer`, `services/api`
- dead code removal: unused imports, unexported dead functions, orphaned types

After it ships, Phase 5.2 begins the final deep-module-split pass.

### 5.2. Deep Module Split

A second behavior-preserving refactoring pass that splits the remaining large concentration points — `project-store.ts`, `server.ts`, `runtime.ts`, `registry.ts`, and `attach.ts` — by concern, without changing any public API, SQL schema, method signature, or observable behavior.

It should include:

- `project-store.ts` split into concern-scoped internal helper modules (snapshots, lifecycle, benchmarks, index runs, traces), with one public `ProjectStore` class surface unchanged
- `server.ts` reduced to composition-only, with route handlers moved into `routes/` modules
- `runtime.ts` resolver primitives centralized, with exact error text and candidate ordering preserved
- `registry.ts` static tool definitions extracted to `tool-definitions.ts`, invocation and logging helpers extracted separately
- `attach.ts` migrated to the Phase 5.1 shared helpers (`withGlobalStore` / `withProjectStore` / `withResolvedProjectContext`)
- dead code removal for items flagged in Phase 5.1 audit but not yet acted on

This is the final phase of Roadmap 2. After it ships, Roadmap 2 is locked and Roadmap 3 begins.

## Key Decisions

### 1. Project Manifest Becomes A First-Class Contract

Roadmap 2 should define a project-local manifest under `.mako/`.

This manifest should describe the project.
It should not store secrets.

At minimum it should be able to express:

- project identity
- framework and language
- package manager
- database kind
- schema source paths
- generated type paths
- edge function paths
- indexing preferences
- DB connection mode
- snapshot freshness metadata

Illustrative shape:

```json
{
  "version": "2.0.0",
  "projectId": "proj_abc123",
  "root": ".",
  "frameworks": ["nextjs", "supabase"],
  "languages": ["typescript"],
  "database": {
    "kind": "supabase",
    "mode": "repo_only",
    "schemaSources": [
      "supabase/migrations",
      "types/supabase.ts"
    ],
    "liveBinding": {
      "strategy": "keychain_ref",
      "ref": "mako:proj_abc123:primary-db",
      "enabled": false
    }
  },
  "indexing": {
    "include": ["app", "components", "lib", "supabase", "types"],
    "exclude": ["node_modules", ".next", "dist"]
  }
}
```

### 2. Repo-Derived Schema Is The Primary Local Substrate

Roadmap 2 should treat these as first-class schema inputs:

- SQL migrations
- generated DB types
- ORM schema files when present
- known repo-local schema metadata

For ForgeBench, the first-class sources are:

- `supabase/migrations/`
- `types/supabase.ts`
- `devdocs/test-project/architecture.md`
- `devdocs/test-project/benchmark-answer-key.md`

### 3. One Local Schema IR, Multiple Source Modes

Roadmap 2 should standardize on one local schema IR.

That IR is the durable local model that later systems read from.

It is not automatically self-updating.

The correct design is:

- one normalized schema snapshot contract
- multiple ways to produce or verify that snapshot
- explicit freshness state
- explicit drift state

This means the project should support these source modes:

- `repo_only`
- `repo_plus_live_verify`
- `live_refresh_enabled`

The local IR stays the same shape across those modes.

What changes is:

- how it was produced
- whether it has been verified
- how fresh it is
- whether drift has been detected

Later tools should read the IR first, not re-parse raw sources or hit the live DB by default on every question.

### 4. Live DB Access Becomes Project-Scoped

The old `MAKO_DATABASE_URL` process-global path was the transition seam, but the
shipped model is project-scoped only now.

Roadmap 2 should move toward:

- DB access belongs to a project
- a project records whether DB access is configured
- the human binds it explicitly

The live-binding contract should store references, not secret values.

Roadmap 2 should support at least:

- `keychain_ref`
- `env_var_ref`

The manifest and project metadata may store:

- strategy
- reference ID or env var name
- configured/enabled state
- verification timestamps

They must not store:

- raw connection strings
- plaintext passwords
- plaintext secret bundles in SQLite

### 5. Project Context Resolution Must Be Layered

Roadmap 2 should not rely on a single project-resolution strategy.

The project-resolution chain should be:

- explicit tool arg
- session active project
- MCP `roots`
- `_meta.cwd`
- clear error

This keeps `mako` compatible with:

- strong IDE clients
- weaker MCP clients
- CLI-style callers
- multi-project sessions

### 6. Snapshot Freshness Is First-Class State

Roadmap 2 should not pretend the local schema IR is always current.

It can become stale when:

- migrations change
- generated DB types change
- ORM schema files change
- the live DB changes after the last verification or refresh

That is normal.

The system should track freshness explicitly.

At minimum, snapshot metadata should be able to express:

- `snapshotId`
- `sourceMode`
- `generatedAt`
- `sources[]`
- `schemaFingerprint`
- `freshness.status`
- `freshness.lastVerifiedAt`
- `freshness.verifiedAgainst`
- `freshness.driftDetected`

Illustrative freshness statuses:

- `unknown`
- `fresh`
- `stale`
- `verified`
- `drift_detected`
- `refresh_required`

### 7. Read-Only Live DB Access Refreshes Shape, Not Replaces Shape

Live DB access in Roadmap 2 is for:

- connectivity verification
- catalog import
- snapshot refresh
- drift confirmation

It is not for:

- continuous live sync
- arbitrary row ingestion
- making every answer depend on a live DB call

### 8. Logging Is Part Of The Substrate

Roadmap 2 must treat logging as a backbone concern.

Later roadmaps depend on it for:

- contradiction detection
- ranking
- trust signals
- AI worker inputs
- ML training data

The Roadmap 2 rule is:

- immutable fact rows first
- derived summaries second
- contradiction and ranking logic later

That means Roadmap 2 should log the facts those later systems will consume.

It should not build the full contradiction or ranking layer yet.

## Phases

### Phase 1: Project Contract And Attach UX

Status: `Complete`

Goal:

Turn project attachment into a real long-term contract instead of a thin registry action.

Build:

- `.mako/` project manifest
- richer project capability metadata
- current-working-directory defaults for project commands
- real `project detach`
- layered project-context resolution for MCP and other clients
- clear split between global registry state and project-local manifest state

Rules:

- attach remains explicit
- secrets do not go in the project manifest
- detach must support a safe default path and an optional purge path

Done when:

- `mako project attach` works cleanly from inside a repo with no explicit path
- `mako project detach` exists and works cleanly from inside a repo with no explicit ref
- MCP-facing project resolution follows explicit arg -> session project -> roots -> `_meta.cwd` -> clear error
- ForgeBench can be attached and detached repeatedly without manual DB surgery
- project metadata is recorded with clear global-vs-local responsibilities

### Phase 2: Schema Source Discovery And Snapshot Backbone

Status: `Complete`

Goal:

Make schema shape a first-class local asset.

Build:

- schema source detection
- one canonical normalized schema IR
- repo-derived schema snapshot persistence
- snapshot source metadata
- source-mode metadata
- snapshot freshness state
- verification and drift metadata
- snapshot diff groundwork

Rules:

- repo-derived sources come first
- live DB is not required for a usable local schema snapshot
- later consumers should read the IR instead of re-reading raw schema inputs by default

Done when:

- ForgeBench schema can be represented locally from repo sources
- snapshot refresh behavior is explicit
- snapshot freshness and drift state are visible and queryable
- local schema shape can be queried without a live DB dependency

### Phase 3: Live DB Binding And Read-Only Refresh

Status: `Complete`

Goal:

Let a human enable project-scoped live DB access safely and explicitly.

Build:

- DB binding model
- env-var or credential-ref strategy
- connection test flow
- read-only refresh flow
- project-scoped live schema verification

Rules:

- no secrets in committed project config
- no write behavior
- live DB access stays opt-in
- live DB verification and refresh update the same local IR contract used in repo-only mode

Done when:

- ForgeBench can be manually bound to its cloud Supabase DB
- `mako` can test connectivity and refresh schema shape read-only
- `mako` can mark snapshot state as verified, stale, or drift-detected
- project-scoped DB capability is visible in project status

### Phase 3.1: Project Setup And Binding UX

Status: `Complete`

Goal:

Turn the completed attach/index/bind/test substrate into the intended human setup flow before Phase 4 begins logging and evaluating that workflow.

Build:

- repo-local defaults for setup-oriented commands
- a first-class setup flow such as `mako project connect` or `mako project init`
- setup-time project metadata presentation
- optional DB-binding guidance or follow-up
- clearer status output for project, schema snapshot, and DB binding state

Rules:

- setup may detect and suggest, but not silently attach or silently bind secrets
- attach, index, bind, test, verify, and refresh remain explicit underlying contracts
- interactive and non-interactive paths should both be possible
- this phase is UX-layer work, not a new sync/data phase

Done when:

- a human can stand in a repo and prepare it for `mako` without remembering the low-level command sequence
- setup can optionally lead into live DB binding without making DB binding mandatory
- project status is clear enough to explain the current state and next step
- Phase 4 can log the intended operator flow instead of a temporary rough workflow

### Phase 3.2: Package And Connect UX

Status: `Complete`

Goal:

Turn the current setup and DB-binding flow into a professional package-level connection experience.

Build:

- a public package and bin shape aligned with `agentmako`
- `npx agentmako connect` as the intended cold-start path
- optional global-install path via `npm install -g agentmako`
- one-shot connect flow that can attach, index, optionally bind, test, and refresh
- secure interactive DB URL capture with keychain-first local storage
- `--db-env` and similar non-interactive fallback inputs
- persisted default schema scope for later verify and refresh behavior
- movement toward top-level `status`, `verify`, and `refresh` aliases

Rules:

- connect must still reuse the underlying attach/index/bind/test/refresh contracts
- secrets must not pass through argv in the interactive path
- manifests and SQLite store refs and metadata only, never raw DB URLs
- this is still a UX/package phase, not a substrate rewrite

Done when:

- the intended cold-start path is `npx agentmako connect`
- one connect flow can leave a project attached, indexed, DB-tested, and refreshed
- schema scope is saved once and reused by default
- the product feels installable and connectable without exposing the underlying operator sequence
- Phase 4 can log the intended professional onboarding flow

### Phase 3.2.1: CLI Publishing

Status: `Complete`

Goal:

Close the gap between Phase 3.2's advertised `npx agentmako connect` / `npm install -g agentmako` path and the actual publishability of the CLI package, so the flagship cold-start path works against a real npm tarball from a clean machine.

Build:

- a bundled CLI artifact (via `tsup`, `esbuild`, or `@vercel/ncc`) that inlines every `@mako-ai/*` workspace dependency and keeps native modules external
- a `workspace:*` dependency strategy: inline everything that can be inlined, drop inlined packages from `dependencies`, keep native deps external
- a `prepublishOnly` script that regenerates the bundle and blocks publish if the artifact is invalid (missing shebang, contains `@mako-ai/*` imports, etc.)
- `apps/cli/README.md` and a tight `files` whitelist so only the bundled `dist/index.js`, README, and `package.json` ship
- clean-machine verification: `npm pack` → `npm install -g ./agentmako-0.1.0.tgz` on a fresh environment, then `agentmako connect` end-to-end against a scratch project

Rules:

- no changes to CLI source code, feature surface, or connect UX
- `@mako-ai/*` workspace packages stay private and unrenamed
- the `agentmako` CLI must publish as a single self-contained artifact, not as a flotilla of scoped packages
- `tsc --noEmit` stays as the typecheck pass; bundling is a separate build step
- `prepublishOnly` is the final gate — a broken bundle must block publish, not produce a corrupt tarball

Done when:

- `apps/cli/dist/index.js` is a single bundled ESM file with a valid shebang and no remaining `@mako-ai/*` imports
- `npm pack` produces a tarball whose contents are only `dist/`, `README.md`, and `package.json`
- a clean-machine `npm install -g ./agentmako-*.tgz` followed by `agentmako connect` against a scratch project completes end-to-end
- Phase 3.2's "Known Gap" pointer can be swapped for a completed-phase reference

### Phase 3.3: Project Profile Depth

Status: `Complete`

Goal:

Turn the project profile from filename-heuristic stubs into real, honest signal so Phase 4 logging has trustworthy inputs and downstream tools no longer need to re-grep the repo at answer time.

Build:

- proper middleware file detection: `middleware.ts` and `proxy.ts` (Next.js 16), top-level only, validated by file body content (`config` export + `matcher` field)
- `serverOnlyModules` derived from import-graph closure over framework server primitives (`next/headers`, `next/cache`, `"use server"`, `cookies()`, `headers()`, `unstable_cache`, `revalidatePath`, `revalidateTag`)
- `authGuardSymbols` derived from real exported symbols of files in the server-only set, filtered by the auth verb-prefix × auth-substring naming convention (e.g. `withAuth`, `requireSession`, `verifyRole`)
- smoke coverage for all three detection paths, including negative cases (SQL migrations never leak into `authGuardSymbols`, framework-reserved filenames never leak in, unvalidated middleware files are rejected)

Rules:

- field shapes stay stable — no manifest version bump, no field renames
- detection must consume the already-indexed data in `project.db` where possible rather than re-walking the filesystem
- detection must degrade gracefully — a parse failure on one file must not break the whole profile run
- the SQL-side `AuthzProfile` (role table, role column, admin check template, RLS introspection) is explicitly NOT in this phase
- no new top-level manifest fields in this phase (`authProvider`, `routerStyle`, `nextVersion` are all out of scope)

Done when:

- a Next.js 16 project's `proxy.ts` shows up in `middlewareFiles` with content validation
- `serverOnlyModules` reflects the real server boundary from the import graph, not path heuristics
- `authGuardSymbols` contains real exported symbol names and never filename stems or SQL migration names
- the forgebench manifest updates from garbage values to meaningful ones on re-connect
- Phase 4 can begin logging against a profile that is no longer a stub

### Phase 3.4: Profile Polish

Status: `Complete`

Goal:

Close the last small profile-contract gaps in the Phase 3.3 profile before Phase 4 starts logging against it: resolved TypeScript path aliases, corrected `srcRoot` behavior, and a more complete `entryPoints` list that stays compatible with current consumers. Conditionally add a profile cache, but only if a direct latency measurement on a real project justifies the invalidation risk.

Build:

- `detectPathAliases` rewritten to read `compilerOptions.baseUrl` and resolve `compilerOptions.paths` entries to absolute filesystem paths, matching Fenrir's behavior line-for-line on edge cases
- `detectSrcRoot` tightened so Next.js only uses `root/src` when routing roots actually live there, while non-Next projects still preserve `src/` as their semantic source root
- `collectEntrypoints` rewritten to include concrete app/pages entry files, Next app-router metadata entry files, every detected middleware/proxy file, and every `next.config.*` file alongside the existing `KNOWN_ENTRYPOINTS` / `package.json.main` fallbacks
- smoke coverage for all three behaviors plus negative cases where `paths` / `next.config.*` / middleware are absent
- a latency measurement against a realistic scratch target, with the recorded numbers kept in the phase doc
- a profile cache with detector-input invalidation — shipped only if measured warm-start detection exceeds the documented threshold (200 ms median) **and** the invalidation story is proven; deferred otherwise with the reason recorded

Rules:

- narrow scope — no new semantic profile fields, no manifest shape changes, no SQL-side detection, no renames
- `appDir`, `authProvider`, route runtime detection, and similar expansions are explicitly deferred to a later profile-expansion phase
- the profile cache is conditional on measurement; do not ship it preemptively because Fenrir had one
- `entryPoints` must remain file-like relative paths for this phase; do not silently switch it to directory markers
- no broadening mid-phase — if another "while we're here" idea surfaces, record it and defer
- must land before Phase 4 opens, so append-only logging never records the old un-resolved `pathAliases` shape

Done when:

- `profile.pathAliases` values are absolute filesystem paths, not raw target strings
- `profile.srcRoot` is framework-correct: Next.js only points at `root/src` when the routing roots actually live there, while non-Next projects still use `root/src` when it is their real source root
- `profile.entryPoints` surfaces `next.config.*` and middleware/proxy files on Next.js projects without changing the field away from file-like relative paths
- latency has been measured and the cache decision is recorded
- Phase 4 has an honest profile contract to build on

### Phase 3.4.1: Tsconfig Alias Hotfix

Status: `Complete`

Goal:

Close the remaining `pathAliases` correctness gap from Phase 3.4 by replacing the hand-rolled tsconfig parser with `get-tsconfig` so aliases defined through `extends` chains are resolved before later phases treat the profile as durable substrate.

Build:

- replace the hand-rolled JSONC helpers in `services/indexer/src/project-profile.ts` with `get-tsconfig`
- use `createPathsMatcher` to preserve the existing absolute-path alias contract while correctly honoring `extends`
- add a smoke regression where `tsconfig.json` extends `tsconfig.base.json` and the alias only exists in the base config

Rules:

- keep `ProjectProfile.pathAliases` as `Record<string, string>`
- keep the hotfix narrow; no broader profile-contract expansion belongs here

Done when:

- aliases defined only in an extended base config resolve correctly
- the old hand-rolled JSONC parsing helpers are gone
- Phase 3.5 and Phase 4 build on the corrected alias substrate

### Phase 3.5: Live Schema Scope And Catalog Capture

Status: `Complete`

Goal:

Make the connect flow leave behind the scoped live schema structure the product actually needs for later alignment, without forcing users to type schema lists in the common case.

Build:

- inspect live schemas immediately after successful DB connection
- hide ignored/system schemas by default in the first schema-selection surface
- ask whether to use all detected app schemas before falling back to manual schema picking
- provide a manual selection flow with advanced access to the hidden/default-ignored schemas
- persist the resolved default schema scope in the project manifest
- make connect perform the scoped live refresh by default after DB binding and scope resolution
- expand the live catalog capture so the local schema IR includes, at minimum:
  - schemas
  - tables
  - columns
  - enums
  - views
  - functions/procedures
  - PKs
  - FKs
  - indexes
  - RLS policies
  - triggers

Rules:

- update the same local schema IR/snapshot system rather than inventing a second DB model
- capture structural metadata only; row data stays out
- do not default to whole-cluster schema capture
- make the connect-time schema choice professional and persistent rather than repeated operator friction
- keep ignored/default-hidden schema classes explicit and overridable

Done when:

- `agentmako connect` defaults to refreshing structural live schema data after successful DB binding
- the user can accept all visible app schemas or choose a subset without typing schema names manually
- advanced options reveal the hidden/default-ignored schemas and allow them to be included
- the chosen scope is persisted and reused by `verify` / `refresh`
- the local snapshot captures the richer structural set listed above
- live-refreshed snapshots now carry enough structure that `verify` can also report drift for indexes/FKs/RLS/triggers without regressing repo-only compare behavior
- Phase 4 can begin logging against the DB structure the product actually intends to keep

### Phase 3.5.1: Live Schema Read Model And Introspection

Status: `Complete`

Goal:

Make the current schema snapshot easy to query locally and strengthen the PostgreSQL introspection substrate before Phase 4 starts logging against it.

Build:

- adopt `pg-introspection` as the preferred PostgreSQL live-catalog ingestion layer
- continue mapping live DB structure into the existing `SchemaIR` contract
- keep `schema_snapshots.ir_json` as the canonical snapshot payload
- add flattened relational tables for the current schema snapshot, covering at minimum:
  - schemas
  - tables
  - columns
  - enums
  - views
  - functions/procedures
  - PKs
  - FKs
  - indexes
  - RLS policies
  - triggers
- rebuild the flattened read model whenever the canonical snapshot is saved
- clear the flattened read model whenever the canonical snapshot is cleared

Rules:

- this phase is about a better introspection layer and a better local read model, not about continuous live sync
- the local read model tracks the current stored snapshot only
- `ir_json` remains canonical; flattened tables are derived
- append-only historical snapshot retention is explicitly out of scope for this phase

Done when:

- PostgreSQL live schema capture uses `pg-introspection` as its primary engine
- the current stored schema snapshot is queryable through flattened relational tables in `project.db`
- saving and clearing snapshots keeps the relational read model synchronized in the same transaction
- Phase 4 can begin logging against a DB substrate that is both structurally rich and directly queryable

### Phase 3.5.2: Live Catalog Ingestion Hotfix

Status: `Complete`

Goal:

Keep the 3.5.1 storage gains, but simplify the live catalog ingestion layer back down to direct typed catalog SQL instead of the mixed `pg-introspection` plus fallback-query path.

Build:

- remove `pg-introspection` from the live-catalog ingestion path
- revert `services/indexer/src/db-binding/live-catalog.ts` to direct typed catalog SQL that emits the exact flat row shapes the pipeline persists
- keep the richer 3.5 capture surface unchanged
- keep the 3.5.1 flattened read model unchanged
- keep the RPC merge fix unchanged
- document the reversal and the dependency-adoption lesson

Rules:

- do not drop the flattened read-model work
- do not drop the richer capture fields from 3.5
- do not keep `pg-introspection` and custom SQL side-by-side
- if a new dependency does not eliminate custom logic, treat that as a failed adoption

Done when:

- `pg-introspection` is gone from the live-catalog ingestion path
- the richer live schema capture still works
- the flattened read model from 3.5.1 remains intact and synchronized
- docs record why the ingestion-layer reversal happened
- Phase 4 can begin against the simpler ingestion path and the already-correct hybrid storage model

### Phase 3.6: CLI UX Production Polish

Status: `Complete`

Goal:

Reduce operator friction and shrink the CLI surface area before Phase 4 starts logging against the CLI workflows.

Build:

- schema auto-import on connect: all non-system schemas imported by default; `SUPABASE_HIDDEN_SCHEMAS` deleted; interactive schema picker removed
- `--keychain-from-env <VAR>` flag on `connect` for one-command non-interactive keychain bind, mutually exclusive with `--db-env`
- hard deletion of `project init` (~210 lines, all private helpers removed); four smoke test call sites migrated to `connect --yes --no-db` + `project db bind`
- bare `agentmako` no-arg behavior: status in an attached project, connect suggestion in an unattached repo, project list elsewhere
- help text pass: `--keychain-from-env` added to connect options, `--schemas` removed from verify/refresh, `project init` removed from listings

Rules:

- schema auto-import is the new default; `--schemas` remains as an advanced override
- `project init` is a hard delete, not a deprecation; smoke tests are migrated, not skipped
- `--keychain-from-env` and `--db-env` are mutually exclusive; passing both is a non-zero exit
- this is a surface-area-reduction pass; no new substrate features belong here

Done when:

- connect never shows the interactive schema picker unless `--schemas` is explicitly passed
- `SUPABASE_HIDDEN_SCHEMAS` is gone from the codebase
- `--keychain-from-env <VAR>` works end-to-end for CI keychain bind
- `project init` is gone; `agentmako project init` returns a command-not-found error
- all four smoke test call sites that used `project init` pass using their migrated equivalents
- bare `agentmako` is context-sensitive in all three directory states
- `pnpm typecheck` and `pnpm run test:smoke` both pass

### Phase 4: Action And Tool-Run Logging

Status: `Complete`

Goal:

Make every meaningful action and tool invocation durable in `project.db` so later trust, ranking, contradiction, and ML work has structured history to consume.

Build:

- append-only `lifecycle_events` table for project and DB lifecycle actions
- append-only `tool_runs` table for every `invokeTool` call, wired generically at the registry level
- `tool_usage_stats` rollup table in `global.db` for cross-project tool usage signal (survives project detach/purge)
- immutability enforcement via SQLite DELETE/UPDATE triggers on `lifecycle_events` and `tool_runs`
- closure of the Phase 2 snapshot-build-warning gap via `lifecycle_events.metadata_json`
- `ToolServiceOptions.sharedGlobalStore` and `borrowGlobalStore` for store reuse; WAL checkpoint on store close
- ProjectStore and GlobalStore insert/query/upsert methods for all three tables

Rules:

- raw run events are append-first; immutability is enforced at the storage layer, not only by convention
- tool-run logging is generic and modular — a new tool in the registry gets logged automatically with no logging-layer changes
- `lifecycle_events` and `tool_runs` are the only new fact tables in Phase 4 in project.db; `tool_usage_stats` is the new global-level table; benchmark tables arrive in Phase 4.1
- log-write failures must not swallow tool results

Done when:

- every meaningful Roadmap 2 action leaves a structured, immutable record
- every tool invocation gets a durable `tool_runs` row without per-tool logging code
- every tool invocation updates `tool_usage_stats` in global.db (survives project purge)
- the Phase 2 snapshot-build-warning gap is closed
- Phase 4.1 can begin with a tool-run history to link benchmark results against

The Windows-only EBUSY file locking race in the smoke test cleanup path has been resolved via a retrying rmSync helper with best-effort Windows fallback (`test/smoke/state-cleanup.ts`).

### Phase 4.1: Benchmark And Evaluation Storage

Status: `Complete`

Goal:

Make the product measurable by storing reusable benchmark definitions and linking execution results back to the tool-run history from Phase 4.

Build:

- `benchmark_suites`, `benchmark_cases`, `benchmark_assertions` definition tables
- `benchmark_runs`, `benchmark_case_results`, `benchmark_assertion_results` result tables linked to Phase 4's `tool_runs` by FK
- optional `evidence_alignment` rows for grounding checks
- optional `payload_json` column on `tool_runs` for sampled full-payload capture during benchmark runs
- immutability enforcement on all result tables

Rules:

- benchmark definitions and execution results are separate layers
- benchmark case results must link to `tool_runs` rows by FK, not to opaque JSON blobs
- assertion results are individual queryable rows, not packed inside a result JSON
- summary views are derived and subordinate to raw facts
- no CLI commands for benchmark management in this phase

Done when:

- benchmark suites can be defined, stored, and rerun without redefining
- benchmark execution results link back to `tool_runs` history via FK
- assertion outcomes are queryable as individual rows
- immutable historical rows are enforced on all result tables
- Phase 5 ForgeBench validation has a usable storage substrate

### Phase 5: ForgeBench Validation And Roadmap 2 Lock

Status: `Complete`

Goal:

Prove the new project-and-data backbone works in a real controlled target.

Build:

- repeatable ForgeBench attach flow
- repeatable ForgeBench DB binding flow
- repeatable snapshot refresh flow
- benchmark verification against the answer-key docs
- Roadmap 2 operator docs and lock criteria

Rules:

- validation must be repeatable
- Roadmap 2 is not complete until ForgeBench proves the backbone end to end

Done when:

- a human can attach ForgeBench from scratch
- a human can enable and test its cloud DB binding
- local schema state can be created and refreshed correctly
- benchmark records can be stored and reviewed
- Roadmap 2 docs are strong enough to hand off implementation cleanly

### Phase 5.1: Codebase Hygiene

Status: `Complete`

Goal:

Reduce duplication, modularize the CLI, consolidate shared patterns, and leave the codebase clean enough that Roadmap 3 can extend it without inheriting Phase 3.x debt.

Build:

- shared `durationMs` utility extracted from six duplicate copies across the indexer service layer
- `withProjectContext` or `withStores` helper replacing the repeated open/try/finally/close boilerplate
- CLI command modules under `apps/cli/src/commands/` with `main()` as a thin dispatcher
- postgres extension bulk/single pair consolidation where warranted
- barrel file cleanup across workspace packages
- dead code removal across the workspace

Rules:

- every changed line must preserve existing behavior
- the smoke suite is the behavior contract — smoke must pass identically before and after
- do not split files just to split them; only modularize where the current shape is actively painful
- no new dependencies, no new features, no public API changes

Done when:

- no duplicated utility functions across the indexer service layer
- CLI `main()` is a thin dispatcher delegating to command modules
- the smoke suite passes identically
- `git diff --stat` shows a net-negative or net-neutral line count

Roadmap 2 completion note: Phase 5.1 is the final first-pass hygiene phase. Phase 5.2 follows with the deeper module split before Roadmap 2 closes.

### Phase 5.2: Deep Module Split

Status: `Complete`

Goal:

Split the remaining large files by concern without changing any public API, SQL schema, method signature, or observable behavior. Leave the codebase modular enough that Roadmap 3 can extend any layer independently.

Build:

- `project-store.ts` split into concern-scoped internal helper modules (snapshots, lifecycle, benchmarks, index runs, traces), with one public `ProjectStore` class surface unchanged
- `server.ts` reduced to middleware + route registration, with handler logic moved into `routes/` modules and MCP internals moved to `mcp.ts`; route registration stayed in `server.ts` so indexed route location and smoke output remained unchanged
- `runtime.ts` resolver primitives centralized, with exact error text and candidate ordering preserved
- `registry.ts` static tool definitions extracted to `tool-definitions.ts`, invocation and logging helpers extracted separately
- `attach.ts` migrated to the Phase 5.1 shared helpers
- dead code removal for items flagged in Phase 5.1 audit but not yet acted on

Rules:

- every changed line must preserve existing behavior
- the smoke suite is the behavior contract — smoke must pass identically before and after
- do not split just to split; only modularize where the current shape blocks independent Roadmap 3 work
- no new dependencies, no new features, no public API changes
- error text and candidate ordering in resolver outputs must be preserved exactly

Done when:

- `project-store.ts` is split by concern with one public class
- `server.ts` is middleware + route registration only, with route logic in modules and smoke-visible route location preserved
- `runtime.ts` resolver patterns are centralized
- `registry.ts` tool definitions are in their own file
- `attach.ts` uses the shared indexer helpers from Phase 5.1
- smoke suite passes identically
- dead code identified in Phase 5.1 audit is removed

Roadmap 2 completion note: Phase 5.2 shipped and locked Roadmap 2. Roadmap 3 begins next. No further Roadmap 2 phases will be opened.

## Why These Phases Are In This Order

### Phase 1 before Phase 2

Because snapshots need to belong to a stable project contract.

### Phase 2 before Phase 3

Because repo-derived schema must exist before live DB refresh can be compared against it meaningfully.

### Phase 3 before Phase 3.1

Because the live DB substrate must be real before the setup UX can wrap it cleanly.

### Phase 3.1 before Phase 3.2

Because the operator-flow cleanup should happen before the package-level cold-start and command-alias surface is finalized.

### Phase 3.2 before Phase 3.2.1

Because 3.2 shipped the package name, bin shape, and UX but left the actual tarball buildability to a dedicated follow-up. 3.2.1 closes the shippability gap without re-opening any of 3.2's feature scope.

### Phase 3.2.1 before Phase 3.3

Because the advertised `npx agentmako connect` path should actually work before deeper profile detection work lands. Once publishability is solved, 3.3's detection upgrades can target a fully shippable CLI surface.

### Phase 3.3 before Phase 3.4

Because 3.3 establishes the real profile-detection model and 3.4 is a narrow polish pass on top of it. The polish items assume the Phase 3.3 post-scan detection exists.

### Phase 3.4 before Phase 4

Because Phase 4's append-only fact tables will start recording profile data. Landing the resolved-path-alias, corrected-`srcRoot`, and enriched-entryPoints shape first means the history is honest from day one, rather than mixing old unresolved and new resolved forms across the log.

### Phase 3.4 before Phase 3.4.1

Because 3.4.1 is a targeted correctness hotfix on the Phase 3.4 alias work, not a replacement for the broader polish pass.

### Phase 3.4.1 before Phase 3.5

Because 3.5 should build on the corrected alias substrate rather than the hand-rolled leaf-config-only version from early 3.4.

### Phase 3.5 before Phase 4

Because Phase 4 should log against the real connect-time DB substrate the product intends to keep: a saved schema scope plus a richer structural live snapshot, not a thinner early refresh path that would immediately become obsolete.

### Phase 3.5.1 before Phase 4

Because Phase 4 should log against the DB substrate in the form the product actually intends to query locally: a canonical snapshot plus flattened read tables, not a JSON-only snapshot that downstream code keeps unpacking ad hoc.

### Phase 3.5.2 before Phase 3.6

Because Phase 3.6's schema auto-import relies on the simplified flat-SQL ingestion path from 3.5.2. Removing the interactive picker on top of a mixed ingestion layer would have left the schema discovery path ambiguous.

### Phase 3.6 before Phase 4

Because Phase 4 should log the CLI workflows that operators actually experience, not a transitional set that includes a deprecated `project init` command, a schema picker that will be gone by the time logging starts, and a no-arg `agentmako` invocation that prints a help page. Landing 3.6 first means the logged operator flow matches the shipped product from the first logged event.

### Phase 4 before Phase 4.1

Because Phase 4.1's benchmark result tables link to `tool_runs` rows by foreign key. The `tool_runs` table must exist before benchmark case results can reference it. Phase 4 also establishes the immutability trigger pattern that Phase 4.1 reuses.

### Phase 4.1 before Phase 5

Because Phase 5 ForgeBench validation must be able to store repeatable benchmark runs as structured facts. Without Phase 4.1's benchmark result tables, validation results can only be observed informally rather than recorded in the durable substrate Roadmap 2 is building toward.

### Phase 5 before Phase 5.1

Because cleanup should happen after the codebase is validated, not before, so that validated behavior is the baseline the refactor must preserve. Running Phase 5.1 before Phase 5 would mean the refactor changes code that has not yet been proven correct end-to-end — making it harder to distinguish a behavior regression from a pre-existing gap. Phase 5 locks the behavioral ground truth; Phase 5.1 reorganizes the code against that ground truth.

### Phase 5.1 before Phase 5.2

Because Phase 5.2 builds directly on Phase 5.1's shared helpers. The `withGlobalStore`, `withProjectStore`, and `withResolvedProjectContext` helpers extracted in Phase 5.1 are the substrate Phase 5.2 uses to clean up `attach.ts`. Running Phase 5.2 first would mean migrating `attach.ts` against helpers that do not yet exist. Phase 5.1 also separates the simpler, lower-risk debt (duplicated utilities, CLI dispatcher split) from the higher-risk concentration-point splits in Phase 5.2, so each pass has a clean behavioral baseline to work against.

## Dependencies And Co-Development

- Phase 1 and the earliest Phase 2 design work can overlap at the contract-definition level.
- Phase 2 persistence and Phase 3 binding UX should not ship independently; they need stable schema snapshot contracts first.
- Phase 3.1 depends on Phase 3 substrate stability and should settle the operator flow before package-level onboarding is finalized.
- Phase 3.2 depends on Phase 3.1 and should settle the intended public connect/install workflow before logging expands.
- Phase 3.2.1 depends on Phase 3.2 and closes the shippability gap 3.2 advertised but did not land; it is a packaging-only follow-up with no CLI source changes.
- Phase 3.3 depends on Phase 3.2.1 (or at least does not regress it) and should finish the profile detection upgrades before Phase 4 starts logging, so the facts in the append-only history are derived from real signal rather than filename heuristics.
- Phase 3.4 depends on Phase 3.3 and closes the last small profile-contract gaps (resolved path aliases, corrected `srcRoot`, enriched entry points) with a conditional cache — must land before Phase 4 to avoid baking the old unresolved shapes into the logging history.
- Phase 3.4.1 is a narrow hotfix on top of 3.4: it swaps the hand-rolled tsconfig parsing for `get-tsconfig` so `extends`-chain aliases resolve correctly before 3.5 and 4 rely on them.
- Phase 3.5 depends on the shipped connect/binding/refresh path and finishes the intended connect-time DB structure capture before logging starts treating refreshes as durable facts.
- Phase 3.5.1 depends on Phase 3.5 and makes the current schema snapshot queryable and more cleanly introspected before logging expands.
- Phase 3.5.2 depends on Phase 3.5.1 and backs out the ingestion-layer experiment while keeping the better storage model.
- Phase 3.6 depends on Phase 3.5.2 and delivers a net-reduction CLI polish pass — auto-schema-import, `--keychain-from-env`, `project init` deletion, and bare no-arg status — before Phase 4 starts logging operator workflows.
- Phase 4 depends on Phase 3.6 and the core Roadmap 2 flows being real enough to log honestly.
- Phase 4.1 depends on Phase 4 — benchmark case result rows link to `tool_runs` by FK, so `tool_runs` must exist first. Phase 4.1 also reuses the immutability trigger pattern Phase 4 establishes.
- Phase 5 is sequential. It proves the roadmap only after the logging and benchmark storage systems above it exist.
- Phase 5.1 depends on Phase 5 — cleanup runs against a validated behavioral baseline, not a speculative one.
- Phase 5.2 depends on Phase 5.1 — the deeper module split uses the shared helpers Phase 5.1 ships and runs against the behavioral baseline Phase 5.1 establishes. Phase 5.2 is the final Roadmap 2 phase; no further phases will be opened.

Rule:

- be strict about coupling, not artificially waterfall by default

## Guardrails

- keep Roadmap 1 public tool surfaces working while this roadmap lands
- do not store secrets in committed project config
- do not make live DB access the default answer path
- do not silently auto-attach projects from `roots` or `_meta.cwd`
- do not introduce ML or learned ranking in this roadmap
- do not flatten internal helpers into public top-level tools without a clear user question shape
- do not pull hourly/daily rollup tables, comparisons, or ranking-score systems into Roadmap 2 prematurely

## Concrete Non-Goals

- full investigation composer family
- contradiction engine
- learned ranking
- continuous live DB sync
- arbitrary row-data ingestion
- background-worker-first architecture
- AI layer work

## Verification Matrix

- attach, detach, status, and index work cleanly from inside a repo with no explicit path
- the intended setup flow works cleanly from inside a repo and leaves the project in an understandable state
- the intended public connect flow works cleanly from inside a repo and leaves behind saved defaults instead of repeated schema flags
- ForgeBench attach and reattach flow is repeatable
- MCP context resolves attached projects through the documented layered chain
- repo-derived schema snapshot can be created and refreshed
- project-scoped DB binding can be tested explicitly
- benchmark runs can be stored and reviewed
- docs clearly explain the Roadmap 2 operator flow

## Where To Begin

If implementation starts now, begin in:

- [./handoff.md](./handoff.md)
- [./phases/phase-3.5.2-live-catalog-ingestion-hotfix.md](./phases/phase-3.5.2-live-catalog-ingestion-hotfix.md)
- [../../master-plan.md](../../master-plan.md)

Reuse the shipped:

- `apps/cli/src/index.ts`
- `services/indexer/src/attach.ts`
- `services/indexer/src/project-profile.ts`
- `packages/store/src/global-store.ts`
- `packages/store/src/project-store.ts`
- the existing MCP/HTTP/tool surface from Roadmap 1
