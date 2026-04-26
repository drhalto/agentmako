# Roadmap 2 Fixture Project Spec

## Name

`forgebench`

## Purpose

`forgebench` is the primary controlled benchmark project for `mako-ai` Roadmap 2.

It exists to answer one question clearly:

Can `mako-ai` produce Fenrir-class investigation answers against a real JS/TS + Next.js + Supabase project that we fully control?

This project is not a product. It is a deliberately constructed evaluation target.

## Primary Environment

The fresh cloud Supabase instance is the primary target.

That means:

- the canonical database state lives in the cloud test Supabase project
- the fixture repo should point at that test instance by default
- benchmark answers should be verified against the cloud project first
- a local Supabase mirror is optional and useful, but secondary

## Why This Exists

`courseconnect` is useful for realism, but it is a bad correctness harness because:

- it is live
- it can drift underneath us
- expected answers are not always obvious
- failures can be caused by environment drift instead of `mako-ai`

`forgebench` fixes that by giving us:

- a fully controlled Next.js codebase
- a fully controlled Supabase schema
- known routes, RPCs, RLS policies, triggers, and edge functions
- known benchmark questions with expected answers
- freedom to change the project when a tool needs a better test case

## Product Shape

Build a small but realistic multi-tenant training platform.

Working title:

- `ForgeBench`
- tagline: "Controlled benchmark app for repo + database intelligence"

The app should feel like a smaller cousin of `courseconnect`, not a toy hello-world app.

## Stack

- Next.js 16 App Router
- TypeScript
- React 19
- Supabase cloud project as primary backend
- Supabase SQL migrations committed in-repo
- generated Supabase TypeScript types committed in-repo
- 2-3 edge functions
- ESLint + TypeScript typecheck

## Architectural Rules

1. Cloud Supabase is the source of truth.
2. All schema changes must come from committed SQL migrations.
3. Generated types must be refreshed from the cloud test project and committed.
4. No production secrets or third-party live business integrations.
5. Every major capability in the fixture must exist because it supports a benchmark question.
6. Keep the repo understandable by one engineer in under an hour.

## Required Capability Surface

The fixture must let `mako-ai` prove these categories:

- route tracing
- import dependency and impact analysis
- symbol and export analysis
- database schema introspection
- foreign key relationship tracing
- RLS visibility
- RPC tracing
- code query pattern tracing
- edge function awareness
- error tracing
- preflight-style investigation before building on a table

## Database Design

Use at least two schemas:

- `public`
- `ops`

### Core Tables

Build these tables at minimum:

- `public.tenants`
- `public.profiles`
- `public.user_roles`
- `public.events`
- `public.event_sessions`
- `public.event_registrations`
- `public.certificates`
- `public.certificate_awards`
- `public.support_tickets`
- `ops.audit_log`

### Required FK Relationships

- `profiles.tenant_id -> tenants.id`
- `user_roles.user_id -> profiles.id`
- `user_roles.tenant_id -> tenants.id`
- `events.tenant_id -> tenants.id`
- `event_sessions.event_id -> events.id`
- `event_registrations.event_id -> events.id`
- `event_registrations.user_id -> profiles.id`
- `certificates.event_id -> events.id`
- `certificate_awards.certificate_id -> certificates.id`
- `certificate_awards.user_id -> profiles.id`
- `support_tickets.tenant_id -> tenants.id`
- `support_tickets.reporter_id -> profiles.id`

### Required RLS

Add real row-level security, not placeholder policies.

At minimum:

- users can read their own profile
- admins can read/write tenant-scoped records
- instructors can update only the events they own
- learners can read published events in their tenant
- learners can create their own registrations
- support tickets are tenant-scoped

### Required Triggers

Include at least three meaningful triggers:

- `updated_at` maintenance trigger
- audit trigger writing to `ops.audit_log`
- search/index helper trigger on `events`

### Required RPCs

Include at least six RPCs:

- `public.get_visible_events`
- `public.register_for_event`
- `public.cancel_registration`
- `public.admin_publish_event`
- `public.get_instructor_dashboard`
- `ops.record_support_ticket_event`

Requirements:

- at least one RPC should touch multiple tables
- at least one RPC should enforce auth-sensitive behavior
- at least one RPC should be called from both app code and an edge function

## Edge Functions

Add at least three edge functions:

- `send-registration-email`
- `nightly-digest`
- `ticket-webhook`

Each should have a reason to exist in benchmark traces.

Examples:

- `send-registration-email` is called after successful registration
- `nightly-digest` reads upcoming events and registrations
- `ticket-webhook` records external support events into `support_tickets` or `ops.audit_log`

## App Surface

Build a small Next.js app with enough routes and query patterns to test investigation tools.

### Required Routes

- `app/page.tsx`
- `app/events/page.tsx`
- `app/events/[id]/page.tsx`
- `app/dashboard/admin/page.tsx`
- `app/dashboard/instructor/page.tsx`
- `app/dashboard/learner/page.tsx`
- `app/support/page.tsx`
- `app/api/events/route.ts`
- `app/api/support/route.ts`

