# Knowledge Substrate

Status: `Future idea`

This note scopes a possible local knowledge substrate for `mako-ai`.

It is not active roadmap work yet.

## Intent

Let users attach markdown folders and persist them as local knowledge in the same local-first model as the rest of the product.

This would support:

- project-scoped notes tied to one repo
- user-global notes shared across projects
- fast local text search first
- embeddings, categorization, and linking later

## Core Idea

Use the existing SQLite split instead of introducing a third database immediately:

- `project.db`
  - project-scoped knowledge
- `global.db`
  - user-global knowledge

Store:

- canonical document records
- chunked relational read model
- optional embeddings later as a derived layer

This follows the same pattern as schema snapshots:

- canonical source
- queryable local read model
- optional higher-order enrichment on top

## Minimum Scope

At minimum:

- markdown folder mounts
- `.md` and `.mdx` ingestion
- frontmatter parsing
- heading-aware chunking
- FTS-backed local search
- project/global separation

Do not require embeddings for the first useful version.

## Candidate Tables

For both `project.db` and `global.db`, use a `knowledge_*` family:

- `knowledge_mounts`
  - root path
  - scope
  - include/exclude globs
  - enabled flag
  - last indexed at
- `knowledge_documents`
  - document id
  - mount id
  - relative path
  - title
  - sha256
  - modified time
  - frontmatter JSON
  - raw markdown text
- `knowledge_chunks`
  - chunk id
  - document id
  - ordinal
  - heading path
  - chunk text
  - token-ish length
- `knowledge_tags_manual`
  - user-assigned tags
- `knowledge_tags_inferred`
  - future model-generated categories
- `knowledge_links`
  - optional future links to code, routes, schema objects, RPCs, or notes
- `knowledge_embeddings`
  - optional later
  - one row per chunk per embedding model

## Ingestion Rules

- mount a folder explicitly
- walk markdown files only at first
- parse frontmatter if present
- chunk by headings, not arbitrary fixed windows
- rebuild by content hash / modified time
- keep embeddings as a second pass

## Product Surface

Candidate commands:

- `agentmako notes attach ./docs`
- `agentmako notes attach --global C:\\Users\\Dustin\\notes`
- `agentmako notes index`
- `agentmako notes status`
- `agentmako notes search "rls policy"`

Later:

- `agentmako notes embed`
- `agentmako notes classify`

## Strong Constraints

- do not store only embeddings
- do not require a vector database
- do not collapse project and global notes into one undifferentiated corpus
- keep manual tags and inferred tags separate
- keep this as local-first product state

## Suggested Phasing

1. Notes substrate
   - mounts
   - parsing
   - chunking
   - FTS
   - project/global separation
2. Embeddings
   - optional semantic retrieval over chunks
3. Categorization and linking
   - inferred tags
   - links to code and schema entities
   - retrieval into answers

## Open Questions

- should this stay under the `notes` concept publicly, or should the product call it `knowledge` from day one?
- should project notes be indexed during normal project index, or as a separate explicit command?
- when embeddings arrive, should they live in SQLite blobs/JSON, or should they stay behind a later pluggable vector layer?
