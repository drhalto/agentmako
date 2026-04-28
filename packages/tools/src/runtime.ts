import type {
  AttachedProject,
  JsonObject,
  ProjectIndexWatchCatchUpResult,
  ProjectIndexWatchState,
  ProjectProfile,
  ReefService,
} from "@mako-ai/contracts";
import type {
  GlobalStore,
  ProjectStore,
  ProjectStoreCache,
  SaveAnswerTrustRunOptions,
} from "@mako-ai/store";
import type { ProgressReporter } from "./progress/types.js";
import type { HotIndexCache } from "./hot-index/index.js";

export interface ProjectIndexWatchStateProvider {
  getWatchState(projectId?: string): ProjectIndexWatchState | undefined;
  waitForCatchUp?(projectId: string, options?: { maxWaitMs?: number; reason?: string }): Promise<ProjectIndexWatchCatchUpResult>;
}

export interface ToolServiceOptions {
  configOverrides?: Partial<import("@mako-ai/config").MakoConfig>;
  requestContext?: ToolServiceRequestContext;
  sharedGlobalStore?: GlobalStore;
  answerTraceOptions?: SaveAnswerTrustRunOptions;
  /**
   * Per-process project-store pool. When provided, `withProjectContext`
   * tool-invocation logging, and the runtime-telemetry capture hook
   * borrow from this pool instead of opening / closing a fresh
   * `ProjectStore` per call. The caller owns the cache lifecycle
   * (typically the `agentmako mcp` stdio server creates one and
   * flushes on shutdown). See Initial Testing roadmap Phase 2.
   */
  projectStoreCache?: ProjectStoreCache;
  hotIndexCache?: HotIndexCache;
  indexRefreshCoordinator?: ProjectIndexWatchStateProvider;
  reefService?: Pick<ReefService, "getProjectStatus" | "requestRefresh">;
  progressReporter?: ProgressReporter;
}

export type ToolServiceCallOptions = Pick<ToolServiceOptions, "progressReporter">;

export interface ToolServiceRequestContext {
  requestId?: string;
  sessionProjectId?: string;
  meta?: JsonObject;
  getRoots?: () => Promise<string[]>;
  onProjectResolved?: (project: AttachedProject) => void;
}

export interface ToolProjectContext {
  project: AttachedProject;
  profile: ProjectProfile | null;
  projectStore: ProjectStore;
}

export {
  createAmbiguityError,
  createMissingProjectContextError,
  createNotFoundError,
  createProjectNotAttachedError,
} from "./resolver-errors.js";
export {
  borrowGlobalStore,
  createDetachedLocationCandidate,
  pickBestLocationCandidate,
  resolveProject,
  resolveProjectFromLocations,
  resolveProjectFromToolContext,
  type ProjectLocationResolution,
} from "./project-resolver.js";
export {
  collectExactFileCandidates,
  collectExactRouteCandidates,
  collectExactSchemaObjectCandidates,
  normalizeFileQuery,
  resolveAuthFeature,
  resolveIndexedFilePath,
  resolveIndexedRoute,
  resolveIndexedSchemaObject,
  resolveRouteIdentifier,
  resolveSchemaObjectIdentifier,
  withProjectContext,
} from "./entity-resolver.js";
