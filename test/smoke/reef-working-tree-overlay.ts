import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  FileFactsToolOutput,
  ProjectFactsToolOutput,
  ToolBatchToolOutput,
  WorkingTreeOverlayToolOutput,
} from "../../packages/contracts/src/index.ts";
import { openGlobalStore } from "../../packages/store/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";
import { seedReefProject } from "../fixtures/reef/index.ts";

interface FileSnapshotData {
  state?: string;
  sha256?: string;
  sizeBytes?: number;
  lineCount?: number;
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-working-tree-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const projectRoot = path.join(tmp, "project");
  const stateHome = path.join(tmp, "state");
  const filePath = path.join(projectRoot, "src", "live.ts");
  mkdirSync(path.dirname(filePath), { recursive: true });
  mkdirSync(stateHome, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;

  const seeded = await seedReefProject({ projectRoot });
  const globalStore = openGlobalStore();
  const toolService = createToolService();
  try {
    globalStore.saveProject({
      projectId: seeded.projectId,
      displayName: "reef-working-tree-overlay-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });

    writeFileSync(filePath, "export const answer = 1;\n", "utf8");

    const first = await toolService.callTool("working_tree_overlay", {
      projectId: seeded.projectId,
      files: ["src/live.ts"],
    }) as WorkingTreeOverlayToolOutput;
    assert.equal(first.toolName, "working_tree_overlay");
    assert.deepEqual(first.scannedFiles, ["src/live.ts"]);
    assert.equal(first.facts.length, 1);
    const firstData = first.facts[0]?.data as FileSnapshotData | undefined;
    assert.equal(firstData?.state, "present");
    assert.equal(firstData?.lineCount, 2);
    assert.ok(firstData?.sha256);

    const fileFacts = await toolService.callTool("file_facts", {
      projectId: seeded.projectId,
      filePath: path.join(projectRoot, "src", "live.ts"),
      overlay: "working_tree",
      source: "working_tree_overlay",
      kind: "file_snapshot",
    }) as FileFactsToolOutput;
    assert.equal(fileFacts.toolName, "file_facts");
    assert.equal(fileFacts.filePath, "src/live.ts");
    assert.equal(fileFacts.totalReturned, 1);
    assert.equal(fileFacts.facts[0]?.fingerprint, first.facts[0]?.fingerprint);

    writeFileSync(filePath, "export const answer = 2;\n", "utf8");

    const second = await toolService.callTool("working_tree_overlay", {
      projectId: seeded.projectId,
      files: ["src/live.ts"],
    }) as WorkingTreeOverlayToolOutput;
    assert.equal(second.facts.length, 1);
    const secondData = second.facts[0]?.data as FileSnapshotData | undefined;
    assert.equal(secondData?.state, "present");
    assert.notEqual(secondData?.sha256, firstData?.sha256);

    const projectFacts = await toolService.callTool("project_facts", {
      projectId: seeded.projectId,
      overlay: "working_tree",
      source: "working_tree_overlay",
      kind: "file_snapshot",
    }) as ProjectFactsToolOutput;
    assert.equal(projectFacts.toolName, "project_facts");
    assert.equal(projectFacts.totalReturned, 1, "working-tree file facts replace instead of appending");
    assert.equal(projectFacts.facts[0]?.fingerprint, second.facts[0]?.fingerprint);

    unlinkSync(filePath);

    const deleted = await toolService.callTool("working_tree_overlay", {
      projectId: seeded.projectId,
      files: ["src/live.ts"],
    }) as WorkingTreeOverlayToolOutput;
    assert.deepEqual(deleted.deletedFiles, ["src/live.ts"]);
    const deletedData = deleted.facts[0]?.data as FileSnapshotData | undefined;
    assert.equal(deletedData?.state, "deleted");

    const batch = await toolService.callTool("tool_batch", {
      projectId: seeded.projectId,
      ops: [
        { label: "file-facts", tool: "file_facts", args: { filePath: "src/live.ts" } },
        { label: "project-facts", tool: "project_facts", args: { source: "working_tree_overlay" } },
      ],
    }) as ToolBatchToolOutput;
    assert.equal(batch.summary.executedOps, 2);
    assert.equal(batch.summary.succeededOps, 2);
    assert.equal(batch.results[0]?.tool, "file_facts");
    assert.equal(batch.results[1]?.tool, "project_facts");

    console.log("reef-working-tree-overlay: PASS");
  } finally {
    toolService.close();
    globalStore.close();
    await seeded.cleanup();
    if (priorStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = priorStateHome;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
