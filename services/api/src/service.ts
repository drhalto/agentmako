import { existsSync, statSync } from "node:fs";
import { extname, join, resolve as resolvePath, sep as pathSep } from "node:path";
import { loadConfig, type MakoConfig } from "@mako-ai/config";
import type {
  AnswerPacket,
  AnswerToolQueryKind,
  AnswerResult,
  AttachedProject,
  DbConnectionTestResult,
  DbRefreshResult,
  DbVerificationResult,
  JsonObject,
  ProjectLocatorInput,
  ProjectProfile,
  ReefOperationLogEntry,
  ReefOperationQuery,
  ReefDaemonStartResult,
  ReefDaemonStatus,
  ReefDaemonStopResult,
  ReefProjectStatus,
  ReefRefreshRequest,
  ReefRefreshResult,
  ReefService,
  RegisteredProject,
  RegisterProjectInput,
  ToolDefinitionSummary,
  ToolOutput,
  WorkflowPacketSurface,
  WorkflowPacketToolInput,
} from "@mako-ai/contracts";
import {
  attachProject,
  bindProjectDb,
  discoverProjectDbSchemas,
  detachProject,
  getProjectStatus,
  indexProject,
  listAttachedProjects,
  createReefClient,
  getReefDaemonStatus,
  startReefDaemon,
  stopReefDaemon,
  refreshProjectDb,
  setProjectDefaultSchemaScope,
  testProjectDbConnection,
  unbindProjectDb,
  verifyProjectDb,
  type AttachProjectResult,
  type BindProjectDbInput,
  type BindProjectDbResult,
  type DiscoverProjectDbSchemasResult,
  type DetachProjectResult,
  type IndexProjectResult,
  type ProjectStatusResult,
  type RefreshProjectDbOptions,
  type SetDefaultSchemaScopeResult,
  type UnbindProjectDbInput,
  type UnbindProjectDbResult,
  type VerifyProjectDbOptions,
} from "@mako-ai/indexer";
import {
  createToolService,
  type ProjectIndexWatchStateProvider,
  type HotIndexCache,
  type ToolExposureSurface,
  type ToolServiceCallOptions,
  type ToolServiceRequestContext,
} from "@mako-ai/tools";

export interface ApiServiceOptions {
  configOverrides?: Partial<MakoConfig>;
  /**
   * Optional per-process project-store pool. Set by long-lived hosts
   * (the `agentmako mcp` stdio server) so `withProjectContext` and the
   * runtime-telemetry capture hook can skip the per-call open-close
   * cost. Short-lived callers (HTTP, one-shot CLI commands) leave this
   * unset and keep the default open-close semantics. See
   * Initial Testing roadmap Phase 2.
   */
  projectStoreCache?: import("@mako-ai/store").ProjectStoreCache;
  hotIndexCache?: HotIndexCache;
  indexRefreshCoordinator?: ProjectIndexWatchStateProvider;
}

export class MakoApiService {
  private readonly toolService;
  private readonly reefService: ReefService;

  constructor(private readonly options: ApiServiceOptions = {}) {
    this.reefService = createReefClient(options);
    this.toolService = createToolService({
      ...options,
      reefService: this.reefService,
    });
  }

  health() {
    const config = loadConfig(this.options.configOverrides);
    return {
      status: "ok" as const,
      appName: config.appName,
      supportTarget: config.supportTarget,
      enabledExtensions: config.extensions,
    };
  }

  listProjects(): AttachedProject[] {
    const projects = listAttachedProjects(this.options);
    return projects.map(decorateProjectMetadata);
  }

  /**
   * Resolve `findProjectFavicon` against a stored project. Used by the
   * `GET /api/v1/projects/:projectId/favicon` route to locate the on-disk
   * favicon file we previously advertised through `metadata.faviconUrl`.
   * Returns `null` if the project isn't attached or if no candidate file
   * exists in the project root anymore.
   */
  resolveProjectFavicon(projectId: string): FoundFavicon | null {
    const project = listAttachedProjects(this.options).find(
      (p) => p.projectId === projectId,
    );
    if (!project) return null;
    return findProjectFavicon(project.canonicalPath);
  }

  attachProject(projectRoot: string): AttachProjectResult {
    return attachProject(projectRoot, this.options);
  }

