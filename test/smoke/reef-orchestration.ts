import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ProjectFinding,
  ReefImpactToolOutput,
  ReefStatusToolOutput,
  ReefVerifyToolOutput,
  ToolBatchToolOutput,
} from "../../packages/contracts/src/index.ts";
import { openGlobalStore } from "../../packages/store/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";
import { seedReefProject } from "../fixtures/reef/index.ts";

function now(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-orchestration-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const priorStateDirname = process.env.MAKO_STATE_DIRNAME;
  const projectRoot = path.join(tmp, "project");
  const stateHome = path.join(tmp, "state");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  mkdirSync(stateHome, { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-orchestration-smoke" }), "utf8");
  writeFileSync(path.join(projectRoot, "src", "app.ts"), "export const value = 1;\n", "utf8");
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const seeded = await seedReefProject({ projectRoot });
  const globalStore = openGlobalStore();
  const toolService = createToolService();
  try {
    globalStore.saveProject({
      projectId: seeded.projectId,
      displayName: "reef-orchestration-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
    seedFinding(seeded.projectId, seeded.store);
    seeded.store.saveReefDiagnosticRun({
      projectId: seeded.projectId,
      source: "eslint",
      overlay: "working_tree",
      status: "succeeded",
      startedAt: now(),
      finishedAt: now(),
      durationMs: 5,
      checkedFileCount: 1,
      findingCount: 1,
      persistedFindingCount: 1,
      command: "fixture eslint",
      cwd: projectRoot,
      metadata: { requestedFiles: ["src/app.ts"] },
    });

    const status = await toolService.callTool("reef_status", {
      projectId: seeded.projectId,
    }) as ReefStatusToolOutput;
    assert.equal(status.toolName, "reef_status");
    assert.equal(status.summary.knownIssueCount, 1);
    assert.equal(status.knownIssues[0]?.ruleId, "orchestration.issue");
    assert.equal(status.reefExecution.queryPath, "reef_materialized_view");

    const verify = await toolService.callTool("reef_verify", {
      projectId: seeded.projectId,
      files: ["src/app.ts"],
      includeOpenLoops: true,
    }) as ReefVerifyToolOutput;
    assert.equal(verify.toolName, "reef_verify");
    assert.equal(verify.verification.toolName, "verification_state");
    assert.equal(verify.openLoops?.toolName, "project_open_loops");
    assert.equal(verify.summary.openLoopErrorCount, 1);
    assert.equal(verify.summary.canClaimVerified, false);
    assert.ok(verify.suggestedActions.some((action) => action.includes("Resolve")));

    const verifyWithoutLoops = await toolService.callTool("reef_verify", {
      projectId: seeded.projectId,
      includeOpenLoops: false,
    }) as ReefVerifyToolOutput;
    assert.equal(verifyWithoutLoops.openLoops, undefined);
    assert.equal(verifyWithoutLoops.summary.openLoopCount, 0);

    const impact = await toolService.callTool("reef_impact", {
      projectId: seeded.projectId,
      filePaths: ["src/app.ts"],
    }) as ReefImpactToolOutput;
    assert.equal(impact.toolName, "reef_impact");
    assert.equal(impact.summary.changedFileCount, 1);
    assert.equal(impact.changedFiles[0]?.filePath, "src/app.ts");

    const batch = await toolService.callTool("tool_batch", {
      projectId: seeded.projectId,
      ops: [
        { label: "status", tool: "reef_status" },
        { label: "verify", tool: "reef_verify", args: { includeOpenLoops: false } },
        { label: "impact", tool: "reef_impact", args: { filePaths: ["src/app.ts"] } },
      ],
    }) as ToolBatchToolOutput;
    assert.equal(batch.summary.succeededOps, 3);
    assert.deepEqual(batch.results.map((result) => result.tool), ["reef_status", "reef_verify", "reef_impact"]);

    console.log("reef-orchestration: PASS");
  } finally {
    toolService.close();
    globalStore.close();
    await seeded.cleanup();
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

function seedFinding(
  projectId: string,
  store: Awaited<ReturnType<typeof seedReefProject>>["store"],
): void {
  const subject = { kind: "file" as const, path: "src/app.ts" };
  const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
  const message = "Fixture active issue blocks completion.";
  const finding: ProjectFinding = {
    projectId,
    fingerprint: store.computeReefFindingFingerprint({
      source: "orchestration_smoke",
      ruleId: "orchestration.issue",
      subjectFingerprint,
      message,
    }),
    source: "orchestration_smoke",
    subjectFingerprint,
    overlay: "working_tree",
    severity: "error",
    status: "active",
    filePath: "src/app.ts",
    line: 1,
    ruleId: "orchestration.issue",
    freshness: { state: "fresh", checkedAt: now(), reason: "fixture fresh" },
    capturedAt: now(),
    message,
    factFingerprints: [],
  };
  store.replaceReefFindingsForSource({
    projectId,
    source: "orchestration_smoke",
    overlay: "working_tree",
    findings: [finding],
  });
}

main().catch((error) => {
  console.error("reef-orchestration: FAIL");
  console.error(error);
  process.exit(1);
});
