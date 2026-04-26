import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  InvestigateToolOutputSchema,
  SuggestToolOutputSchema,
} from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-investigation-tools-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "events"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const routeBody = [
    "import { supabase } from '../../../src/supabase';",
    "",
    "export async function GET() {",
    "  await supabase.rpc('refresh_events');",
    "  return Response.json([]);",
    "}",
  ].join("\n");

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "investigation-tools-smoke", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "app", "api", "events", "route.ts"), routeBody);

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "investigation-tools-smoke",
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
        name: "investigation-tools-smoke",
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
                name: "GET",
                kind: "function",
                exportName: "GET",
                lineStart: 3,
                lineEnd: 6,
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
            line: 4,
            excerpt: "supabase.rpc('refresh_events')",
          },
        ],
      });

      const now = new Date().toISOString();
      store.saveSchemaSnapshot({
        snapshotId: "investigation_tools_snapshot",
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "investigation-tools-smoke",
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
                      name: "tenant_id",
                      dataType: "uuid",
                      nullable: false,
                      sources: [{ kind: "sql_migration", path: "supabase/migrations/0001_events.sql", line: 1 }],
                    },
                  ],
                  rls: {
                    rlsEnabled: false,
                    forceRls: false,
                    policies: [],
                  },
                  triggers: [],
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
                  bodyText: "BEGIN UPDATE public.events SET tenant_id = tenant_id; END;",
                },
              ],
            },
          },
        },
      });
    } finally {
      store.close();
    }

    const suggestFlow = SuggestToolOutputSchema.parse(
      await invokeTool("suggest", {
        projectId,
        question: "How does GET /api/events flow to public.events and what changes if I modify it?",
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        includeHeuristicEdges: true,
      }),
    );
    assert.equal(suggestFlow.result.strategy, "flow_then_change");
    assert.equal(suggestFlow.result.stopReason, "bounded_investigation_completed");
    assert.deepEqual(
      suggestFlow.result.steps.map((step) => [step.toolName, step.status]),
      [
        ["flow_map", "todo"],
        ["change_plan", "todo"],
      ],
    );

    const investigateBudget = InvestigateToolOutputSchema.parse(
      await invokeTool("investigate", {
        projectId,
        question: "How does GET /api/events flow to public.events and what changes if I modify it?",
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        includeHeuristicEdges: true,
        budget: 1,
      }),
    );
    assert.equal(investigateBudget.result.strategy, "flow_then_change");
    assert.equal(investigateBudget.result.stopReason, "budget_exhausted");
    assert.equal(investigateBudget.result.executedStepCount, 1);
    assert.deepEqual(
      investigateBudget.result.steps.map((step) => step.status),
      ["done", "todo"],
    );

    const investigateFlow = InvestigateToolOutputSchema.parse(
      await invokeTool("investigate", {
        projectId,
        question: "How does GET /api/events flow to public.events and what changes if I modify it?",
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        includeHeuristicEdges: true,
      }),
    );
    assert.equal(investigateFlow.result.stopReason, "bounded_investigation_completed");
    assert.equal(investigateFlow.result.executedStepCount, 2);
    assert.deepEqual(
      investigateFlow.result.steps.map((step) => step.status),
      ["done", "done"],
    );
    assert.deepEqual(
      investigateFlow.result.followOnHints.map((hint) => hint.family),
      ["implementation_brief"],
    );

    const suggestTenant = SuggestToolOutputSchema.parse(
      await invokeTool("suggest", {
        projectId,
        question: "Run a tenant leak audit for this project and check the RLS posture.",
      }),
    );
    assert.equal(suggestTenant.result.strategy, "tenant_audit");
    assert.equal(suggestTenant.result.stopReason, "satisfied_by_canonical_tool");
    assert.deepEqual(suggestTenant.result.steps.map((step) => step.toolName), ["tenant_leak_audit"]);

    const suggestProjectStatus = SuggestToolOutputSchema.parse(
      await invokeTool("suggest", {
        projectId,
        question: "Give me a handoff and the health trend for this project.",
      }),
    );
    assert.equal(suggestProjectStatus.result.strategy, "project_status");
    assert.deepEqual(
      suggestProjectStatus.result.steps.map((step) => step.toolName),
      ["session_handoff", "health_trend"],
    );

    const investigateRoute = InvestigateToolOutputSchema.parse(
      await invokeTool("investigate", {
        projectId,
        question: "Where is /api/events handled?",
      }),
    );
    assert.equal(investigateRoute.result.strategy, "ask_routed_canonical");
    assert.equal(investigateRoute.result.stopReason, "satisfied_by_canonical_tool");
    assert.equal(investigateRoute.result.executedStepCount, 1);
    assert.equal(investigateRoute.result.steps[0]?.toolName, "route_trace");
    assert.equal(investigateRoute.result.steps[0]?.status, "done");
    assert.equal(investigateRoute.result.steps[0]?.selectionConfidence, 0.97);
    assert.match(investigateRoute.result.steps[0]?.resultSummary ?? "", /route_trace answered/i);

    const lowConfidenceSuggest = SuggestToolOutputSchema.parse(
      await invokeTool("suggest", {
        projectId,
        question: "Why do support tickets disagree?",
      }),
    );
    assert.equal(lowConfidenceSuggest.result.strategy, "unsupported");
    assert.equal(lowConfidenceSuggest.result.stopReason, "unsupported");
    assert.match(
      lowConfidenceSuggest.result.warnings.join("\n"),
      /routing confidence .* below the 0.80 threshold/i,
    );

    const unsupported = SuggestToolOutputSchema.parse(
      await invokeTool("suggest", {
        projectId,
        question: "Brainstorm architecture vibes for me.",
      }),
    );
    assert.equal(unsupported.result.strategy, "unsupported");
    assert.equal(unsupported.result.stopReason, "unsupported");
    assert.deepEqual(unsupported.result.steps, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