### Required Query Patterns

The app code must include:

- direct `.from("events")` queries
- direct `.from("event_registrations")` queries
- `.rpc("get_instructor_dashboard")`
- `.rpc("register_for_event")`
- at least one server action
- at least one API route handler
- at least one reusable data-access helper in `lib/`

## Import/Code Structure

The repo must have enough structure to make `imports_*`, `symbols_*`, and future `trace_file` style tools meaningful.

Required:

- `lib/db/`
- `lib/events/`
- `lib/certificates/`
- `lib/support/`
- `components/events/`
- `components/dashboard/`
- `components/support/`

Create at least two intentional import chains with depth >= 3.

Example:

- `app/dashboard/instructor/page.tsx`
- `lib/events/dashboard.ts`
- `lib/events/queries.ts`
- `lib/db/client.ts`

Create at least one intentional shared module hotspot.

## Type Surface

Commit generated Supabase types in:

- `types/supabase.ts`

The benchmark must be able to trace:

- table row types
- RPC signatures
- enum-like domain values if present

## Deliberate Investigation Seeds

Plant specific, known test cases on purpose.

### Error Seeds

Include these exact error strings in code:

- `Failed to load instructor dashboard data`
- `Registration capacity check failed`
- `Support webhook signature missing`

At least one should be thrown in app code.
At least one should be thrown in an edge function or RPC path.

### Search Seeds

Include a few deliberately unique terms that appear across different surfaces:

- `attendance_window`
- `digest_lock`
- `certificate_revocation`

Each should appear in at least two of:

- application code
- SQL/RPC source
- edge function source
- generated types or schema identifiers

### Preflight Seed

Design `events` to be the canonical preflight table.

It should have:

- related sessions
- registrations
- certificates
- RLS
- at least one trigger
- at least one RPC touching it
- at least one edge function touching it
- multiple app routes querying it

## Required Benchmark Packs

The builder must create:

- `docs/benchmark-questions.md`
- `docs/benchmark-answer-key.md`

### Question Packs

Create benchmark questions for these investigation shapes:

- `cross_search`
- `trace_rpc`
- `trace_table`
- `trace_file`
- `trace_error`
- `trace_edge`
- `preflight_table`

### Minimum Counts

- 8 table questions
- 6 RPC questions
- 6 file questions
- 6 error/search questions
- 4 edge-function questions
- 5 preflight questions

Minimum total:

- 35 benchmark questions

## Answer Key Requirements

The answer key must be concrete enough to verify tool correctness.

For each benchmark question, record:

- expected primary entities
- expected source families
- expected files/tables/functions/routes that must appear
- expected things that must not appear

Do not write vague answer keys like "should mention registrations."

Write specific expectations like:

- must include `public.event_registrations`
- must include `public.register_for_event`
- must include `app/events/[id]/page.tsx`
- must mention `send-registration-email`

## Seed Data

Add enough seed data to support realistic read paths.

At minimum:

- 2 tenants
- 6 users across learner/instructor/admin roles
- 8 events
- 12 event sessions
- 20 registrations
- 4 certificates
- 8 certificate awards
- 6 support tickets

The data volume should stay small enough to reason about manually.

## Deliverables

The agent building this fixture must produce:

- the full repo
- cloud Supabase migration set
- seed data scripts
- generated `types/supabase.ts`
- edge functions
- benchmark question doc
- benchmark answer key
- a short architecture overview doc
- a short setup doc

## Acceptance Criteria

The fixture is complete when:

1. `npm install`, `npm run typecheck`, and `npm run lint` pass.
2. The app boots locally against the cloud test Supabase project.
3. The cloud Supabase schema matches the committed migrations.
4. Generated types are committed and current.
5. Every benchmark question has a concrete expected answer key.
6. The repo contains enough deliberate cross-surface links for all seven investigation shapes.
7. A human can manually confirm benchmark answers from the codebase and database without guessing.

## Non-Goals

Do not optimize for:

- polished visual design
- production deployment
- auth provider completeness
- billing integrations
- background workers
- high data volume
- generalized framework support

This project is a benchmark harness, not a startup.

## Suggested Build Order

1. Scaffold the Next.js repo.
2. Set up the cloud Supabase project wiring.
3. Build migrations and seed data.
4. Generate and commit `types/supabase.ts`.
5. Build the minimal app routes and data-access helpers.
6. Add edge functions.
7. Add deliberate error/search/preflight seeds.
8. Write benchmark questions.
9. Write benchmark answer key.
10. Verify every benchmark question manually.

## Short Agent Brief

Build a controlled benchmark repo named `forgebench`.

It must be a small but realistic Next.js + TypeScript + cloud Supabase app that exists to test `mako-ai` Roadmap 2 investigation tooling. The cloud Supabase instance is the primary target. The repo must deliberately include routes, imports, symbols, RLS, RPCs, triggers, edge functions, generated types, and seeded benchmark questions so we can verify tool accuracy exactly.

Do not build a toy app. Build a compact but information-rich fixture with committed migrations, generated types, benchmark docs, and a clear answer key.
