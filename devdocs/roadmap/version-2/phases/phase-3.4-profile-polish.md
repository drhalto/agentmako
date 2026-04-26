# Phase 3.4 Profile Polish

Status: `Complete`

Note: a narrow follow-up hotfix landed immediately afterward as
[Phase 3.4.1](./phase-3.4.1-tsconfig-alias-hotfix.md) to replace the
hand-rolled tsconfig parser with `get-tsconfig` and close the remaining
`extends`-chain alias-resolution gap.

## What Shipped

- `detectPathAliases` in `services/indexer/src/project-profile.ts` now parses `tsconfig.json` / `jsconfig.json` as JSONC (comments + trailing commas tolerated), reads `compilerOptions.baseUrl`, strips trailing `*` from both the alias key and first target, and resolves each alias to an absolute filesystem path. The first config that actually yields aliases wins, matching Fenrir's behavior.
- `detectSrcRoot` now uses the stricter `src/app` / `src/pages` rule for Next.js projects, so a generic `src/` directory no longer pulls Next.js profile detection away from a repo-root `app/` or `pages/` tree. Non-Next projects still keep `root/src` as `srcRoot` when that directory exists, preserving the older and semantically correct source-root behavior for Vite / Node TS repos.
- `collectEntrypoints` now keeps file-like semantics while surfacing the fuller Next.js entry surface: concrete `app/**/{page,layout,route,...}` files, concrete `pages/**` files, metadata entry files like `robots`, `sitemap`, `manifest`, `icon`, and `opengraph-image`, each validated middleware/proxy file from Phase 3.3, and `next.config.{js,mjs,cjs,ts}` from the project root or resolved source root. The existing `KNOWN_ENTRYPOINTS` / `package.json.main` / `index|main|server` fallbacks still run afterward for non-Next projects.
- Smoke coverage now locks the Phase 3.4 contract in `test/smoke/core-mvp.ts`: JSONC `tsconfig.json` path aliases resolve to absolute paths, a generic `src/` plus root-level `app/` keeps `srcRoot` at the repo root, `entryPoints` includes `proxy.ts`, `next.config.ts`, and `app/robots.ts`, and a fallback non-Next TypeScript project with no `paths`, no middleware, and no Next config still produces `{}` aliases plus `src/index.ts` with `srcRoot === root/src`.
- Latency measurement on `forgebench` was run directly against `detectProjectProfile`, which is the only code path a Phase 3.4 profile cache would accelerate. Recorded timings: cold `23.39 ms`; warm runs `12.31`, `11.93`, `8.61`, `9.27`, `8.01 ms`; median warm `9.27 ms`. That is well below the phase's `200 ms` threshold, so **no profile cache shipped**. The cache is explicitly deferred because the current detector is already fast and adding invalidation machinery would increase complexity without a measurable payoff.

## Code Touchpoints

- `services/indexer/src/project-profile.ts` — JSONC-safe config parsing for path aliases, stricter `srcRoot`, and richer file-like entry-point discovery.
- `test/smoke/core-mvp.ts` — extended the existing Phase 3.3 scratch project and added a small fallback scratch project to lock the 3.4 behavior.

This file is the exact implementation spec for Roadmap 2 Phase 3.4, a focused follow-up to Phase 3.3.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design of Phase 3.4.

## Goal

Close the last small profile-contract gaps before Phase 4 opens:

- `baseUrl`-aware path alias resolution
- `srcRoot` behavior that matches the actual app/pages layout for Next.js without regressing legitimate `src/` roots in non-Next projects
- a more complete `entryPoints` list that stays compatible with current `mako-ai` consumers

Optionally bolt on a profile cache, but **only** if a direct latency measurement on a real project proves it's worth the invalidation risk and the invalidation story can honestly cover the detector inputs.

## Hard Decisions

