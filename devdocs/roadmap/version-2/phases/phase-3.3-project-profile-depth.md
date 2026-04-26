# Phase 3.3 Project Profile Depth

Status: `Complete`

This file is the exact implementation spec for Roadmap 2 Phase 3.3.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.3.

## What Shipped

- `middlewareFiles` detection rewritten: top-level files of the source root only (non-recursive), basenames `middleware` OR `proxy` (Next.js 16), TS/JS code extensions, **validated by body content** — a candidate must contain both `export (const|default) config` and `matcher:` or it's rejected. Runs at attach time since no import graph is required.
- `serverOnlyModules` rebuilt via reverse-import-graph closure. Seeds come from content-level regex matches against framework server primitives (`from "next/headers"`, `from "next/cache"`, `"use server"`, `cookies()`, `headers()`, `unstable_cache(`, `revalidatePath(`, `revalidateTag(`). A BFS walk over reverse import edges from the seeds — using the already-indexed graph in `project.db` — extends the set transitively. Cycles are guarded by a visited set, and type-only import edges are excluded so `import type` consumers of a server-only module do not get incorrectly marked server-only. **Seed-pass content is read from the store's `chunks` table via a new `ProjectStore.getFileContent` helper**, not from disk — the scan already pays the file-read cost once, and the phase spec explicitly called out re-reading as a cost risk.
- `authGuardSymbols` rebuilt from actual exported symbols. For each file in the server-only set, exported function/variable symbols are queried from `project.db`; names are filtered by the Fenrir-ported naming convention — a valid guard name must start with one of `{with, require, verify, ensure, check, get, assert, enforce}` AND contain one of `{Auth, Session, Role, Permission, Access, User, Guard, Login}`. SQL migration filenames, Markdown, JSON, and other non-source formats are filtered out by extension (only `.ts / .tsx / .js / .jsx / .mjs / .cjs` are eligible). **Framework-reserved basenames** (`page`, `layout`, `route`, `default`, `error`, `loading`, `not-found`, `template`, `middleware`, `proxy`, plus Next.js file-convention names like `icon`, `opengraph-image`, `sitemap`) are also skipped during symbol extraction — those files belong to the framework contract and shouldn't contribute to the user-defined guard list even if their exports happen to match the naming convention. Seed detection and closure still run on reserved-basename files, so they can still propagate server-only-ness through the import graph.
- The server-only and auth-guard detection runs as a **post-scan step** inside `indexProject`, after `replaceIndexSnapshot` populates the store but before `finishIndexRun`. The manifest is rewritten in place via a new `updateProjectManifestCapabilities` helper, and the returned `IndexProjectResult` reflects the updated values so the CLI `agentmako connect` output and `agentmako status` see the honest detection.
- The post-scan step degrades gracefully: any error during profile-depth extraction is caught, logged via the structured logger as `profile_depth_failed`, and the previous capability values are left in place. Profile depth can never block an index run.
- End-to-end smoke coverage: a scratch Next.js 16 scratch project exercises every layer — valid `proxy.ts` is detected while content-invalid `middleware.ts` is rejected; `lib/auth.ts` (seed) and `lib/uses-auth.ts` (transitive importer) both land in `serverOnlyModules`; `lib/auth-type-only.ts`, which only does `import type` from `lib/auth.ts`, stays out of `serverOnlyModules`; `requireAuth`, `withSession`, and `checkRole` all land in `authGuardSymbols` while `notAGuard`, `verifySessionShape` (from the type-only consumer), `Layout`, SQL migration filenames, and a convention-matching `requireAdminPage` exported from `app/dashboard/page.tsx` are all correctly rejected (the last specifically locks the reserved-basename filter). The smoke block runs without a live DB.

## Review Fixes (post-ship)

Phase 3.3 shipped, then a code-review pass against the phase spec caught three gaps in the initial implementation. All were fixed before any downstream work started:

