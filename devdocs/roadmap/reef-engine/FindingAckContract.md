# Reef Finding Ack Contract

Status: `Shipped`

Reef reuses the existing `finding_acks` table as the only durable ack
write target.

## Write Path

Acknowledgements are still written through:

- `finding_ack`
- future batch ack tools that append to the same ledger

No Reef tool should mutate a finding into `acknowledged` directly.

## Read Path

`project_findings`, `file_findings`, and `ProjectStore.queryReefFindings`
derive `status: "acknowledged"` when a stored active finding has a
matching `(projectId, fingerprint)` row in `finding_acks`.

That means:

- an acknowledged active row is not returned by `status: "active"`
- the same row is returned by `status: "acknowledged"`
- resolved findings remain resolved, even if an old ack exists

## Fingerprints

Reef fingerprints use canonical JSON hashing with Unicode NFC
normalization. Producer-specific rules:

- `git_precommit_check`: source, rule ID, diagnostic subject
  fingerprint, normalized message, and evidence strings
- Reef rules: source, rule ID, typed subject fingerprint, message, and
  evidence fingerprints
- External adapters later keep their native stable identity where one
  exists, then normalize it into the same finding fingerprint field

Consumers should ack the `ProjectFinding.fingerprint` returned by
`project_findings` or `file_findings`.

## Ledger Ownership

Studio may write acknowledgements through `finding_ack`. Studio must not
write `reef_findings.status = "acknowledged"` or maintain a parallel
ack store.
