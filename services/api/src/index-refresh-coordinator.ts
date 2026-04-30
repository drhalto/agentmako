import chokidar, { type FSWatcher } from "chokidar";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, type MakoConfig } from "@mako-ai/config";
import type {
  AttachedProject,
  DiagnosticRefreshSource,
  ProjectIndexWatchCatchUpResult,
  ProjectIndexWatchState,
  ReefAnalysisHost,
  ReefProjectEvent,
} from "@mako-ai/contracts";
import {
  createReefClient,
  isIgnoredProjectRelativePath,
  isWatchableProjectPath,
  toProjectIndexRelativePath,
} from "@mako-ai/indexer";
import { createLogger } from "@mako-ai/logger";
import { openProjectStore, type ProjectStoreCache } from "@mako-ai/store";
import { diagnosticRefreshTool, workingTreeOverlayTool } from "@mako-ai/tools";

export const MAKO_INDEX_WATCH_DEBOUNCE_MS = 3000;
export const MAKO_INDEX_WATCH_MAX_DELAY_MS = 60000;
export const MAKO_INDEX_WATCH_MAX_FILES = 20000;
export const MAKO_INDEX_WATCH_CATCH_UP_DEFAULT_MS = 750;
export const MAKO_INDEX_WATCH_CATCH_UP_MAX_MS = 1500;
export const MAKO_INDEX_WATCH_DIAGNOSTIC_MAX_FILES = 50;

const WATCH_CATCH_UP_COOKIE_PREFIX = ".mako-reef-watch-cookie-";
const WATCH_DIRTY_PATH_LIMIT = 50;
const OVERLAY_UPDATE_BATCH_SIZE = 500;
const DEFAULT_WATCH_DIAGNOSTIC_SOURCES = [
  "lint_files",
  "programmatic_findings",
  "typescript_syntax",
  "typescript",
] as const satisfies readonly DiagnosticRefreshSource[];
const WATCH_DIAGNOSTIC_SOURCE_VALUES = [
  "lint_files",
  "typescript_syntax",
  "typescript",
  "eslint",
  "oxlint",
  "biome",
  "git_precommit_check",
  "programmatic_findings",
] as const satisfies readonly DiagnosticRefreshSource[];
const watchLogger = createLogger("mako-api", { component: "index-refresh-coordinator" });

export interface ProjectIndexRefreshCoordinatorOptions {
  configOverrides?: Partial<MakoConfig>;
  projectStoreCache?: ProjectStoreCache;
}

interface PendingCatchUpCookie {
  projectId: string;
  relativePath: string;
  maxWaitMs: number;
  reason: string;
  startedAt: string;
  startedAtMs: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: ProjectIndexWatchCatchUpResult) => void;
}

export class ProjectIndexRefreshCoordinator {
  private readonly debounceMs: number;
  private readonly maxDelayMs: number;
  private readonly maxFiles: number;
  private readonly enabled: boolean;
  private readonly diagnosticsEnabled: boolean;
  private readonly diagnosticSources: DiagnosticRefreshSource[];
  private readonly diagnosticMaxFiles: number;
  private watcher: FSWatcher | undefined;
  private activeProject: AttachedProject | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private maxDelayTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly dirtyPaths = new Set<string>();
  private readonly latestEventKinds = new Map<string, ReefProjectEvent["kind"]>();
  private indexing = false;
  private followUpQueued = false;
  private closed = false;
  private refreshPromise: Promise<void> | undefined;
  private readonly reefService: ReefAnalysisHost;
  private readonly pendingCatchUps = new Map<string, PendingCatchUpCookie>();
  private state: ProjectIndexWatchState = {
    mode: "off",
    status: "idle",
    dirtyPaths: [],
  };

