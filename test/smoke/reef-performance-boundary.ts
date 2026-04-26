import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { ProjectFinding } from "../../packages/contracts/src/index.ts";
import { createProjectStoreCache, openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { createHotIndexCache } from "../../packages/tools/src/hot-index/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

const FILE_COUNT = 5_000;
const FINDING_COUNT = 5_000;
const PROJECT_QUERY_P95_LIMIT_MS = 500;
const FILE_QUERY_P95_LIMIT_MS = 30;
const CONTEXT_PACKET_COLD_P95_LIMIT_MS = 1_500;
const OVERLAY_REPLACEMENT_P95_LIMIT_MS = 500;

function now(): string {
  return new Date().toISOString();
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function filePathFor(index: number): string {
  return `src/file-${String(index).padStart(4, "0")}.ts`;
}

function fileContentFor(index: number): string {
  return [
    `export const authSessionFile${String(index).padStart(4, "0")} = ${index};`,
    `export function readAuthSession${String(index).padStart(4, "0")}() {`,
    `  return authSessionFile${String(index).padStart(4, "0")};`,
    "}",
  ].join("\n");
}

function fileRecord(index: number) {
  const relPath = filePathFor(index);
  const content = fileContentFor(index);
  return {
    path: relPath,
    sha256: relPath,
    language: "typescript" as const,
    sizeBytes: Buffer.byteLength(`${content}\n`),
    lineCount: `${content}\n`.split("\n").length,
    lastModifiedAt: now(),
    chunks: [{
      chunkKind: "file" as const,
      name: relPath,
      lineStart: 1,
      lineEnd: content.split("\n").length,
      content,
    }],
    symbols: [{
      name: `readAuthSession${String(index).padStart(4, "0")}`,
      kind: "function",
      exportName: `readAuthSession${String(index).padStart(4, "0")}`,
      lineStart: 2,
      lineEnd: 4,
    }],
    imports: [],
    routes: [],
  };
}

function seedProject(projectRoot: string, projectId: string): void {
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-performance-boundary" }));
  writeFileSync(path.join(projectRoot, filePathFor(42)), `${fileContentFor(42)}\n`);

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "reef-performance-boundary",
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
      name: "reef-performance-boundary",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: "src",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: now(),
    });

    const run = store.beginIndexRun("reef_perf_seed");
    store.replaceIndexSnapshot({
      files: Array.from({ length: FILE_COUNT }, (_, index) => fileRecord(index)),
      schemaObjects: [],
      schemaUsages: [],
    });
    store.finishIndexRun(run.runId, "succeeded");

    const capturedAt = now();
    const findings: ProjectFinding[] = [];
    for (let index = 0; index < FINDING_COUNT; index += 1) {
      const filePath = filePathFor(index);
      const subject = { kind: "diagnostic" as const, path: filePath, code: "reef.perf" };
      const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
      findings.push({
        projectId,
        fingerprint: store.computeReefFindingFingerprint({
          source: "reef_rule:perf",
          ruleId: "reef.perf",
          subjectFingerprint,
          message: `Perf fixture finding ${index}`,
        }),
        source: "reef_rule:perf",
        subjectFingerprint,
        overlay: "working_tree",
        severity: index % 5 === 0 ? "error" : "warning",
        status: "active",
        filePath,
        line: 2,
        ruleId: "reef.perf",
        freshness: {
          state: "fresh",
          checkedAt: capturedAt,
          reason: "reef performance fixture",
        },
        capturedAt,
        message: `Perf fixture finding ${index}`,
        factFingerprints: [],
      });
    }
    store.replaceReefFindingsForSource({
      projectId,
      source: "reef_rule:perf",
      overlay: "working_tree",
      findings,
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-performance-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = "reef_performance_boundary";
  const storeCache = createProjectStoreCache();

  try {
    seedProject(projectRoot, projectId);
    const store = storeCache.borrow({ projectRoot });

    const projectDurations: number[] = [];
    const fileDurations: number[] = [];
    for (let iteration = 0; iteration < 30; iteration += 1) {
      let started = performance.now();
      assert.equal(
        store.queryReefFindings({
          projectId,
          overlay: "working_tree",
          status: "active",
          limit: FINDING_COUNT,
        }).length,
        FINDING_COUNT,
      );
      projectDurations.push(performance.now() - started);

      started = performance.now();
      assert.equal(
        store.queryReefFindings({
          projectId,
          filePath: filePathFor(42),
          overlay: "working_tree",
          status: "active",
          limit: 100,
        }).length,
        1,
      );
      fileDurations.push(performance.now() - started);
    }

    const contextDurations: number[] = [];
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const hotIndexCache = createHotIndexCache();
      const started = performance.now();
      await invokeTool(
        "context_packet",
        {
          projectId,
          request: "auth session file 0042 type issue",
          focusFiles: [filePathFor(42)],
          maxPrimaryContext: 5,
          maxRelatedContext: 5,
        },
        { projectStoreCache: storeCache, hotIndexCache },
      );
      contextDurations.push(performance.now() - started);
      hotIndexCache.flush();
    }

    const overlayDurations: number[] = [];
    for (let iteration = 0; iteration < 20; iteration += 1) {
      writeFileSync(
        path.join(projectRoot, filePathFor(42)),
        `${fileContentFor(42)}\nexport const edit${iteration} = ${iteration};\n`,
      );
      const started = performance.now();
      await invokeTool(
        "working_tree_overlay",
        { projectId, files: [filePathFor(42)] },
        { projectStoreCache: storeCache },
      );
      overlayDurations.push(performance.now() - started);
    }

    const projectQueryP95Ms = p95(projectDurations);
    const fileQueryP95Ms = p95(fileDurations);
    const contextPacketColdP95Ms = p95(contextDurations);
    const overlayReplacementP95Ms = p95(overlayDurations);

    assert.ok(
      projectQueryP95Ms < PROJECT_QUERY_P95_LIMIT_MS,
      `project findings query p95 ${projectQueryP95Ms.toFixed(2)}ms exceeds ${PROJECT_QUERY_P95_LIMIT_MS}ms`,
    );
    assert.ok(
      fileQueryP95Ms < FILE_QUERY_P95_LIMIT_MS,
      `one-file findings query p95 ${fileQueryP95Ms.toFixed(2)}ms exceeds ${FILE_QUERY_P95_LIMIT_MS}ms`,
    );
    assert.ok(
      contextPacketColdP95Ms < CONTEXT_PACKET_COLD_P95_LIMIT_MS,
      `cold context_packet p95 ${contextPacketColdP95Ms.toFixed(2)}ms exceeds ${CONTEXT_PACKET_COLD_P95_LIMIT_MS}ms`,
    );
    assert.ok(
      overlayReplacementP95Ms < OVERLAY_REPLACEMENT_P95_LIMIT_MS,
      `overlay replacement p95 ${overlayReplacementP95Ms.toFixed(2)}ms exceeds ${OVERLAY_REPLACEMENT_P95_LIMIT_MS}ms`,
    );

    console.log(
      [
        "reef-performance-boundary: PASS",
        `files=${FILE_COUNT}`,
        `findings=${FINDING_COUNT}`,
        `projectQueryP95Ms=${projectQueryP95Ms.toFixed(2)}`,
        `fileQueryP95Ms=${fileQueryP95Ms.toFixed(2)}`,
        `contextPacketColdP95Ms=${contextPacketColdP95Ms.toFixed(2)}`,
        `overlayReplacementP95Ms=${overlayReplacementP95Ms.toFixed(2)}`,
      ].join(" "),
    );
  } finally {
    storeCache.flush();
    if (originalStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = originalStateHome;
    }
    if (originalStateDirName === undefined) {
      delete process.env.MAKO_STATE_DIRNAME;
    } else {
      process.env.MAKO_STATE_DIRNAME = originalStateDirName;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

