import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type {
  JsonObject,
  ReefOperationKind,
  ReefOperationLogEntry,
  ReefOperationQuery,
} from "@mako-ai/contracts";
import { createId } from "@mako-ai/store";
import type { IndexerOptions } from "./types.js";
import { isMissing, resolveReefDaemonPaths } from "./reef-daemon-state.js";

const MAX_OPERATION_LOG_ROWS = 500;
const OPERATION_LOG_LOCK_TIMEOUT_MS = 5_000;
const OPERATION_LOG_LOCK_STALE_MS = 30_000;
const OPERATION_LOG_LOCK_RETRY_MS = 25;

export interface AppendReefOperationInput {
  projectId?: string;
  root?: string;
  kind: ReefOperationKind;
  severity?: ReefOperationLogEntry["severity"];
  message: string;
  data?: JsonObject;
}

export async function appendReefOperation(
  options: Pick<IndexerOptions, "configOverrides">,
  input: AppendReefOperationInput,
): Promise<ReefOperationLogEntry> {
  const paths = resolveReefDaemonPaths(options);
  await mkdir(paths.daemonDir, { recursive: true, mode: 0o700 });

  const entry: ReefOperationLogEntry = {
    id: createId("reef_op"),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.root ? { root: input.root } : {}),
    kind: input.kind,
    severity: input.severity ?? "info",
    message: input.message,
    ...(input.data ? { data: redactOperationData(input.data) } : {}),
    createdAt: new Date().toISOString(),
  };

  await withOperationLogLock(paths.operationLogPath, async () => {
    await appendFile(paths.operationLogPath, `${JSON.stringify(entry)}\n`, "utf8");
    await capOperationLogUnlocked(paths.operationLogPath);
  });
  return entry;
}

export async function readReefOperations(
  options: Pick<IndexerOptions, "configOverrides">,
  input: ReefOperationQuery = {},
): Promise<ReefOperationLogEntry[]> {
  const paths = resolveReefDaemonPaths(options);
  await mkdir(paths.daemonDir, { recursive: true, mode: 0o700 });
  try {
    return await withOperationLogLock(paths.operationLogPath, async () => {
      const raw = await readFile(paths.operationLogPath, "utf8");
      const limit = input.limit ?? 50;
      return raw
        .split(/\r?\n/u)
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as ReefOperationLogEntry)
        .filter((entry) => !input.projectId || entry.projectId === input.projectId)
        .filter((entry) => !input.kind || entry.kind === input.kind)
        .filter((entry) => !input.severity || entry.severity === input.severity)
        .filter((entry) => !input.since || timestampAtOrAfter(entry.createdAt, input.since))
        .sort((left, right) => compareTimestampsDesc(left.createdAt, right.createdAt))
        .slice(0, limit);
    });
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
}

async function capOperationLogUnlocked(path: string): Promise<void> {
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isMissing(error)) {
      return "";
    }
    throw error;
  });
  const lines = raw.split(/\r?\n/u).filter((line) => line.trim() !== "");
  if (lines.length <= MAX_OPERATION_LOG_ROWS) {
    return;
  }
  await writeFile(path, `${lines.slice(-MAX_OPERATION_LOG_ROWS).join("\n")}\n`, "utf8");
}

async function withOperationLogLock<T>(path: string, callback: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        return await callback();
      } finally {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (error) {
      if (!isAlreadyExists(error)) {
        throw error;
      }
      if (await isStaleOperationLogLock(lockPath)) {
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= OPERATION_LOG_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for Reef operation log lock at ${lockPath}`);
      }
      await sleep(OPERATION_LOG_LOCK_RETRY_MS);
    }
  }
}

async function isStaleOperationLogLock(lockPath: string): Promise<boolean> {
  try {
    const lockStat = await stat(lockPath);
    return Date.now() - lockStat.mtimeMs >= OPERATION_LOG_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function timestampAtOrAfter(createdAt: string, since: string): boolean {
  const createdAtMs = Date.parse(createdAt);
  const sinceMs = Date.parse(since);
  if (Number.isFinite(createdAtMs) && Number.isFinite(sinceMs)) {
    return createdAtMs >= sinceMs;
  }
  return createdAt >= since;
}

function compareTimestampsDesc(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
    return rightMs - leftMs;
  }
  return right.localeCompare(left);
}

function redactOperationData(data: JsonObject): JsonObject {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.toLowerCase().includes("token")) {
      redacted[key] = "[redacted]";
      continue;
    }
    if (value && typeof value === "object") {
      redacted[key] = redactOperationDataValue(value);
      continue;
    }
    redacted[key] = value;
  }
  return redacted as JsonObject;
}

function redactOperationDataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactOperationDataValue);
  }
  if (value && typeof value === "object") {
    return redactOperationData(value as JsonObject);
  }
  return value;
}