- **Seed detection was re-reading files from disk** instead of consuming the already-indexed data in `project.db`, violating the Risks and Execution Flow guidance in this doc. Fix: added `ProjectStore.getFileContent(filePath)` that concatenates the file's stored chunks in `(line_start, chunk_id)` order, and switched `collectProfileDepth` to use it. No behavioral diff on the scratch project — same seeds, same closure, same guards — but on large monorepos the profile-depth pass now pays zero extra file-read cost.
- **Framework-reserved basenames were not explicitly excluded** from the auth-guard pass. The initial implementation relied on the naming convention alone to keep `Layout`/`Page`/`RouteHandler` names out of `authGuardSymbols`, but that left a loophole: a user-defined `export function requireAdminPage()` inside `app/dashboard/page.tsx` would pass the naming filter and show up as a "guard" even though `page.tsx` is framework-contract surface, not user guard code. Fix: added `FRAMEWORK_RESERVED_BASENAMES` to `profile-depth.ts` and skip any file whose basename-without-extension matches during symbol extraction. Seed detection and closure still run on those files so they can propagate server-only-ness transitively, they just can't contribute symbol names. Covered by a new smoke assertion against a scratch `app/dashboard/page.tsx` that exports a convention-matching name.
- **Type-only import edges were participating in the reverse-import closure.** That caused `import type` consumers of a server-only module to be incorrectly marked server-only, which could in turn leak their exports into `authGuardSymbols`. Fix: `collectProfileDepth` now ignores edges where `isTypeOnly === true` when building the reverse-import map. Covered by a smoke assertion against `lib/auth-type-only.ts`, which imports only a type from `lib/auth.ts` and exports a guard-like symbol name that must stay out of both `serverOnlyModules` and `authGuardSymbols`.

## Code Touchpoints

- `services/indexer/src/project-profile.ts` — imported `readFileSync` / `readdirSync` / `Dirent`; added `MIDDLEWARE_BASENAMES`, `MIDDLEWARE_CODE_EXTENSIONS`, `MIDDLEWARE_CONFIG_EXPORT_PATTERN`, `MIDDLEWARE_MATCHER_PATTERN` constants; rewrote `collectMiddlewareFiles(srcRoot, rootPath)` to do a top-level non-recursive scan with content validation; replaced `collectServerOnlyModules` and `collectAuthGuardSymbols` with `collectInitialServerOnlyModules` / `collectInitialAuthGuardSymbols` stubs that return empty arrays at attach time (post-scan step fills them in honestly).
- `services/indexer/src/profile-depth.ts` — **new file**. Exports `collectProfileDepth(projectStore)` which executes the three-layer detection: seed-set scan for framework server markers (reads file content via `projectStore.getFileContent` — no disk reads), reverse-import closure via the store's `listAllImportEdges()` and a BFS walker, and exported-symbol filtering via `listSymbolsForFile` plus the auth verb-prefix × auth-substring naming convention. Skips edges marked `isTypeOnly` during reverse closure, and skips files whose basename matches `FRAMEWORK_RESERVED_BASENAMES` during symbol extraction so framework-contract files (`page`, `layout`, `route`, etc.) can't contribute symbol names to `authGuardSymbols` even when their exports match the naming convention.
- `packages/store/src/project-store.ts` — added `getFileContent(filePath)` that concatenates the file's stored chunks in `(line_start, chunk_id)` order and returns the content as a single string. Returns `null` for files that are not indexed.
- `services/indexer/src/project-manifest.ts` — added `updateProjectManifestCapabilities(projectRoot, patch)` as a partial-update helper for the capabilities block. Sits alongside the existing `updateProjectManifestDefaultSchemaScope` helper from Phase 3.2.
- `services/indexer/src/index-project.ts` — added a `createLogger` import and a post-scan block that calls `collectProfileDepth`, writes the result back via `updateProjectManifestCapabilities`, updates the in-memory profile object, and catches any failure as a structured warning. The schema snapshot build and the `IndexProjectResult` now use the updated manifest.
- `test/smoke/core-mvp.ts` — added a self-contained Phase 3.3 block (no live DB required) that builds a scratch Next.js 16 project with a valid `proxy.ts`, a content-invalid `middleware.ts`, `lib/auth.ts` (seed + three valid guard exports + one non-guard), `lib/uses-auth.ts` (transitive importer), `lib/auth-type-only.ts` (type-only importer), an `app/layout.tsx` (framework-reserved), and a SQL migration whose filename contains `role` and `session` — then asserts the exact detection output.

## Goal

Turn the project profile detection from filename heuristics into real signal — proper middleware file validation, import-graph-based server boundary derivation, and actual auth-guard symbol extraction — so downstream tools and the Phase 4 logging substrate can rely on the profile instead of going back to grep.

## Hard Decisions

- this phase is a detection-quality phase, not a new field or substrate phase
- the existing manifest field names stay the same; only their values become meaningful
- profile detection should consume the already-indexed data in `project.db` where possible, rather than re-walking the filesystem
- `middleware_files` must validate that the file is actually shaped like Next.js middleware, not just match the filename
- `proxy.ts` must be recognized as middleware for Next.js 16 projects, alongside `middleware.ts`
- `serverOnlyModules` must be derived from import-graph closure over framework server primitives, not from path heuristics
- `authGuardSymbols` must contain real exported symbol names, not filename stems
- the SQL-side authz shape (role table, role column, admin check template) is explicitly NOT in this phase — it belongs in or after Phase 4
- no manifest version bump; no field renames

