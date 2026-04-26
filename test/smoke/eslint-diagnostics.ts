import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { EslintDiagnosticsToolOutput } from "../../packages/contracts/src/index.ts";
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
  mkdirSync(path.join(projectRoot, "node_modules", "eslint", "bin"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "eslint-diagnostics-smoke", version: "0.0.0" }),
  );
  writeFileSync(path.join(projectRoot, "src", "bad.ts"), "console.log('bad');\n");
  writeFileSync(path.join(projectRoot, "src", "good.ts"), "export const good = true;\n");
  writeFileSync(
    path.join(projectRoot, "node_modules", "eslint", "bin", "eslint.js"),
    [
      "const path = require('node:path');",
      "const files = [];",
      "for (let i = 2; i < process.argv.length; i++) {",
      "  const arg = process.argv[i];",
      "  if (arg === '--format') { i++; continue; }",
      "  if (!arg.startsWith('-')) files.push(arg);",
      "}",
      "const results = files.map((file) => {",
      "  const absolute = path.resolve(process.cwd(), file);",
      "  return {",
      "    filePath: absolute,",
      "    messages: file.includes('bad.ts') ? [{ ruleId: 'no-console', severity: 2, message: 'Unexpected console statement.', line: 1, column: 1 }] : [],",
      "  };",
      "});",
      "process.stdout.write(JSON.stringify(results));",
      "process.exit(results.some((result) => result.messages.length > 0) ? 1 : 0);",
    ].join("\n"),
  );
  registerProject(projectRoot, projectId, "eslint-diagnostics-smoke");
}

function seedScriptProject(projectRoot: string, projectId: string): void {
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({
      name: "eslint-diagnostics-script-smoke",
      version: "0.0.0",
      scripts: {
        "eslint:json": "node eslint-json.cjs",
      },
    }),
  );
  writeFileSync(path.join(projectRoot, "src", "bad.ts"), "console.log('bad');\n");
  writeFileSync(
    path.join(projectRoot, "eslint-json.cjs"),
    [
      "const path = require('node:path');",
      "const files = [];",
      "for (let i = 2; i < process.argv.length; i++) {",
      "  const arg = process.argv[i];",
      "  if (arg === '--format') { i++; continue; }",
      "  if (!arg.startsWith('-')) files.push(arg);",
      "}",
      "process.stdout.write(JSON.stringify(files.map((file) => ({",
      "  filePath: path.resolve(process.cwd(), file),",
      "  messages: [{ ruleId: 'eqeqeq', severity: 1, message: 'Expected ===.', line: 1, column: 1 }],",
      "}))));",
      "process.exit(1);",
    ].join("\n"),
  );
  registerProject(projectRoot, projectId, "eslint-diagnostics-script-smoke");
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-eslint-diagnostics-"));
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
    const bad = await invokeTool("eslint_diagnostics", {
      projectId,
      files: ["src/bad.ts"],
    }) as EslintDiagnosticsToolOutput;
    assert.equal(bad.toolName, "eslint_diagnostics");
    assert.equal(bad.status, "succeeded");
    assert.equal(bad.requestedFiles[0], "src/bad.ts");
    assert.equal(bad.totalFindings, 1);
    assert.equal(bad.findings[0]?.ruleId, "no-console");
    assert.equal(bad.findings[0]?.source, "eslint");
    assert.equal(bad.findings[0]?.overlay, "working_tree");

    const store = openProjectStore({ projectRoot });
    try {
      const active = store.queryReefFindings({
        projectId,
        source: "eslint",
        overlay: "working_tree",
        filePath: "src/bad.ts",
      });
      assert.equal(active.length, 1);
      assert.equal(active[0]?.ruleId, "no-console");
      assert.ok(
        store.listReefRuleDescriptors().some((rule) =>
          rule.sourceNamespace === "eslint" &&
          rule.id === "no-console"
        ),
        "eslint_diagnostics should register rule descriptors",
      );
      const runs = store.queryReefDiagnosticRuns({
        projectId,
        source: "eslint",
        status: "succeeded",
        limit: 1,
      });
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.findingCount, 1);
      assert.equal(runs[0]?.persistedFindingCount, 1);
    } finally {
      store.close();
    }

    const good = await invokeTool("eslint_diagnostics", {
      projectId,
      files: ["src/good.ts"],
    }) as EslintDiagnosticsToolOutput;
    assert.equal(good.status, "succeeded");
    assert.equal(good.totalFindings, 0);

    const scriptRoot = path.join(tmp, "project-script-eslint");
    mkdirSync(scriptRoot, { recursive: true });
    const scriptProjectId = randomUUID();
    seedScriptProject(scriptRoot, scriptProjectId);
    const scriptLint = await invokeTool("eslint_diagnostics", {
      projectId: scriptProjectId,
      files: ["src/bad.ts"],
    }) as EslintDiagnosticsToolOutput;
    assert.equal(scriptLint.status, "succeeded");
    assert.equal(scriptLint.findings[0]?.ruleId, "eqeqeq");
    assert.ok(scriptLint.command?.startsWith("npm run -s eslint:json"));

    const noEslintRoot = path.join(tmp, "project-no-eslint");
    mkdirSync(noEslintRoot, { recursive: true });
    const noEslintProjectId = randomUUID();
    registerProject(noEslintRoot, noEslintProjectId, "eslint-diagnostics-no-eslint-smoke");
    const unavailable = await invokeTool("eslint_diagnostics", {
      projectId: noEslintProjectId,
      files: ["src/missing.ts"],
    }) as EslintDiagnosticsToolOutput;
    assert.equal(unavailable.status, "unavailable");
    const noEslintStore = openProjectStore({ projectRoot: noEslintRoot });
    try {
      const unavailableRuns = noEslintStore.queryReefDiagnosticRuns({
        projectId: noEslintProjectId,
        source: "eslint",
        status: "unavailable",
        limit: 1,
      });
      assert.equal(unavailableRuns.length, 1);
    } finally {
      noEslintStore.close();
    }

    console.log("eslint-diagnostics: PASS");
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
