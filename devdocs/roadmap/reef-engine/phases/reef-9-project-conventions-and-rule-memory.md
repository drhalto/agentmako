# Reef 9 Project Conventions And Rule Memory

Status: `Shipped`

## Goal

Make Reef learn project-specific conventions deterministically before
using ML. Reef should discover recurring local patterns, expose them as
reviewable convention facts, and use accepted conventions to improve
findings, context packets, and precommit checks.

## Problem

Every real project has local rules that generic tools do not know:

- auth guard names and public route exceptions
- tenant scoping helpers
- server-only and client-only module boundaries
- common RPC/table access patterns
- data-loading conventions
- generated files and framework-specific safe zones
- noisy findings that are usually false positives

Today these become one-off code or repeated agent instructions. Reef can
make them durable project knowledge.

## Convention Facts

Convention discovery should emit facts such as:

- `convention:auth_guard`
- `convention:public_route`
- `convention:tenant_scope_helper`
- `convention:server_only_module`
- `convention:client_only_module`
- `convention:generated_path`
- `convention:false_positive_pattern`

Each convention fact needs:

- evidence examples
- confidence
- source
- first seen / last seen
- accepted state: `candidate`, `accepted`, `rejected`

Candidate conventions are advisory only. They do not become enforcement
rules until accepted or validated by deterministic criteria.

## Rule Memory

Reef should track rule usefulness statistics:

- findings emitted
- findings acknowledged
- findings fixed/resolved
- findings contradicted
- findings that led to successful verification

This lets Mako distinguish high-value rules from noisy rules without
training a model.

## Tooling Shape

Candidate surfaces:

- `project_conventions`
- `convention_candidates`
- `rule_memory`
- `list_reef_rules` enriched with rule stats

Existing tools should consume accepted conventions:

- `git_precommit_check` for auth/boundary checks
- `context_packet` for risk hints and project-specific routing
- diagnostics tools for generated/noisy path handling

## LLM Boundary

A connected LLM may later propose convention candidates from examples,
but Reef must verify or mark them as candidate-only. The LLM must not
silently activate a convention or rule.

## Done When

- Reef can discover at least auth guard, public route, generated path,
  and server/client boundary convention candidates.
- accepted conventions affect at least one existing tool view.
- rejected conventions stop appearing as recommendations.
- rule descriptors expose basic usefulness stats.
- smoke coverage proves candidate -> accepted -> consumed behavior
  without an ML dependency.

## Shipped Implementation Notes

- `project_conventions` surfaces explicit `convention:*` Reef facts and
  rule-derived convention candidates for auth guards, runtime
  boundaries, generated paths, route patterns, and schema patterns.
- `rule_memory` aggregates rule descriptors plus finding history into
  total, active, acknowledged, resolved, and suppressed counts.
- `context_packet` consumes accepted convention facts as ranked
  `reef_convention` candidates, so conventions affect an existing model
  context surface without requiring ML.
- The first shipped convention state supports
  `candidate | accepted | deprecated | conflicting`; rejected/revoked
  lifecycle semantics remain an operator UX layer over convention facts.
- `test/smoke/reef-model-facing-views.ts` seeds an accepted auth-guard
  convention, proves `project_conventions` returns it, proves
  `context_packet` consumes it, and proves `rule_memory` counts an
  acknowledged Reef finding.
