import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ProjectIndexWatchCatchUpResult,
  ProjectIndexWatchState,
  ReefProjectEvent,
  ReefWorkspaceChangeSet,
} from "../../packages/contracts/src/index.ts";
import { createProjectStoreCache } from "../../packages/store/src/index.ts";
import { createInProcessReefService } from "../../services/indexer/src/index.ts";
import { isProjectCommandError } from "../../services/indexer/src/errors.ts";

interface ReefChangeSetsQueryOutput {
  snapshot: {
    behavior: "latest" | "pinned" | "restartable";
    revision: number;
    restarted: boolean;
  };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-concurrency-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-concurrency-smoke" }));
  writeFileSync(path.join(projectRoot, "src", "index.ts"), "export const value = 1;\n");

  try {
    await runConcurrentApplyChangeSet({ projectRoot });
    await runChurnCoalescing({ projectRoot });
    await runRestartExhaustion({ projectRoot });
    console.log("reef-service-concurrency: PASS");
  } finally {
    restoreEnv("MAKO_STATE_HOME", originalStateHome);
    restoreEnv("MAKO_STATE_DIRNAME", originalStateDirName);
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function runConcurrentApplyChangeSet(input: { projectRoot: string }): Promise<void> {
  const serviceA = createInProcessReefService();
  const serviceB = createInProcessReefService();
  try {
    await Promise.all([serviceA.start(), serviceB.start()]);
    const registered = await serviceA.registerProject({ root: input.projectRoot });

    const baseObservedAt = new Date().toISOString();
    const makeChangeSet = (idSuffix: string, filePath: string): ReefWorkspaceChangeSet => ({
      changeSetId: `reef_changeset_${idSuffix}`,
      projectId: registered.projectId,
      root: registered.canonicalRoot,
      observedAt: baseObservedAt,
      causes: [{
        eventId: `reef_event_${idSuffix}`,
        projectId: registered.projectId,
        root: registered.canonicalRoot,
        kind: "reef.file.changed",
        paths: [filePath],
        observedAt: baseObservedAt,
      }],
      fileChanges: [{ path: filePath, kind: "updated" }],
    });

    const [a, b] = await Promise.all([
      serviceA.applyChangeSet(makeChangeSet("a", "src/concurrent-a.ts")),
      serviceB.applyChangeSet(makeChangeSet("b", "src/concurrent-b.ts")),
    ]);

    assert.notEqual(a.newRevision, b.newRevision, "concurrent applyChangeSet must not assign duplicate newRevision");
    const revisions = new Set([a.newRevision, b.newRevision]);
    assert.deepEqual([...revisions].sort(), [1, 2]);
    assert.equal(a.baseRevision + 1, a.newRevision);
    assert.equal(b.baseRevision + 1, b.newRevision);

    const status = await serviceA.getProjectStatus(registered.projectId);
    assert.equal(status.analysis.currentRevision, 2);

    let duplicateChangeSetError: unknown;
    try {
      await serviceA.applyChangeSet(makeChangeSet("a", "src/concurrent-a.ts"));
    } catch (error) {
      duplicateChangeSetError = error;
    }
    assert.ok(duplicateChangeSetError, "duplicate change_set_id should fail");
    assert.equal(
      isProjectCommandError(duplicateChangeSetError) && duplicateChangeSetError.code === "stale_base_revision",
      false,
      "duplicate change_set_id must not be reported as a stale revision race",
    );

    await serviceA.unregisterProject(registered.projectId);
  } finally {
    await Promise.allSettled([serviceA.stop(), serviceB.stop()]);
  }
}

async function runChurnCoalescing(input: { projectRoot: string }): Promise<void> {
  const cache = createProjectStoreCache();
  const service = createInProcessReefService({
    projectStoreCache: cache,
    // Short debounce, long max-delay — burst should coalesce into one
    // change set when a sustained stream of events arrives faster than
    // the debounce window can settle.
    reefEventBatchDebounceMs: 200,
    reefEventBatchMaxDelayMs: 60000,
  });
  try {
    await service.start();
    const registered = await service.registerProject({ root: input.projectRoot });

    const burstSize = 50;
    const submissions: Promise<void>[] = [];
    for (let index = 0; index < burstSize; index += 1) {
      const filePath = `src/churn-${index}.ts`;
      writeFileSync(path.join(input.projectRoot, filePath), `export const churn${index} = ${index};\n`);
      const event: ReefProjectEvent = {
        eventId: `reef_event_churn_${index}_${randomUUID()}`,
        projectId: registered.projectId,
        root: registered.canonicalRoot,
        kind: "reef.file.added",
        paths: [filePath],
        observedAt: new Date().toISOString(),
      };
      submissions.push(service.submitEvent(event));
    }
    await Promise.all(submissions);

    await waitFor(async () => {
      const status = await service.getProjectStatus(registered.projectId);
      return (status.writerQueue.queued ?? 0) === 0
        && status.writerQueue.lastRunResult === "succeeded"
        && status.analysis.materializedRevision === status.analysis.currentRevision
        && (status.analysis.currentRevision ?? 0) >= 1;
    }, "churn batch did not settle");

    const createdChangeSets = await service.listOperations({
      projectId: registered.projectId,
      kind: "change_set_created",
      limit: 200,
    });
    const submitEventChangeSets = createdChangeSets.filter((operation) => {
      const source = operation.data?.source;
      return typeof source === "string" && source.startsWith("submitEvent:");
    });
    assert.equal(
      submitEventChangeSets.length,
      1,
      `expected sustained churn to coalesce into 1 change set, got ${submitEventChangeSets.length}`,
    );
    const causeCount = submitEventChangeSets[0]?.data?.causeCount;
    assert.equal(
      causeCount,
      burstSize,
      `expected coalesced change set to carry all ${burstSize} causes, got ${causeCount}`,
    );

    await service.unregisterProject(registered.projectId);
  } finally {
    await service.stop();
    cache.flush();
  }
}

async function runRestartExhaustion(input: { projectRoot: string }): Promise<void> {
  const cache = createProjectStoreCache();
  const watchStates = new Map<string, ProjectIndexWatchState>();
  let serviceRef: ReturnType<typeof createInProcessReefService> | undefined;
  let registeredProjectId: string | undefined;
  let registeredRoot: string | undefined;
  let cancelCount = 0;

  const service = createInProcessReefService({
    projectStoreCache: cache,
    indexRefreshCoordinator: {
      getWatchState: (projectId?: string) => projectId ? watchStates.get(projectId) : undefined,
      waitForCatchUp: async (_projectId, options) => {
        // While the query is blocked here, fire an applyChangeSet so that the
        // running restartable query is canceled. Each call advances the
        // revision and flips the canceled flag on every running restartable
        // query, including this one.
        if (serviceRef && registeredProjectId && registeredRoot && cancelCount < 10) {
          cancelCount += 1;
          const observedAt = new Date().toISOString();
          await serviceRef.applyChangeSet({
            changeSetId: `reef_changeset_restart_${cancelCount}_${randomUUID()}`,
            projectId: registeredProjectId,
            root: registeredRoot,
            observedAt,
            causes: [{
              eventId: `reef_event_restart_${cancelCount}_${randomUUID()}`,
              projectId: registeredProjectId,
              root: registeredRoot,
              kind: "reef.file.changed",
              paths: [`src/restart-${cancelCount}.ts`],
              observedAt,
            }],
            fileChanges: [{ path: `src/restart-${cancelCount}.ts`, kind: "updated" }],
          });
        }
        const now = new Date().toISOString();
        const result: ProjectIndexWatchCatchUpResult = {
          status: "succeeded",
          method: "watcher_cookie",
          startedAt: now,
          finishedAt: now,
          durationMs: 1,
          maxWaitMs: options?.maxWaitMs ?? 0,
          reason: options?.reason ?? "reef-service-concurrency-smoke",
        };
        return result;
      },
    },
  });
  serviceRef = service;

  try {
    await service.start();
    const registered = await service.registerProject({ root: input.projectRoot });
    registeredProjectId = registered.projectId;
    registeredRoot = registered.canonicalRoot;

    let caught: unknown;
    try {
      await service.query<Record<string, unknown>, ReefChangeSetsQueryOutput>({
        projectId: registered.projectId,
        kind: "reef.change_sets",
        freshnessPolicy: "wait_for_refresh",
        snapshot: "restartable",
        input: { limit: 5 },
      });
    } catch (error) {
      caught = error;
    }

    assert.ok(caught, "expected restartable query to throw under sustained cancellation");
    assert.ok(isProjectCommandError(caught), `expected ProjectCommandError, got ${caught instanceof Error ? caught.constructor.name : typeof caught}`);
    if (isProjectCommandError(caught)) {
      assert.equal(caught.code, "query_restart_exhausted");
      assert.equal(caught.statusCode, 503);
      assert.equal(caught.details?.kind, "reef.change_sets");
      assert.equal(caught.details?.maxRestarts, 3);
    }

    // We expect the catchUp shim to have been invoked at least once per
    // executed query attempt. With MAX_RESTARTS=3, that's 4 invocations.
    assert.ok(cancelCount >= 4, `expected at least 4 cancellations, got ${cancelCount}`);

    await service.unregisterProject(registered.projectId);
  } finally {
    await service.stop();
    cache.flush();
  }
}

async function waitFor(predicate: () => Promise<boolean>, message: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for: ${message}`);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error) => {
  console.error("reef-service-concurrency: FAIL", error);
  process.exit(1);
});
