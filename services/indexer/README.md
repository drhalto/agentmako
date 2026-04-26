# services/indexer

Deterministic structure extraction.

Owns:

- file indexing
- symbol extraction
- route tracing
- import graph building
- schema introspection
- profile detection

Current deterministic extraction includes:

- Next.js app and API route discovery
- local HTTP route discovery from route definition maps plus handler branches
- JS/TS relative import normalization back to source files when ESM specifiers use runtime `.js` paths
