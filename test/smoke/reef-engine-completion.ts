import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProjectFinding, ReefWorkspaceChangeSet } from "../../packages/contracts/src/index.ts";
import { REEF_CALCULATION_PLAN_QUERY_KIND } from "../../packages/contracts/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";
import {
  reefAgentStatusTool,
  reefKnownIssuesTool,
  reefWhereUsedTool,
} from "../../packages/tools/src/reef/index.ts";
import {
  createInProcessReefService,
  createReefIndexerCalculationRegistry,
} from "../../services/indexer/src/index.ts";
import { createReefCalculationExecutionPlan } from "../../services/indexer/src/reef-calculation-executor.ts";
import { indexProject } from "../../services/indexer/src/index-project.ts";

function now(): string {
  return new Date().toISOString();
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-engine-completion-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const priorReefMode = process.env.MAKO_REEF_MODE;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_REEF_MODE;

  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-engine-completion" }));
  writeFileSync(
    path.join(projectRoot, "src", "NameCard.tsx"),
    [
      "export function NameCard(props: { name: string }) { return <section>{props.name}</section>; }",
      "export function OtherCard(props: { label: string }) { return <aside>{props.label}</aside>; }",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(projectRoot, "src", "App.tsx"),
    "import { NameCard } from './NameCard';\nexport function App() { return <NameCard name=\"Ada\" />; }\n",
  );
  writeFileSync(
    path.join(projectRoot, "src", "OtherUser.tsx"),
    "import { OtherCard } from './NameCard';\nexport function OtherUser() { return <OtherCard label=\"not name card\" />; }\n",
  );
  writeFileSync(
    path.join(projectRoot, "src", "LooseReference.tsx"),
    "export const looseReference = NameCard;\n",
  );
  writeFileSync(
    path.join(projectRoot, "src", "AlternatePath.tsx"),
    "export function AlternatePath() { return <span>alternate</span>; }\n",
  );

  const service = createInProcessReefService();
  try {
    const indexed = await indexProject(projectRoot, { triggerSource: "reef_engine_completion_smoke" });
    await service.start();
    const registered = await service.registerProject({ root: projectRoot });
    assert.equal(registered.projectId, indexed.project.projectId);

    const changeSet: ReefWorkspaceChangeSet = {
      changeSetId: "reef_change_set_completion_smoke",
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      observedAt: now(),
      causes: [{
        eventId: "reef_event_completion_smoke",
        projectId: indexed.project.projectId,
        root: indexed.project.canonicalPath,
        kind: "reef.file.changed",
        paths: ["src/NameCard.tsx"],
        observedAt: now(),
      }],
      fileChanges: [{ path: "src/NameCard.tsx", kind: "updated" }],
    };

    const directPlan = createReefCalculationExecutionPlan(
      createReefIndexerCalculationRegistry(),
      changeSet,
      { fullRefreshPathThreshold: 500 },
    );
    assert.equal(directPlan.refreshMode, "path_scoped");
    assert.ok(directPlan.affectedNodes.some((node) => node.nodeId === "reef.indexer.ast_symbols"));
    assert.ok(directPlan.inputDependencyKeys.some((key) => key.startsWith("glob:**/*.")));

    const queriedPlan = await service.query<{ changeSet: ReefWorkspaceChangeSet }, { plan: typeof directPlan }>({
      projectId: indexed.project.projectId,
      kind: REEF_CALCULATION_PLAN_QUERY_KIND,
      input: { changeSet },
      freshnessPolicy: "allow_stale_labeled",
      snapshot: "latest",
    });
    assert.equal(queriedPlan.plan.refreshMode, "path_scoped");
    await assert.rejects(
      () => service.query<{ changeSet: ReefWorkspaceChangeSet; changeSetId: string }, { plan: typeof directPlan }>({
        projectId: indexed.project.projectId,
        kind: REEF_CALCULATION_PLAN_QUERY_KIND,
        input: { changeSet, changeSetId: changeSet.changeSetId },
        freshnessPolicy: "allow_stale_labeled",
        snapshot: "latest",
      }),
      /either changeSet or changeSetId/u,
    );
    await assert.rejects(
      () => service.query<{ changeSet: ReefWorkspaceChangeSet }, { plan: typeof directPlan }>({
        projectId: indexed.project.projectId,
        kind: REEF_CALCULATION_PLAN_QUERY_KIND,
        input: { changeSet: { ...changeSet, projectId: "different_project" } },
        freshnessPolicy: "allow_stale_labeled",
        snapshot: "latest",
      }),
      /does not match requested project/u,
    );
    await assert.rejects(
      () => service.query<{ changeSet: ReefWorkspaceChangeSet }, { plan: typeof directPlan }>({
        projectId: indexed.project.projectId,
        kind: REEF_CALCULATION_PLAN_QUERY_KIND,
        input: { changeSet: { ...changeSet, root: path.join(tmp, "other-project") } },
        freshnessPolicy: "allow_stale_labeled",
        snapshot: "latest",
      }),
      /does not match requested root/u,
    );

    const appliedPlanChangeSet = await service.applyChangeSet(changeSet);
    const appliedPlan = await service.query<{ changeSetId: string }, { plan: typeof directPlan }>({
      projectId: indexed.project.projectId,
      kind: REEF_CALCULATION_PLAN_QUERY_KIND,
      input: { changeSetId: appliedPlanChangeSet.changeSetId },
      freshnessPolicy: "allow_stale_labeled",
      snapshot: "latest",
    });
    assert.equal(appliedPlan.plan.refreshMode, "path_scoped");
    await assert.rejects(
      () => service.query<{ changeSetId: string }, { plan: typeof directPlan }>({
        projectId: indexed.project.projectId,
        kind: REEF_CALCULATION_PLAN_QUERY_KIND,
        input: { changeSetId: appliedPlanChangeSet.changeSetId },
        freshnessPolicy: "allow_stale_labeled",
        snapshot: "pinned",
        revision: 0,
      }),
      /at revision 0/u,
    );

    {
      const store = openProjectStore({ projectRoot });
      try {
        const subject = { kind: "diagnostic" as const, path: "src/AlternatePath.tsx", ruleId: "reuse.helper_bypass" };
        const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
        const relatedFinding: ProjectFinding = {
          projectId: indexed.project.projectId,
          fingerprint: store.computeReefFindingFingerprint({
            source: "cross_search",
            ruleId: "reuse.helper_bypass",
            subjectFingerprint,
            message: "AlternatePath duplicates behavior already centralized by NameCard in src/NameCard.tsx.",
          }),
          source: "cross_search",
          subjectFingerprint,
          overlay: "indexed",
          severity: "warning",
          status: "active",
          filePath: "src/AlternatePath.tsx",
          line: 1,
          ruleId: "reuse.helper_bypass",
          evidenceRefs: ["src/AlternatePath.tsx:1", "src/NameCard.tsx:1"],
          freshness: { state: "fresh", checkedAt: now(), reason: "fixture" },
          capturedAt: now(),
          message: "AlternatePath duplicates behavior already centralized by NameCard in src/NameCard.tsx.",
          factFingerprints: [],
        };
        store.replaceReefFindingsForSource({
          projectId: indexed.project.projectId,
          source: "cross_search",
          overlay: "indexed",
          findings: [relatedFinding],
        });
      } finally {
        store.close();
      }
    }

    const whereUsed = await reefWhereUsedTool({
      projectId: indexed.project.projectId,
      query: "NameCard",
      targetKind: "component",
    }, { reefService: service });
    assert.ok(whereUsed.definitions.some((definition) => definition.filePath === "src/NameCard.tsx"));
    assert.ok(whereUsed.usages.some((usage) => usage.filePath === "src/App.tsx"));
    assert.ok(whereUsed.usages.some((usage) =>
      usage.filePath === "src/LooseReference.tsx" &&
      usage.usageKind === "text_reference"
    ));
    assert.ok(!whereUsed.usages.some((usage) => usage.filePath === "src/OtherUser.tsx"));
    assert.ok(whereUsed.relatedFindings.some((finding) => finding.filePath === "src/AlternatePath.tsx"));
    assert.ok(whereUsed.coverage.directUsageSources.includes("indexed_identifier_text"));
    assert.ok(whereUsed.coverage.relatedSignalSources.includes("project_findings"));
    assert.ok(whereUsed.usages.every((usage) => usage.provenance.revision !== undefined));
    assert.ok(whereUsed.warnings.some((warning) => warning.includes("indexed identifier text")));
    assert.equal(whereUsed.reefExecution.queryPath, "reef_materialized_view");

    const fileWhereUsed = await reefWhereUsedTool({
      projectId: indexed.project.projectId,
      query: "NameCard.tsx",
      targetKind: "file",
    }, { reefService: service });
    assert.ok(fileWhereUsed.definitions.some((definition) => definition.source === "file_index"));
    assert.ok(fileWhereUsed.usages.some((usage) => usage.filePath === "src/App.tsx"));

    const renameSourcePath = "src/RenameSource.ts";
    const renameTargetPath = "src/RenameTarget.ts";
    writeFileSync(path.join(projectRoot, renameSourcePath), "export const renamedValue = 1;\n");
    renameSync(path.join(projectRoot, renameSourcePath), path.join(projectRoot, renameTargetPath));
    writeFileSync(path.join(projectRoot, renameTargetPath), "export const renamedValue = 2;\n");
    await service.submitEvent({
      eventId: "reef_event_completion_rename",
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      kind: "reef.file.renamed",
      paths: [renameTargetPath],
      observedAt: now(),
      data: { priorPath: renameSourcePath },
    });
    await service.submitEvent({
      eventId: "reef_event_completion_rename_changed",
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      kind: "reef.file.changed",
      paths: [renameTargetPath],
      observedAt: now(),
      data: { flushImmediately: true },
    });

    const store = openProjectStore({ projectRoot });
    try {
      const renameChangeSet = store.queryReefAppliedChangeSets({
        projectId: indexed.project.projectId,
        root: indexed.project.canonicalPath,
        limit: 1,
      })[0];
      const mergedRenameChange = renameChangeSet?.fileChanges.find((fileChange) => fileChange.path === renameTargetPath);
      assert.equal(mergedRenameChange?.kind, "updated");
      assert.equal(mergedRenameChange?.priorPath, renameSourcePath);

      const subject = { kind: "diagnostic" as const, path: "src/App.tsx", ruleId: "typescript.ts2322" };
      const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
      const finding: ProjectFinding = {
        projectId: indexed.project.projectId,
        fingerprint: store.computeReefFindingFingerprint({
          source: "typescript",
          ruleId: "typescript.ts2322",
          subjectFingerprint,
          message: "Type mismatch in NameCard props",
        }),
        source: "typescript",
        subjectFingerprint,
        overlay: "working_tree",
        severity: "error",
        status: "active",
        filePath: "src/App.tsx",
        line: 2,
        ruleId: "typescript.ts2322",
        freshness: { state: "fresh", checkedAt: now(), reason: "fixture" },
        capturedAt: now(),
        message: "Type mismatch in NameCard props",
        factFingerprints: [],
      };
      store.replaceReefFindingsForSource({
        projectId: indexed.project.projectId,
        source: "typescript",
        overlay: "working_tree",
        findings: [finding],
      });
      const staleSubject = { kind: "diagnostic" as const, path: "src/NameCard.tsx", ruleId: "eslint.no-unused-vars" };
      const staleSubjectFingerprint = store.computeReefSubjectFingerprint(staleSubject);
      const staleFinding: ProjectFinding = {
        projectId: indexed.project.projectId,
        fingerprint: store.computeReefFindingFingerprint({
          source: "eslint",
          ruleId: "eslint.no-unused-vars",
          subjectFingerprint: staleSubjectFingerprint,
          message: "OtherCard is unused",
        }),
        source: "eslint",
        subjectFingerprint: staleSubjectFingerprint,
        overlay: "working_tree",
        severity: "warning",
        status: "active",
        filePath: "src/NameCard.tsx",
        line: 2,
        ruleId: "eslint.no-unused-vars",
        freshness: { state: "stale", checkedAt: now(), reason: "fixture stale run" },
        capturedAt: now(),
        message: "OtherCard is unused",
        factFingerprints: [],
      };
      store.replaceReefFindingsForSource({
        projectId: indexed.project.projectId,
        source: "eslint",
        overlay: "working_tree",
        findings: [staleFinding],
      });
      store.saveReefDiagnosticRun({
        projectId: indexed.project.projectId,
        source: "typescript",
        overlay: "working_tree",
        status: "succeeded",
        startedAt: now(),
        finishedAt: now(),
        durationMs: 12,
        checkedFileCount: 1,
        findingCount: 1,
        persistedFindingCount: 1,
        command: "fixture tsc",
        cwd: projectRoot,
        metadata: { inputRevision: 0, outputRevision: 0, requestedFiles: ["src/App.tsx"] },
      });
    } finally {
      store.close();
    }

    const knownIssues = await reefKnownIssuesTool({
      projectId: indexed.project.projectId,
      severities: ["error"],
    }, { reefService: service });
    assert.equal(knownIssues.summary.errors, 1);
    assert.equal(knownIssues.issues[0]?.source, "typescript");

    const staleKnownIssuesDropped = await reefKnownIssuesTool({
      projectId: indexed.project.projectId,
      sources: ["eslint"],
    }, { reefService: service });
    assert.equal(staleKnownIssuesDropped.summary.total, 0);
    assert.ok(staleKnownIssuesDropped.warnings.some((warning) => warning.includes("Dropped 1 stale known issue")));

    const staleKnownIssuesLabeled = await reefKnownIssuesTool({
      projectId: indexed.project.projectId,
      sources: ["eslint"],
      freshnessPolicy: "allow_stale_labeled",
    }, { reefService: service });
    assert.equal(staleKnownIssuesLabeled.summary.total, 1);
    assert.equal(staleKnownIssuesLabeled.issues[0]?.freshness.state, "stale");

    const agentStatus = await reefAgentStatusTool({
      projectId: indexed.project.projectId,
      focusFiles: ["src/App.tsx"],
    }, { reefService: service });
    assert.equal(agentStatus.summary.knownIssueCount, 1);
    assert.equal(agentStatus.summary.backgroundQueue, "idle");
    assert.ok(agentStatus.staleSources.some((source) => source.status === "unknown"));
    assert.ok(agentStatus.suggestedActions.length > 0);

    console.log("reef-engine-completion: PASS");
  } finally {
    await service.stop().catch(() => undefined);
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
