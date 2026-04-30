import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ContextPacketToolOutput,
  ProjectFinding,
  ProjectOpenLoopsToolOutput,
  VerificationStateToolOutput,
} from "../../packages/contracts/src/index.ts";
import type { IndexRunRecord, ProjectStore } from "../../packages/store/src/index.ts";
import { createProjectStoreCache } from "../../packages/store/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import {
  createProjectIndexRefreshCoordinator,
  type ProjectIndexRefreshCoordinator,
} from "../../services/api/src/index-refresh-coordinator.ts";
import { createInProcessReefService, indexProject, readReefOperations } from "../../services/indexer/src/index.ts";

const WATCH_DEBOUNCE_MS = 100;
const WATCH_MAX_DELAY_MS = 1000;

interface FileSnapshotData {
  state?: string;
  sha256?: string;
}

interface ReefChangeSetsQueryOutput {
  snapshot: {
    behavior: "latest" | "pinned" | "restartable";
    revision: number;
    latestKnownRevision: number;
    materializedRevision?: number;
    stale: boolean;
    state: "fresh" | "refreshing" | "stale" | "unknown";
    restarted: boolean;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  message: string,
  timeoutMs = 6000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(message);
}

// Chokidar delivers change events asynchronously, so `status === "idle"` is
// not necessarily steady: a trailing event from a prior burst can flip the
// watcher back to `dirty` right after we observe idle. Wait for idle, hold a
// grace window, and require that `lastEventAt` did not advance during the
// window before declaring the coordinator settled.
async function settleCoordinator(
  coordinator: ProjectIndexRefreshCoordinator,
  projectId: string,
  graceMs = 400,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await waitFor(
      () => coordinator.getWatchState(projectId)?.status === "idle",
      `settle attempt ${attempt + 1}: watcher did not return to idle`,
      8000,
    );
    const before = coordinator.getWatchState(projectId);
    await sleep(graceMs);
    const after = coordinator.getWatchState(projectId);
    if (after?.status === "idle" && before?.lastEventAt === after?.lastEventAt) {
      return;
    }
  }
  throw new Error("coordinator failed to settle within 8 attempts");
}

// Poll `getLatestIndexRun` every `tickMs` and collect unique run IDs with a
// non-manual triggerSource. Returns a stop function; call it to clear the
// interval and resolve the collected Map. Polling interval is chosen to be
// well below the smallest expected index-run duration so no run is missed
// entirely between ticks.
function collectWatchRunsFrom(
  store: ProjectStore,
  baselineRunId: string | undefined,
  tickMs = 15,
): { stop: () => Map<string, IndexRunRecord> } {
  const collected = new Map<string, IndexRunRecord>();
  const interval = setInterval(() => {
    const latest = store.getLatestIndexRun();
    if (!latest) return;
    if (latest.runId === baselineRunId) return;
    if (collected.has(latest.runId)) return;
    collected.set(latest.runId, latest);
  }, tickMs);
  return {
    stop: () => {
      clearInterval(interval);
      return collected;
    },
  };
}

