# Phase 4 Ask Router Specification

This file is the exact implementation spec for the current Phase 4 build target.

Use [../roadmap.md](../roadmap.md) for phase order and status. Use this file for the concrete design of the Phase 4 `ask` router.

## Goal

Add one low-friction front door for coding agents that do not know the exact tool name yet.

`ask` must route natural-language questions into the existing named tool families first and fall back to the legacy engine only when no structured tool fits.

This phase is about **clean tool selection**, not about inventing a second engine.

## Hard Decisions

- Phase 4 adds exactly one new public tool: `ask`
- `ask` is a thin deterministic router over existing tools
- `ask` does not replace the named tool surface
- `ask` does not introduce new data sources
- `ask` does not perform multi-step tool orchestration in Phase 4
- `ask` selects one best named tool and executes it
- `ask` falls back to the existing `free_form` answer path only when no named tool matches confidently
- `ask` must expose which tool it selected and which arguments it derived
- `ask` must stay transport-neutral in `packages/tools`
- `ask` must remain conservative when extraction is weak or the target is ambiguous

## Why This Phase Exists

The named tools are now useful and modular, but a coding agent may not know whether to call:

- `db_columns`
- `db_table_schema`
- `imports_impact`
- `route_trace`
- `auth_path`

Phase 4 solves the entry-point problem without flattening the tool taxonomy again.

The lesson from `fenrir` is not "avoid tools." It is:

- keep the named tools
- make the taxonomy clean
- add one thin front door that routes into them

## Tool Family Model

Phase 4 formalizes the public tool families.

### Answers

- `route_trace`
- `schema_usage`
- `file_health`
- `auth_path`

### Imports

- `imports_deps`
- `imports_impact`
- `imports_hotspots`
- `imports_cycles`

### Symbols

- `symbols_of`
- `exports_of`

### Database

- `db_ping`
- `db_columns`
- `db_fk`
- `db_rls`
- `db_rpc`
- `db_table_schema`

### Router

- `ask`

Rule:

- the family model is a documentation and routing concept
- it does not require collapsing the named tools into one large tool
- the named tools remain the canonical direct surfaces

## Architecture Boundary

### `packages/tools/src/ask/`

Owns:

- ask input/output schemas
- deterministic pattern matching
- tool-family routing
- lightweight entity extraction
- validated dispatch into named tools
- fallback decision logic

Does not own:

- HTTP or MCP transport code
- new persistence
- direct SQL or SQLite queries outside the existing named tools
- long-running orchestration

### Existing Tool Modules

Still own the real work:

- `packages/tools/src/answers/`
- `packages/tools/src/imports/`
- `packages/tools/src/symbols/`
- `packages/tools/src/db/`

Phase 4 rule:

- `ask` decides
- named tools answer

## Input Contract

Phase 4 `ask` input:

```ts
{
  question: string;
  projectId?: string;
  projectRef?: string;
}
```

Rules:

- `question` is required
- project locator is optional at the input schema level
- if the selected named tool requires project context and none is provided, return a typed error instead of silently guessing
- DB-only routes may succeed without project context

## Output Contract

Phase 4 `ask` output:

```ts
{
  toolName: "ask";
  mode: "tool" | "fallback";
  selectedFamily: "answers" | "imports" | "symbols" | "db" | "fallback";
  selectedTool: string;
  selectedArgs: Record<string, unknown>;
  confidence: number;
  fallbackReason?: string | null;
  result: unknown;
}
```

Rules:

- `mode: "tool"` means a named tool was selected
- `mode: "fallback"` means the existing engine `free_form` handler was used
- `selectedTool` must always be present
- `selectedArgs` must show the routed input shape
- `result` must be the raw structured output from the selected tool or fallback handler
- `ask` does not hide the underlying tool choice

## Routing Pipeline

Phase 4 routing flow:

1. normalize question text
2. match question against deterministic pattern groups
3. extract the minimum required arguments
4. choose one named tool
5. validate the derived input against that tool's schema
6. execute the tool
7. if no tool matches confidently, route to `free_form`

This must stay deterministic and explainable.

## Pattern Groups

### Database Table Shape

Examples:

- `columns of projects`
- `what columns does public.study_tracks have`
- `schema for projects`
- `show me the table shape for study_tracks`

Routes to:

- `db_columns` for explicit column-oriented questions
- `db_table_schema` for broader shape/schema questions

### Database Relationships

Examples:

