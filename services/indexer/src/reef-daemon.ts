import { spawn } from "node:child_process";
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ReefDaemonProcessInfo,
  ReefDaemonStartResult,
  ReefDaemonStatus,
  ReefDaemonStopResult,
  ReefAnalysisHost,
  ReefChangeSetResult,
  ReefOperationLogEntry,
  ReefOperationQuery,
  ReefProjectEvent,
  ReefProjectStatus,
  ReefQueryRequest,
  ReefRefreshRequest,
  ReefRefreshResult,
  ReefRuntimeMode,
  ReefService,
  ReefServiceEvent,
  ReefWatcherRecrawlInput,
  ReefWorkspaceChangeSet,
  RegisterProjectInput,
  RegisteredProject,
} from "@mako-ai/contracts";
import { createProjectStoreCache, type ProjectStoreCache } from "@mako-ai/store";
import type { MakoConfig } from "@mako-ai/config";
import { loadConfig } from "@mako-ai/config";
import { createInProcessReefService, type InProcessReefService } from "./reef-service.js";
import type { IndexerOptions } from "./types.js";
import { appendReefOperation } from "./reef-operation-log.js";
import {
  createDaemonToken,
  ensureReefDaemonDirs,
  isMissing,
  isProcessAlive,
  readReefDaemonProcessInfo,
  readReefDaemonToken,
  REEF_DAEMON_PACKAGE_VERSION,
  REEF_DAEMON_PROTOCOL_VERSION,
  removeReefDaemonProcessInfo,
  removeReefDaemonSocket,
  removeReefDaemonToken,
  resolveReefDaemonPaths,
  tokenFingerprint,
  writeReefDaemonProcessInfo,
  writeReefDaemonToken,
} from "./reef-daemon-state.js";

const REQUEST_TIMEOUT_MS = 1_500;
const START_READY_TIMEOUT_MS = 5_000;

interface ReefDaemonRequest {
  id: string;
  method: string;
  token?: string;
  params?: unknown;
}

interface ReefDaemonResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface ReefDaemonOptions extends IndexerOptions {
  projectStoreCache?: ProjectStoreCache;
  onReady?: (info: ReefDaemonProcessInfo) => Promise<void> | void;
}

interface ReefDaemonStartOptions extends ReefDaemonOptions {
  foreground?: boolean;
  force?: boolean;
  requireCliEntrypoint?: boolean;
}

const lazyStartInFlight = new Map<string, Promise<ReefDaemonProcessInfo | null>>();

export class ReefDaemonUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReefDaemonUnavailableError";
  }
}

export class ReefDaemonServer {
  private server: Server | undefined;
  private service: InProcessReefService | undefined;
  private projectStoreCache: ProjectStoreCache | undefined;
  private token = "";
  private info: ReefDaemonProcessInfo | undefined;
  private daemonLock: DaemonLockHandle | undefined;
  private shuttingDown = false;
  private resolveStopped: () => void = () => undefined;
  private readonly stopped = new Promise<void>((resolve) => {
    this.resolveStopped = resolve;
  });

  constructor(private readonly options: ReefDaemonOptions = {}) {}

