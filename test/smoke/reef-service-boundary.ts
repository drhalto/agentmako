import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ProjectIndexStatusToolOutput,
  ProjectIndexWatchCatchUpResult,
  ProjectIndexWatchState,
  ReefProjectEvent,
} from "../../packages/contracts/src/index.ts";
import { createProjectStoreCache, hashText } from "../../packages/store/src/index.ts";
import { createApiService } from "../../services/api/src/index.ts";
import { createInProcessReefService } from "../../services/indexer/src/index.ts";
import { withReefRootWriterLock } from "../../services/indexer/src/reef-writer-lock.ts";

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
  changeSets: Array<{
    changeSetId: string;
    newRevision: number;
    fileChanges?: Array<{ path: string; kind: string }>;
  }>;
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-service-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-service-smoke" }));
  writeFileSync(path.join(projectRoot, "src", "index.ts"), "export const value = 1;\n");

  const cache = createProjectStoreCache();
  const watchStates = new Map<string, ProjectIndexWatchState>();
  const service = createInProcessReefService({
    projectStoreCache: cache,
    reefEventBatchDebounceMs: 5000,
    reefEventBatchMaxDelayMs: 1000,
    indexRefreshCoordinator: {
      getWatchState: (projectId?: string) => projectId ? watchStates.get(projectId) : undefined,
    },
  });

  try {
    await service.start();

    await assert.rejects(
      () => service.registerProject({ root: path.join(tmp, "missing") }),
      /Project path does not exist/,
    );

    const registered = await service.registerProject({ root: projectRoot });
    assert.equal(registered.status, "active");
    assert.equal(registered.watchEnabled, true);

    const duplicate = await service.registerProject({ root: projectRoot });
    assert.equal(duplicate.projectId, registered.projectId);

    const projects = await service.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0]?.projectId, registered.projectId);

    const initialStatus = await service.getProjectStatus(registered.projectId);
    assert.equal(initialStatus.serviceMode, "in_process");
    assert.equal(initialStatus.analysis.revisionState, "active");
    assert.equal(initialStatus.analysis.currentRevision, 0);
    assert.equal(initialStatus.analysis.pendingChangeSets, 0);
    assert.equal(initialStatus.watcher.recrawlCount, 0);
    assert.ok(initialStatus.analysis.hostId);

    const initialAudits = await service.listOperations({
      projectId: registered.projectId,
      kind: "audit_result",
      limit: 10,
    });
    assert.ok(initialAudits.some((operation) => operation.data?.result === "missing"));

    const duplicateStatus = await service.getProjectStatus(registered.projectId);
    assert.equal(duplicateStatus.analysis.hostId, initialStatus.analysis.hostId);
    const repeatedAudits = await service.listOperations({
      projectId: registered.projectId,
      kind: "audit_result",
      limit: 10,
    });
    assert.equal(repeatedAudits.length, initialAudits.length);

    watchStates.set(registered.projectId, {
      mode: "watch",
      status: "dirty",
      projectId: registered.projectId,
      projectRoot,
      dirtyPaths: ["src/index.ts"],
      lastEventAt: "2026-04-26T00:00:00.000Z",
      lastCatchUpAt: "2026-04-26T00:00:01.000Z",
      lastCatchUpStatus: "succeeded",
      lastCatchUpMethod: "watcher_cookie",
      lastCatchUpDurationMs: 4,
      lastCatchUpReason: "reef-service-boundary-smoke",
    });
    const dirtyStatus = await service.getProjectStatus(registered.projectId);
    assert.equal(dirtyStatus.state, "dirty");
    assert.equal(dirtyStatus.watcher.active, true);
    assert.equal(dirtyStatus.watcher.dirtyPathCount, 1);
    assert.equal(dirtyStatus.watcher.lastCatchUpStatus, "succeeded");
    assert.equal(dirtyStatus.watcher.lastCatchUpMethod, "watcher_cookie");
    assert.equal(dirtyStatus.watcher.lastCatchUpDurationMs, 4);
    assert.equal(dirtyStatus.watcher.lastCatchUpReason, "reef-service-boundary-smoke");
    assert.equal(dirtyStatus.writerQueue.queued, 1);
    assert.equal(dirtyStatus.writerQueue.activeKind, "refresh");

    watchStates.set(registered.projectId, {
      mode: "watch",
      status: "failed",
      projectId: registered.projectId,
      projectRoot,
      dirtyPaths: [],
      lastError: "watcher failed",
    });
    const failedStatus = await service.getProjectStatus(registered.projectId);
    assert.equal(failedStatus.state, "error");
    assert.equal(failedStatus.watcher.active, false);
    assert.equal(failedStatus.watcher.degraded, true);
    assert.equal(failedStatus.watcher.lastError, "watcher failed");

    watchStates.clear();
    const refresh = await service.requestRefresh({
      projectId: registered.projectId,
      reason: "reef_service_smoke",
    });
    assert.equal(refresh.state, "completed");
    assert.ok(refresh.operationId);
    assert.equal(refresh.appliedRevision, 1);

    const refreshedStatus = await service.getProjectStatus(registered.projectId);
    assert.equal(refreshedStatus.analysis.currentRevision, 1);
    assert.equal(refreshedStatus.analysis.materializedRevision, 1);
    assert.ok(refreshedStatus.analysis.lastAppliedChangeSetId);
    assert.ok(refreshedStatus.freshness.indexedFiles >= 1);
    assert.equal(refreshedStatus.writerQueue.lastRunTrigger, "reef_service_smoke");
    assert.equal(refreshedStatus.writerQueue.lastRunResult, "succeeded");

    const operations = await service.listOperations({ projectId: registered.projectId, limit: 50 });
    assert.ok(operations.some((operation) => operation.kind === "project_registry"));
    assert.ok(operations.some((operation) => operation.kind === "change_set_created"));
    assert.ok(operations.some((operation) => operation.kind === "change_set_applied"));
    assert.ok(operations.some((operation) => operation.kind === "refresh_completed"));
    const changeSetOperations = await service.listOperations({
      projectId: registered.projectId,
      kind: "change_set_applied",
      limit: 10,
    });
    assert.equal(changeSetOperations.every((operation) => operation.kind === "change_set_applied"), true);

    writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-service-smoke", changed: true }));
    const configRefresh = await service.requestRefresh({
      projectId: registered.projectId,
      paths: ["package.json"],
      reason: "graph_sensitive_smoke",
    });
    assert.equal(configRefresh.state, "completed");
    assert.equal(configRefresh.refreshMode, "full");
    assert.match(configRefresh.fallbackReason ?? "", /graph-sensitive path changed/);
    assert.equal(configRefresh.appliedRevision, 2);

    const thresholdRefresh = await service.requestRefresh({
      projectId: registered.projectId,
      paths: Array.from({ length: 501 }, (_value, index) => `src/missing-${index}.ts`),
      reason: "dirty_threshold_smoke",
    });
    assert.equal(thresholdRefresh.state, "completed");
    assert.equal(thresholdRefresh.refreshMode, "full");
    assert.match(thresholdRefresh.fallbackReason ?? "", /dirty path threshold exceeded/);
    assert.equal(thresholdRefresh.appliedRevision, 3);

    const fallbackOperations = await service.listOperations({
      projectId: registered.projectId,
      kind: "fallback_used",
      limit: 10,
    });
    assert.ok(fallbackOperations.some((operation) => {
      const reason = operation.data?.reason;
      return typeof reason === "string" && reason.includes("dirty path threshold exceeded");
    }));

    writeFileSync(path.join(projectRoot, "src", "batched-a.ts"), "export const batchedA = 1;\n");
    writeFileSync(path.join(projectRoot, "src", "batched-b.ts"), "export const batchedB = 2;\n");
    const batchObservedAt = new Date().toISOString();
    await service.submitEvent(fileEvent({
      eventId: "reef_event_batch_a",
      projectId: registered.projectId,
      root: projectRoot,
      path: "src/batched-a.ts",
      observedAt: batchObservedAt,
    }));
    await service.submitEvent(fileEvent({
      eventId: "reef_event_batch_b",
      projectId: registered.projectId,
      root: projectRoot,
      path: "src/batched-b.ts",
      observedAt: batchObservedAt,
    }));

    const pendingBatchStatus = await service.getProjectStatus(registered.projectId);
    assert.equal(pendingBatchStatus.analysis.currentRevision, 3);
    assert.ok((pendingBatchStatus.analysis.pendingChangeSets ?? 0) >= 1);
    assert.ok(pendingBatchStatus.writerQueue.queued >= 1);

    await waitFor(async () => {
      const status = await service.getProjectStatus(registered.projectId);
      return status.analysis.materializedRevision === 4;
    }, "batched submitEvent change set did not materialize");

    const batchedStatus = await service.getProjectStatus(registered.projectId);
    assert.equal(batchedStatus.analysis.currentRevision, 4);
    assert.equal(batchedStatus.analysis.materializedRevision, 4);
    assert.equal(batchedStatus.writerQueue.lastRunTrigger, "event_batch:max_delay");
    const createdChangeSets = await service.listOperations({
      projectId: registered.projectId,
      kind: "change_set_created",
      limit: 20,
    });
    assert.ok(createdChangeSets.some((operation) => {
      const source = operation.data?.source;
      const causeCount = operation.data?.causeCount;
      return source === "submitEvent:max_delay" && causeCount === 2;
    }));

    await service.submitEvent(fileEvent({
      eventId: "reef_event_ignored_generated",
      projectId: registered.projectId,
      root: projectRoot,
      path: "src/generated/ignored.generated.ts",
      observedAt: new Date().toISOString(),
    }));
    const ignoredStatus = await service.getProjectStatus(registered.projectId);
    assert.equal(ignoredStatus.analysis.currentRevision, 4);

    writeFileSync(path.join(projectRoot, "src", "superseded-a.ts"), "export const supersededA = 1;\n");
    let firstSupersededRefresh: Promise<Awaited<ReturnType<typeof service.requestRefresh>>>;
    let secondSupersededRefresh: Promise<Awaited<ReturnType<typeof service.requestRefresh>>>;
    await withReefRootWriterLock({
      projectId: registered.projectId,
      canonicalRoot: registered.canonicalRoot,
      analysisHostId: "reef-service-boundary-smoke",
    }, async () => {
      firstSupersededRefresh = service.requestRefresh({
        projectId: registered.projectId,
        paths: ["src/superseded-a.ts"],
        reason: "reef_service_boundary_superseded_first",
      });
      await waitFor(async () => {
        const status = await service.getProjectStatus(registered.projectId);
        return status.analysis.currentRevision === 5;
      }, "first superseded refresh did not apply a change set");

      writeFileSync(path.join(projectRoot, "src", "superseded-b.ts"), "export const supersededB = 2;\n");
      secondSupersededRefresh = service.requestRefresh({
        projectId: registered.projectId,
        paths: ["src/superseded-b.ts"],
        reason: "reef_service_boundary_superseded_second",
      });
      await waitFor(async () => {
        const status = await service.getProjectStatus(registered.projectId);
        return status.analysis.currentRevision === 6;
      }, "second superseded refresh did not apply a change set");
    });

    const firstSupersededResult = await firstSupersededRefresh!;
    const secondSupersededResult = await secondSupersededRefresh!;
    assert.equal(firstSupersededResult.state, "completed");
    assert.equal(firstSupersededResult.appliedRevision, 5);
    assert.equal(secondSupersededResult.state, "completed");
    assert.equal(secondSupersededResult.appliedRevision, 6);

    const supersededStatus = await service.getProjectStatus(registered.projectId);
    assert.equal(supersededStatus.analysis.currentRevision, 6);
    assert.equal(supersededStatus.analysis.materializedRevision, 6);
    assert.equal(supersededStatus.writerQueue.lastRunResult, "succeeded");

    const restartedService = createInProcessReefService({
      projectStoreCache: cache,
    });
    try {
      await restartedService.start();
      const restartedStatus = await restartedService.getProjectStatus(registered.projectId);
      assert.equal(restartedStatus.analysis.currentRevision, 6);
      assert.equal(restartedStatus.analysis.materializedRevision, 6);
      const restartAudits = await restartedService.listOperations({
        projectId: registered.projectId,
        kind: "audit_result",
        limit: 10,
      });
      assert.ok(restartAudits.some((operation) => {
        return operation.data?.result === "usable"
          && operation.data?.currentRevision === 6
          && operation.data?.materializedRevision === 6;
      }));
    } finally {
      await restartedService.stop();
    }

    const metadataOnlyMtime = new Date(Date.now() + 60_000);
    utimesSync(path.join(projectRoot, "src", "index.ts"), metadataOnlyMtime, metadataOnlyMtime);
    const metadataAuditService = createInProcessReefService({
      projectStoreCache: cache,
    });
    try {
      await metadataAuditService.start();
      const metadataAuditedStatus = await metadataAuditService.getProjectStatus(registered.projectId);
      assert.equal(metadataAuditedStatus.analysis.currentRevision, 6);
      assert.equal(metadataAuditedStatus.analysis.materializedRevision, 6);
      const metadataAudits = await metadataAuditService.listOperations({
        projectId: registered.projectId,
        kind: "audit_result",
        limit: 20,
      });
      assert.ok(metadataAudits.some((operation) => {
        return operation.data?.audit === "startup_freshness"
          && operation.data?.result === "clean";
      }));
    } finally {
      await metadataAuditService.stop();
    }

    writeFileSync(path.join(projectRoot, "src", "audit-added.ts"), "export const auditAdded = true;\n");
    const catchUpCalls: ProjectIndexWatchCatchUpResult[] = [];
    const auditService = createInProcessReefService({
      projectStoreCache: cache,
      indexRefreshCoordinator: {
        getWatchState: (projectId?: string) => projectId ? watchStates.get(projectId) : undefined,
        waitForCatchUp: async (_projectId, options) => {
          const now = new Date().toISOString();
          const result: ProjectIndexWatchCatchUpResult = {
            status: "succeeded",
            method: "watcher_cookie",
            startedAt: now,
            finishedAt: now,
            durationMs: 3,
            maxWaitMs: options?.maxWaitMs ?? 0,
            reason: options?.reason ?? "reef-service-boundary-smoke",
            cookiePath: ".mako-reef-watch-cookie-smoke.tmp",
          };
          catchUpCalls.push(result);
          return result;
        },
      },
    });
    try {
      await auditService.start();
      const auditedStatus = await auditService.getProjectStatus(registered.projectId);
      assert.equal(auditedStatus.analysis.currentRevision, 7);
      assert.equal(auditedStatus.analysis.materializedRevision, 7);
      const auditOperations = await auditService.listOperations({
        projectId: registered.projectId,
        kind: "audit_result",
        limit: 20,
      });
      assert.ok(auditOperations.some((operation) => {
        return operation.data?.audit === "startup_freshness"
          && operation.data?.result === "drift"
          && operation.data?.addedPathCount === 1
          && Array.isArray(operation.data?.addedPaths)
          && operation.data.addedPaths.includes("src/audit-added.ts");
      }));
      const auditChangeSets = await auditService.listOperations({
        projectId: registered.projectId,
        kind: "change_set_created",
        limit: 20,
      });
      assert.ok(auditChangeSets.some((operation) => {
        return operation.data?.source === "submitEvent:debounce"
          && operation.data?.causeCount === 1;
      }));

      const latestQuery = await auditService.query<Record<string, unknown>, ReefChangeSetsQueryOutput>({
        projectId: registered.projectId,
        kind: "reef.change_sets",
        freshnessPolicy: "require_fresh",
        snapshot: "latest",
        input: {
          limit: 20,
          includeFileChanges: true,
        },
      });
      assert.equal(latestQuery.snapshot.behavior, "latest");
      assert.equal(latestQuery.snapshot.revision, 7);
      assert.equal(latestQuery.snapshot.latestKnownRevision, 7);
      assert.equal(latestQuery.snapshot.materializedRevision, 7);
      assert.equal(latestQuery.snapshot.state, "fresh");
      assert.ok(latestQuery.changeSets.some((changeSet) => {
        return changeSet.newRevision === 7
          && changeSet.fileChanges?.some((fileChange) => fileChange.path === "src/audit-added.ts");
      }));

      const pinnedQuery = await auditService.query<Record<string, unknown>, ReefChangeSetsQueryOutput>({
        projectId: registered.projectId,
        kind: "reef.change_sets",
        freshnessPolicy: "allow_stale_labeled",
        snapshot: "pinned",
        revision: 6,
        input: {
          limit: 20,
        },
      });
      assert.equal(pinnedQuery.snapshot.behavior, "pinned");
      assert.equal(pinnedQuery.snapshot.revision, 6);
      assert.equal(pinnedQuery.snapshot.latestKnownRevision, 7);
      assert.equal(pinnedQuery.snapshot.stale, true);
      assert.equal(pinnedQuery.snapshot.state, "stale");
      assert.equal(pinnedQuery.changeSets.some((changeSet) => changeSet.newRevision > 6), false);
      await assert.rejects(
        () => auditService.query({
          projectId: registered.projectId,
          kind: "reef.change_sets",
          freshnessPolicy: "allow_stale_labeled",
          snapshot: "pinned",
          revision: 99,
        }),
        /future revision 99/,
      );

      const restartableQuery = await auditService.query<Record<string, unknown>, ReefChangeSetsQueryOutput>({
        projectId: registered.projectId,
        kind: "reef.change_sets",
        freshnessPolicy: "require_fresh",
        snapshot: "restartable",
        input: {
          limit: 5,
        },
      });
      assert.equal(restartableQuery.snapshot.behavior, "restartable");
      assert.equal(restartableQuery.snapshot.revision, 7);
      assert.equal(restartableQuery.snapshot.restarted, false);

      const waitForRefreshQuery = await auditService.query<Record<string, unknown>, ReefChangeSetsQueryOutput>({
        projectId: registered.projectId,
        kind: "reef.change_sets",
        freshnessPolicy: "wait_for_refresh",
        snapshot: "latest",
        input: {
          limit: 5,
        },
      });
      assert.equal(waitForRefreshQuery.snapshot.behavior, "latest");
      assert.equal(catchUpCalls.length, 1);
      assert.equal(catchUpCalls[0]?.status, "succeeded");
      assert.equal(catchUpCalls[0]?.method, "watcher_cookie");

      const queryOperations = await auditService.listOperations({
        projectId: registered.projectId,
        kind: "query_snapshot",
        limit: 20,
      });
      assert.ok(queryOperations.some((operation) => operation.data?.snapshot === "latest"));
      assert.ok(queryOperations.some((operation) => operation.data?.snapshot === "pinned"));
      assert.ok(queryOperations.some((operation) => operation.data?.snapshot === "restartable"));
      assert.ok(queryOperations.some((operation) => {
        return operation.data?.snapshot === "latest"
          && operation.data?.catchUpStatus === "succeeded"
          && operation.data?.catchUpMethod === "watcher_cookie";
      }));
      const catchUpOperations = await auditService.listOperations({
        projectId: registered.projectId,
        kind: "watcher_catch_up",
        limit: 20,
      });
      assert.ok(catchUpOperations.some((operation) => {
        return operation.data?.status === "succeeded"
          && operation.data?.method === "watcher_cookie";
      }));
    } finally {
      await auditService.stop();
    }

    const branchArtifactOutputHash = hashText("ast_symbols:value");
    const branchArtifactKind = "ast_symbols";
    const branchExtractorVersion = "tree-sitter-typescript@smoke";
    const sharedStore = cache.borrow({ projectRoot });
    const artifact = sharedStore.upsertReefArtifact({
      contentHash: branchArtifactOutputHash,
      artifactKind: branchArtifactKind,
      extractorVersion: branchExtractorVersion,
      payload: { symbols: ["value"] },
      metadata: {
        source: "reef-service-boundary-smoke",
        inputContentHash: hashText("export const value = 1;\n"),
      },
    });
    sharedStore.addReefArtifactTag({
      artifactId: artifact.artifactId,
      projectId: registered.projectId,
      root: registered.canonicalRoot,
      branch: "main",
      overlay: "indexed",
      path: "src/index.ts",
    });
    await service.submitEvent({
      eventId: "reef_event_branch_changed",
      projectId: registered.projectId,
      root: projectRoot,
      kind: "reef.git.branch_changed",
      observedAt: new Date().toISOString(),
      data: {
        priorBranch: "main",
        branch: "feature/reuse-artifact",
        triggerSource: "branch_change_smoke",
        flushImmediately: true,
        artifactTags: [{
          path: "src/index.ts",
          contentHash: branchArtifactOutputHash,
          artifactKind: branchArtifactKind,
          extractorVersion: branchExtractorVersion,
        }],
      },
    });
    const featureTags = sharedStore.queryReefArtifactTags({
      projectId: registered.projectId,
      root: registered.canonicalRoot,
      branch: "feature/reuse-artifact",
      overlay: "indexed",
      path: "src/index.ts",
      artifactKind: branchArtifactKind,
      extractorVersion: branchExtractorVersion,
    });
    assert.equal(featureTags.length, 1);
    assert.equal(featureTags[0]?.artifactId, artifact.artifactId);
    const artifactTagOperations = await service.listOperations({
      projectId: registered.projectId,
      kind: "artifact_tag",
      limit: 20,
    });
    assert.ok(artifactTagOperations.some((operation) => {
      return operation.data?.targetBranch === "feature/reuse-artifact"
        && operation.data?.priorBranch === "main"
        && operation.data?.reusedTagCount === 1;
    }));
    await service.submitEvent({
      eventId: "reef_event_branch_bad_candidate",
      projectId: registered.projectId,
      root: projectRoot,
      kind: "reef.git.branch_changed",
      observedAt: new Date().toISOString(),
      data: {
        priorBranch: "main",
        branch: "feature/reject-bad-candidate",
        triggerSource: "branch_bad_candidate_smoke",
        flushImmediately: true,
        artifactTags: [{
          path: "src/not-index.ts",
          contentHash: branchArtifactOutputHash,
          artifactKind: branchArtifactKind,
          extractorVersion: branchExtractorVersion,
        }],
      },
    });
    assert.equal(sharedStore.queryReefArtifactTags({
      projectId: registered.projectId,
      root: registered.canonicalRoot,
      branch: "feature/reject-bad-candidate",
      overlay: "indexed",
      path: "src/not-index.ts",
      artifactKind: branchArtifactKind,
      extractorVersion: branchExtractorVersion,
    }).length, 0);
    const badCandidateOperations = await service.listOperations({
      projectId: registered.projectId,
      kind: "artifact_tag",
      limit: 20,
    });
    assert.ok(badCandidateOperations.some((operation) => {
      return operation.data?.targetBranch === "feature/reject-bad-candidate"
        && operation.data?.missingArtifactCount === 1
        && operation.data?.reusedTagCount === 0;
    }));
    const branchChangeSet = sharedStore.queryReefAppliedChangeSets({
      projectId: registered.projectId,
      root: registered.canonicalRoot,
      limit: 20,
    }).find((record) => record.causes.some((cause) => cause.eventId === "reef_event_branch_changed"));
    assert.equal(branchChangeSet?.refreshMode, "full");
    assert.equal(asRecord(branchChangeSet?.data?.git)?.branch, "feature/reuse-artifact");
    const branchChangeOperations = await service.listOperations({
      projectId: registered.projectId,
      kind: "change_set_created",
      limit: 20,
    });
    assert.ok(branchChangeOperations.some((operation) => {
      return operation.data?.decisionReason === "git branch changed"
        && asRecord(operation.data?.git)?.branch === "feature/reuse-artifact";
    }));

    await service.submitEvent({
      eventId: "reef_event_git_index_changed",
      projectId: registered.projectId,
      root: projectRoot,
      kind: "reef.git.index_changed",
      observedAt: new Date().toISOString(),
      data: {
        gitIndexHash: "git-index-hash-smoke",
        triggerSource: "git_index_smoke",
        flushImmediately: true,
      },
    });
    const gitIndexChangeSet = sharedStore.queryReefAppliedChangeSets({
      projectId: registered.projectId,
      root: registered.canonicalRoot,
      limit: 20,
    }).find((record) => record.causes.some((cause) => cause.eventId === "reef_event_git_index_changed"));
    assert.equal(gitIndexChangeSet?.refreshMode, "full");
    assert.equal(asRecord(gitIndexChangeSet?.data?.git)?.indexHash, "git-index-hash-smoke");
    const gitIndexOperations = await service.listOperations({
      projectId: registered.projectId,
      kind: "change_set_created",
      limit: 20,
    });
    assert.ok(gitIndexOperations.some((operation) => {
      return operation.data?.decisionReason === "git index changed"
        && asRecord(operation.data?.git)?.indexHash === "git-index-hash-smoke";
    }));

    const recrawlStatus = await service.recordWatcherRecrawl({
      projectId: registered.projectId,
      reason: "watcher_recrawl_smoke",
      warning: "simulated kernel event drop",
      repair: "full_refresh",
    });
    assert.equal(recrawlStatus.watcher.recrawlCount, 1);
    assert.equal(recrawlStatus.watcher.lastRecrawlReason, "watcher_recrawl_smoke");
    assert.equal(recrawlStatus.watcher.lastRecrawlWarning, "simulated kernel event drop");
    assert.equal(recrawlStatus.analysis.currentRevision, recrawlStatus.analysis.materializedRevision);
    assert.equal(recrawlStatus.writerQueue.lastRunTrigger, "watcher_recrawl:watcher_recrawl_smoke");
    const recrawlOperations = await service.listOperations({
      projectId: registered.projectId,
      kind: "watcher_recrawl",
      limit: 20,
    });
    assert.ok(recrawlOperations.some((operation) => {
      return operation.data?.reason === "watcher_recrawl_smoke"
        && operation.data?.recrawlCount === 1
        && operation.data?.action === "full_refresh_requested";
    }));
    const recrawlRefreshRequests = await service.listOperations({
      projectId: registered.projectId,
      kind: "refresh_requested",
      limit: 20,
    });
    const recrawlRefreshRequest = recrawlRefreshRequests.find((operation) => {
      return operation.data?.reason === "watcher_recrawl:watcher_recrawl_smoke";
    });
    assert.ok(recrawlRefreshRequest);
    const recrawlChangeSetId = recrawlRefreshRequest.data?.changeSetId;
    assert.equal(typeof recrawlChangeSetId, "string");
    const recrawlChangeSetOperations = await service.listOperations({
      projectId: registered.projectId,
      kind: "change_set_created",
      limit: 20,
    });
    assert.ok(recrawlChangeSetOperations.some((operation) => {
      return operation.data?.changeSetId === recrawlChangeSetId
        && operation.data?.decisionReason === "explicit refresh requested";
    }));
    const recrawlRefreshOperations = await service.listOperations({
      projectId: registered.projectId,
      kind: "refresh_completed",
      limit: 20,
    });
    assert.ok(recrawlRefreshOperations.some((operation) => {
      return operation.data?.changeSetId === recrawlChangeSetId
        && operation.data?.decisionReason === "explicit refresh requested";
    }));
    const secondRecrawlStatus = await service.recordWatcherRecrawl({
      projectId: registered.projectId,
      reason: "watcher_recrawl_no_repair_smoke",
      repair: "none",
    });
    assert.equal(secondRecrawlStatus.watcher.recrawlCount, 2);
    assert.equal(secondRecrawlStatus.watcher.lastRecrawlReason, "watcher_recrawl_no_repair_smoke");

    const api = createApiService({
      projectStoreCache: cache,
      indexRefreshCoordinator: {
        getWatchState: (projectId?: string) => projectId ? watchStates.get(projectId) : undefined,
      },
    });
    try {
      const toolStatus = await api.callTool(
        "project_index_status",
        { projectId: registered.projectId },
      ) as ProjectIndexStatusToolOutput;
      assert.equal(toolStatus.reefStatus?.serviceMode, "in_process");
      assert.equal(toolStatus.reefStatus?.analysis.revisionState, "active");
    } finally {
      api.close();
    }

    await service.unregisterProject(registered.projectId);
    assert.deepEqual(await service.listProjects(), []);

    console.log("reef-service-boundary: PASS");
  } finally {
    await service.stop();
    cache.flush();
    restoreEnv("MAKO_STATE_HOME", originalStateHome);
    restoreEnv("MAKO_STATE_DIRNAME", originalStateDirName);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function fileEvent(args: {
  eventId: string;
  projectId: string;
  root: string;
  path: string;
  observedAt: string;
}): ReefProjectEvent {
  return {
    eventId: args.eventId,
    projectId: args.projectId,
    root: args.root,
    kind: "reef.file.changed",
    paths: [args.path],
    observedAt: args.observedAt,
    data: {
      source: "reef-service-boundary-smoke",
    },
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