  detachProject(projectReference: string, purge = false): DetachProjectResult {
    return detachProject(projectReference, {
      ...this.options,
      purge,
    });
  }

  indexProject(projectRoot: string): Promise<IndexProjectResult> {
    return indexProject(projectRoot, this.options);
  }

  getProjectStatus(projectReference: string): ProjectStatusResult | null {
    return getProjectStatus(projectReference, this.options);
  }

  async registerReefProject(input: RegisterProjectInput): Promise<RegisteredProject> {
    return this.reefService.registerProject(input);
  }

  async unregisterReefProject(projectId: string): Promise<void> {
    return this.reefService.unregisterProject(projectId);
  }

  async listReefProjects(): Promise<RegisteredProject[]> {
    return this.reefService.listProjects();
  }

  async getReefProjectStatus(projectReference: string): Promise<ReefProjectStatus> {
    return this.reefService.getProjectStatus(projectReference);
  }

  async listReefProjectStatuses(): Promise<ReefProjectStatus[]> {
    return this.reefService.listProjectStatuses();
  }

  async requestReefRefresh(input: ReefRefreshRequest): Promise<ReefRefreshResult> {
    return this.reefService.requestRefresh(input);
  }

  async listReefOperations(input: ReefOperationQuery = {}): Promise<ReefOperationLogEntry[]> {
    return this.reefService.listOperations(input);
  }

  async startReefDaemon(options: { foreground?: boolean; force?: boolean } = {}): Promise<ReefDaemonStartResult> {
    return startReefDaemon({ ...this.options, ...options });
  }

  async stopReefDaemon(): Promise<ReefDaemonStopResult> {
    return stopReefDaemon(this.options);
  }

  async getReefDaemonStatus(): Promise<ReefDaemonStatus> {
    return getReefDaemonStatus(this.options);
  }

  bindProjectDb(projectReference: string, input: BindProjectDbInput): BindProjectDbResult {
    return bindProjectDb(projectReference, input, this.options);
  }

  unbindProjectDb(
    projectReference: string,
    input: UnbindProjectDbInput = {},
  ): UnbindProjectDbResult {
    return unbindProjectDb(projectReference, input, this.options);
  }

  async testProjectDb(projectReference: string): Promise<DbConnectionTestResult> {
    return testProjectDbConnection(projectReference, this.options);
  }

  async verifyProjectDb(
    projectReference: string,
    options: VerifyProjectDbOptions = {},
  ): Promise<DbVerificationResult> {
    return verifyProjectDb(projectReference, { ...this.options, ...options });
  }

  async refreshProjectDb(
    projectReference: string,
    options: RefreshProjectDbOptions = {},
  ): Promise<DbRefreshResult> {
    return refreshProjectDb(projectReference, { ...this.options, ...options });
  }

  async discoverProjectDbSchemas(projectReference: string): Promise<DiscoverProjectDbSchemasResult> {
    return discoverProjectDbSchemas(projectReference, this.options);
  }

  setProjectDefaultSchemaScope(
    projectReference: string,
    scope: string[] | undefined,
  ): SetDefaultSchemaScopeResult {
    return setProjectDefaultSchemaScope(projectReference, scope, this.options);
  }

  async resolveProject(
    locator: ProjectLocatorInput,
    requestContext?: ToolServiceRequestContext,
  ): Promise<{ project: AttachedProject; profile: ProjectProfile | null }> {
    return this.toolService.resolveProject(locator, requestContext);
  }

  listTools(
    surface: ToolExposureSurface = "api",
    requestContext?: ToolServiceRequestContext,
  ): ToolDefinitionSummary[] {
    return this.toolService.listTools(surface, requestContext);
  }

  async callTool(
    name: string,
    input: unknown,
    requestContext?: ToolServiceRequestContext,
    callOptions: ToolServiceCallOptions = {},
  ): Promise<ToolOutput> {
    return this.toolService.callTool(name, input, requestContext, callOptions);
  }

  async ask(packet: AnswerPacket, requestContext?: ToolServiceRequestContext): Promise<AnswerResult> {
    return this.toolService.answer(packet, requestContext);
  }