  async start(): Promise<ReefDaemonProcessInfo> {
    const paths = resolveReefDaemonPaths(this.options);
    await ensureReefDaemonDirs(paths);
    await removeReefDaemonSocket(this.options);
    this.daemonLock = await acquireDaemonLock(this.options);
    this.token = createDaemonToken();
    await writeReefDaemonToken(this.token, this.options);

    this.projectStoreCache = this.options.projectStoreCache ?? createProjectStoreCache();
    this.service = createInProcessReefService({
      ...this.options,
      projectStoreCache: this.projectStoreCache,
      serviceMode: "daemon",
    });
    await this.service.start();

    this.server = createServer((socket) => this.handleSocket(socket));
    let endpoint = paths.endpoint;
    let transport = paths.transport;
    try {
      await listenOnEndpoint(this.server, endpoint);
    } catch (error) {
      await appendReefOperation(this.options, {
        kind: "daemon_lifecycle",
        severity: "warning",
        message: "reef daemon pipe/socket bind failed; falling back to localhost",
        data: {
          transport,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      await listenOnLocalhost(this.server);
      const address = this.server.address();
      if (!address || typeof address === "string") {
        throw new Error("Reef daemon localhost fallback did not produce a TCP address.");
      }
      endpoint = `127.0.0.1:${address.port}`;
      transport = "localhost";
    }

    this.info = {
      pid: process.pid,
      endpoint,
      transport,
      protocolVersion: REEF_DAEMON_PROTOCOL_VERSION,
      packageVersion: REEF_DAEMON_PACKAGE_VERSION,
      startedAt: new Date().toISOString(),
      stateHome: paths.stateHome,
      tokenFingerprint: tokenFingerprint(this.token),
    };
    await writeReefDaemonProcessInfo(this.info, this.options);
    await appendReefOperation(this.options, {
      kind: "daemon_lifecycle",
      message: "reef daemon ready",
      data: {
        pid: this.info.pid,
        endpoint: this.info.endpoint,
        transport: this.info.transport,
        protocolVersion: this.info.protocolVersion,
        tokenFingerprint: this.info.tokenFingerprint,
      },
    });
    if (this.options.onReady) {
      await this.options.onReady(this.info);
    }
    return this.info;
  }

  async stop(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    await appendReefOperation(this.options, {
      kind: "daemon_lifecycle",
      message: "reef daemon stopping",
      data: this.info ? { pid: this.info.pid } : undefined,
    }).catch(() => undefined);
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await this.service?.stop().catch(() => undefined);
    this.projectStoreCache?.flush();
    await removeReefDaemonProcessInfo(this.options).catch(() => undefined);
    await removeReefDaemonToken(this.options).catch(() => undefined);
    await removeReefDaemonSocket(this.options).catch(() => undefined);
    await this.daemonLock?.release().catch(() => undefined);
    this.resolveStopped();
  }

  waitUntilStopped(): Promise<void> {
    return this.stopped;
  }

  private handleSocket(socket: Socket): void {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line !== "") {
          void this.handleLine(socket, line);
        }
      }
    });
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: ReefDaemonRequest;
    try {
      request = JSON.parse(line) as ReefDaemonRequest;
    } catch {
      socket.write(`${JSON.stringify(errorResponse("unknown", "bad_request", "Invalid Reef daemon request."))}\n`);
      return;
    }

    try {
      const result = await this.dispatch(request);
      socket.write(`${JSON.stringify({ id: request.id, ok: true, result } satisfies ReefDaemonResponse)}\n`);
    } catch (error) {
      socket.write(`${JSON.stringify(errorResponse(
        request.id,
        error instanceof ReefDaemonUnavailableError ? "unavailable" : "request_failed",
        error instanceof Error ? error.message : String(error),
      ))}\n`);
    }
  }

  private async dispatch(request: ReefDaemonRequest): Promise<unknown> {
    if (request.method === "handshake") {
      const input = request.params as { clientProtocolVersion?: string; token?: string } | undefined;
      if (input?.token !== this.token) {
        await appendReefOperation(this.options, {
          kind: "daemon_lifecycle",
          severity: "warning",
          message: "reef daemon auth failed",
        });
        return {
          ok: false,
          code: "auth_failed",
          message: "Invalid Reef daemon token.",
        };
      }
      if (input.clientProtocolVersion !== REEF_DAEMON_PROTOCOL_VERSION) {
        return {
          ok: false,
          code: "unsupported_protocol",
          message: `Unsupported Reef daemon protocol: ${input.clientProtocolVersion ?? "unknown"}`,
        };
      }
      return {
        ok: true,
        daemonProtocolVersion: REEF_DAEMON_PROTOCOL_VERSION,
        daemonPackageVersion: REEF_DAEMON_PACKAGE_VERSION,
        daemonPid: process.pid,
        startedAt: this.info?.startedAt ?? new Date().toISOString(),
        serviceMode: "daemon",
      };
    }

    if (request.token !== this.token) {
      await appendReefOperation(this.options, {
        kind: "daemon_lifecycle",
        severity: "warning",
        message: "reef daemon request auth failed",
        data: { method: request.method },
      });
      throw new Error("Invalid Reef daemon token.");
    }

    const service = this.service;
    if (!service) {
      throw new ReefDaemonUnavailableError("Reef daemon service is not started.");
    }

    switch (request.method) {
      case "registerProject":
        return service.registerProject(request.params as RegisterProjectInput);
      case "unregisterProject":
        return service.unregisterProject(String(request.params));
      case "listProjects":
        return service.listProjects();
      case "getProjectStatus":
        return service.getProjectStatus(String(request.params));
      case "listProjectStatuses":
        return service.listProjectStatuses();
      case "requestRefresh":
        return service.requestRefresh(request.params as ReefRefreshRequest);
      case "recordWatcherRecrawl":
        return service.recordWatcherRecrawl(request.params as ReefWatcherRecrawlInput);
      case "submitEvent":
        return service.submitEvent(request.params as ReefProjectEvent);
      case "applyChangeSet":
        return service.applyChangeSet(request.params as ReefWorkspaceChangeSet);
      case "listOperations":
        return service.listOperations((request.params ?? {}) as ReefOperationQuery);
      case "query":
        return service.query(request.params as ReefQueryRequest<unknown>);
      case "shutdown":
        setImmediate(() => {
          void this.stop();
        });
        return { ok: true };
      default:
        throw new Error(`Unsupported Reef daemon method: ${request.method}`);
    }
  }
}

