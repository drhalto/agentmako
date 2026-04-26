# Test Documentation

Cross-package integration tests and fixture-driven contract tests live here.

Each package or service can also keep narrow local tests beside source files.

## Quick Start

```bash
# Run all smoke tests
corepack pnpm run test:smoke

# Or directly with tsx
node --import tsx test/smoke/core-mvp.ts
```

## Local Supabase

The repo now includes a local `supabase/` project for integration testing against a real Supabase catalog layout.

```bash
# Start the local stack
corepack pnpm run supabase:start

# Rebuild the local database from migrations + seed data
corepack pnpm run supabase:reset

# Inspect local URLs and keys
corepack pnpm run supabase:status
```

PowerShell smoke-test example:

```powershell
$env:MAKO_TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
corepack pnpm run test:smoke
```

The local stack exposes the schemas used by the Phase 3 detection path, including `auth`, `storage`, and `supabase_functions`.
The smoke harness also pins a small Hogwarts LMS catalog slice plus a shadow schema used for deterministic ambiguity checks.

Relevant local fixtures:
- `public.study_tracks`
- `public.study_sessions`
- `public.study_tracks_title_lower_idx` expression index
- `public.study_track_badge(text, integer)`
- `public.study_track_badge(text)`
- `hogwarts_smoke_shadow.study_tracks`
- `hogwarts_smoke_shadow.study_track_badge(text, integer)`


## Smoke Test Coverage (`smoke/core-mvp.ts`)

The smoke harness verifies the current MVP path end-to-end, staying compatible with the SQLite locking policy.

`smoke/ask-router-goldens.ts` adds a fixed Phase 4 dispatch matrix for the `ask` router so tool selection, derived args, and fallback mode stay pinned.

### CLI Flows

- **attach** - Attaches the mako-ai repo as a test project
- **list** - Lists attached projects
- **index** - Indexes the project codebase (127+ files, 6+ routes)
- **status** - Checks project status and latest run
- **answer** - Queries with all 5 supported query kinds:
  - `route_trace` - Traces HTTP routes (e.g., "/api/v1/projects")
  - `file_health` - Analyzes file health and dependencies
  - `schema_usage` - Schema object usage patterns
  - `auth_path` - Auth flow paths and boundaries
  - `free_form` - Free-form natural language queries

### API Flows

- **Health** - GET /health returns status, app info, routes
- **Projects** - GET /api/v1/projects lists attached projects
- **Answers** - POST /api/v1/answers with projectId, queryKind, queryText
- **Error Handling** - Tests invalid JSON (400) and missing project (500)

### Verification Points

- Projects attach and index successfully
- All query kinds return non-empty answers
- Evidence blocks include correct file references
- Route definitions reference services/api/src/routes.ts
- Request IDs propagate through the entire stack
- Error responses have proper envelope shape

## CI Integration

### GitHub Actions

Create `.github/workflows/test.yml`:

```yaml
name: Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm run build
      - run: pnpm run test:smoke
```

## Test Data & Cleanup

The smoke test:
- Uses a temporary state directory: `.mako-ai-smoke-<timestamp>-<pid>`
- Attaches the mako-ai repo itself as the test project
- Automatically cleans up after test completion (pass or fail)
- Uses isolated project databases per run

## Debugging

### Common Issues

1. **SQLite Experimental Warning**
   - Expected: `(node:XXXX) ExperimentalWarning: SQLite is an experimental feature`
   - This is normal for Node 22, not an error

2. **Build Required**
   - The smoke test uses the built CLI (`apps/cli/dist/index.js`)
   - Always run `corepack pnpm run build` before testing

3. **Port Conflicts**
   - The embedded API server uses port 0 (random available port)
   - CLI commands use temporary state directories

### Verbose Output

To see detailed API request logging:
```bash
DEBUG=* corepack pnpm run test:smoke
```

## Manual Web Client Testing

For interactive browser verification:

```bash
# Terminal 1: Start API server
node apps/cli/dist/index.js serve 3020

# Terminal 2: Start web server
node apps/web/scripts/serve.mjs 4174

# Browser: http://127.0.0.1:4174
# 1. Configure API base URL: http://127.0.0.1:3020
# 2. Click Connect (health check)
# 3. Attach project: .
# 4. Index project
# 5. Run queries (all 5 query kinds)
# 6. Verify evidence renders correctly
```

Golden path verification:
- Health shows "status ok"
- Project attaches and indexes (127 files, 6 routes)
- route_trace for "/api/v1/projects" returns services/api/src/routes.ts
- Evidence list includes "Route Definition" blocks
- Browser console: 0 errors, 0 warnings
- Network tab: All requests 200 OK

## Future Test Coverage

### Planned Additions

- [ ] Automated Playwright browser tests for web client
- [ ] Worker service tests (when worker layer implemented)
- [ ] DB connector tests (when connectors implemented)
- [ ] Performance benchmarks (indexing speed, query latency)
- [ ] Concurrent access tests (SQLite locking edge cases)

## Notes

- Tests are deterministic - no external network calls
- Tests run sequentially to respect SQLite WAL locking
- Each test uses unique state directories for isolation
- Tests verify both happy path and intentional error cases
- Worker and live DB connectors remain deferred per architecture decisions