  constructor(private readonly options: ProjectIndexRefreshCoordinatorOptions = {}) {
    this.enabled = envBoolean("MAKO_INDEX_WATCH", true);
    this.debounceMs = envNumber("MAKO_INDEX_WATCH_DEBOUNCE_MS", MAKO_INDEX_WATCH_DEBOUNCE_MS);
    this.maxDelayMs = envNumber("MAKO_INDEX_WATCH_MAX_DELAY_MS", MAKO_INDEX_WATCH_MAX_DELAY_MS);
    this.maxFiles = envNumber("MAKO_INDEX_WATCH_MAX_FILES", MAKO_INDEX_WATCH_MAX_FILES);
    this.diagnosticsEnabled = envBoolean("MAKO_INDEX_WATCH_DIAGNOSTICS", true);
    this.diagnosticSources = envDiagnosticSources(
      "MAKO_INDEX_WATCH_DIAGNOSTIC_SOURCES",
      DEFAULT_WATCH_DIAGNOSTIC_SOURCES,
    );
    this.diagnosticMaxFiles = envNumber(
      "MAKO_INDEX_WATCH_DIAGNOSTIC_MAX_FILES",
      MAKO_INDEX_WATCH_DIAGNOSTIC_MAX_FILES,
    );
    this.reefService = createReefClient({
      configOverrides: options.configOverrides,
      projectStoreCache: options.projectStoreCache,
    });
  }

  getWatchState(projectId?: string): ProjectIndexWatchState | undefined {
    if (projectId && this.state.projectId && this.state.projectId !== projectId) {
      return undefined;
    }
    return {
      ...this.state,
      dirtyPaths: this.visibleDirtyPaths(),
    };
  }

