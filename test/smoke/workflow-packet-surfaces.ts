import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  extractWorkflowPacketSurfaceFromToolOutput,
  WorkflowPacketSurfaceSchema,
} from "../../packages/contracts/src/tools.ts";
import { createApiService } from "../../services/api/src/service.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-workflow-packet-surfaces-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectFile = "src/foo.ts";
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "workflow-packet-surfaces-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, projectFile), "export const foo = 1;\n");

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "workflow-packet-surfaces-smoke",
        canonicalPath: projectRoot,
        lastSeenPath: projectRoot,
        supportTarget: "best_effort",
      });
    } finally {
      globalStore.close();
    }

    const projectStore = openProjectStore({ projectRoot });
    try {
      projectStore.saveProjectProfile({
        name: "workflow-packet-surfaces-smoke",
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

      projectStore.replaceIndexSnapshot({
        files: [
          {
            path: projectFile,
            sha256: "cafebabe",
            language: "typescript",
            sizeBytes: 22,
            lineCount: 1,
            chunks: [
              {
                chunkKind: "file",
                name: projectFile,
                lineStart: 1,
                lineEnd: 1,
                content: "export const foo = 1;",
              },
            ],
            symbols: [
              {
                name: "foo",
                kind: "constant",
                exportName: "foo",
                lineStart: 1,
                lineEnd: 1,
                signatureText: "export const foo = 1",
              },
            ],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
      projectStore.beginIndexRun("smoke");
    } finally {
      projectStore.close();
    }

    const api = createApiService();
    try {
      const tools = api.listTools();
      const workflowTool = tools.find((tool) => tool.name === "workflow_packet");
      assert.ok(workflowTool, "workflow_packet should be exposed");
      assert.equal(workflowTool?.category, "workflow");

      const input = {
        projectId,
        family: "workflow_recipe" as const,
        queryKind: "file_health" as const,
        queryText: projectFile,
        watchMode: "watch" as const,
      };

      const toolOutput = await api.callTool("workflow_packet", input);
      const toolSurface = extractWorkflowPacketSurfaceFromToolOutput(toolOutput);
      assert.ok(toolSurface, "tool output should expose a workflow packet surface");
      assert.equal(toolSurface?.surfacePlan.generateWith, "tool");
      assert.equal(toolSurface?.surfacePlan.guidedConsumption, "prompt");
      assert.equal(toolSurface?.watch.mode, "watch");
      assert.equal(toolSurface?.watch.refreshReason, "initial");
      assert.ok((toolSurface?.watch.stablePacketId.length ?? 0) > 0);
      assert.ok((toolSurface?.watch.refreshTriggers.length ?? 0) > 0);
      assert.ok(toolSurface?.handoff, "workflow recipe should expose a compact handoff");
      assert.ok((toolSurface?.handoff?.current.length ?? 0) > 0);
      assert.ok((toolSurface?.handoff?.stopWhen.length ?? 0) > 0);
      assert.match(toolSurface?.rendered ?? "", /Verify:/);

      const secondToolOutput = await api.callTool("workflow_packet", input);
      const secondToolSurface = extractWorkflowPacketSurfaceFromToolOutput(secondToolOutput);
      assert.ok(secondToolSurface, "repeated tool output should expose a workflow packet surface");
      assert.equal(
        secondToolSurface?.watch.stablePacketId,
        toolSurface?.watch.stablePacketId,
        "stablePacketId should stay stable across identical watch calls",
      );

      const refreshedSurface = await api.generateWorkflowPacket({
        ...input,
        refreshReason: "watch_refresh",
      });
      assert.equal(refreshedSurface.watch.refreshReason, "watch_refresh");
      assert.equal(refreshedSurface.watch.stablePacketId, toolSurface?.watch.stablePacketId);

      const apiSurface = await api.generateWorkflowPacket(input);
      assert.equal(apiSurface.packet.family, toolSurface?.packet.family);
      assert.equal(apiSurface.surfacePlan.generateWith, toolSurface?.surfacePlan.generateWith);
      assert.equal(apiSurface.surfacePlan.guidedConsumption, toolSurface?.surfacePlan.guidedConsumption);
      assert.equal(apiSurface.watch.mode, toolSurface?.watch.mode);
      assert.equal(apiSurface.watch.refreshReason, toolSurface?.watch.refreshReason);
      assert.deepEqual(apiSurface.watch.refreshTriggers, toolSurface?.watch.refreshTriggers);
      assert.deepEqual(apiSurface.handoff, toolSurface?.handoff);
      assert.match(apiSurface.rendered, /Verify:/);

      const briefSurface = await api.generateWorkflowPacket({
        projectId,
        family: "implementation_brief",
        queryKind: "file_health",
        queryText: projectFile,
      });
      assert.equal(briefSurface.surfacePlan.reusableContext, "resource");
      assert.equal(briefSurface.surfacePlan.guidedConsumption, null);
      assert.equal(briefSurface.handoff, undefined);
      WorkflowPacketSurfaceSchema.parse(briefSurface);
    } finally {
      api.close();
    }

    console.log("workflow-packet-surfaces: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
