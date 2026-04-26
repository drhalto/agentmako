# Reef 6 Performance Boundary And Native Engine Decision

Status: `Shipped`

## Goal

Decide, with measurements, whether Reef needs a native performance
component. Do not choose Rust, Go, WASM, Python, or GPU work before the
TypeScript engine has real load and profiling data.

## Scope

- profiling fixtures for large repos and edit bursts
- query timing for active findings, context packets, route/schema views,
  and staged checks
- hot-loop identification
- optional prototype for one native boundary if justified
- written keep-TypeScript vs native decision

## Decision Criteria

A native component is justified only if:

- the bottleneck is CPU-bound and isolated
- SQLite/query shape and invalidation have already been optimized
- TypeScript implementation is correct and tested
- the native input/output boundary is small
- install/build complexity is acceptable for Mako users

Escalate only when at least one measured threshold is crossed:

- any single Reef query over the 5k-file fixture consumes more than
  100 ms p95 after query/index tuning
- one-file active findings query exceeds 30 ms p95 cached or 200 ms p95
  cold
- Reef-backed `context_packet` exceeds 1500 ms p95 cold
- edit -> changed-file fact replacement exceeds 500 ms p95

## Likely Native Candidates

- graph traversal over large fact sets
- tokenization or lexical scanning
- diff/fingerprint calculation
- compact hot index construction

## Parked

- GPU-required linting
- Python in the core live path
- full Rust rewrite
- native-first daemon
- model-hosted analysis

## Shipped Decision

See [../ReefPerformanceReport.md](../ReefPerformanceReport.md).

Reef 6 ships the TypeScript-only decision. The 5k indexed-file
performance smoke stayed below every escalation threshold:

- project active findings query p95: `58.82 ms` (`< 500 ms`)
- one-file active findings query p95: `0.54 ms` (`< 30 ms`)
- cold Reef-backed `context_packet` p95: `240.38 ms` (`< 1500 ms`)
- edit -> changed-file fact replacement p95: `11.09 ms` (`< 500 ms`)

No native prototype shipped because no threshold was crossed. Rust,
Go, WASM, Python, and GPU work remain parked until a future fixture
identifies a small isolated CPU-bound loop that still exceeds budget
after TypeScript/query/invalidation tuning.

## Done When

- performance report is checked in: shipped
- keep-TypeScript or native-boundary decision is explicit: shipped,
  stay TypeScript-only
- decision cites the numeric thresholds above: shipped
- any native prototype is optional and covered by fallback tests: no
  prototype shipped because thresholds were not crossed
- package/install impact is documented: shipped, no new native package or
  install impact
- roadmap closeout names the next track, if any: shipped in the roadmap
  summary; Mako Studio consumes Reef next
