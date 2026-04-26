# Phase Implementation Plan Template

This file is the exact implementation spec for `[phase-name]`.

Use `[canonical-roadmap-path]` for phase order and status. Use this file for the concrete design of this phase.

## Goal

`[one short paragraph describing the phase outcome and why it matters]`

## Hard Decisions

- `[decision 1]`
- `[decision 2]`
- `[decision 3]`
- `[explicit thing this phase does not do]`

## Why This Phase Exists

Explain the product problem this phase solves:

- `[problem 1]`
- `[problem 2]`
- `[why earlier work is not enough by itself]`

## Scope In

- `[capability 1]`
- `[capability 2]`
- `[capability 3]`

## Scope Out

- `[explicit non-goal 1]`
- `[explicit non-goal 2]`
- `[explicit non-goal 3]`

## Architecture Boundary

### Owns

- `[module or package 1]`
- `[module or package 2]`
- `[responsibility 1]`

### Does Not Own

- `[transport or layer 1]`
- `[persistence or runtime concern 1]`
- `[future work that should stay out]`

## Contracts

### Input Contract

```ts
{
  // replace with the real input shape
}
```

Rules:

- `[input rule 1]`
- `[input rule 2]`

### Output Contract

```ts
{
  // replace with the real output shape
}
```

Rules:

- `[output rule 1]`
- `[output rule 2]`

### Error Contract

- `[typed error 1]`
- `[typed error 2]`
- `[ambiguity or not-found behavior]`

## Execution Flow

1. `[step 1]`
2. `[step 2]`
3. `[step 3]`
4. `[fallback or completion step]`

## File Plan

Create:

- `[new file or directory 1]`
- `[new file or directory 2]`

Modify:

- `[existing file 1]`
- `[existing file 2]`
- `[existing file 3]`

Keep unchanged:

- `[intentionally untouched surface 1]`
- `[intentionally untouched surface 2]`

## Implementation Workstreams

### Workstream A: `[Name]`

- `[task 1]`
- `[task 2]`
- `[task 3]`

### Workstream B: `[Name]`

- `[task 1]`
- `[task 2]`
- `[task 3]`

## Verification

Required commands:

- `[build command]`
- `[typecheck command]`
- `[test command]`

Required runtime checks:

- `[integration check 1]`
- `[integration check 2]`

Required docs checks:

- `[doc alignment check 1]`
- `[doc alignment check 2]`

## Done When

- `[outcome 1]`
- `[outcome 2]`
- `[outcome 3]`
- `[verification state]`

## Risks And Watchouts

- `[risk 1]`
- `[risk 2]`
- `[thing that is easy to overbuild]`

## References

- `[roadmap or product doc]`
- `[architecture decision doc]`
- `[handoff or prior cleanup brief]`
- `[external or predecessor reference]`