async function runBasicWatchCase(
  store: ProjectStore,
  coordinator: ProjectIndexRefreshCoordinator,
  projectRoot: string,
  projectId: string,
): Promise<void> {
  writeFileSync(path.join(projectRoot, "src", "alpha.ts"), "export const value = 2;\n");

  await waitFor(
    () => {
      const latestRun = store.getLatestIndexRun();
      return latestRun?.triggerSource === "watch_paths" && latestRun.status === "succeeded";
    },
    "watcher did not trigger a debounced index run",
  );
  await waitFor(
    () => coordinator.getWatchState(projectId)?.status === "idle",
    "watcher did not return to idle after refresh",
  );
  const watcherEvents = await readReefOperations({}, {
    projectId,
    kind: "watcher_event",
    limit: 20,
  });
  assert.ok(watcherEvents.some((operation) => {
    return operation.data?.kind === "reef.file.changed"
      && operation.data?.pathCount === 1;
  }), "watcher refresh should submit a reef.file.changed event");
  const changeSets = await readReefOperations({}, {
    projectId,
    kind: "change_set_created",
    limit: 20,
  });
  assert.ok(changeSets.some((operation) => {
    return operation.data?.source === "submitEvent:debounce"
      && operation.data?.causeCount === 1;
  }), "watcher event should enter the submitEvent change-set pipeline");

  const subjectFingerprint = store.computeReefSubjectFingerprint({
    kind: "file",
    path: "src/alpha.ts",
  });
  const overlayFacts = store.queryReefFacts({
    projectId,
    overlay: "working_tree",
    source: "working_tree_overlay",
    kind: "file_snapshot",
    subjectFingerprint,
  });
  assert.equal(
    overlayFacts.length,
    1,
    "watch refresh should persist one replacement working-tree file snapshot fact",
  );
  const data = overlayFacts[0]?.data as FileSnapshotData | undefined;
  assert.equal(data?.state, "present");
  assert.ok(data?.sha256);
  const watchState = coordinator.getWatchState(projectId);
  assert.ok(watchState?.lastOverlayFactUpdatedAt);
  assert.equal(watchState?.lastOverlayFactError, undefined);
  assert.ok((watchState?.lastOverlayFactCount ?? 0) >= 1);
  assert.ok(typeof watchState?.lastOverlayFactDurationMs === "number");
  assert.ok(
    (watchState?.lastOverlayFactDurationMs ?? Number.POSITIVE_INFINITY) < 500,
    `working-tree overlay fact update should stay under 500ms on the watch smoke fixture; got ${
      watchState?.lastOverlayFactDurationMs
    }`,
  );
  assert.ok(watchState?.lastDiagnosticRefreshFinishedAt);
  assert.equal(watchState?.lastDiagnosticRefreshFileCount, 1);
  assert.deepEqual(watchState?.lastDiagnosticRefreshSources, [
    "lint_files",
    "programmatic_findings",
    "typescript_syntax",
    "typescript",
  ]);
  assert.equal(watchState?.lastDiagnosticRefreshError, undefined);

  const verification = await invokeTool("verification_state", {
    projectId,
    files: ["src/alpha.ts"],
    sources: ["lint_files", "typescript_syntax", "typescript"],
    cacheStalenessMs: 60_000,
  }) as VerificationStateToolOutput;
  assert.equal(
    verification.status,
    "fresh",
    "watcher diagnostics should leave the changed file fresh for verification_state",
  );
  assert.deepEqual(verification.changedFiles, []);
  assert.ok(
    verification.sources.every((source) => source.status === "fresh"),
    `expected watcher-refreshed diagnostic sources to be fresh, got ${
      verification.sources.map((source) => `${source.source}:${source.status}`).join(", ")
    }`,
  );

  const deleteSubject = { kind: "file" as const, path: "src/delete-me.ts" };
  const deleteFindingSubjectFingerprint = store.computeReefSubjectFingerprint(deleteSubject);
  const deleteFindingFingerprint = store.computeReefFindingFingerprint({
    source: "reef_rule:watch_delete_fixture",
    ruleId: "watch.delete_fixture",
    subjectFingerprint: deleteFindingSubjectFingerprint,
    message: "fixture finding for deleted file",
  });
  const capturedAt = new Date().toISOString();
  const deleteFinding: ProjectFinding = {
    projectId,
    fingerprint: deleteFindingFingerprint,
    source: "reef_rule:watch_delete_fixture",
    subjectFingerprint: deleteFindingSubjectFingerprint,
    overlay: "working_tree",
    severity: "warning",
    status: "active",
    filePath: deleteSubject.path,
    ruleId: "watch.delete_fixture",
    freshness: {
      state: "fresh",
      checkedAt: capturedAt,
      reason: "fixture active before delete",
    },
    capturedAt,
    message: "fixture finding for deleted file",
    factFingerprints: [],
  };
  store.replaceReefFindingsForSource({
    projectId,
    source: deleteFinding.source,
    overlay: "working_tree",
    findings: [deleteFinding],
  });
  assert.equal(
    store.queryReefFindings({
      projectId,
      overlay: "working_tree",
      source: deleteFinding.source,
      filePath: deleteSubject.path,
    }).length,
    1,
    "delete fixture should start with one active working-tree finding",
  );

  const deleteBaselineRunId = store.getLatestIndexRun()?.runId;
  unlinkSync(path.join(projectRoot, "src", "delete-me.ts"));
  await waitFor(
    () => {
      const latestRun = store.getLatestIndexRun();
      return (
        latestRun?.runId !== deleteBaselineRunId &&
        latestRun?.triggerSource === "watch_paths" &&
        latestRun.status === "succeeded"
      );
    },
    "watcher did not trigger an index run after deleting a file",
  );
  await waitFor(
    () => coordinator.getWatchState(projectId)?.status === "idle",
    "watcher did not return to idle after delete refresh",
  );
  const deleteWatcherEvents = await readReefOperations({}, {
    projectId,
    kind: "watcher_event",
    limit: 20,
  });
  assert.ok(deleteWatcherEvents.some((operation) => {
    return operation.data?.kind === "reef.file.deleted"
      && operation.data?.pathCount === 1;
  }), "watcher delete should submit a reef.file.deleted event");

  const deletedSubjectFingerprint = store.computeReefSubjectFingerprint({
    kind: "file",
    path: "src/delete-me.ts",
  });
  const deletedOverlayFacts = store.queryReefFacts({
    projectId,
    overlay: "working_tree",
    source: "working_tree_overlay",
    kind: "file_snapshot",
    subjectFingerprint: deletedSubjectFingerprint,
  });
  assert.equal(
    deletedOverlayFacts.length,
    1,
    "watch refresh should persist one working-tree deletion snapshot fact",
  );
  const deletedData = deletedOverlayFacts[0]?.data as FileSnapshotData | undefined;
  assert.equal(deletedData?.state, "deleted");
  const deleteWatchState = coordinator.getWatchState(projectId);
  assert.equal(deleteWatchState?.lastRefreshMode, "paths");
  assert.equal(deleteWatchState?.lastRefreshFallbackReason, undefined);
  assert.ok((deleteWatchState?.lastRefreshPathCount ?? 0) >= 1);
  assert.ok((deleteWatchState?.lastRefreshDeletedPathCount ?? 0) >= 1);
  const activeDeletedFindings = store.queryReefFindings({
    projectId,
    overlay: "working_tree",
    source: deleteFinding.source,
    filePath: deleteSubject.path,
  });
  assert.equal(activeDeletedFindings.length, 0, "watcher delete should resolve active file findings");
  const resolvedDeletedFindings = store.queryReefFindings({
    projectId,
    overlay: "working_tree",
    source: deleteFinding.source,
    filePath: deleteSubject.path,
    status: "resolved",
    includeResolved: true,
  });
  assert.equal(resolvedDeletedFindings.length, 1);
  assert.equal(resolvedDeletedFindings[0]?.fingerprint, deleteFindingFingerprint);
  assert.ok((deleteWatchState?.lastOverlayResolvedFindingCount ?? 0) >= 1);
}

