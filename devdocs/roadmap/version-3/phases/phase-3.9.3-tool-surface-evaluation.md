# Phase 3.9.3 Tool Surface Evaluation

Status: `Complete` (shipped 2026-04-18)

This file is the canonical planning and ship doc for Roadmap 3 Phase 3.9.3. It follows Phase 3.9.2 and is the validation-and-hardening slice for the current Roadmap 3 tool surface. The detailed plan below is preserved as planning history; read `Shipped Outcome` and `Decision` first for the actual shipped state.

Use [../roadmap.md](../roadmap.md) for roadmap status and phase order. Use [../handoff.md](../handoff.md) for the current execution target. Use [./phase-3.9.2-tool-surface-planning.md](./phase-3.9.2-tool-surface-planning.md) for the planner-backed exposure substrate this phase evaluates.

## Shipped Outcome

3.9.3 shipped as a real testing-and-hardening phase, not a speculative tool redesign phase.

The phase did four things:

1. **Validated the live MCP / API surface**
   - verified the MCP-visible tool catalog and basic callability by family
   - fixed the `auth_path` MCP schema mismatch so callers now see `route`, `file`, and `feature` instead of an empty input object
   - kept `ask` visible on MCP/API so external agents have a first-class vague-question entry point

2. **Ran seeded external-agent evaluation against `forgebench-eval`**
   - used vague debugging/orientation questions against the seeded defect pack
   - confirmed the main weakness was not “missing more primitives”; it was noisy retrieval and weak source-first ranking for symptom-style questions

3. **Shipped targeted retrieval hardening instead of a new tool family**
   - `cross_search` now expands natural-language phrases into code/schema-friendly variants (for example `support tickets` → `support_tickets`)
   - code/file evidence is source-first and de-duplicated instead of echoing the same file through multiple low-signal blocks
   - markdown/docs chunk noise is filtered out of code-hit evidence
   - natural-language phrase queries now require exact schema-term matches before schema objects/bodies are surfaced, which prevents broad token-split noise on terms like `unknown event` or `not registered`
   - `ask` still routes vague debugging questions into the composer family, but the resulting `cross_search` outputs are materially cleaner and more useful

4. **Set up Roadmap 3 close-out with an evidence-backed decision**
   - no further substantive `3.9.x` capability slice is justified before Roadmap 4
   - the remaining justified work after 3.9.3 was cleanup/refactor only, which later shipped as 3.9.4
   - the next real product questions are Roadmap 4 trust/usefulness questions, not more Phase 3 surface churn

## Evaluation Log Summary

The live evaluation across MCP/direct tool use and the seeded `forgebench-eval` defects produced these stable conclusions:

- the current surface is strong enough to orient an external agent to the right files/routes/tables/RPCs
- the biggest remaining weakness was noisy symptom retrieval, not lack of primitives
- one final retrieval-quality hardening pass was enough to make the seeded hard cases lead with the right source files instead of benchmark/seeded-doc noise
- no repeated failure pattern justified inventing a new compound context-tool catalog before Roadmap 4

Representative seeded questions after the final pass:

- `Why does learner dashboard show Unknown event for registrations?`
  - top evidence now leads with `components/dashboard/learner-overview.tsx`, then `lib/events/dashboard.ts`
- `Why does the dashboard sidebar disagree with the page access checks?`
  - top evidence now leads with `app/dashboard/layout.tsx` and the dashboard route family
- `Why is the event page saying I am not registered when I already am?`
  - top evidence now leads with `lib/events/actions.ts` and `app/events/[id]/page.tsx`

That is enough to move the next work into trust/ranking/usefulness instead of more Phase 3 substrate reshaping.

## Verification At Ship Time

- `corepack pnpm run typecheck`
- `node --import tsx test/smoke/ask-router-goldens.ts`
- `node --import tsx test/smoke/composer-cross-search.ts`
- `node --import tsx test/smoke/composer-cross-search-ranking.ts`
- `node --import tsx test/smoke/harness-calls-registry-tool.ts`
- `node --import tsx test/smoke/core-mvp.ts`

## Decision

**3.9.3 closes the substantive tool-surface work. 3.9.4 later handled the final cleanup/refactor pass and is the actual Roadmap 3 close-out phase.**

The remaining desirable work after 3.9.3 was real, but it was no longer a Phase 3 implementation-gap story. The next problems are:

- trust/ranking over multiple evidence sources
- stronger producer/consumer alignment and identity-flow diagnostics
- better agent-facing usefulness judgments over already-shipped retrieval surfaces

Those belong in Roadmap 4.

## Prerequisites

Phase 3.9.3 requires these earlier phases complete:

- **Phase 3.6.0 + 3.6.1.** The investigation/composer family is already shipped and benchmarked.
- **Phase 3.7.** Semantic retrieval over code/doc/memory exists.
- **Phase 3.9.2.** Planner-backed immediate/deferred/blocked tool exposure exists for harness chat and MCP/API.

If 3.9.2 is not real yet, 3.9.3 should not start.

## Goal

Use real mako chat and external-agent workflows to decide:

1. whether Roadmap 3's tool surface is already strong enough to close cleanly
2. what failures are real enough to justify another `3.9.x` implementation slice before Roadmap 4 opens

This is not a speculative redesign phase. It is an evidence-gathering and hardening phase.

## Why This Phase Exists

The current tool substrate is broad and the planned follow-up ideas are credible, but they are still mostly theory.

That is not enough reason to ship another tool-surface rewrite.

Before adding new compound context tools or reshaping the public tool catalog further, mako needs real validation against the workflows it claims to support:

- mako chat inside the web app
- `agentmako chat`
- external coding agents through MCP
- direct HTTP/CLI tool usage on real coding tasks