  async waitForCatchUp(
    projectId: string,
    options: { maxWaitMs?: number; reason?: string } = {},
  ): Promise<ProjectIndexWatchCatchUpResult> {
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const maxWaitMs = clampWaitMs(
      options.maxWaitMs ?? MAKO_INDEX_WATCH_CATCH_UP_DEFAULT_MS,
      MAKO_INDEX_WATCH_CATCH_UP_MAX_MS,
    );
    const reason = options.reason ?? "wait_for_refresh";
    const project = this.activeProject;

    if (!project || project.projectId !== projectId) {
      return {
        status: "skipped",
        method: "none",
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        maxWaitMs,
        reason: "watcher is not active for the requested project",
      };
    }
    if (!this.watcher || this.state.mode !== "watch") {
      return this.recordCatchUpResult({
        status: "skipped",
        method: "none",
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        maxWaitMs,
        reason: "watcher is not active for the requested project",
      });
    }
    if (this.state.status === "disabled" || this.state.status === "failed") {
      return this.recordCatchUpResult({
        status: "skipped",
        method: "none",
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        maxWaitMs,
        reason: this.state.lastError ?? this.state.disabledReason ?? "watcher is not healthy",
        ...(this.state.lastError ? { error: this.state.lastError } : {}),
      });
    }
    if (maxWaitMs === 0) {
      return this.recordCatchUpResult({
        status: "skipped",
        method: "none",
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        maxWaitMs,
        reason: "catch-up timeout budget is zero",
      });
    }

    const relativePath = `${WATCH_CATCH_UP_COOKIE_PREFIX}${Date.now()}-${randomUUID()}.tmp`;
    const absolutePath = path.join(project.canonicalPath, relativePath);
    const result = await new Promise<ProjectIndexWatchCatchUpResult>((resolve) => {
      const finish = (result: ProjectIndexWatchCatchUpResult): void => {
        const pending = this.pendingCatchUps.get(relativePath);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timer);
        this.pendingCatchUps.delete(relativePath);
        void rm(absolutePath, { force: true }).catch(() => undefined);
        resolve(this.recordCatchUpResult(result));
      };
      const timer = setTimeout(() => {
        finish({
          status: "timed_out",
          method: "watcher_cookie",
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAtMs),
          maxWaitMs,
          reason,
          cookiePath: relativePath,
          error: `watcher did not observe catch-up cookie within ${maxWaitMs}ms`,
        });
      }, maxWaitMs);
      timer.unref?.();
      this.pendingCatchUps.set(relativePath, {
        projectId,
        relativePath,
        maxWaitMs,
        reason,
        startedAt,
        startedAtMs,
        timer,
        resolve,
      });
      void writeFile(absolutePath, `${startedAt}\n`, "utf8").catch((error) => {
        finish({
          status: "skipped",
          method: "none",
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAtMs),
          maxWaitMs,
          reason,
          cookiePath: relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    if (result.status === "succeeded") {
      await this.flushObservedDirtyPathsForCatchUp(project, reason);
    }
    return result;
  }

  async setActiveProject(project: AttachedProject): Promise<void> {
    if (this.closed) return;
    if (this.activeProject?.projectId === project.projectId) {
      return;
    }

    const previousProjectId = this.activeProject?.projectId;
    await this.stopWatcher(previousProjectId ? "switched" : "stopped");
    this.activeProject = project;

    if (!this.enabled) {
      this.setState({
        mode: "off",
        status: "disabled",
        projectId: project.projectId,
        projectRoot: project.canonicalPath,
        dirtyPaths: [],
        transition: previousProjectId ? "switched" : "started",
        ...(previousProjectId ? { switchFromProjectId: previousProjectId } : {}),
        disabledReason: "MAKO_INDEX_WATCH is disabled",
      });
      return;
    }

    const indexedFileCount = this.getIndexedFileCount(project);
    if (indexedFileCount > this.maxFiles) {
      this.setState({
        mode: "off",
        status: "disabled",
        projectId: project.projectId,
        projectRoot: project.canonicalPath,
        dirtyPaths: [],
        transition: previousProjectId ? "switched" : "started",
        ...(previousProjectId ? { switchFromProjectId: previousProjectId } : {}),
        disabledReason: `project has ${indexedFileCount} indexed files, above MAKO_INDEX_WATCH_MAX_FILES=${this.maxFiles}`,
      });
      return;
    }

    const watcher = chokidar.watch(project.canonicalPath, {
      ignoreInitial: true,
      persistent: true,
      ignored: (candidatePath, stats) => this.shouldIgnorePath(project, candidatePath, stats),
    });
    this.watcher = watcher;
    watcher.on("all", (eventName, candidatePath) => {
      if (this.handleCatchUpCookieEvent(project, candidatePath)) {
        return;
      }
      this.handleFileEvent(project, eventName, candidatePath);
    });
    watcher.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const repair = this.state.status === "failed" ? "none" : "full_refresh";
      watchLogger.warn("watcher-error", { projectId: project.projectId, error: message });
      void this.reefService.recordWatcherRecrawl({
        projectId: project.projectId,
        reason: "watcher_error",
        warning: message,
        repair,
      }).catch((recrawlError) => {
        watchLogger.warn("watcher-recrawl-record-failed", {
          projectId: project.projectId,
          error: recrawlError instanceof Error ? recrawlError.message : String(recrawlError),
        });
      });
      this.setState({
        ...this.state,
        mode: "watch",
        status: "failed",
        projectId: project.projectId,
        projectRoot: project.canonicalPath,
        lastError: message,
      });
      this.resolvePendingCatchUps(`watcher error: ${message}`);
    });

    await this.waitForWatcherReady(watcher);
    if (this.closed || this.watcher !== watcher || this.activeProject?.projectId !== project.projectId) {
      return;
    }

    this.setState({
      mode: "watch",
      status: "idle",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      dirtyPaths: [],
      transition: previousProjectId ? "switched" : "started",
      ...(previousProjectId ? { switchFromProjectId: previousProjectId } : {}),
    });
  }

  private async waitForWatcherReady(watcher: FSWatcher): Promise<void> {
    await new Promise<void>((resolve) => {
      const done = () => {
        watcher.off("ready", done);
        watcher.off("error", done);
        resolve();
      };
      watcher.once("ready", done);
      watcher.once("error", done);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    const refreshPromise = this.refreshPromise;
    if (refreshPromise) {
      await refreshPromise.catch(() => undefined);
    }
    await this.stopWatcher("stopped");
    await this.reefService.stop().catch(() => undefined);
    this.activeProject = undefined;
  }

  private shouldIgnorePath(
    project: AttachedProject,
    candidatePath: string,
    stats?: { isDirectory(): boolean; isFile(): boolean },
  ): boolean {
    const relativePath = toProjectIndexRelativePath(project.canonicalPath, candidatePath);
    if (!relativePath || relativePath === ".") {
      return false;
    }
    if (isCatchUpCookiePath(relativePath)) {
      return false;
    }
    if (stats?.isDirectory()) {
      return isIgnoredProjectRelativePath(relativePath);
    }
    if (stats?.isFile()) {
      return !isWatchableProjectPath(relativePath);
    }
    return isIgnoredProjectRelativePath(relativePath);
  }

  private handleCatchUpCookieEvent(project: AttachedProject, candidatePath: string): boolean {
    const relativePath = toProjectIndexRelativePath(project.canonicalPath, candidatePath);
    if (!relativePath || !isCatchUpCookiePath(relativePath)) {
      return false;
    }
    const pending = this.pendingCatchUps.get(relativePath);
    if (!pending || pending.projectId !== project.projectId) {
      return true;
    }
    clearTimeout(pending.timer);
    this.pendingCatchUps.delete(relativePath);
    void rm(path.join(project.canonicalPath, relativePath), { force: true }).catch(() => undefined);
    pending.resolve(this.recordCatchUpResult({
      status: "succeeded",
      method: "watcher_cookie",
      startedAt: pending.startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - pending.startedAtMs),
      maxWaitMs: pending.maxWaitMs,
      reason: pending.reason,
      cookiePath: relativePath,
    }));
    return true;
  }

  private async flushObservedDirtyPathsForCatchUp(project: AttachedProject, reason: string): Promise<void> {
    const triggerSource = `${reason}:catch_up`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.closed || this.activeProject?.projectId !== project.projectId) {
        return;
      }
      if (this.indexing) {
        await this.refreshPromise?.catch(() => undefined);
      }
      if (this.dirtyPaths.size === 0) {
        return;
      }
      await this.runRefresh(project, triggerSource);
    }
  }

