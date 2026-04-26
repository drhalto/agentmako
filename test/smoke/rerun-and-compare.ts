import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "rerun-compare-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "src", "auth.ts"),
    "export function requireAuth() { return 'auth'; }\n",
  );

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "rerun-compare-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }
}

function replaceSnapshot(projectRoot: string, includeSymbol: boolean): void {
  const authSource = "export function requireAuth() { return 'auth'; }\n";
  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "rerun-compare-smoke",
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
      detectedAt: new Date().toISOString(),
    });

    store.replaceIndexSnapshot({
      files: [
        {
          path: "src/auth.ts",
          sha256: includeSymbol ? "with-symbol" : "without-symbol",
          language: "typescript",
          sizeBytes: Buffer.byteLength(authSource, "utf8"),
          lineCount: 1,
          chunks: [
            {
              chunkKind: "file",
              name: "src/auth.ts",
              lineStart: 1,
              lineEnd: 1,
              content: authSource.trimEnd(),
            },
          ],
          symbols: includeSymbol
            ? [
                {
                  name: "requireAuth",
                  kind: "function",
                  exportName: "requireAuth",
                  lineStart: 1,
                  lineEnd: 1,
                  signatureText: "export function requireAuth()",
                },
              ]
            : [],
          imports: [],
          routes: [],
        },
      ],
      schemaObjects: [],
      schemaUsages: [],
    });

    const run = store.beginIndexRun(includeSymbol ? "seeded" : "mutated");
    store.finishIndexRun(run.runId, "succeeded");
  } finally {
    store.close();
  }
}

function extractResult(output: unknown): { queryId: string } {
  if (output && typeof output === "object" && "queryId" in output) {
    return output as { queryId: string };
  }
  if (output && typeof output === "object" && "result" in output) {
    const nested = (output as { result?: unknown }).result;
    if (nested && typeof nested === "object" && "queryId" in nested) {
      return nested as { queryId: string };
    }
  }
  throw new Error("Missing result queryId.");
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-rerun-compare-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);
  replaceSnapshot(projectRoot, true);

  const toolService = createToolService();
  try {
    const composerOutput = await toolService.callTool("trace_file", {
      projectId,
      file: "src/auth.ts",
    });
    const composerTraceId = extractResult(composerOutput).queryId;

    const answerOutput = await toolService.callTool("file_health", {
      projectId,
      file: "src/auth.ts",
    });
    const answerTraceId = extractResult(answerOutput).queryId;

    const firstComposerCompare = await toolService.rerunAndCompare({
      projectId,
      traceId: composerTraceId,
    });
    assert.equal(firstComposerCompare.currentRun.provenance, "manual_rerun");
    assert.equal(firstComposerCompare.comparison.meaningfulChangeDetected, false);
    assert.ok(
      firstComposerCompare.comparison.summaryChanges.every((item) => item.code === "answer_markdown_changed"),
      "expected unchanged rerun to stay quiet aside from optional markdown churn",
    );

    const answerCompare = await toolService.rerunAndCompare({
      projectId,
      traceId: answerTraceId,
    });
    assert.equal(answerCompare.currentRun.provenance, "manual_rerun");
    assert.equal(answerCompare.comparison.meaningfulChangeDetected, false);

    replaceSnapshot(projectRoot, false);

    const changedComposerCompare = await toolService.rerunAndCompare({
      projectId,
      targetId: firstComposerCompare.priorRun.targetId,
    });
    assert.equal(changedComposerCompare.comparison.priorTraceId, firstComposerCompare.currentRun.traceId);
    assert.equal(changedComposerCompare.comparison.meaningfulChangeDetected, true);
    assert.ok(
      changedComposerCompare.comparison.summaryChanges.some((item) => item.code === "core_claim_conflict"),
      "expected changed rerun to mark a core-claim conflict when strong evidence disappears without replacement",
    );
    assert.ok(
      changedComposerCompare.comparison.summaryChanges.some((item) => item.code === "evidence_removed"),
      "expected changed rerun to report removed evidence",
    );

    const contradictedOlder = await toolService.evaluateTrustState({
      projectId,
      traceId: changedComposerCompare.priorRun.traceId,
    });
    assert.equal(contradictedOlder.evaluation.state, "contradicted");

    const store = openProjectStore({ projectRoot });
    try {
      const latestComparison = store.getLatestAnswerComparison(firstComposerCompare.priorRun.targetId);
      assert.equal(latestComparison?.comparisonId, changedComposerCompare.comparison.comparisonId);

      const pairLookup = store.getAnswerComparisonByRunPair({
        priorTraceId: changedComposerCompare.comparison.priorTraceId,
        currentTraceId: changedComposerCompare.comparison.currentTraceId,
      });
      assert.equal(pairLookup?.comparisonId, changedComposerCompare.comparison.comparisonId);

      const history = store.listAnswerComparisons(firstComposerCompare.priorRun.targetId);
      assert.equal(history.length, 2, "expected both unchanged and changed comparisons to persist");

      assert.throws(
        () =>
          store.db
            .prepare("UPDATE answer_comparisons SET meaningful_change_detected = 0 WHERE comparison_id = ?")
            .run(changedComposerCompare.comparison.comparisonId),
        /append-only/i,
        "expected answer comparison rows to be append-only",
      );
    } finally {
      store.close();
    }

    console.log("rerun-and-compare: PASS");
  } finally {
    toolService.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
