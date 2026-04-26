import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { BiomeDiagnosticsToolOutput } from "../../packages/contracts/src/index.ts";
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
      name: "biome-diagnostics-smoke",
      version: "0.0.0",
      scripts: {
        "biome:gitlab": "node biome-gitlab.cjs",
      },
    }),
  );
  writeFileSync(path.join(projectRoot, "src", "bad.ts"), "if (a == b) {}\n");
  writeFileSync(path.join(projectRoot, "src", "good.ts"), "export const good = true;\n");
  writeFileSync(
    path.join(projectRoot, "biome-gitlab.cjs"),
    [
      "const path = require('node:path');",
      "const files = [];",
      "for (let i = 2; i < process.argv.length; i++) {",
      "  const arg = process.argv[i];",
      "  if (arg.startsWith('--reporter')) continue;",
      "  if (arg === 'check') continue;",
      "  if (!arg.startsWith('-')) files.push(arg);",
      "}",
      "const findings = [];",
      "for (const file of files) {",
      "  if (!file.includes('bad.ts')) continue;",
      "  findings.push({",
      "    description: 'Use === instead of ==. == is only allowed when comparing against `null`',",
      "    check_name: 'lint/suspicious/noDoubleEquals',",
      "    fingerprint: '15587197597897976171',",
      "    severity: 'major',",
      "    location: { path: path.relative(process.cwd(), path.resolve(process.cwd(), file)), lines: { begin: 1, end: 1 } },",
      "  });",
      "}",
      "process.stdout.write(JSON.stringify(findings));",
      "process.exit(findings.length > 0 ? 1 : 0);",
    ].join("\n"),
  );
  registerProject(projectRoot, projectId, "biome-diagnostics-smoke");
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-biome-diagnostics-"));
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
    const bad = await invokeTool("biome_diagnostics", {
      projectId,
      files: ["src/bad.ts"],
    }) as BiomeDiagnosticsToolOutput;
    assert.equal(bad.toolName, "biome_diagnostics");
    assert.equal(bad.status, "succeeded");
    assert.equal(bad.requestedFiles[0], "src/bad.ts");
    assert.equal(bad.totalFindings, 1);
    assert.equal(bad.findings[0]?.ruleId, "lint/suspicious/noDoubleEquals");
    assert.equal(bad.findings[0]?.source, "biome");
    assert.equal(bad.findings[0]?.overlay, "working_tree");
    assert.ok(
      bad.warnings.some((warning) => warning.includes("GitLab reporter")),
      "biome_diagnostics should disclose reporter choice",
    );

    const store = openProjectStore({ projectRoot });
    try {
      const active = store.queryReefFindings({
        projectId,
        source: "biome",
        overlay: "working_tree",
        filePath: "src/bad.ts",
      });
      assert.equal(active.length, 1);
      assert.equal(active[0]?.ruleId, "lint/suspicious/noDoubleEquals");
      assert.ok(
        store.listReefRuleDescriptors().some((rule) =>
          rule.sourceNamespace === "biome" &&
          rule.id === "lint/suspicious/noDoubleEquals"
        ),
        "biome_diagnostics should register rule descriptors",
      );
      const runs = store.queryReefDiagnosticRuns({
        projectId,
        source: "biome",
        status: "succeeded",
        limit: 1,
      });
      assert.equal(runs.length, 1);
      assert.equal(runs[0]?.findingCount, 1);
      assert.equal(runs[0]?.checkedFileCount, 1);
    } finally {
      store.close();
    }

    const good = await invokeTool("biome_diagnostics", {
      projectId,
      files: ["src/good.ts"],
    }) as BiomeDiagnosticsToolOutput;
    assert.equal(good.status, "succeeded");
    assert.equal(good.totalFindings, 0);

    const noBiomeRoot = path.join(tmp, "project-no-biome");
    mkdirSync(noBiomeRoot, { recursive: true });
    const noBiomeProjectId = randomUUID();
    registerProject(noBiomeRoot, noBiomeProjectId, "biome-diagnostics-no-biome-smoke");
    const unavailable = await invokeTool("biome_diagnostics", {
      projectId: noBiomeProjectId,
      files: ["src/missing.ts"],
    }) as BiomeDiagnosticsToolOutput;
    assert.equal(unavailable.status, "unavailable");
    const noBiomeStore = openProjectStore({ projectRoot: noBiomeRoot });
    try {
      const unavailableRuns = noBiomeStore.queryReefDiagnosticRuns({
        projectId: noBiomeProjectId,
        source: "biome",
        status: "unavailable",
        limit: 1,
      });
      assert.equal(unavailableRuns.length, 1);
    } finally {
      noBiomeStore.close();
    }

    console.log("biome-diagnostics: PASS");
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
