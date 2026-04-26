import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AnswerResult } from "../../packages/contracts/src/answer.ts";
import {
  ChangePlanToolOutputSchema,
  FlowMapToolOutputSchema,
  GraphNeighborsToolOutputSchema,
  GraphPathToolOutputSchema,
  HealthTrendToolOutputSchema,
  InvestigateToolOutputSchema,
  IssuesNextToolOutputSchema,
  SessionHandoffToolOutputSchema,
  SuggestToolOutputSchema,
  TenantLeakAuditToolOutputSchema,
} from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import {
  decidePowerWorkflowExposure,
  evaluatePowerWorkflowUsefulness,
  summarizePowerWorkflowPromotionMetrics,
} from "../../packages/tools/src/workflow-evaluation.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function createAnswerResult(args: {
  projectId: string;
  queryId: string;
  queryKind: AnswerResult["queryKind"];
  queryText: string;
  answer?: string;
}): AnswerResult {
  return {
    queryId: args.queryId,
    projectId: args.projectId,
    queryKind: args.queryKind,
    tierUsed: "standard",
    supportLevel: "native",
    evidenceStatus: "complete",
    answer: args.answer,
    answerConfidence: 0.9,
    packet: {
      queryId: args.queryId,
      projectId: args.projectId,
      queryKind: args.queryKind,
      queryText: args.queryText,
      tierUsed: "standard",
      supportLevel: "native",
      evidenceStatus: "complete",
      evidenceConfidence: 0.9,
      missingInformation: [],
      stalenessFlags: [],
      evidence: [],
      generatedAt: "2026-04-20T00:00:00.000Z",
    },
    candidateActions: [],
  };
}