## Why This Phase Exists

Phase 3.2 shipped a clean connect flow, but the first dog-food run on a real Next.js 16 project exposed a stub-level gap in the profile:

1. `middlewareFiles` was empty because the regex only matched `middleware.*` and missed `proxy.ts`, which is the Next.js 16 convention
2. `authGuardSymbols` was populated with garbage: SQL migration filename stems like `20260413222009_create_profiles_and_user_roles`, framework-required filenames like `layout`, `page`, `route`, and no actual exported symbol names
3. `serverOnlyModules` was derived from path heuristics (`app/api/`, `lib/server/`, `.server.`), not from the real Next.js server-boundary signal (`next/headers`, `"use server"`, `cookies()`, etc.)

Fenrir had already solved this problem with a three-layer code-side detection model. This phase ports the code-side design into mako-ai so the profile is honest before Phase 4 starts logging against it. Logging a stub profile into append-only fact tables would bake bad data into the history that later trust work depends on.

## Scope In

- `proxy.ts` recognition as a middleware basename alongside `middleware.ts` (Next.js 16)
- middleware detection restricted to top-level files of the source root (non-recursive scan)
- middleware detection validated by file body content — must contain both an `export const config` / `export default config` and a `matcher:` field
- `serverOnlyModules` rebuilt via a reverse-import-graph closure from framework server primitives: `next/headers`, `next/cache`, `"use server"`, `cookies()`, `headers()`, `unstable_cache`, `revalidatePath`, `revalidateTag`
- `authGuardSymbols` rebuilt by iterating the server-only module set, querying exported function/const symbols from `project.db`, and filtering by the auth verb-prefix × auth-substring naming convention
- explicit exclusions to keep the lists clean: SQL migration files, `.md`, `.json`, Next.js framework-reserved filenames (`layout`, `page`, `route`, `default`, `error`, `loading`, `not-found`, `template`)
- new smoke coverage for all three detection paths against scratch projects: a Next.js 16 `proxy.ts` project, a project with `lib/auth.ts` using `cookies()` and exporting `requireAuth` / `withRole`, a type-only consumer that must stay out of the reverse-import closure, and a project whose auth files live under a path that should NOT leak into `authGuardSymbols`

## Investigated And Dismissed

Two items were in an earlier draft of this phase's scope but turned out not to be real bugs:

- **"Drop stale `.mako-ai` from the default indexing exclude list."** The `.mako-ai` entry in `services/indexer/src/project-manifest.ts:resolveIndexingExclude` is not stale — it's `DEFAULT_STATE_DIRNAME` from `packages/config/src/defaults.ts`, the per-project SQLite state dir. It correctly needs to be excluded from indexing alongside `.mako/` (the manifest dir). Both are legitimate.
- **"Stop duplicating generated type files between `schemaSources` and `generatedTypePaths`."** `types/supabase.ts` appears in both fields on purpose. `schemaSources` is consumed by `services/indexer/src/schema-sources/inventory.ts` as a real schema-source-for-parsing (the type file carries schema information). `generatedTypePaths` separately flags the file as auto-generated for write-protection purposes. Two different roles, both legitimate. The existing smoke test (`test/smoke/core-mvp.ts:787`) explicitly asserts `types/supabase.ts` is in `schemaSources` — confirmation that the current shape is intentional.

## Scope Out

- SQL-side `AuthzProfile` shape (role_table, role_column, role_enum_type, admin_values, tenant_table, tenant_fk_column, admin_check_template) — this requires live DB introspection against `pg_policy` + `pg_get_expr` + `information_schema.columns` + `pg_type`, and belongs in or after Phase 4 once logging can record the detection attempts
- schema IR expansion (foreign keys, indexes, RLS policies, view definition text, triggers) — schema shape depth is a separate topic from project profile depth
- pg_stat_* performance signals
- renaming any existing manifest field or bumping `version` from `"2.0.0"`
- AST-level parsing of files outside the computed server-only set
- detecting the Next.js major version, the router style (app vs pages), or the auth provider library
- adding new top-level manifest fields such as `authProvider`, `routerStyle`, or `nextVersion`
- changes to the CLI connect flow UX surface (the connect output already prints the capabilities block; the change is in the underlying values, not the rendering)

## Architecture Boundary

