# Reef 10 Evidence Confidence And Contradictions

Status: `Shipped`

## Goal

Make Reef explicit about evidence quality. Facts should not only be
fresh or stale; they should carry confidence, decay, and contradiction
signals so tools can avoid stale phantom matches and tell agents when to
verify.

## Problem

Different sources have different trust profiles:

- live text search is current but shallow
- indexed AST facts are precise but can become stale
- embeddings are useful but fuzzy
- external diagnostics are authoritative only for the files/config they
  actually ran against
- old agent feedback is useful history but not current repo truth

Agents need this distinction surfaced in every important view.

## Confidence Model

Add a lightweight deterministic confidence model over evidence:

- source reliability
- freshness state
- overlay match
- dependency invalidation
- age since capture
- contradiction count
- ack/suppression history

Confidence is a heuristic score and label, not a calibrated
probability.

Suggested labels:

- `verified_live`
- `fresh_indexed`
- `stale_indexed`
- `fuzzy_semantic`
- `historical`
- `contradicted`
- `unknown`

## Contradiction Ledger

Reef should store contradictions between evidence sources:

```text
ast_index says pattern exists at file:line
live_text_search says file no longer has that match
=> evidence_conflict:index_vs_live
```

Other examples:

- diagnostic finding references a deleted file
- route fact points to a missing handler
- schema usage mentions a table removed from latest snapshot
- context packet candidate is marked fresh but underlying file mtime is
  newer than indexed mtime

Contradictions should become open loops in Reef 8 terms.

## Tooling Shape

Candidate surfaces:

- `evidence_conflicts`
- `evidence_confidence`
- `project_index_status` confidence summary
- `context_packet` confidence labels per candidate
- `ast_find_pattern` and search tools report confidence/freshness
  decisions consistently

## Done When

- `context_packet`, `ast_find_pattern`, and indexed search views expose
  confidence labels consistently.
- Reef records an index-vs-live contradiction instead of merely warning.
- a smoke reproduces a stale indexed match and proves the conflict is
  recorded, surfaced, and cleared after refresh.
- confidence labels degrade when files/dependencies change and recover
  after successful recomputation.
- docs state that confidence is heuristic, not probability.

## Shipped Implementation Notes

- `evidence_confidence` labels facts and findings as
  `verified_live`, `fresh_indexed`, `stale_indexed`,
  `fuzzy_semantic`, `historical`, `contradicted`, or `unknown`.
- `evidence_conflicts` surfaces explicit conflict facts, findings whose
  source/message signal incorrect or contradictory evidence, and stale
  indexed facts as `stale_indexed_evidence` conflicts.
- `context_packet` candidate metadata includes
  `evidenceConfidenceLabel` for working-tree, indexed, and convention
  candidates.
- The contradiction ledger is represented by normal Reef facts/findings
  instead of a second table; sources such as
  `agent_feedback:incorrect_evidence` can create durable
  `evidence_conflict` facts.
- `test/smoke/reef-model-facing-views.ts` reproduces stale indexed
  evidence, explicit phantom-line conflict evidence, and confidence
  labels across verified live, stale indexed, and contradicted evidence.
