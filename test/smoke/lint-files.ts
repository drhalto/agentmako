/**
 * `lint_files` smoke — read-only diagnostics over an indexed file set.
 *
 * Seeds a minimal project with a custom rule-pack plus a file that trips
 * the rule, then exercises the tool surface:
 *
 * - finds rule-pack issues on the resolved file set
 * - reports unresolved files separately (not silently dropped)
 * - truncates cleanly when `maxFindings` is below the finding count
 * - surfaces the "no findings — clean" warning when the file set is green
 *
 * Shares the diagnostics engine with `collectAnswerDiagnostics` and
 * `review_bundle`, so this is the public-tool slice; the engine itself is
 * already exercised by `rule-packs.ts` and `alignment-diagnostics.ts`.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { LintFilesToolOutput, ProjectFindingsToolOutput } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "lint-files-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "lib"), { recursive: true });
  mkdirSync(path.join(projectRoot, ".mako", "rules"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "lint-files-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  const trippingFile = [
    "export function loadUser(userId: string) {",
    "  sensitiveQuery(userId);",
    "  sensitiveQuery(userId);",
    "}",
  ].join("\n");

  const cleanFile = [
    "export function addOne(n: number): number {",
    "  return n + 1;",
    "}",
  ].join("\n");

  writeFileSync(path.join(projectRoot, "lib", "user.ts"), `${trippingFile}\n`);
  writeFileSync(path.join(projectRoot, "lib", "math.ts"), `${cleanFile}\n`);

  const rulePack = [
    "name: smoke-rules",
    "rules:",
    "  - id: smoke.sensitive_query_tenant_scope",
    "    category: identity_key_mismatch",
    "    severity: high",
    "    confidence: confirmed",
    "    languages: [ts, tsx]",
    "    message: 'Sensitive query receives `{{capture.ARG}}` — confirm it is tenant-scoped'",
    "    pattern: sensitiveQuery($ARG)",
  ].join("\n");
  writeFileSync(path.join(projectRoot, ".mako", "rules", "tenant.yaml"), `${rulePack}\n`);

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "lint-files-smoke",
      rootPath: projectRoot,
      framework: "unknown",
      orm: "unknown",
      srcRoot: ".",
      entryPoints: [],
      pathAliases: {},
      middlewareFiles: [],
      serverOnlyModules: [],
      authGuardSymbols: [],
      supportLevel: "best_effort",
      detectedAt: new Date().toISOString(),
    });

    const fileRecord = (relPath: string, content: string) => ({
      path: relPath,
      sha256: relPath,
      language: "typescript" as const,
      sizeBytes: content.length,
      lineCount: content.split("\n").length,
      chunks: [
        {
          chunkKind: "file" as const,
          name: relPath,
          lineStart: 1,
          lineEnd: content.split("\n").length,
          content,
        },
      ],
      symbols: [],
      imports: [],
      routes: [],
    });

    store.replaceIndexSnapshot({
      files: [fileRecord("lib/user.ts", trippingFile), fileRecord("lib/math.ts", cleanFile)],
      schemaObjects: [],
      schemaUsages: [],
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-lint-files-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  try {
    // --- 1. Findings on the file that trips the rule ---
    const userLint = (await invokeTool("lint_files", {
      projectId,
      files: ["lib/user.ts"],
    })) as LintFilesToolOutput;
    assert.equal(userLint.toolName, "lint_files");
    assert.equal(userLint.projectId, projectId);
    assert.deepEqual(userLint.resolvedFiles, ["lib/user.ts"]);
    assert.deepEqual(userLint.unresolvedFiles, []);
    assert.ok(
      userLint.findings.length >= 1,
      "expected at least one rule-pack finding on the tripping file",
    );
    assert.ok(
      userLint.findings.some((f) => f.code === "smoke.sensitive_query_tenant_scope"),
      "custom rule code should appear in findings",
    );
    assert.equal(userLint.truncated, false);
    const projectStore = openProjectStore({ projectRoot });
    try {
      const reefFindings = projectStore.queryReefFindings({
        projectId,
        overlay: "indexed",
        source: "lint_files",
      });
      assert.ok(
        reefFindings.length >= userLint.findings.length,
        "lint_files should persist unfiltered diagnostics into Reef",
      );
      assert.ok(
        reefFindings.some((finding) =>
          finding.fingerprint === userLint.findings[0]?.identity.matchBasedId
        ),
        "Reef lint finding fingerprint should match AnswerSurfaceIssue identity for ack compatibility",
      );
      assert.ok(
        projectStore.listReefRuleDescriptors().some((rule) =>
          rule.sourceNamespace === "lint_files" &&
          rule.id === "smoke.sensitive_query_tenant_scope"
        ),
        "lint_files should register Reef rule descriptors for produced diagnostics",
      );
      const lintRuns = projectStore.queryReefDiagnosticRuns({
        projectId,
        source: "lint_files",
        status: "succeeded",
        limit: 1,
      });
      assert.equal(lintRuns.length, 1);
      assert.equal(lintRuns[0]?.overlay, "indexed");
      assert.equal(lintRuns[0]?.checkedFileCount, 1);
      assert.ok(lintRuns[0]?.findingCount ?? 0 >= userLint.findings.length);
    } finally {
      projectStore.close();
    }

    const rulePackFilteredFindings = (await invokeTool("project_findings", {
      projectId,
      source: "rule_pack:smoke.sensitive_query_tenant_scope",
      status: "active",
      freshnessPolicy: "allow_stale_labeled",
    })) as ProjectFindingsToolOutput;
    assert.ok(
      rulePackFilteredFindings.findings.some((finding) =>
        finding.source === "lint_files" &&
        finding.ruleId === "smoke.sensitive_query_tenant_scope"
      ),
      "project_findings source=rule_pack:<id> should match lint_files findings by ruleId",
    );

    // --- 2. Clean file produces zero findings + "clean" warning ---
    const mathLint = (await invokeTool("lint_files", {
      projectId,
      files: ["lib/math.ts"],
    })) as LintFilesToolOutput;
    assert.equal(mathLint.findings.length, 0);
    assert.ok(
      mathLint.warnings.some((w) => w.includes("no findings")),
      "clean file set should surface the clean-pass warning",
    );
    const afterCleanStore = openProjectStore({ projectRoot });
    try {
      const cleanRuns = afterCleanStore.queryReefDiagnosticRuns({
        projectId,
        source: "lint_files",
        status: "succeeded",
        limit: 1,
      });
      assert.equal(cleanRuns[0]?.findingCount, 0);
      assert.equal(cleanRuns[0]?.persistedFindingCount, 0);
    } finally {
      afterCleanStore.close();
    }

    // --- 3. Rule-pack edits are picked up without restarting the process ---
    const hotReloadedRulePack = [
      "name: smoke-rules",
      "rules:",
      "  - id: smoke.return_value_review",
      "    category: identity_key_mismatch",
      "    severity: medium",
      "    confidence: probable",
      "    languages: [ts, tsx]",
      "    message: 'Review return value `{{capture.VALUE}}`'",
      "    pattern: return $VALUE",
    ].join("\n");
    writeFileSync(path.join(projectRoot, ".mako", "rules", "tenant.yaml"), `${hotReloadedRulePack}\n`);
    const hotReloadLint = (await invokeTool("lint_files", {
      projectId,
      files: ["lib/math.ts"],
    })) as LintFilesToolOutput;
    assert.ok(
      hotReloadLint.findings.some((f) => f.code === "smoke.return_value_review"),
      "editing a rule pack should invalidate the diagnostics rule cache without an MCP restart",
    );

    const originalRulePack = [
      "name: smoke-rules",
      "rules:",
      "  - id: smoke.sensitive_query_tenant_scope",
      "    category: identity_key_mismatch",
      "    severity: high",
      "    confidence: confirmed",
      "    languages: [ts, tsx]",
      "    message: 'Sensitive query receives `{{capture.ARG}}` — confirm it is tenant-scoped'",
      "    pattern: sensitiveQuery($ARG)",
    ].join("\n");
    writeFileSync(path.join(projectRoot, ".mako", "rules", "tenant.yaml"), `${originalRulePack}\n`);

    // --- 4. Unresolved files land in unresolvedFiles + warning ---
    const mixedLint = (await invokeTool("lint_files", {
      projectId,
      files: ["lib/user.ts", "lib/ghost.ts"],
    })) as LintFilesToolOutput;
    assert.deepEqual(mixedLint.resolvedFiles, ["lib/user.ts"]);
    assert.deepEqual(mixedLint.unresolvedFiles, ["lib/ghost.ts"]);
    assert.ok(
      mixedLint.warnings.some((w) => w.includes("not in the indexed snapshot")),
      "unresolved files should surface a warning",
    );
    // Resolved file still produces findings; unresolved one is silently dropped.
    assert.ok(mixedLint.findings.length >= 1);

    // --- 5. Truncation when maxFindings < total ---
    const truncated = (await invokeTool("lint_files", {
      projectId,
      files: ["lib/user.ts"],
      maxFindings: 1,
    })) as LintFilesToolOutput;
    assert.equal(truncated.findings.length, 1);
    assert.equal(truncated.truncated, true);
    assert.ok(truncated.warnings.some((w) => w.includes("findings capped at 1")));

    console.log("lint-files: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
