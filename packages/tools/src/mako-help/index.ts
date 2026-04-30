import type {
  JsonObject,
  MakoHelpRecipeId,
  MakoHelpToolInput,
  MakoHelpToolOutput,
  MakoHelpToolStep,
  ToolName,
} from "@mako-ai/contracts";

type Args = Record<string, unknown>;

const DEFAULT_MAX_STEPS = 8;

function locator(input: MakoHelpToolInput): JsonObject {
  if (input.projectId) return { projectId: input.projectId };
  if (input.projectRef) return { projectRef: input.projectRef };
  return {};
}

function withLocator(input: MakoHelpToolInput, args: Args = {}): JsonObject {
  return {
    ...locator(input),
    ...args,
  } as JsonObject;
}

function compactOps(steps: MakoHelpToolStep[]): JsonObject[] {
  return steps
    .filter((step) => step.batchable)
    .map((step) => ({
      label: step.id,
      tool: step.toolName,
      args: step.suggestedArgs,
      resultMode: "summary",
    }));
}

function step(args: {
  id: string;
  phase: MakoHelpToolStep["phase"];
  toolName: ToolName;
  title: string;
  why: string;
  whenToUse: string;
  suggestedArgs: JsonObject;
  readOnly?: boolean;
  batchable?: boolean;
}): MakoHelpToolStep {
  return {
    readOnly: true,
    batchable: false,
    ...args,
  };
}

function firstFile(input: MakoHelpToolInput): string {
  return input.focusFiles?.[0] ?? input.changedFiles?.[0] ?? "<target-file>";
}

function filesForDiagnostics(input: MakoHelpToolInput): string[] {
  return input.changedFiles?.length
    ? input.changedFiles
    : input.focusFiles?.length
      ? input.focusFiles
      : ["<changed-file>"];
}

function classifyRecipe(task: string): MakoHelpRecipeId {
  const lower = task.toLowerCase();
  if (/\b(auth|authorization|session|tenant|role|permission|guard|login|dashboard)\b/.test(lower)) {
    return "auth_flow_audit";
  }
  if (/\b(rls|schema|table|database|postgres|supabase|rpc|policy|migration)\b/.test(lower)) {
    return "db_schema_rls_audit";
  }
  if (/\b(review|audit|verify|verification|regression|precommit|pre-commit)\b/.test(lower)) {
    return "review_verify_changes";
  }
  if (/\b(lint|typescript|typecheck|eslint|diagnostic|error|failing|failure)\b/.test(lower)) {
    return "diagnostics_triage";
  }
  if (/\b(edit|implement|change|fix|preflight|before changing|touch)\b/.test(lower)) {
    return "file_edit_preflight";
  }
  return "general_orientation";
}

function contextPacketStep(input: MakoHelpToolInput, mode: "explore" | "plan" | "implement" | "review" = "explore"): MakoHelpToolStep {
  return step({
    id: "context",
    phase: "orient",
    toolName: "context_packet",
    title: "Start with a scoped context packet",
    why: "Ranks likely files, routes, schema objects, instructions, freshness, findings, risks, and expansion tools before broad searching.",
    whenToUse: "Use first for vague or cross-file work.",
    suggestedArgs: withLocator(input, {
      request: input.task,
      mode,
      ...(input.focusFiles?.length ? { focusFiles: input.focusFiles } : {}),
      ...(input.route ? { focusRoutes: [input.route] } : {}),
      includeInstructions: true,
      includeRisks: true,
      risksMinConfidence: 0.7,
      includeLiveHints: true,
      freshnessPolicy: "prefer_fresh",
      budgetTokens: 4000,
    }),
  });
}