### Owns

- the project profile detection logic in `services/indexer/src/project-profile.ts`
- the post-scan profile-depth logic in `services/indexer/src/profile-depth.ts` and its manifest writeback in `services/indexer/src/index-project.ts`
- new profile-side query helpers against `project.db` for the import graph and exported symbols
- the rules for what counts as a middleware file, a server-only module, and an auth-guard symbol
- the filter lists for SQL migration and framework-reserved filename exclusion

### Does Not Own

- the manifest schema itself — field shapes stay as-is
- the schema IR contract
- the live DB binding model
- the default indexing exclude list or generated-type manifest semantics (those were investigated and left unchanged)
- the CLI connect flow or output format
- the logging substrate (Phase 4)
- the SQL-side authz detection (explicitly deferred)
- package/install UX (owned by Phase 3.2, now complete)

## Contracts

### Input Contract

- middleware file detection runs during `detectProjectProfile` at attach time; `serverOnlyModules` and `authGuardSymbols` run as a post-scan step inside `indexProject`, after `replaceIndexSnapshot` has populated `project.db` with the import graph and symbol table
- `collectProfileDepth(projectStore)` is a pure function of the indexed state; manifest mutation happens one level up in `indexProject` via `updateProjectManifestCapabilities`
- must work offline — no live DB required
- must degrade gracefully: a parse failure on one file must not abort the whole profile run; an unreadable file falls through to the next candidate

### Output Contract

- `profile.middlewareFiles`: array of top-level relative file paths where the basename is `middleware` or `proxy`, extension is a TS/JS code extension, AND the file body contains both a `config` export and a `matcher:` field
- `profile.serverOnlyModules`: sorted array of relative file paths proven server-only via reverse-import closure from files containing any Next.js server primitive marker; type-only edges do not participate in that closure
- `profile.authGuardSymbols`: sorted array of exported symbol names from `profile.serverOnlyModules` whose name matches both an auth verb prefix (e.g. `with`, `require`, `verify`, `ensure`, `check`, `get`, `assert`, `enforce`) and an auth substring (e.g. `Auth`, `Session`, `Role`, `Permission`, `Access`, `User`, `Guard`, `Login`)
- the manifest serialization of those three fields uses the existing shapes in `ProjectManifestCapabilities`; no schema version bump

### Error Contract

- profile-depth errors are caught in `indexProject`, logged as `profile_depth_failed`, and leave the previously attached capability values in place; they never block the index run
- unreadable files, binary files, files outside the project root, and files with parse errors are skipped silently
- cycles in the import graph must not cause infinite loops — the reverse-closure walker must track visited nodes
- a profile with all three fields empty is still a valid profile

## Execution Flow

1. attach or re-attach the project — `detectProjectProfile` computes the attach-time profile, including top-level middleware detection, and writes the initial manifest
2. index the project — `scanProject` walks the repo and `replaceIndexSnapshot` writes files, chunks, symbols, imports, and routes into `project.db`
3. inside `indexProject`, call `collectProfileDepth(projectStore)` to compute `{ serverOnlyModules, authGuardSymbols }` from the indexed graph:
   a. query `project.db` for files whose content contains any of the framework server primitive markers → seed set for the server-only closure
   b. using the already-indexed import edges, walk the reverse-import graph from each seed, accumulating visited files until no new ones are added → `serverOnlyModules`; skip edges marked `isTypeOnly`
   c. for each file in `serverOnlyModules`, query the symbol table for exported symbols of kind function/const whose name matches the auth verb-prefix × auth-substring pattern → `authGuardSymbols`
4. write the updated capability values back to `.mako/project.json` via `updateProjectManifestCapabilities`, update the in-memory profile object, then continue to schema snapshot + run finalization
5. if the post-scan step fails, log and keep the previously attached capability values instead of blocking the index

## File Plan

Create:

- potentially `services/indexer/src/profile-depth.ts` if `project-profile.ts` becomes too crowded; otherwise inline the new helpers

Modify:

- `services/indexer/src/project-profile.ts` — rewrite `collectMiddlewareFiles`, recognize `proxy.ts`, and replace attach-time `serverOnlyModules` / `authGuardSymbols` with honest empty stubs that the post-scan step later fills in
- `services/indexer/src/project-manifest.ts` — add `updateProjectManifestCapabilities(projectRoot, patch)` for post-scan capability writeback
- `packages/store/src/project-store.ts` — if the existing import-edge and symbol query helpers do not expose the shapes this phase needs, add thin read helpers. No new tables, no migrations.
- `test/smoke/core-mvp.ts` — add Phase 3.3 smoke coverage blocks

