# Reef Engine Roadmap

**Status:** Reef 1 through Reef 10 shipped on main; DB-native Reef fact
refresh and database review comment follow-ups shipped.

**Upstream Baseline:** Initial Testing Phases 1-6 shipped, Roadmap CC
complete, Roadmap 8.1 telemetry shipped and paused for accumulated
usage.

**Repository Status (2026-04-25):** Reef Engine phases 1 through 10 are
merged into `main`. The Studio/Tauri/MSIX implementation is
intentionally not part of this merge; it remains parked on `reef/studio`
as an optional desktop packaging track.

**Primary Goal:** turn Mako from a collection of useful MCP tools into a
live, explainable project-state engine that existing tools query. The
engine should know the active state of the repo, staged changes, indexed
facts, derived findings, and recent tool/agent signals without forcing
the coding agent to rediscover those calculations on every turn.

## Purpose

This folder is the canonical roadmap package for the Reef Engine track.

Reef Engine is the answer to the product idea:

> If Mako already calculates routes, symbols, schema usage, lint-like
> risks, freshness, acks, telemetry, and context packets, can those
> calculations live in one active engine instead of scattered tool
> implementations?

The target architecture is:

```text
repo events
agent feedback / finding acks / diagnostic runs
  -> parsers and adapters
  -> typed fact sources
  -> source-grounded facts
  -> derived graph and findings
  -> MCP / CLI / harness tool views
```

Mako tools remain the user-facing surface. Reef becomes the project
state substrate under them.

The DB-native follow-up adds `db_reef_refresh`, which turns Mako's
existing schema snapshot/read model into indexed Reef facts for schemas,
tables, columns, indexes, foreign keys, RLS policies, triggers, enums,
RPCs, RPC-to-table references, and indexed schema usages. It uses the
existing schema indexes as source material and replaces facts by source,
so removed tables or indexes do not survive as stale Reef state.

The database review follow-up adds `db_review_comment` and
`db_review_comments`, a local append-only review ledger for database
objects and database topics. Agents can leave short notes on tables,
columns, policies, triggers, publications, subscriptions, replication
slots, or broader topics such as Supabase replication. These comments are
stored in Mako's project SQLite database, never written back to the live
database, and surfaced by `reef_scout` when relevant queries match them.

The next tooling track extends Reef from "Mako knows facts and findings"
to "Mako knows how the agent should interact with those facts." Reef 7
through Reef 10 add model-facing scout/inspect views, open-loop and
verification state, project convention memory, and evidence confidence /
contradiction tracking.

## What Reef Should Know

Reef should eventually maintain queryable state for:

- files, mtimes, sizes, hashes, and index freshness
- working-tree and staged overlays
- imports, exports, symbols, routes, handlers, middleware, and runtime
  boundaries
- schema objects, RPCs, table usage, migration objects, and generated
  Supabase types
- database review comments on schema objects, replication topics, and
  other DB review subjects
- lint, typecheck, security, auth, boundary, and rule-pack findings
- finding acknowledgements and false-positive suppressions
- context packet candidates, risks, scoped instructions, and harness
  handoff hints
- prior tool runs, agent feedback, runtime usefulness telemetry, and
  useful historical signals
- embeddings and semantic units later, as accelerators over facts rather
  than replacements for facts

## Hard Boundaries

- Reef is a fact and calculation engine, not an autonomous repair agent.
- Deterministic facts come first. ML, embeddings, and GPU work are later
  accelerators, never the first source of truth.
- TypeScript remains the control plane unless profiling proves a hot loop
  needs Rust, Go, or another compiled component.
- Python is acceptable for ML experiments, not for core repo-state
  orchestration.
- GPU support is optional and should target embeddings/reranking, not
  deterministic lint or graph correctness.
- The current MCP tools must keep working while Reef is introduced.
- SQLite remains the durable local store for canonical facts. Process
  caches are accelerators and must be rebuildable.
- All reads and writes stay project-root scoped.
- Invalidation correctness beats raw speed.

## Package Contents

