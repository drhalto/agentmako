import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  GraphNeighborsToolOutputSchema,
  GraphPathToolOutputSchema,
} from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-graph-tools-"));
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
    JSON.stringify({ name: "graph-tools-smoke", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "app", "api", "events", "route.ts"), routeBody);

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "graph-tools-smoke",
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
      seedStore.saveSchemaSnapshot({
        snapshotId: "graph_tools_snapshot",
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "graph-tools-smoke",
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

    const exactNeighbors = GraphNeighborsToolOutputSchema.parse(
      await invokeTool("graph_neighbors", {
        projectId,
        startEntities: [{ kind: "file", key: "app/api/events/route.ts" }],
        direction: "downstream",
        traversalDepth: 1,
      }),
    );
    assert.equal(exactNeighbors.toolName, "graph_neighbors");
    assert.equal(exactNeighbors.result.includeHeuristicEdges, false);
    assert.ok(exactNeighbors.result.neighbors.some((entry) => entry.node.kind === "route"));
    assert.ok(exactNeighbors.result.neighbors.some((entry) => entry.node.kind === "symbol"));
    assert.ok(!exactNeighbors.result.neighbors.some((entry) => entry.node.kind === "rpc"));

    const rpcNeighbors = GraphNeighborsToolOutputSchema.parse(
      await invokeTool("graph_neighbors", {
        projectId,
        startEntities: [{ kind: "file", key: "app/api/events/route.ts" }],
        direction: "downstream",
        traversalDepth: 1,
        includeHeuristicEdges: true,
        nodeKinds: ["rpc"],
      }),
    );
    assert.equal(rpcNeighbors.result.neighbors.length, 1);
    assert.equal(rpcNeighbors.result.neighbors[0]?.node.kind, "rpc");
    assert.equal(rpcNeighbors.result.neighbors[0]?.via[0]?.edge.kind, "calls_rpc");
    assert.equal(rpcNeighbors.result.neighbors[0]?.via[0]?.edge.exactness, "heuristic");

    const unresolvedNeighbors = GraphNeighborsToolOutputSchema.parse(
      await invokeTool("graph_neighbors", {
        projectId,
        startEntities: [{ kind: "file", key: "app/api/events/missing-route.ts" }],
        direction: "downstream",
        traversalDepth: 1,
      }),
    );
    assert.equal(unresolvedNeighbors.result.resolvedStartNodes.length, 0);
    assert.equal(unresolvedNeighbors.result.neighbors.length, 0);
    assert.deepEqual(unresolvedNeighbors.result.missingStartEntities, [
      { kind: "file", key: "app/api/events/missing-route.ts" },
    ]);
    assert.ok(
      unresolvedNeighbors.result.suggestedStartEntities?.some(
        (locator) => locator.kind === "file" && locator.key === "app/api/events/route.ts",
      ),
      "expected unresolved graph neighbor query to suggest a same-kind start entity",
    );
    assert.ok(
      unresolvedNeighbors.result.warnings.some((warning) =>
        warning.startsWith("graph neighbors could not resolve any start entities;"),
      ),
      "expected unresolved graph neighbor query to explain that no start entities resolved",
    );

    const exactPath = GraphPathToolOutputSchema.parse(
      await invokeTool("graph_path", {
        projectId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 4,
      }),
    );
    assert.equal(exactPath.result.pathFound, false);
    assert.equal(exactPath.result.noPathReason, "no_exact_path");

    const heuristicPath = GraphPathToolOutputSchema.parse(
      await invokeTool("graph_path", {
        projectId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "table", key: "public.events" },
        direction: "both",
        traversalDepth: 4,
        includeHeuristicEdges: true,
      }),
    );
    assert.equal(heuristicPath.result.pathFound, true);
    assert.equal(heuristicPath.result.containsHeuristicEdge, true);
    assert.deepEqual(
      heuristicPath.result.hops.map((hop) => hop.edge.kind),
      ["serves_route", "calls_rpc", "touches_table"],
    );
    assert.deepEqual(
      heuristicPath.result.hops.map((hop) => hop.direction),
      ["upstream", "downstream", "downstream"],
    );
    assert.equal(heuristicPath.result.noPathReason, undefined);

    // --- Locator normalization (finding 1 from graph triage) --------------
    //
    // The real Next.js indexer stores route keys as `route:<pattern>:<method>`
    // and RPC keys as `<schema>.<name>(<argTypes>)`, but callers naturally
    // write the human form (`GET /api/events`, `public.refresh_events`).
    // Seed a second project with the real indexer formats and assert that
    // both the METHOD-prefixed form and the bare-path form normalize.
    const secondaryRoot = path.join(tmp, "project-secondary");
    mkdirSync(path.join(secondaryRoot, "app", "dashboard"), { recursive: true });
    writeFileSync(
      path.join(secondaryRoot, "package.json"),
      JSON.stringify({ name: "graph-tools-secondary", version: "0.0.0" }),
    );
    writeFileSync(path.join(secondaryRoot, "app", "dashboard", "page.tsx"), "export default function Page(){return null}");

    const secondaryId = randomUUID();
    const globalStore2 = openGlobalStore();
    try {
      globalStore2.saveProject({
        projectId: secondaryId,
        displayName: "graph-tools-secondary",
        canonicalPath: secondaryRoot,
        lastSeenPath: secondaryRoot,
        supportTarget: "best_effort",
      });
    } finally {
      globalStore2.close();
    }

    const secondaryStore = openProjectStore({ projectRoot: secondaryRoot });
    try {
      secondaryStore.replaceIndexSnapshot({
        files: [
          {
            path: "app/api/events/route.ts",
            sha256: "sec_route",
            language: "typescript",
            sizeBytes: routeBody.length,
            lineCount: routeBody.split("\n").length,
            chunks: [{ chunkKind: "file", name: "app/api/events/route.ts", lineStart: 1, lineEnd: 1, content: "x" }],
            symbols: [],
            imports: [],
            routes: [
              // The real indexer key format — see services/indexer/src/file-scan.ts:425.
              {
                routeKey: "route:/api/events:GET",
                framework: "nextjs",
                pattern: "/api/events",
                method: "GET",
                handlerName: "GET",
                isApi: true,
              },
            ],
          },
          {
            path: "app/dashboard/page.tsx",
            sha256: "sec_page",
            language: "typescript",
            sizeBytes: 10,
            lineCount: 1,
            chunks: [{ chunkKind: "file", name: "app/dashboard/page.tsx", lineStart: 1, lineEnd: 1, content: "x" }],
            symbols: [],
            imports: [],
            routes: [
              {
                routeKey: "page:/dashboard",
                framework: "nextjs",
                pattern: "/dashboard",
                handlerName: "page",
                isApi: false,
              },
            ],
          },
        ],
        schemaObjects: [
          { objectKey: "public.refresh_events", objectType: "rpc", schemaName: "public", objectName: "refresh_events" },
        ],
        schemaUsages: [],
      });
      const now2 = new Date().toISOString();
      secondaryStore.saveSchemaSnapshot({
        snapshotId: "sec_snap",
        sourceMode: "repo_only",
        generatedAt: now2,
        refreshedAt: now2,
        fingerprint: "sec",
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: [],
        warnings: [],
        ir: {
          version: "1.0.0",
          schemas: {
            public: {
              tables: [],
              views: [],
              enums: [],
              rpcs: [
                // Two overloads so we can verify the resolver prefers the no-arg variant.
                {
                  name: "refresh_events",
                  schema: "public",
                  argTypes: [],
                  sources: [{ kind: "sql_migration", path: "m.sql", line: 1 }],
                  bodyText: "BEGIN END;",
                },
                {
                  name: "refresh_events",
                  schema: "public",
                  argTypes: ["uuid"],
                  sources: [{ kind: "sql_migration", path: "m.sql", line: 5 }],
                  bodyText: "BEGIN END;",
                },
              ],
            },
          },
        },
      });
    } finally {
      secondaryStore.close();
    }

    // Route normalization: "METHOD /path" must resolve the indexer-format key.
    const methodForm = GraphPathToolOutputSchema.parse(
      await invokeTool("graph_path", {
        projectId: secondaryId,
        startEntity: { kind: "route", key: "GET /api/events" },
        targetEntity: { kind: "file", key: "app/api/events/route.ts" },
        direction: "both",
        traversalDepth: 2,
      }),
    );
    assert.notEqual(methodForm.result.noPathReason, "start_not_resolved");
    assert.equal(methodForm.result.resolvedStartNode?.key, "route:/api/events:GET");

    // Route normalization: bare "/path" must resolve page routes.
    const bareForm = GraphPathToolOutputSchema.parse(
      await invokeTool("graph_path", {
        projectId: secondaryId,
        startEntity: { kind: "route", key: "/dashboard" },
        targetEntity: { kind: "file", key: "app/dashboard/page.tsx" },
        direction: "both",
        traversalDepth: 2,
      }),
    );
    assert.notEqual(bareForm.result.noPathReason, "start_not_resolved");
    assert.equal(bareForm.result.resolvedStartNode?.key, "page:/dashboard");

    // Case-insensitive method prefix.
    const lowercaseMethod = GraphPathToolOutputSchema.parse(
      await invokeTool("graph_path", {
        projectId: secondaryId,
        startEntity: { kind: "route", key: "get /api/events" },
        targetEntity: { kind: "file", key: "app/api/events/route.ts" },
        direction: "both",
        traversalDepth: 2,
      }),
    );
    assert.equal(lowercaseMethod.result.resolvedStartNode?.key, "route:/api/events:GET");

    // Already-normalized routeKey passes through.
    const storedFormatPath = GraphPathToolOutputSchema.parse(
      await invokeTool("graph_path", {
        projectId: secondaryId,
        startEntity: { kind: "route", key: "route:/api/events:GET" },
        targetEntity: { kind: "file", key: "app/api/events/route.ts" },
        direction: "both",
        traversalDepth: 2,
      }),
    );
    assert.equal(storedFormatPath.result.resolvedStartNode?.key, "route:/api/events:GET");

    // RPC normalization: bare `<schema>.<name>` prefers the no-arg overload.
    const rpcBare = GraphPathToolOutputSchema.parse(
      await invokeTool("graph_path", {
        projectId: secondaryId,
        startEntity: { kind: "rpc", key: "public.refresh_events" },
        targetEntity: { kind: "rpc", key: "public.refresh_events" },
        direction: "both",
        traversalDepth: 1,
      }),
    );
    assert.notEqual(rpcBare.result.noPathReason, "start_not_resolved");
    assert.equal(
      rpcBare.result.resolvedStartNode?.key,
      "public.refresh_events()",
      "bare RPC name must normalize to the no-arg overload when present",
    );

    console.log("graph-tools: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
