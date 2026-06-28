export const MAKO_SERVER_INSTRUCTIONS = `mako is project-intelligence for structural, cross-surface, and evidence-backed repo questions.

Default to \`reef_ask\`: it combines codebase, database, findings, diagnostics, instructions, freshness, and quoted literal checks.

Compact starting surface:
- \`reef_ask\` - primary Reef query over code, DB, findings, diagnostics, literals
- \`reef_status\` - issues, changed files, stale diagnostics, schema, watcher state
- \`reef_verify\` - completion gate for diagnostics freshness and open loops
- \`reef_impact\` - changed-file impact, invalidated findings, convention risks
- \`mako_help\` - ordered workflow recipe with prefilled args
- \`live_text_search\` - current-disk regex/glob/raw fallback
- \`lint_files\` - bounded diagnostics and rule-pack findings
- \`tool_batch\` - batch independent read-only follow-ups
- \`tool_search\` - load specialized tools only when the task needs one

Use \`context_packet\` for messy areas needing ranked raw context, risks, freshness, retrieval plans, or graph expansion. Pass \`focusFiles\`, \`changedFiles\`, \`focusRoutes\`, \`focusSymbols\`, and \`focusDatabaseObjects\`; read \`retrievalDiagnostics.retrievalPlan.level\`, \`evidenceGate\`, \`evidenceGaps\`, \`recommendedFollowUps\`, and \`nextStep\`, then run the follow-ups when the gate requires expansion. Follow suggested \`repo_map\` args for import-graph PageRank around dependencies and dependents.

Reach specialized route, graph, DB, finding, refresh, and ack tools via \`tool_search\` when the compact surface points at a concrete need. Use \`tool_batch\` compact summaries so top ranked files, graph metadata, risks, and suggested expansions survive without full payloads; with \`continueOnError=true\` ops run with bounded concurrency (tune \`maxConcurrency\`). Trust state is not filesystem freshness: stable means an answer matches the last comparable answer, not that indexed files are current. Outputs carry evidence refs to code, schema, or stored facts.`;