export class ReefDaemonClient implements ReefAnalysisHost {
  constructor(private readonly options: Pick<IndexerOptions, "configOverrides"> = {}) {}

  async start(): Promise<void> {
    await this.handshake();
  }

  async stop(): Promise<void> {
    await this.shutdown();
  }

  async registerProject(input: RegisterProjectInput): Promise<RegisteredProject> {
    return this.request<RegisteredProject>("registerProject", input);
  }

  async unregisterProject(projectId: string): Promise<void> {
    await this.request<void>("unregisterProject", projectId);
  }

  async listProjects(): Promise<RegisteredProject[]> {
    return this.request<RegisteredProject[]>("listProjects");
  }

  async getProjectStatus(projectId: string): Promise<ReefProjectStatus> {
    return this.request<ReefProjectStatus>("getProjectStatus", projectId);
  }

  async listProjectStatuses(): Promise<ReefProjectStatus[]> {
    return this.request<ReefProjectStatus[]>("listProjectStatuses");
  }

  async requestRefresh(input: ReefRefreshRequest): Promise<ReefRefreshResult> {
    return this.request<ReefRefreshResult>("requestRefresh", input);
  }

  async recordWatcherRecrawl(input: ReefWatcherRecrawlInput): Promise<ReefProjectStatus> {
    return this.request<ReefProjectStatus>("recordWatcherRecrawl", input);
  }

  async submitEvent(event: ReefProjectEvent): Promise<void> {
    await this.request<void>("submitEvent", event);
  }

  async applyChangeSet(changeSet: ReefWorkspaceChangeSet): Promise<ReefChangeSetResult> {
    return this.request<ReefChangeSetResult>("applyChangeSet", changeSet);
  }

  async query<TInput, TOutput>(request: ReefQueryRequest<TInput>): Promise<TOutput> {
    return this.request<TOutput>("query", request);
  }

  async listOperations(input: ReefOperationQuery = {}): Promise<ReefOperationLogEntry[]> {
    return this.request<ReefOperationLogEntry[]>("listOperations", input);
  }

  async *subscribe(_projectId: string): AsyncIterable<ReefServiceEvent> {}

  async handshake(): Promise<ReefDaemonProcessInfo> {
    const info = await this.readCompatibleProcess();
    const token = await readRequiredToken(this.options);
    const result = await this.rawRequest<{
      ok: boolean;
      code?: string;
      message?: string;
    }>("handshake", {
      clientProtocolVersion: REEF_DAEMON_PROTOCOL_VERSION,
      clientPackageVersion: REEF_DAEMON_PACKAGE_VERSION,
      token,
      pid: process.pid,
    }, { includeToken: false });
    if (!result.ok) {
      throw new ReefDaemonUnavailableError(result.message ?? result.code ?? "Reef daemon handshake failed.");
    }
    return info;
  }

  async shutdown(): Promise<void> {
    await this.request("shutdown");
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    return this.rawRequest<T>(method, params, { includeToken: true });
  }

  private async rawRequest<T>(
    method: string,
    params: unknown,
    options: { includeToken: boolean },
  ): Promise<T> {
    const info = await this.readCompatibleProcess();
    const token = options.includeToken ? await readRequiredToken(this.options) : undefined;
    const request: ReefDaemonRequest = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method,
      ...(token ? { token } : {}),
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const socket = createDaemonConnection(info);
      let buffer = "";
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        callback();
      };

