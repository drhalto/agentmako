import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  ChangePlanToolOutputSchema,
  FlowMapToolOutputSchema,
} from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-graph-workflows-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "events"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const routeBody = [
    "import { supabase } from '../../../src/supabase';",
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
    JSON.stringify({ name: "graph-workflows-smoke", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "app", "api", "events", "route.ts"), routeBody);

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "graph-workflows-smoke",
        canonicalPath: projectRoot,
        lastSeenPath: projectRoot,
        supportTarget: "best_effort",
      });
    } finally {
      globalStore.close();
    }

    const seedStore = openProjectStore({ projectRoot });
    try {
      seedStore.replaceIndexSnapshot({
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
      seedStore.saveSchemaSnapshot({
        snapshotId: "graph_workflows_snapshot",
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "graph-workflows-smoke",
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
                  columns: [],
                  rls: {
                    rlsEnabled: true,
                    forceRls: false,
                    policies: [
                      {
                        name: "events_read",
                        mode: "PERMISSIVE",
                        command: "SELECT",
                        roles: ["authenticated"],
                        usingExpression: "tenant_id = auth.uid()",
                        withCheckExpression: null,
                      },
                      {
                        name: "events_insert",
                        mode: "PERMISSIVE",
                        command: "INSERT",
                        roles: ["authenticated"],
                        usingExpression: null,
                        withCheckExpression: "tenant_id = auth.uid()",
                      },
                    ],
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
                    {
                      name: "events_insert_touch",
                      enabled: true,
                      enabledMode: "O",
                      timing: "BEFORE",
                      events: ["INSERT"],
                      bodyText: "EXECUTE FUNCTION touch_updated_at()",
                    },
                  ],
                  sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_events.sql", line: 1 }],
                },
              ],
              views: [],
              enums: [],
              rpcs: [
                {
                  name: "refresh_events",
                  schema: "public",
                  argTypes: [],
                  sources: [{ kind: "sql_migration", path: "supabase/migrations/0002_refresh.sql", line: 1 }],
                  bodyText: "BEGIN UPDATE public.events SET updated_at = now(); END;",
                },
              ],
            },
          },
        },
      });
    } finally {
      seedStore.close();
    }

    const flowMap = FlowMapToolOutputSchema.parse(
      await invokeTool("flow_map", {
        projectId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 4,
        includeHeuristicEdges: true,
      }),
    );
    assert.equal(flowMap.result.pathFound, true);
    assert.deepEqual(
      flowMap.result.steps.map((step) => step.node.kind),
      ["route", "file", "rpc", "table"],
    );
    assert.deepEqual(
      flowMap.result.transitions.map((transition) => transition.hop.edge.kind),
      ["serves_route", "calls_rpc", "touches_table"],
    );
    assert.deepEqual(flowMap.result.majorBoundaryKinds, ["entry", "file", "rpc", "data"]);

    const exactOnlyFlowMap = FlowMapToolOutputSchema.parse(
      await invokeTool("flow_map", {
        projectId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 4,
        includeHeuristicEdges: false,
      }),
    );
    assert.equal(exactOnlyFlowMap.result.pathFound, false);
    assert.equal(exactOnlyFlowMap.result.noPathReason, "no_exact_path");
    assert.deepEqual(exactOnlyFlowMap.result.steps, []);
    assert.deepEqual(exactOnlyFlowMap.result.transitions, []);

    const changePlan = ChangePlanToolOutputSchema.parse(
      await invokeTool("change_plan", {
        projectId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 4,
        includeHeuristicEdges: true,
      }),
    );
    assert.equal(changePlan.result.pathFound, true);
    assert.deepEqual(
      changePlan.result.directSurfaces.map((surface) => surface.node.kind),
      ["route", "file", "rpc", "table"],
    );
    assert.ok(
      changePlan.result.warnings.some((warning) =>
        warning.startsWith("change plan dependent surfaces truncated at 6 results"),
      ),
      "expected truncation warning when adjacent surfaces exceed the shipped cap",
    );
    assert.ok(
      changePlan.result.dependentSurfaces.some((surface) => surface.node.kind === "symbol"),
      "expected symbol dependent surface",
    );
    assert.ok(
      changePlan.result.dependentSurfaces.some((surface) => surface.node.kind === "policy"),
      "expected policy dependent surface",
    );
    assert.ok(
      changePlan.result.dependentSurfaces.some((surface) => surface.node.kind === "trigger"),
      "expected trigger dependent surface",
    );

    const directSteps = changePlan.result.steps.slice(0, changePlan.result.directSurfaces.length);
    assert.equal(directSteps[0]?.dependsOnStepIds.length, 0);
    assert.deepEqual(directSteps[1]?.dependsOnStepIds, [directSteps[0]!.stepId]);
    assert.deepEqual(directSteps[2]?.dependsOnStepIds, [directSteps[1]!.stepId]);
    assert.deepEqual(directSteps[3]?.dependsOnStepIds, [directSteps[2]!.stepId]);

    const symbolStep = changePlan.result.steps.find((step) =>
      step.title.startsWith("Recheck symbol"),
    );
    const tableStep = directSteps.find((step) => step.title.startsWith("Change table"));
    const policyStep = changePlan.result.steps.find((step) =>
      step.title.startsWith("Recheck policy"),
    );
    const triggerStep = changePlan.result.steps.find((step) =>
      step.title.startsWith("Recheck trigger"),
    );
    assert.ok(symbolStep, "expected dependent symbol step");
    assert.ok(policyStep, "expected dependent policy step");
    assert.ok(triggerStep, "expected dependent trigger step");
    assert.deepEqual(
      policyStep?.dependsOnStepIds,
      tableStep ? [tableStep.stepId] : [],
    );
    assert.deepEqual(
      triggerStep?.dependsOnStepIds,
      tableStep ? [tableStep.stepId] : [],
    );
    assert.equal("sections" in changePlan.result, false);
    assert.equal("citations" in changePlan.result, false);
    assert.ok(changePlan.result.directSurfaces.length > 0);
    assert.ok(changePlan.result.dependentSurfaces.length > 0);
    assert.deepEqual(changePlan.result.recommendedFollowOn, {
      toolName: "workflow_packet",
      family: "implementation_brief",
      reason:
        "turn the 4 direct and 6 dependent graph surfaces into one implementation brief with invariants, risks, and verification guidance",
    });

    const exactOnlyChangePlan = ChangePlanToolOutputSchema.parse(
      await invokeTool("change_plan", {
        projectId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 4,
        includeHeuristicEdges: false,
      }),
    );
    assert.equal(exactOnlyChangePlan.result.pathFound, false);
    assert.equal(exactOnlyChangePlan.result.noPathReason, "no_exact_path");
    assert.deepEqual(exactOnlyChangePlan.result.directSurfaces, []);
    assert.deepEqual(exactOnlyChangePlan.result.dependentSurfaces, []);
    assert.deepEqual(exactOnlyChangePlan.result.steps, []);
    assert.equal(exactOnlyChangePlan.result.recommendedFollowOn, undefined);

    console.log("graph-workflows: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
