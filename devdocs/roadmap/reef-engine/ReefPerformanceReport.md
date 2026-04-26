# Reef Performance Report

Status: `Reef 6 shipped`

Measured on: `2026-04-25`

Fixture: `test/smoke/reef-performance-boundary.ts`

The fixture seeds one local project with:

- 5,000 indexed TypeScript file rows
- 5,000 active Reef findings
- one live changed file for working-tree overlay replacement
- cold `context_packet` calls with a fresh hot-index cache per measured
  call

## Thresholds

| Measurement | Threshold | Current Smoke Result |
| --- | ---: | ---: |
| Project active findings query p95 | `< 500 ms` | `58.82 ms` |
| One-file active findings query p95 | `< 30 ms` cached | `0.54 ms` |
| Reef-backed `context_packet` cold p95 | `< 1500 ms` | `240.38 ms` |
| Edit -> changed-file fact replacement p95 | `< 500 ms` | `11.09 ms` |

## Decision

Stay TypeScript-only for the Reef engine.

No measured threshold crossed the native-escalation line. The current
hot paths are still normal TypeScript control flow over SQLite-backed
queries and bounded file reads. Adding Rust, Go, WASM, Python, or a GPU
path now would add install/build complexity without evidence that a
small CPU-bound native boundary is needed.

## Native Boundary Status

No native prototype shipped in Reef 6.

The fallback is the current TypeScript implementation. Future native
work remains eligible only when a profiling fixture shows:

- a specific isolated CPU-bound loop
- query/invalidation tuning has already been tried
- the native input/output contract is small
- the package/install impact is acceptable for local-first users

Likely candidates remain graph traversal, tokenization, diff/fingerprint
calculation, or compact hot-index construction, but none are justified by
the Reef 6 numbers.
