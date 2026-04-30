import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ProjectFinding,
  ReefDiffImpactToolOutput,
  ToolBatchToolOutput,
  WorkingTreeOverlayToolOutput,
} from "../../packages/contracts/src/index.ts";
import {
  openGlobalStore,
  openProjectStore,
  type ImportEdgeRecord,
  type IndexedFileRecord,
  type SymbolRecord,
} from "../../packages/store/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";

function now(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-diff-impact-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const priorStateDirname = process.env.MAKO_STATE_DIRNAME;
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "users"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-diff-impact-smoke" }), "utf8");
  writeFileSync(path.join(projectRoot, "src", "util.ts"), "export function formatUser(user: { id: string }) {\n  return user.id;\n}\n", "utf8");
  writeFileSync(path.join(projectRoot, "src", "service.ts"), "import { formatUser } from './util';\nexport function loadUsers() {\n  return [formatUser({ id: '1' })];\n}\n", "utf8");
  writeFileSync(path.join(projectRoot, "app", "api", "users", "route.ts"), "import { loadUsers } from '../../../src/service';\nexport function GET() {\n  return Response.json(loadUsers());\n}\n", "utf8");
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  const toolService = createToolService();
  try {
    seedProject(projectRoot, projectId);
    seedCallerFinding(projectRoot, projectId);

    writeFileSync(path.join(projectRoot, "src", "util.ts"), "export function formatUser(user: { id: string; name?: string }) {\n  return user.name ?? user.id;\n}\n", "utf8");
    const overlay = await toolService.callTool("working_tree_overlay", {
      projectId,
      files: ["src/util.ts"],
    }) as WorkingTreeOverlayToolOutput;
    assert.deepEqual(overlay.scannedFiles, ["src/util.ts"]);

    const impact = await toolService.callTool("reef_diff_impact", {
      projectId,
      filePaths: ["src/util.ts"],
      depth: 2,
      maxCallersPerFile: 10,
      maxFindingsPerCaller: 10,
      maxConventions: 10,
    }) as ReefDiffImpactToolOutput;
    assert.equal(impact.toolName, "reef_diff_impact");
    assert.equal(impact.summary.changedFileCount, 1);
    assert.equal(impact.summary.overlayMissingCount, 0);
    assert.ok(impact.changedFiles[0]?.exportedSymbols.includes("formatUser"));
    assert.ok(impact.impactedCallers.some((entry) =>
      entry.sourceFilePath === "src/util.ts" &&
      entry.callerFilePath === "src/service.ts" &&
      entry.depth === 1
    ));
    assert.ok(impact.impactedCallers.some((entry) =>
      entry.sourceFilePath === "src/util.ts" &&
      entry.callerFilePath === "app/api/users/route.ts" &&
      entry.depth === 2
    ));
    assert.ok(impact.possiblyInvalidatedFindings.some((entry) =>
      entry.callerFilePath === "src/service.ts" &&
      entry.finding.ruleId === "service.active_finding"
    ));
    assert.ok(impact.conventionRisks.some((entry) =>
      entry.filePath === "app/api/users/route.ts" &&
      entry.convention.kind === "route_pattern"
    ));
    assert.equal(impact.reefExecution.queryPath, "reef_materialized_view");
    assert.equal(impact.reefExecution.freshnessPolicy, "allow_stale_labeled");

    const batch = await toolService.callTool("tool_batch", {
      projectId,
      ops: [{
        label: "impact",
        tool: "reef_diff_impact",
        args: { filePaths: ["src/util.ts"], depth: 1 },
      }],
    }) as ToolBatchToolOutput;
    assert.equal(batch.summary.succeededOps, 1);
    assert.equal(batch.results[0]?.tool, "reef_diff_impact");

    console.log("reef-diff-impact: PASS");
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
    rmSync(tmp, { recursive: true, force: true });
  }
}

function seedProject(projectRoot: string, projectId: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "reef-diff-impact-smoke",
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
      name: "reef-diff-impact-smoke",
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
      detectedAt: now(),
    });
    store.replaceIndexSnapshot({
      files: [
        fileRecord("src/util.ts", [
          "export function formatUser(user: { id: string }) {",
          "  return user.id;",
          "}",
        ], {
          symbols: [symbol("formatUser", "function", 1, 3)],
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
        fileRecord("app/api/users/route.ts", [
          "import { loadUsers } from '../../../src/service';",
          "export function GET() {",
          "  return Response.json(loadUsers());",
          "}",
        ], {
          symbols: [symbol("GET", "function", 2, 4)],
          imports: [edge("src/service.ts", "../../../src/service", 1)],
          routes: [{
            routeKey: "nextjs:GET:/api/users",
            framework: "nextjs",
            pattern: "/api/users",
            method: "GET",
            handlerName: "GET",
            isApi: true,
          }],
        }),
      ],
      schemaObjects: [],
      schemaUsages: [],
    });
  } finally {
    store.close();
  }
}

function seedCallerFinding(projectRoot: string, projectId: string): void {
  const store = openProjectStore({ projectRoot });
  try {
    const subject = { kind: "file" as const, path: "src/service.ts" };
    const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
    const ruleId = "service.active_finding";
    const message = "service caller has an active finding";
    const fingerprint = store.computeReefFindingFingerprint({
      source: "lint_files",
      ruleId,
      subjectFingerprint,
      message,
    });
    const finding: ProjectFinding = {
      projectId,
      fingerprint,
      source: "lint_files",
      subjectFingerprint,
      overlay: "working_tree",
      severity: "warning",
      status: "active",
      filePath: subject.path,
      line: 2,
      ruleId,
      freshness: { state: "fresh", checkedAt: now(), reason: "fixture fresh" },
      capturedAt: now(),
      message,
      factFingerprints: [],
    };
    store.replaceReefFindingsForSource({
      projectId,
      source: "lint_files",
      overlay: "working_tree",
      findings: [finding],
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
  const content = `${lines.join("\n")}\n`;
  return {
    path: relPath,
    sha256: relPath,
    language: relPath.endsWith(".tsx") ? "tsx" : "typescript",
    sizeBytes: Buffer.byteLength(content),
    lineCount: lines.length,
    chunks: [{
      chunkKind: "file",
      name: relPath,
      lineStart: 1,
      lineEnd: lines.length,
      content,
    }],
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
    signatureText: `export function ${name}`,
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
