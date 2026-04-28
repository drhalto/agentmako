import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JsonObject } from "@mako-ai/contracts";
import type { IndexerOptions } from "./types.js";
import {
  isMissing,
  isProcessAlive,
  REEF_DAEMON_PROTOCOL_VERSION,
  resolveReefDaemonPaths,
  shortHash,
} from "./reef-daemon-state.js";
import { appendReefOperation } from "./reef-operation-log.js";

const DEFAULT_STALE_MS = 60_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000;
const MIN_RETRY_MS = 25;
const MAX_RETRY_MS = 125;

export interface ReefRootWriterLockMeta {
  token: string;
  pid: number;
  hostname: string;
  projectId: string;
  canonicalRoot: string;
  analysisHostId: string;
  createdAt: string;
  heartbeatAt: string;
  protocolVersion: string;
}

export interface ReefRootWriterLockOptions extends Pick<IndexerOptions, "configOverrides"> {
  projectId: string;
  canonicalRoot: string;
  analysisHostId?: string;
  staleMs?: number;
  acquireTimeoutMs?: number;
}

interface ReefRootWriterLockHandle {
  meta: ReefRootWriterLockMeta;
  release(): Promise<void>;
}

export async function withReefRootWriterLock<T>(
  options: ReefRootWriterLockOptions,
  callback: () => Promise<T>,
): Promise<T> {
  const lock = await acquireReefRootWriterLock(options);
  try {
    return await callback();
  } finally {
    await lock.release();
  }
}

export async function acquireReefRootWriterLock(
  options: ReefRootWriterLockOptions,
): Promise<ReefRootWriterLockHandle> {
  const paths = resolveReefDaemonPaths(options);
  const lockDir = path.join(paths.rootLocksDir, `${shortHash(options.canonicalRoot)}.lock`);
  const breakerDir = `${lockDir}.breaker`;
  const metaPath = path.join(lockDir, "meta.json");
  const heartbeatPath = path.join(lockDir, "heartbeat");
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const timeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const startedAtMs = Date.now();
  const deadline = startedAtMs + timeoutMs;
  let waitLogged = false;

  await mkdir(paths.rootLocksDir, { recursive: true, mode: 0o700 });

  while (true) {
    const now = new Date().toISOString();
    const meta: ReefRootWriterLockMeta = {
      token: randomUUID(),
      pid: process.pid,
      hostname: os.hostname(),
      projectId: options.projectId,
      canonicalRoot: options.canonicalRoot,
      analysisHostId: options.analysisHostId ?? `pid-${process.pid}`,
      createdAt: now,
      heartbeatAt: now,
      protocolVersion: REEF_DAEMON_PROTOCOL_VERSION,
    };

    try {
      await mkdir(lockDir, { mode: 0o700 });
      await writeLockFiles(metaPath, heartbeatPath, meta);
      await appendReefOperation(options, {
        projectId: options.projectId,
        root: options.canonicalRoot,
        kind: "writer_lock",
        message: "root writer lock acquired",
        data: {
          waitMs: Date.now() - startedAtMs,
          analysisHostId: meta.analysisHostId,
        },
      });
      return createHandle({
        options,
        meta,
        lockDir,
        metaPath,
        heartbeatPath,
        staleMs,
      });
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
    }

    const existing = await readLockMeta(metaPath);
    const stale = await isStaleLock(existing, heartbeatPath, staleMs);
    if (stale) {
      const claimed = await claimBreaker(breakerDir);
      if (claimed) {
        try {
          await appendReefOperation(options, {
            projectId: options.projectId,
            root: options.canonicalRoot,
            kind: "writer_lock",
            severity: "warning",
            message: "stale root writer lock cleaned up",
            data: {
              priorOwner: redactLockMeta(existing),
            },
          });
          await rm(lockDir, { recursive: true, force: true });
        } finally {
          await rm(breakerDir, { recursive: true, force: true });
        }
        continue;
      }
    }

    if (!waitLogged) {
      waitLogged = true;
      await appendReefOperation(options, {
        projectId: options.projectId,
        root: options.canonicalRoot,
        kind: "writer_lock",
        message: "waiting for root writer lock",
        data: {
          owner: redactLockMeta(existing),
        },
      });
    }

    if (Date.now() >= deadline) {
      await appendReefOperation(options, {
        projectId: options.projectId,
        root: options.canonicalRoot,
        kind: "writer_lock",
        severity: "error",
        message: "timed out waiting for root writer lock",
        data: {
          timeoutMs,
          owner: redactLockMeta(existing),
        },
      });
      throw new Error(`Timed out waiting for Reef root writer lock for ${options.canonicalRoot}`);
    }

    await sleep(retryDelayMs());
  }
}

