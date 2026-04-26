import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JsonValue, RecallToolRunsToolOutput } from "../../packages/contracts/src/index.ts";
import { RecallToolRunsToolOutputSchema } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

type ToolRunOutcome = "success" | "failed" | "error";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function isoMsBefore(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() - ms).toISOString();
}

function seedProject(projectRoot: string, projectId: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "recall-tool-runs-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "native",
    });
  } finally {
    globalStore.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-recall-tool-runs-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "recall-tool-runs-smoke" }));
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    const store = openProjectStore({ projectRoot });
    try {
      function insertRun(args: {
        toolName: string;
        outcome: ToolRunOutcome;
        requestId: string;
        daysAgo: number;
        payload?: JsonValue;
        errorText?: string;
      }): void {
        const finishedAt = isoDaysAgo(args.daysAgo);
        store.insertToolRun({
          projectId,
          toolName: args.toolName,
          inputSummary: { projectId, marker: args.requestId },
          outputSummary: args.outcome === "success" ? { ok: true } : { ok: false },
          payload: args.payload,
          outcome: args.outcome,
          startedAt: isoMsBefore(finishedAt, 250),
          finishedAt,
          durationMs: 250,
          requestId: args.requestId,
          errorText: args.errorText,
        });
      }

      insertRun({
        toolName: "lint_files",
        outcome: "failed",
        requestId: "req_failed_1",
        daysAgo: 1,
        payload: { diagnostics: ["no-console"] },
        errorText: "lint found diagnostics",
      });
      insertRun({
        toolName: "repo_map",
        outcome: "success",
        requestId: "req_success_1",
        daysAgo: 2,
        payload: { files: ["src/index.ts"] },
      });
      insertRun({
        toolName: "repo_map",
        outcome: "failed",
        requestId: "req_failed_2",
        daysAgo: 4,
        payload: { reason: "budget" },
        errorText: "budget exceeded",
      });
      insertRun({
        toolName: "ast_find_pattern",
        outcome: "success",
        requestId: "req_success_2",
        daysAgo: 5,
      });
      insertRun({
        toolName: "lint_files",
        outcome: "failed",
        requestId: "req_old_failed",
        daysAgo: 45,
        payload: { old: true },
        errorText: "old failure",
      });
    } finally {
      store.close();
    }

    const failed = RecallToolRunsToolOutputSchema.parse(await invokeTool("recall_tool_runs", {
      projectId,
      outcome: "failed",
    })) as RecallToolRunsToolOutput;
    assert.equal(failed.toolName, "recall_tool_runs");
    assert.equal(failed.projectId, projectId);
    assert.equal(failed.matchCount, 2, "default 30-day window excludes old failed run");
    assert.equal(failed.toolRuns.length, 2);
    assert.ok(failed.toolRuns.every((run) => run.outcome === "failed"));
    assert.ok(failed.toolRuns.every((run) => !("payload" in run)), "payload omitted by default");

    const withPayload = RecallToolRunsToolOutputSchema.parse(await invokeTool("recall_tool_runs", {
      projectId,
      requestId: "req_failed_1",
      includePayload: true,
    })) as RecallToolRunsToolOutput;
    assert.equal(withPayload.matchCount, 1);
    assert.deepEqual(withPayload.toolRuns[0]?.payload, { diagnostics: ["no-console"] });
    assert.equal(withPayload.toolRuns[0]?.errorText, "lint found diagnostics");

    const repoMap = RecallToolRunsToolOutputSchema.parse(await invokeTool("recall_tool_runs", {
      projectId,
      toolName: "repo_map",
    })) as RecallToolRunsToolOutput;
    assert.equal(repoMap.matchCount, 2);
    assert.deepEqual(new Set(repoMap.toolRuns.map((run) => run.outcome)), new Set(["success", "failed"]));

    const narrowWindow = RecallToolRunsToolOutputSchema.parse(await invokeTool("recall_tool_runs", {
      projectId,
      toolName: "repo_map",
      since: isoDaysAgo(2.5),
    })) as RecallToolRunsToolOutput;
    assert.equal(narrowWindow.matchCount, 1);
    assert.deepEqual(
      narrowWindow.toolRuns.map((run) => run.requestId).sort(),
      ["req_success_1"],
    );

    const truncated = RecallToolRunsToolOutputSchema.parse(await invokeTool("recall_tool_runs", {
      projectId,
      toolName: "repo_map",
      limit: 1,
    })) as RecallToolRunsToolOutput;
    assert.equal(truncated.matchCount, 2);
    assert.equal(truncated.toolRuns.length, 1);
    assert.equal(truncated.truncated, true);
    assert.ok(truncated.warnings[0]?.includes("truncated"));

    console.log("recall-tool-runs: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("recall-tool-runs: FAIL");
  console.error(error);
  process.exit(1);
});