Keep unchanged:

- `packages/contracts/src/project.ts` (shapes stay the same)
- the CLI connect/status/verify/refresh surface
- the API service contract
- the live DB binding substrate
- the schema IR contract

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- `agentmako connect` on a Next.js 16 scratch project with a top-level `proxy.ts` that exports `export const config = { matcher: [...] }` lists `proxy.ts` in `middlewareFiles`
- `agentmako connect` on a project whose middleware file imports `next/headers` but does NOT export a matching `config` is NOT included in `middlewareFiles` (content validation is real, not just filename matching)
- `agentmako connect` on a scratch project with `lib/auth.ts` that uses `cookies()` from `next/headers` and exports `requireAuth`, `withRole`, `verifySession` lists all three in `authGuardSymbols`
- the same project lists `lib/auth.ts` (and any file that imports it) in `serverOnlyModules`
- a file that only reaches `lib/auth.ts` through `import type` does NOT appear in `serverOnlyModules` and its guard-like exports do NOT appear in `authGuardSymbols`
- a project with only `supabase/migrations/*.sql` and no auth code returns an empty `authGuardSymbols` — SQL migration filenames never leak in
- framework-reserved filenames `layout.tsx`, `page.tsx`, `route.ts` never appear in `authGuardSymbols`, even when they live under a path that contains `auth` or `session`
- all existing Phase 3.2 smoke tests still pass unchanged
- the forgebench manifest, when re-connected after this phase lands, shows non-empty values for `middlewareFiles` and `authGuardSymbols` assuming the project actually has those files

Required docs checks:

- roadmap docs reflect Phase 3.3 sitting between Phase 3.2 and Phase 4
- Phase 4 doc references Phase 3.3 as a prerequisite
- handoff doc points at Phase 3.3 as the current implementation target
- Phase 3.3 Status flips from `Planned` to `Complete` when the work lands, following the same convention used by earlier phases

## Done When

- `middlewareFiles` honestly names the project's middleware file (`proxy.ts` or `middleware.ts`) with real content validation
- `serverOnlyModules` reflects the real server-boundary state derived from the import graph
- `serverOnlyModules` ignores type-only edges, so `import type` consumers do not become server-only by mistake
- `authGuardSymbols` contains real exported symbol names and never filename stems or migration filenames
- the forgebench manifest updates from an empty-or-garbage state to meaningful values on re-connect
- Phase 4 can begin logging against a profile that is no longer a stub
- Roadmap 2 handoff and roadmap docs reflect the new phase ordering

## Risks And Watchouts

- parsing every file for framework marker patterns on every index can get expensive on large repos; the implementation must reuse `project.db`'s already-indexed symbol and import data where possible instead of re-reading files from disk
- the auth naming convention list is heuristic — it may miss legitimate guards that use unconventional names (e.g., `adminOnly`, `canEdit`) or include unrelated identifiers; tune against real projects and document the exact lists
- cycles in the import graph must not loop the reverse-closure walker — the walker must track visited nodes explicitly
- detection must never block the index run; any failure in profile depth degrades to keeping the previously attached values, not an error
- the filename exclusion list for `authGuardSymbols` (framework-reserved names) is load-bearing; add it as a named constant with a comment explaining why each name is excluded
- temptation to pull the SQL-side `AuthzProfile` in now because "the detection queries are small" — resist. The live-DB dependency and the RLS expression frequency analysis are a different concern and belong after Phase 4's logging substrate exists
- temptation to bump the manifest version or rename fields — out of scope; the shape stays stable
- temptation to add new top-level fields (`authProvider`, `routerStyle`, `nextVersion`) — also out of scope; those belong in a future detection phase when they have real consumers

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [./phase-3.2-package-and-connect-ux.md](./phase-3.2-package-and-connect-ux.md)
- [./phase-4-logging-and-evaluation-backbone.md](./phase-4-logging-and-evaluation-backbone.md)
- [../../../scratch/fenrir-lessons.md](../../../scratch/fenrir-lessons.md)
- Fenrir source references (code-side detection model being ported):
  - `fenrir/src/fenrir/project_profile/detector.py` — `detect_middleware_files` (top-level scan + content validation), `detect_server_only_modules` (import-graph closure from framework markers), `detect_auth_guards` (exported-symbol extraction with naming convention)
  - `fenrir/src/fenrir/project_profile/profile.py` — `ProjectProfile` dataclass field shapes and `AuthzProfile` dataclass (the SQL-side piece explicitly deferred from this phase)
