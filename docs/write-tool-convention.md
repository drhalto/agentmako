# Write Tool Convention

Most Mako tools are read-only. Tools that mutate Mako local state use
`annotations.mutation === true` and must have an explicit operational metadata
row in `packages/tools/src/tool-operational-metadata.ts`.

## Preview Rule

Write tools use one of these `previewDecision` values:

- `required`: default to preview; callers must pass `preview: false` to apply.
- `useful`: default to preview when the write records a durable user-visible
  decision.
- `skip`: preview would add friction without meaningful safety.

Preview responses use the same pattern:

```json
{
  "preview": true,
  "wouldApply": { "...": "..." },
  "_hints": ["Preview only. Run again with preview=false to apply."]
}
```

## Current Decisions

- `finding_ack_batch`: preview required. Batch acknowledgements may suppress
  many future findings.
- `finding_ack`: preview useful. One acknowledgement suppresses future findings
  for a reviewed fingerprint.
- `db_review_comment`: preview useful. The note is durable and user-visible.
- `agent_feedback`: preview skipped. It is a low-risk append-only usefulness
  event.
- Diagnostic tools, `diagnostic_refresh`, `db_reef_refresh`,
  `project_index_refresh`, and `working_tree_overlay`: preview skipped because
  the explicit operation is to refresh or snapshot Mako local state.

## Checks

`test/smoke/finding-acks-tools.ts` verifies the preview/apply behavior for
finding acknowledgements.

`test/smoke/tool-operational-metadata.ts` verifies the mutation inventory and
preview decisions remain complete.