function seedGraphAndWorkflowProject(projectRoot: string, projectId: string): void {
  mkdirSync(path.join(projectRoot, "app", "api", "events"), { recursive: true });

  const routeBody = [
    "import { supabase } from '../../../../src/supabase';",
    "",
    "function loadTenant() { return 'tenant'; }",
    "function normalizeEvents() { return []; }",
    "",
    "export async function GET() {",
    "  await supabase.rpc('refresh_events');",
    "  return Response.json(normalizeEvents());",
    "}",
  ].join("\n");

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "power-workflow-evaluation-graph", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "app", "api", "events", "route.ts"), routeBody);

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "power-workflow-evaluation-graph",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "native",
    });
  } finally {
    globalStore.close();
  }

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "power-workflow-evaluation-graph",
      rootPath: projectRoot,
      framework: "nextjs",
      orm: "supabase",
      srcRoot: "src",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "native",
      authz: {
        presetId: "supabase-multi-tenant",
        adminValues: ["admin"],
        tenantForeignKey: "tenant_id",
      },
      detectedAt: new Date().toISOString(),
    });

    store.replaceIndexSnapshot({
      files: [
        {
          path: "app/api/events/route.ts",
          sha256: "route",
          language: "typescript",
          sizeBytes: routeBody.length,
          lineCount: routeBody.split("\n").length,
          chunks: [
            {
              chunkKind: "file",
              name: "app/api/events/route.ts",
              lineStart: 1,
              lineEnd: routeBody.split("\n").length,
              content: routeBody,
            },
          ],
          symbols: [
            {
              name: "loadTenant",
              kind: "function",
              lineStart: 3,
              lineEnd: 3,
            },
            {
              name: "normalizeEvents",
              kind: "function",
              lineStart: 4,
              lineEnd: 4,
            },
            {
              name: "GET",
              kind: "function",
              exportName: "GET",
              lineStart: 6,
              lineEnd: 9,
            },
          ],
          imports: [],
          routes: [
            {
              routeKey: "GET /api/events",
              framework: "nextjs-app-router",
              pattern: "/api/events",
              method: "GET",
              handlerName: "GET",
              isApi: true,
            },
          ],
        },
      ],
      schemaObjects: [
        {
          objectKey: "public.refresh_events",
          objectType: "rpc",
          schemaName: "public",
          objectName: "refresh_events",
        },
      ],
      schemaUsages: [
        {
          objectKey: "public.refresh_events",
          filePath: "app/api/events/route.ts",
          usageKind: "rpc_call",
          line: 7,
          excerpt: "supabase.rpc('refresh_events')",
        },
      ],
    });

    const now = new Date().toISOString();
    store.saveSchemaSnapshot({
      snapshotId: "power_workflow_eval_graph_snapshot",
      sourceMode: "repo_only",
      generatedAt: now,
      refreshedAt: now,
      fingerprint: "power-workflow-evaluation-graph",
      freshnessStatus: "fresh",
      driftDetected: false,
      sources: [],
      warnings: [],
      ir: {
        version: "1.0.0",
        schemas: {
          public: {
            tables: [
              {
                name: "events",
                schema: "public",
                columns: [
                  {
                    name: "id",
                    dataType: "uuid",
                    nullable: false,
                    isPrimaryKey: true,
                    sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_events.sql", line: 1 }],
                  },
                  {
                    name: "tenant_id",
                    dataType: "uuid",
                    nullable: false,
                    sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_events.sql", line: 2 }],
                  },
                ],
                rls: {
                  rlsEnabled: false,
                  forceRls: false,
                  policies: [],
                },
                triggers: [
                  {
                    name: "events_touch",
                    enabled: true,
                    enabledMode: "O",
                    timing: "BEFORE",
                    events: ["UPDATE"],
                    bodyText: "EXECUTE FUNCTION touch_updated_at()",
                  },
                ],
                sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_events.sql", line: 1 }],
              },
              {
                name: "projects",
                schema: "public",
                columns: [
                  {
                    name: "id",
                    dataType: "uuid",
                    nullable: false,
                    isPrimaryKey: true,
                    sources: [{ kind: "sql_migration", path: "supabase/migrations/0002_projects.sql", line: 1 }],
                  },
                  {
                    name: "tenant_id",
                    dataType: "uuid",
                    nullable: false,
                    sources: [{ kind: "sql_migration", path: "supabase/migrations/0002_projects.sql", line: 2 }],
                  },
                ],
                rls: {
                  rlsEnabled: true,
                  forceRls: false,
                  policies: [
                    {
                      name: "projects_read",
                      mode: "PERMISSIVE",
                      command: "SELECT",
                      roles: ["authenticated"],
                      usingExpression: "current_tenant() = user_tenant()",
                      withCheckExpression: null,
                    },
                  ],
                },
                triggers: [],
                sources: [{ kind: "sql_migration", path: "supabase/migrations/0002_projects.sql", line: 1 }],
              },
            ],
            views: [],
            enums: [],
            rpcs: [
              {
                name: "refresh_events",
                schema: "public",
                argTypes: [],
                sources: [{ kind: "sql_migration", path: "supabase/migrations/0003_refresh_events.sql", line: 1 }],
                bodyText: "BEGIN UPDATE public.events SET id = id; END;",
              },
            ],
          },
        },
      },
    });
  } finally {
    store.close();
  }
}

