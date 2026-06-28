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
- \`tool_batch\` - batch independent read-only follow-ups with bounded concurrency
- \`tool_search\` - load specialized tools only when the task clearly needs one

Use \`context_packet\` for messy areas needing ranked raw context, risks, freshness, retrieval plans, expandable tools, or graph expansion. Pass \`focusFiles\`, \`changedFiles\`, \`focusRoutes\`, \`focusSymbols\`, and \`focusDatabaseObjects\`; read \`retrievalDiagnostics.retrievalPlan.level\`, \`strategy\`, \`evidenceGate\`, \`evidenceGaps\`, \`recommendedFollowUps\`, and \`nextStep\`, then run those concrete suggested args when the evidence gate requires expansion. Follow suggested \`repo_map\` args for import-graph PageRank around dependencies and dependents.

Use specialized route, graph, DB, finding, context expansion, refresh, and ack tools through \`tool_search\` after the compact surface points at a concrete need. Use \`tool_batch\` compact summaries for independent follow-ups; with \`continueOnError=true\` the ops run with bounded concurrency and ordered results while top ranked files, graph metadata, risks, retrieval plans, and suggested expansions survive without full payloads. Tune \`maxConcurrency\` when many read-only follow-ups compete for the same store. Trust state is not filesystem freshness: stable means an answer matches the last comparable answer, not that indexed files are current. Outputs carry evidence refs back to code, schema, or stored facts.`;