function generalRecipe(input: MakoHelpToolInput): { summary: string; steps: MakoHelpToolStep[]; notes: string[] } {
  const steps = [
    contextPacketStep(input),
    step({
      id: "reef-scout",
      phase: "expand",
      toolName: "reef_scout",
      title: "Ask Reef what it already knows",
      why: "Finds durable facts, findings, rules, conventions, and diagnostic runs relevant to the task.",
      whenToUse: "Use after the packet when the task is still broad or spans project memory.",
      suggestedArgs: withLocator(input, { query: input.task, limit: 10 }),
      batchable: true,
    }),
    step({
      id: "cross-search",
      phase: "expand",
      toolName: "cross_search",
      title: "Fallback to broad indexed search",
      why: "Searches code chunks, routes, schema objects, RPC/trigger bodies, and memories when the first packet is too narrow.",
      whenToUse: "Use when you need more candidate files or symbols.",
      suggestedArgs: withLocator(input, { term: input.task, limit: 20 }),
      batchable: true,
    }),
    step({
      id: "freshness",
      phase: "verify",
      toolName: "project_index_status",
      title: "Check indexed evidence freshness",
      why: "Avoids trusting stale indexed line numbers or missing new files.",
      whenToUse: "Use before relying on indexed evidence after edits or long sessions.",
      suggestedArgs: withLocator(input, { includeUnindexed: false }),
      batchable: true,
    }),
  ];
  return {
    summary: "General Mako orientation: packet first, Reef/project memory second, broad search only when needed, then freshness before relying on exact evidence.",
    steps,
    notes: [
      "Use live_text_search or shell rg for exact current disk text after edits.",
      "Use tool_batch for independent read-only follow-ups after the first context_packet.",
    ],
  };
}

function authRecipe(input: MakoHelpToolInput): { summary: string; steps: MakoHelpToolStep[]; notes: string[] } {
  const authArgs = input.route
    ? { route: input.route }
    : input.focusFiles?.length
      ? { filePath: input.focusFiles[0] }
      : { feature: input.task };
  const steps = [
    contextPacketStep(input, "review"),
    step({
      id: "auth-path",
      phase: "inspect",
      toolName: "auth_path",
      title: "Trace the auth boundary",
      why: "Finds route, file, or feature-level auth evidence and returns a structured cross_search fallback when no exact match exists.",
      whenToUse: "Use for tenant, role, session, guard, and dashboard access questions.",
      suggestedArgs: withLocator(input, authArgs),
      batchable: true,
    }),
    step({
      id: "auth-conventions",
      phase: "inspect",
      toolName: "project_conventions",
      title: "Load project auth conventions",
      why: "Surfaces discovered middleware, guard, runtime, route, generated-file, and schema-usage conventions.",
      whenToUse: "Use before deciding whether a path is canonical or a bypass.",
      suggestedArgs: withLocator(input, { limit: 20 }),
      batchable: true,
    }),
    step({
      id: "open-loops",
      phase: "inspect",
      toolName: "project_open_loops",
      title: "Check known unresolved auth risks",
      why: "Shows active findings, stale facts, failed diagnostics, and other project work that may affect the audit.",
      whenToUse: "Use before editing or declaring an auth path safe.",
      suggestedArgs: withLocator(input, { limit: 20 }),
      batchable: true,
    }),
    step({
      id: "search",
      phase: "expand",
      toolName: "cross_search",
      title: "Search the auth flow broadly",
      why: "Catches canonical helpers, direct table bypasses, route guards, and session/type contracts missed by exact route lookup.",
      whenToUse: "Use when auth_path is incomplete or returns matched:false.",
      suggestedArgs: withLocator(input, { term: input.task, limit: 20 }),
      batchable: true,
    }),
    step({
      id: "file-preflight",
      phase: "pre_edit",
      toolName: "file_preflight",
      title: "Preflight the riskiest file before editing",
      why: "Combines file findings, diagnostic freshness, recent runs, conventions, and ack history in one call.",
      whenToUse: "Use before changing an auth, dashboard, route, or helper file.",
      suggestedArgs: withLocator(input, { filePath: firstFile(input), findingsLimit: 50 }),
      batchable: firstFile(input) !== "<target-file>",
    }),
    step({
      id: "lint-after-edit",
      phase: "post_edit",
      toolName: "lint_files",
      title: "Run focused diagnostics after edits",
      why: "Runs rule packs and alignment diagnostics on changed files and persists findings into Reef.",
      whenToUse: "Use after editing auth or route files.",
      suggestedArgs: withLocator(input, { files: filesForDiagnostics(input), maxFindings: 100 }),
      readOnly: false,
    }),
    step({
      id: "verify",
      phase: "verify",
      toolName: "verification_state",
      title: "Verify diagnostics freshness",
      why: "Reports whether cached diagnostics cover the changed files.",
      whenToUse: "Use before claiming the auth audit or fix is verified.",
      suggestedArgs: withLocator(input, { files: filesForDiagnostics(input) }),
      batchable: true,
    }),
  ];
  return {
    summary: "Auth workflow: context_packet first, auth_path for the boundary, conventions/open loops for project rules, cross_search for fallback, then file_preflight and focused diagnostics around edits.",
    steps,
    notes: [
      "If auth_path returns matched:false, follow its suggested cross_search args.",
      "For exact post-edit text, use live_text_search or shell rg; indexed stability is not filesystem freshness.",
    ],
  };
}

