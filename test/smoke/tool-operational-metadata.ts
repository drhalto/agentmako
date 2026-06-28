import assert from "node:assert/strict";
import { MAKO_TOOL_NAMES, ToolAnnotationsSchema } from "../../packages/contracts/src/index.ts";
import {
  TOOL_DEFINITIONS,
  TOOL_OPERATIONAL_METADATA,
  attachToolHints,
  getToolOperationalMetadata,
  listToolDefinitions,
  orderByContextLayout,
} from "../../packages/tools/src/index.ts";

function schemaHasHints(schema: unknown): boolean {
  return JSON.stringify(schema).includes("\"_hints\"");
}

function main(): void {
  assert.deepEqual(
    Object.keys(TOOL_OPERATIONAL_METADATA).sort(),
    [...MAKO_TOOL_NAMES].sort(),
    "operational metadata must cover every built-in Mako tool",
  );

  for (const definition of TOOL_DEFINITIONS) {
    const metadata = getToolOperationalMetadata(definition.name);
    ToolAnnotationsSchema.parse(metadata.annotations);
    assert.deepEqual(
      definition.annotations,
      metadata.annotations,
      `${definition.name} must use centralized operational annotations`,
    );
  }

  const summaries = listToolDefinitions();
  for (const summary of summaries) {
    assert.ok(schemaHasHints(summary.outputSchema), `${summary.name} output schema exposes _hints`);
  }

  assert.equal(getToolOperationalMetadata("repo_map").annotations.openWorldHint, undefined);
  assert.equal(getToolOperationalMetadata("db_ping").annotations.openWorldHint, true);
  assert.equal("readOnlyHint" in getToolOperationalMetadata("finding_ack").annotations, false);
  assert.equal(getToolOperationalMetadata("finding_ack_batch").previewDecision, "required");

  const hinted = attachToolHints({
    toolName: "finding_ack",
    input: {},
    annotations: getToolOperationalMetadata("finding_ack").annotations,
    output: {
      toolName: "finding_ack",
      projectId: "project_test",
      preview: true,
      wouldApply: {
        category: "test",
        subjectKind: "ast_match",
        fingerprint: "fingerprint",
        status: "ignored",
        reason: "reviewed",
      },
    },
  });
  assert.ok(hinted._hints.some((hint) => hint.includes("Preview only")));

  const batchHinted = attachToolHints({
    toolName: "tool_batch",
    input: {},
    annotations: getToolOperationalMetadata("tool_batch").annotations,
    output: {
      toolName: "tool_batch",
      projectId: "project_test",
      projectRoot: "/tmp/project",
      results: [],
      summary: {
        requestedOps: 4,
        executedOps: 4,
        succeededOps: 3,
        failedOps: 1,
        rejectedOps: 0,
        durationMs: 300,
        totalOpDurationMs: 900,
        slowestOp: {
          label: "impact",
          tool: "imports_impact",
          durationMs: 500,
          ok: true,
        },
        executionMode: "parallel",
        maxConcurrency: 2,
        concurrencyLimited: true,
      },
      warnings: [],
    },
  });
  assert.ok(
    batchHinted._hints.some((hint) => hint.includes("1 batch op(s) did not succeed")),
    "tool_batch hints should surface failed or rejected ops",
  );
  assert.ok(
    batchHinted._hints.some((hint) => hint.includes("capped at 2")),
    "tool_batch hints should surface bounded concurrency",
  );
  assert.ok(
    batchHinted._hints.some((hint) => hint.includes("Parallel batch saved")),
    "tool_batch hints should surface parallel latency savings",
  );
  assert.ok(
    batchHinted._hints.some((hint) => hint.includes("Slowest batch op was impact")),
    "tool_batch hints should surface the slowest op",
  );

  const contextHinted = attachToolHints({
    toolName: "context_packet",
    input: {},
    annotations: getToolOperationalMetadata("context_packet").annotations,
    output: {
      toolName: "context_packet",
      primaryContext: [{ id: "candidate_1" }],
      relatedContext: [],
      activeFindings: [],
      risks: [],
      freshnessGate: { status: "fresh" },
      graphSummary: {
        files: [
          {
            filePath: "types/auth.ts",
            pathEvidenceCount: 1,
            pathEvidence: [
              {
                anchorFile: "app/api/auth/callback/route.ts",
                targetFile: "types/auth.ts",
                relation: "dependency",
                distance: 2,
                path: ["app/api/auth/callback/route.ts", "lib/auth/session.ts", "types/auth.ts"],
                source: "import_graph_provider",
                strategy: "deterministic_graph",
                reason: "Transitive dependency.",
              },
            ],
          },
        ],
      },
      retrievalDiagnostics: {
        retrievalPlan: {
          level: "broader_context_retrieval",
          strategy: "graph_expansion",
          confidence: 0.82,
          signals: ["graph:isolated"],
          evidenceGate: {
            status: "follow_up_required",
            canAnswerFromPacket: false,
            canEditFromPacket: false,
            blockingReasons: ["Dependency or impact evidence is only file-local or isolated."],
            advisoryReasons: [],
          },
          evidenceGaps: [
            {
              kind: "graph_evidence",
              severity: "blocking",
              message: "Dependency or impact evidence is only file-local or isolated.",
              recommendedTools: ["tool_batch", "imports_impact"],
            },
          ],
          requiredEvidence: ["dependency graph or where-used evidence"],
          recommendedTools: ["tool_batch", "imports_impact"],
          recommendedFollowUps: [
            {
              toolName: "tool_batch",
              suggestedArgs: { verbosity: "compact", continueOnError: true, ops: [] },
              reason: "Run graph follow-ups together.",
              whenToUse: "Use before graph claims.",
              readOnly: true,
            },
          ],
          nextStep: "Run graph follow-up tools before making graph claims.",
        },
        failedProviders: [],
        providersSkippedDetail: [
          {
            provider: "repo_map_provider",
            reason: "Scoped live exact matches already identify current file evidence; centrality-ranked repo map context was skipped.",
            adaptive: true,
          },
        ],
        providerRunCount: 4,
        providerCandidateCount: 3,
        providerExecutionMode: "serial",
        totalProviderDurationMs: 920,
        slowestProvider: {
          provider: "import_graph_provider",
          status: "success",
          candidateCount: 2,
          durationMs: 620,
        },
        liveTextMisses: [],
      },
    },
  });
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("broader context retrieval via graph_expansion")),
    "context_packet hints should expose the retrieval plan level and strategy",
  );
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("Evidence gate: follow-up required")),
    "context_packet hints should expose retrieval-plan evidence gate status",
  );
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("Run graph follow-up tools")),
    "context_packet hints should expose the retrieval plan next step",
  );
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("Recommended follow-up tools: tool_batch, imports_impact")),
    "context_packet hints should expose retrieval-plan recommended tools",
  );
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("graph_evidence:blocking")),
    "context_packet hints should expose retrieval-plan evidence gaps",
  );
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("recommendedFollowUps")),
    "context_packet hints should point agents at executable retrieval-plan follow-ups",
  );
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("Retrieval providers ran serially")),
    "context_packet hints should surface serial provider latency",
  );
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("Slowest retrieval provider was import_graph_provider")),
    "context_packet hints should surface the slowest retrieval provider",
  );
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("Adaptive retrieval skipped 1 provider")),
    "context_packet hints should surface adaptive provider skip reasons",
  );
  assert.ok(
    contextHinted._hints.some((hint) => hint.includes("graphSummary.files[].pathEvidence")),
    "context_packet hints should expose graph path provenance",
  );

  const omittedAnchorHinted = attachToolHints({
    toolName: "context_packet",
    input: {},
    annotations: getToolOperationalMetadata("context_packet").annotations,
    output: {
      toolName: "context_packet",
      primaryContext: [{ id: "candidate_1" }],
      relatedContext: [],
      activeFindings: [],
      risks: [],
      freshnessGate: { status: "fresh" },
      retrievalDiagnostics: {
        retrievalPlan: {
          level: "code_understanding",
          strategy: "entity_lookup",
          confidence: 0.66,
          signals: ["requested_anchors_omitted:1"],
          evidenceGate: {
            status: "follow_up_required",
            canAnswerFromPacket: false,
            canEditFromPacket: false,
            blockingReasons: ["Requested anchors were ranked but omitted from returned context."],
            advisoryReasons: [],
          },
          evidenceGaps: [
            {
              kind: "context_budget",
              severity: "blocking",
              message: "1 requested anchor was ranked but omitted from returned context: database_object:public.user_profiles.",
              recommendedTools: ["table_neighborhood"],
              anchors: [
                {
                  kind: "database_object",
                  value: "public.user_profiles",
                  reason: "selection_limit",
                  candidateId: "database_object:public.user_profiles",
                  score: 88,
                },
              ],
            },
          ],
          requiredEvidence: ["matching definitions, exact literals, or local file context"],
          recommendedTools: ["table_neighborhood"],
          recommendedFollowUps: [
            {
              toolName: "table_neighborhood",
              suggestedArgs: { schemaName: "public", tableName: "user_profiles" },
              reason: "Inspect omitted table evidence.",
              whenToUse: "Use before database claims.",
              readOnly: true,
            },
          ],
          nextStep: "Inspect omitted requested anchors with anchor-specific follow-ups.",
        },
        failedProviders: [],
        providersSkippedDetail: [],
        providerCandidateCount: 1,
        liveTextMisses: [],
      },
    },
  });
  assert.ok(
    omittedAnchorHinted._hints.some((hint) =>
      hint.includes("Omitted requested anchors:") &&
      hint.includes("database_object:public.user_profiles") &&
      hint.includes("table_neighborhood") &&
      hint.includes("recommendedFollowUps")
    ),
    "context_packet hints should name omitted anchors and their executable follow-up tools",
  );

  const symbolMissHinted = attachToolHints({
    toolName: "context_packet",
    input: {},
    annotations: getToolOperationalMetadata("context_packet").annotations,
    output: {
      toolName: "context_packet",
      primaryContext: [{ id: "candidate_1" }],
      relatedContext: [],
      activeFindings: [],
      risks: [],
      freshnessGate: { status: "fresh" },
      retrievalDiagnostics: {
        failedProviders: [],
        providersSkippedDetail: [],
        providerCandidateCount: 1,
        liveTextMisses: [
          {
            query: "MissingSessionSymbol",
            queryKind: "symbol",
            scope: "file",
            scopePath: "src/auth.ts",
          },
        ],
      },
    },
  });
  assert.ok(
    symbolMissHinted._hints.some((hint) =>
      hint.includes("requested symbol was not found in scoped current files") &&
      hint.includes("MissingSessionSymbol") &&
      hint.includes("reef_where_used")
    ),
    "context_packet hints should distinguish scoped symbol misses from quoted literal misses",
  );
  assert.equal(
    symbolMissHinted._hints.some((hint) => hint.includes("quoted literal")),
    false,
    "scoped symbol misses should not produce quoted-literal hint wording",
  );

  const symbolMissWithBaseHints = attachToolHints({
    toolName: "context_packet",
    input: {},
    annotations: getToolOperationalMetadata("context_packet").annotations,
    output: {
      toolName: "context_packet",
      _hints: Array.from({ length: 10 }, (_, index) => `carried source hint ${index + 1}`),
      primaryContext: [{ id: "candidate_1" }],
      relatedContext: [],
      activeFindings: [],
      risks: [],
      freshnessGate: { status: "fresh" },
      retrievalDiagnostics: {
        failedProviders: [],
        providersSkippedDetail: [],
        providerCandidateCount: 1,
        liveTextMisses: [
          {
            query: "MissingSessionSymbol",
            queryKind: "symbol",
            scope: "file",
            scopePath: "src/auth.ts",
          },
        ],
      },
    },
  });
  assert.equal(symbolMissWithBaseHints._hints.length, 8);
  assert.ok(
    symbolMissWithBaseHints._hints.some((hint) =>
      hint.includes("requested symbol was not found in scoped current files") &&
      hint.includes("MissingSessionSymbol")
    ),
    "generated context_packet evidence hints should outrank carried source hints under the global cap",
  );
  assert.ok(
    symbolMissWithBaseHints._hints.some((hint) => hint === "carried source hint 1"),
    "carried source hints should still be preserved when there is room",
  );
  assert.equal(
    symbolMissWithBaseHints._hints.includes("carried source hint 10"),
    false,
    "lower-priority carried source hints should be trimmed before generated evidence hints",
  );

  const noisySymbolMissHinted = attachToolHints({
    toolName: "context_packet",
    input: {},
    annotations: getToolOperationalMetadata("context_packet").annotations,
    output: {
      toolName: "context_packet",
      primaryContext: [{ id: "candidate_1" }],
      relatedContext: [],
      activeFindings: [],
      risks: [{ code: "risk", source: "risk_detector", severity: "medium", confidence: 0.8 }],
      freshnessGate: { status: "fresh" },
      evidenceQuality: {
        label: "partial",
        graph: {
          status: "connected",
          requested: true,
          warningCount: 1,
        },
      },
      requestCoverage: {
        status: "partial",
        uncoveredCount: 1,
        notCheckedCount: 0,
        items: [
          {
            kind: "symbol",
            value: "MissingSessionSymbol",
            status: "uncovered",
            matchedBy: [],
            reason: "Requested symbol was not represented.",
          },
        ],
      },
      retrievalDiagnostics: {
        retrievalPlan: {
          level: "issue_to_edit_localization",
          strategy: "entity_lookup",
          confidence: 0.61,
          signals: ["focus_files:1", "coverage:partial"],
          evidenceGate: {
            status: "follow_up_required",
            canAnswerFromPacket: false,
            canEditFromPacket: false,
            blockingReasons: ["Requested anchors are unresolved or only partially covered."],
            advisoryReasons: ["Edit or review work should run follow-ups."],
          },
          evidenceGaps: [
            {
              kind: "request_coverage",
              severity: "blocking",
              message: "Requested anchors are unresolved or only partially covered.",
              recommendedTools: ["reef_where_used", "live_text_search"],
            },
            {
              kind: "edit_localization",
              severity: "advisory",
              message: "Run follow-ups before final claims.",
              recommendedTools: ["verification_state"],
            },
          ],
          requiredEvidence: ["target file or changed file evidence", "fresh diagnostics before claiming the fix is verified"],
          recommendedTools: ["reef_where_used", "live_text_search", "verification_state"],
          recommendedFollowUps: [
            {
              toolName: "reef_where_used",
              suggestedArgs: { query: "MissingSessionSymbol", targetKind: "symbol" },
              reason: "Inspect symbol usages.",
              whenToUse: "Use before trusting stale symbol evidence.",
              readOnly: true,
            },
          ],
          nextStep: "Resolve uncovered requested anchors with expandableTools or live_text_search before relying on broad claims.",
        },
        failedProviders: [],
        providersSkippedDetail: [
          {
            provider: "repo_map_provider",
            reason: "Focused file anchors narrowed retrieval.",
            adaptive: true,
          },
        ],
        providerRunCount: 4,
        providerCandidateCount: 3,
        providerExecutionMode: "serial",
        totalProviderDurationMs: 900,
        slowestProvider: {
          provider: "symbol_provider",
          status: "success",
          candidateCount: 0,
          durationMs: 500,
        },
        liveTextMisses: [
          {
            query: "MissingSessionSymbol",
            queryKind: "symbol",
            scope: "file",
            scopePath: "src/auth.ts",
          },
        ],
      },
    },
  });
  assert.equal(noisySymbolMissHinted._hints.length, 8);
  assert.ok(
    noisySymbolMissHinted._hints.some((hint) =>
      hint.includes("requested symbol was not found in scoped current files") &&
      hint.includes("MissingSessionSymbol")
    ),
    "capped context_packet hints should retain scoped symbol miss guidance",
  );

  const boundedGraphHinted = attachToolHints({
    toolName: "context_packet",
    input: {},
    annotations: getToolOperationalMetadata("context_packet").annotations,
    output: {
      toolName: "context_packet",
      primaryContext: [{ id: "candidate_1" }],
      relatedContext: [],
      activeFindings: [],
      risks: [],
      freshnessGate: { status: "fresh" },
      evidenceQuality: {
        label: "usable",
        graph: {
          status: "connected",
          requested: true,
          warningCount: 1,
        },
      },
      requestCoverage: {
        status: "complete",
        uncoveredCount: 0,
        notCheckedCount: 0,
      },
      retrievalDiagnostics: {
        failedProviders: [],
        providersSkippedDetail: [],
        providerCandidateCount: 3,
        liveTextMisses: [],
      },
    },
  });
  assert.ok(
    boundedGraphHinted._hints.some((hint) => hint.includes("bounded or warning-labeled")),
    "context_packet hints should call out bounded graph evidence before exhaustive graph claims",
  );

  const partialCoverageHinted = attachToolHints({
    toolName: "context_packet",
    input: {},
    annotations: getToolOperationalMetadata("context_packet").annotations,
    output: {
      toolName: "context_packet",
      primaryContext: [],
      relatedContext: [],
      activeFindings: [],
      risks: [],
      freshnessGate: { status: "fresh" },
      evidenceQuality: {
        label: "partial",
        graph: { status: "not_requested", requested: false, warningCount: 0 },
      },
      requestCoverage: {
        status: "partial",
        uncoveredCount: 1,
        notCheckedCount: 1,
        items: [
          {
            kind: "symbol",
            value: "MissingWidget",
            status: "uncovered",
            matchedBy: [],
            reason: "Requested symbol was not represented.",
          },
          {
            kind: "quoted_text",
            value: "save failed",
            status: "not_checked",
            matchedBy: [],
            reason: "Requested literal was not checked.",
          },
        ],
      },
      retrievalDiagnostics: {
        failedProviders: [],
        providersSkippedDetail: [],
        providerCandidateCount: 0,
        liveTextMisses: [],
      },
    },
  });
  assert.ok(
    partialCoverageHinted._hints.some((hint) =>
      hint.includes("Unresolved requested context:") &&
      hint.includes("symbol:MissingWidget (uncovered)") &&
      hint.includes("quoted_text:save failed (not_checked)")
    ),
    "context_packet hints should name unresolved request coverage items",
  );

  const compactPartialCoverageHinted = attachToolHints({
    toolName: "context_packet",
    input: {},
    annotations: getToolOperationalMetadata("context_packet").annotations,
    output: {
      toolName: "context_packet",
      primaryContext: [],
      relatedContext: [],
      activeFindings: [],
      risks: [],
      freshnessGate: { status: "fresh" },
      requestCoverage: {
        status: "partial",
        uncoveredCount: 1,
        notCheckedCount: 0,
      },
      retrievalDiagnostics: {
        retrievalPlan: {
          level: "issue_to_edit_localization",
          strategy: "entity_lookup",
          confidence: 0.5,
          evidenceGate: {
            status: "follow_up_required",
            canAnswerFromPacket: false,
            canEditFromPacket: false,
          },
          recommendedTools: ["live_text_search"],
          nextStep: "Resolve uncovered requested anchors before relying on broad claims.",
        },
        providerCandidateCount: 0,
      },
    },
  });
  assert.ok(
    compactPartialCoverageHinted._hints.some((hint) =>
      hint.includes("Evidence gate: follow-up required") &&
      hint.includes("evidenceGaps")
    ),
    "context_packet hints should tolerate compact retrieval gates without blockingReasons",
  );
  assert.ok(
    compactPartialCoverageHinted._hints.some((hint) =>
      hint.includes("verify retrieval-plan required evidence")
    ),
    "context_packet hints should tolerate compact retrieval plans without requiredEvidence",
  );
  assert.ok(
    compactPartialCoverageHinted._hints.some((hint) =>
      hint.includes("1 requested anchor(s) were not covered")
    ),
    "context_packet hints should tolerate partial request coverage without item details",
  );

  const helpHinted = attachToolHints({
    toolName: "mako_help",
    input: {},
    annotations: getToolOperationalMetadata("mako_help").annotations,
    output: {
      toolName: "mako_help",
      task: "understand feature wiring",
      recipeId: "general_orientation",
      summary: "General orientation",
      steps: [
        {
          id: "reef-ask",
          phase: "orient",
          toolName: "reef_ask",
          title: "Ask Reef",
          why: "Compile context",
          whenToUse: "Use first",
          suggestedArgs: {},
          readOnly: true,
          batchable: false,
        },
        {
          id: "repo-map",
          phase: "expand",
          toolName: "repo_map",
          title: "Map repo",
          why: "Expand graph context",
          whenToUse: "Use after orienting",
          suggestedArgs: {},
          readOnly: true,
          batchable: true,
        },
        {
          id: "cross-search",
          phase: "expand",
          toolName: "cross_search",
          title: "Search broadly",
          why: "Find more candidates",
          whenToUse: "Use when narrow context is incomplete",
          suggestedArgs: {},
          readOnly: true,
          batchable: true,
        },
      ],
      batchHint: {
        toolName: "tool_batch",
        suggestedArgs: { verbosity: "compact", continueOnError: true, ops: [] },
        eligibleStepIds: ["repo-map", "cross-search"],
      },
      retrievalPlanGuide: {
        sourceStepId: "context",
        planPath: "retrievalDiagnostics.retrievalPlan",
        recommendedToolsPath: "retrievalDiagnostics.retrievalPlan.recommendedTools",
        recommendedFollowUpsPath: "retrievalDiagnostics.retrievalPlan.recommendedFollowUps",
        expandableToolsPath: "expandableTools",
        requiredEvidencePath: "retrievalDiagnostics.retrievalPlan.requiredEvidence",
        evidenceGapsPath: "retrievalDiagnostics.retrievalPlan.evidenceGaps",
        preferToolBatch: true,
        evidenceGate: "Treat evidenceGaps and requiredEvidence as the checklist before broad claims.",
        strategyActions: [
          { strategy: "entity_lookup", action: "Use anchors first." },
          { strategy: "graph_expansion", action: "Run graph expansion." },
        ],
      },
      notes: [],
    },
  });
  assert.ok(
    helpHinted._hints.some((hint) => hint.includes("Retrieval-plan guide")),
    "mako_help hints should expose retrieval-plan guide paths",
  );
  assert.ok(
    helpHinted._hints.some((hint) => hint.includes("Use tool_batch")),
    "mako_help hints should preserve the tool_batch fast-path recommendation",
  );

  const ordered = orderByContextLayout([
    { id: "middle" },
    { id: "end", layoutZone: "end" as const },
    { id: "start", layoutZone: "start" as const },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["start", "middle", "end"]);

  console.log("tool-operational-metadata: PASS");
}

main();
