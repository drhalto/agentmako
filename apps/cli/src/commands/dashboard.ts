/**
 * `agentmako dashboard` — one-shot launcher for the local web UI.
 *
 * Boots `services/api` and `services/harness` in-process and spawns the
 * Vite dev server from `apps/web`. The dev server already proxies
 * `/api/v1/*` to the right service (api for project routes, harness for
 * sessions / memory / semantic / embeddings) when given the
 * `MAKO_API_URL` and `MAKO_HARNESS_URL` env vars, so we just point it at
 * the in-process services and open the browser when it's reachable.
 *
 * Ctrl+C cleanly tears down all three.
 *
 * The published-package case (no `apps/web` next to the bundle) is a
 * follow-up: this v1 assumes a monorepo checkout. The error message
 * tells operators what's missing if `apps/web` can't be found.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startHttpApiServer, type StartedHttpServer } from "@mako-ai/api";
import { startHarnessServer, type StartedHarnessServer } from "@mako-ai/harness";
import { COLORS, color } from "../shared.js";

interface DashboardArgs {
  port: number;
  apiPort: number;
  harnessPort: number;
  open: boolean;
  projectRoot: string;
}

const DEFAULT_WEB_PORT = 3019;
const DEFAULT_API_PORT = 3017;
const DEFAULT_HARNESS_PORT = 3018;

function parseDashboardArgs(args: string[]): DashboardArgs {
  let port = DEFAULT_WEB_PORT;
  let apiPort = DEFAULT_API_PORT;
  let harnessPort = DEFAULT_HARNESS_PORT;
  let open = true;
  let projectRoot = process.cwd();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--port") {
      const value = args[++index];
      if (!value) throw new Error("`--port` requires a value.");
      port = parsePort(value, "--port");
      continue;
    }
    if (arg === "--api-port") {
      const value = args[++index];
      if (!value) throw new Error("`--api-port` requires a value.");
      apiPort = parsePort(value, "--api-port");
      continue;
    }
    if (arg === "--harness-port") {
      const value = args[++index];
      if (!value) throw new Error("`--harness-port` requires a value.");
      harnessPort = parsePort(value, "--harness-port");
      continue;
    }
    if (arg === "--no-open") {
      open = false;
      continue;
    }
    if (arg === "--project") {
      const value = args[++index];
      if (!value) throw new Error("`--project` requires a path.");
      projectRoot = resolve(value);
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown dashboard option: ${arg}`);
    }
    // First positional is treated as project root.
    projectRoot = resolve(arg);
  }

  return { port, apiPort, harnessPort, open, projectRoot };
}

function parsePort(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${flag} must be an integer between 1 and 65535. Got: ${value}`);
  }
  return parsed;
}

export async function runDashboardCommand(rawArgs: string[]): Promise<void> {
  const args = parseDashboardArgs(rawArgs);

  const webDir = findWebDir();
  if (!webDir) {
    throw new Error(
      "Couldn't find `apps/web` near the agentmako binary. The dashboard launcher currently requires a mako monorepo checkout — run from the repo root.",
    );
  }

  console.log(color("Starting mako dashboard…", COLORS.bright + COLORS.cyan));
  console.log();
  console.log(`  ${color("project:", COLORS.gray)} ${args.projectRoot}`);
  console.log(`  ${color("web:    ", COLORS.gray)} ${webDir}`);
  console.log();

  let harness: StartedHarnessServer | undefined;
  let restartHarnessPromise: Promise<void> | null = null;
  const api = await startHttpApiServer({
    host: "127.0.0.1",
    port: args.apiPort,
    dashboardControls: {
      restartHarness: async () => {
        if (restartHarnessPromise) return restartHarnessPromise;
        restartHarnessPromise = (async () => {
          if (!harness) {
            throw new Error("Harness is not running.");
          }
          console.log(`${color("↻", COLORS.yellow)} harness  restarting…`);
          await safeClose(harness);
          harness = await startHarnessServer({
            projectRoot: args.projectRoot,
            host: "127.0.0.1",
            port: args.harnessPort,
          });
          console.log(`${color("✓", COLORS.green)} harness  http://${harness.host}:${harness.port}`);
        })().finally(() => {
          restartHarnessPromise = null;
        });
        return restartHarnessPromise;
      },
    },
  });
  console.log(`${color("✓", COLORS.green)} api      http://${api.host}:${api.port}`);

  try {
    harness = await startHarnessServer({
      projectRoot: args.projectRoot,
      host: "127.0.0.1",
      port: args.harnessPort,
    });
    console.log(`${color("✓", COLORS.green)} harness  http://${harness.host}:${harness.port}`);
  } catch (error) {
    await safeClose(api);
    throw error;
  }

  const viteBin = resolveViteBin(webDir);
  if (!viteBin) {
    await safeClose(api);
    await safeClose(harness);
    throw new Error(
      `Couldn't resolve \`vite\` from ${webDir}. Run \`corepack pnpm install\` from the workspace root and retry.`,
    );
  }

  // Spawn Vite via the current Node binary directly. This avoids Windows
  // `.cmd` shim quirks (`pnpm.cmd` requires `shell: true`, npx adds another
  // hop) and keeps stderr/stdout cleanly piped through.
  const child = spawn(
    process.execPath,
    [viteBin, "--port", String(args.port), "--strictPort"],
    {
      cwd: webDir,
      env: {
        ...process.env,
        MAKO_API_URL: `http://${api.host}:${api.port}`,
        MAKO_HARNESS_URL: `http://${harness.host}:${harness.port}`,
        MAKO_WEB_PORT: String(args.port),
      },
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
    },
  );

  let shuttingDown = false;
  const shutdown = async (signal?: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log();
    console.log(color(`Shutting down dashboard${signal ? ` (${signal})` : ""}…`, COLORS.gray));
    if (!child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
    }
    await Promise.allSettled([safeClose(api), safeClose(harness)]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  child.on("error", (error) => {
    console.error();
    console.error(`${color("✗", COLORS.red)} vite failed to start: ${error.message}`);
    void shutdown();
  });

  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      console.error();
      console.error(`${color("✗", COLORS.red)} vite exited (${reason}); shutting down.`);
      process.exitCode = code ?? 1;
      void shutdown();
    }
  });

  const url = `http://127.0.0.1:${args.port}`;
  void waitForReachable(url, 30_000).then(async (ready) => {
    if (!ready) {
      console.error();
      console.error(`${color("⚠", COLORS.yellow)} dashboard didn't respond at ${url} within 30s.`);
      return;
    }
    console.log(`${color("✓", COLORS.green)} dashboard ${url}`);
    console.log();
    console.log(color("Press Ctrl+C to stop.", COLORS.gray));
    if (args.open) {
      try {
        openBrowser(url);
      } catch (error) {
        console.error(
          `${color("⚠", COLORS.yellow)} couldn't open the browser automatically: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });

  // Block forever — the process stays up until Ctrl+C or vite exits.
  await new Promise<void>(() => undefined);
}

// =============================================================================
// Helpers
// =============================================================================

function findWebDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [];

  // Walk up from the binary location: typical hits are
  //   apps/cli/dist/  (bundled CLI)
  //   apps/cli/src/   (tsx/dev)
  // and we want apps/web/ at the same level.
  let dir = here;
  for (let i = 0; i < 6; i += 1) {
    candidates.push(resolve(dir, "..", "web"));
    candidates.push(resolve(dir, "..", "apps", "web"));
    candidates.push(resolve(dir, "apps", "web"));
    dir = resolve(dir, "..");
  }

  // Fallback: process.cwd() in case the user ran from the workspace root.
  candidates.push(resolve(process.cwd(), "apps", "web"));

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "vite.config.ts"))) {
      return candidate;
    }
  }
  return null;
}

function resolveViteBin(webDir: string): string | null {
  // `createRequire` rooted at apps/web/package.json so we resolve the same
  // Vite version pnpm wired in for the dashboard, regardless of where the
  // CLI was invoked from.
  const requireFromWeb = createRequire(pathToFileURL(resolve(webDir, "package.json")));
  let pkgJsonPath: string;
  try {
    pkgJsonPath = requireFromWeb.resolve("vite/package.json");
  } catch {
    return null;
  }
  const pkgDir = dirname(pkgJsonPath);

  // Vite ships a CJS entry at `bin/vite.js` that we can run via `node`.
  const candidate = resolve(pkgDir, "bin", "vite.js");
  return existsSync(candidate) ? candidate : null;
}

async function safeClose(
  service: StartedHttpServer | StartedHarnessServer | undefined,
): Promise<void> {
  if (!service) return;
  try {
    await service.close();
  } catch {
    /* noop */
  }
}

async function waitForReachable(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok || response.status === 404) return true;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;
  let args: string[];
  if (platform === "win32") {
    // `start` is a cmd builtin; the empty string is the (optional) window title.
    command = "cmd";
    args = ["/c", "start", "", url];
  } else if (platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}
