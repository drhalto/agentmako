# Phase 8.6 Usefulness Evaluation And Default Exposure

Status: `Planned (closeout)`

## Goal

Close Roadmap 8 by grading each learned surface the same way R7.5
graded artifact families. Every learned ranking / routing / promotion /
attachment / experiment surface resolves to one of
`default / opt_in / dark / not_promoted` with an explicit rollback
reason for anything demoted.

## Hard Decisions

- reuse R7.5's `decideArtifactExposure` pattern — do not invent a
  parallel exposure decider
- every learned surface carries its baseline comparison in the eval
  output
- any surface that fails its usefulness check lands at `dark` or
  `not_promoted` with a removal-or-keep decision, matching R7.5's
  dismount rule

## Gate

Opens after 8.3 / 8.4 / 8.5 have each shipped and collected at least
one real operator window of usefulness data.

## Scope In

- per-surface usefulness evaluator reusing the R7.5 / R6 grading shape
- exposure decision per learned surface
- CHANGELOG close-out entry
- roadmap + handoff "current status" updates marking Roadmap 8 complete
- removal pass for any `not_promoted` surface without a documented
  reason to keep

## Scope Out

- no new learned surface
- no reopening of 8.0–8.5 contracts
- no post-8.6 extension — same rule R7 applied. If a separable problem
  appears, it is its own roadmap direction, not an 8.7.

## Done When

- every learned surface has an exposure decision recorded in the phase
  doc
- every demoted surface is either removed or carries an explicit
  keep-reason
- `pnpm typecheck` + `pnpm run test:smoke` green with all learned
  surfaces at their final exposure
- CHANGELOG `## [Unreleased]` carries an 8.6 entry; the roadmap README
  status flips to `COMPLETE`

## References

- [../../version-7/phases/phase-7.5-usefulness-evaluation-and-default-exposure.md](../../version-7/phases/phase-7.5-usefulness-evaluation-and-default-exposure.md)
  — pattern to mirror
- `packages/tools/src/artifact-evaluation.ts` — `decideArtifactExposure`
- `packages/tools/src/workflow-evaluation.ts` — R6 dismount pattern
