# Reef 1 Fact Model And Active Findings Store

Status: `Shipped`

## Goal

Create the durable substrate for Reef: typed facts, fact freshness,
overlays, and active findings. This phase should make Mako able to answer
"what findings do we already know about this project or file?" without
rerunning every analyzer.

## Scope

- contracts for project facts, derived facts, findings, provenance,
  typed subjects, source namespaces, overlays, rules, public rule
  descriptors, calculation dependencies, and freshness
- store migrations and query helpers
- finding lifecycle: active, resolved, acknowledged, suppressed, with a
  pinned trigger rule for active → resolved
- fingerprint compatibility with existing `finding_ack`
- initial Mako-originated finding source from `git_precommit_check`
- read tools for project/file findings, plus a `list_reef_rules` tool
  stub so consumers (Studio 6, future CLI) can discover rules from day
  one even before user-defined rules ship
- a shared test-fixture helper that Reef and Studio smokes both consume

## Out Of Scope

- filesystem watcher
- native engine
- ML or embeddings
- broad lint/type command orchestration
- public schema changes to existing tools unless additive metadata is
  required

## Contract Sketch

```ts
type ProjectOverlay = "indexed" | "working_tree" | "staged" | "preview";

type FactSubject =
  | { kind: "file"; path: string }
  | { kind: "symbol"; path: string; symbolName: string; line?: number }
  | { kind: "route"; routeKey: string }
  | { kind: "schema_object"; schemaName: string; objectName: string }
  | { kind: "import_edge"; sourcePath: string; targetPath: string }
  | { kind: "diagnostic"; path: string; ruleId?: string; code?: string };

type ReefCalculationDependency =
  | { kind: "file"; path: string }
  | { kind: "glob"; pattern: string }
  | { kind: "fact_kind"; factKind: string }
  | { kind: "config"; path: string };

type ProjectFact = {
  projectId: string;
  kind: string;
  subject: FactSubject;
  subjectFingerprint: string;
  overlay: ProjectOverlay;
  source: string;
  confidence: number;
  fingerprint: string;
  freshness: FactFreshness;
  provenance: FactProvenance;
};

type ProjectFinding = {
  projectId: string;
  fingerprint: string;
  source: string;
  severity: "info" | "warning" | "error";
  status: "active" | "resolved" | "acknowledged" | "suppressed";
  filePath?: string;
  line?: number;
  ruleId?: string;
  documentationUrl?: string;
  suggestedFix?: { kind: "edit" | "manual"; description: string };
  evidenceRefs?: string[];
  freshness: FactFreshness;
  capturedAt: string;
  message: string;
  factFingerprints: string[];
};

interface ReefRule {
  id: string;
  source: `reef_rule:${string}`;
  severity: "info" | "warning" | "error";
  dependsOnFactKinds: string[];
  detect(input: {
    facts: ProjectFact[];
    overlay: ProjectOverlay;
    projectId: string;
  }): ProjectFinding[];
}

// Public, data-only mirror of ReefRule. Studio 6 and any future CLI
// rule browser consume this; they never import ReefRule directly because
// detect() is a server-only function.
//
// Reference: ESLint exposes executable rules separately from rule metadata
// (`meta.docs`, fixability, schema, etc.). Reef follows that split: Studio
// gets descriptors and sanitized docs, never executable rule modules.
interface ReefRuleDescriptor {
  id: string;
  version: string;
  source: string;
  sourceNamespace: string;
  type: "problem" | "suggestion" | "overlay";
  severity: "info" | "warning" | "error";
  title: string;
  description: string;
  docs?: { body: string };
  documentationUrl?: string;
  factKinds: string[];
  dependsOnFactKinds?: string[];
  fixable?: boolean;
  tags?: string[];
  enabledByDefault: boolean;
}
```

## Lifecycle Rules

- Facts are replace-not-append rows keyed by
  `{ projectId, overlay, source, kind, subjectFingerprint }`.
- Findings keep durable lifecycle state, but acknowledgement state is
  derived from the existing `finding_acks` table.
- New ack writes still go through `finding_acks`; Reef does not create a
  second ack ledger.
- Future ack reversal, snooze, or expiration semantics append new
  `finding_acks` rows/categories. Reef never deletes or mutates prior ack
  rows to change finding state.
- Fingerprints must use canonical JSON hashing with Unicode NFC
  normalization for message/snippet text.
- `preview` overlay is contract-reserved and in-memory only until a
  later phase defines persistence rules.
- **Active → resolved trigger.** A finding flips `active → resolved`
  when the next index run that scopes the same `(source, subjectFingerprint)`
  produces no matching fingerprint. The flip updates the existing finding
  row's `status` in place; it does not create a new row. The run that
  resolved it is recorded via `lifecycleEvents`. This rule is automatic
  and does not require a write from Studio or the CLI; downstream
  consumers (Studio 3) treat resolved as read-only.
