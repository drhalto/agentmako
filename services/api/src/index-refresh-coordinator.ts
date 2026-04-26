import chokidar, { type FSWatcher } from "chokidar";
import { loadConfig, type MakoConfig } from "@mako-ai/config";
import type { AttachedProject, ProjectIndexWatchState } from "@mako-ai/contracts";
import {
  isIgnoredProjectRelativePath,
  isWatchableProjectPath,
  refreshProjectPaths,
  toProjectIndexRelativePath,
} from "@mako-ai/indexer";
import { createLogger } from "@mako-ai/logger";
import { openProjectStore, type ProjectStoreCache } from "@mako-ai/store";
import { workingTreeOverlayTool } from "@mako-ai/tools";

export const MAKO_INDEX_WATCH_DEBOUNCE_MS = 3000;
export const MAKO_INDEX_WATCH_MAX_DELAY_MS = 60000;
export const MAKO_INDEX_WATCH_MAX_FILES = 20000;

const WATCH_DIRTY_PATH_LIMIT = 50;
const OVERLAY_UPDATE_BATCH_SIZE = 500;
const watchLogger = createLogger("mako-api", { component: "index-refresh-coordinator" });

export interface ProjectIndexRefreshCoordinatorOptions {
  configOverrides?: Partial<MakoConfig>;
  projectStoreCache?: ProjectStoreCache;
}

export class ProjectIndexRefreshCoordinator {
  private readonly debounceMs: number;
  private readonly maxDelayMs: number;
  private readonly maxFiles: number;
  private readonly enabled: boolean;
  private watcher: FSWatcher | undefined;
  private activeProject: AttachedProject | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private maxDelayTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly dirtyPaths = new Set<string>();
  private indexing = false;
  private followUpQueued = false;
  private closed = false;
  private refreshPromise: Promise<void> | undefined;
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
    watcher.on("all", (_eventName, candidatePath) => {
      this.handleFileEvent(project, candidatePath);
    });
    watcher.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      watchLogger.warn("watcher-error", { projectId: project.projectId, error: message });
      this.setState({
        ...this.state,
        mode: "watch",
        status: "failed",
        projectId: project.projectId,
        projectRoot: project.canonicalPath,
        lastError: message,
      });
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
    if (stats?.isDirectory()) {
      return isIgnoredProjectRelativePath(relativePath);
    }
    if (stats?.isFile()) {
      return !isWatchableProjectPath(relativePath);
    }
    return isIgnoredProjectRelativePath(relativePath);
  }

  private handleFileEvent(project: AttachedProject, candidatePath: string): void {
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
      await this.updateWorkingTreeOverlay(project, dirtyAtStart);
      const refreshResult = await refreshProjectPaths(project.canonicalPath, dirtyAtStart, {
        configOverrides: this.options.configOverrides,
        projectStoreCache: this.options.projectStoreCache,
        triggerSource,
      });
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
        lastRefreshMode: refreshResult.mode,
        lastRefreshFallbackReason: refreshResult.fallbackReason,
        lastRefreshPathCount: refreshResult.refreshedPaths.length,
        lastRefreshDeletedPathCount: refreshResult.deletedPaths.length,
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
  ): Promise<void> {
    if (dirtyPaths.length === 0) return;

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
    }
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
    this.dirtyPaths.clear();
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
