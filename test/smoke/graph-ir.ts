import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  GRAPH_EDGE_INVENTORY,
  GraphEdgeInventoryEntrySchema,
  GraphSliceSchema,
  type GraphEdge,
  type GraphNode,
} from "../../packages/contracts/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";
import { buildDerivedGraphSlice } from "../../packages/tools/src/index.ts";

function findNode(slice: { nodes: GraphNode[] }, kind: GraphNode["kind"], key: string): GraphNode {
  const node = slice.nodes.find((entry) => entry.kind === kind && entry.key === key);
  assert.ok(node, `expected graph node ${kind}:${key}`);
  return node!;
}

function findEdge(
  slice: { edges: GraphEdge[] },
  kind: GraphEdge["kind"],
  fromNodeId: string,
  toNodeId: string,
): GraphEdge {
  const edge = slice.edges.find(
    (entry) =>
      entry.kind === kind && entry.fromNodeId === fromNodeId && entry.toNodeId === toNodeId,
  );
  assert.ok(edge, `expected graph edge ${kind} from ${fromNodeId} to ${toNodeId}`);
  return edge!;
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-graph-ir-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "src", "lib"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "events"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const pagePath = path.join(projectRoot, "src", "page.tsx");
  const eventsPath = path.join(projectRoot, "src", "lib", "events.ts");
  const routePath = path.join(projectRoot, "app", "api", "events", "route.ts");

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "graph-ir-smoke", version: "0.0.0" }),
  );
  writeFileSync(pagePath, "import { loadVisibleEvents } from './lib/events';\nexport default function Page() {}\n");
  writeFileSync(eventsPath, "export async function loadVisibleEvents() { return []; }\n");
  writeFileSync(routePath, "export async function GET() { return Response.json([]); }\n");

  try {
    const seedStore = openProjectStore({ projectRoot });
    try {
      seedStore.replaceIndexSnapshot({
        files: [
          {
            path: "src/page.tsx",
            sha256: "page",
            language: "typescript",
            sizeBytes: 80,
            lineCount: 2,
            chunks: [
              {
                chunkKind: "file",
                name: "src/page.tsx",
                lineStart: 1,
                lineEnd: 2,
                content: "import { loadVisibleEvents } from './lib/events';\nexport default function Page() {}\n",
              },
            ],
            symbols: [
              {
                name: "Page",
                kind: "function",
                exportName: "default",
                lineStart: 2,
                lineEnd: 2,
              },
            ],
            imports: [
              {
                targetPath: "src/lib/events.ts",
                specifier: "./lib/events",
                importKind: "value",
                isTypeOnly: false,
                line: 1,
              },
            ],
            routes: [],
          },
          {
            path: "src/lib/events.ts",
            sha256: "events",
            language: "typescript",
            sizeBytes: 57,
            lineCount: 1,
            chunks: [
              {
                chunkKind: "file",
                name: "src/lib/events.ts",
                lineStart: 1,
                lineEnd: 1,
                content: "export async function loadVisibleEvents() { return []; }\n",
              },
            ],
            symbols: [
              {
                name: "loadVisibleEvents",
                kind: "function",
                exportName: "loadVisibleEvents",
                lineStart: 1,
                lineEnd: 1,
              },
            ],
            imports: [],
            routes: [],
          },
          {
            path: "app/api/events/route.ts",
            sha256: "route",
            language: "typescript",
            sizeBytes: 57,
            lineCount: 1,
            chunks: [
              {
                chunkKind: "file",
                name: "app/api/events/route.ts",
                lineStart: 1,
                lineEnd: 1,
                content: "export async function GET() { return Response.json([]); }\n",
              },
            ],
            symbols: [
              {
                name: "GET",
                kind: "function",
                exportName: "GET",
                lineStart: 1,
                lineEnd: 1,
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
        schemaObjects: [],
        schemaUsages: [],
      });

      const now = new Date().toISOString();
      seedStore.saveSchemaSnapshot({
        snapshotId: "graph_ir_snapshot",
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "graph-ir-smoke",
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
                  ],
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
                  bodyText: "BEGIN UPDATE public.events SET id = id; END;",
                },
              ],
            },
          },
        },
      });
    } finally {
      seedStore.close();
    }

    const store = openProjectStore({ projectRoot });
    try {
      const slice = buildDerivedGraphSlice(store, { derivedAt: "2026-04-20T08:00:00.000Z" });
      GraphSliceSchema.parse(slice);
      for (const entry of GRAPH_EDGE_INVENTORY) {
        GraphEdgeInventoryEntrySchema.parse(entry);
      }

      assert.equal(slice.basis.strategy, "whole_project");
      assert.equal(slice.basis.schemaSnapshotId, "graph_ir_snapshot");
      assert.equal(slice.basis.schemaFingerprint, "graph-ir-smoke");
      assert.deepEqual(slice.warnings, []);

      assert.deepEqual(
        new Set(slice.inventory.map((entry) => entry.kind)),
        new Set(GRAPH_EDGE_INVENTORY.map((entry) => entry.kind)),
        "slice inventory should expose the full graph edge inventory",
      );

      const inventoryByKind = new Map(slice.inventory.map((entry) => [entry.kind, entry] as const));
      assert.equal(inventoryByKind.get("calls_rpc")?.exactness, "heuristic");
      assert.equal(inventoryByKind.get("calls_rpc")?.firstSliceStatus, "emitted");
      assert.equal(inventoryByKind.get("references_auth_boundary")?.firstSliceStatus, "inventory_only");
      assert.equal(inventoryByKind.get("invokes_edge")?.firstSliceStatus, "inventory_only");

      const pageNode = findNode(slice, "file", "src/page.tsx");
      const eventsFileNode = findNode(slice, "file", "src/lib/events.ts");
      const symbolNode = findNode(
        slice,
        "symbol",
        "src/lib/events.ts:loadVisibleEvents:1:loadVisibleEvents",
      );
      const routeNode = findNode(slice, "route", "GET /api/events");
      const rpcNode = findNode(slice, "rpc", "public.refresh_events()");
      const tableNode = findNode(slice, "table", "public.events");
      const policyNode = findNode(slice, "policy", "public.events#policy:events_read");
      const triggerNode = findNode(slice, "trigger", "public.events#trigger:events_touch");

      const importEdge = findEdge(slice, "imports", pageNode.nodeId, eventsFileNode.nodeId);
      assert.equal(importEdge.exactness, "exact");
      assert.equal(importEdge.provenance.source, "project_store.listAllImportEdges");
      assert.ok(importEdge.provenance.evidenceRefs.includes("src/page.tsx:1"));

      const declaresEdge = findEdge(slice, "declares_symbol", eventsFileNode.nodeId, symbolNode.nodeId);
      assert.equal(declaresEdge.exactness, "exact");
      assert.equal(declaresEdge.provenance.source, "project_store.listSymbolsForFile");

      const exportsEdge = findEdge(slice, "exports", eventsFileNode.nodeId, symbolNode.nodeId);
      assert.equal(exportsEdge.exactness, "exact");

      const servesRouteEdge = findEdge(
        slice,
        "serves_route",
        findNode(slice, "file", "app/api/events/route.ts").nodeId,
        routeNode.nodeId,
      );
      assert.equal(servesRouteEdge.exactness, "exact");
      assert.equal(servesRouteEdge.provenance.source, "project_store.listRoutes");

      const touchesTableEdge = findEdge(slice, "touches_table", rpcNode.nodeId, tableNode.nodeId);
      assert.equal(touchesTableEdge.exactness, "exact");
      assert.equal(touchesTableEdge.provenance.source, "project_store.listFunctionTableRefs");

      const policyEdge = findEdge(slice, "has_rls_policy", tableNode.nodeId, policyNode.nodeId);
      assert.equal(policyEdge.exactness, "exact");
      assert.equal(policyEdge.provenance.source, "project_store.loadSchemaSnapshot");

      const triggerEdge = findEdge(slice, "has_trigger", tableNode.nodeId, triggerNode.nodeId);
      assert.equal(triggerEdge.exactness, "exact");
      assert.equal(triggerEdge.provenance.source, "project_store.loadSchemaSnapshot");

      assert.ok(
        slice.edges.every((edge) => edge.exactness === "exact"),
        "whole-project slice should stay exact-only under an empty RPC-usage seed",
      );

      console.log("graph-ir: PASS");
    } finally {
      store.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
