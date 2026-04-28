import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, type Stats } from "node:fs";
import path from "node:path";
import type {
  AttachedProject,
  IndexFreshnessSummary,
  IndexRunStatus,
  JsonObject,
  ProjectFact,
  ProjectOverlay,
  ProjectIndexWatchCatchUpResult,
  ProjectIndexWatchState,
  ReefCalculationExecutionPlan,
  ReefCalculationPlanQueryInput,
  ReefCalculationPlanQueryOutput,
  ReefAnalysisHost,
  ReefChangeSetResult,
  ReefDiagnosticRun,
  ReefDiagnosticSourceKind,
  ReefDiagnosticSourceStatus,
  ReefProjectDiagnosticStatus,
  ReefProjectSchemaStatus,
  ReefOperationKind,
  ReefOperationLogEntry,
  ReefOperationQuery,
  ReefProjectEvent,
  ReefProjectStatus,
  ReefQueryRequest,
  ReefRefreshRequest,
  ReefRefreshResult,
  ReefServiceMode,
  ReefSnapshotBehavior,
  ReefWatcherRecrawlInput,
  ReefWorkspaceChangeSet,
  RegisterProjectInput,
  RegisteredProject,
} from "@mako-ai/contracts";
import {
  REEF_CALCULATION_PLAN_QUERY_KIND,
  REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS,
  REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS,
  ReefCalculationPlanQueryInputSchema,
  ReefProjectEventSchema,
  ReefQueryRequestSchema,
  ReefWatcherRecrawlInputSchema,
  ReefWorkspaceChangeSetSchema,
} from "@mako-ai/contracts";
import type {
  FileSummaryRecord,
  LifecycleEventRecord,
  ProjectStore,
  ReefArtifactTagRecord,
  ReefAnalysisStateRecord,
  ReefAppliedChangeSetRecord,
} from "@mako-ai/store";
import { hashText, ReefStaleBaseRevisionError } from "@mako-ai/store";
import { attachProject } from "./attach.js";
import { detachProject } from "./detach.js";
import { ProjectCommandError } from "./errors.js";
import { collectProjectFilePaths, readTextFile } from "./fs-utils.js";
import { indexProject } from "./index-project.js";
import { refreshProjectPaths } from "./path-refresh.js";
import { isWatchableProjectPath, toProjectIndexRelativePath } from "./project-index-scope.js";
import { getProjectStatus as getIndexerProjectStatus, listAttachedProjects } from "./status.js";
import type { IndexerOptions, ProjectStatusResult } from "./types.js";
import { withGlobalStore, withProjectStore } from "./utils.js";
import { appendReefOperation, readReefOperations } from "./reef-operation-log.js";
import { withReefRootWriterLock } from "./reef-writer-lock.js";
import { createReefIndexerCalculationRegistry } from "./reef-calculation-nodes.js";
import { createReefCalculationExecutionPlan } from "./reef-calculation-executor.js";

export interface ReefWatchStateProvider {
  getWatchState(projectId?: string): ProjectIndexWatchState | undefined;
  waitForCatchUp?(projectId: string, options?: { maxWaitMs?: number; reason?: string }): Promise<ProjectIndexWatchCatchUpResult>;
}

export interface InProcessReefServiceOptions extends IndexerOptions {
  indexRefreshCoordinator?: ReefWatchStateProvider;
  serviceMode?: ReefServiceMode;
  reefEventBatchDebounceMs?: number;
  reefEventBatchMaxDelayMs?: number;
}

interface InProcessAnalysisHostRecord {
  hostId: string;
  projectId: string;
  canonicalRoot: string;
  createdAt: string;
  lastSeenAt: string;
}

interface ReefRootQueueState {
  tail: Promise<unknown>;
  running: boolean;
  queued: number;
  activeKind?: ReefProjectStatus["writerQueue"]["activeKind"];
  lastRunAt?: string;
  lastRunTrigger?: string;
  lastRunResult?: ReefProjectStatus["writerQueue"]["lastRunResult"];
}

interface ReefMaterializationPlan {
  refreshMode: "path_scoped" | "full";
  paths: string[];
  decisionReason: string;
  fallbackReason?: string;
  calculationPlan: ReefCalculationExecutionPlan;
}

interface ReefRootEventBatchState {
  events: ReefProjectEvent[];
  firstEventAt: string;
  lastEventAt: string;
  debounceTimer?: ReturnType<typeof setTimeout>;
  maxDelayTimer?: ReturnType<typeof setTimeout>;
}

interface ReefRootQueryState {
  running: Map<string, ReefRunningQuery>;
  canceledCount: number;
}

interface ReefRunningQuery {
  queryId: string;
  kind: string;
  snapshot: ReefSnapshotBehavior;
  startedAt: string;
  revision: number;
  canceled: boolean;
}

interface ReefResolvedQuerySnapshot {
  queryId: string;
  behavior: ReefSnapshotBehavior;
  revision: number;
  latestKnownRevision: number;
  materializedRevision?: number;
  stale: boolean;
  state: "fresh" | "refreshing" | "stale" | "unknown";
  checkedAt: string;
  restarted: boolean;
}

interface ReefQueryWaitResult {
  queueSettled: boolean;
  catchUp?: ProjectIndexWatchCatchUpResult;
}

interface ReefBranchArtifactCandidate {
  path: string;
  contentHash: string;
  artifactKind?: string;
  extractorVersion?: string;
  overlay?: ProjectOverlay;
  worktree?: string;
}

interface ReefBranchArtifactUpdate {
  fromBranch?: string;
  toBranch: string;
  worktree?: string;
  candidates: ReefBranchArtifactCandidate[];
  skippedCandidateCount: number;
}

interface ReefBranchArtifactTagUpdateResult {
  branchEventCount: number;
  candidateCount: number;
  reusedTagCount: number;
  missingArtifactCount: number;
  skippedCandidateCount: number;
  targetBranch: string;
  priorBranch?: string;
}

interface ReefBranchArtifactMatch {
  artifactId: string;
  overlay: ProjectOverlay;
  worktree?: string;
  lastChangedRevision?: number;
}

interface ReefChangeSetsQueryInput {
  limit?: number;
  sinceRevision?: number;
  includeCauses?: boolean;
  includeFileChanges?: boolean;
}

interface ReefStartupAudit {
  result: "missing" | "usable" | "needs_full_refresh";
  reason: string;
  action: "none" | "full_refresh_recommended";
}

interface ReefStartupFreshnessAudit {
  result: "skipped" | "clean" | "drift";
  reason: string;
  action: "none" | "submitted_events";
  addedPaths: string[];
  deletedPaths: string[];
  changedPaths: string[];
  gitIndexChanged: boolean;
  gitIndexMtime?: string;
  gitIndexHash?: string;
  latestIndexFinishedAt?: string;
}

const REEF_FULL_REFRESH_PATH_THRESHOLD = 500;
const REEF_EVENT_BATCH_DEBOUNCE_MS = 3000;
const REEF_EVENT_BATCH_MAX_DELAY_MS = 60000;
const REEF_QUERY_LATEST_WAIT_MS = 1500;
// Maximum number of times a restartable query may be canceled and retried
// before it errors. The loop runs at most one initial attempt plus this many
// restarts, for `REEF_QUERY_RESTART_MAX + 1` total executions.
const REEF_QUERY_RESTART_MAX = 3;
const REEF_CHANGE_SETS_QUERY_KIND = "reef.change_sets";

export class InProcessReefService implements ReefAnalysisHost {
  private readonly hostsByCanonicalRoot = new Map<string, InProcessAnalysisHostRecord>();
  private readonly queuesByCanonicalRoot = new Map<string, ReefRootQueueState>();
  private readonly eventBatchesByCanonicalRoot = new Map<string, ReefRootEventBatchState>();
  private readonly queriesByCanonicalRoot = new Map<string, ReefRootQueryState>();
  private readonly startupAuditedCanonicalRoots = new Set<string>();
  private hostSequence = 0;
  private started = false;

