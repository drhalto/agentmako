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
  mkdirSync(path.join(projectRoot, "app", "dashboard", "manager", "endorsements"), { recursive: true });
  mkdirSync(path.join(projectRoot, "lib", "auth"), { recursive: true });

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
  const dalBody = [
    "import { loadAuthBundle } from './unified-auth-types';",
    "export function getSession() { return loadAuthBundle; }",
    "",
  ].join("\n");
  const authTypesBody = [
    "export async function loadAuthBundle(supabase: { rpc(name: string): Promise<unknown> }) {",
    "  return supabase.rpc('get_auth_bundle');",
    "}",
    "",
  ].join("\n");
  const pageBodyWithoutImport = "export default function Page() { return null; }\n";
  const pageBodyWithImport = [
    "import { getSession } from '../../../../lib/auth/dal';",
    "export default function Page() { getSession(); return null; }",
    "",
  ].join("\n");

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "graph-workflows-smoke", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "app", "api", "events", "route.ts"), routeBody);
  writeFileSync(path.join(projectRoot, "lib", "auth", "dal.ts"), dalBody);
  writeFileSync(path.join(projectRoot, "lib", "auth", "unified-auth-types.ts"), authTypesBody);
  writeFileSync(path.join(projectRoot, "app", "dashboard", "manager", "endorsements", "page.tsx"), pageBodyWithoutImport);

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
          {
            path: "lib/auth/dal.ts",
            sha256: "dal",
            language: "typescript",
            sizeBytes: dalBody.length,
            lineCount: dalBody.split("\n").filter(Boolean).length,
            chunks: [
              {
                chunkKind: "file",
                name: "lib/auth/dal.ts",
                lineStart: 1,
                lineEnd: 1,
                content: dalBody,
              },
            ],
            symbols: [
              {
                name: "getSession",
                kind: "function",
                exportName: "getSession",
                lineStart: 2,
                lineEnd: 2,
              },
            ],
            imports: [
              {
                targetPath: "lib/auth/unified-auth-types.ts",
                specifier: "./unified-auth-types",
                importKind: "value",
                isTypeOnly: false,
                line: 1,
              },
            ],
            routes: [],
          },
          {
            path: "lib/auth/unified-auth-types.ts",
            sha256: "auth-types",
            language: "typescript",
            sizeBytes: authTypesBody.length,
            lineCount: authTypesBody.split("\n").filter(Boolean).length,
            chunks: [
              {
                chunkKind: "file",
                name: "lib/auth/unified-auth-types.ts",
                lineStart: 1,
                lineEnd: authTypesBody.split("\n").filter(Boolean).length,
                content: authTypesBody,
              },
            ],
            symbols: [
              {
                name: "loadAuthBundle",
                kind: "function",
                exportName: "loadAuthBundle",
                lineStart: 1,
                lineEnd: 3,
              },
            ],
            imports: [],
            routes: [],
          },
          {
            path: "app/dashboard/manager/endorsements/page.tsx",
            sha256: "page-without-import",
            language: "typescriptreact",
            sizeBytes: pageBodyWithoutImport.length,
            lineCount: pageBodyWithoutImport.split("\n").filter(Boolean).length,
            chunks: [
              {
                chunkKind: "file",
                name: "app/dashboard/manager/endorsements/page.tsx",
                lineStart: 1,
                lineEnd: 1,
                content: pageBodyWithoutImport,
              },
            ],
            symbols: [],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [
          {
            objectKey: "public.refresh_events",
            objectType: "rpc",
            schemaName: "public",
            objectName: "refresh_events",
          },
          {
            objectKey: "public.get_auth_bundle",
            objectType: "rpc",
            schemaName: "public",
            objectName: "get_auth_bundle",
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
          {
            objectKey: "public.get_auth_bundle",
            filePath: "lib/auth/unified-auth-types.ts",
            usageKind: "rpc_call",
            line: 2,
            excerpt: "supabase.rpc('get_auth_bundle')",
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
                {
                  name: "user_roles",
                  schema: "public",
                  columns: [],
                  rls: {
                    rlsEnabled: true,
                    forceRls: false,
                    policies: [],
                  },
                  triggers: [],
                  sources: [{ kind: "sql_migration", path: "supabase/migrations/0003_user_roles.sql", line: 1 }],
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
                {
                  name: "get_auth_bundle",
                  schema: "public",
                  argTypes: [],
                  sources: [{ kind: "sql_migration", path: "supabase/migrations/0004_auth_bundle.sql", line: 1 }],
                  bodyText: "BEGIN SELECT * FROM public.user_roles; END;",
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
      }),
    );
    assert.equal(flowMap.result.pathFound, true);
    assert.equal(flowMap.result.includeHeuristicEdges, true);
    assert.deepEqual(
      flowMap.result.steps.map((step) => step.node.kind),
      ["route", "file", "rpc", "table"],
    );
    assert.deepEqual(
      flowMap.result.transitions.map((transition) => transition.hop.edge.kind),
      ["serves_route", "calls_rpc", "touches_table"],
    );
    assert.deepEqual(flowMap.result.majorBoundaryKinds, ["entry", "file", "rpc", "data"]);

    const fileToTableFlowMap = FlowMapToolOutputSchema.parse(
      await invokeTool("flow_map", {
        projectId,
        startEntity: { kind: "file", key: "lib/auth/dal.ts" },
        targetEntity: { kind: "table", key: "public.user_roles" },
        direction: "both",
        traversalDepth: 4,
      }),
    );
    assert.equal(fileToTableFlowMap.result.pathFound, true);
    assert.deepEqual(
      fileToTableFlowMap.result.steps.map((step) => step.node.kind),
      ["file", "file", "rpc", "table"],
    );
    assert.deepEqual(
      fileToTableFlowMap.result.transitions.map((transition) => transition.hop.edge.kind),
      ["imports", "calls_rpc", "touches_table"],
    );

    const fileToTableChangePlan = ChangePlanToolOutputSchema.parse(
      await invokeTool("change_plan", {
        projectId,
        startEntity: { kind: "file", key: "lib/auth/dal.ts" },
        targetEntity: { kind: "table", key: "public.user_roles" },
        direction: "both",
        traversalDepth: 4,
      }),
    );
    assert.equal(fileToTableChangePlan.result.pathFound, true);
    assert.deepEqual(
      fileToTableChangePlan.result.directSurfaces.map((surface) => surface.node.kind),
      ["file", "file", "rpc", "table"],
    );
    assert.deepEqual(
      fileToTableChangePlan.result.directSurfaces.slice(1).map((surface) => surface.via.at(-1)?.edge.kind),
      ["imports", "calls_rpc", "touches_table"],
    );

    const noImportChangePlan = ChangePlanToolOutputSchema.parse(
      await invokeTool("change_plan", {
        projectId,
        startEntity: { kind: "file", key: "lib/auth/dal.ts" },
        targetEntity: { kind: "file", key: "app/dashboard/manager/endorsements/page.tsx" },
        direction: "both",
        traversalDepth: 2,
      }),
    );
    assert.equal(noImportChangePlan.result.pathFound, false);

    writeFileSync(path.join(projectRoot, "app", "dashboard", "manager", "endorsements", "page.tsx"), pageBodyWithImport);
    const updateStore = openProjectStore({ projectRoot });
    try {
      updateStore.replaceFileIndexRows({
        deletedPaths: [],
        files: [
          {
            path: "app/dashboard/manager/endorsements/page.tsx",
            sha256: "page-with-import",
            language: "typescriptreact",
            sizeBytes: pageBodyWithImport.length,
            lineCount: pageBodyWithImport.split("\n").filter(Boolean).length,
            chunks: [
              {
                chunkKind: "file",
                name: "app/dashboard/manager/endorsements/page.tsx",
                lineStart: 1,
                lineEnd: 2,
                content: pageBodyWithImport,
              },
            ],
            symbols: [],
            imports: [
              {
                targetPath: "lib/auth/dal.ts",
                specifier: "../../../../lib/auth/dal",
                importKind: "value",
                isTypeOnly: false,
                line: 1,
              },
            ],
            routes: [],
          },
        ],
      });
    } finally {
      updateStore.close();
    }

    const importChangePlan = ChangePlanToolOutputSchema.parse(
      await invokeTool("change_plan", {
        projectId,
        startEntity: { kind: "file", key: "lib/auth/dal.ts" },
        targetEntity: { kind: "file", key: "app/dashboard/manager/endorsements/page.tsx" },
        direction: "both",
        traversalDepth: 2,
      }),
    );
    assert.equal(importChangePlan.result.pathFound, true);
    assert.deepEqual(
      importChangePlan.result.directSurfaces.map((surface) => surface.node.key),
      ["lib/auth/dal.ts", "app/dashboard/manager/endorsements/page.tsx"],
    );
    assert.equal(importChangePlan.result.directSurfaces[1]?.via[0]?.edge.kind, "imports");

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
      }),
    );
    assert.equal(changePlan.result.pathFound, true);
    assert.equal(changePlan.result.includeHeuristicEdges, true);
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