This phase exists so the next call is driven by repeated failure patterns instead of taste.

## Hard Decisions

1. **Do not assume a new context-tooling phase is warranted.**
   The output of 3.9.3 may be "Roadmap 3 is done; open Roadmap 4."

2. **Do not optimize against benchmarks only.**
   ForgeBench and smoke coverage stay useful, but they are not enough. The evaluation must include day-to-day coding tasks and live app behavior.

3. **Real usage wins over architectural preference.**
   If an older, low-level tool keeps working well in practice, do not replace it just because a compound tool sounds cleaner on paper.

4. **Bugs in the live app take priority over speculative surface redesign.**
   If the testing phase uncovers real app or transport failures, fix those before inventing new tool shapes.

5. **Evidence threshold must be explicit.**
   A single annoying experience is not enough to justify another 3.9.x implementation phase.

## Questions This Phase Must Answer

### 1. Can external agents actually use the current surface effectively?

For Codex / Claude Code / OpenCode / MCP-style callers:

- can they find the right tool quickly?
- do they understand why a tool is blocked or deferred?
- do they still need manual repo search after using mako?
- are the current outputs shaped for real coding work or only for demos?

### 2. Is the current surface too fragmented?

Repeated signals to watch for:

- agents need 4-6 calls just to orient on one task
- agents miss clear blast radius
- agents miss obvious similar implementations in the same repo
- agents pick a structurally correct tool but still get unhelpful context

### 3. Are there live product errors that block trust?

This phase must explicitly exercise:

- the web app at `:3019`
- the shared API/MCP process at `:3017`
- the harness-facing surfaces that the app and CLI depend on
- project-scoped agent sessions
- tool-call paths from the live UI, not just smokes

### 4. Is another 3.9.x phase justified?

At the end of 3.9.3, choose one:

- **Close Roadmap 3** and open Roadmap 4
- **Open one narrowly-scoped additional 3.9.x slice** with evidence-backed acceptance criteria

No other outcome is valid.

## Scope In

### 1. Real workflow testing

Run real tasks against:

- `mako-ai`
- `forgebench`
- the live web app
- MCP/external-agent surfaces

Task mix should include:

- repo orientation
- find precedent
- blast-radius estimation
- symptom/error tracing
- a small edit workflow with verification

### 2. Live app validation

Use the running dashboard/app and real routes, not just unit or smoke abstractions.

This includes:

- session creation
- session resume
- model/tool availability behavior
- tool calls from the web app
- provider-state handling
- any visible runtime or UX errors

### 3. Tool-surface evaluation log

Capture for each tested task:

- task description
- surface used (chat / MCP / CLI / HTTP / web UI)
- tools called
- call count
- where manual search was still needed
- whether the result was sufficient
- whether the result was correct
- notable friction or missing context

### 4. Targeted hardening fixes

If testing finds clear bugs in the shipped surfaces, fix them in this phase.

This phase is allowed to ship:

- bug fixes
- missing smoke coverage
- doc corrections

This phase is **not** the place for large speculative tool redesign unless the testing result forces it.

## Scope Out

- a new compound context-tool catalog by default
- planner rewrites beyond correctness fixes
- big UI redesign unrelated to tested failures
- Roadmap 4 trust/ranking work
- native non-MCP integrations for Codex/Claude Code

## Evaluation Method

### Pass 1: Existing objective coverage

- rerun focused smokes for tool exposure, MCP listing, and tool-call basics
- rerun ForgeBench / question-set style checks where relevant

### Pass 2: Live app checks

- use the running dashboard and app
- reproduce known or suspected app/tool-call issues
- verify current agent session behavior

### Pass 3: External-agent style tasks

Run a fixed set of realistic tasks such as:

- "I need to change this route — what should I read first?"
- "If I change this table/RPC/file, what else moves?"
- "Where is the canonical pattern for this behavior?"
- "What likely caused this runtime symptom?"
- "What should I verify after making this change?"

### Pass 4: Decision memo

At the end, write one short evidence-backed conclusion:

- close Roadmap 3 now
- or justify one additional `3.9.x` slice with concrete repeated failures

## Evidence Threshold For Another 3.9.x Slice

Another implementation phase is justified only if at least one of these is repeatedly true across tasks and surfaces:

- orientation requires too many low-level tool calls to be practical
- blast-radius estimation is repeatedly incomplete in ways that matter to edits
- precedent/pattern discovery repeatedly fails even when the repo clearly contains similar code
- live UI/tool-call behavior is still unreliable enough to undermine trust

If those patterns are not repeated, do not add another tool-surface implementation phase.

## Acceptance Criteria

This phase is complete when:

- the live web app and current tool surfaces have been exercised on real tasks
- a written evaluation log exists with repeated patterns, not anecdotes
- any clear shipped bugs found during the evaluation are fixed or explicitly documented
- there is a hard decision on whether Roadmap 3 closes or another `3.9.x` slice is justified

## Verification Matrix

- focused smokes for 3.9.2 planner-backed exposure
- at least one live web-app session/tool-call validation pass
- at least one MCP/external-agent evaluation pass
- at least one repo-change-oriented evaluation pass on `forgebench`
- one close-out decision memo or roadmap update reflecting the result

## Immediate Starting Files

- `devdocs/roadmap/version-3/phases/phase-3.9.2-tool-surface-planning.md`
- `devdocs/roadmap/version-3/roadmap.md`
- `devdocs/roadmap/version-3/handoff.md`
- `test/smoke/core-mvp.ts`
- `test/smoke/harness-calls-registry-tool.ts`
- `devdocs/test-project/benchmark-questions.md`
- `apps/web/src/pages/Session.tsx`
- `services/api/src/mcp.ts`