- this is a narrow polish phase, not a broad profile-expansion phase
- **no new semantic fields** beyond fixing `pathAliases`, tightening `srcRoot`, and extending `entryPoints`
- `appDir`, `authProvider`, `runtime` and other potential fields are explicitly **deferred** — they belong in a later profile-expansion pass when Phase 4 or downstream work has a concrete consumer
- the profile cache is a conditional deliverable: ship only if a real measurement shows the current uncached detection takes enough time on a real repo to justify the invalidation risk
- no broadening once the phase is open — if review turns up another "while we're here" idea, note it and let it wait for a later pass
- `entryPoints` must stay compatible with current `mako-ai` consumers — this phase does **not** switch the field from file-like relative paths to abstract directory markers like `app/` or `pages/`
- `srcRoot` correction is part of the same pass, because entry-point discovery depends on it
- `tsconfig.json` / `jsconfig.json` parsing must tolerate JSON-with-comments / trailing commas; plain `JSON.parse` is not enough for real TypeScript configs
- the cache, if built, must invalidate on the **actual** detector inputs, not just the narrower Fenrir source set
- the phase must land before Phase 4 opens, because Phase 4 will start recording profile data as append-only facts and we don't want to bake `pathAliases` in their current un-resolved form into the history

## Why This Phase Exists

Phase 3.3 shipped an honest, import-graph-driven project profile with real middleware, server-boundary, and auth-guard detection. Three smaller polish items came out of the Fenrir comparison pass that didn't fit in 3.3's scope but are real quality gaps:

1. **`detectPathAliases` currently returns raw `compilerOptions.paths` entries verbatim.** If a consumer wants to turn `import { x } from "@/lib/auth"` into a file path, it has to replay the `baseUrl` + `paths` resolution itself every time. Fenrir's detector resolves them to absolute directories once during profile detection. This is a correctness gap — the field name promises "aliases" but the value is closer to "raw alias metadata".
2. **`collectEntrypoints` uses a hard-coded `KNOWN_ENTRYPOINTS` list plus a filename-regex fallback.** It never surfaces `next.config.*` or the middleware/proxy file as entry points, even though 3.3 already detects middleware files reliably. For Next.js projects specifically, the meaningful entry surface includes concrete entry files plus `next.config.*` and `middleware.ts` / `proxy.ts`.
3. **`detectSrcRoot` is looser than Fenrir and can point entry-point discovery at the wrong place.** Today `mako-ai` switches to `root/src` whenever `src/` exists. Fenrir only switches when `src/app` or `src/pages` exists. On repos that happen to have a generic `src/` folder but still keep their real Next.js routing at the root, the current behavior is wrong.

The cache is a separate, conditional concern: Fenrir has it because it pays dividends on large repos where profile detection is non-trivial. We should measure before committing to it.

## Scope In

- **Resolved path aliases.** Rewrite `detectPathAliases` in `services/indexer/src/project-profile.ts` so that:
  - it reads `compilerOptions.baseUrl` (default `"."` when absent)
  - resolves `baseUrl` to an absolute directory under `rootPath`
  - for each `[alias, targets]` pair in `compilerOptions.paths`, takes the first target, strips the trailing `*` from both sides, and resolves `{alias_prefix: path.resolve(baseAbsolute, targetClean)}`
  - handles both `tsconfig.json` and `jsconfig.json` (first one that actually has `paths` wins — matches Fenrir)
  - parses real TypeScript config files, including JSON comments / trailing commas
  - degrades gracefully on unreadable or invalid config content (returns `{}`)
  - `ProjectProfile.pathAliases` contract stays `Record<string, string>`; only the value shape changes from "raw target string" to "resolved absolute path"
- **`srcRoot` alignment.** Rewrite `detectSrcRoot` so Next.js projects match Fenrir's rule while non-Next projects keep a meaningful source root:
  - if the framework is `nextjs`, return `root/src` only when `src/app` or `src/pages` exists; otherwise return `rootPath`
  - for non-Next projects, keep `root/src` when that directory exists; otherwise return `rootPath`
- **More complete entry points.** Rewrite `collectEntrypoints` so it emits a deduplicated, stable-order list of **project-relative file-like paths**, not directory markers. Order:
  - existing concrete Next.js entry files under the resolved source root (`app/page.*`, `app/layout.*`, `pages/index.*`, etc.)
  - every middleware/proxy file already detected by `collectMiddlewareFiles`
  - any `next.config.{js,mjs,cjs,ts}` at the project root or the resolved source root when those differ
  - the existing `KNOWN_ENTRYPOINTS` / `package.json.main` fallbacks for non-Next projects