  private handleFileEvent(project: AttachedProject, eventName: string, candidatePath: string): void {
    if (this.closed || this.activeProject?.projectId !== project.projectId) {
      return;
    }

    const relativePath = toProjectIndexRelativePath(project.canonicalPath, candidatePath);
    if (!relativePath || relativePath === "." || !isWatchableProjectPath(relativePath)) {
      return;
    }

    this.dirtyPaths.add(relativePath);
    const lastEventAt = new Date().toISOString();
    this.setState({
      ...this.state,
      mode: "watch",
      status: this.indexing ? "indexing" : "dirty",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      dirtyPaths: this.visibleDirtyPaths(),
      lastEventAt,
    });

    this.latestEventKinds.set(relativePath, reefEventKindForWatcherEvent(eventName));
    if (this.indexing) {
      this.followUpQueued = true;
      return;
    }

    this.scheduleRefresh(project);
  }

  private scheduleRefresh(project: AttachedProject): void {
    if (this.closed || this.indexing) return;
    this.clearDebounceTimer();

    const scheduledFor = new Date(Date.now() + this.debounceMs).toISOString();
    this.debounceTimer = setTimeout(() => {
      this.startRefresh(project, "watch_paths");
    }, this.debounceMs);

    if (!this.maxDelayTimer) {
      this.maxDelayTimer = setTimeout(() => {
        this.startRefresh(project, "watch_paths_max_delay");
      }, this.maxDelayMs);
    }

    this.setState({
      ...this.state,
      mode: "watch",
      status: "scheduled",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      dirtyPaths: this.visibleDirtyPaths(),
      scheduledFor,
    });
  }

  private startRefresh(project: AttachedProject, triggerSource: string): void {
    const refreshPromise = this.runRefresh(project, triggerSource);
    this.refreshPromise = refreshPromise;
    void refreshPromise.finally(() => {
      if (this.refreshPromise === refreshPromise) {
        this.refreshPromise = undefined;
      }
    });
  }

