# storage

App-owned persistence only.

Layout:

- `migrations/`: schema changes
- `models/`: storage DTOs and row shapes
- `queries/`: typed query and repository helpers

Initial direction:

- `global.db` for app/user/project registry data
- `project.db` for indexed repo data and answer traces
- external customer databases stay read-only and are normalized into project state
