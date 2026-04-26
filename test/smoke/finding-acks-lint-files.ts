/**
 * `lint_files` → `finding_ack` → `lint_files` end-to-end loop.
 *
 * Seeds a project with a rule-pack + file that trips it twice, acks one
 * finding via `finding.identity.matchBasedId`, re-runs with the rule code
 * as category, and asserts the filter + count. Uses `finding.code` as the
 * recommended default category + sourceRuleId.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  FindingAckToolOutput,
  LintFilesToolOutput,
} from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

const RULE_CODE = "smoke.sensitive_query_tenant_scope";

function seedProject(projectRoot: string, projectId: string): void {
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "lint-ack-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "lib"), { recursive: true });
  mkdirSync(path.join(projectRoot, ".mako", "rules"), { recursive: true });

  const globalStore = openGlobalStore();
  try {
    globalStore.saveProject({
      projectId,
      displayName: "lint-ack-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });
  } finally {
    globalStore.close();
  }

  // Two calls → two findings from the rule-pack.
  const trippingFile = [
    "export function loadUser(userId: string) {",
    "  sensitiveQuery(userId);",
    "  sensitiveQuery(userId);",
    "}",
  ].join("\n");

  writeFileSync(path.join(projectRoot, "lib", "user.ts"), `${trippingFile}\n`);

  const rulePack = [
    "name: ack-smoke-rules",
    "rules:",
    `  - id: ${RULE_CODE}`,
    "    category: identity_key_mismatch",
    "    severity: high",
    "    confidence: confirmed",
    "    languages: [ts, tsx]",
    "    message: 'Sensitive query receives `{{capture.ARG}}` — confirm tenant scope'",
    "    pattern: sensitiveQuery($ARG)",
  ].join("\n");
  writeFileSync(path.join(projectRoot, ".mako", "rules", "tenant.yaml"), `${rulePack}\n`);

  const store = openProjectStore({ projectRoot });
  try {
    store.saveProjectProfile({
      name: "lint-ack-smoke",
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

    store.replaceIndexSnapshot({
      files: [
        {
          path: "lib/user.ts",
          sha256: "lib/user.ts",
          language: "typescript",
          sizeBytes: trippingFile.length,
          lineCount: trippingFile.split("\n").length,
          chunks: [
            {
              chunkKind: "file" as const,
              name: "lib/user.ts",
              lineStart: 1,
              lineEnd: trippingFile.split("\n").length,
              content: trippingFile,
            },
          ],
          symbols: [],
          imports: [],
          routes: [],
        },
      ],
      schemaObjects: [],
      schemaUsages: [],
    });
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-lint-ack-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectId = randomUUID();
  seedProject(projectRoot, projectId);

  // --- 1. First run: both findings present, acknowledgedCount is 0 ---

  const before = (await invokeTool("lint_files", {
    projectId,
    files: ["lib/user.ts"],
  })) as LintFilesToolOutput;
  const ruleHits = before.findings.filter((f) => f.code === RULE_CODE);
  assert.ok(
    ruleHits.length >= 2,
    `expected at least 2 rule-pack hits for ${RULE_CODE}; got ${ruleHits.length}`,
  );
  assert.equal(
    before.acknowledgedCount,
    0,
    "acknowledgedCount is 0 when no category is opted into",
  );

  // Findings share `code` but have distinct `matchBasedId`s because the
  // identity hash includes match location.
  const target = ruleHits[0]!;
  const other = ruleHits.find(
    (f) => f.identity.matchBasedId !== target.identity.matchBasedId,
  );
  assert.ok(other, "two distinct matchBasedIds should exist in the seed set");

  // --- 2. Ack one finding using finding.code as category + sourceRuleId ---

  const ackResult = (await invokeTool("finding_ack", {
    projectId,
    category: target.code,
    subjectKind: "diagnostic_issue",
    ...(target.path ? { filePath: target.path } : {}),
    fingerprint: target.identity.matchBasedId,
    reason: "reviewed: userId is route-level tenant param, safe",
    sourceToolName: "lint_files",
    sourceRuleId: target.code,
    sourceIdentityMatchBasedId: target.identity.matchBasedId,
  })) as FindingAckToolOutput;
  assert.equal(ackResult.ack.category, RULE_CODE);
  assert.equal(ackResult.ack.fingerprint, target.identity.matchBasedId);
  const reefStore = openProjectStore({ projectRoot });
  try {
    const acknowledgedReefRows = reefStore.queryReefFindings({
      projectId,
      status: "acknowledged",
    });
    assert.ok(
      acknowledgedReefRows.some(
        (finding) => finding.fingerprint === target.identity.matchBasedId,
      ),
      "project_findings should derive acknowledged status from finding_ack fingerprints",
    );
  } finally {
    reefStore.close();
  }

  // --- 3. Re-run with excludeAcknowledgedCategory: acked finding filtered ---

  const after = (await invokeTool("lint_files", {
    projectId,
    files: ["lib/user.ts"],
    excludeAcknowledgedCategory: RULE_CODE,
  })) as LintFilesToolOutput;
  const afterRuleHits = after.findings.filter((f) => f.code === RULE_CODE);
  assert.equal(
    afterRuleHits.length,
    ruleHits.length - 1,
    "acked finding is filtered out",
  );
  assert.equal(after.acknowledgedCount, 1, "acknowledgedCount reports the filter");
  assert.ok(
    afterRuleHits.every(
      (f) => f.identity.matchBasedId !== target.identity.matchBasedId,
    ),
    "filtered fingerprint does not appear in the result set",
  );

  // --- 4. Different category: no filter effect ---

  const unrelatedCat = (await invokeTool("lint_files", {
    projectId,
    files: ["lib/user.ts"],
    excludeAcknowledgedCategory: "never-acked",
  })) as LintFilesToolOutput;
  const unrelatedHits = unrelatedCat.findings.filter((f) => f.code === RULE_CODE);
  assert.equal(
    unrelatedHits.length,
    ruleHits.length,
    "ack under rule code does not bleed into an unrelated category",
  );
  assert.equal(unrelatedCat.acknowledgedCount, 0);

  console.log("finding-acks-lint-files: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
