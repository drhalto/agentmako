import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  FileFindingsToolOutput,
  ListReefRulesToolOutput,
  ProjectFact,
  ProjectFactsToolOutput,
  ProjectDiagnosticRunsToolOutput,
  ProjectFinding,
  ProjectFindingsToolOutput,
  ReefRuleDescriptor,
  ToolBatchToolOutput,
} from "../../packages/contracts/src/index.ts";
import { createToolService } from "../../packages/tools/src/index.ts";
import { openGlobalStore } from "../../packages/store/src/index.ts";
import { readReefOperations } from "../../services/indexer/src/reef-operation-log.ts";
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
  const priorReefMode = process.env.MAKO_REEF_MODE;
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
    const staleFreshness = { state: "stale" as const, checkedAt: now(), reason: "fixture stale evidence" };
    const staleSubject = { kind: "file" as const, path: "src/stale-route.ts" };
    const staleSubjectFingerprint = seeded.store.computeReefSubjectFingerprint(staleSubject);
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
    const staleFindingFingerprint = seeded.store.computeReefFindingFingerprint({
      source: rule.source,
      ruleId: rule.id,
      subjectFingerprint: staleSubjectFingerprint,
      message: "STALE: src/stale-route.ts - stale auth evidence",
    });
    const staleFinding: ProjectFinding = {
      ...finding,
      fingerprint: staleFindingFingerprint,
      subjectFingerprint: staleSubjectFingerprint,
      filePath: staleSubject.path,
      line: 7,
      freshness: staleFreshness,
      message: "STALE: src/stale-route.ts - stale auth evidence",
    };
    const factProvenance = {
      source: rule.source,
      capturedAt: now(),
      dependencies: [{ kind: "file" as const, path: subject.path }],
    };
    const freshFact: ProjectFact = {
      projectId: seeded.projectId,
      kind: "route_auth_signal",
      subject,
      subjectFingerprint,
      overlay: "working_tree",
      source: rule.source,
      confidence: 0.92,
      fingerprint: seeded.store.computeReefFactFingerprint({
        projectId: seeded.projectId,
        kind: "route_auth_signal",
        subjectFingerprint,
        overlay: "working_tree",
        source: rule.source,
        data: { guarded: false },
      }),
      freshness,
      provenance: factProvenance,
      data: { guarded: false },
    };
    const staleFact: ProjectFact = {
      ...freshFact,
      subject: staleSubject,
      subjectFingerprint: staleSubjectFingerprint,
      fingerprint: seeded.store.computeReefFactFingerprint({
        projectId: seeded.projectId,
        kind: "route_auth_signal",
        subjectFingerprint: staleSubjectFingerprint,
        overlay: "working_tree",
        source: rule.source,
        data: { guarded: false, stale: true },
      }),
      freshness: staleFreshness,
      provenance: {
        ...factProvenance,
        dependencies: [{ kind: "file" as const, path: staleSubject.path }],
      },
      data: { guarded: false, stale: true },
    };
    seeded.store.saveReefRuleDescriptors([rule]);
    seeded.store.upsertReefFacts([freshFact, staleFact]);
    seeded.store.replaceReefFindingsForSource({
      projectId: seeded.projectId,
      source: rule.source,
      overlay: "working_tree",
      findings: [finding, staleFinding],
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
    assert.equal(projectFindings.reefExecution.reefMode, "auto");
    assert.equal(projectFindings.reefExecution.serviceMode, "direct");
    assert.equal(projectFindings.reefExecution.queryPath, "reef_materialized_view");
    assert.equal(projectFindings.reefExecution.freshnessPolicy, "require_fresh");
    assert.equal(projectFindings.reefExecution.fallback?.used, true);
    assert.ok(projectFindings.warnings.some((warning) => warning.includes("Dropped 1 stale finding")));

    const ruleIdFilteredFindings = await toolService.callTool("project_findings", {
      projectId: seeded.projectId,
      source: rule.id,
    }) as ProjectFindingsToolOutput;
    assert.equal(ruleIdFilteredFindings.totalReturned, 1);
    assert.equal(ruleIdFilteredFindings.findings[0]?.fingerprint, findingFingerprint);
    assert.equal(ruleIdFilteredFindings.findings[0]?.ruleId, rule.id);

    const staleAllowed = await toolService.callTool("project_findings", {
      projectId: seeded.projectId,
      freshnessPolicy: "allow_stale_labeled",
    }) as ProjectFindingsToolOutput;
    assert.equal(staleAllowed.totalReturned, 2);
    assert.equal(staleAllowed.reefExecution.freshnessPolicy, "allow_stale_labeled");
    assert.ok(staleAllowed.findings.some((item) => item.freshness.state === "stale"));

    const projectFacts = await toolService.callTool("project_facts", {
      projectId: seeded.projectId,
      kind: "route_auth_signal",
    }) as ProjectFactsToolOutput;
    assert.equal(projectFacts.totalReturned, 1);
    assert.equal(projectFacts.facts[0]?.fingerprint, freshFact.fingerprint);
    assert.ok(projectFacts.warnings.some((warning) => warning.includes("Dropped 1 stale fact")));

    const staleFactsAllowed = await toolService.callTool("project_facts", {
      projectId: seeded.projectId,
      kind: "route_auth_signal",
      freshnessPolicy: "allow_stale_labeled",
    }) as ProjectFactsToolOutput;
    assert.equal(staleFactsAllowed.totalReturned, 2);
    assert.ok(staleFactsAllowed.facts.some((item) => item.freshness.state === "stale"));

    const queryPathOperations = await readReefOperations({}, {
      projectId: seeded.projectId,
      kind: "query_path",
      limit: 20,
    });
    assert.ok(queryPathOperations.some((operation) =>
      operation.id === projectFindings.reefExecution.operationId
      && operation.data?.toolName === "project_findings"
      && operation.data?.queryPath === "reef_materialized_view"
      && operation.data?.staleEvidenceDropped === 1
    ));
    const fallbackOperations = await readReefOperations({}, {
      projectId: seeded.projectId,
      kind: "fallback_used",
      limit: 20,
    });
    assert.ok(fallbackOperations.some((operation) =>
      operation.data?.toolName === "project_findings"
      && operation.data?.serviceMode === "direct"
    ));

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

    process.env.MAKO_REEF_MODE = "legacy";
    const legacyFacts = await toolService.callTool("project_facts", {
      projectId: seeded.projectId,
      kind: "route_auth_signal",
    }) as ProjectFactsToolOutput;
    assert.equal(legacyFacts.reefExecution.reefMode, "legacy");
    assert.equal(legacyFacts.reefExecution.serviceMode, "legacy");
    assert.equal(legacyFacts.reefExecution.queryPath, "legacy");
    assert.equal(legacyFacts.reefExecution.fallback?.used, true);

    process.env.MAKO_REEF_MODE = "required";
    await assert.rejects(
      () => toolService.callTool("project_facts", {
        projectId: seeded.projectId,
        kind: "route_auth_signal",
      }),
      /requires a Reef daemon-backed service/,
    );

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
    if (priorReefMode === undefined) {
      delete process.env.MAKO_REEF_MODE;
    } else {
      process.env.MAKO_REEF_MODE = priorReefMode;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