function dbRecipe(input: MakoHelpToolInput): { summary: string; steps: MakoHelpToolStep[]; notes: string[] } {
  const table = input.table ?? "<schema.table>";
  const rpc = input.rpc ?? "<rpc-name>";
  const steps = [
    contextPacketStep(input, "review"),
    step({
      id: "schema-scout",
      phase: "inspect",
      toolName: "reef_scout",
      title: "Classify schema versus app-flow evidence",
      why: "Ranks database facts first for RLS/schema tasks while still surfacing app call sites.",
      whenToUse: "Use when the task mentions RLS, policies, tables, RPCs, or migrations.",
      suggestedArgs: withLocator(input, { query: input.task, limit: 10 }),
      batchable: true,
    }),
    step({
      id: "table-schema",
      phase: "inspect",
      toolName: "db_table_schema",
      title: "Inspect live table shape",
      why: "Reads columns, indexes, constraints, foreign keys, RLS, and triggers from the live database binding.",
      whenToUse: "Use for table-specific work when a DB binding is configured.",
      suggestedArgs: withLocator(input, { table }),
      batchable: input.table != null,
    }),
    step({
      id: "rls",
      phase: "inspect",
      toolName: "db_rls",
      title: "Inspect live RLS policies",
      why: "Reads current row-level security enablement and policies.",
      whenToUse: "Use before reasoning about tenant isolation.",
      suggestedArgs: withLocator(input, { tableName: table }),
      batchable: input.table != null,
    }),
    step({
      id: "table-neighborhood",
      phase: "expand",
      toolName: "table_neighborhood",
      title: "Connect schema to app code",
      why: "Combines table schema, RLS, readers/writers, route handlers, and RPC edges into one bounded bundle.",
      whenToUse: "Use when a table is named or implied by the task.",
      suggestedArgs: withLocator(input, { table }),
      batchable: input.table != null,
    }),
    step({
      id: "rpc-trace",
      phase: "expand",
      toolName: "trace_rpc",
      title: "Trace RPC callers and table refs",
      why: "Shows app callers and table touches for one stored procedure or function.",
      whenToUse: "Use when the task names an RPC or stored procedure.",
      suggestedArgs: withLocator(input, { name: rpc }),
      batchable: input.rpc != null,
    }),
  ];
  return {
    summary: "Database workflow: orient with context_packet, inspect live DB facts for table/RLS/RPC questions, then use neighborhoods/traces to connect schema facts back to app code.",
    steps,
    notes: [
      "Run db_reef_refresh after schema migrations or Supabase type regeneration so Reef-backed tools use current database facts.",
      "If no live DB binding is configured, use reef_scout, schema_usage, trace_rpc, and table_neighborhood against indexed facts.",
    ],
  };
}

