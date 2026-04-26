import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  FileFindingsToolOutput,
  ListReefRulesToolOutput,
  ProjectDiagnosticRunsToolOutput,
  ProjectFinding,
  ProjectFindingsToolOutput,
  ReefRuleDescriptor,
  ToolBatchToolOutput,
} from "../../packages/contracts/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";
import { openGlobalStore } from "../../packages/store/src/index.ts";
import { seedReefProject } from "../fixtures/reef/index.ts";

function now(): string {
  return new Date().toISOString();
}

function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-tools-"));
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const projectRoot = path.join(tmp, "project");
  const stateHome = path.join(tmp, "state");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(stateHome, { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;

  const seeded = await seedReefProject({ projectRoot });
  const globalStore = openGlobalStore();
  const toolService = createToolService();
  try {
    globalStore.saveProject({
      projectId: seeded.projectId,
      displayName: "reef-tools-smoke",
      canonicalPath: projectRoot,
      lastSeenPath: projectRoot,
      supportTarget: "best_effort",
    });

    const subject = { kind: "file" as const, path: "src/secure-route.ts" };
    const subjectFingerprint = seeded.store.computeReefSubjectFingerprint(subject);
    const freshness = { state: "fresh" as const, checkedAt: now(), reason: "fixture" };
    const rule: ReefRuleDescriptor = {
      id: "auth.unprotected_route",
      version: "1.0.0",
      source: "reef_rule:auth.unprotected_route",
      sourceNamespace: "reef_rule",
      type: "problem",
      severity: "error",
      title: "Unprotected route",
      description: "Route has no detected auth guard.",
      factKinds: ["route_auth_signal"],
      dependsOnFactKinds: ["route_auth_signal"],
      enabledByDefault: true,
    };
    const findingFingerprint = seeded.store.computeReefFindingFingerprint({
      source: rule.source,
      ruleId: rule.id,
      subjectFingerprint,
      message: "UNPROTECTED: src/secure-route.ts - no auth guard detected",
    });
    const finding: ProjectFinding = {
      projectId: seeded.projectId,
      fingerprint: findingFingerprint,
      source: rule.source,
      subjectFingerprint,
      overlay: "working_tree",
      severity: "error",
      status: "active",
      filePath: subject.path,
      line: 12,
      ruleId: rule.id,
      freshness,
      capturedAt: now(),
      message: "UNPROTECTED: src/secure-route.ts - no auth guard detected",
      factFingerprints: [],
    };
    seeded.store.saveReefRuleDescriptors([rule]);
    seeded.store.replaceReefFindingsForSource({
      projectId: seeded.projectId,
      source: rule.source,
      overlay: "working_tree",
      findings: [finding],
    });
    seeded.store.saveReefDiagnosticRun({
      projectId: seeded.projectId,
      source: "eslint",
      overlay: "working_tree",
      status: "succeeded",
      startedAt: now(),
      finishedAt: now(),
      durationMs: 12,
      checkedFileCount: 1,
      findingCount: 1,
      persistedFindingCount: 1,
      command: "fixture eslint",
      cwd: projectRoot,
    });
    seeded.store.saveReefDiagnosticRun({
      projectId: seeded.projectId,
      source: "eslint",
      overlay: "working_tree",
      status: "succeeded",
      startedAt: secondsAgo(70),
      finishedAt: secondsAgo(60),
      durationMs: 10,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "fixture eslint old",
      cwd: projectRoot,
    });

    const projectFindings = await toolService.callTool("project_findings", {
      projectId: seeded.projectId,
    }) as ProjectFindingsToolOutput;
    assert.equal(projectFindings.toolName, "project_findings");
    assert.equal(projectFindings.projectId, seeded.projectId);
    assert.equal(projectFindings.totalReturned, 1);
    assert.equal(projectFindings.findings[0]?.fingerprint, findingFingerprint);
    assert.equal(projectFindings.findings[0]?.status, "active");

    seeded.store.insertFindingAck({
      projectId: seeded.projectId,
      category: "reef:auth",
      subjectKind: "diagnostic_issue",
      filePath: subject.path,
      fingerprint: findingFingerprint,
      status: "accepted",
      reason: "fixture acknowledgement",
      sourceToolName: "project_findings",
      sourceRuleId: rule.id,
    });

    const acknowledged = await toolService.callTool("project_findings", {
      projectId: seeded.projectId,
      status: "acknowledged",
    }) as ProjectFindingsToolOutput;
    assert.equal(acknowledged.totalReturned, 1);
    assert.equal(acknowledged.findings[0]?.status, "acknowledged");

    const activeAfterAck = await toolService.callTool("project_findings", {
      projectId: seeded.projectId,
      status: "active",
    }) as ProjectFindingsToolOutput;
    assert.equal(activeAfterAck.totalReturned, 0);

    const fileFindings = await toolService.callTool("file_findings", {
      projectId: seeded.projectId,
      filePath: path.join(projectRoot, subject.path),
      status: "acknowledged",
    }) as FileFindingsToolOutput;
    assert.equal(fileFindings.toolName, "file_findings");
    assert.equal(fileFindings.filePath, subject.path);
    assert.equal(fileFindings.totalReturned, 1);

    const rules = await toolService.callTool("list_reef_rules", {
      projectId: seeded.projectId,
      sourceNamespace: "reef_rule",
      enabledOnly: true,
    }) as ListReefRulesToolOutput;
    assert.equal(rules.toolName, "list_reef_rules");
    assert.equal(rules.totalReturned, 1);
    assert.equal(rules.rules[0]?.id, rule.id);

    const runs = await toolService.callTool("project_diagnostic_runs", {
      projectId: seeded.projectId,
      source: "eslint",
      status: "succeeded",
      cacheStalenessMs: 30_000,
    }) as ProjectDiagnosticRunsToolOutput;
    assert.equal(runs.toolName, "project_diagnostic_runs");
    assert.equal(runs.totalReturned, 2);
    assert.equal(runs.filters.cacheStalenessMs, 30_000);
    assert.equal(runs.runs[0]?.source, "eslint");
    assert.ok(runs.runs.some((run) => run.findingCount === 1 && run.cache?.state === "fresh"));
    assert.ok(runs.runs.some((run) => run.findingCount === 0 && run.cache?.state === "stale"));

    const batch = await toolService.callTool("tool_batch", {
      projectId: seeded.projectId,
      ops: [
        { label: "findings", tool: "project_findings", args: { status: "acknowledged" } },
        { label: "rules", tool: "list_reef_rules", args: { enabledOnly: true } },
        { label: "runs", tool: "project_diagnostic_runs", args: { source: "eslint" } },
      ],
    }) as ToolBatchToolOutput;
    assert.equal(batch.summary.executedOps, 3);
    assert.equal(batch.summary.succeededOps, 3);
    assert.equal(batch.results[0]?.tool, "project_findings");
    assert.equal(batch.results[1]?.tool, "list_reef_rules");
    assert.equal(batch.results[2]?.tool, "project_diagnostic_runs");

    console.log("reef-tools: PASS");
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