async function runCatchUpCookieCase(
  store: ProjectStore,
  coordinator: ProjectIndexRefreshCoordinator,
  projectId: string,
): Promise<void> {
  await settleCoordinator(coordinator, projectId);
  const runBefore = store.getLatestIndexRun()?.runId;
  const result = await coordinator.waitForCatchUp(projectId, {
    maxWaitMs: 1500,
    reason: "mcp_index_watch_smoke",
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.method, "watcher_cookie");
  assert.equal(result.reason, "mcp_index_watch_smoke");
  assert.equal(result.error, undefined);
  assert.ok(result.cookiePath?.startsWith(".mako-reef-watch-cookie-"));

  const watchState = coordinator.getWatchState(projectId);
  assert.equal(watchState?.lastCatchUpStatus, "succeeded");
  assert.equal(watchState?.lastCatchUpMethod, "watcher_cookie");
  assert.equal(watchState?.lastCatchUpReason, "mcp_index_watch_smoke");
  assert.ok(typeof watchState?.lastCatchUpDurationMs === "number");

  await sleep(WATCH_DEBOUNCE_MS + 100);
  assert.equal(
    store.getLatestIndexRun()?.runId,
    runBefore,
    "watcher catch-up cookie should not trigger an index run",
  );
}

async function runWaitForRefreshQueryCase(
  coordinator: ProjectIndexRefreshCoordinator,
  reefService: ReturnType<typeof createInProcessReefService>,
  projectRoot: string,
  projectId: string,
): Promise<void> {
  await settleCoordinator(coordinator, projectId);
  const before = await reefService.getProjectStatus(projectId);
  const beforeRevision = before.analysis.currentRevision ?? 0;
  writeFileSync(
    path.join(projectRoot, "src", "alpha.ts"),
    `export const value = ${Date.now()};\n`,
  );
  await waitFor(
    () => {
      const status = coordinator.getWatchState(projectId)?.status;
      return status === "scheduled" || status === "dirty";
    },
    "watcher did not schedule dirty work before wait_for_refresh query",
  );

  const result = await reefService.query<Record<string, unknown>, ReefChangeSetsQueryOutput>({
    projectId,
    kind: "reef.change_sets",
    freshnessPolicy: "wait_for_refresh",
    snapshot: "latest",
    input: {
      limit: 5,
    },
  });
  assert.equal(result.snapshot.behavior, "latest");
  assert.ok(
    result.snapshot.revision > beforeRevision,
    `wait_for_refresh query should materialize scheduled watcher work before resolving; got ${result.snapshot.revision} <= ${beforeRevision}`,
  );
}

async function runContextPacketFreshnessGateCase(
  store: ProjectStore,
  coordinator: ProjectIndexRefreshCoordinator,
  cache: ReturnType<typeof createProjectStoreCache>,
  projectRoot: string,
  projectId: string,
): Promise<void> {
  await settleCoordinator(coordinator, projectId);
  const runBefore = store.getLatestIndexRun();
  writeFileSync(
    path.join(projectRoot, "src", "alpha.ts"),
    `export const gate = ${Date.now()};\n`,
  );
  await waitFor(
    () => {
      const status = coordinator.getWatchState(projectId)?.status;
      return status === "scheduled" || status === "dirty";
    },
    "watcher did not schedule dirty work before context_packet freshness gate query",
  );

  const packet = await invokeTool(
    "context_packet",
    {
      projectId,
      request: "where is the alpha gate value?",
      focusFiles: ["src/alpha.ts"],
    },
    {
      projectStoreCache: cache,
      indexRefreshCoordinator: coordinator,
    },
  ) as ContextPacketToolOutput;

  assert.equal(packet.freshnessGate.status, "fresh");
  assert.equal(packet.freshnessGate.source, "watcher");
  assert.equal(packet.freshnessGate.catchUp?.status, "succeeded");
  assert.equal(packet.freshnessGate.indexFreshness.state, "fresh");
  assert.notEqual(
    store.getLatestIndexRun()?.runId,
    runBefore?.runId,
    "context_packet freshness gate should materialize watcher work without manual refresh",
  );
  assert.equal(
    coordinator.getWatchState(projectId)?.status,
    "idle",
    "context_packet freshness gate should leave the watcher settled",
  );
}

async function runGeneratedOutputIgnoredCase(
  store: ProjectStore,
  projectRoot: string,
): Promise<void> {
  const runBefore = store.getLatestIndexRun();
  mkdirSync(path.join(projectRoot, "dist"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "dist", "generated.ts"),
    "export const ignored = true;\n",
  );
  await sleep(WATCH_MAX_DELAY_MS + 200);
  assert.equal(
    store.getLatestIndexRun()?.runId,
    runBefore?.runId,
    "generated output write should not trigger a watcher index run",
  );
}

// Continuous edits at an interval shorter than debounce should still produce
// an index run via max-delay, and that run's triggerSource must identify the
// max-delay path so agents (and telemetry) can tell it apart from a normal
// debounced refresh. Any follow-up run that picks up the trailing edits will
// carry the default `watch_paths` triggerSource; we only assert the max-delay run
// was observed, not which run ends the case.
async function runMaxDelayCase(
  store: ProjectStore,
  coordinator: ProjectIndexRefreshCoordinator,
  projectRoot: string,
  projectId: string,
): Promise<void> {
  await settleCoordinator(coordinator, projectId);

  const baseline = store.getLatestIndexRun();
  const collector = collectWatchRunsFrom(store, baseline?.runId, 5);
  const editInterval = setInterval(() => {
    writeFileSync(
      path.join(projectRoot, "src", "alpha.ts"),
      `export const value = ${Date.now()};\n`,
    );
  }, 25);

  try {
    // Run edits past the 1000ms max-delay so max-delay wins while
    // debounce keeps getting reset by the rapid edit cadence.
    await sleep(WATCH_MAX_DELAY_MS + 400);
  } finally {
    clearInterval(editInterval);
  }

  await settleCoordinator(coordinator, projectId);
  const observed = collector.stop();
  const maxDelayRun = [...observed.values()].find(
    (run) => run.triggerSource === "watch_paths_max_delay",
  );
  assert.ok(
    maxDelayRun,
    `max-delay under continuous edits should fire triggerSource=watch_paths_max_delay; observed ${
      [...observed.values()].map((run) => run.triggerSource).join(", ") || "nothing"
    }`,
  );
}

// N edits arriving while an index run is in progress must coalesce into
// exactly one follow-up run, not N. The coordinator tracks this with a
// single `followUpQueued` boolean; the assertion guards against a regression
// where each in-progress edit accidentally schedules its own refresh.
async function runQueueOneFollowUpCase(
  store: ProjectStore,
  coordinator: ProjectIndexRefreshCoordinator,
  projectRoot: string,
  projectId: string,
): Promise<void> {
  await settleCoordinator(coordinator, projectId);

  const baseline = store.getLatestIndexRun();
  const collector = collectWatchRunsFrom(store, baseline?.runId, 5);

  try {
    // Use `lastRefreshStartedAt` rather than `status === "indexing"` as
    // the sync point. On tiny fixtures, indexProject can finish in ~20ms
    // — faster than any reasonable poll interval — so "indexing" is often
    // unobservable even when a refresh plainly ran. lastRefreshStartedAt
    // is set once per run and persists until the next run starts, so "it
    // advanced" is a stable proof that a refresh began.
    const preInitStartedAt =
      coordinator.getWatchState(projectId)?.lastRefreshStartedAt;
    writeFileSync(
      path.join(projectRoot, "src", "alpha.ts"),
      "export const init = 1;\n",
    );

    await waitFor(
      () => {
        const curr = coordinator.getWatchState(projectId)?.lastRefreshStartedAt;
        return typeof curr === "string" && curr !== preInitStartedAt;
      },
      "first refresh did not start after initial edit",
      4000,
    );
    const postInitStartedAt =
      coordinator.getWatchState(projectId)?.lastRefreshStartedAt;
    const eventAtBeforeBurst =
      coordinator.getWatchState(projectId)?.lastEventAt;

    // Fire five edits back-to-back right after the first refresh starts.
    // Some events will land while indexing is still true (exercising the
    // `followUpQueued` path); others will arrive after (falling into
    // `scheduleRefresh`, whose debounce coalesces rapid events into one).
    // Either path should collapse into exactly one follow-up run.
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(
        path.join(projectRoot, "src", "alpha.ts"),
        `export const during = ${i};\n`,
      );
    }

    // chokidar delivery on Windows can lag hundreds of ms behind the
    // write call, so `settleCoordinator`'s grace window can return before
    // the burst events ever register. Wait for `lastEventAt` to advance
    // past the pre-burst marker so we know the coordinator actually saw
    // the burst before we check whether a follow-up fired.
    await waitFor(
      () => {
        const nowEventAt = coordinator.getWatchState(projectId)?.lastEventAt;
        return typeof nowEventAt === "string" && nowEventAt !== eventAtBeforeBurst;
      },
      "coordinator never received a chokidar event from the burst edits",
      4000,
    );

    // Wait for a SECOND refresh to start (the single follow-up). If the
    // `followUpQueued` logic regresses and a follow-up never fires, this
    // times out with a clear message. If it regresses the other way and
    // N refreshes fire, the later count assertion catches it.
    await waitFor(
      () => {
        const curr = coordinator.getWatchState(projectId)?.lastRefreshStartedAt;
        return typeof curr === "string" && curr !== postInitStartedAt;
      },
      "follow-up refresh did not start after burst edits",
      4000,
    );

    await settleCoordinator(coordinator, projectId, 800);
  } finally {
    const observed = collector.stop();
    const watchRuns = [...observed.values()].filter(
      (run) => run.triggerSource === "watch_paths" || run.triggerSource === "watch_paths_max_delay",
    );
    assert.equal(
      watchRuns.length,
      2,
      `queue-one-follow-up expected exactly 2 watch runs (first + one follow-up), got ${
        watchRuns.length
      }: ${watchRuns.map((run) => `${run.runId}:${run.triggerSource}`).join(", ")}`,
    );
  }
}