- **Smoke coverage.** Extend the Phase 3.3 scratch-project block in `test/smoke/core-mvp.ts` to assert both changes. Scope:
  - A project with a `tsconfig.json` that has `"baseUrl": "."` and `"paths": {"@/*": ["./src/*"]}` ends up with `pathAliases["@/"]` pointing at an **absolute** path that ends with `/src/`.
  - A project with a generic `src/` directory but root-level `app/` keeps `srcRoot === rootPath` and still finds the root entry files.
  - The same project's `entryPoints` includes `proxy.ts`, `next.config.*`, and a metadata file like `app/robots.ts`.
  - A non-Next TypeScript project with `src/index.ts` keeps `srcRoot === root/src`.
  - Existing Phase 3.2 / 3.3 smoke assertions still pass.
- **Latency measurement as a gate for the optional cache.** Before spending any code on the cache, run a short measurement script that:
  - runs `agentmako connect --yes --no-db` against a realistic-size scratch project (forgebench is a fine target) at least five times
  - reports wall-clock time for the detection portion specifically (everything between `attachProject` entry and the post-scan manifest write)
  - reports cold-start vs warm-start timings
  - if the warm-start detection stays under **200 ms** on the target project, **skip the cache entirely** for this phase. If it's consistently above 500 ms, ship the cache. Between 200 and 500 ms, ship only if review agrees.

## Scope Out

- `appDir` as a first-class profile field — easy to derive from `srcRoot` and has no concrete consumer today; revisit when one exists
- `authProvider` detection from `package.json` deps (`clerk`, `next-auth`, `@supabase/ssr`, etc.) — new semantic field, not polish, defer to a later profile-expansion pass
- Next.js route runtime detection (`edge` vs `nodejs` from `export const runtime = ...`) — same reason; defer
- Any SQL-side detection from Fenrir (`AuthzProfile`, RLS introspection, tenant/role scoring, wide-table detection) — Phase 4+
- Schema IR expansion (FKs, indexes, views, triggers, RLS policies) — Phase 4+
- Manifest shape changes beyond the two value-level fixes above — no new fields, no renames, no version bump
- Any change to the CLI surface, the connect flow, or the publishing pipeline

## Architecture Boundary

### Owns

- `detectPathAliases`, `detectSrcRoot`, and `collectEntrypoints` in `services/indexer/src/project-profile.ts`
- the smoke coverage that locks the corrected `srcRoot` / `entryPoints` / `pathAliases` behavior
- (conditionally, based on measurement) the profile cache storage, invalidation source set, and cache-read path in `detectProjectProfile`
- the latency measurement procedure documented in the phase's Verification section

### Does Not Own

- the `ProjectProfile` type shape (no new fields)
- the manifest schema or its version
- the Phase 3.3 post-scan profile-depth pass — that code is unchanged in 3.4
- the CLI surface
- any SQL-side detection or schema IR expansion
- the logging/facts pipeline (Phase 4 owns that)

## Contracts

### Input Contract

- `detectPathAliases(rootPath)` must handle:
  - missing or unreadable `tsconfig.json` / `jsconfig.json` → return `{}`
  - `compilerOptions.paths` missing, null, or not-an-object → return `{}`
  - individual `paths` entries where `targets` is empty, not an array, or has no string values → skip that alias
  - `compilerOptions.baseUrl` missing → default to `"."`
  - `baseUrl` resolution errors → fall back to `rootPath`
- `detectSrcRoot(rootPath, framework)` must handle:
  - a Next.js project with a plain `root/src` directory but no `src/app` and no `src/pages` → keep `srcRoot === rootPath`
  - a Next.js project where `src/app` or `src/pages` exists → `srcRoot === root/src`
  - a non-Next project with a plain `root/src` directory → `srcRoot === root/src`