  private async runRefresh(project: AttachedProject, triggerSource: string): Promise<void> {
    if (this.closed || this.indexing || this.activeProject?.projectId !== project.projectId) {
      return;
    }
    if (this.dirtyPaths.size === 0) {
      this.setState({
        ...this.state,
        status: "idle",
        scheduledFor: undefined,
        dirtyPaths: [],
      });
      return;
    }

    const dirtyAtStart = [...this.dirtyPaths];
    this.dirtyPaths.clear();
    this.followUpQueued = false;
    this.clearTimers();
    this.indexing = true;
    const startedAt = new Date().toISOString();
    this.setState({
      ...this.state,
      mode: "watch",
      status: "indexing",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      dirtyPaths: dirtyAtStart.slice(0, WATCH_DIRTY_PATH_LIMIT),
      scheduledFor: undefined,
      lastRefreshStartedAt: startedAt,
      lastError: undefined,
    });

    try {
      const overlayResult = await this.updateWorkingTreeOverlay(project, dirtyAtStart);
      await this.reefService.submitEvent(this.createWatcherEvent(project, dirtyAtStart, triggerSource, startedAt));
      await this.refreshDiagnosticsForWatch(project, dirtyAtStart, overlayResult.deletedFiles);
      const refreshSummary = await this.latestRefreshSummary(project.projectId);
      const finishedAt = new Date().toISOString();
      this.indexing = false;
      this.setState({
        ...this.state,
        mode: "watch",
        status: this.dirtyPaths.size > 0 || this.followUpQueued ? "dirty" : "idle",
        projectId: project.projectId,
        projectRoot: project.canonicalPath,
        dirtyPaths: this.visibleDirtyPaths(),
        lastRefreshFinishedAt: finishedAt,
        lastRefreshMode: refreshSummary.refreshMode ?? "paths",
        lastRefreshFallbackReason: refreshSummary.fallbackReason,
        lastRefreshPathCount: refreshSummary.refreshedPathCount ?? dirtyAtStart.length,
        lastRefreshDeletedPathCount: refreshSummary.deletedPathCount ?? overlayResult.deletedFileCount,
      });
      if (this.dirtyPaths.size > 0 || this.followUpQueued) {
        this.scheduleRefresh(project);
      }
    } catch (error) {
      this.indexing = false;
      for (const dirtyPath of dirtyAtStart) {
        this.dirtyPaths.add(dirtyPath);
      }
      const message = error instanceof Error ? error.message : String(error);
      watchLogger.warn("refresh-failed", { projectId: project.projectId, error: message });
      this.setState({
        ...this.state,
        mode: "watch",
        status: "failed",
        projectId: project.projectId,
        projectRoot: project.canonicalPath,
        dirtyPaths: this.visibleDirtyPaths(),
        lastError: message,
      });
    }
  }

