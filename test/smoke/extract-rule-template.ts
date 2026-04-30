import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtractRuleTemplateToolOutput } from "../../packages/contracts/src/index.ts";
import { openGlobalStore } from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { loadRulePackFromFile } from "../../packages/tools/src/rule-packs/index.ts";

function git(projectRoot: string, args: string[]): string {
  return execFileSync("git", ["-C", projectRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "extract-rule-template-smoke", version: "0.0.0" }),
    "utf8",
  );
  mkdirSync(path.join(projectRoot, "components"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "extract-rule-template-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-extract-rule-template-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  mkdirSync(stateHome, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    git(projectRoot, ["init"]);
    git(projectRoot, ["config", "user.email", "mako@example.test"]);
    git(projectRoot, ["config", "user.name", "Mako Test"]);

    writeFileSync(
      path.join(projectRoot, "components", "nav-main.tsx"),
      [
        "import dynamic from 'next/dynamic';",
        "",
        "const CheckInPopover = dynamic(() => import('./CheckInPopover'), { ssr: false });",
        "",
        "export function NavMain() {",
        "  return <CheckInPopover />;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    git(projectRoot, ["add", "."]);
    git(projectRoot, ["commit", "-m", "bad hydration boundary"]);
    const baseCommit = git(projectRoot, ["rev-parse", "HEAD"]);

    writeFileSync(
      path.join(projectRoot, "components", "nav-main.tsx"),
      [
        "import dynamic from 'next/dynamic';",
        "",
        "const CheckInPopover = dynamic(() => import('./CheckInPopover'));",
        "",
        "export function NavMain() {",
        "  return <CheckInPopover />;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    git(projectRoot, ["add", "."]);
    git(projectRoot, ["commit", "-m", "fix hydration boundary"]);
    const fixCommit = git(projectRoot, ["rev-parse", "HEAD"]);

    const output = (await invokeTool("extract_rule_template", {
      projectId,
      baseCommit,
      fixCommit,
      filePath: "components/nav-main.tsx",
      ruleIdPrefix: "courseconnect",
      maxTemplates: 3,
    })) as ExtractRuleTemplateToolOutput;

    assert.equal(output.toolName, "extract_rule_template");
    assert.equal(output.summary.changedFileCount, 1);
    assert.equal(output.summary.templateCount, 1);
    assert.equal(output.templates[0]!.sourceFile, "components/nav-main.tsx");
    assert.deepEqual(output.templates[0]!.patterns, ["dynamic($IMPORT, { ssr: false })"]);
    assert.equal(output.templates[0]!.category, "producer_consumer_drift");
    assert.equal(output.templates[0]!.severity, "high");
    assert.match(output.draftYaml, /courseconnect\.hydration\.dynamic_ssr_false/);
    assert.match(output.draftYaml, /dynamic\(\$IMPORT, \{ ssr: false \}\)/);
    assert.equal(output.suggestedPath.startsWith(".mako/rules/courseconnect-"), true);

    mkdirSync(path.join(projectRoot, ".mako", "rules"), { recursive: true });
    const draftPath = path.join(projectRoot, ".mako", "rules", "mined.yaml");
    writeFileSync(draftPath, output.draftYaml, "utf8");
    const loadedDraft = loadRulePackFromFile(draftPath);
    assert.equal(loadedDraft.pack.rules[0]!.id, "courseconnect.hydration.dynamic_ssr_false");

    console.log("extract-rule-template: PASS");
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
