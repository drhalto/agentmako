import os from "node:os";
import path from "node:path";
import {
  DEFAULT_GLOBAL_DB_FILENAME,
  DEFAULT_PROJECT_DB_FILENAME,
  DEFAULT_STATE_DIRNAME,
} from "./defaults.js";

function defaultHome(): string {
  return process.env.MAKO_STATE_HOME ?? os.homedir();
}

export function resolveStateDir(homeDir: string = defaultHome()): string {
  return path.join(homeDir, DEFAULT_STATE_DIRNAME);
}

export function resolveStateDirWithName(
  homeDir: string = defaultHome(),
  stateDirName: string = DEFAULT_STATE_DIRNAME,
): string {
  return path.join(homeDir, stateDirName);
}

export function resolveGlobalDbPath(
  homeDir: string = defaultHome(),
  stateDirName: string = DEFAULT_STATE_DIRNAME,
  globalDbFilename: string = DEFAULT_GLOBAL_DB_FILENAME,
): string {
  return path.join(resolveStateDirWithName(homeDir, stateDirName), globalDbFilename);
}

export function resolveProjectStateDir(
  projectRoot: string,
  stateDirName: string = DEFAULT_STATE_DIRNAME,
): string {
  return path.join(projectRoot, stateDirName);
}

export function resolveProjectDbPath(
  projectRoot: string,
  stateDirName: string = DEFAULT_STATE_DIRNAME,
  projectDbFilename: string = DEFAULT_PROJECT_DB_FILENAME,
): string {
  return path.join(resolveProjectStateDir(projectRoot, stateDirName), projectDbFilename);
}