  private async updateWorkingTreeOverlay(
    project: AttachedProject,
    dirtyPaths: string[],
  ): Promise<{ deletedFileCount: number; deletedFiles: string[] }> {
    if (dirtyPaths.length === 0) return { deletedFileCount: 0, deletedFiles: [] };

    const startedAtMs = Date.now();
    try {
      let factCount = 0;
      const deletedFiles: string[] = [];
      for (let start = 0; start < dirtyPaths.length; start += OVERLAY_UPDATE_BATCH_SIZE) {
        const files = dirtyPaths.slice(start, start + OVERLAY_UPDATE_BATCH_SIZE);
        const output = await workingTreeOverlayTool(
          {
            projectId: project.projectId,
            files,
            maxFiles: files.length,
          },
          {
            configOverrides: this.options.configOverrides,
            projectStoreCache: this.options.projectStoreCache,
          },
        );
        factCount += output.facts.length;
        deletedFiles.push(...output.deletedFiles);
      }
      const resolvedFindingCount = this.resolveDeletedReefFindings(
        project,
        deletedFiles,
      );
      this.setState({
        ...this.state,
        lastOverlayFactUpdatedAt: new Date().toISOString(),
        lastOverlayFactCount: factCount,
        lastOverlayResolvedFindingCount: resolvedFindingCount,
        lastOverlayFactDurationMs: Math.max(0, Date.now() - startedAtMs),
        lastOverlayFactError: undefined,
      });
      return {
        deletedFileCount: deletedFiles.length,
        deletedFiles,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      watchLogger.warn("overlay-fact-update-failed", {
        projectId: project.projectId,
        error: message,
      });
      this.setState({
        ...this.state,
        lastOverlayFactError: message,
      });
      return { deletedFileCount: 0, deletedFiles: [] };
    }
  }

  private async refreshDiagnosticsForWatch(
    project: AttachedProject,
    dirtyPaths: readonly string[],
    deletedFiles: readonly string[],
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const skipped = (reason: string): void => {
      this.setState({
        ...this.state,
        lastDiagnosticRefreshStartedAt: startedAt,
        lastDiagnosticRefreshFinishedAt: new Date().toISOString(),
        lastDiagnosticRefreshDurationMs: Math.max(0, Date.now() - startedAtMs),
        lastDiagnosticRefreshFileCount: 0,
        lastDiagnosticRefreshSources: [],
        lastDiagnosticRefreshSucceededSources: 0,
        lastDiagnosticRefreshFailedSources: 0,
        lastDiagnosticRefreshUnavailableSources: 0,
        lastDiagnosticRefreshSkippedReason: reason,
        lastDiagnosticRefreshError: undefined,
      });
    };

    if (!this.diagnosticsEnabled) {
      skipped("MAKO_INDEX_WATCH_DIAGNOSTICS is disabled");
      return;
    }

    const deletedSet = new Set(deletedFiles);
    const files = [...new Set(dirtyPaths)]
      .filter((filePath) => !deletedSet.has(filePath))
      .filter(isDiagnosticSourcePath);
    if (files.length === 0) {
      skipped("no changed diagnostic source files");
      return;
    }
    if (files.length > this.diagnosticMaxFiles) {
      skipped(`changed diagnostic file count ${files.length} exceeds MAKO_INDEX_WATCH_DIAGNOSTIC_MAX_FILES=${this.diagnosticMaxFiles}`);
      return;
    }

    const sources = this.effectiveDiagnosticSources(project);
    if (sources.length === 0) {
      skipped("no watch diagnostic sources are enabled for this project");
      return;
    }

    try {
      const output = await diagnosticRefreshTool(
        {
          projectId: project.projectId,
          files,
          sources,
          continueOnError: true,
        },
        {
          configOverrides: this.options.configOverrides,
          projectStoreCache: this.options.projectStoreCache,
        },
      );
      this.setState({
        ...this.state,
        lastDiagnosticRefreshStartedAt: startedAt,
        lastDiagnosticRefreshFinishedAt: new Date().toISOString(),
        lastDiagnosticRefreshDurationMs: Math.max(0, Date.now() - startedAtMs),
        lastDiagnosticRefreshFileCount: files.length,
        lastDiagnosticRefreshSources: sources,
        lastDiagnosticRefreshSucceededSources: output.summary.succeededSources,
        lastDiagnosticRefreshFailedSources: output.summary.failedSources,
        lastDiagnosticRefreshUnavailableSources: output.summary.unavailableSources,
        lastDiagnosticRefreshSkippedReason: undefined,
        lastDiagnosticRefreshError: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      watchLogger.warn("diagnostic-refresh-failed", { projectId: project.projectId, error: message });
      this.setState({
        ...this.state,
        lastDiagnosticRefreshStartedAt: startedAt,
        lastDiagnosticRefreshFinishedAt: new Date().toISOString(),
        lastDiagnosticRefreshDurationMs: Math.max(0, Date.now() - startedAtMs),
        lastDiagnosticRefreshFileCount: files.length,
        lastDiagnosticRefreshSources: sources,
        lastDiagnosticRefreshSucceededSources: 0,
        lastDiagnosticRefreshFailedSources: sources.length,
        lastDiagnosticRefreshUnavailableSources: 0,
        lastDiagnosticRefreshSkippedReason: undefined,
        lastDiagnosticRefreshError: message,
      });
    }
  }

  private effectiveDiagnosticSources(project: AttachedProject): DiagnosticRefreshSource[] {
    const hasTsconfig = existsSync(path.join(project.canonicalPath, "tsconfig.json"));
    return this.diagnosticSources.filter((source) => source !== "typescript" || hasTsconfig);
  }

  private createWatcherEvent(
    project: AttachedProject,
    dirtyPaths: string[],
    triggerSource: string,
    observedAt: string,
  ): ReefProjectEvent {
    const eventKinds = new Set(dirtyPaths.map((filePath) => this.latestEventKinds.get(filePath)));
    const kind = eventKinds.size === 1 && eventKinds.has("reef.file.deleted")
      ? "reef.file.deleted"
      : "reef.file.changed";
    for (const dirtyPath of dirtyPaths) {
      this.latestEventKinds.delete(dirtyPath);
    }
    return {
      eventId: `reef_watch_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      projectId: project.projectId,
      root: project.canonicalPath,
      kind,
      paths: dirtyPaths,
      observedAt,
      data: {
        producer: "project_watcher",
        triggerSource,
        flushImmediately: true,
      },
    };
  }

  private async latestRefreshSummary(projectId: string): Promise<{
    refreshMode?: "paths" | "full";
    fallbackReason?: string;
    refreshedPathCount?: number;
    deletedPathCount?: number;
  }> {
    const [operation] = await this.reefService.listOperations({
      projectId,
      kind: "refresh_completed",
      limit: 1,
    }).catch(() => []);
    const data = operation?.data;
    const refreshMode = data?.refreshMode === "full" ? "full" : data?.refreshMode === "path_scoped" ? "paths" : undefined;
    const fallbackReason = typeof data?.fallbackReason === "string" ? data.fallbackReason : undefined;
    const refreshedPathCount = typeof data?.refreshedPathCount === "number" ? data.refreshedPathCount : undefined;
    const deletedPathCount = typeof data?.deletedPathCount === "number" ? data.deletedPathCount : undefined;
    return {
      ...(refreshMode ? { refreshMode } : {}),
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(refreshedPathCount != null ? { refreshedPathCount } : {}),
      ...(deletedPathCount != null ? { deletedPathCount } : {}),
    };
  }

  private resolveDeletedReefFindings(
    project: AttachedProject,
    deletedFiles: readonly string[],
  ): number {
    if (deletedFiles.length === 0) return 0;

    const storeOptions = this.projectStoreOptions(project);
    if (this.options.projectStoreCache) {
      return this.options.projectStoreCache.borrow(storeOptions).resolveReefFindingsForDeletedFiles({
        projectId: project.projectId,
        filePaths: [...deletedFiles],
        overlays: ["indexed", "working_tree"],
        reason: "watcher observed deleted file",
      });
    }

    const projectStore = openProjectStore(storeOptions);
    try {
      return projectStore.resolveReefFindingsForDeletedFiles({
        projectId: project.projectId,
        filePaths: [...deletedFiles],
        overlays: ["indexed", "working_tree"],
        reason: "watcher observed deleted file",
      });
    } finally {
      projectStore.close();
    }
  }

  private async stopWatcher(transition: ProjectIndexWatchState["transition"]): Promise<void> {
    this.clearTimers();
    this.resolvePendingCatchUps("watcher stopped before catch-up completed");
    this.dirtyPaths.clear();
    this.latestEventKinds.clear();
    this.indexing = false;
    this.followUpQueued = false;

    const watcher = this.watcher;
    this.watcher = undefined;
    if (watcher) {
      await watcher.close();
    }

    this.setState({
      mode: "off",
      status: "idle",
      dirtyPaths: [],
      ...(transition ? { transition } : {}),
    });
  }

  private getIndexedFileCount(project: AttachedProject): number {
    const storeOptions = this.projectStoreOptions(project);
    if (this.options.projectStoreCache) {
      return this.options.projectStoreCache.borrow(storeOptions).listFiles().length;
    }

    const projectStore = openProjectStore(storeOptions);
    try {
      return projectStore.listFiles().length;
    } finally {
      projectStore.close();
    }
  }

  private projectStoreOptions(project: AttachedProject): {
    projectRoot: string;
    stateDirName?: string;
    projectDbFilename?: string;
  } {
    const config = loadConfig(this.options.configOverrides);
    return {
      projectRoot: project.canonicalPath,
      stateDirName: config.stateDirName,
      projectDbFilename: config.projectDbFilename,
    };
  }

  private setState(state: ProjectIndexWatchState): void {
    this.state = {
      ...state,
      dirtyPaths: state.dirtyPaths.slice(0, WATCH_DIRTY_PATH_LIMIT),
    };
  }

  private visibleDirtyPaths(): string[] {
    return [...this.dirtyPaths].slice(0, WATCH_DIRTY_PATH_LIMIT);
  }

  private recordCatchUpResult(result: ProjectIndexWatchCatchUpResult): ProjectIndexWatchCatchUpResult {
    this.setState({
      ...this.state,
      lastCatchUpAt: result.finishedAt,
      lastCatchUpStatus: result.status,
      lastCatchUpMethod: result.method,
      lastCatchUpDurationMs: result.durationMs,
      lastCatchUpReason: result.reason,
      lastCatchUpError: result.error,
    });
    return result;
  }

  private resolvePendingCatchUps(error: string): void {
    const projectRoot = this.activeProject?.canonicalPath;
    for (const pending of [...this.pendingCatchUps.values()]) {
      clearTimeout(pending.timer);
      this.pendingCatchUps.delete(pending.relativePath);
      if (projectRoot) {
        void rm(path.join(projectRoot, pending.relativePath), { force: true }).catch(() => undefined);
      }
      const finishedAt = new Date().toISOString();
      pending.resolve(this.recordCatchUpResult({
        status: "skipped",
        method: "none",
        startedAt: pending.startedAt,
        finishedAt,
        durationMs: Math.max(0, Date.now() - pending.startedAtMs),
        maxWaitMs: pending.maxWaitMs,
        reason: pending.reason,
        cookiePath: pending.relativePath,
        error,
      }));
    }
  }

  private clearTimers(): void {
    this.clearDebounceTimer();
    if (this.maxDelayTimer) {
      clearTimeout(this.maxDelayTimer);
      this.maxDelayTimer = undefined;
    }
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}

export function createProjectIndexRefreshCoordinator(
  options: ProjectIndexRefreshCoordinatorOptions = {},
): ProjectIndexRefreshCoordinator {
  return new ProjectIndexRefreshCoordinator(options);
}

function envBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value.trim() === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envDiagnosticSources(
  name: string,
  fallback: readonly DiagnosticRefreshSource[],
): DiagnosticRefreshSource[] {
  const value = process.env[name];
  if (value == null || value.trim() === "") return [...fallback];
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no", "none"].includes(normalized)) return [];
  const sources = value
    .split(",")
    .map((source) => source.trim())
    .filter(isDiagnosticRefreshSource);
  return sources.length > 0 ? [...new Set(sources)] : [...fallback];
}

function isDiagnosticRefreshSource(source: string): source is DiagnosticRefreshSource {
  return WATCH_DIAGNOSTIC_SOURCE_VALUES.includes(source as DiagnosticRefreshSource);
}

function isDiagnosticSourcePath(relativePath: string): boolean {
  switch (path.extname(relativePath).toLowerCase()) {
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".mts":
    case ".cts":
    case ".mjs":
    case ".cjs":
      return true;
    default:
      return false;
  }
}

function isCatchUpCookiePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return !normalized.includes("/") && normalized.startsWith(WATCH_CATCH_UP_COOKIE_PREFIX);
}

function clampWaitMs(value: number, maxValue: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return MAKO_INDEX_WATCH_CATCH_UP_DEFAULT_MS;
  }
  return Math.min(Math.floor(value), maxValue);
}

function reefEventKindForWatcherEvent(eventName: string): ReefProjectEvent["kind"] {
  if (eventName === "add") {
    return "reef.file.added";
  }
  if (eventName === "unlink") {
    return "reef.file.deleted";
  }
  return "reef.file.changed";
}