function seedProjectIntelligenceProject(projectRoot: string, projectId: string): void {
  mkdirSync(path.join(projectRoot, "src", "orders"), { recursive: true });
  mkdirSync(path.join(projectRoot, "src", "dashboard"), { recursive: true });

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "power-workflow-evaluation-project-intel", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "src", "orders", "service.ts"), "export function loadOrders() { return []; }\n");
  writeFileSync(path.join(projectRoot, "src", "dashboard", "page.tsx"), "export default function Page() { return null; }\n");

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "power-workflow-evaluation-project-intel",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "native",
    });
  } finally {
    globalStore.close();
  }

  const store = openProjectStore({ projectRoot });
  try {
    store.replaceIndexSnapshot({
      files: [
        {
          path: "src/orders/service.ts",
          sha256: "orders",
          language: "typescript",
          sizeBytes: 42,
          lineCount: 1,
          chunks: [{ chunkKind: "file", content: "export function loadOrders() { return []; }" }],
          symbols: [{ name: "loadOrders", kind: "function", exportName: "loadOrders", lineStart: 1, lineEnd: 1 }],
          imports: [],
          routes: [],
        },
        {
          path: "src/dashboard/page.tsx",
          sha256: "dashboard",
          language: "typescript",
          sizeBytes: 46,
          lineCount: 1,
          chunks: [{ chunkKind: "file", content: "export default function Page() { return null; }" }],
          symbols: [{ name: "Page", kind: "function", exportName: "default", lineStart: 1, lineEnd: 1 }],
          imports: [],
          routes: [],
        },
      ],
      schemaObjects: [],
      schemaUsages: [],
    });

    store.saveSchemaSnapshot({
      snapshotId: "power_workflow_eval_project_intelligence_snapshot",
      sourceMode: "repo_only",
      generatedAt: "2026-04-20T00:30:00.000Z",
      refreshedAt: "2026-04-20T00:30:00.000Z",
      fingerprint: "power-workflow-evaluation-project-intel",
      freshnessStatus: "fresh",
      driftDetected: false,
      sources: [],
      warnings: [],
      ir: { version: "1.0.0", schemas: {} },
    });

    const prior = store.saveAnswerTrace(
      createAnswerResult({
        projectId,
        queryId: "trace_prior",
        queryKind: "trace_file",
        queryText: "src/orders/service.ts",
        answer: "Prior context",
      }),
    );
    const current = store.saveAnswerTrace(
      createAnswerResult({
        projectId,
        queryId: "trace_current",
        queryKind: "trace_file",
        queryText: "src/orders/service.ts",
        answer: "Current context",
      }),
    );
    const stable = store.saveAnswerTrace(
      createAnswerResult({
        projectId,
        queryId: "file_health_stable",
        queryKind: "file_health",
        queryText: "src/dashboard/page.tsx",
        answer: "Stable dashboard page",
      }),
    );
    const missingEval = store.saveAnswerTrace(
      createAnswerResult({
        projectId,
        queryId: "trace_missing_eval",
        queryKind: "trace_file",
        queryText: "src/orders/service.ts",
        answer: "Older trace without direct evaluation",
      }),
    );

    store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
      "2026-04-20T00:00:00.000Z",
      prior.traceId,
    );
    store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
      "2026-04-20T00:10:00.000Z",
      current.traceId,
    );
    store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
      "2026-04-20T00:20:00.000Z",
      stable.traceId,
    );
    store.db.prepare(`UPDATE answer_traces SET created_at = ? WHERE trace_id = ?`).run(
      "2026-04-20T00:05:00.000Z",
      missingEval.traceId,
    );

    const priorRun = store.getAnswerTrustRun(prior.traceId)!;
    const currentRun = store.getAnswerTrustRun(current.traceId)!;
    const stableRun = store.getAnswerTrustRun(stable.traceId)!;

    store.insertAnswerTrustEvaluation({
      targetId: priorRun.targetId,
      traceId: prior.traceId,
      state: "stable",
      reasons: [{ code: "no_meaningful_change", detail: "baseline trace" }],
      basisTraceIds: [prior.traceId],
      conflictingFacets: [],
      scopeRelation: "same_scope",
      createdAt: "2026-04-20T00:01:00.000Z",
    });

    const comparison = store.insertAnswerComparison({
      targetId: currentRun.targetId,
      priorTraceId: prior.traceId,
      currentTraceId: current.traceId,
      summaryChanges: [{ code: "answer_markdown_changed", detail: "rerun changed materially" }],
      rawDelta: { changed: true },
      meaningfulChangeDetected: true,
      provenance: "interactive",
      createdAt: "2026-04-20T00:11:00.000Z",
    });

    store.insertAnswerTrustEvaluation({
      targetId: currentRun.targetId,
      traceId: current.traceId,
      comparisonId: comparison.comparisonId,
      state: "changed",
      reasons: [{ code: "meaningful_change_detected", detail: "rerun changed materially" }],
      basisTraceIds: [prior.traceId, current.traceId],
      conflictingFacets: ["answer_markdown"],
      scopeRelation: "same_scope",
      createdAt: "2026-04-20T00:12:00.000Z",
    });

    store.insertWorkflowFollowup({
      projectId,
      originQueryId: current.traceId,
      originActionId: "workflow_handoff:verification_plan:trace_current",
      originPacketId: "workflow_packet_current",
      originPacketFamily: "verification_plan",
      originQueryKind: "trace_file",
      executedToolName: "workflow_packet",
      executedInput: {
        projectId,
        family: "verification_plan",
        queryKind: "trace_file",
        queryText: "src/orders/service.ts",
      },
      resultPacketId: "workflow_packet_result",
      resultPacketFamily: "verification_plan",
      resultQueryId: "workflow_packet_query",
      createdAt: "2026-04-20T00:15:00.000Z",
    });

    store.insertAnswerTrustEvaluation({
      targetId: stableRun.targetId,
      traceId: stable.traceId,
      state: "stable",
      reasons: [{ code: "no_meaningful_change", detail: "dashboard page is stable" }],
      basisTraceIds: [stable.traceId],
      conflictingFacets: [],
      scopeRelation: "same_scope",
      createdAt: "2026-04-20T00:21:00.000Z",
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-power-workflow-eval-"));
  const stateHome = path.join(tmp, "state");
  const graphProjectRoot = path.join(tmp, "graph-project");
  const projectIntelRoot = path.join(tmp, "project-intel-project");

  mkdirSync(stateHome, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const graphProjectId = randomUUID();
  const projectIntelId = randomUUID();

  try {
    seedGraphAndWorkflowProject(graphProjectRoot, graphProjectId);
    seedProjectIntelligenceProject(projectIntelRoot, projectIntelId);

    const graphNeighbors = GraphNeighborsToolOutputSchema.parse(
      await invokeTool("graph_neighbors", {
        projectId: graphProjectId,
        startEntities: [{ kind: "route", key: "GET /api/events" }],
        direction: "both",
        traversalDepth: 1,
      }),
    );
    const graphPath = GraphPathToolOutputSchema.parse(
      await invokeTool("graph_path", {
        projectId: graphProjectId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 4,
        includeHeuristicEdges: true,
      }),
    );
    const flowMap = FlowMapToolOutputSchema.parse(
      await invokeTool("flow_map", {
        projectId: graphProjectId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 4,
        includeHeuristicEdges: true,
      }),
    );
    const changePlan = ChangePlanToolOutputSchema.parse(
      await invokeTool("change_plan", {
        projectId: graphProjectId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 4,
        includeHeuristicEdges: true,
      }),
    );
    const tenantAudit = TenantLeakAuditToolOutputSchema.parse(
      await invokeTool("tenant_leak_audit", {
        projectId: graphProjectId,
        acknowledgeAdvisory: true,
      }),
    );
    const suggest = SuggestToolOutputSchema.parse(
      await invokeTool("suggest", {
        projectId: graphProjectId,
        question: "How does GET /api/events flow to public.events and what changes if I modify it?",
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        includeHeuristicEdges: true,
      }),
    );
    const unsupportedSuggest = SuggestToolOutputSchema.parse(
      await invokeTool("suggest", {
        projectId: graphProjectId,
        question: "How is district sync approval enforced?",
      }),
    );
    const investigate = InvestigateToolOutputSchema.parse(
      await invokeTool("investigate", {
        projectId: graphProjectId,
        question: "How does GET /api/events flow to public.events and what changes if I modify it?",
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        includeHeuristicEdges: true,
      }),
    );
    const unsupportedInvestigate = InvestigateToolOutputSchema.parse(
      await invokeTool("investigate", {
        projectId: graphProjectId,
        question: "How is district sync approval enforced?",
      }),
    );

    const sessionHandoff = SessionHandoffToolOutputSchema.parse(
      await invokeTool("session_handoff", { projectId: projectIntelId }),
    );
    const healthTrend = HealthTrendToolOutputSchema.parse(
      await invokeTool("health_trend", { projectId: projectIntelId }),
    );
    const issuesNext = IssuesNextToolOutputSchema.parse(
      await invokeTool("issues_next", { projectId: projectIntelId }),
    );

    const graphNeighborsEval = evaluatePowerWorkflowUsefulness(graphNeighbors)!;
    const graphPathEval = evaluatePowerWorkflowUsefulness(graphPath)!;
    const flowMapEval = evaluatePowerWorkflowUsefulness(flowMap)!;
    const changePlanEval = evaluatePowerWorkflowUsefulness(changePlan)!;
    const tenantAuditEval = evaluatePowerWorkflowUsefulness(tenantAudit)!;
    const sessionHandoffEval = evaluatePowerWorkflowUsefulness(sessionHandoff)!;
    const healthTrendEval = evaluatePowerWorkflowUsefulness(healthTrend)!;
    const issuesNextEval = evaluatePowerWorkflowUsefulness(issuesNext)!;
    const suggestEval = evaluatePowerWorkflowUsefulness(suggest)!;
    const unsupportedSuggestEval = evaluatePowerWorkflowUsefulness(unsupportedSuggest)!;
    const investigateEval = evaluatePowerWorkflowUsefulness(investigate)!;
    const unsupportedInvestigateEval = evaluatePowerWorkflowUsefulness(unsupportedInvestigate)!;

    assert.equal(graphNeighborsEval.grade, "partial");
    assert.deepEqual(graphNeighborsEval.reasonCodes.includes("graph_results_present"), true);

    assert.equal(graphPathEval.grade, "partial");
    assert.deepEqual(graphPathEval.reasonCodes.includes("path_found"), true);
    assert.deepEqual(graphPathEval.reasonCodes.includes("heuristic_edge_used"), true);

    assert.equal(flowMapEval.grade, "full");
    assert.deepEqual(flowMapEval.reasonCodes.includes("flow_steps_present"), true);
    assert.deepEqual(flowMapEval.reasonCodes.includes("major_boundaries_present"), true);

    assert.equal(changePlanEval.grade, "full");
    assert.deepEqual(changePlanEval.reasonCodes.includes("change_surfaces_present"), true);
    assert.deepEqual(changePlanEval.reasonCodes.includes("follow_on_present"), true);

    assert.equal(tenantAuditEval.grade, "full");
    assert.deepEqual(tenantAuditEval.reasonCodes.includes("tenant_direct_evidence_present"), true);
    assert.deepEqual(tenantAuditEval.reasonCodes.includes("advisory_only"), true);

    assert.equal(sessionHandoffEval.grade, "full");
    assert.deepEqual(sessionHandoffEval.reasonCodes.includes("current_focus_present"), true);
    assert.deepEqual(sessionHandoffEval.reasonCodes.includes("stop_conditions_present"), true);

    assert.equal(healthTrendEval.grade, "partial");
    assert.deepEqual(healthTrendEval.reasonCodes.includes("trend_history_present"), true);

    assert.equal(issuesNextEval.grade, "partial");
    assert.deepEqual(issuesNextEval.reasonCodes.includes("current_issue_present"), true);

    assert.equal(suggestEval.grade, "partial");
    assert.deepEqual(suggestEval.reasonCodes.includes("bounded_sequence_suggested"), true);
    assert.equal(unsupportedSuggestEval.grade, "no");
    assert.deepEqual(unsupportedSuggestEval.reasonCodes.includes("unsupported_result"), true);

    assert.equal(investigateEval.grade, "full");
    assert.deepEqual(investigateEval.reasonCodes.includes("investigation_completed"), true);
    assert.deepEqual(investigateEval.reasonCodes.includes("follow_on_present"), true);
    assert.equal(unsupportedInvestigateEval.grade, "no");
    assert.deepEqual(unsupportedInvestigateEval.reasonCodes.includes("unsupported_result"), true);

    const metrics = summarizePowerWorkflowPromotionMetrics([
      graphNeighborsEval,
      graphPathEval,
      flowMapEval,
      changePlanEval,
      tenantAuditEval,
      sessionHandoffEval,
      healthTrendEval,
      issuesNextEval,
      suggestEval,
      investigateEval,
    ]);
    const unsupportedMetrics = summarizePowerWorkflowPromotionMetrics([
      unsupportedSuggestEval,
      unsupportedInvestigateEval,
    ]);
    const metricByTool = new Map(metrics.map((item) => [item.toolName, item] as const));
    const unsupportedMetricByTool = new Map(
      unsupportedMetrics.map((item) => [item.toolName, item] as const),
    );

    assert.equal(metricByTool.get("graph_neighbors")?.helpfulRate, 1);
    assert.equal(metricByTool.get("graph_path")?.helpfulRate, 1);
    assert.equal(metricByTool.get("flow_map")?.helpfulRate, 1);
    assert.equal(metricByTool.get("change_plan")?.helpfulRate, 1);
    assert.equal(metricByTool.get("tenant_leak_audit")?.helpfulRate, 1);
    assert.equal(metricByTool.get("session_handoff")?.helpfulRate, 1);
    assert.equal(metricByTool.get("health_trend")?.helpfulRate, 1);
    assert.equal(metricByTool.get("issues_next")?.helpfulRate, 1);
    assert.equal(metricByTool.get("suggest")?.helpfulRate, 1);
    assert.equal(metricByTool.get("investigate")?.helpfulRate, 1);
    assert.equal(metricByTool.get("suggest")?.noNoiseRate, 1);
    assert.equal(unsupportedMetricByTool.get("suggest")?.helpfulRate, 0);
    assert.equal(unsupportedMetricByTool.get("suggest")?.noNoiseRate, 0);
    assert.equal(unsupportedMetricByTool.get("investigate")?.helpfulRate, 0);
    assert.equal(unsupportedMetricByTool.get("investigate")?.noNoiseRate, 0);

    const graphNeighborsDecision = decidePowerWorkflowExposure(metricByTool.get("graph_neighbors")!);
    const suggestDecision = decidePowerWorkflowExposure(metricByTool.get("suggest")!);
    const unsupportedInvestigateDecision = decidePowerWorkflowExposure(
      unsupportedMetricByTool.get("investigate")!,
    );

    assert.equal(graphNeighborsDecision.exposure, "default");
    assert.equal(graphNeighborsDecision.targetExposure, "default");
    assert.equal(graphNeighborsDecision.promotionPath, "target_met");
    assert.equal(decidePowerWorkflowExposure(metricByTool.get("graph_path")!).exposure, "default");
    assert.equal(decidePowerWorkflowExposure(metricByTool.get("flow_map")!).exposure, "default");
    assert.equal(decidePowerWorkflowExposure(metricByTool.get("change_plan")!).exposure, "opt_in");
    assert.equal(decidePowerWorkflowExposure(metricByTool.get("tenant_leak_audit")!).exposure, "dark");
    assert.equal(decidePowerWorkflowExposure(metricByTool.get("session_handoff")!).exposure, "opt_in");
    assert.equal(decidePowerWorkflowExposure(metricByTool.get("health_trend")!).exposure, "opt_in");
    assert.equal(decidePowerWorkflowExposure(metricByTool.get("issues_next")!).exposure, "opt_in");
    assert.equal(suggestDecision.exposure, "dark");
    assert.equal(suggestDecision.targetExposure, "dark");
    assert.equal(suggestDecision.promotionPath, "policy_capped");
    assert.equal(decidePowerWorkflowExposure(metricByTool.get("investigate")!).exposure, "opt_in");
    assert.equal(unsupportedInvestigateDecision.exposure, "dark");
    assert.equal(unsupportedInvestigateDecision.targetExposure, "opt_in");
    assert.equal(unsupportedInvestigateDecision.fallbackExposure, "dark");
    assert.equal(unsupportedInvestigateDecision.promotionPath, "threshold_failed");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
