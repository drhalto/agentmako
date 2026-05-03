export const MAKO_SERVER_INSTRUCTIONS = `mako is project-intelligence for structural, cross-surface, and evidence-backed repo questions.

Default to \`reef_ask\`: it combines codebase, database, findings, diagnostics, instructions, freshness, and quoted literal checks without making the agent orchestrate broad tool chains.

Compact starting surface:
- \`reef_ask\` - primary Reef query over code, DB, findings, diagnostics, and literal checks
- \`reef_status\` - maintained issues, changed files, stale diagnostics, schema, and watcher state
- \`reef_verify\` - completion gate for diagnostics freshness and open loops
- \`reef_impact\` - changed-file impact, invalidated findings, and convention risks
- \`mako_help\` - ordered workflow recipe with prefilled args
- \`live_text_search\` - current-disk regex/glob/raw inventory fallback
- \`lint_files\` - bounded diagnostics and rule-pack findings
- \`tool_batch\` - batch independent read-only follow-ups
- \`tool_search\` - load specialized tools only when the task clearly needs one

Use specialized route, graph, DB, finding, context expansion, refresh, and ack tools through tool search after the compact surface points at a concrete need. Trust state is not filesystem freshness: stable means an answer matches the last comparable answer, not that indexed files are current. Outputs carry evidence refs back to code, schema, or stored facts.`;
