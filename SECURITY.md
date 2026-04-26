# Security Policy

Mako is pre-1.0 local-first developer tooling. The current supported
branch is `main`.

## Reporting A Vulnerability

Use the public repository's private vulnerability reporting channel when
it is enabled. If private reporting is unavailable, contact the
maintainer through the repository owner profile and avoid posting exploit
details publicly until there is a fix or mitigation.

Do not include live API keys, database URLs, Supabase service-role keys,
customer data, or private repository contents in a public issue.

## Local Data Model

Mako stores project indexes, snapshots, tool runs, review notes, and
Reef facts in local SQLite databases. Those files are runtime state and
should not be committed or attached to public issues unless they are
synthetic fixtures created specifically for reproduction.

Live database tools should remain read-only unless a tool explicitly
states that it writes to Mako's local project store. Local review tools
such as `db_review_comment` do not mutate the live database.