- `collectEntrypoints(rootPath, srcRoot, relativeFiles, middlewareFiles)` must handle:
  - no `app/` or `pages/` files at the resolved source root → fall through to the existing fallbacks
  - `next.config.*` missing → skip silently
  - middleware detection having returned an empty list → skip silently

### Output Contract

- `profile.pathAliases` is a `Record<string, string>` where each value is an **absolute** filesystem path (not a raw target string). Trailing `/*` on alias keys and target values is stripped before resolution.
- `profile.srcRoot` points at `root/src` when that is the meaningful source root for the detected framework: for Next.js, only when the routing roots live there; for non-Next projects, whenever `root/src` exists.
- `profile.entryPoints` remains a deduplicated, stable-order list of project-relative file-like entries. It includes, when applicable: concrete app/pages entry files, Next app-router metadata files, each detected middleware file, each `next.config.*` file, and any existing `KNOWN_ENTRYPOINTS` / `package.json.main` hits.
- The rest of the profile and manifest shape is unchanged.

### Error Contract

- Neither `detectPathAliases` nor `collectEntrypoints` may throw. Any internal error degrades to an empty/partial result — same pattern as the rest of `detectProjectProfile`.
- If the cache ships, a cache read error must degrade to re-running detection, not propagate upward.

## Execution Flow

1. Rewrite `detectSrcRoot` and `collectEntrypoints` together, because entry discovery depends on the corrected source-root behavior. Land alongside smoke assertions.
2. Rewrite `detectPathAliases` with `baseUrl` + `paths` resolution and JSONC-safe parsing. Land alongside a smoke assertion.
3. Run the latency measurement against a realistic scratch project (forgebench). Record the numbers.
4. **Decide** whether to ship the cache based on the measurement threshold defined in Scope In.
5. If the cache ships, implement it as:
   - a new `.mako/profile-cache.json` sidecar file (or a row in `project.db` — pick whichever is smaller)
   - a `computeProfileInputFingerprint(rootPath)` or equivalent helper that covers the actual attach-time detector inputs: `package.json`, `tsconfig.json`, `jsconfig.json`, relevant top-level source-root entries, middleware/proxy candidates, `next.config.*`, and any other files `detectProjectProfile` actually inspects
   - an early-return branch at the top of `detectProjectProfile` that compares the current fingerprint to the cache's and returns the cached profile on match
   - tests that prove both hit-path and bust-path behavior when each tracked input changes
6. Re-run smoke + latency measurement. Compare before/after on the same scratch target.

## File Plan

Create:

- (conditionally, if the cache ships) `services/indexer/src/profile-cache.ts` with the detector-input fingerprint helper and the cache read/write functions

Modify:

- `services/indexer/src/project-profile.ts` — `detectSrcRoot`, `detectPathAliases`, and `collectEntrypoints` rewrites; wire through to the existing `detectProjectProfile` top-level function
- `test/smoke/core-mvp.ts` — extend the Phase 3.3 scratch-project block with assertions for resolved path aliases, corrected `srcRoot`, and enriched entry points

Keep unchanged:

- the manifest schema and version
- the profile type contract
- the post-scan profile-depth pass from Phase 3.3
- the CLI surface
- every `@mako-ai/*` package boundary

## Verification

Required commands:

- `corepack pnpm typecheck`
- `corepack pnpm test`

Required runtime checks:

