import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { TypeScriptDiagnosticsToolOutput } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function registerProject(projectRoot: string, projectId: string, displayName: string): void {
  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName,
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }
}

function seedProject(projectRoot: string, projectId: string): void {
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "typescript-diagnostics-smoke", version: "0.0.0" }),
  );
  writeFileSync(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "Node",
        skipLibCheck: true,
        types: [],
      },
      include: ["src/**/*.ts"],
    }, null, 2),
  );
  writeFileSync(
    path.join(projectRoot, "src", "bad.ts"),
    "export const count: number = \"oops\";\n",
  );
  registerProject(projectRoot, projectId, "typescript-diagnostics-smoke");
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-typescript-diagnostics-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const priorStateHome = process.env.MAKO_STATE_HOME;
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    const first = await invokeTool("typescript_diagnostics", {
      projectId,
      files: ["src/bad.ts"],
    }) as TypeScriptDiagnosticsToolOutput;
    assert.equal(first.toolName, "typescript_diagnostics");
    assert.equal(first.status, "succeeded");
    assert.equal(first.requestedFiles[0], "src/bad.ts");
    assert.ok(first.checkedFileCount >= 1);
    assert.ok(first.totalFindings >= 1);
    const ts2322 = first.findings.find((finding) => finding.ruleId === "TS2322");
    assert.ok(ts2322, "expected TS2322 assignment diagnostic");
    assert.equal(ts2322.source, "typescript");
    assert.equal(ts2322.overlay, "working_tree");
    assert.equal(ts2322.filePath, "src/bad.ts");

    const store = openProjectStore({ projectRoot });
    try {
      const active = store.queryReefFindings({
        projectId,
        source: "typescript",
        overlay: "working_tree",
        filePath: "src/bad.ts",
      });
      assert.ok(active.some((finding) => finding.ruleId === "TS2322"));
      assert.ok(
        store.listReefRuleDescriptors().some((rule) =>
          rule.sourceNamespace === "typescript" &&
          rule.id === "TS2322"
        ),
        "typescript_diagnostics should register rule descriptors",
      );
      const runs = store.queryReefDiagnosticRuns({
        projectId,
        source: "typescript",
        limit: 1,
      });
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.status, "succeeded");
      assert.equal(runs[0]?.findingCount, first.totalFindings);
      assert.equal(runs[0]?.persistedFindingCount, first.persistedFindings);
      assert.equal(runs[0]?.configPath, "tsconfig.json");
    } finally {
      store.close();
    }

    writeFileSync(
      path.join(projectRoot, "src", "bad.ts"),
      "export const count: number = 1;\n",
    );
    const second = await invokeTool("typescript_diagnostics", {
      projectId,
      files: ["src/bad.ts"],
    }) as TypeScriptDiagnosticsToolOutput;
    assert.equal(second.status, "succeeded");
    assert.equal(second.totalFindings, 0);

    const afterFix = openProjectStore({ projectRoot });
    try {
      assert.equal(
        afterFix.queryReefFindings({
          projectId,
          source: "typescript",
          overlay: "working_tree",
          filePath: "src/bad.ts",
        }).length,
        0,
        "fixed file should no longer have active TypeScript Reef findings",
      );
      const resolved = afterFix.queryReefFindings({
        projectId,
        source: "typescript",
        overlay: "working_tree",
        filePath: "src/bad.ts",
        includeResolved: true,
        status: "resolved",
      });
      assert.ok(resolved.some((finding) => finding.ruleId === "TS2322"));
      const successfulRuns = afterFix.queryReefDiagnosticRuns({
        projectId,
        source: "typescript",
        status: "succeeded",
        limit: 5,
      });
      assert.ok(successfulRuns.length >= 2);
      assert.equal(successfulRuns[0]?.findingCount, 0);
    } finally {
      afterFix.close();
    }

    const noConfigRoot = path.join(tmp, "project-no-config");
    mkdirSync(noConfigRoot, { recursive: true });
    const noConfigProjectId = randomUUID();
    registerProject(noConfigRoot, noConfigProjectId, "typescript-diagnostics-no-config-smoke");
    const unavailable = await invokeTool("typescript_diagnostics", {
      projectId: noConfigProjectId,
    }) as TypeScriptDiagnosticsToolOutput;
    assert.equal(unavailable.status, "unavailable");
    const noConfigStore = openProjectStore({ projectRoot: noConfigRoot });
    try {
      const unavailableRuns = noConfigStore.queryReefDiagnosticRuns({
        projectId: noConfigProjectId,
        source: "typescript",
        status: "unavailable",
        limit: 1,
      });
      assert.equal(unavailableRuns.length, 1);
      assert.equal(unavailableRuns[0]?.findingCount, 0);
      assert.equal(unavailableRuns[0]?.persistedFindingCount, 0);
    } finally {
      noConfigStore.close();
    }

    console.log("typescript-diagnostics: PASS");
  } finally {
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
  process.exit(1);
});