- **Reef does not absorb Roadmap 8.1 telemetry as findings.** Agent
  feedback events (`mako_usefulness_events`) remain a Roadmap 8 concern.
  Reef may *consume* telemetry signals later as evidence for its own
  rules, but the current contract has no `source: "agent_feedback"`
  finding kind.

## Fingerprint Rules

- AST/search-like findings keep the existing match fingerprint:
  normalized path, range, and match text.
- ESLint findings use source, rule ID, file path, range, and normalized
  message fingerprint.
- TypeScript findings use source, TS code, file path, range, and
  normalized message fingerprint.
- `git_precommit_check` findings use source, check ID, file path,
  subject fingerprint, and normalized message fingerprint.
- Reef rule findings use source, rule ID, subject fingerprint, and
  evidence fingerprints.

## Test Fixture Helper

Reef ships a shared test-fixture helper alongside the contracts. Both
Reef smokes and Studio smokes (Studio 2, Studio 3, Studio 6) consume it
so fixture drift cannot cause cross-roadmap parity bugs.

The helper lives at `test/fixtures/reef/` (or a similar workspace-root
location) and exposes:

```ts
export interface SeedReefProjectInput {
  projectRoot: string;
  facts?: ProjectFact[];
  findings?: ProjectFinding[];
  rules?: ReefRuleDescriptor[];
  overlay?: ProjectOverlay;
}

export interface SeededReefProject {
  projectId: string;
  cleanup(): Promise<void>;
}

export async function seedReefProject(
  input: SeedReefProjectInput,
): Promise<SeededReefProject>;
```

Reference precedent: Continue's `extensions/cli/src/test-helpers/`
exposes a `setupMockLLMTest` / `cleanupMockLLMServer` pair with the same
"async setup returning cleanup" shape. Reef adopts that pattern so smoke
authors can call `await seedReefProject({ ... })` and trust deterministic
teardown.

## Tools

`list_reef_rules` ships in this phase even though no operator-facing
rules exist yet, so Studio 6 and future CLI surfaces can discover the
empty-but-valid contract from day one.

```ts
interface ListReefRulesToolOutput {
  toolName: "list_reef_rules";
  projectId: string;
  rules: ReefRuleDescriptor[];
  sources: string[];
  warnings: string[];
}
```

`project_findings` and `file_findings` consume the same fingerprint
discipline as `finding_ack` so existing acks keep filtering the migrated
finding rows.

## Done When

- contracts are exported from `@mako-ai/contracts`, including
  `ReefRuleDescriptor`
- `ReefPublicAPI.md`, `FindingAckContract.md`, and
  `RuleDescriptorSpec.md` exist with examples and migration guarantees
- store tables and accessors exist
- migrations are numbered, recorded in the existing project-store
  migration versioning path, and covered by forward/rollback smoke tests
- fact replacement does not grow rows unbounded for repeated recomputes
- `git_precommit_check` can write normalized findings
- `project_findings` and `file_findings` expose active findings
- `list_reef_rules` returns an empty-but-valid descriptor list when no
  rules are registered, and the same descriptor list when rules are
  registered later
- `finding_ack` suppresses or labels matching findings through the same
  fingerprint discipline
- rule contract, public descriptor contract, and calculation dependency
  contract exist even if the runtime dependency engine lands in Reef 4
- active → resolved transition is deterministic against the fixture
  helper: edit the fixture, rerun the index, verify the finding flips
- the shared `seedReefProject` fixture helper is callable from both Reef
  smokes and a Studio smoke (proven by an inert Studio test that does
  nothing but call the helper, not yet wired to UI)
- active findings query has a measured baseline against the chosen
  fixture
- database size after one full fixture ingest is recorded, with a target
  ceiling chosen for later phases
- smoke covers active -> resolved -> acknowledged lifecycle
- roadmap handoff current status is updated

## Shipped Notes - 2026-04-25

Completed:

- `@mako-ai/contracts` exports Reef facts, typed subjects, overlays,
  findings, rule descriptors, calculation dependencies, and tool schemas
  for `project_findings`, `file_findings`, and `list_reef_rules`.
- `ProjectStore` has Reef migrations and helpers for fact replacement,
  finding source replacement/resolution, derived ack status, and rule
  descriptor persistence.
- `project_findings`, `file_findings`, and `list_reef_rules` are
  registered read-only MCP tools and are allowed inside `tool_batch`.
- `git_precommit_check` writes `staged` overlay Reef findings and rule
  descriptors.
- `test/fixtures/reef/seedReefProject` is shared by Reef and Studio
  smoke coverage.
- `test/smoke/reef-migration-baseline.ts` covers migration 30 presence,
  idempotent reopen, failed-migration rollback behavior, active findings
  query timing, and database-size baseline.

Baseline fixture:

- 500 active findings across 50 files
- project active findings p95: 6.65 ms
- one-file active findings p95: 0.31 ms
- project DB size after checkpoint: 1,572,864 bytes

Next producer/adaptor expansion belongs to Reef 2.
