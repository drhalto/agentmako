import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  ProjectFact,
  ReefWorkspaceChangeSet,
} from "../../packages/contracts/src/index.ts";
import { hashText, openProjectStore } from "../../packages/store/src/index.ts";
import { InProcessReefService } from "../../services/indexer/src/reef-service.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-diagnostics-freshness-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const priorStateHome = process.env.MAKO_STATE_HOME;
  const priorStateDirName = process.env.MAKO_STATE_DIRNAME;

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-diagnostics-freshness-smoke" }));
  writeFileSync(path.join(projectRoot, "src", "edited-during.ts"), "export const value = 1;\n");
  writeFileSync(path.join(projectRoot, "src", "untouched.ts"), "export const value = 2;\n");

  try {
    const reefService = new InProcessReefService();
    await reefService.start();
    const registered = await reefService.registerProject({ root: projectRoot });

    try {
      await runConcurrentEditCase({
        projectId: registered.projectId,
        projectRoot,
        reefService,
      });
      await runRevisionDriftCase({
        projectId: registered.projectId,
        projectRoot,
        canonicalRoot: registered.canonicalRoot,
        reefService,
      });
      console.log("reef-diagnostics-freshness: PASS");
    } finally {
      await reefService.stop();
    }
  } finally {
    if (priorStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = priorStateHome;
    }
    if (priorStateDirName === undefined) {
      delete process.env.MAKO_STATE_DIRNAME;
    } else {
      process.env.MAKO_STATE_DIRNAME = priorStateDirName;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Verifies that a file edited DURING a diagnostic run (mtime between
// startedAt and finishedAt) is flagged in changedAfterCheck. Before the
// fix, the cutoff was finishedAt and this file would be invisibly missed.
async function runConcurrentEditCase(args: {
  projectId: string;
  projectRoot: string;
  reefService: InProcessReefService;
}): Promise<void> {
  const startedAtMs = Date.now() - 60_000;
  const startedAt = new Date(startedAtMs).toISOString();
  const editedDuringAt = new Date(startedAtMs + 5_000).toISOString();
  const finishedAtMs = startedAtMs + 30_000;
  const finishedAt = new Date(finishedAtMs).toISOString();
  const editedAfterAt = new Date(finishedAtMs + 5_000).toISOString();

  const store = openProjectStore({ projectRoot: args.projectRoot });
  try {
    store.saveReefDiagnosticRun({
      projectId: args.projectId,
      source: "programmatic_findings",
      overlay: "working_tree",
      status: "succeeded",
      startedAt,
      finishedAt,
      durationMs: finishedAtMs - startedAtMs,
      checkedFileCount: 2,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "synthetic concurrent-edit fixture",
      cwd: args.projectRoot,
      metadata: {
        sourceKind: "programmatic",
        // Cover both files so reefDiagnosticRunCoversFile considers them.
        requestedFiles: ["src/edited-during.ts", "src/edited-after.ts", "src/untouched.ts"],
        requestedFileCount: 3,
        truncated: false,
      },
    });

    const upsertOverlayFact = (filePath: string, lastModifiedAt: string, sha256?: string): void => {
      const subject = { kind: "file" as const, path: filePath };
      const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
      const data = { lastModifiedAt, ...(sha256 ? { sha256 } : {}) };
      const fact: ProjectFact = {
        projectId: args.projectId,
        kind: "file_snapshot",
        subject,
        subjectFingerprint,
        overlay: "working_tree",
        source: "working_tree_overlay",
        confidence: 1,
        fingerprint: store.computeReefFactFingerprint({
          projectId: args.projectId,
          kind: "file_snapshot",
          subjectFingerprint,
          overlay: "working_tree",
          source: "working_tree_overlay",
          data,
        }),
        freshness: {
          state: "fresh",
          checkedAt: lastModifiedAt,
          reason: "diagnostics-freshness-smoke fixture",
        },
        provenance: {
          source: "diagnostics-freshness-smoke",
          capturedAt: lastModifiedAt,
        },
        data,
      };
      store.upsertReefFacts([fact]);
    };

    upsertOverlayFact("src/edited-during.ts", editedDuringAt);
    upsertOverlayFact("src/edited-after.ts", editedAfterAt);

    // Touched after the run but byte-identical to the indexed content: the
    // sha256 gate must keep it out of changedAfterCheck.
    const untouchedContent = "export const value = 2;\n";
    const untouchedSha = hashText(untouchedContent);
    store.replaceFileIndexRows({
      deletedPaths: [],
      files: [
        {
          path: "src/untouched.ts",
          sha256: untouchedSha,
          language: "typescript",
          sizeBytes: Buffer.byteLength(untouchedContent, "utf8"),
          lineCount: untouchedContent.split("\n").length,
          chunks: [],
          symbols: [],
          imports: [],
          routes: [],
        },
      ],
    });
    upsertOverlayFact("src/untouched.ts", editedAfterAt, untouchedSha);
  } finally {
    store.close();
  }

  const status = await args.reefService.getProjectStatus(args.projectId);
  const changed = status.diagnostics?.changedAfterCheck ?? [];
  assert.ok(
    changed.some((entry) =>
      entry.filePath === "src/edited-during.ts"
      && entry.staleSources.includes("programmatic_findings")
    ),
    "file edited DURING a diagnostic run must appear in changedAfterCheck (cutoff should be startedAt, not finishedAt)",
  );
  assert.ok(
    changed.some((entry) =>
      entry.filePath === "src/edited-after.ts"
      && entry.staleSources.includes("programmatic_findings")
    ),
    "file edited after the run should still appear in changedAfterCheck",
  );
  assert.ok(
    !changed.some((entry) => entry.filePath === "src/untouched.ts"),
    "an mtime-only touch whose content still matches the indexed sha256 must not appear in changedAfterCheck",
  );
}

// Verifies that once a change set advances currentRevision past the
// diagnostic run's outputRevision, the diagnostic source state flips to
// "stale" with a revision-mention reason. This proves inputRevision /
// outputRevision are real signals, not redundant copies of the same
// post-hoc value.
async function runRevisionDriftCase(args: {
  projectId: string;
  projectRoot: string;
  canonicalRoot: string;
  reefService: InProcessReefService;
}): Promise<void> {
  const baseObservedAt = new Date().toISOString();
  const makeChangeSet = (suffix: string, filePath: string): ReefWorkspaceChangeSet => ({
    changeSetId: `reef_changeset_drift_${suffix}_${randomUUID()}`,
    projectId: args.projectId,
    root: args.canonicalRoot,
    observedAt: baseObservedAt,
    causes: [{
      eventId: `reef_event_drift_${suffix}_${randomUUID()}`,
      projectId: args.projectId,
      root: args.canonicalRoot,
      kind: "reef.file.changed",
      paths: [filePath],
      observedAt: baseObservedAt,
    }],
    fileChanges: [{ path: filePath, kind: "updated" }],
  });

  // Advance the analysis to revision N to simulate a run starting against
  // a known input revision.
  const firstApply = await args.reefService.applyChangeSet(makeChangeSet("first", "src/edited-during.ts"));
  const inputRevision = firstApply.newRevision;
  const startedAtMs = Date.now() - 30_000;
  const finishedAtMs = startedAtMs + 5_000;

  const store = openProjectStore({ projectRoot: args.projectRoot });
  try {
    // Diagnostic run that observed inputRevision and produced
    // outputRevision == inputRevision (no concurrent change during the run).
    // Scoped to a file with no concurrent overlay so this case is isolated
    // from the prior concurrent-edit case's fixture facts.
    store.saveReefDiagnosticRun({
      projectId: args.projectId,
      source: "lint_files",
      overlay: "indexed",
      status: "succeeded",
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "synthetic revision-drift fixture",
      cwd: args.projectRoot,
      metadata: {
        sourceKind: "programmatic",
        inputRevision,
        outputRevision: inputRevision,
        requestedFiles: ["src/untouched.ts"],
        requestedFileCount: 1,
        truncated: false,
      },
    });
  } finally {
    store.close();
  }

  // Status before any further change set: source should be clean.
  const beforeStatus = await args.reefService.getProjectStatus(args.projectId);
  const beforeSource = beforeStatus.diagnostics?.sources.find((source) => source.source === "lint_files");
  assert.ok(beforeSource, "lint_files source must be reported in diagnostics.sources");
  assert.equal(beforeSource.inputRevision, inputRevision);
  assert.equal(beforeSource.outputRevision, inputRevision);
  assert.equal(beforeSource.state, "clean");

  // Apply another change set to advance currentRevision past outputRevision.
  const secondApply = await args.reefService.applyChangeSet(makeChangeSet("second", "src/untouched.ts"));
  assert.equal(secondApply.newRevision, inputRevision + 1);

  const afterStatus = await args.reefService.getProjectStatus(args.projectId);
  const afterSource = afterStatus.diagnostics?.sources.find((source) => source.source === "lint_files");
  assert.ok(afterSource, "lint_files source must still appear after revision advance");
  assert.equal(afterSource.state, "stale");
  assert.equal(afterSource.outputRevision, inputRevision);
  assert.match(
    afterSource.reason,
    /revision/,
    "stale reason should mention revision drift",
  );

  // Save a second run that captured the drift mid-flight: inputRevision <
  // outputRevision. The metadata round-trips through status faithfully.
  const driftStartedAtMs = Date.now() - 10_000;
  const driftFinishedAtMs = driftStartedAtMs + 2_000;
  const driftStore = openProjectStore({ projectRoot: args.projectRoot });
  try {
    driftStore.saveReefDiagnosticRun({
      projectId: args.projectId,
      source: "lint_files",
      overlay: "indexed",
      status: "succeeded",
      startedAt: new Date(driftStartedAtMs).toISOString(),
      finishedAt: new Date(driftFinishedAtMs).toISOString(),
      durationMs: driftFinishedAtMs - driftStartedAtMs,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "synthetic mid-flight drift fixture",
      cwd: args.projectRoot,
      metadata: {
        sourceKind: "programmatic",
        inputRevision,
        outputRevision: inputRevision + 1,
        requestedFiles: ["src/untouched.ts"],
        requestedFileCount: 1,
        truncated: false,
      },
    });
  } finally {
    driftStore.close();
  }

  const driftStatus = await args.reefService.getProjectStatus(args.projectId);
  const driftSource = driftStatus.diagnostics?.sources.find((source) => source.source === "lint_files");
  assert.ok(driftSource);
  assert.equal(driftSource.inputRevision, inputRevision);
  assert.equal(driftSource.outputRevision, inputRevision + 1);
  assert.equal(driftSource.state, "stale");
  assert.match(
    driftSource.reason,
    /crossed revisions/,
    "mid-flight revision drift should make the diagnostic run stale even when outputRevision equals currentRevision",
  );
  assert.notEqual(
    driftSource.inputRevision,
    driftSource.outputRevision,
    "input/output revisions should differ when a change set lands during the run",
  );

  // Scoped revision drift: a change set that does not overlap the run's
  // requested files (here, a docs-only edit) advances the global revision but
  // must NOT flip the source stale; a later overlapping change set must.
  const scopedRevision = inputRevision + 1;
  const scopedStartedAtMs = Date.now() - 5_000;
  const scopedStore = openProjectStore({ projectRoot: args.projectRoot });
  try {
    scopedStore.saveReefDiagnosticRun({
      projectId: args.projectId,
      source: "lint_files",
      overlay: "indexed",
      status: "succeeded",
      startedAt: new Date(scopedStartedAtMs).toISOString(),
      finishedAt: new Date(scopedStartedAtMs + 1_000).toISOString(),
      durationMs: 1_000,
      checkedFileCount: 1,
      findingCount: 0,
      persistedFindingCount: 0,
      command: "synthetic scoped-revision fixture",
      cwd: args.projectRoot,
      metadata: {
        sourceKind: "programmatic",
        inputRevision: scopedRevision,
        outputRevision: scopedRevision,
        requestedFiles: ["src/untouched.ts"],
        requestedFileCount: 1,
        truncated: false,
      },
    });
  } finally {
    scopedStore.close();
  }

  await args.reefService.applyChangeSet(makeChangeSet("docs_only", "docs/notes.md"));
  const docsOnlyStatus = await args.reefService.getProjectStatus(args.projectId);
  const docsOnlySource = docsOnlyStatus.diagnostics?.sources.find((source) => source.source === "lint_files");
  assert.ok(docsOnlySource);
  assert.equal(
    docsOnlySource.state,
    "clean",
    "a docs-only change set outside the run's requested files must not mark the source stale",
  );

  await args.reefService.applyChangeSet(makeChangeSet("overlapping", "src/untouched.ts"));
  const overlappingStatus = await args.reefService.getProjectStatus(args.projectId);
  const overlappingSource = overlappingStatus.diagnostics?.sources.find((source) => source.source === "lint_files");
  assert.ok(overlappingSource);
  assert.equal(
    overlappingSource.state,
    "stale",
    "a change set overlapping the run's requested files must still mark the source stale",
  );
}

main().catch((error) => {
  console.error("reef-diagnostics-freshness: FAIL", error);
  process.exit(1);
});