function fileEditRecipe(input: MakoHelpToolInput): { summary: string; steps: MakoHelpToolStep[]; notes: string[] } {
  const steps = [
    contextPacketStep(input, "implement"),
    step({
      id: "file-preflight",
      phase: "pre_edit",
      toolName: "file_preflight",
      title: "Run the pre-edit file gate",
      why: "Combines durable findings, diagnostic stale flags, recent diagnostic runs, applicable conventions, and ack history.",
      whenToUse: "Use before editing a named file.",
      suggestedArgs: withLocator(input, { filePath: firstFile(input), findingsLimit: 50 }),
      batchable: firstFile(input) !== "<target-file>",
    }),
    step({
      id: "exact-text",
      phase: "inspect",
      toolName: "live_text_search",
      title: "Check exact live text when needed",
      why: "Reads current disk text without waiting on index refresh.",
      whenToUse: "Use for exact strings after edits or generated/unindexed files.",
      suggestedArgs: withLocator(input, { query: input.task, fixedStrings: true, maxMatches: 50 }),
      batchable: true,
    }),
    step({
      id: "diff-impact",
      phase: "post_edit",
      toolName: "reef_diff_impact",
      title: "Check changed-file impact",
      why: "Composes downstream import callers, active caller findings that may need re-checking, and convention risks for the current diff.",
      whenToUse: "Use mid-edit or after edits when changed files may affect callers.",
      suggestedArgs: withLocator(input, { filePaths: filesForDiagnostics(input), depth: 2 }),
      batchable: true,
    }),
    step({
      id: "lint-after-edit",
      phase: "post_edit",
      toolName: "lint_files",
      title: "Run focused diagnostics after edits",
      why: "Runs rule packs and structural diagnostics on the edited files.",
      whenToUse: "Use after changing TS/JS/TSX/JSX files.",
      suggestedArgs: withLocator(input, { files: filesForDiagnostics(input), maxFindings: 100 }),
      readOnly: false,
    }),
    step({
      id: "verify",
      phase: "verify",
      toolName: "verification_state",
      title: "Confirm diagnostics are fresh",
      why: "Shows whether cached diagnostics cover the current changed files.",
      whenToUse: "Use before finalizing the change.",
      suggestedArgs: withLocator(input, { files: filesForDiagnostics(input) }),
      batchable: true,
    }),
  ];
  return {
    summary: "File-edit workflow: context_packet for scope, file_preflight before touching the file, exact live search when needed, reef_diff_impact mid-edit, then lint_files and verification_state after edits.",
    steps,
    notes: ["If file_preflight uses <target-file>, pass focusFiles or changedFiles to get fully pre-filled args."],
  };
}

function reviewRecipe(input: MakoHelpToolInput): { summary: string; steps: MakoHelpToolStep[]; notes: string[] } {
  const steps = [
    contextPacketStep(input, "review"),
    step({
      id: "open-loops",
      phase: "inspect",
      toolName: "project_open_loops",
      title: "Check unresolved project loops",
      why: "Surfaces active findings, failed diagnostics, and stale evidence before review claims.",
      whenToUse: "Use early in review.",
      suggestedArgs: withLocator(input, { limit: 30 }),
      batchable: true,
    }),
    step({
      id: "file-preflight",
      phase: "inspect",
      toolName: "file_preflight",
      title: "Preflight the touched file",
      why: "Shows file findings, stale diagnostics, conventions, recent runs, and acks.",
      whenToUse: "Use for each risky changed file.",
      suggestedArgs: withLocator(input, { filePath: firstFile(input), findingsLimit: 50 }),
      batchable: firstFile(input) !== "<target-file>",
    }),
    step({
      id: "diff-impact",
      phase: "inspect",
      toolName: "reef_diff_impact",
      title: "Review changed-file impact",
      why: "Shows callers affected by changed files, active findings on those callers, and conventions the diff may violate.",
      whenToUse: "Use before final review when changed files may affect callers.",
      suggestedArgs: withLocator(input, { filePaths: filesForDiagnostics(input), depth: 2 }),
      batchable: true,
    }),
    step({
      id: "verify",
      phase: "verify",
      toolName: "verification_state",
      title: "Check changed-file diagnostic freshness",
      why: "Separates fresh diagnostics from stale or missing verification.",
      whenToUse: "Use before saying a change is verified.",
      suggestedArgs: withLocator(input, { files: filesForDiagnostics(input) }),
      batchable: true,
    }),
    step({
      id: "precommit",
      phase: "verify",
      toolName: "git_precommit_check",
      title: "Run staged boundary checks",
      why: "Checks staged API route auth and Next.js client/server boundary mistakes.",
      whenToUse: "Use before committing staged route or boundary-sensitive changes.",
      suggestedArgs: withLocator(input),
      readOnly: false,
    }),
  ];
  return {
    summary: "Review workflow: use context_packet review mode, inspect open loops, file preflight, and diff impact data, verify diagnostic freshness, then run staged boundary checks when committing.",
    steps,
    notes: ["Use lint_files with changedFiles when verification_state says lint_files is stale."],
  };
}

