# Phase 6.3 Tenant Leak Audit And Auth Operators

Status: `Complete`

## Goal

Turn the existing auth, query, schema, and RLS substrate into operator-grade
audits.

Primary target:

- `tenant_leak_audit`

## Current Shipped Slice

- `tenant_leak_audit` is shipped as an advisory / opt-in operator tool
- the current opt-in is enforced by explicit caller acknowledgement, not only
  by a result label
- first-slice protected surfaces:
  - tenant-keyed tables
  - RPCs that touch those tables
  - indexed route/file RPC usage sites where evidence exists
- direct findings stay intentionally narrow:
  - tenant-keyed table with RLS disabled
  - tenant-keyed table with RLS enabled but no policies
- policy / RPC / usage gaps without tenant signals stay `weak_signal`
- reviewed-safe surfaces are emitted separately as `not_a_leak`, not folded into
  findings
- the current shipped slice now carries one advisory follow-on packet hint:
  - direct findings -> `workflow_packet` family `implementation_brief`
  - weak-only findings -> `workflow_packet` family `verification_plan`
  - reviewed-safe / empty results -> no hint
- audit results carry basis provenance:
  - latest index run id
  - schema snapshot id
  - schema fingerprint

## Rules

- use current auth/query/schema evidence first
- keep every reported gap tied to concrete evidence
- prefer a small number of operator workflows over many micro-audits
- define the tenant-boundary model before implementation
- classify findings as:
  - direct evidence
  - weak signal
  - not-a-leak / out-of-scope

## Audit Model

The first shipped slice should pin all of these explicitly:

- protected surface kinds:
  - routes
  - RPCs
  - tables with tenant-keyed data
- tenant-principal evidence patterns:
  - tenant or workspace ids
  - organization/account scoping claims
  - explicit auth context reads
- protection evidence patterns:
  - RLS and policies
  - explicit route / RPC auth checks
  - query predicates that scope by tenant principal

The workflow should distinguish:

- missing protection with direct evidence
- unclear protection that needs operator review
- normal auth variance that should not be labeled a tenant leak

## Gating And Rollout

This phase is high-risk and should ship with explicit guardrails:

- confidence floor:
  - never emit a finding without at least one pinned evidence ref
- operator posture:
  - findings are advisory only
  - nothing in this phase auto-applies or mutates project state
- rollout:
  - first shipped slice should be opt-in or dark by default
  - the current shipped slice requires explicit advisory acknowledgement per
    call
  - promote broader/default exposure only after calibration on real or
    realistic fixtures
- false-positive discipline:
  - weak-signal findings should be calibrated against a documented target
    before promotion
  - if that target is not met, keep the workflow opt-in

## Non-Goals

- no project-shaped “security score”
- no generic warning list that cannot be acted on
- no leak claim without pinned tenant-boundary evidence

## Success Criteria

- one call can surface likely tenant scoping / RLS gaps across the project
- the result is specific enough to act on, not just a generic warning list
- operator output makes the direct-vs-weak evidence boundary visible
- the shipped slice stays advisory and earns any broader exposure with
  calibration, not assumption
- smoke coverage proves:
  - one direct table finding
  - weak RPC and route/file findings
  - one reviewed-safe tenant-keyed table

## First-Slice Limits

- tenant-keyed table detection is still single-foreign-key first:
  - it uses the configured `tenantForeignKey` when present
  - otherwise it falls back to generic tenant/workspace/org/account tokens
- tenant-signal matching is token-based:
  - it strips SQL comments and uses word-boundary matching
  - it now also recognizes a small set of common tenant-context helper
    patterns such as:
    - `current_tenant()`
    - `auth.jwt()`
    - `current_setting('...tenant...')`
  - it can still miss project-specific function-indirected checks that do not
    match those common patterns
- RPC body inspection is SQL-migration-body only in the first slice
- follow-on packet hints are advisory only:
  - the operator result stays separate from packet attachment and promotion
  - no packet is auto-attached by this workflow
