# Phase 3.4.1 Tsconfig Alias Hotfix

Status: `Complete`

This file records the targeted hotfix that landed immediately after Phase 3.4 while Phase 3.5 moved forward in parallel.

Use [../roadmap.md](../roadmap.md) for roadmap order and status. Use this file for the concrete design and shipped result of Phase 3.4.1.

## Why This Hotfix Exists

Phase 3.4 correctly changed `ProjectProfile.pathAliases` from raw target strings to resolved absolute paths, but it still relied on a hand-rolled JSONC parser and only read aliases declared directly inside the leaf `tsconfig.json` / `jsconfig.json`.

That left one real correctness gap:

- aliases defined through `extends` chains were silently missed

That was worth fixing before later phases started treating the profile as a more durable substrate.

## What Shipped

- `services/indexer/src/project-profile.ts` now uses `get-tsconfig` instead of the hand-rolled JSONC parsing helpers.
- `detectPathAliases` now resolves aliases from extended TypeScript config chains instead of only from the leaf config file.
- `createPathsMatcher` is used to derive the same absolute-path alias contract while delegating JSONC parsing, `extends` resolution, and path matching to a dedicated package.
- the old custom helpers for comment stripping, trailing-comma stripping, and ad hoc JSONC object parsing were removed
- `services/indexer/package.json` now declares `get-tsconfig`
- `pnpm-lock.yaml` includes the new dependency
- `test/smoke/core-mvp.ts` now proves the real regression case:
  - `tsconfig.json` extends `tsconfig.base.json`
  - the alias lives only in the base config
  - `profile.pathAliases["@/"]` still resolves to the absolute `src/` path

## Scope

### In

- tsconfig/jsconfig parsing correctness
- `extends` chain support for alias resolution
- preserving the existing `ProjectProfile.pathAliases: Record<string, string>` contract

### Out

- CLI prompt refactors
- CLI argument-parser refactors
- logger swaps
- file-walker swaps
- any expansion of the project-profile contract beyond alias correctness

## Rules

- keep the public `pathAliases` shape the same
- keep the hotfix narrow and local to alias parsing
- do not reopen broader Phase 3.4 scope

## Verification

- `corepack pnpm typecheck`
- `corepack pnpm run test:smoke`

## Done When

- aliases defined only in an extended base config resolve correctly
- the hand-rolled JSONC parsing code is gone
- `ProjectProfile.pathAliases` still returns absolute filesystem paths
