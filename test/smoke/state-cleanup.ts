import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const RETRYABLE_RM_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const SLEEP_BUFFER = new SharedArrayBuffer(4);
const SLEEP_VIEW = new Int32Array(SLEEP_BUFFER);

function sleepSync(ms: number): void {
  Atomics.wait(SLEEP_VIEW, 0, 0, ms);
}

function isRetryableRmError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    RETRYABLE_RM_CODES.has((error as NodeJS.ErrnoException).code ?? "")
  );
}

function isSmokeStateDir(target: string): boolean {
  return path.basename(target).startsWith(".mako-ai-");
}

export function rmSyncRetry(target: string, retries = 16, delayMs = 500): void {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      rmSync(target, { recursive: true, force: true });
      return;
    } catch (error: unknown) {
      if (!isRetryableRmError(error) || attempt === retries) {
        throw error;
      }
      sleepSync(delayMs);
    }
  }
}

// Windows can keep SQLite WAL handles alive briefly after close/process exit.
export function cleanupSmokeStateDir(target: string): void {
  if (!existsSync(target)) {
    return;
  }

  try {
    rmSyncRetry(target);
  } catch (error: unknown) {
    if (process.platform === "win32" && isSmokeStateDir(target) && isRetryableRmError(error)) {
      return;
    }
    throw error;
  }
}