function diagnosticsRecipe(input: MakoHelpToolInput): { summary: string; steps: MakoHelpToolStep[]; notes: string[] } {
  const steps = [
    contextPacketStep(input, "review"),
    step({
      id: "known-issues",
      phase: "inspect",
      toolName: "reef_known_issues",
      title: "Read maintained known issues",
      why: "Returns current diagnostics and readiness state without launching broad lint or typecheck commands.",
      whenToUse: "Use first when the question is 'what is failing?'",
      suggestedArgs: withLocator(input, { includeAcknowledged: false, limit: 30 }),
      batchable: true,
    }),
    step({
      id: "diagnostic-runs",
      phase: "inspect",
      toolName: "project_diagnostic_runs",
      title: "Inspect recent diagnostic runs",
      why: "Shows which sources ran, failed, or went stale.",
      whenToUse: "Use before rerunning expensive diagnostics.",
      suggestedArgs: withLocator(input, { limit: 30 }),
      batchable: true,
    }),
    step({
      id: "lint-files",
      phase: "post_edit",
      toolName: "lint_files",
      title: "Run focused file diagnostics",
      why: "Runs Mako rule packs and structural diagnostics for selected files.",
      whenToUse: "Use for bounded TS/JS file sets.",
      suggestedArgs: withLocator(input, { files: filesForDiagnostics(input), maxFindings: 100 }),
      readOnly: false,
    }),
    step({
      id: "verification",
      phase: "verify",
      toolName: "verification_state",
      title: "Check freshness after diagnostics",
      why: "Confirms whether diagnostic sources cover the current file revisions.",
      whenToUse: "Use after lint/type diagnostic runs.",
      suggestedArgs: withLocator(input, { files: filesForDiagnostics(input) }),
      batchable: true,
    }),
  ];
  return {
    summary: "Diagnostics workflow: read maintained known issues and recent runs first, then run bounded file diagnostics and verify freshness.",
    steps,
    notes: ["Prefer file-scoped diagnostics over broad project typechecks unless the task needs global TypeScript state."],
  };
}

export async function makoHelpTool(input: MakoHelpToolInput): Promise<MakoHelpToolOutput> {
  const recipeId = classifyRecipe(input.task);
  const recipe = recipeId === "auth_flow_audit"
    ? authRecipe(input)
    : recipeId === "db_schema_rls_audit"
      ? dbRecipe(input)
      : recipeId === "file_edit_preflight"
        ? fileEditRecipe(input)
        : recipeId === "review_verify_changes"
          ? reviewRecipe(input)
          : recipeId === "diagnostics_triage"
            ? diagnosticsRecipe(input)
            : generalRecipe(input);

  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const steps = recipe.steps.slice(0, maxSteps);
  const ops = compactOps(steps);
  const batchArgs = withLocator(input, {
    verbosity: "compact",
    continueOnError: true,
    ops,
  });
  const placeholderNotes = steps.some((entry) => JSON.stringify(entry.suggestedArgs).includes("<"))
    ? ["Some suggestedArgs contain placeholders; pass focusFiles, changedFiles, route, table, or rpc for fully concrete args."]
    : [];

  return {
    toolName: "mako_help",
    task: input.task,
    recipeId,
    summary: recipe.summary,
    steps,
    batchHint: {
      toolName: "tool_batch",
      suggestedArgs: batchArgs,
      eligibleStepIds: steps.filter((entry) => entry.batchable).map((entry) => entry.id),
    },
    notes: [...recipe.notes, ...placeholderNotes],
  };
}