      socket.setEncoding("utf8");
      socket.setTimeout(REQUEST_TIMEOUT_MS);
      socket.once("connect", () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });
      socket.on("data", (chunk) => {
        buffer += chunk;
        if (!buffer.includes("\n")) {
          return;
        }
        const line = buffer.slice(0, buffer.indexOf("\n")).trim();
        try {
          const response = JSON.parse(line) as ReefDaemonResponse;
          if (!response.ok) {
            settle(() => reject(new Error(response.error?.message ?? "Reef daemon request failed.")));
            return;
          }
          settle(() => resolve(response.result as T));
        } catch (error) {
          settle(() => reject(error));
        }
      });
      socket.once("timeout", () => {
        settle(() => reject(new ReefDaemonUnavailableError("Timed out connecting to Reef daemon.")));
      });
      socket.once("error", (error) => {
        settle(() => reject(new ReefDaemonUnavailableError(error.message)));
      });
    });
  }

  private async readCompatibleProcess(): Promise<ReefDaemonProcessInfo> {
    const info = await readReefDaemonProcessInfo(this.options);
    if (!info) {
      throw new ReefDaemonUnavailableError("No Reef daemon process metadata found.");
    }
    if (info.protocolVersion !== REEF_DAEMON_PROTOCOL_VERSION) {
      throw new ReefDaemonUnavailableError(
        `Reef daemon protocol mismatch: ${info.protocolVersion} != ${REEF_DAEMON_PROTOCOL_VERSION}`,
      );
    }
    return info;
  }
}

export class ReefClient implements ReefAnalysisHost {
  private readonly inProcess: InProcessReefService;
  private readonly daemon: ReefDaemonClient;

  constructor(private readonly options: ReefDaemonOptions = {}) {
    this.inProcess = createInProcessReefService(options);
    this.daemon = new ReefDaemonClient(options);
  }

  async start(): Promise<void> {
    await this.inProcess.start();
  }

  async stop(): Promise<void> {
    await this.inProcess.stop();
  }

  async registerProject(input: RegisterProjectInput): Promise<RegisteredProject> {
    return (await this.resolveService()).registerProject(input);
  }

  async unregisterProject(projectId: string): Promise<void> {
    return (await this.resolveService()).unregisterProject(projectId);
  }

  async listProjects(): Promise<RegisteredProject[]> {
    return (await this.resolveService()).listProjects();
  }

  async getProjectStatus(projectId: string): Promise<ReefProjectStatus> {
    return (await this.resolveService()).getProjectStatus(projectId);
  }

  async listProjectStatuses(): Promise<ReefProjectStatus[]> {
    return (await this.resolveService()).listProjectStatuses();
  }

  async requestRefresh(input: ReefRefreshRequest): Promise<ReefRefreshResult> {
    return (await this.resolveService()).requestRefresh(input);
  }

  async recordWatcherRecrawl(input: ReefWatcherRecrawlInput): Promise<ReefProjectStatus> {
    return (await this.resolveService()).recordWatcherRecrawl(input);
  }

  async submitEvent(event: ReefProjectEvent): Promise<void> {
    return (await this.resolveService()).submitEvent(event);
  }

  async applyChangeSet(changeSet: ReefWorkspaceChangeSet): Promise<ReefChangeSetResult> {
    return (await this.resolveService()).applyChangeSet(changeSet);
  }

  async query<TInput, TOutput>(request: ReefQueryRequest<TInput>): Promise<TOutput> {
    return (await this.resolveService()).query(request);
  }

  async listOperations(input: ReefOperationQuery = {}): Promise<ReefOperationLogEntry[]> {
    return (await this.resolveService()).listOperations(input);
  }

  async *subscribe(projectId: string): AsyncIterable<ReefServiceEvent> {
    yield* (await this.resolveService()).subscribe(projectId);
  }

  private async resolveService(): Promise<ReefAnalysisHost> {
    const mode = resolveReefMode(this.options);
    if (mode === "legacy") {
      return this.inProcess;
    }
    let daemonError: unknown;
    try {
      await this.daemon.handshake();
      return this.daemon;
    } catch (error) {
      daemonError = error;
    }

    const started = await maybeLazyStartReefDaemon(this.options, mode === "required");
    if (started) {
      try {
        await this.daemon.handshake();
        return this.daemon;
      } catch (error) {
        daemonError = error;
      }
    }

    if (mode === "required") {
      throw daemonError;
    }

    await appendReefOperation(this.options, {
      kind: "fallback_used",
      severity: "warning",
      message: "reef daemon unavailable; using in-process service",
      data: {
        error: daemonError instanceof Error ? daemonError.message : String(daemonError),
      },
    }).catch(() => undefined);
    return this.inProcess;
  }
}

