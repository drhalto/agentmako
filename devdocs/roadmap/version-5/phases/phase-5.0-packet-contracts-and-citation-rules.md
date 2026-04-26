# Phase 5.0 Packet Contracts And Citation Rules

Status: `Complete`

## Purpose

Establish the shared packet contract layer on top of the shipped workflow-context bridge.

This phase exists so later packet families do not invent different shapes for:

- summaries
- citations
- risks
- assumptions
- verification sections
- packet metadata

## Phase Outcome

By the end of `5.0`, the repo should have:

- a discriminated-union workflow-packet contract
- one shared packet envelope used by every family
- a packet generator/registry seam
- shared citation/reference rules
- shared compact-section rules for packet sections and rendering
- packet-family evaluation expectations

## Required Inputs

- `WorkflowContextBundle`
- `WorkflowPacketRequest`
- `WorkflowPacketInput`
- existing trust/diagnostic/comparison item kinds

## Workstreams

### A. Packet Contracts

Define the shared packet-family union and per-family payload contracts.

Every packet should carry one stable envelope with:

- packet id
- packet family
- input scope / generation basis
- typed section payloads
- citations
- open questions
- assumptions

Every packet family should then carry the minimum family-specific payload needed
to be decision-complete, not just descriptive.

Every packet should expose compact sections such as:

- summary
- key findings or change areas
- verification or done criteria where relevant
- risks
- assumptions
- open questions

### B. Citation Rules

Lock how packets cite:

- files
- symbols
- routes
- RPCs
- tables
- diagnostics
- trust state
- comparison artifacts

Packets should cite typed ids and selected excerpts, not raw markdown strings.

Packets should cite only items that are part of the current
`WorkflowPacketInput.selectedItems` scope.

Every citation should be able to say:

- which `WorkflowContextItem` it refers to
- which excerpt / subrange / supporting detail is being cited
- why that item is relevant to the claim being made

No packet should rely on prose-only references that a later consumer must parse.

### C. Packet Generator Contract

Define the shared generator seam:

- input: `WorkflowPacketInput`
- output: typed packet

No generator should need access to raw `AnswerResult`.

Do not add public packet-generation APIs without at least one real packet family
and consumer callsite that needs them.

### D. Packet Rendering Rules

Define a compact rendering policy so packet text stays useful and consistent with
the typed section model:

- short summary
- key sections only
- minimal prose bloat
- no giant “AI report” bodies

## Verification

- packet contracts typecheck cleanly
- one smoke proves at least one family can be rendered from a typed packet without custom formatting hacks
- one smoke proves citations are machine-readable and stable
- citations remain stable across repeated generation on the same input

## Shipped In This Slice

The shared `5.0` seam is now landed:

- packet contracts in `packages/contracts/src/workflow-packets.ts`
- matching schemas in `packages/contracts/src/tools.ts`
- shared runtime seam in `packages/tools/src/workflow-packets/index.ts`
- focused smoke in `test/smoke/workflow-packets.ts`

The shipped layer includes:

- one shared packet envelope
- typed packet-family union
- typed citation / section / entry contracts
- stable packet / citation / section / entry id helpers
- one packet registry and one generic packet formatter

## Non-Goals

- no packet-family-specific generation logic yet
- no watch mode yet
- no automation wrappers

## Exit State

Later phases can add packet families without debating packet shape every time.