- [roadmap.md](./roadmap.md) - canonical roadmap contract and phase
  sequence
- [handoff.md](./handoff.md) - execution assumptions and working rules
- [ReefPublicAPI.md](./ReefPublicAPI.md) - current public contract and
  tool surface
- [ReefPerformanceReport.md](./ReefPerformanceReport.md) - Reef 6
  measurements and keep-TypeScript decision
- [FindingAckContract.md](./FindingAckContract.md) - ack ledger
  compatibility rules
- [RuleDescriptorSpec.md](./RuleDescriptorSpec.md) - public rule
  descriptor shape and naming
- [phases/README.md](./phases/README.md) - phase index

## Names

- **Fact:** a source-grounded observation such as "file X imports Y" or
  "route Z has no detected auth guard."
- **Fact source:** a stable namespace for the producer, such as
  `reef_rule:auth.unprotected_route`, `eslint:no-unused-vars`,
  `typescript:TS2322`, or `git_precommit_check:boundary`.
- **Fact subject:** a typed discriminator for what the fact is about:
  file, symbol, route, schema object, import edge, diagnostic, or another
  explicit subject shape.
- **Derived fact:** a calculation over facts, such as route dependency
  neighborhood or boundary classification.
- **Finding:** an actionable issue/risk with fingerprint, source,
  severity, status, and ack state.
- **Overlay:** a view of project state: indexed, live working tree,
  staged, or agent-edit preview.
- **Calculation node:** a recomputable unit with declared dependencies
  and invalidation rules.
- **Tool view:** an MCP/CLI result built by querying Reef state instead
  of recomputing independently.
- **Scout view:** a model-facing tool view that answers a vague task
  with ranked files, subjects, findings, reasons, and next tool hints.
- **Open loop:** source-grounded work state that remains unresolved,
  unverified, contradicted, stale, or intentionally acknowledged.
- **Convention fact:** durable project-specific knowledge such as auth
  guards, public routes, generated paths, or server/client boundaries.
- **Evidence conflict:** a recorded contradiction between sources, such
  as indexed AST evidence disagreeing with live disk.
- **Database review comment:** an append-only local note attached to a
  database object or database topic, used for review memory and agent
  handoff without mutating the live database.

## First Slice Bias

The first implementation should be boring and useful:

1. define typed fact subjects, source namespaces, and rule contracts
2. persist normalized findings
3. ingest existing lint/type/precommit outputs
4. expose active findings by file/project
5. add overlays for staged and working-tree state

That gets Mako closer to "it already knows what is wrong right now"
without pretending to be an IDE, language server, or autonomous agent.

## Next Tooling Bias

The next Reef track should improve how agents consume Reef, not add a
second engine:

1. expose scout and inspect views before adding more raw fact surfaces
2. track open loops and verification gaps as first-class work state
3. discover project conventions deterministically before ML
4. label confidence and contradictions consistently across tools
5. keep LLM-assisted analysis as a later proposal/summary layer, never
   as the source of truth

## Contract Guardrails

- Facts are current-state rows, not append-only history. Recomputes
  replace facts for the same project/source/kind/subject/overlay.
- `finding_acks` remains the ack ledger. Reef finding status is derived
  from that table rather than becoming a second ack source of truth.
  Future ack reversal or snooze semantics append new ledger rows; they do
  not delete or mutate prior acknowledgements.
- String content used in fingerprints is Unicode NFC-normalized before
  hashing.
- `preview` overlay is reserved for later and must stay in-memory until
  a later phase defines persistence and safety rules.
- The Initial Testing Phase 4 watcher is absorbed in Reef 4; Reef does
  not add a second watcher over the same project root.
- Roadmap 8.1 remains the owner of general usefulness telemetry. Reef
  only promotes agent feedback into findings when it names a concrete
  project subject and claim.
- Mako Studio is a consumer of Reef contracts. It may display facts,
  findings, rules, overlays, and ack state, but Reef remains the source
  of truth for calculation and `finding_acks` remains the ack write path.