async function runProjectSwitchCase(
  coordinator: ProjectIndexRefreshCoordinator,
  cache: ReturnType<typeof createProjectStoreCache>,
  previousProjectId: string,
  secondRoot: string,
): Promise<void> {
  const secondIndexed = await indexProject(secondRoot, { projectStoreCache: cache });
  await coordinator.setActiveProject(secondIndexed.project);
  const switched = coordinator.getWatchState(secondIndexed.project.projectId);
  assert.equal(switched?.transition, "switched");
  assert.equal(switched?.switchFromProjectId, previousProjectId);
}

async function runToolResolutionWatcherStatusCase(
  coordinator: ProjectIndexRefreshCoordinator,
  cache: ReturnType<typeof createProjectStoreCache>,
  reefService: ReturnType<typeof createInProcessReefService>,
  projectRoot: string,
): Promise<void> {
  const previousReefMode = process.env.MAKO_REEF_MODE;
  process.env.MAKO_REEF_MODE = "auto";
  try {
    const loops = await invokeTool(
      "project_open_loops",
      { limit: 1 },
      {
        projectStoreCache: cache,
        indexRefreshCoordinator: coordinator,
        reefService,
        requestContext: {
          getRoots: async () => [projectRoot],
          onProjectResolved: async (project) => {
            await coordinator.setActiveProject(project);
          },
        },
      },
    ) as ProjectOpenLoopsToolOutput;

    assert.equal(
      loops.reefExecution.watcher?.active,
      true,
      "tool project resolution should await watcher activation before building Reef execution metadata",
    );
  } finally {
    restoreEnv("MAKO_REEF_MODE", previousReefMode);
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-index-watch-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const secondRoot = path.join(tmp, "second-project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  const originalWatch = process.env.MAKO_INDEX_WATCH;
  const originalDebounce = process.env.MAKO_INDEX_WATCH_DEBOUNCE_MS;
  const originalMaxDelay = process.env.MAKO_INDEX_WATCH_MAX_DELAY_MS;
  const originalReefMode = process.env.MAKO_REEF_MODE;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;
  process.env.MAKO_INDEX_WATCH = "1";
  process.env.MAKO_INDEX_WATCH_DEBOUNCE_MS = String(WATCH_DEBOUNCE_MS);
  process.env.MAKO_INDEX_WATCH_MAX_DELAY_MS = String(WATCH_MAX_DELAY_MS);
  process.env.MAKO_REEF_MODE = "legacy";

  for (const root of [projectRoot, secondRoot]) {
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: path.basename(root) }));
    writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        target: "ES2020",
        module: "commonjs",
      },
      include: ["src/**/*.ts"],
    }));
    writeFileSync(path.join(root, "src", "alpha.ts"), "export const value = 1;\n");
    writeFileSync(path.join(root, "src", "delete-me.ts"), "export const deleted = true;\n");
  }

  const cache = createProjectStoreCache();
  const coordinator = createProjectIndexRefreshCoordinator({ projectStoreCache: cache });
  const reefService = createInProcessReefService({
    projectStoreCache: cache,
    indexRefreshCoordinator: coordinator,
  });

  try {
    await reefService.start();
    const indexed = await indexProject(projectRoot, { projectStoreCache: cache });
    await reefService.registerProject({ root: projectRoot });
    await runToolResolutionWatcherStatusCase(coordinator, cache, reefService, projectRoot);
    const store = cache.borrow({ projectRoot: indexed.project.canonicalPath });
    await coordinator.setActiveProject(indexed.project);
    assert.equal(coordinator.getWatchState(indexed.project.projectId)?.status, "idle");

    await runCatchUpCookieCase(store, coordinator, indexed.project.projectId);
    await runWaitForRefreshQueryCase(coordinator, reefService, projectRoot, indexed.project.projectId);
    await runContextPacketFreshnessGateCase(store, coordinator, cache, projectRoot, indexed.project.projectId);
    await runBasicWatchCase(store, coordinator, projectRoot, indexed.project.projectId);
    await runGeneratedOutputIgnoredCase(store, projectRoot);
    await runMaxDelayCase(store, coordinator, projectRoot, indexed.project.projectId);
    await runQueueOneFollowUpCase(store, coordinator, projectRoot, indexed.project.projectId);
    await runProjectSwitchCase(coordinator, cache, indexed.project.projectId, secondRoot);

    console.log("mcp-index-watch: PASS");
  } finally {
    await reefService.stop();
    await coordinator.close();
    cache.flush();
    restoreEnv("MAKO_STATE_HOME", originalStateHome);
    restoreEnv("MAKO_STATE_DIRNAME", originalStateDirName);
    restoreEnv("MAKO_INDEX_WATCH", originalWatch);
    restoreEnv("MAKO_INDEX_WATCH_DEBOUNCE_MS", originalDebounce);
    restoreEnv("MAKO_INDEX_WATCH_MAX_DELAY_MS", originalMaxDelay);
    restoreEnv("MAKO_REEF_MODE", originalReefMode);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