function createHandle(args: {
  options: ReefRootWriterLockOptions;
  meta: ReefRootWriterLockMeta;
  lockDir: string;
  metaPath: string;
  heartbeatPath: string;
  staleMs: number;
}): ReefRootWriterLockHandle {
  const heartbeatMs = Math.max(100, Math.floor(args.staleMs / 3));
  const heartbeat = setInterval(() => {
    void writeHeartbeat(args.heartbeatPath, new Date().toISOString()).catch(() => undefined);
  }, heartbeatMs);
  heartbeat.unref?.();

  return {
    meta: args.meta,
    async release(): Promise<void> {
      clearInterval(heartbeat);
      const current = await readLockMeta(args.metaPath);
      if (current?.token !== args.meta.token) {
        await appendReefOperation(args.options, {
          projectId: args.options.projectId,
          root: args.options.canonicalRoot,
          kind: "writer_lock",
          severity: "error",
          message: "root writer lock release refused token mismatch",
          data: {
            owner: redactLockMeta(current),
            releaser: redactLockMeta(args.meta),
          },
        });
        throw new Error("Refusing to release Reef root writer lock owned by another process.");
      }
      await rm(args.lockDir, { recursive: true, force: true });
      await appendReefOperation(args.options, {
        projectId: args.options.projectId,
        root: args.options.canonicalRoot,
        kind: "writer_lock",
        message: "root writer lock released",
        data: {
          analysisHostId: args.meta.analysisHostId,
        },
      });
    },
  };
}

async function writeLockFiles(
  metaPath: string,
  heartbeatPath: string,
  meta: ReefRootWriterLockMeta,
): Promise<void> {
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeHeartbeat(heartbeatPath, meta.heartbeatAt);
}

async function writeHeartbeat(heartbeatPath: string, heartbeatAt: string): Promise<void> {
  await writeFile(heartbeatPath, `${heartbeatAt}\n`, { encoding: "utf8", mode: 0o600 });
}

async function readLockMeta(metaPath: string): Promise<ReefRootWriterLockMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath, "utf8")) as ReefRootWriterLockMeta;
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    return null;
  }
}

async function isStaleLock(
  meta: ReefRootWriterLockMeta | null,
  heartbeatPath: string,
  staleMs: number,
): Promise<boolean> {
  if (!meta) {
    return true;
  }
  if (meta.protocolVersion !== REEF_DAEMON_PROTOCOL_VERSION) {
    return false;
  }
  const heartbeatAt = await readFile(heartbeatPath, "utf8")
    .then((value) => value.trim())
    .catch(() => meta.heartbeatAt);
  const ageMs = Date.now() - Date.parse(heartbeatAt);
  return ageMs > staleMs || !isProcessAlive(meta.pid);
}

async function claimBreaker(breakerDir: string): Promise<boolean> {
  try {
    await mkdir(breakerDir, { mode: 0o700 });
    return true;
  } catch (error) {
    if (isAlreadyExists(error)) {
      return false;
    }
    throw error;
  }
}

function redactLockMeta(meta: ReefRootWriterLockMeta | null): JsonObject | null {
  if (!meta) {
    return null;
  }
  return {
    pid: meta.pid,
    hostname: meta.hostname,
    projectId: meta.projectId,
    canonicalRoot: meta.canonicalRoot,
    analysisHostId: meta.analysisHostId,
    createdAt: meta.createdAt,
    heartbeatAt: meta.heartbeatAt,
    protocolVersion: meta.protocolVersion,
  };
}

function retryDelayMs(): number {
  return MIN_RETRY_MS + Math.floor(Math.random() * (MAX_RETRY_MS - MIN_RETRY_MS));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "EEXIST";
}
