import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ExportsOfToolOutput,
  ImportsCyclesToolOutput,
  ImportsDepsToolOutput,
  ImportsHotspotsToolOutput,
  ImportsImpactToolOutput,
  RouteContextToolOutput,
  SymbolsOfToolOutput,
} from "../../packages/contracts/src/index.ts";
import {
  openGlobalStore,
  openProjectStore,
  type ImportEdgeRecord,
  type IndexedFileRecord,
  type SymbolRecord,
} from "../../packages/store/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";
import { readReefOperations } from "../../services/indexer/src/reef-operation-log.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-structural-tool-execution-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const priorStateDirname = process.env.MAKO_STATE_DIRNAME;
  const priorReefMode = process.env.MAKO_REEF_MODE;
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-structural-tool-execution" }));
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;
  delete process.env.MAKO_REEF_MODE;

  const projectId = randomUUID();
  const toolService = createToolService();
  try {
    seedProject(projectRoot, projectId);

    const deps = await toolService.callTool("imports_deps", {
      projectId,
      file: "src/app.ts",
    }) as ImportsDepsToolOutput;
    assert.equal(deps.imports.length, 2);
    assertReefExecution(deps.reefExecution, "imports_deps");

    const impact = await toolService.callTool("imports_impact", {
      projectId,
      file: "src/util.ts",
      depth: 3,
    }) as ImportsImpactToolOutput;
    assert.ok(impact.impactedFiles.some((entry) => entry.filePath === "src/app.ts"));
    assertReefExecution(impact.reefExecution, "imports_impact");

    const hotspots = await toolService.callTool("imports_hotspots", {
      projectId,
      limit: 5,
    }) as ImportsHotspotsToolOutput;
    assert.ok(hotspots.hotspots.some((entry) => entry.filePath === "src/util.ts"));
    assertReefExecution(hotspots.reefExecution, "imports_hotspots");

    const cycles = await toolService.callTool("imports_cycles", {
      projectId,
    }) as ImportsCyclesToolOutput;
    assert.equal(cycles.cycles.length, 0);
    assertReefExecution(cycles.reefExecution, "imports_cycles");

    const symbols = await toolService.callTool("symbols_of", {
      projectId,
      file: "src/service.ts",
    }) as SymbolsOfToolOutput;
    assert.ok(symbols.symbols.some((symbol) => symbol.name === "loadUsers"));
    assertReefExecution(symbols.reefExecution, "symbols_of");

    const exports = await toolService.callTool("exports_of", {
      projectId,
      file: "src/service.ts",
    }) as ExportsOfToolOutput;
    assert.ok(exports.exports.some((symbol) => symbol.exportName === "loadUsers"));
    assertReefExecution(exports.reefExecution, "exports_of");

    const route = await toolService.callTool("route_context", {
      projectId,
      route: "GET /api/users",
    }) as RouteContextToolOutput;
    assert.equal(route.resolvedRoute?.filePath, "app/api/users/route.ts");
    assert.ok(route.outboundImports.entries.some((entry) => entry.targetPath === "src/service.ts"));
    assertReefExecution(route.reefExecution, "route_context");

    const operations = await readReefOperations({}, {
      projectId,
      kind: "query_path",
      limit: 20,
    });
    const loggedTools = new Set(operations.map((operation) => operation.data?.toolName));
    for (const toolName of [
      "imports_deps",
      "imports_impact",
      "imports_hotspots",
      "imports_cycles",
      "symbols_of",
      "exports_of",
      "route_context",
    ]) {
      assert.ok(loggedTools.has(toolName), `expected query_path operation for ${toolName}`);
    }

    console.log("reef-structural-tool-execution: PASS");
  } finally {
    toolService.close();
    if (priorStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = priorStateHome;
    }
    if (priorStateDirname === undefined) {
      delete process.env.MAKO_STATE_DIRNAME;
    } else {
      process.env.MAKO_STATE_DIRNAME = priorStateDirname;
    }
    if (priorReefMode === undefined) {
      delete process.env.MAKO_REEF_MODE;
    } else {
      process.env.MAKO_REEF_MODE = priorReefMode;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

function assertReefExecution(
  reefExecution: ImportsDepsToolOutput["reefExecution"],
  toolName: string,
): void {
  assert.equal(reefExecution.reefMode, "auto", `${toolName} should use auto mode by default`);
  assert.equal(reefExecution.serviceMode, "direct", `${toolName} should report direct store read without a service`);
  assert.equal(reefExecution.queryPath, "reef_materialized_view");
  assert.equal(reefExecution.freshnessPolicy, "require_fresh");
  assert.equal(reefExecution.fallback?.used, true);
  assert.ok(reefExecution.operationId, `${toolName} should record its query-path operation`);
}

function seedProject(projectRoot: string, projectId: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "reef-structural-tool-execution",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "reef-structural-tool-execution",
      rootPath: projectRoot,
      framework: "nextjs",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });
    store.replaceIndexSnapshot({
      files: [
        fileRecord("src/app.ts", [
          "import { loadUsers } from './service';",
          "import { formatUser } from './util';",
          "export function renderUsers() {",
          "  return loadUsers().map(formatUser);",
          "}",
        ], {
          symbols: [symbol("renderUsers", "function", 3, 5)],
          imports: [
            edge("src/service.ts", "./service", 1),
            edge("src/util.ts", "./util", 2),
          ],
        }),
        fileRecord("src/service.ts", [
          "import { formatUser } from './util';",
          "export function loadUsers() {",
          "  return [formatUser({ id: '1' })];",
          "}",
        ], {
          symbols: [symbol("loadUsers", "function", 2, 4)],
          imports: [edge("src/util.ts", "./util", 1)],
        }),
        fileRecord("src/util.ts", [
          "export function formatUser(user: { id: string }) {",
          "  return user.id;",
          "}",
        ], {
          symbols: [symbol("formatUser", "function", 1, 3)],
        }),
        fileRecord("app/api/users/route.ts", [
          "import { loadUsers } from '../../../src/service';",
          "export function GET() {",
          "  return Response.json(loadUsers());",
          "}",
        ], {
          symbols: [symbol("GET", "function", 2, 4)],
          imports: [edge("src/service.ts", "../../../src/service", 1)],
          routes: [
            {
              routeKey: "nextjs:GET:/api/users",
              framework: "nextjs",
              pattern: "/api/users",
              method: "GET",
              handlerName: "GET",
              isApi: true,
            },
          ],
        }),
      ],
      schemaObjects: [],
      schemaUsages: [],
    });
  } finally {
    store.close();
  }
}

function fileRecord(
  relPath: string,
  lines: string[],
  options: {
    symbols?: SymbolRecord[];
    imports?: ImportEdgeRecord[];
    routes?: IndexedFileRecord["routes"];
  } = {},
): IndexedFileRecord {
  const content = lines.join("\n");
  return {
    path: relPath,
    sha256: relPath,
    language: relPath.endsWith(".tsx") ? "tsx" : "typescript",
    sizeBytes: Buffer.byteLength(content, "utf8"),
    lineCount: lines.length,
    chunks: [
      {
        chunkKind: "file",
        name: relPath,
        lineStart: 1,
        lineEnd: lines.length,
        content,
      },
    ],
    symbols: options.symbols ?? [],
    imports: options.imports ?? [],
    routes: options.routes ?? [],
  };
}

function symbol(name: string, kind: string, lineStart: number, lineEnd: number): SymbolRecord {
  return {
    name,
    kind,
    exportName: name,
    lineStart,
    lineEnd,
  };
}

function edge(targetPath: string, specifier: string, line: number): ImportEdgeRecord {
  return {
    targetPath,
    specifier,
    importKind: "static",
    isTypeOnly: false,
    line,
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