- on a scratch Next.js project with `{"compilerOptions": {"baseUrl": ".", "paths": {"@/*": ["./src/*"]}}}` in `tsconfig.json`, `profile.pathAliases["@/"]` resolves to an absolute path that ends with `.../src/` (or `.../src` without trailing slash — match Fenrir's normalization)
- the same assertion still passes when the config file contains TypeScript-style comments or trailing commas
- on a Next.js project with a generic `src/` folder but root-level `app/`, `profile.srcRoot` stays at the project root
- on the same scratch project with a top-level `proxy.ts` (valid middleware per Phase 3.3), a `next.config.js`, and `app/robots.ts`, `profile.entryPoints` includes all three
- on a non-Next TypeScript project with `src/index.ts`, `profile.srcRoot` resolves to `root/src`
- on a project with only `tsconfig.json`'s `compilerOptions` missing the `paths` field, `profile.pathAliases` is `{}`
- on a project with no `next.config.*` or middleware file, `profile.entryPoints` still contains the existing `KNOWN_ENTRYPOINTS` / `package.json.main` fallback entries
- existing Phase 3.2 and Phase 3.3 smoke tests still pass unchanged

Required measurement (gate for the cache):

- a short script that runs `agentmako connect --yes --no-db` against a real project target (forgebench scale), reports wall-clock detection latency on five consecutive runs, and records the median warm-start time. Document the numbers in this phase doc's `What Shipped` section when 3.4 lands.
- cache is shipped only if the measured median warm-start detection time exceeds **200 ms**, per the threshold in Scope In, **and** the invalidation/input-fingerprint story is proven against the detector's real inputs

Required docs checks:

- roadmap and handoff reflect Phase 3.4 sitting between 3.3 and 4
- Phase 4 doc's prerequisite list gets 3.4 added once 3.4 lands

## Done When

- `profile.pathAliases` values are absolute filesystem paths, not raw target strings
- `profile.srcRoot` is framework-correct: Next.js only uses `root/src` when the routing roots live there, while non-Next projects still use `root/src` when that is the real source root
- `profile.entryPoints` includes `next.config.*` and middleware/proxy files for Next.js projects without changing the field away from file-like relative paths
- smoke suite has assertions covering all three behaviors and still passes end-to-end
- a latency measurement has been recorded against a real project target, documented in this doc's `What Shipped` section
- either (a) the profile cache is shipped with a verified end-to-end hit + miss path, or (b) the measurement is below threshold and the cache is explicitly deferred to a later pass — this phase doc records which path was taken and why
- Phase 4 can begin with an honest profile contract and stable detection timings

## Risks And Watchouts

- **Scope creep is the biggest risk.** The phase is explicitly narrow. Resist the temptation to also port `appDir`, `authProvider`, runtime detection, or "just a quick fix" to some other profile concern. If another gap surfaces mid-work, note it in this doc and let it wait for a later pass.
- **Path alias normalization is finicky.** Trailing `/*`, `./` prefixes, Windows path separators, and the `baseUrl: "./src"` edge case all need to produce consistent output. Match Fenrir's approach line-for-line where possible; it was tuned on real projects.
- **`entryPoints` already has consumers.** `mako-ai` uses it today as a list of file paths when tagging files as entry points. Do not port Fenrir's `app/` / `pages/` directory markers literally into this field without also changing every consumer — that is out of scope for 3.4.
- **Cache invalidation is easy to get wrong.** If the cache ships, the invalidation source set must be exhaustive for the inputs `detectProjectProfile` actually reads. Missing `jsconfig.json`, `next.config.js`, or a newly-added top-level `proxy.ts` would mean stale profile data. Add a test that edits each tracked input and confirms the cache busts.
- **Do not bake unresolved `pathAliases` into Phase 4 logs.** If 3.4 slips past Phase 4's start, the append-only fact tables will start recording the old unresolved alias shape, and later consumers will have a mixed history. This is why the phase sequences before Phase 4 rather than after.
- **Latency-gated scope is a commitment.** If the measurement lands between 200 and 500 ms, the review decision is a real decision — don't default to "ship it" or "skip it" without writing down why.

## References

- [../roadmap.md](../roadmap.md)
- [../handoff.md](../handoff.md)
- [./phase-3.3-project-profile-depth.md](./phase-3.3-project-profile-depth.md)
- [./phase-3.2.1-cli-publishing.md](./phase-3.2.1-cli-publishing.md)
- [./phase-4-logging-and-evaluation-backbone.md](./phase-4-logging-and-evaluation-backbone.md)
- Fenrir source references: `fenrir/src/fenrir/project_profile/detector.py` — `detect_src_root`, `detect_path_aliases` (baseUrl + paths resolution), `detect_entry_points` (app/pages + next.config + middleware), `get_profile` + `_compute_source_mtimes` + `invalidate_profile` (cache invalidation pattern)
