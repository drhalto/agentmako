# Roadmap Version 7 Phases

These are the phase specs for the Roadmap 7 generated-artifact build.

Read in this order:

1. [phase-7.0-artifact-contract-and-basis-model.md](./phase-7.0-artifact-contract-and-basis-model.md)
2. [phase-7.1-task-preflight-and-implementation-handoff-artifacts.md](./phase-7.1-task-preflight-and-implementation-handoff-artifacts.md)
3. [phase-7.2-review-verification-and-change-management-artifacts.md](./phase-7.2-review-verification-and-change-management-artifacts.md)
4. [phase-7.3-harness-cli-and-external-agent-integration.md](./phase-7.3-harness-cli-and-external-agent-integration.md)
5. [phase-7.4-optional-workflow-integrations-and-export-surfaces.md](./phase-7.4-optional-workflow-integrations-and-export-surfaces.md)
6. [phase-7.4.1-forgebench-validation-and-regression-cleanup.md](./phase-7.4.1-forgebench-validation-and-regression-cleanup.md)
7. [phase-7.5-usefulness-evaluation-and-default-exposure.md](./phase-7.5-usefulness-evaluation-and-default-exposure.md)
8. [phase-7.6-code-intel-tool-surface-expansion.md](./phase-7.6-code-intel-tool-surface-expansion.md)

Current state:

- `7.0` is shipped
- `7.1` is shipped
- `7.2` is shipped
- `7.3` is shipped
- `7.4` is shipped (file export only; editor / CI / hooks deferred)
- `7.4.1` is shipped (forgebench validation + regression cleanup;
  not a new-feature phase)
- `7.5` is shipped (usefulness evaluation + default exposure; Roadmap 7 complete)
- `7.6` is shipped (code-intel tool surface expansion — post-7.5 narrow extension;
  `ast_find_pattern`, `lint_files`, `repo_map` on the shared tool plane)
- the roadmap file defines the canonical Roadmap 7 contract
- each phase file narrows one implementation slice

Rule:

- no phase should recreate Roadmap 5 or 6 under a new artifact label
- new generated artifacts should compose the shipped substrate before adding new
  automation or persistence