  constructor(private readonly options: InProcessReefServiceOptions = {}) {}

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.hostsByCanonicalRoot.clear();
    this.queuesByCanonicalRoot.clear();
    this.queriesByCanonicalRoot.clear();
    this.clearEventBatches();
    this.startupAuditedCanonicalRoots.clear();
  }

  async registerProject(input: RegisterProjectInput): Promise<RegisteredProject> {
    this.ensureStarted();
    const attached = attachProject(input.root, this.options);
    this.ensureHost(attached.project);
    await this.ensureAnalysisStateWithStartupAudit(attached.project);
    return toRegisteredProject(attached.project, input.watchEnabled);
  }

  async unregisterProject(projectId: string): Promise<void> {
    this.ensureStarted();
    const result = detachProject(projectId, this.options);
    this.hostsByCanonicalRoot.delete(result.project.canonicalPath);
  }

  async listProjects(): Promise<RegisteredProject[]> {
    this.ensureStarted();
    const registered: RegisteredProject[] = [];
    for (const project of listAttachedProjects(this.options)) {
      this.ensureHost(project);
      await this.ensureAnalysisStateWithStartupAudit(project);
      registered.push(toRegisteredProject(project));
    }
    return registered;
  }

  async getProjectStatus(projectId: string): Promise<ReefProjectStatus> {
    this.ensureStarted();
    const status = getIndexerProjectStatus(projectId, this.options);
    if (!status?.project) {
      throw new ProjectCommandError(404, "project_not_attached", `No attached project found for: ${projectId}`, {
        projectId,
      });
    }

    const project = status.project;
    const host = this.ensureHost(project);
    const analysisState = await this.ensureAnalysisStateWithStartupAudit(project);
    const queueState = this.queuesByCanonicalRoot.get(project.canonicalPath);
    const eventBatchState = this.eventBatchesByCanonicalRoot.get(project.canonicalPath);
    const queryState = this.queriesByCanonicalRoot.get(project.canonicalPath);
    const watch = this.options.indexRefreshCoordinator?.getWatchState(project.projectId);
    const diagnostics = this.withProjectStore(project, (projectStore) =>
      buildReefProjectDiagnosticStatus(projectStore, project, analysisState)
    );
    const schema = buildReefProjectSchemaStatus(status);
    return toReefProjectStatus(
      status,
      watch,
      host.hostId,
      this.options.serviceMode ?? "in_process",
      analysisState,
      queueState,
      eventBatchState,
      queryState,
      diagnostics,
      schema,
    );
  }

  async listProjectStatuses(): Promise<ReefProjectStatus[]> {
    this.ensureStarted();
    const projects = listAttachedProjects(this.options);
    const statuses: ReefProjectStatus[] = [];
    for (const project of projects) {
      statuses.push(await this.getProjectStatus(project.projectId));
    }
    return statuses;
  }

  async requestRefresh(input: ReefRefreshRequest): Promise<ReefRefreshResult> {
    this.ensureStarted();
    const status = getIndexerProjectStatus(input.projectId, this.options);
    if (!status?.project) {
      throw new ProjectCommandError(404, "project_not_attached", `No attached project found for: ${input.projectId}`, {
        projectId: input.projectId,
      });
    }

    await this.ensureAnalysisStateWithStartupAudit(status.project);
    try {
      const changeSet = this.createRefreshChangeSet(status.project, input);
      await this.logRefreshRequested(status.project, input, changeSet);
      await this.logChangeSetCreated(changeSet, "requestRefresh");
      const changeSetResult = await this.applyChangeSet(changeSet);
      const plan = materializationPlanForChangeSet(changeSet);
      return await this.enqueueRefreshMaterialization(status.project, input.reason, changeSet, changeSetResult, plan);
    } catch (error) {
      return {
        projectId: status.project.projectId,
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async recordWatcherRecrawl(input: ReefWatcherRecrawlInput): Promise<ReefProjectStatus> {
    this.ensureStarted();
    const parsed = ReefWatcherRecrawlInputSchema.parse(input);
    const status = getIndexerProjectStatus(parsed.projectId, this.options);
    if (!status?.project) {
      throw new ProjectCommandError(404, "project_not_attached", `No attached project found for: ${parsed.projectId}`, {
        projectId: parsed.projectId,
      });
    }
    const project = status.project;

    await this.ensureAnalysisStateWithStartupAudit(project);
    const recrawlState = this.withProjectStore(project, (projectStore) =>
      projectStore.recordReefWatcherRecrawl({
        projectId: project.projectId,
        root: project.canonicalPath,
        reason: parsed.reason,
        ...(parsed.warning ? { warning: parsed.warning } : {}),
        ...(parsed.observedAt ? { observedAt: parsed.observedAt } : {}),
      }),
    );
    const repair = parsed.repair ?? "full_refresh";
    await appendReefOperation(this.options, {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "watcher_recrawl",
      severity: "warning",
      message: "reef watcher recrawl recorded",
      data: {
        reason: parsed.reason,
        recrawlCount: recrawlState.watcherRecrawlCount,
        action: repair === "full_refresh" ? "full_refresh_requested" : "none",
        ...(parsed.warning ? { warning: parsed.warning } : {}),
      },
    });

    if (repair === "full_refresh") {
      const repairResult = await this.requestRefresh({
        projectId: project.projectId,
        reason: `watcher_recrawl:${parsed.reason}`,
      });
      if (repairResult.state === "failed") {
        await appendReefOperation(this.options, {
          projectId: project.projectId,
          root: project.canonicalPath,
          kind: "degraded_state",
          severity: "error",
          message: "reef watcher recrawl repair refresh failed",
          data: {
            reason: parsed.reason,
            recrawlCount: recrawlState.watcherRecrawlCount,
            error: repairResult.message ?? "watcher recrawl repair refresh failed",
          },
        });
      }
    }

    return this.getProjectStatus(project.projectId);
  }

  async submitEvent(event: ReefProjectEvent): Promise<void> {
    this.ensureStarted();
    const parsed = ReefProjectEventSchema.parse(event);
    const status = getIndexerProjectStatus(parsed.projectId, this.options);
    if (!status?.project) {
      throw new ProjectCommandError(404, "project_not_attached", `No attached project found for: ${parsed.projectId}`, {
        projectId: parsed.projectId,
      });
    }
    await this.ensureAnalysisStateWithStartupAudit(status.project);
    const normalized = normalizeEventForProject(status.project, parsed);
    await appendReefOperation(this.options, {
      projectId: parsed.projectId,
      root: status.project.canonicalPath,
      kind: parsed.kind.startsWith("reef.file.") ? "watcher_event" : "refresh_requested",
      message: `reef event submitted: ${parsed.kind}`,
      data: {
        eventId: parsed.eventId,
        kind: parsed.kind,
        pathCount: normalized?.paths?.length ?? 0,
      },
    });

    if (!normalized) {
      await appendReefOperation(this.options, {
        projectId: parsed.projectId,
        root: status.project.canonicalPath,
        kind: "refresh_decision",
        message: "reef event ignored before batching",
        data: {
          eventId: parsed.eventId,
          kind: parsed.kind,
          reason: "no watchable paths remained after normalization",
        },
      });
      return;
    }

    await this.enqueueEventForBatch(status.project, normalized);
  }

  async applyChangeSet(changeSet: ReefWorkspaceChangeSet): Promise<ReefChangeSetResult> {
    this.ensureStarted();
    const parsed = ReefWorkspaceChangeSetSchema.parse(changeSet);
    const status = getIndexerProjectStatus(parsed.projectId, this.options);
    if (!status?.project) {
      throw new ProjectCommandError(404, "project_not_attached", `No attached project found for: ${parsed.projectId}`, {
        projectId: parsed.projectId,
      });
    }
    this.ensureHost(status.project);
    await this.ensureAnalysisStateWithStartupAudit(status.project);
    const plan = materializationPlanForChangeSet(parsed);
    let applied: ReefAppliedChangeSetRecord;
    try {
      applied = this.withProjectStore(status.project, (projectStore) =>
        projectStore.applyReefChangeSet({
          changeSet: parsed,
          refreshMode: plan.refreshMode,
          ...(plan.fallbackReason ? { fallbackReason: plan.fallbackReason } : {}),
        }),
      );
    } catch (error) {
      if (error instanceof ReefStaleBaseRevisionError) {
        throw new ProjectCommandError(
          409,
          "stale_base_revision",
          error.message,
          {
            projectId: parsed.projectId,
            changeSetId: parsed.changeSetId,
            attempts: error.attempts,
          },
        );
      }
      throw error;
    }
    const canceledQueryIds = this.cancelRestartableQueries(status.project.canonicalPath, applied.newRevision);
    await appendReefOperation(this.options, {
      projectId: parsed.projectId,
      root: parsed.root,
      kind: "change_set_applied",
      message: "reef change set applied",
      data: {
        changeSetId: applied.changeSetId,
        baseRevision: applied.baseRevision,
        newRevision: applied.newRevision,
        generation: applied.generation,
        causeCount: applied.causeCount,
        fileChangeCount: applied.fileChangeCount,
        refreshMode: plan.refreshMode,
        decisionReason: plan.decisionReason,
        calculationAffectedNodeCount: plan.calculationPlan.affectedNodes.length,
        calculationAffectedNodeIds: plan.calculationPlan.affectedNodes.map((node) => node.nodeId),
        calculationInputDependencyKeys: plan.calculationPlan.inputDependencyKeys,
        canceledQueryCount: canceledQueryIds.length,
        ...(plan.fallbackReason ? { fallbackReason: plan.fallbackReason } : {}),
      },
    });
    await appendReefOperation(this.options, {
      projectId: parsed.projectId,
      root: parsed.root,
      kind: "calculation_executor",
      message: "reef calculation executor planned change set",
      data: {
        changeSetId: applied.changeSetId,
        revision: applied.newRevision,
        refreshMode: plan.calculationPlan.refreshMode,
        decisionReason: plan.calculationPlan.decisionReason,
        affectedNodeCount: plan.calculationPlan.affectedNodes.length,
        affectedNodeIds: plan.calculationPlan.affectedNodes.map((node) => node.nodeId),
        inputDependencyKeys: plan.calculationPlan.inputDependencyKeys,
        changedPaths: plan.calculationPlan.changedPaths.slice(0, 100),
        ...(plan.calculationPlan.fallbackReason ? { fallbackReason: plan.calculationPlan.fallbackReason } : {}),
      },
    });
    await this.updateArtifactTagsForBranchChange(status.project, parsed, applied);
    return {
      changeSetId: applied.changeSetId,
      baseRevision: applied.baseRevision,
      newRevision: applied.newRevision,
      appliedAt: applied.appliedAt,
      canceledQueryIds,
    };
  }

  async query<TInput, TOutput>(request: ReefQueryRequest<TInput>): Promise<TOutput> {
    this.ensureStarted();
    const parsed = ReefQueryRequestSchema.parse(request) as ReefQueryRequest<TInput>;
    const status = getIndexerProjectStatus(parsed.projectId, this.options);
    if (!status?.project) {
      throw new ProjectCommandError(404, "project_not_attached", `No attached project found for: ${parsed.projectId}`, {
        projectId: parsed.projectId,
      });
    }
    this.ensureHost(status.project);
    const state = await this.ensureAnalysisStateWithStartupAudit(status.project);
    if (parsed.kind !== REEF_CHANGE_SETS_QUERY_KIND && parsed.kind !== REEF_CALCULATION_PLAN_QUERY_KIND) {
      throw new Error(`Unsupported ReefService.query kind: ${parsed.kind}`);
    }

    const runningQuery = this.registerRunningQuery(status.project, parsed, state);
    try {
      let restarted = false;
      for (let attempt = 0; attempt <= REEF_QUERY_RESTART_MAX; attempt += 1) {
        runningQuery.canceled = false;
        const result = parsed.kind === REEF_CALCULATION_PLAN_QUERY_KIND
          ? await this.executeCalculationPlanQuery(status.project, parsed, runningQuery, restarted)
          : await this.executeChangeSetsQuery(status.project, parsed, runningQuery, restarted);
        if (parsed.snapshot !== "restartable" || !runningQuery.canceled) {
          return result as TOutput;
        }
        restarted = true;
      }
      throw new ProjectCommandError(
        503,
        "query_restart_exhausted",
        `Reef query ${parsed.kind} was restarted more than ${REEF_QUERY_RESTART_MAX} times while changes were arriving.`,
        {
          projectId: parsed.projectId,
          kind: parsed.kind,
          maxRestarts: REEF_QUERY_RESTART_MAX,
        },
      );
    } finally {
      this.unregisterRunningQuery(status.project, runningQuery.queryId);
    }
  }

  async listOperations(input: ReefOperationQuery = {}): Promise<ReefOperationLogEntry[]> {
    this.ensureStarted();
    const limit = input.limit ?? 50;
    const lifecycleOperations = withGlobalStore(this.options, ({ config, globalStore }) => {
      const projects = input.projectId
        ? [globalStore.getProjectById(input.projectId, { includeDetached: true })].filter(
          (project): project is AttachedProject => project !== null,
        )
        : globalStore.listProjects();

      const operations: ReefOperationLogEntry[] = [];
      for (const project of projects) {
        withProjectStore(project.canonicalPath, config, (projectStore) => {
          const events = projectStore.queryLifecycleEvents({ limit });
          operations.push(...events.map((event) => lifecycleEventToOperation(project, event)));
          const diagnosticRuns = projectStore.queryReefDiagnosticRuns({
            projectId: project.projectId,
            limit,
          });
          operations.push(...diagnosticRuns.map((run) => diagnosticRunToOperation(project, run)));
        }, this.options);
      }

      return operations
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit);
    });
    const daemonOperations = await readReefOperations(this.options, input);
    return filterOperations([...daemonOperations, ...lifecycleOperations], input)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async *subscribe(_projectId: string): AsyncIterable<never> {}

  private registerRunningQuery(
    project: AttachedProject,
    request: ReefQueryRequest<unknown>,
    state: ReefAnalysisStateRecord,
  ): ReefRunningQuery {
    const query: ReefRunningQuery = {
      queryId: `reef_query_${randomUUID()}`,
      kind: request.kind,
      snapshot: request.snapshot,
      startedAt: new Date().toISOString(),
      revision: state.currentRevision,
      canceled: false,
    };
    this.queryStateFor(project.canonicalPath).running.set(query.queryId, query);
    return query;
  }

  private unregisterRunningQuery(project: AttachedProject, queryId: string): void {
    const queryState = this.queriesByCanonicalRoot.get(project.canonicalPath);
    queryState?.running.delete(queryId);
  }

  private cancelRestartableQueries(canonicalRoot: string, newRevision: number): string[] {
    const queryState = this.queriesByCanonicalRoot.get(canonicalRoot);
    if (!queryState) {
      return [];
    }

    const canceled: string[] = [];
    for (const query of queryState.running.values()) {
      if (query.snapshot !== "restartable" || query.revision >= newRevision) {
        continue;
      }
      query.canceled = true;
      canceled.push(query.queryId);
    }
    queryState.canceledCount += canceled.length;
    return canceled;
  }

  private async executeChangeSetsQuery(
    project: AttachedProject,
    request: ReefQueryRequest<unknown>,
    runningQuery: ReefRunningQuery,
    restarted: boolean,
  ): Promise<unknown> {
    const waitResult = await this.waitForLatestQuerySnapshot(project, request);
    const snapshot = this.resolveQuerySnapshot(project, request, runningQuery.queryId, restarted);
    runningQuery.revision = snapshot.revision;
    const input = normalizeChangeSetsQueryInput(request.input);
    const changeSets = this.withProjectStore(project, (projectStore) =>
      projectStore.queryReefAppliedChangeSets({
        projectId: project.projectId,
        root: project.canonicalPath,
        maxRevision: snapshot.revision,
        limit: 500,
      }),
    )
      .filter((record) => input.sinceRevision == null || record.newRevision > input.sinceRevision)
      .slice(0, input.limit)
      .map((record) => changeSetRecordForQuery(record, input));

    await appendReefOperation(this.options, {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "query_snapshot",
      message: "reef query snapshot resolved",
      data: {
        queryId: snapshot.queryId,
        kind: request.kind,
        snapshot: snapshot.behavior,
        revision: snapshot.revision,
        latestKnownRevision: snapshot.latestKnownRevision,
        materializedRevision: snapshot.materializedRevision ?? null,
        state: snapshot.state,
        stale: snapshot.stale,
        restarted: snapshot.restarted,
        waitedForRefresh: waitResult.queueSettled || waitResult.catchUp?.status === "succeeded",
        queueSettled: waitResult.queueSettled,
        ...(waitResult.catchUp
          ? {
            catchUpStatus: waitResult.catchUp.status,
            catchUpMethod: waitResult.catchUp.method,
            catchUpDurationMs: waitResult.catchUp.durationMs,
            catchUpMaxWaitMs: waitResult.catchUp.maxWaitMs,
            catchUpReason: waitResult.catchUp.reason,
            ...(waitResult.catchUp.error ? { catchUpError: waitResult.catchUp.error } : {}),
          }
          : {}),
        resultCount: changeSets.length,
      },
    });

    return {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: request.kind,
      snapshot,
      changeSets,
    };
  }

  private async executeCalculationPlanQuery(
    project: AttachedProject,
    request: ReefQueryRequest<unknown>,
    runningQuery: ReefRunningQuery,
    restarted: boolean,
  ): Promise<ReefCalculationPlanQueryOutput> {
    const waitResult = await this.waitForLatestQuerySnapshot(project, request);
    const snapshot = this.resolveQuerySnapshot(project, request, runningQuery.queryId, restarted);
    runningQuery.revision = snapshot.revision;
    const input = normalizeCalculationPlanQueryInput(request.input, project);
    const changeSet = input.changeSet ?? this.loadChangeSetForCalculationPlan(project, input.changeSetId, snapshot.revision);
    const plan = materializationPlanForChangeSet(changeSet).calculationPlan;

    await appendReefOperation(this.options, {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "query_snapshot",
      message: "reef calculation plan query snapshot resolved",
      data: {
        queryId: snapshot.queryId,
        kind: request.kind,
        snapshot: snapshot.behavior,
        revision: snapshot.revision,
        latestKnownRevision: snapshot.latestKnownRevision,
        materializedRevision: snapshot.materializedRevision ?? null,
        state: snapshot.state,
        stale: snapshot.stale,
        restarted: snapshot.restarted,
        waitedForRefresh: waitResult.queueSettled || waitResult.catchUp?.status === "succeeded",
        queueSettled: waitResult.queueSettled,
        changeSetId: changeSet.changeSetId,
        affectedNodeCount: plan.affectedNodes.length,
      },
    });

    return {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: REEF_CALCULATION_PLAN_QUERY_KIND,
      plan,
    };
  }

  private loadChangeSetForCalculationPlan(
    project: AttachedProject,
    changeSetId: string | undefined,
    revision: number,
  ): ReefWorkspaceChangeSet {
    const records = this.withProjectStore(project, (projectStore) =>
      projectStore.queryReefAppliedChangeSets({
        projectId: project.projectId,
        root: project.canonicalPath,
        ...(changeSetId ? { changeSetId } : {}),
        maxRevision: revision,
        limit: 1,
      }),
    );
    const record = records[0];
    if (!record) {
      throw new Error(changeSetId
        ? `Reef calculation plan could not find change set ${changeSetId} at revision ${revision}.`
        : "Reef calculation plan requires a change set, but no applied change set was found.");
    }
    return {
      changeSetId: record.changeSetId,
      projectId: record.projectId,
      root: record.root,
      observedAt: record.observedAt,
      baseRevision: record.baseRevision,
      causes: record.causes,
      fileChanges: record.fileChanges,
    };
  }

  private async waitForLatestQuerySnapshot(
    project: AttachedProject,
    request: ReefQueryRequest<unknown>,
  ): Promise<ReefQueryWaitResult> {
    if (request.snapshot === "pinned") {
      return { queueSettled: false };
    }

    const catchUp = request.freshnessPolicy === "wait_for_refresh"
      ? await this.waitForWatcherCatchUp(project, request)
      : undefined;

    if (catchUp) {
      await appendReefOperation(this.options, {
        projectId: project.projectId,
        root: project.canonicalPath,
        kind: "watcher_catch_up",
        severity: catchUp.status === "succeeded" ? "info" : catchUp.status === "timed_out" ? "warning" : "info",
        message: "reef watcher catch-up barrier completed",
        data: {
          kind: request.kind,
          snapshot: request.snapshot,
          status: catchUp.status,
          method: catchUp.method,
          durationMs: catchUp.durationMs,
          maxWaitMs: catchUp.maxWaitMs,
          reason: catchUp.reason,
          ...(catchUp.cookiePath ? { cookiePath: catchUp.cookiePath } : {}),
          ...(catchUp.error ? { error: catchUp.error } : {}),
        },
      });
    }

    const queue = this.queuesByCanonicalRoot.get(project.canonicalPath);
    if (!queue || (!queue.running && queue.queued === 0)) {
      return { queueSettled: false, ...(catchUp ? { catchUp } : {}) };
    }

    const settled = await promiseSettledWithin(queue.tail, REEF_QUERY_LATEST_WAIT_MS);
    if (!settled && request.freshnessPolicy === "require_fresh") {
      throw new Error(`Reef query ${request.kind} could not resolve a fresh latest snapshot within ${REEF_QUERY_LATEST_WAIT_MS}ms.`);
    }
    return { queueSettled: settled, ...(catchUp ? { catchUp } : {}) };
  }

  private async waitForWatcherCatchUp(
    project: AttachedProject,
    request: ReefQueryRequest<unknown>,
  ): Promise<ProjectIndexWatchCatchUpResult> {
    const provider = this.options.indexRefreshCoordinator;
    if (!provider?.waitForCatchUp) {
      const now = new Date().toISOString();
      return {
        status: "skipped",
        method: "none",
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        maxWaitMs: 0,
        reason: "watcher catch-up provider is unavailable",
      };
    }
    return provider.waitForCatchUp(project.projectId, {
      maxWaitMs: 750,
      reason: `reef query ${request.kind} wait_for_refresh`,
    });
  }

  private resolveQuerySnapshot(
    project: AttachedProject,
    request: ReefQueryRequest<unknown>,
    queryId: string,
    restarted: boolean,
  ): ReefResolvedQuerySnapshot {
    const state = this.withProjectStore(project, (projectStore) =>
      projectStore.loadReefAnalysisState(project.projectId, project.canonicalPath));
    if (!state) {
      throw new Error("Reef analysis state is unavailable for query snapshot resolution.");
    }

    const revision = request.snapshot === "pinned"
      ? requirePinnedQueryRevision(request, state.currentRevision)
      : state.currentRevision;
    const materializedRevision = state.materializedRevision;
    const stale = revision < state.currentRevision;
    const stateLabel = querySnapshotState(revision, state.currentRevision, materializedRevision);
    if (request.freshnessPolicy === "require_fresh" && stateLabel !== "fresh") {
      throw new Error(`Reef query ${request.kind} requires a fresh snapshot, but revision ${revision} is ${stateLabel}.`);
    }

    return {
      queryId,
      behavior: request.snapshot,
      revision,
      latestKnownRevision: state.currentRevision,
      ...(materializedRevision != null ? { materializedRevision } : {}),
      stale,
      state: stateLabel,
      checkedAt: new Date().toISOString(),
      restarted,
    };
  }

  private async enqueueEventForBatch(
    project: AttachedProject,
    event: ReefProjectEvent,
  ): Promise<void> {
    const batch = this.eventBatchFor(project.canonicalPath);
    const wasEmpty = batch.events.length === 0;
    batch.events.push(event);
    batch.lastEventAt = event.observedAt;
    if (wasEmpty) {
      batch.firstEventAt = event.observedAt;
      this.scheduleEventBatchMaxDelay(project.canonicalPath, batch);
    }
    this.scheduleEventBatchDebounce(project.canonicalPath, batch);

    await appendReefOperation(this.options, {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "refresh_decision",
      message: wasEmpty ? "reef event batch scheduled" : "reef event coalesced into pending batch",
      data: {
        eventId: event.eventId,
        kind: event.kind,
        eventCount: batch.events.length,
        debounceMs: this.eventBatchDebounceMs(),
        maxDelayMs: this.eventBatchMaxDelayMs(),
      },
    });

    if (shouldFlushEventBatchImmediately(event)) {
      const result = await this.flushEventBatch(project.canonicalPath, "debounce", { throwOnError: true });
      if (result?.state === "failed") {
        throw new Error(result.message ?? "reef event batch refresh failed");
      }
    }
  }

  private scheduleEventBatchDebounce(
    canonicalRoot: string,
    batch: ReefRootEventBatchState,
  ): void {
    if (batch.debounceTimer) {
      clearTimeout(batch.debounceTimer);
    }
    batch.debounceTimer = setTimeout(() => {
      void this.flushEventBatch(canonicalRoot, "debounce");
    }, this.eventBatchDebounceMs());
    batch.debounceTimer.unref?.();
  }

  private scheduleEventBatchMaxDelay(
    canonicalRoot: string,
    batch: ReefRootEventBatchState,
  ): void {
    if (batch.maxDelayTimer) {
      return;
    }
    batch.maxDelayTimer = setTimeout(() => {
      void this.flushEventBatch(canonicalRoot, "max_delay");
    }, this.eventBatchMaxDelayMs());
    batch.maxDelayTimer.unref?.();
  }

  private async flushEventBatch(
    canonicalRoot: string,
    trigger: "debounce" | "max_delay",
    options: { throwOnError?: boolean } = {},
  ): Promise<ReefRefreshResult | null> {
    const batch = this.eventBatchesByCanonicalRoot.get(canonicalRoot);
    if (!batch || batch.events.length === 0) {
      return null;
    }

    this.eventBatchesByCanonicalRoot.delete(canonicalRoot);
    this.clearEventBatchTimers(batch);
    const events = batch.events;
    const first = events[0]!;

    try {
      const status = getIndexerProjectStatus(first.projectId, this.options);
      if (!status?.project) {
        throw new ProjectCommandError(404, "project_not_attached", `No attached project found for: ${first.projectId}`, {
          projectId: first.projectId,
        });
      }
      const changeSet = this.createChangeSetFromEvents(events);
      await this.logChangeSetCreated(changeSet, `submitEvent:${trigger}`);
      const result = await this.applyChangeSet(changeSet);
      const plan = materializationPlanForChangeSet(changeSet);
      return await this.enqueueRefreshMaterialization(
        status.project,
        eventBatchRefreshReason(events, trigger),
        changeSet,
        result,
        plan,
      );
    } catch (error) {
      await appendReefOperation(this.options, {
        projectId: first.projectId,
        root: canonicalRoot,
        kind: "degraded_state",
        severity: "error",
        message: "reef event batch flush failed",
        data: {
          trigger,
          eventCount: events.length,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (options.throwOnError) {
        throw error;
      }
      return null;
    }
  }

  private async logRefreshRequested(
    project: AttachedProject,
    input: ReefRefreshRequest,
    changeSet: ReefWorkspaceChangeSet,
  ): Promise<void> {
    await appendReefOperation(this.options, {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "refresh_requested",
      message: "reef refresh requested",
      data: {
        changeSetId: changeSet.changeSetId,
        reason: input.reason,
        pathCount: input.paths?.length ?? 0,
        wait: input.wait ?? false,
        ...(input.maxWaitMs != null ? { maxWaitMs: input.maxWaitMs } : {}),
      },
    });
  }

  private async logChangeSetCreated(
    changeSet: ReefWorkspaceChangeSet,
    source: string,
  ): Promise<void> {
    const plan = materializationPlanForChangeSet(changeSet);
    await appendReefOperation(this.options, {
      projectId: changeSet.projectId,
      root: changeSet.root,
      kind: "change_set_created",
      message: "reef change set created",
      data: {
        changeSetId: changeSet.changeSetId,
        source,
        causeCount: changeSet.causes.length,
        fileChangeCount: changeSet.fileChanges.length,
        refreshMode: plan.refreshMode,
        decisionReason: plan.decisionReason,
        ...(plan.fallbackReason ? { fallbackReason: plan.fallbackReason } : {}),
        ...(changeSet.git ? { git: changeSet.git } : {}),
      },
    });
  }

  private createRefreshChangeSet(
    project: AttachedProject,
    input: ReefRefreshRequest,
  ): ReefWorkspaceChangeSet {
    const now = new Date().toISOString();
    const event: ReefProjectEvent = {
      eventId: `reef_event_${randomUUID()}`,
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: input.paths && input.paths.length > 0 ? "reef.file.changed" : "reef.refresh.requested",
      ...(input.paths && input.paths.length > 0 ? { paths: normalizeRefreshPaths(project.canonicalPath, input.paths) } : {}),
      observedAt: now,
      data: {
        reason: input.reason,
        source: "requestRefresh",
      },
    };
    return this.createChangeSetFromEvents([event]);
  }

  private createChangeSetFromEvents(
    events: ReefProjectEvent[],
  ): ReefWorkspaceChangeSet {
    if (events.length === 0) {
      throw new Error("Cannot create a Reef change set without events.");
    }
    const first = events[0]!;
    const fileChanges = new Map<string, ReefWorkspaceChangeSet["fileChanges"][number]>();
    for (const event of events) {
      for (const fileChange of fileChangesForEvent(event)) {
        fileChanges.set(fileChange.path, mergeReefFileChange(fileChanges.get(fileChange.path), fileChange));
      }
    }
    const git = gitStateForEvents(events);
    return ReefWorkspaceChangeSetSchema.parse({
      changeSetId: `reef_changeset_${randomUUID()}`,
      projectId: first.projectId,
      root: first.root,
      observedAt: new Date().toISOString(),
      causes: events,
      fileChanges: [...fileChanges.values()],
      ...(git ? { git } : {}),
    });
  }

  private async enqueueRefreshMaterialization(
    project: AttachedProject,
    reason: string,
    changeSet: ReefWorkspaceChangeSet,
    changeSetResult: ReefChangeSetResult,
    plan: ReefMaterializationPlan,
  ): Promise<ReefRefreshResult> {
    const queue = this.queueFor(project.canonicalPath);
    queue.queued += 1;
    await appendReefOperation(this.options, {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "refresh_decision",
      message: "reef refresh queued",
      data: {
        changeSetId: changeSet.changeSetId,
        revision: changeSetResult.newRevision,
        queued: queue.queued,
        refreshMode: plan.refreshMode,
        pathCount: plan.paths.length,
        reason,
        decisionReason: plan.decisionReason,
        ...(plan.fallbackReason ? { fallbackReason: plan.fallbackReason } : {}),
      },
    });
    if (plan.fallbackReason) {
      await appendReefOperation(this.options, {
        projectId: project.projectId,
        root: project.canonicalPath,
        kind: "fallback_used",
        severity: "warning",
        message: "reef refresh promoted to full refresh",
        data: {
          changeSetId: changeSet.changeSetId,
          revision: changeSetResult.newRevision,
          reason: plan.fallbackReason,
          pathCount: plan.paths.length,
        },
      });
    }

    const prior = queue.tail.catch(() => undefined);
    const task = prior.then(() => this.runRefreshMaterialization(
      project,
      reason,
      changeSet,
      changeSetResult,
      queue,
      plan,
    ));
    queue.tail = task.catch(() => undefined);
    return task;
  }

  private async runRefreshMaterialization(
    project: AttachedProject,
    reason: string,
    changeSet: ReefWorkspaceChangeSet,
    changeSetResult: ReefChangeSetResult,
    queue: ReefRootQueueState,
    plan: ReefMaterializationPlan,
  ): Promise<ReefRefreshResult> {
    queue.queued = Math.max(0, queue.queued - 1);
    queue.running = true;
    queue.activeKind = "refresh";
    queue.lastRunAt = new Date().toISOString();
    queue.lastRunTrigger = reason;
    queue.lastRunResult = undefined;

    try {
      const materialization = await withReefRootWriterLock({
        configOverrides: this.options.configOverrides,
        projectId: project.projectId,
        canonicalRoot: project.canonicalPath,
        analysisHostId: this.ensureHost(project).hostId,
        acquireTimeoutMs: this.options.reefWriterLockAcquireTimeoutMs,
      }, async () => {
        const skipped = await this.skipSupersededMaterialization(
          project,
          reason,
          changeSet,
          changeSetResult,
          queue,
          plan,
        );
        if (skipped) {
          return {
            kind: "skipped" as const,
            result: skipped,
          };
        }
        return {
          kind: "indexed" as const,
          result: plan.refreshMode === "path_scoped"
            ? await refreshProjectPaths(project.canonicalPath, plan.paths, {
              ...this.options,
              skipReefWriterLock: true,
              triggerSource: reason,
              reefRevision: changeSetResult.newRevision,
            })
            : await indexProject(project.canonicalPath, {
              ...this.options,
              skipReefWriterLock: true,
              triggerSource: reason,
              reefRevision: changeSetResult.newRevision,
            }),
        };
      });

      if (materialization.kind === "skipped") {
        return materialization.result;
      }

      const result = materialization.result;

      const fallbackReason = refreshFallbackReason(result) ?? plan.fallbackReason;
      const refreshMode = refreshModeForResult(result);
      const details = refreshResultDetails(result);
      this.withProjectStore(project, (projectStore) => {
        projectStore.markReefChangeSetMaterialized({
          projectId: project.projectId,
          root: project.canonicalPath,
          changeSetId: changeSet.changeSetId,
          revision: changeSetResult.newRevision,
          refreshMode,
          ...(fallbackReason ? { fallbackReason } : {}),
        });
      });

      queue.running = false;
      queue.activeKind = undefined;
      queue.lastRunAt = new Date().toISOString();
      queue.lastRunResult = "succeeded";
      await appendReefOperation(this.options, {
        projectId: project.projectId,
        root: project.canonicalPath,
        kind: "refresh_completed",
        message: "reef refresh materialized",
        data: {
          changeSetId: changeSet.changeSetId,
          revision: changeSetResult.newRevision,
          operationId: result.run.runId,
          refreshMode,
          refreshedPathCount: details.refreshedPathCount,
          deletedPathCount: details.deletedPathCount,
          ...(fallbackReason ? { fallbackReason } : {}),
          decisionReason: plan.decisionReason,
          calculationAffectedNodeCount: plan.calculationPlan.affectedNodes.length,
          calculationAffectedNodeIds: plan.calculationPlan.affectedNodes.map((node) => node.nodeId),
        },
      });

      return {
        projectId: project.projectId,
        state: "completed",
        operationId: result.run.runId,
        appliedRevision: changeSetResult.newRevision,
        refreshMode: details.refreshMode,
        refreshedPathCount: details.refreshedPathCount,
        deletedPathCount: details.deletedPathCount,
        ...(details.fallbackReason || plan.fallbackReason
          ? { fallbackReason: details.fallbackReason ?? plan.fallbackReason }
          : {}),
        message: refreshMessage(result),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.withProjectStore(project, (projectStore) => {
        projectStore.markReefChangeSetFailed({
          projectId: project.projectId,
          root: project.canonicalPath,
          changeSetId: changeSet.changeSetId,
          errorText: message,
        });
      });
      queue.running = false;
      queue.activeKind = undefined;
      queue.lastRunAt = new Date().toISOString();
      queue.lastRunResult = "failed";
      await appendReefOperation(this.options, {
        projectId: project.projectId,
        root: project.canonicalPath,
        kind: "refresh_failed",
        severity: "error",
        message: "reef refresh materialization failed",
        data: {
          changeSetId: changeSet.changeSetId,
          revision: changeSetResult.newRevision,
          error: message,
        },
      });
      return {
        projectId: project.projectId,
        state: "failed",
        appliedRevision: changeSetResult.newRevision,
        message,
      };
    }
  }

  private async skipSupersededMaterialization(
    project: AttachedProject,
    reason: string,
    changeSet: ReefWorkspaceChangeSet,
    changeSetResult: ReefChangeSetResult,
    queue: ReefRootQueueState,
    plan: ReefMaterializationPlan,
  ): Promise<ReefRefreshResult | null> {
    const state = this.withProjectStore(project, (projectStore) =>
      projectStore.loadReefAnalysisState(project.projectId, project.canonicalPath));
    if (
      !state
      || state.currentRevision <= changeSetResult.newRevision
      || (state.materializedRevision ?? -1) < changeSetResult.newRevision
    ) {
      return null;
    }

    const message = `reef refresh skipped because revision ${changeSetResult.newRevision} was already materialized at revision ${state.materializedRevision}`;
    this.withProjectStore(project, (projectStore) => {
      projectStore.markReefChangeSetSkipped({
        projectId: project.projectId,
        root: project.canonicalPath,
        changeSetId: changeSet.changeSetId,
        reason: message,
      });
    });

    queue.running = false;
    queue.activeKind = undefined;
    queue.lastRunAt = new Date().toISOString();
    queue.lastRunResult = "skipped";

    await appendReefOperation(this.options, {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "refresh_decision",
      message: "reef stale refresh skipped",
      data: {
        changeSetId: changeSet.changeSetId,
        revision: changeSetResult.newRevision,
        currentRevision: state.currentRevision,
        materializedRevision: state.materializedRevision ?? null,
        recomputationGeneration: state.recomputationGeneration,
        refreshMode: plan.refreshMode,
        trigger: reason,
      },
    });

    return {
      projectId: project.projectId,
      state: "skipped",
      appliedRevision: changeSetResult.newRevision,
      refreshMode: plan.refreshMode,
      message,
    };
  }

  private async updateArtifactTagsForBranchChange(
    project: AttachedProject,
    changeSet: ReefWorkspaceChangeSet,
    changeSetResult: ReefAppliedChangeSetRecord,
  ): Promise<void> {
    const updates = changeSet.causes
      .filter((event) => event.kind === "reef.git.branch_changed")
      .map(branchArtifactUpdateForEvent)
      .filter((update): update is ReefBranchArtifactUpdate => update != null);
    if (updates.length === 0) {
      return;
    }

    const result: ReefBranchArtifactTagUpdateResult = {
      branchEventCount: updates.length,
      candidateCount: 0,
      reusedTagCount: 0,
      missingArtifactCount: 0,
      skippedCandidateCount: 0,
      targetBranch: updates[0]!.toBranch,
      ...(updates[0]!.fromBranch ? { priorBranch: updates[0]!.fromBranch } : {}),
    };

    this.withProjectStore(project, (projectStore) => {
      const seenTags = new Set<string>();
      for (const update of updates) {
        result.targetBranch = update.toBranch;
        if (update.fromBranch) {
          result.priorBranch = update.fromBranch;
        }
        result.skippedCandidateCount += update.skippedCandidateCount;
        for (const candidate of update.candidates) {
          result.candidateCount += 1;
          const tags = artifactTagsForBranchCandidate(projectStore, project, update, candidate);
          if (tags.length === 0) {
            result.missingArtifactCount += 1;
            continue;
          }
          for (const tag of tags) {
            const overlay = candidate.overlay ?? tag.overlay;
            const worktree = candidate.worktree ?? update.worktree ?? tag.worktree;
            const dedupeKey = [
              tag.artifactId,
              update.toBranch,
              worktree ?? "",
              overlay,
              candidate.path,
            ].join("\0");
            if (seenTags.has(dedupeKey)) {
              continue;
            }
            seenTags.add(dedupeKey);
            projectStore.addReefArtifactTag({
              artifactId: tag.artifactId,
              projectId: project.projectId,
              root: project.canonicalPath,
              branch: update.toBranch,
              ...(worktree ? { worktree } : {}),
              overlay,
              path: candidate.path,
              lastVerifiedRevision: changeSetResult.newRevision,
              lastChangedRevision: tag.lastChangedRevision ?? changeSetResult.newRevision,
            });
            result.reusedTagCount += 1;
          }
        }
      }
    });

    await appendReefOperation(this.options, {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "artifact_tag",
      severity: result.reusedTagCount > 0 ? "info" : "debug",
      message: "reef branch-change artifact tags updated",
      data: {
        changeSetId: changeSet.changeSetId,
        revision: changeSetResult.newRevision,
        branchEventCount: result.branchEventCount,
        candidateCount: result.candidateCount,
        reusedTagCount: result.reusedTagCount,
        missingArtifactCount: result.missingArtifactCount,
        skippedCandidateCount: result.skippedCandidateCount,
        targetBranch: result.targetBranch,
        ...(result.priorBranch ? { priorBranch: result.priorBranch } : {}),
      },
    });
  }

  // Auto-starts on first use so callers that construct an InProcessReefService
  // (e.g. MakoApiService via createReefClient) don't need an explicit start()
  // before issuing operations. After stop() clears state, the next call lazily
  // restarts the host; durable analysis state is reloaded from the project store.
  private ensureStarted(): void {
    if (!this.started) {
      this.started = true;
    }
  }

  private async ensureAnalysisStateWithStartupAudit(
    project: AttachedProject,
  ): Promise<ReefAnalysisStateRecord> {
    const { state, audit, latestChangeSetId } = this.withProjectStore(project, (projectStore) => {
      const existing = projectStore.loadReefAnalysisState(project.projectId, project.canonicalPath);
      const ensured = projectStore.ensureReefAnalysisState({
        projectId: project.projectId,
        root: project.canonicalPath,
      });
      const latestChangeSet = projectStore.queryReefAppliedChangeSets({
        projectId: project.projectId,
        root: project.canonicalPath,
        limit: 1,
      })[0];
      return {
        state: ensured,
        audit: startupAuditForAnalysisState(existing, ensured, latestChangeSet),
        latestChangeSetId: latestChangeSet?.changeSetId,
      };
    });

    let auditedState = state;
    if (!this.startupAuditedCanonicalRoots.has(project.canonicalPath)) {
      this.startupAuditedCanonicalRoots.add(project.canonicalPath);
      await appendReefOperation(this.options, {
        projectId: project.projectId,
        root: project.canonicalPath,
        kind: "audit_result",
        severity: audit.result === "needs_full_refresh" ? "warning" : "info",
        message: "reef startup analysis-state audit",
        data: {
          audit: "startup_analysis_state",
          result: audit.result,
          reason: audit.reason,
          action: audit.action,
          currentRevision: state.currentRevision,
          materializedRevision: state.materializedRevision ?? null,
          recomputationGeneration: state.recomputationGeneration,
          lastAppliedChangeSetId: state.lastAppliedChangeSetId ?? null,
          latestChangeSetId: latestChangeSetId ?? null,
        },
      });
      const changed = await this.runStartupFreshnessAudit(project).catch(async (error: unknown) => {
        await appendReefOperation(this.options, {
          projectId: project.projectId,
          root: project.canonicalPath,
          kind: "degraded_state",
          severity: "warning",
          message: "reef startup freshness audit failed",
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        return false;
      });
      if (changed) {
        auditedState = this.withProjectStore(project, (projectStore) =>
          projectStore.loadReefAnalysisState(project.projectId, project.canonicalPath)) ?? state;
      }
    }

    return auditedState;
  }

  private async runStartupFreshnessAudit(project: AttachedProject): Promise<boolean> {
    const audit = this.computeStartupFreshnessAudit(project);
    await appendReefOperation(this.options, {
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "audit_result",
      severity: audit.result === "drift" ? "warning" : "info",
      message: "reef startup freshness audit",
      data: {
        audit: "startup_freshness",
        result: audit.result,
        reason: audit.reason,
        action: audit.action,
        addedPathCount: audit.addedPaths.length,
        deletedPathCount: audit.deletedPaths.length,
        changedPathCount: audit.changedPaths.length,
        addedPaths: audit.addedPaths.slice(0, 20),
        deletedPaths: audit.deletedPaths.slice(0, 20),
        changedPaths: audit.changedPaths.slice(0, 20),
        gitIndexChanged: audit.gitIndexChanged,
        ...(audit.gitIndexMtime ? { gitIndexMtime: audit.gitIndexMtime } : {}),
        ...(audit.gitIndexHash ? { gitIndexHash: audit.gitIndexHash } : {}),
        ...(audit.latestIndexFinishedAt ? { latestIndexFinishedAt: audit.latestIndexFinishedAt } : {}),
      },
    });

    if (audit.result !== "drift") {
      return false;
    }

    const events = startupFreshnessEvents(project, audit);
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]!;
      await this.submitEvent({
        ...event,
        data: {
          ...(event.data ?? {}),
          flushImmediately: index === events.length - 1,
        },
      });
    }
    return events.length > 0;
  }

  private computeStartupFreshnessAudit(project: AttachedProject): ReefStartupFreshnessAudit {
    const { indexedFiles, latestRun } = this.withProjectStore(project, (projectStore) => ({
      indexedFiles: projectStore.listFiles().filter((file) => isWatchableProjectPath(file.path)),
      latestRun: projectStore.getLatestIndexRun(),
    }));
    if (!latestRun?.finishedAt || indexedFiles.length === 0) {
      return {
        result: "skipped",
        reason: "no completed indexed snapshot is available for startup freshness comparison",
        action: "none",
        addedPaths: [],
        deletedPaths: [],
        changedPaths: [],
        gitIndexChanged: false,
      };
    }

    const indexedByPath = new Map(indexedFiles.map((file) => [file.path, file] as const));
    const liveByPath = new Map<string, { absolutePath: string; stat: Stats }>();
    for (const absolutePath of collectProjectFilePaths(project.canonicalPath, (_absolutePath, relativePath) =>
      isWatchableProjectPath(relativePath.replace(/\\/g, "/")))) {
      const relativePath = toProjectIndexRelativePath(project.canonicalPath, absolutePath);
      if (!relativePath || !isWatchableProjectPath(relativePath)) {
        continue;
      }
      try {
        liveByPath.set(relativePath, { absolutePath, stat: statSync(absolutePath) });
      } catch {
        continue;
      }
    }

    const addedPaths = [...liveByPath.keys()]
      .filter((filePath) => !indexedByPath.has(filePath))
      .sort();
    const deletedPaths = [...indexedByPath.keys()]
      .filter((filePath) => !liveByPath.has(filePath))
      .sort();
    const changedPaths = [...liveByPath.entries()]
      .filter(([filePath, live]) => {
        const indexed = indexedByPath.get(filePath);
        if (!indexed) {
          return false;
        }
        return indexedFileLooksChanged(indexed, live.absolutePath, live.stat);
      })
      .map(([filePath]) => filePath)
      .sort();

    const gitIndex = gitIndexAudit(project.canonicalPath, latestRun.finishedAt);
    const hasDrift = addedPaths.length > 0
      || deletedPaths.length > 0
      || changedPaths.length > 0
      || gitIndex.changed;
    return {
      result: hasDrift ? "drift" : "clean",
      reason: hasDrift
        ? "startup audit found live workspace state newer than the indexed snapshot"
        : "startup audit found no indexed path or git index drift",
      action: hasDrift ? "submitted_events" : "none",
      addedPaths,
      deletedPaths,
      changedPaths,
      gitIndexChanged: gitIndex.changed,
      ...(gitIndex.mtime ? { gitIndexMtime: gitIndex.mtime } : {}),
      ...(gitIndex.hash ? { gitIndexHash: gitIndex.hash } : {}),
      latestIndexFinishedAt: latestRun.finishedAt,
    };
  }

  private withProjectStore<T>(
    project: AttachedProject,
    callback: (projectStore: ProjectStore) => T,
  ): T {
    return withGlobalStore(this.options, ({ config }) =>
      withProjectStore(project.canonicalPath, config, callback, this.options),
    );
  }

  private queueFor(canonicalRoot: string): ReefRootQueueState {
    const existing = this.queuesByCanonicalRoot.get(canonicalRoot);
    if (existing) {
      return existing;
    }
    const queue: ReefRootQueueState = {
      tail: Promise.resolve(),
      running: false,
      queued: 0,
    };
    this.queuesByCanonicalRoot.set(canonicalRoot, queue);
    return queue;
  }

  private eventBatchFor(canonicalRoot: string): ReefRootEventBatchState {
    const existing = this.eventBatchesByCanonicalRoot.get(canonicalRoot);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const batch: ReefRootEventBatchState = {
      events: [],
      firstEventAt: now,
      lastEventAt: now,
    };
    this.eventBatchesByCanonicalRoot.set(canonicalRoot, batch);
    return batch;
  }

  private queryStateFor(canonicalRoot: string): ReefRootQueryState {
    const existing = this.queriesByCanonicalRoot.get(canonicalRoot);
    if (existing) {
      return existing;
    }
    const state: ReefRootQueryState = {
      running: new Map(),
      canceledCount: 0,
    };
    this.queriesByCanonicalRoot.set(canonicalRoot, state);
    return state;
  }

  private clearEventBatches(): void {
    for (const batch of this.eventBatchesByCanonicalRoot.values()) {
      this.clearEventBatchTimers(batch);
    }
    this.eventBatchesByCanonicalRoot.clear();
  }

  private clearEventBatchTimers(batch: ReefRootEventBatchState): void {
    if (batch.debounceTimer) {
      clearTimeout(batch.debounceTimer);
      batch.debounceTimer = undefined;
    }
    if (batch.maxDelayTimer) {
      clearTimeout(batch.maxDelayTimer);
      batch.maxDelayTimer = undefined;
    }
  }

  private eventBatchDebounceMs(): number {
    return Math.max(0, this.options.reefEventBatchDebounceMs ?? REEF_EVENT_BATCH_DEBOUNCE_MS);
  }

  private eventBatchMaxDelayMs(): number {
    return Math.max(0, this.options.reefEventBatchMaxDelayMs ?? REEF_EVENT_BATCH_MAX_DELAY_MS);
  }

  private ensureHost(project: AttachedProject): InProcessAnalysisHostRecord {
    const existing = this.hostsByCanonicalRoot.get(project.canonicalPath);
    const now = new Date().toISOString();
    if (existing) {
      existing.lastSeenAt = now;
      return existing;
    }

    const host: InProcessAnalysisHostRecord = {
      hostId: `reef-host-${++this.hostSequence}`,
      projectId: project.projectId,
      canonicalRoot: project.canonicalPath,
      createdAt: now,
      lastSeenAt: now,
    };
    this.hostsByCanonicalRoot.set(project.canonicalPath, host);
    return host;
  }
}

export function createInProcessReefService(
  options: InProcessReefServiceOptions = {},
): InProcessReefService {
  return new InProcessReefService(options);
}

function toRegisteredProject(
  project: AttachedProject,
  watchEnabled = true,
): RegisteredProject {
  return {
    projectId: project.projectId,
    root: project.lastSeenPath,
    canonicalRoot: project.canonicalPath,
    displayName: project.displayName,
    addedAt: project.attachedAt,
    lastSeenAt: project.lastIndexedAt ?? project.attachedAt,
    watchEnabled,
    status: project.status,
  };
}

function normalizeEventForProject(
  project: AttachedProject,
  event: ReefProjectEvent,
): ReefProjectEvent | null {
  if (!event.kind.startsWith("reef.file.")) {
    return ReefProjectEventSchema.parse({
      ...event,
      root: project.canonicalPath,
      ...(event.paths ? { paths: normalizeRefreshPaths(project.canonicalPath, event.paths) } : {}),
    });
  }

  const paths = normalizeRefreshPaths(project.canonicalPath, event.paths ?? [])
    .filter((filePath) => isWatchableProjectPath(filePath));
  if (paths.length === 0) {
    return null;
  }
  return ReefProjectEventSchema.parse({
    ...event,
    root: project.canonicalPath,
    paths,
  });
}

function shouldFlushEventBatchImmediately(event: ReefProjectEvent): boolean {
  return event.data?.flushImmediately === true;
}

async function promiseSettledWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function requirePinnedQueryRevision(
  request: ReefQueryRequest<unknown>,
  currentRevision: number,
): number {
  if (request.revision == null) {
    throw new Error(`Reef query ${request.kind} with snapshot=pinned requires a revision.`);
  }
  if (request.revision > currentRevision) {
    throw new Error(`Reef query ${request.kind} requested future revision ${request.revision}; current revision is ${currentRevision}.`);
  }
  return request.revision;
}

function querySnapshotState(
  revision: number,
  currentRevision: number,
  materializedRevision: number | undefined,
): ReefResolvedQuerySnapshot["state"] {
  if (revision < currentRevision) {
    return "stale";
  }
  if (revision === 0 || (materializedRevision != null && materializedRevision >= revision)) {
    return "fresh";
  }
  return "refreshing";
}

function normalizeChangeSetsQueryInput(input: unknown): Required<Pick<ReefChangeSetsQueryInput, "limit">>
  & Omit<ReefChangeSetsQueryInput, "limit"> {
  const record = input != null && typeof input === "object" ? input as Record<string, unknown> : {};
  const rawLimit = record.limit;
  const limit = typeof rawLimit === "number" && Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, 100)
    : 50;
  const rawSinceRevision = record.sinceRevision;
  const sinceRevision = typeof rawSinceRevision === "number"
    && Number.isInteger(rawSinceRevision)
    && rawSinceRevision >= 0
    ? rawSinceRevision
    : undefined;
  return {
    limit,
    ...(sinceRevision != null ? { sinceRevision } : {}),
    includeCauses: record.includeCauses === true,
    includeFileChanges: record.includeFileChanges === true,
  };
}

function normalizeCalculationPlanQueryInput(input: unknown, project: AttachedProject): ReefCalculationPlanQueryInput {
  const parsed = ReefCalculationPlanQueryInputSchema.parse(input ?? {});
  if (parsed.changeSet) {
    if (parsed.changeSet.projectId !== project.projectId) {
      throw new Error(`Reef calculation plan change set project ${parsed.changeSet.projectId} does not match requested project ${project.projectId}.`);
    }
    if (!sameProjectRoot(parsed.changeSet.root, project.canonicalPath)) {
      throw new Error(`Reef calculation plan change set root ${parsed.changeSet.root} does not match requested root ${project.canonicalPath}.`);
    }
  }
  return parsed;
}

function sameProjectRoot(left: string, right: string): boolean {
  const leftResolved = path.resolve(left);
  const rightResolved = path.resolve(right);
  return process.platform === "win32"
    ? leftResolved.toLowerCase() === rightResolved.toLowerCase()
    : leftResolved === rightResolved;
}

function changeSetRecordForQuery(
  record: ReefAppliedChangeSetRecord,
  input: ReefChangeSetsQueryInput,
): Record<string, unknown> {
  return {
    changeSetId: record.changeSetId,
    baseRevision: record.baseRevision,
    newRevision: record.newRevision,
    observedAt: record.observedAt,
    appliedAt: record.appliedAt,
    generation: record.generation,
    status: record.status,
    refreshMode: record.refreshMode,
    fallbackReason: record.fallbackReason ?? null,
    causeCount: record.causeCount,
    fileChangeCount: record.fileChangeCount,
    ...(input.includeCauses ? { causes: record.causes } : {}),
    ...(input.includeFileChanges ? { fileChanges: record.fileChanges } : {}),
    ...(record.data ? { data: record.data } : {}),
  };
}

function eventBatchRefreshReason(
  events: ReefProjectEvent[],
  trigger: "debounce" | "max_delay",
): string {
  const triggerSources = new Set(
    events
      .map((event) => event.data?.triggerSource)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  if (triggerSources.size === 1) {
    return [...triggerSources][0]!;
  }
  return `event_batch:${trigger}`;
}

function gitStateForEvents(events: ReefProjectEvent[]): ReefWorkspaceChangeSet["git"] | undefined {
  const git: NonNullable<ReefWorkspaceChangeSet["git"]> = {};
  for (const event of events) {
    const data = event.data ?? {};
    if (event.kind === "reef.git.index_changed") {
      const indexHash = stringField(data, "indexHash")
        ?? stringField(data, "gitIndexHash")
        ?? gitIndexHash(event.root);
      if (indexHash) {
        git.indexHash = indexHash;
      }
    }
    if (event.kind === "reef.git.branch_changed") {
      const branch = stringField(data, "branch")
        ?? stringField(data, "toBranch")
        ?? stringField(data, "currentBranch");
      if (branch) {
        git.branch = branch;
      }
    }
    const head = stringField(data, "head")
      ?? stringField(data, "gitHead")
      ?? stringField(data, "currentHead");
    if (head) {
      git.head = head;
    }
    const lockfileHash = stringField(data, "lockfileHash");
    if (lockfileHash) {
      git.lockfileHash = lockfileHash;
    }
  }
  return Object.keys(git).length > 0 ? git : undefined;
}

function startupFreshnessEvents(
  project: AttachedProject,
  audit: ReefStartupFreshnessAudit,
): ReefProjectEvent[] {
  const now = new Date().toISOString();
  const baseData: JsonObject = {
    producer: "startup_freshness_audit",
  };
  const events: ReefProjectEvent[] = [];
  if (audit.addedPaths.length > 0) {
    events.push({
      eventId: `reef_event_${randomUUID()}`,
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "reef.file.added",
      paths: audit.addedPaths,
      observedAt: now,
      data: {
        ...baseData,
        triggerSource: "startup_path_signature_audit",
      },
    });
  }
  if (audit.deletedPaths.length > 0) {
    events.push({
      eventId: `reef_event_${randomUUID()}`,
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "reef.file.deleted",
      paths: audit.deletedPaths,
      observedAt: now,
      data: {
        ...baseData,
        triggerSource: "startup_path_signature_audit",
      },
    });
  }
  if (audit.changedPaths.length > 0) {
    events.push({
      eventId: `reef_event_${randomUUID()}`,
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "reef.file.changed",
      paths: audit.changedPaths,
      observedAt: now,
      data: {
        ...baseData,
        triggerSource: "startup_path_signature_audit",
      },
    });
  }
  if (audit.gitIndexChanged) {
    events.push({
      eventId: `reef_event_${randomUUID()}`,
      projectId: project.projectId,
      root: project.canonicalPath,
      kind: "reef.git.index_changed",
      observedAt: now,
      data: {
        ...baseData,
        triggerSource: "startup_git_index_audit",
        ...(audit.gitIndexMtime ? { gitIndexMtime: audit.gitIndexMtime } : {}),
        ...(audit.gitIndexHash ? { gitIndexHash: audit.gitIndexHash } : {}),
        ...(audit.latestIndexFinishedAt ? { latestIndexFinishedAt: audit.latestIndexFinishedAt } : {}),
      },
    });
  }
  return events;
}

function gitIndexAudit(
  canonicalRoot: string,
  latestIndexFinishedAt: string,
): { changed: boolean; mtime?: string; hash?: string } {
  const gitIndexPath = path.join(canonicalRoot, ".git", "index");
  if (!existsSync(gitIndexPath)) {
    return { changed: false };
  }
  try {
    const stat = statSync(gitIndexPath);
    const changed = Date.parse(latestIndexFinishedAt) + 1 < stat.mtimeMs;
    const hash = changed ? gitIndexHash(canonicalRoot) : undefined;
    return {
      changed,
      mtime: stat.mtime.toISOString(),
      ...(hash ? { hash } : {}),
    };
  } catch {
    return { changed: false };
  }
}

function gitIndexHash(canonicalRoot: string): string | undefined {
  const gitIndexPath = path.join(canonicalRoot, ".git", "index");
  if (!existsSync(gitIndexPath)) {
    return undefined;
  }
  try {
    return createHash("sha256").update(readFileSync(gitIndexPath)).digest("hex");
  } catch {
    return undefined;
  }
}

function indexedFileLooksChanged(
  indexed: FileSummaryRecord,
  absolutePath: string,
  stat: Stats,
): boolean {
  if (indexed.sizeBytes !== stat.size) {
    return true;
  }
  if (indexed.lastModifiedAt == null || Date.parse(indexed.lastModifiedAt) + 1 >= stat.mtimeMs) {
    return false;
  }
  if (!indexed.sha256) {
    return true;
  }
  const content = readTextFile(absolutePath);
  return content == null || hashText(content) !== indexed.sha256;
}

function startupAuditForAnalysisState(
  existing: ReefAnalysisStateRecord | null,
  state: ReefAnalysisStateRecord,
  latestChangeSet: ReefAppliedChangeSetRecord | undefined,
): ReefStartupAudit {
  if (!existing) {
    return {
      result: "missing",
      reason: "durable analysis state was missing and has been initialized",
      action: "none",
    };
  }
  if (state.currentRevision > 0 && !latestChangeSet) {
    return {
      result: "needs_full_refresh",
      reason: "analysis revision exists without applied change-set history",
      action: "full_refresh_recommended",
    };
  }
  if (
    state.materializedRevision != null
    && state.materializedRevision > state.currentRevision
  ) {
    return {
      result: "needs_full_refresh",
      reason: "materialized revision is ahead of current revision",
      action: "full_refresh_recommended",
    };
  }
  if (
    state.currentRevision > 0
    && state.materializedRevision == null
  ) {
    return {
      result: "needs_full_refresh",
      reason: "analysis revision has no materialized revision",
      action: "full_refresh_recommended",
    };
  }
  return {
    result: "usable",
    reason: state.materializedRevision != null && state.materializedRevision < state.currentRevision
      ? "durable analysis state loaded with materialization behind current revision"
      : "durable analysis state loaded",
    action: "none",
  };
}

function materializationPlanForChangeSet(changeSet: ReefWorkspaceChangeSet): ReefMaterializationPlan {
  const calculationPlan = createReefCalculationExecutionPlan(
    createReefIndexerCalculationRegistry(),
    changeSet,
    {
      fullRefreshPathThreshold: REEF_FULL_REFRESH_PATH_THRESHOLD,
      isGraphSensitivePath,
    },
  );
  return {
    refreshMode: calculationPlan.refreshMode,
    paths: calculationPlan.changedPaths,
    decisionReason: calculationPlan.decisionReason,
    ...(calculationPlan.fallbackReason ? { fallbackReason: calculationPlan.fallbackReason } : {}),
    calculationPlan,
  };
}

function isGraphSensitivePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = path.posix.basename(normalized);
  if (normalized.endsWith(".sql")) {
    return true;
  }
  if (
    basename === "package.json"
    || basename === "pnpm-lock.yaml"
    || basename === "package-lock.json"
    || basename === "yarn.lock"
    || basename === "bun.lockb"
    || basename === "bun.lock"
    || basename === "pnpm-workspace.yaml"
    || basename === "nx.json"
    || basename === "turbo.json"
    || basename === "angular.json"
    || basename === "biome.json"
    || basename === ".gitignore"
  ) {
    return true;
  }
  if (
    /^tsconfig(?:\.[^/]*)?\.json$/u.test(basename)
    || /^jsconfig(?:\.[^/]*)?\.json$/u.test(basename)
    || /^(next|vite|webpack|mako|eslint|astro|svelte|nuxt)\.config\.[cm]?[jt]s$/u.test(basename)
    || /^\.eslintrc(?:\..+)?$/u.test(basename)
  ) {
    return true;
  }
  return normalized.includes("/generated/")
    || normalized.includes("database.types.")
    || normalized.endsWith(".generated.ts")
    || normalized.endsWith(".generated.tsx");
}

function normalizeRefreshPaths(projectRoot: string, paths: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const inputPath of paths) {
    const candidate = path.isAbsolute(inputPath) ? inputPath : path.resolve(projectRoot, inputPath);
    const relativePath = toProjectIndexRelativePath(projectRoot, candidate);
    if (relativePath && relativePath !== ".") {
      normalized.add(relativePath);
    }
  }
  return [...normalized];
}

function fileChangesForEvent(event: ReefProjectEvent): ReefWorkspaceChangeSet["fileChanges"] {
  const paths = event.paths ?? [];
  if (paths.length === 0) {
    return [];
  }

  const changes: ReefWorkspaceChangeSet["fileChanges"] = [];
  for (const filePath of normalizeRefreshPaths(event.root, paths)) {
    switch (event.kind) {
      case "reef.file.added":
        changes.push({ path: filePath, kind: "created" });
        break;
      case "reef.file.deleted":
        changes.push({ path: filePath, kind: "deleted" });
        break;
      case "reef.file.renamed": {
        const priorPath = typeof event.data?.priorPath === "string"
          ? normalizeRefreshPaths(event.root, [event.data.priorPath])[0]
          : undefined;
        changes.push({
          path: filePath,
          kind: "renamed",
          ...(priorPath ? { priorPath } : {}),
        });
        break;
      }
      case "reef.file.changed":
        changes.push({ path: filePath, kind: "updated" });
        break;
      default:
        break;
    }
  }
  return changes;
}

function mergeReefFileChange(
  existing: ReefWorkspaceChangeSet["fileChanges"][number] | undefined,
  next: ReefWorkspaceChangeSet["fileChanges"][number],
): ReefWorkspaceChangeSet["fileChanges"][number] {
  if (!existing) {
    return next;
  }
  const priorPath = next.priorPath ?? existing.priorPath;
  return {
    ...next,
    ...(priorPath ? { priorPath } : {}),
  };
}

function branchArtifactUpdateForEvent(event: ReefProjectEvent): ReefBranchArtifactUpdate | null {
  if (event.kind !== "reef.git.branch_changed") {
    return null;
  }
  const data = event.data ?? {};
  const toBranch = stringField(data, "branch")
    ?? stringField(data, "toBranch")
    ?? stringField(data, "currentBranch");
  if (!toBranch) {
    return null;
  }
  const fromBranch = stringField(data, "priorBranch")
    ?? stringField(data, "fromBranch")
    ?? stringField(data, "oldBranch");
  const worktree = stringField(data, "worktree");
  const parsed = branchArtifactCandidatesFromData(data);
  if (parsed.candidates.length === 0 && parsed.skippedCandidateCount === 0) {
    return null;
  }
  return {
    ...(fromBranch ? { fromBranch } : {}),
    toBranch,
    ...(worktree ? { worktree } : {}),
    candidates: parsed.candidates,
    skippedCandidateCount: parsed.skippedCandidateCount,
  };
}

function branchArtifactCandidatesFromData(data: JsonObject): {
  candidates: ReefBranchArtifactCandidate[];
  skippedCandidateCount: number;
} {
  const candidates: ReefBranchArtifactCandidate[] = [];
  let skippedCandidateCount = 0;
  const explicit = arrayField(data, "artifactTags") ?? arrayField(data, "branchArtifactTags") ?? [];
  for (const value of explicit) {
    const candidate = branchArtifactCandidateFromValue(value);
    if (candidate) {
      candidates.push(candidate);
    } else {
      skippedCandidateCount += 1;
    }
  }

  const contentHashesByPath = recordField(data, "contentHashesByPath");
  if (contentHashesByPath) {
    for (const [pathValue, hashValue] of Object.entries(contentHashesByPath)) {
      const candidatePath = normalizeArtifactCandidatePath(pathValue);
      if (!candidatePath || typeof hashValue !== "string" || hashValue.length === 0) {
        skippedCandidateCount += 1;
        continue;
      }
      candidates.push({
        path: candidatePath,
        contentHash: hashValue,
      });
    }
  }

  return { candidates, skippedCandidateCount };
}

function branchArtifactCandidateFromValue(value: unknown): ReefBranchArtifactCandidate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const pathValue = normalizeArtifactCandidatePath(stringField(record, "path"));
  const contentHash = stringField(record, "contentHash");
  if (!pathValue || !contentHash) {
    return null;
  }
  const artifactKind = stringField(record, "artifactKind");
  const extractorVersion = stringField(record, "extractorVersion");
  const overlay = projectOverlayField(record, "overlay");
  const worktree = stringField(record, "worktree");
  return {
    path: pathValue,
    contentHash,
    ...(artifactKind ? { artifactKind } : {}),
    ...(extractorVersion ? { extractorVersion } : {}),
    ...(overlay ? { overlay } : {}),
    ...(worktree ? { worktree } : {}),
  };
}

function artifactTagsForBranchCandidate(
  projectStore: ProjectStore,
  project: AttachedProject,
  update: ReefBranchArtifactUpdate,
  candidate: ReefBranchArtifactCandidate,
): ReefBranchArtifactMatch[] {
  const worktree = candidate.worktree ?? update.worktree;

  if (candidate.artifactKind && candidate.extractorVersion) {
    if (!update.fromBranch) {
      return [];
    }
    return projectStore.queryReefArtifactTags({
      projectId: project.projectId,
      root: project.canonicalPath,
      branch: update.fromBranch,
      path: candidate.path,
      contentHash: candidate.contentHash,
      artifactKind: candidate.artifactKind,
      extractorVersion: candidate.extractorVersion,
      ...(candidate.overlay ? { overlay: candidate.overlay } : {}),
      ...(worktree ? { worktree } : {}),
      limit: 100,
    }).map(toBranchArtifactMatch);
  }

  if (!update.fromBranch) {
    return [];
  }

  return projectStore.queryReefArtifactTags({
    projectId: project.projectId,
    root: project.canonicalPath,
    branch: update.fromBranch,
    path: candidate.path,
    contentHash: candidate.contentHash,
    ...(candidate.overlay ? { overlay: candidate.overlay } : {}),
    ...(worktree ? { worktree } : {}),
    limit: 100,
  }).map(toBranchArtifactMatch);
}

function toBranchArtifactMatch(tag: ReefArtifactTagRecord): ReefBranchArtifactMatch {
  return {
    artifactId: tag.artifactId,
    overlay: tag.overlay,
    ...(tag.worktree ? { worktree: tag.worktree } : {}),
    ...(tag.lastChangedRevision != null ? { lastChangedRevision: tag.lastChangedRevision } : {}),
  };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeArtifactCandidatePath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.includes("\0") ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value) ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }
  return normalized;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function projectOverlayField(record: Record<string, unknown>, key: string): ProjectOverlay | undefined {
  const value = record[key];
  return value === "indexed" || value === "working_tree" || value === "staged" || value === "preview"
    ? value
    : undefined;
}

function filterOperations(
  operations: ReefOperationLogEntry[],
  input: ReefOperationQuery,
): ReefOperationLogEntry[] {
  return operations
    .filter((entry) => !input.kind || entry.kind === input.kind)
    .filter((entry) => !input.severity || entry.severity === input.severity)
    .filter((entry) => !input.since || entry.createdAt >= input.since);
}

const REEF_DIAGNOSTIC_STATUS_SOURCES: Array<{ source: string; kind: ReefDiagnosticSourceKind }> = [
  { source: "typescript_syntax", kind: "syntactic" },
  { source: "typescript", kind: "semantic" },
  { source: "lint_files", kind: "programmatic" },
  { source: "eslint", kind: "lint" },
  { source: "oxlint", kind: "lint" },
  { source: "biome", kind: "lint" },
  { source: "programmatic_findings", kind: "programmatic" },
];

function buildReefProjectSchemaStatus(
  status: ProjectStatusResult,
): ReefProjectSchemaStatus {
  const checkedAtMs = Date.now();
  const checkedAt = new Date(checkedAtMs).toISOString();
  const snapshot = status.schemaSnapshot;
  const liveDbBound = status.dbBinding.configured;
  const refreshedAtMs = snapshot.refreshedAt ? Date.parse(snapshot.refreshedAt) : NaN;
  const snapshotAgeMs = Number.isFinite(refreshedAtMs) ? Math.max(0, checkedAtMs - refreshedAtMs) : undefined;
  const sourceFreshness = reefSchemaSourceFreshness(snapshot.freshnessStatus, snapshot.state);
  const liveDbFreshness = reefSchemaLiveFreshness({
    liveDbBound,
    sourceMode: snapshot.sourceMode,
    refreshedAtMs,
    snapshotAgeMs,
  });
  const state = reefSchemaOverallState(sourceFreshness, liveDbFreshness, snapshot.state);

  return {
    checkedAt,
    state,
    reason: reefSchemaStatusReason({
      state,
      sourceFreshness,
      liveDbFreshness,
      snapshotState: snapshot.state,
      sourceMode: snapshot.sourceMode,
      snapshotAgeMs,
      liveDbBound,
    }),
    ...(snapshot.snapshotId ? { snapshotId: snapshot.snapshotId } : {}),
    ...(snapshot.sourceMode ? { sourceMode: snapshot.sourceMode } : {}),
    ...(snapshot.freshnessStatus ? { freshnessStatus: snapshot.freshnessStatus } : {}),
    sourceFreshness,
    liveDbFreshness,
    liveDbBound,
    ...(snapshot.refreshedAt ? { lastSnapshotAt: snapshot.refreshedAt } : {}),
    liveSnapshotMaxAgeMs: REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS,
    ...(snapshotAgeMs !== undefined ? { snapshotAgeMs } : {}),
    ...(snapshot.driftDetected !== undefined ? { driftDetected: snapshot.driftDetected } : {}),
  };
}

function reefSchemaSourceFreshness(
  freshnessStatus: ProjectStatusResult["schemaSnapshot"]["freshnessStatus"],
  snapshotState: ProjectStatusResult["schemaSnapshot"]["state"],
): ReefProjectSchemaStatus["sourceFreshness"] {
  if (snapshotState !== "present") {
    return "no_snapshot";
  }
  if (freshnessStatus === "fresh" || freshnessStatus === "verified") {
    return "fresh";
  }
  if (freshnessStatus === "stale" || freshnessStatus === "drift_detected" || freshnessStatus === "refresh_required") {
    return "stale";
  }
  return "unknown";
}

function reefSchemaLiveFreshness(args: {
  liveDbBound: boolean;
  sourceMode: ProjectStatusResult["schemaSnapshot"]["sourceMode"];
  refreshedAtMs: number;
  snapshotAgeMs: number | undefined;
}): ReefProjectSchemaStatus["liveDbFreshness"] {
  if (!args.liveDbBound) {
    return "not_bound";
  }
  if (args.sourceMode !== "live_refresh_enabled") {
    return "stale";
  }
  if (!Number.isFinite(args.refreshedAtMs) || args.snapshotAgeMs === undefined) {
    return "stale";
  }
  return args.snapshotAgeMs <= REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS ? "fresh" : "stale";
}

function reefSchemaOverallState(
  sourceFreshness: ReefProjectSchemaStatus["sourceFreshness"],
  liveDbFreshness: ReefProjectSchemaStatus["liveDbFreshness"],
  snapshotState: ProjectStatusResult["schemaSnapshot"]["state"],
): ReefProjectSchemaStatus["state"] {
  if (snapshotState !== "present") {
    return "no_snapshot";
  }
  if (sourceFreshness === "stale" || liveDbFreshness === "stale") {
    return "stale";
  }
  if (sourceFreshness === "unknown" || liveDbFreshness === "unknown") {
    return "unknown";
  }
  return "fresh";
}

function reefSchemaStatusReason(args: {
  state: ReefProjectSchemaStatus["state"];
  sourceFreshness: ReefProjectSchemaStatus["sourceFreshness"];
  liveDbFreshness: ReefProjectSchemaStatus["liveDbFreshness"];
  snapshotState: ProjectStatusResult["schemaSnapshot"]["state"];
  sourceMode: ProjectStatusResult["schemaSnapshot"]["sourceMode"];
  snapshotAgeMs: number | undefined;
  liveDbBound: boolean;
}): string {
  if (args.snapshotState !== "present") {
    return `schema snapshot state is ${args.snapshotState}`;
  }
  if (args.sourceFreshness === "stale") {
    return "schema snapshot source hashes are stale or drift was detected";
  }
  if (args.liveDbFreshness === "stale") {
    if (!args.liveDbBound) {
      return "schema snapshot has no live DB binding";
    }
    if (args.sourceMode !== "live_refresh_enabled") {
      return "live DB binding exists but the latest schema snapshot was not produced by live refresh";
    }
    if (args.snapshotAgeMs === undefined) {
      return "live DB snapshot age could not be computed";
    }
    return `live DB schema snapshot is older than ${REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS} ms`;
  }
  if (args.sourceFreshness === "unknown" || args.liveDbFreshness === "unknown") {
    return "schema freshness could not be fully determined";
  }
  return args.liveDbFreshness === "fresh"
    ? "schema snapshot is source-fresh and within the live DB snapshot age budget"
    : "schema snapshot is source-fresh and no live DB binding is configured";
}

function buildReefProjectDiagnosticStatus(
  projectStore: ProjectStore,
  project: AttachedProject,
  analysisState: ReefAnalysisStateRecord | null,
): ReefProjectDiagnosticStatus {
  const checkedAtMs = Date.now();
  const checkedAt = new Date(checkedAtMs).toISOString();
  const runs = projectStore.queryReefDiagnosticRuns({
    projectId: project.projectId,
    limit: 100,
  });
  const latestBySource = latestReefDiagnosticRunsBySource(runs);
  const changedAfterCheck = reefDiagnosticChangedAfterCheck(
    projectStore,
    project.projectId,
    REEF_DIAGNOSTIC_STATUS_SOURCES.map(({ source }) => source)
      .map((source) => latestBySource.get(source))
      .filter((run): run is ReefDiagnosticRun => run?.status === "succeeded"),
  );
  const staleFileCounts = new Map<string, number>();
  for (const changed of changedAfterCheck) {
    for (const source of changed.staleSources) {
      staleFileCounts.set(source, (staleFileCounts.get(source) ?? 0) + 1);
    }
  }

  const sources = REEF_DIAGNOSTIC_STATUS_SOURCES.map(({ source, kind }) =>
    reefDiagnosticSourceStatus({
      source,
      kind,
      run: latestBySource.get(source),
      staleFileCount: staleFileCounts.get(source) ?? 0,
      checkedAtMs,
      currentRevision: analysisState?.currentRevision,
    })
  );
  const bySource = new Map(sources.map((source) => [source.source, source]));

  return {
    checkedAt,
    staleAfterMs: REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS,
    typescript: {
      syntactic: bySource.get("typescript_syntax")!,
      semantic: bySource.get("typescript")!,
    },
    sources,
    changedAfterCheck: changedAfterCheck.slice(0, 100),
  };
}

function latestReefDiagnosticRunsBySource(runs: readonly ReefDiagnosticRun[]): Map<string, ReefDiagnosticRun> {
  const latest = new Map<string, ReefDiagnosticRun>();
  for (const run of runs) {
    const existing = latest.get(run.source);
    if (!existing || Date.parse(run.finishedAt) > Date.parse(existing.finishedAt)) {
      latest.set(run.source, run);
    }
  }
  return latest;
}

function reefDiagnosticSourceStatus(args: {
  source: string;
  kind: ReefDiagnosticSourceKind;
  run: ReefDiagnosticRun | undefined;
  staleFileCount: number;
  checkedAtMs: number;
  currentRevision: number | undefined;
}): ReefDiagnosticSourceStatus {
  const base = {
    source: args.source,
    kind: args.kind,
    staleFileCount: args.staleFileCount,
  };
  if (!args.run) {
    return {
      ...base,
      state: "unknown",
      reason: `no ${args.source} diagnostic run has been recorded`,
    };
  }

  const finishedAtMs = Date.parse(args.run.finishedAt);
  const inputRevision = numericDiagnosticMetadata(args.run, "inputRevision");
  const outputRevision = numericDiagnosticMetadata(args.run, "outputRevision");
  const runFields = {
    latestRunId: args.run.runId,
    latestFinishedAt: args.run.finishedAt,
    ...(inputRevision !== undefined ? { inputRevision } : {}),
    ...(outputRevision !== undefined ? { outputRevision } : {}),
    ...(args.run.checkedFileCount !== undefined ? { checkedFileCount: args.run.checkedFileCount } : {}),
    findingCount: args.run.findingCount,
  };

  if (args.run.status === "unavailable") {
    return {
      ...base,
      ...runFields,
      state: "unavailable",
      reason: args.run.errorText ?? `${args.source} diagnostic source is unavailable`,
    };
  }
  if (args.run.status === "ran_with_error") {
    return {
      ...base,
      ...runFields,
      state: "failed",
      reason: args.run.errorText ?? `${args.source} diagnostic run failed`,
    };
  }
  if (!Number.isFinite(finishedAtMs)) {
    return {
      ...base,
      ...runFields,
      state: "unknown",
      reason: `${args.source} diagnostic run has an unparsable finishedAt timestamp`,
    };
  }

  const ageMs = Math.max(0, args.checkedAtMs - finishedAtMs);
  if (ageMs > REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS) {
    return {
      ...base,
      ...runFields,
      state: "stale",
      reason: `${args.source} diagnostic run is older than ${REEF_DIAGNOSTIC_CACHE_STALE_AFTER_MS} ms`,
    };
  }
  if (args.staleFileCount > 0) {
    return {
      ...base,
      ...runFields,
      state: "stale",
      reason: `${args.staleFileCount} file(s) changed after the latest ${args.source} diagnostic run`,
    };
  }
  if (
    inputRevision !== undefined &&
    outputRevision !== undefined &&
    inputRevision !== outputRevision
  ) {
    return {
      ...base,
      ...runFields,
      state: "stale",
      reason: `${args.source} diagnostic run crossed revisions ${inputRevision} to ${outputRevision}`,
    };
  }
  if (
    outputRevision !== undefined &&
    args.currentRevision !== undefined &&
    outputRevision < args.currentRevision
  ) {
    return {
      ...base,
      ...runFields,
      state: "stale",
      reason: `${args.source} diagnostic run is at revision ${outputRevision}, current revision is ${args.currentRevision}`,
    };
  }

  return {
    ...base,
    ...runFields,
    state: args.run.findingCount > 0 ? "findings" : "clean",
    reason: args.run.findingCount > 0
      ? `${args.source} diagnostic run produced ${args.run.findingCount} finding(s)`
      : `${args.source} diagnostic run is clean`,
  };
}

function reefDiagnosticChangedAfterCheck(
  projectStore: ProjectStore,
  projectId: string,
  successfulRuns: readonly ReefDiagnosticRun[],
): ReefProjectDiagnosticStatus["changedAfterCheck"] {
  if (successfulRuns.length === 0) {
    return [];
  }
  const changed: ReefProjectDiagnosticStatus["changedAfterCheck"] = [];
  for (const fact of projectStore.queryReefFacts({
    projectId,
    overlay: "working_tree",
    source: "working_tree_overlay",
    kind: "file_snapshot",
    limit: 1000,
  })) {
    const filePath = filePathFromReefFact(fact);
    const lastModifiedAt = stringDataValue(fact.data, "lastModifiedAt");
    if (!filePath || !lastModifiedAt) {
      continue;
    }
    const modifiedMs = Date.parse(lastModifiedAt);
    if (!Number.isFinite(modifiedMs)) {
      continue;
    }
    const staleSources = successfulRuns
      .filter((run) => reefDiagnosticRunCoversFile(run, filePath))
      .filter((run) => {
        // Compare against startedAt: a file edited DURING a run was not part
        // of the input snapshot the run analyzed, even if the run finished
        // after the edit.
        const startedAtMs = Date.parse(run.startedAt);
        return Number.isFinite(startedAtMs) && modifiedMs > startedAtMs;
      })
      .map((run) => run.source);
    if (staleSources.length > 0) {
      changed.push({ filePath, lastModifiedAt, staleSources });
    }
  }
  return changed.sort((left, right) => right.lastModifiedAt.localeCompare(left.lastModifiedAt));
}

function reefDiagnosticRunCoversFile(run: ReefDiagnosticRun, filePath: string): boolean {
  const requestedFiles = stringArrayDiagnosticMetadata(run, "requestedFiles");
  return requestedFiles.length === 0 || requestedFiles.includes(filePath);
}

function numericDiagnosticMetadata(run: ReefDiagnosticRun, key: string): number | undefined {
  const value = run.metadata?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function stringArrayDiagnosticMetadata(run: ReefDiagnosticRun, key: string): string[] {
  const value = run.metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function filePathFromReefFact(fact: ProjectFact): string | undefined {
  switch (fact.subject.kind) {
    case "file":
    case "symbol":
    case "diagnostic":
      return fact.subject.path;
    case "import_edge":
      return fact.subject.sourcePath;
    case "route":
    case "schema_object":
      return stringDataValue(fact.data, "filePath") ?? stringDataValue(fact.data, "path");
  }
}

function stringDataValue(data: JsonObject | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function refreshFallbackReason(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || !("fallbackReason" in result)) {
    return undefined;
  }
  const value = (result as { fallbackReason?: unknown }).fallbackReason;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function refreshModeForResult(result: unknown): "path_scoped" | "full" {
  if (typeof result === "object" && result !== null && "mode" in result) {
    return (result as { mode?: unknown }).mode === "paths" ? "path_scoped" : "full";
  }
  return "full";
}

function refreshResultDetails(result: unknown): {
  refreshMode: "path_scoped" | "full";
  refreshedPathCount: number;
  deletedPathCount: number;
  fallbackReason?: string;
} {
  const refreshMode = refreshModeForResult(result);
  const fallbackReason = refreshFallbackReason(result);
  if (typeof result !== "object" || result === null) {
    return {
      refreshMode,
      refreshedPathCount: 0,
      deletedPathCount: 0,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  }
  const pathResult = result as { refreshedPaths?: unknown; deletedPaths?: unknown };
  return {
    refreshMode,
    refreshedPathCount: Array.isArray(pathResult.refreshedPaths) ? pathResult.refreshedPaths.length : 0,
    deletedPathCount: Array.isArray(pathResult.deletedPaths) ? pathResult.deletedPaths.length : 0,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function toReefProjectStatus(
  status: ProjectStatusResult,
  watch: ProjectIndexWatchState | undefined,
  hostId: string,
  serviceMode: ReefServiceMode,
  analysisState: ReefAnalysisStateRecord | null,
  queueState: ReefRootQueueState | undefined,
  eventBatchState: ReefRootEventBatchState | undefined,
  queryState: ReefRootQueryState | undefined,
  diagnostics: ReefProjectDiagnosticStatus,
  schema: ReefProjectSchemaStatus,
): ReefProjectStatus {
  const freshness = status.codeIndexFreshness;
  const dirtyPathCount = watch?.dirtyPaths.length ?? 0;
  const running = queueState?.running ?? (watch?.status === "indexing");
  const pendingEventBatches = eventBatchState && eventBatchState.events.length > 0 ? 1 : 0;
  const queued = (queueState?.queued ?? dirtyPathCount) + pendingEventBatches;
  const lastRunResult = queueState?.lastRunResult ?? indexRunStatusToWriterResult(status.latestRun?.status);

  return {
    projectId: status.project?.projectId ?? "",
    root: status.project?.canonicalPath ?? "",
    serviceMode,
    state: deriveReefProjectState(freshness, watch),
    analysis: {
      hostId,
      revisionState: analysisState ? "active" : "initializing",
      currentRevision: analysisState?.currentRevision,
      lastAppliedChangeSetId: analysisState?.lastAppliedChangeSetId,
      lastAppliedAt: analysisState?.lastAppliedAt,
      pendingChangeSets: queued + (running ? 1 : 0),
      runningQueryCount: queryState?.running.size ?? 0,
      canceledQueryCount: queryState?.canceledCount ?? 0,
      materializedRevision: analysisState?.materializedRevision,
    },
    watcher: {
      active: watch?.mode === "watch" && watch.status !== "failed" && watch.status !== "disabled",
      degraded: watch?.status === "failed" || watch?.status === "disabled",
      backend: "chokidar",
      dirtyPathCount,
      lastEventAt: watch?.lastEventAt,
      lastError: watch?.lastError ?? watch?.disabledReason,
      recrawlCount: analysisState?.watcherRecrawlCount ?? 0,
      lastRecrawlAt: analysisState?.lastRecrawlAt,
      lastRecrawlReason: analysisState?.lastRecrawlReason,
      lastRecrawlWarning: analysisState?.lastRecrawlWarning,
      lastCatchUpAt: watch?.lastCatchUpAt,
      lastCatchUpStatus: watch?.lastCatchUpStatus,
      lastCatchUpMethod: watch?.lastCatchUpMethod,
      lastCatchUpDurationMs: watch?.lastCatchUpDurationMs,
      lastCatchUpReason: watch?.lastCatchUpReason,
      lastCatchUpError: watch?.lastCatchUpError,
      state: watch,
    },
    writerQueue: {
      running,
      queued,
      activeKind: queueState?.activeKind ?? (running || queued > 0 ? "refresh" : undefined),
      lastRunAt: queueState?.lastRunAt ?? status.latestRun?.finishedAt ?? status.latestRun?.startedAt,
      lastRunTrigger: queueState?.lastRunTrigger ?? status.latestRun?.triggerSource,
      lastRunResult,
    },
    freshness: {
      checkedAt: freshness.checkedAt,
      indexedFiles: indexedFileCount(freshness),
      staleFiles: freshness.staleCount,
      deletedFiles: freshness.deletedCount,
      unknownFiles: freshness.unknownCount,
      unindexedFiles: freshness.unindexedCount,
      unindexedScan: "skipped",
    },
    diagnostics,
    schema,
  };
}

function deriveReefProjectState(
  freshness: IndexFreshnessSummary,
  watch: ProjectIndexWatchState | undefined,
): ReefProjectStatus["state"] {
  if (watch?.status === "failed") {
    return "error";
  }
  if (watch?.status === "disabled") {
    return "disabled";
  }
  if (watch?.status === "indexing") {
    return "refreshing";
  }
  if (watch?.status === "dirty" || watch?.status === "scheduled" || (watch?.dirtyPaths.length ?? 0) > 0) {
    return "dirty";
  }
  if (freshness.staleCount > 0 || freshness.deletedCount > 0 || freshness.unknownCount > 0) {
    return "stale";
  }
  if (freshness.state === "unknown") {
    return "unknown";
  }
  if (freshness.state === "dirty") {
    return "stale";
  }
  return "fresh";
}

function indexedFileCount(freshness: IndexFreshnessSummary): number {
  return freshness.freshCount + freshness.staleCount + freshness.deletedCount + freshness.unknownCount;
}

function indexRunStatusToWriterResult(
  status: IndexRunStatus | undefined,
): ReefProjectStatus["writerQueue"]["lastRunResult"] {
  if (status === "succeeded") {
    return "succeeded";
  }
  if (status === "failed") {
    return "failed";
  }
  return undefined;
}

function refreshMessage(result: unknown): string {
  const mode = typeof result === "object" && result !== null && "mode" in result
    ? (result as { mode?: unknown }).mode
    : undefined;
  const refreshedPaths = typeof result === "object" && result !== null && "refreshedPaths" in result
    ? (result as { refreshedPaths?: unknown }).refreshedPaths
    : undefined;
  const refreshedPathCount = Array.isArray(refreshedPaths) ? refreshedPaths.length : 0;

  if (mode === "paths") {
    return `path refresh completed for ${refreshedPathCount} path(s)`;
  }
  if (mode === "full") {
    return `full refresh completed after path fallback for ${refreshedPathCount} path(s)`;
  }
  return "full index refresh completed";
}

function lifecycleEventToOperation(
  project: AttachedProject,
  event: LifecycleEventRecord,
): ReefOperationLogEntry {
  const kind = lifecycleEventKind(event);
  return {
    id: event.eventId,
    projectId: event.projectId,
    root: project.canonicalPath,
    kind,
    severity: event.outcome === "failed" ? "error" : "info",
    message: lifecycleEventMessage(event),
    data: {
      eventType: event.eventType,
      outcome: event.outcome,
      startedAt: event.startedAt,
      finishedAt: event.finishedAt,
      durationMs: event.durationMs,
      ...(event.errorText ? { errorText: event.errorText } : {}),
      ...event.metadata,
    } as JsonObject,
    createdAt: event.finishedAt,
  };
}

function lifecycleEventKind(event: LifecycleEventRecord): ReefOperationKind {
  if (event.eventType === "project_index" || event.eventType === "schema_snapshot_build") {
    return event.outcome === "failed" ? "refresh_failed" : "refresh_completed";
  }
  if (event.eventType === "schema_snapshot_refresh") {
    return event.outcome === "failed" ? "refresh_failed" : "refresh_completed";
  }
  if (event.eventType === "project_attach" || event.eventType === "project_detach") {
    return "project_registry";
  }
  return event.outcome === "failed" ? "degraded_state" : "refresh_decision";
}

function diagnosticRunToOperation(
  project: AttachedProject,
  run: ReefDiagnosticRun,
): ReefOperationLogEntry {
  return {
    id: run.runId,
    projectId: run.projectId,
    root: project.canonicalPath,
    kind: "diagnostic_source",
    severity: diagnosticRunSeverity(run),
    message: `reef diagnostic source ${run.source} ${run.status}`,
    data: {
      source: run.source,
      overlay: run.overlay,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      checkedFileCount: run.checkedFileCount ?? null,
      findingCount: run.findingCount,
      persistedFindingCount: run.persistedFindingCount,
      ...(run.command ? { command: run.command } : {}),
      ...(run.configPath ? { configPath: run.configPath } : {}),
      ...(run.errorText ? { errorText: run.errorText } : {}),
      ...(run.metadata ? { metadata: run.metadata } : {}),
    } as JsonObject,
    createdAt: run.finishedAt,
  };
}

function diagnosticRunSeverity(run: ReefDiagnosticRun): ReefOperationLogEntry["severity"] {
  if (run.status === "ran_with_error") {
    return "error";
  }
  if (run.status === "unavailable") {
    return "warning";
  }
  return "info";
}

function lifecycleEventMessage(event: LifecycleEventRecord): string {
  const label = event.eventType.replace(/_/g, " ");
  return `${label} ${event.outcome}`;
}
