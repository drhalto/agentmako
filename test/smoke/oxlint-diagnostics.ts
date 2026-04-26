import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { OxlintDiagnosticsToolOutput } from "../../packages/contracts/src/index.ts";
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
    JSON.stringify({
      name: "oxlint-diagnostics-smoke",
      version: "0.0.0",
      scripts: {
        "oxlint:json": "node oxlint-json.cjs",
      },
    }),
  );
  writeFileSync(path.join(projectRoot, "src", "bad.ts"), "debugger;\n");
  writeFileSync(path.join(projectRoot, "src", "good.ts"), "export const good = true;\n");
  writeFileSync(
    path.join(projectRoot, "oxlint-json.cjs"),
    [
      "const path = require('node:path');",
      "const files = [];",
      "for (let i = 2; i < process.argv.length; i++) {",
      "  const arg = process.argv[i];",
      "  if (arg === '--format') { i++; continue; }",
      "  if (!arg.startsWith('-')) files.push(arg);",
      "}",
      "const diagnostics = [];",
      "for (const file of files) {",
      "  if (!file.includes('bad.ts')) continue;",
      "  diagnostics.push({",
      "    message: '`debugger` statement is not allowed',",
      "    code: 'eslint(no-debugger)',",
      "    severity: 'error',",
      "    url: 'https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html',",
      "    help: 'Remove the debugger statement',",
      "    filename: path.resolve(process.cwd(), file),",
      "    labels: [{ span: { line: 1, column: 1, offset: 0, length: 8 } }],",
      "    causes: [],",
      "    related: [],",
      "  });",
      "}",
      "process.stdout.write(JSON.stringify({ diagnostics, number_of_files: files.length, number_of_rules: 2, threads_count: 1, start_time: 0 }));",
      "process.exit(diagnostics.length > 0 ? 1 : 0);",
    ].join("\n"),
  );
  registerProject(projectRoot, projectId, "oxlint-diagnostics-smoke");
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-oxlint-diagnostics-"));
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
    const bad = await invokeTool("oxlint_diagnostics", {
      projectId,
      files: ["src/bad.ts"],
    }) as OxlintDiagnosticsToolOutput;
    assert.equal(bad.toolName, "oxlint_diagnostics");
    assert.equal(bad.status, "succeeded");
    assert.equal(bad.requestedFiles[0], "src/bad.ts");
    assert.equal(bad.totalFindings, 1);
    assert.equal(bad.findings[0]?.ruleId, "eslint(no-debugger)");
    assert.equal(bad.findings[0]?.source, "oxlint");
    assert.equal(bad.findings[0]?.overlay, "working_tree");
    assert.equal(bad.findings[0]?.documentationUrl, "https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-debugger.html");

    const store = openProjectStore({ projectRoot });
    try {
      const active = store.queryReefFindings({
        projectId,
        source: "oxlint",
        overlay: "working_tree",
        filePath: "src/bad.ts",
      });
      assert.equal(active.length, 1);
      assert.equal(active[0]?.ruleId, "eslint(no-debugger)");
      assert.ok(
        store.listReefRuleDescriptors().some((rule) =>
          rule.sourceNamespace === "oxlint" &&
          rule.id === "eslint(no-debugger)"
        ),
        "oxlint_diagnostics should register rule descriptors",
      );
      const runs = store.queryReefDiagnosticRuns({
        projectId,
        source: "oxlint",
        status: "succeeded",
        limit: 1,
      });
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.findingCount, 1);
      assert.equal(runs[0]?.checkedFileCount, 1);
    } finally {
      store.close();
    }

    const good = await invokeTool("oxlint_diagnostics", {
      projectId,
      files: ["src/good.ts"],
    }) as OxlintDiagnosticsToolOutput;
    assert.equal(good.status, "succeeded");
    assert.equal(good.totalFindings, 0);

    const noOxlintRoot = path.join(tmp, "project-no-oxlint");
    mkdirSync(noOxlintRoot, { recursive: true });
    const noOxlintProjectId = randomUUID();
    registerProject(noOxlintRoot, noOxlintProjectId, "oxlint-diagnostics-no-oxlint-smoke");
    const unavailable = await invokeTool("oxlint_diagnostics", {
      projectId: noOxlintProjectId,
      files: ["src/missing.ts"],
    }) as OxlintDiagnosticsToolOutput;
    assert.equal(unavailable.status, "unavailable");
    const noOxlintStore = openProjectStore({ projectRoot: noOxlintRoot });
    try {
      const unavailableRuns = noOxlintStore.queryReefDiagnosticRuns({
        projectId: noOxlintProjectId,
        source: "oxlint",
        status: "unavailable",
        limit: 1,
      });
      assert.equal(unavailableRuns.length, 1);
    } finally {
      noOxlintStore.close();
    }

    console.log("oxlint-diagnostics: PASS");
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