async function maybeLazyStartReefDaemon(
  options: ReefDaemonOptions,
  throwOnFailure: boolean,
): Promise<ReefDaemonProcessInfo | null> {
  if (!process.env.MAKO_CLI_ENTRYPOINT?.trim()) {
    return null;
  }

  const key = resolveReefDaemonPaths(options).stateDir;
  const existing = lazyStartInFlight.get(key);
  if (existing) {
    return existing;
  }

  const started = startReefDaemon({
    ...options,
    requireCliEntrypoint: true,
  })
    .then((result) => result.process ?? null)
    .catch(async (error) => {
      await appendReefOperation(options, {
        kind: "fallback_used",
        severity: "warning",
        message: "reef daemon lazy-start failed; using in-process service",
        data: {
          error: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => undefined);
      if (throwOnFailure) {
        throw error;
      }
      return null;
    })
    .finally(() => {
      lazyStartInFlight.delete(key);
    });

  lazyStartInFlight.set(key, started);
  return started;
}

export function createReefClient(options: ReefDaemonOptions = {}): ReefClient {
  return new ReefClient(options);
}

export async function startReefDaemon(
  options: ReefDaemonStartOptions = {},
): Promise<ReefDaemonStartResult> {
  const mode = resolveReefMode(options);
  if (mode === "legacy" && !options.force) {
    throw new Error("MAKO_REEF_MODE=legacy refuses to start the Reef daemon. Pass --force to override.");
  }

  const existing = await tryHandshake(options);
  if (existing) {
    return {
      started: false,
      reused: true,
      foreground: options.foreground ?? false,
      process: existing,
      message: `Reef daemon already running on ${existing.endpoint}`,
    };
  }

  await cleanupStaleProcessMetadata(options);

  if (options.foreground) {
    const server = new ReefDaemonServer(options);
    const info = await server.start();
    await installForegroundShutdown(server);
    return {
      started: true,
      reused: false,
      foreground: true,
      process: info,
      message: `Reef daemon stopped: ${info.endpoint}`,
    };
  }

  const entry = resolveReefDaemonCliEntrypoint(options);
  if (!entry) {
    throw new Error("Cannot start Reef daemon in the background without a CLI entrypoint.");
  }
  const child = spawn(process.execPath, [...process.execArgv, entry, "reef", "start", "--foreground"], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      MAKO_REEF_DAEMON_CHILD: "1",
    },
  });
  child.unref();

  const info = await waitForReady(options, START_READY_TIMEOUT_MS);
  return {
    started: true,
    reused: false,
    foreground: false,
    process: info,
    message: `Reef daemon started on ${info.endpoint}`,
  };
}

function resolveReefDaemonCliEntrypoint(options: Pick<ReefDaemonStartOptions, "requireCliEntrypoint">): string | undefined {
  const cliEntrypoint = process.env.MAKO_CLI_ENTRYPOINT?.trim();
  if (cliEntrypoint) {
    return cliEntrypoint;
  }
  if (options.requireCliEntrypoint) {
    return undefined;
  }
  return process.argv[1];
}

export async function stopReefDaemon(
  options: Pick<IndexerOptions, "configOverrides"> = {},
): Promise<ReefDaemonStopResult> {
  const info = await readReefDaemonProcessInfo(options);
  if (!info) {
    return {
      stopped: false,
      message: "No Reef daemon process metadata found.",
    };
  }
  const client = new ReefDaemonClient(options);
  await client.shutdown();
  await waitUntil(async () => !(await readReefDaemonProcessInfo(options)), 2_000);
  return {
    stopped: true,
    process: info,
    message: `Reef daemon stopped: ${info.pid}`,
  };
}

