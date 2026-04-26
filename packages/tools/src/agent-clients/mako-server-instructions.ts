export const MAKO_SERVER_INSTRUCTIONS = `mako is a project-intelligence MCP server. Use it when the question is structural, cross-surface, or evidence-backed.

Prefer mako over built-in grep or ad hoc file reading when the question is about relationships, not literal text. Built-in text search is fine for exact strings inside a known file.

Starting points:
- \`tool_search\` - find the right mako tool when intent is clear but the tool name is not
- \`context_packet\` - first-mile scout for vague coding tasks; returns ranked files, symbols, routes, schema objects, freshness, and expansion tools
- \`ask\` - one-shot answer loop for a single engineering question
- \`repo_map\` - first-turn project orientation, entry points, and central files
- \`cross_search\` - unified search across code, schema, types, and routes
- \`tool_batch\` - run several independent read-only Mako lookups under the same project context
- \`project_index_status\` - check whether indexed code evidence still matches disk; pass \`includeUnindexed: true\` when new files matter
- \`project_index_refresh\` - refresh a stale, unknown, or unindexed code index without shelling out
- \`db_reef_refresh\` - refresh Reef's indexed database facts from the current schema snapshot/read model
- \`db_review_comment\` / \`db_review_comments\` - write and read append-only local review notes on database objects such as tables, policies, triggers, or replication topics
- \`working_tree_overlay\` - snapshot live changed-file facts when context_packet recommends it
- \`project_facts\` / \`file_facts\` - inspect Reef's durable fact substrate directly

Trust state is not filesystem freshness: stable means an answer matches the last comparable answer, not that indexed files are current. Artifact tools such as \`review_bundle_artifact\` and \`verification_bundle_artifact\` are pre-ship summaries, not exploratory search tools. Mako outputs carry typed packets and evidence refs so claims can be traced back to code, schema, or stored project facts.`;