- `what foreign keys does projects have`
- `what references study_tracks`
- `fk for courses`

Routes to:

- `db_fk`

### Database Security

Examples:

- `is RLS enabled on study_tracks`
- `show policies for courses`
- `what policies protect projects`

Routes to:

- `db_rls`

### Database RPCs

Examples:

- `show rpc get_student_profile`
- `what does public.study_track_badge return`
- `arguments for refresh_study_track_badges`

Routes to:

- `db_rpc`

### Route Questions

Examples:

- `where is /api/v1/projects handled`
- `what handles /auth/login`
- `trace route /api/users`

Routes to:

- `route_trace`

### Auth Questions

Examples:

- `what auth protects /api/v1/projects`
- `how is login protected`
- `auth path for services/api/src/routes.ts`

Routes to:

- `auth_path`

### File Questions

Examples:

- `what does services/api/src/server.ts do`
- `file health for services/api/src/routes.ts`

Routes to:

- `file_health`

### Import Graph Questions

Examples:

- `what does services/api/src/server.ts import`
- `what depends on services/api/src/server.ts`
- `import hotspots`
- `show import cycles`

Routes to:

- `imports_deps`
- `imports_impact`
- `imports_hotspots`
- `imports_cycles`

### Symbol Questions

Examples:

- `symbols in services/api/src/server.ts`
- `exports of apps/cli/src/index.ts`

Routes to:

- `symbols_of`
- `exports_of`

### Schema Usage Questions

Examples:

- `where is projects used`
- `where is study_tracks referenced`
- `what code uses support_level`

Routes to:

- `schema_usage`

## Canonical Tool Choice Rules

When multiple tools could plausibly fit, choose the more specific one:

- `columns of X` -> `db_columns`, not `db_table_schema`
- `schema for X` -> `db_table_schema`, not `db_columns`
- `what does X import` -> `imports_deps`, not `imports_impact`
- `what depends on X` -> `imports_impact`, not `file_health`
- `what exports does file X have` -> `exports_of`, not `symbols_of`
- `what auth protects route X` -> `auth_path`, not `route_trace`

Rule:

- one canonical tool per question shape
- if a new ambiguous question shape appears often, improve the named tool taxonomy instead of making `ask` smarter and looser

## Fallback Rules

Fallback to `free_form` only when:

- no deterministic pattern matches
- extraction confidence is weak
- the question is broad synthesis rather than a direct tool question

Fallback must not:

- hide that fallback happened
- pretend a named tool was selected
- invent structured arguments that did not validate

## Error Model

Phase 4 should return typed errors for routing failures:

- `invalid_tool_input`
- `missing_project_context`
- existing typed tool errors from the selected tool

Rules:

- if a project-based tool is selected without `projectId` or `projectRef`, return `missing_project_context`
- if entity extraction produced conflicting structured input, return `invalid_tool_input`
- if the selected tool returns a typed error, surface it without rewriting the semantics

## Verification

Phase 4 must add two levels of verification.

### 1. Dispatch Goldens

Create a fixed set of natural-language prompts and pin:

- selected family
- selected tool
- derived arguments
- fallback vs direct-tool mode

Minimum coverage:

- 5 DB prompts
- 5 route/auth prompts
- 5 import/symbol prompts
- 5 schema/file prompts
- 3 fallback prompts

### 2. End-To-End Smoke

Verify `ask` through:

- shared tool invocation
- HTTP tool route
- MCP tool call
- CLI `tool call`

Representative assertions:

- `columns of public.study_tracks` -> `db_columns`
- `schema for public.study_tracks` -> `db_table_schema`
- `what depends on services/api/src/server.ts` -> `imports_impact`
- `what does services/api/src/server.ts import` -> `imports_deps`
- `where is /api/v1/projects handled` -> `route_trace`
- `what auth protects /api/v1/projects` -> `auth_path`
- an intentionally broad question -> `free_form` fallback with `mode: "fallback"`

## Out Of Scope

- LLM-based classifier routing
- multi-tool planning/orchestration
- hidden tool chaining
- ranking across multiple candidate tools with learned weights
- broad natural-language synthesis beyond thin routing
- new tool families beyond the shipped named tools

## Reference From Fenrir

Use `fenrir` as a read-only pattern reference only:

- borrow the idea of a thin question router from `investigation.py`
- do not port Fenrir's broad tool sprawl
- do not port broad "oracle/suggest/recommend" surfaces into Phase 4
- do not let `ask` become a second engine with weak boundaries