export async function getReefDaemonStatus(
  options: Pick<IndexerOptions, "configOverrides"> = {},
): Promise<ReefDaemonStatus> {
  const mode = resolveReefMode(options);
  const info = await readReefDaemonProcessInfo(options);
  if (!info) {
    return {
      serviceMode: mode,
      available: false,
      compatible: false,
      projects: [],
      error: "No Reef daemon process metadata found.",
    };
  }
  const client = new ReefDaemonClient(options);
  try {
    await client.handshake();
    return {
      serviceMode: mode,
      available: true,
      compatible: true,
      process: info,
      projects: await client.listProjectStatuses(),
    };
  } catch (error) {
    return {
      serviceMode: mode,
      available: false,
      compatible: false,
      process: info,
      projects: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveReefMode(options: Pick<IndexerOptions, "configOverrides"> = {}): ReefRuntimeMode {
  const envMode = process.env.MAKO_REEF_MODE;
  if (envMode === "auto" || envMode === "required" || envMode === "legacy") {
    return envMode;
  }
  const config = loadConfig(options.configOverrides);
  return config.reef.mode;
}

async function tryHandshake(options: Pick<IndexerOptions, "configOverrides">): Promise<ReefDaemonProcessInfo | null> {
  const client = new ReefDaemonClient(options);
  try {
    return await client.handshake();
  } catch {
    return null;
  }
}

async function cleanupStaleProcessMetadata(options: Pick<IndexerOptions, "configOverrides">): Promise<void> {
  const info = await readReefDaemonProcessInfo(options);
  if (!info) {
    return;
  }
  if (isProcessAlive(info.pid)) {
    return;
  }
  await appendReefOperation(options, {
    kind: "daemon_lifecycle",
    severity: "warning",
    message: "removed stale reef daemon process metadata",
    data: {
      pid: info.pid,
      endpoint: info.endpoint,
      protocolVersion: info.protocolVersion,
    },
  });
  await removeReefDaemonProcessInfo(options);
  await removeReefDaemonToken(options).catch(() => undefined);
  await removeReefDaemonSocket(options).catch(() => undefined);
}

async function waitForReady(
  options: Pick<IndexerOptions, "configOverrides">,
  timeoutMs: number,
): Promise<ReefDaemonProcessInfo> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await tryHandshake(options);
    if (info) {
      return info;
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for Reef daemon to become ready.");
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await sleep(50);
  }
  return false;
}

async function installForegroundShutdown(server: ReefDaemonServer): Promise<void> {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stop();
  };
  process.once("SIGINT", () => {
    void stop().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().then(() => process.exit(0));
  });
  await server.waitUntilStopped();
}

async function readRequiredToken(options: Pick<IndexerOptions, "configOverrides">): Promise<string> {
  const token = await readReefDaemonToken(options);
  if (!token) {
    throw new ReefDaemonUnavailableError("No Reef daemon token found.");
  }
  return token;
}

function errorResponse(id: string, code: string, message: string): ReefDaemonResponse {
  return {
    id,
    ok: false,
    error: { code, message },
  };
}

function listenOnEndpoint(server: Server, endpoint: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
}

function listenOnLocalhost(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function createDaemonConnection(info: ReefDaemonProcessInfo): Socket {
  if (info.transport !== "localhost") {
    return createConnection(info.endpoint);
  }
  const separator = info.endpoint.lastIndexOf(":");
  if (separator <= 0) {
    throw new ReefDaemonUnavailableError(`Invalid Reef daemon localhost endpoint: ${info.endpoint}`);
  }
  const host = info.endpoint.slice(0, separator);
  const port = Number.parseInt(info.endpoint.slice(separator + 1), 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new ReefDaemonUnavailableError(`Invalid Reef daemon localhost port: ${info.endpoint}`);
  }
  return createConnection({ host, port });
}

interface DaemonLockHandle {
  release(): Promise<void>;
}

async function acquireDaemonLock(
  options: Pick<IndexerOptions, "configOverrides">,
): Promise<DaemonLockHandle> {
  const paths = resolveReefDaemonPaths(options);
  await mkdir(path.dirname(paths.daemonLockDir), { recursive: true, mode: 0o700 });
  try {
    await mkdir(paths.daemonLockDir, { mode: 0o700 });
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
    const meta = await readDaemonLockMeta(paths.daemonLockDir);
    if (meta && isProcessAlive(meta.pid)) {
      throw new Error(`Reef daemon lock is held by pid ${meta.pid}.`);
    }
    await rm(paths.daemonLockDir, { recursive: true, force: true });
    await mkdir(paths.daemonLockDir, { mode: 0o700 });
  }

  await writeFile(
    path.join(paths.daemonLockDir, "meta.json"),
    `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return {
    async release(): Promise<void> {
      await rm(paths.daemonLockDir, { recursive: true, force: true });
    },
  };
}

async function readDaemonLockMeta(lockDir: string): Promise<{ pid: number } | null> {
  try {
    return JSON.parse(await readFile(path.join(lockDir, "meta.json"), "utf8")) as { pid: number };
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    return null;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "EEXIST";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
