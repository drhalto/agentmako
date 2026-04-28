import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, resolveStateDirWithName, type MakoConfig } from "@mako-ai/config";
import type { ReefDaemonProcessInfo, ReefDaemonTransport } from "@mako-ai/contracts";

export const REEF_DAEMON_PROTOCOL_VERSION = "2.3";
export const REEF_DAEMON_PACKAGE_VERSION = "0.1.0";

export interface ReefDaemonPaths {
  stateHome: string;
  stateDir: string;
  daemonDir: string;
  processPath: string;
  tokenPath: string;
  operationLogPath: string;
  locksDir: string;
  daemonLockDir: string;
  rootLocksDir: string;
  endpoint: string;
  transport: ReefDaemonTransport;
}

export interface ReefPathOptions {
  configOverrides?: Partial<MakoConfig>;
}

export function resolveReefDaemonPaths(options: ReefPathOptions = {}): ReefDaemonPaths {
  const config = loadConfig(options.configOverrides);
  const stateHome = config.stateHome ?? os.homedir();
  const stateDir = resolveStateDirWithName(stateHome, config.stateDirName);
  const daemonDir = path.join(stateDir, "reef", "daemon");
  const locksDir = path.join(daemonDir, "locks");
  const rootLocksDir = path.join(locksDir, "roots");
  const endpointHash = shortHash(stateDir);
  const transport: ReefDaemonTransport = process.platform === "win32" ? "pipe" : "unix_socket";
  const endpoint = transport === "pipe"
    ? `\\\\.\\pipe\\agentmako-reef-${endpointHash}`
    : path.join(daemonDir, "reef.sock");

  return {
    stateHome,
    stateDir,
    daemonDir,
    processPath: path.join(daemonDir, "process.json"),
    tokenPath: path.join(daemonDir, "token"),
    operationLogPath: path.join(daemonDir, "operations.ndjson"),
    locksDir,
    daemonLockDir: path.join(locksDir, "daemon.lock"),
    rootLocksDir,
    endpoint,
    transport,
  };
}

export async function ensureReefDaemonDirs(paths: ReefDaemonPaths): Promise<void> {
  await mkdir(paths.rootLocksDir, { recursive: true, mode: 0o700 });
}

export async function readReefDaemonProcessInfo(
  options: ReefPathOptions = {},
): Promise<ReefDaemonProcessInfo | null> {
  const paths = resolveReefDaemonPaths(options);
  try {
    const raw = await readFile(paths.processPath, "utf8");
    return JSON.parse(raw) as ReefDaemonProcessInfo;
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

export async function writeReefDaemonProcessInfo(
  info: ReefDaemonProcessInfo,
  options: ReefPathOptions = {},
): Promise<void> {
  const paths = resolveReefDaemonPaths(options);
  await ensureReefDaemonDirs(paths);
  await writeFile(paths.processPath, `${JSON.stringify(info, null, 2)}\n`, "utf8");
}

export async function removeReefDaemonProcessInfo(options: ReefPathOptions = {}): Promise<void> {
  const paths = resolveReefDaemonPaths(options);
  await rm(paths.processPath, { force: true });
}

export async function readReefDaemonToken(options: ReefPathOptions = {}): Promise<string | null> {
  const paths = resolveReefDaemonPaths(options);
  try {
    return (await readFile(paths.tokenPath, "utf8")).trim();
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

export async function writeReefDaemonToken(
  token: string,
  options: ReefPathOptions = {},
): Promise<void> {
  const paths = resolveReefDaemonPaths(options);
  await ensureReefDaemonDirs(paths);
  await writeFile(paths.tokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") {
    await chmod(paths.tokenPath, 0o600).catch(() => undefined);
  }
}

export async function removeReefDaemonToken(options: ReefPathOptions = {}): Promise<void> {
  const paths = resolveReefDaemonPaths(options);
  await rm(paths.tokenPath, { force: true });
}

export async function removeReefDaemonSocket(options: ReefPathOptions = {}): Promise<void> {
  const paths = resolveReefDaemonPaths(options);
  if (paths.transport === "unix_socket" && existsSync(paths.endpoint)) {
    await rm(paths.endpoint, { force: true });
  }
}

export function createDaemonToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenFingerprint(token: string): string {
  return shortHash(token);
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    return code === "EPERM";
  }
}

export function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
