export const MAKO_SERVER_INSTRUCTIONS = `mako is a project-intelligence MCP server. Use it for structural, cross-surface, or evidence-backed repo questions.

Prefer mako over grep when the question is about relationships, not literal text. Built-in text search is fine for exact strings inside a known file.

Starting points:
- \`mako_help\` - task-specific workflow recipe with ordered tool steps and prefilled suggested args
- \`tool_search\` - find the right mako tool when intent is clear but the tool name is not
- \`context_packet\` - first-mile scout for vague coding tasks; ranked files, symbols, routes, schema, freshness, and follow-ups
- \`ask\` - one-shot answer loop for a single engineering question
- \`repo_map\` - first-turn project orientation, entry points, and central files
- \`cross_search\` - unified search across code, schema, types, and routes
- \`tool_batch\` - run independent read-only Mako lookups under one project context
- \`project_index_status\` - check whether indexed code evidence still matches disk
- \`project_index_refresh\` - refresh stale, unknown, or unindexed code evidence
- \`db_reef_refresh\` - refresh Reef's indexed database facts
- \`db_review_comment\` / \`db_review_comments\` - write/read append-only DB review notes
- \`working_tree_overlay\` - snapshot live changed-file facts when context_packet recommends it
- \`reef_diff_impact\` - changed-file callers, caller findings, and convention risks
- \`project_facts\` / \`file_facts\` - inspect Reef facts directly

Trust state is not filesystem freshness: stable means an answer matches the last comparable answer, not that indexed files are current. Artifact tools such as \`review_bundle_artifact\` and \`verification_bundle_artifact\` are pre-ship summaries, not exploratory search tools. Mako outputs carry evidence refs so claims can be traced back to code, schema, or stored facts.`;