  async askQuestion(
    locator: ProjectLocatorInput,
    queryKind: AnswerToolQueryKind | "free_form",
    queryText: string,
    requestContext?: ToolServiceRequestContext,
  ): Promise<AnswerResult> {
    return this.toolService.answerQuestion(locator, queryKind, queryText, requestContext);
  }

  async generateWorkflowPacket(
    input: WorkflowPacketToolInput,
    requestContext?: ToolServiceRequestContext,
  ): Promise<WorkflowPacketSurface> {
    return this.toolService.generateWorkflowPacket(input, requestContext);
  }

  close(): void {
    this.toolService.close();
    void this.reefService.stop();
  }
}

export function createApiService(options: ApiServiceOptions = {}): MakoApiService {
  return new MakoApiService(options);
}

// =============================================================================
// Project metadata enrichment
// =============================================================================

/**
 * Common locations a web project keeps its favicon. Ordered by quality —
 * SVG before raster, framework-canonical paths before fallbacks. The
 * detector returns the first match.
 */
const FAVICON_CANDIDATES: ReadonlyArray<string> = [
  // Next.js 13+ app dir conventions (highest priority).
  "app/favicon.svg",
  "app/favicon.png",
  "app/favicon.ico",
  "app/icon.svg",
  "app/icon.png",
  "app/icon.ico",
  "app/apple-icon.png",
  // Vite / CRA / Next.js public dir.
  "public/favicon.svg",
  "public/favicon.png",
  "public/favicon.ico",
  "public/icon.svg",
  "public/icon.png",
  "public/apple-touch-icon.png",
  "public/logo.svg",
  "public/logo.png",
  // SvelteKit / Gatsby / Nuxt 2 static dir.
  "static/favicon.svg",
  "static/favicon.png",
  "static/favicon.ico",
  // Angular / generic src layout.
  "src/favicon.svg",
  "src/favicon.png",
  "src/favicon.ico",
  "src/assets/favicon.svg",
  "src/assets/favicon.png",
  "src/assets/favicon.ico",
  "assets/favicon.svg",
  "assets/favicon.png",
  "assets/favicon.ico",
  // Bare-root.
  "favicon.svg",
  "favicon.png",
  "favicon.ico",
];

const FAVICON_CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface FoundFavicon {
  absolutePath: string;
  contentType: string;
  byteLength: number;
}

/**
 * Walk `FAVICON_CANDIDATES` against `projectRoot` and return the first
 * file that exists. Tolerant of stat() failures (missing dirs, permission
 * issues): such candidates simply skip.
 */
export function findProjectFavicon(projectRoot: string): FoundFavicon | null {
  for (const relPath of FAVICON_CANDIDATES) {
    const absolutePath = join(projectRoot, relPath);
    // Path-confinement guard: ensure the resolved path is still inside
    // the project root. None of the candidates contain `..`, but treat
    // it as a defense-in-depth check anyway.
    const resolved = resolvePath(absolutePath);
    const rootResolved = resolvePath(projectRoot);
    if (
      resolved !== rootResolved &&
      !resolved.startsWith(rootResolved + pathSep)
    ) {
      continue;
    }

    let stat;
    try {
      if (!existsSync(resolved)) continue;
      stat = statSync(resolved);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size === 0) continue;

    const ext = extname(resolved).toLowerCase();
    const contentType = FAVICON_CONTENT_TYPES[ext];
    if (!contentType) continue;

    return { absolutePath: resolved, contentType, byteLength: stat.size };
  }
  return null;
}

/**
 * Inject `metadata.faviconUrl` when the project ships a favicon in a
 * recognized location. The URL points at the API's
 * `GET /api/v1/projects/:projectId/favicon` route, which streams the
 * file from disk — keeps the browser CORS-free and means the favicon
 * stays in sync with whatever the project's source tree actually has.
 */
function decorateProjectMetadata(project: AttachedProject): AttachedProject {
  const found = findProjectFavicon(project.canonicalPath);
  if (!found) return project;

  const existing: JsonObject = (project.metadata as JsonObject | undefined) ?? {};
  return {
    ...project,
    metadata: {
      ...existing,
      faviconUrl: `/api/v1/projects/${encodeURIComponent(project.projectId)}/favicon`,
    },
  };
}
