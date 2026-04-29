/**
 * `agentmako dashboard` — one-shot launcher for the local web UI.
 *
 * Boots `services/api` and `services/harness` in-process, then starts the
 * dashboard UI. In a source checkout this spawns Vite from `apps/web`; in
 * the installed package this serves the bundled static `dist/web` assets
 * and proxies `/api/v1/*` to the right local service.
 *
 * Ctrl+C cleanly tears down every owned server/process.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
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
const STATIC_BODY_LIMIT_BYTES = 1_000_000;

type WebRuntime =
  | { kind: "vite"; dir: string; viteBin: string }
  | { kind: "static"; dir: string };

interface StartedDashboardWebServer {
  host: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

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

  const webRuntime = resolveWebRuntime();
  if (!webRuntime) {
    throw new Error(
      "Couldn't find dashboard assets. In a source checkout, run from the mako repo root after `corepack pnpm install`; in an installed package, rebuild/reinstall so `dist/web/index.html` is present.",
    );
  }

  console.log(color("Starting mako dashboard…", COLORS.bright + COLORS.cyan));
  console.log();
  console.log(`  ${color("project:", COLORS.gray)} ${args.projectRoot}`);
  console.log(`  ${color("web:    ", COLORS.gray)} ${webRuntime.dir} (${webRuntime.kind})`);
  console.log();

  let harness: StartedHarnessServer | undefined;
  let webServer: StartedDashboardWebServer | undefined;
  let child: ChildProcess | undefined;
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

  let shuttingDown = false;
  const shutdown = async (signal?: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log();
    console.log(color(`Shutting down dashboard${signal ? ` (${signal})` : ""}…`, COLORS.gray));
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
    }
    await Promise.allSettled([safeClose(api), safeClose(harness), safeClose(webServer)]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  const url = `http://127.0.0.1:${args.port}`;

  if (webRuntime.kind === "vite") {
    // Spawn Vite via the current Node binary directly. This avoids Windows
    // `.cmd` shim quirks (`pnpm.cmd` requires `shell: true`, npx adds another
    // hop) and keeps stderr/stdout cleanly piped through.
    child = spawn(
      process.execPath,
      [webRuntime.viteBin, "--port", String(args.port), "--strictPort"],
      {
        cwd: webRuntime.dir,
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
  } else {
    try {
      webServer = await startStaticDashboardServer({
        host: "127.0.0.1",
        port: args.port,
        staticDir: webRuntime.dir,
        apiOrigin: `http://${api.host}:${api.port}`,
        harnessOrigin: `http://${harness.host}:${harness.port}`,
      });
    } catch (error) {
      await Promise.allSettled([safeClose(api), safeClose(harness)]);
      throw error;
    }
  }

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

  // Block forever — the process stays up until Ctrl+C or the web server exits.
  await new Promise<void>(() => undefined);
}

function resolveWebRuntime(): WebRuntime | null {
  const mode = process.env.MAKO_DASHBOARD_MODE;
  if (mode !== "static") {
    const sourceDir = findSourceWebDir();
    if (sourceDir) {
      const viteBin = resolveViteBin(sourceDir);
      if (viteBin) {
        return { kind: "vite", dir: sourceDir, viteBin };
      }
    }
  }

  if (mode !== "vite") {
    const packagedDir = findPackagedWebDir();
    if (packagedDir) {
      return { kind: "static", dir: packagedDir };
    }
  }

  return null;
}

// =============================================================================
// Helpers
// =============================================================================

function findSourceWebDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [];

  if (process.env.MAKO_WEB_DIR) {
    candidates.push(resolve(process.env.MAKO_WEB_DIR));
  }

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
    if (isMakoWebSourceDir(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isMakoWebSourceDir(candidate: string): boolean {
  if (!existsSync(resolve(candidate, "vite.config.ts"))) {
    return false;
  }
  try {
    const packageJson = JSON.parse(
      readFileSync(resolve(candidate, "package.json"), "utf8"),
    ) as { name?: unknown };
    return packageJson.name === "@mako-ai/web";
  } catch {
    return false;
  }
}

function findPackagedWebDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "web"),
    resolve(here, "dashboard"),
    resolve(here, "..", "web"),
  ];

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, "index.html"))) {
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

async function startStaticDashboardServer(args: {
  host: string;
  port: number;
  staticDir: string;
  apiOrigin: string;
  harnessOrigin: string;
}): Promise<StartedDashboardWebServer> {
  const server = createServer((request, response) => {
    void handleStaticDashboardRequest(request, response, args).catch((error) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(args.port, args.host, () => {
      server.off("error", reject);
      resolveReady();
    });
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : args.port;
  return {
    host: args.host,
    port: resolvedPort,
    server,
    close: async () => {
      await new Promise<void>((resolveReady, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolveReady();
        });
        const closeAll = (server as Server & { closeAllConnections?: () => void }).closeAllConnections;
        closeAll?.call(server);
      });
    },
  };
}

async function handleStaticDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  args: {
    staticDir: string;
    apiOrigin: string;
    harnessOrigin: string;
  },
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) {
    const target = isApiDashboardPath(url.pathname) ? args.apiOrigin : args.harnessOrigin;
    await proxyDashboardRequest(request, response, target, url);
    return;
  }

  serveDashboardAsset(request, response, args.staticDir, url.pathname);
}

function isApiDashboardPath(pathname: string): boolean {
  return [
    "/api/v1/dashboard",
    "/api/v1/projects",
    "/api/v1/tools",
    "/api/v1/answers",
    "/api/v1/workflow-packets",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function proxyDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  targetOrigin: string,
  url: URL,
): Promise<void> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "content-length") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  const method = request.method ?? "GET";
  const hasBody = !["GET", "HEAD"].includes(method.toUpperCase());
  const upstream = await fetch(`${targetOrigin}${url.pathname}${url.search}`, {
    method,
    headers,
    body: hasBody ? await readRequestBody(request) : undefined,
  });

  response.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    if (!isHopByHopHeader(key)) {
      response.setHeader(key, value);
    }
  });

  if (request.method === "HEAD" || !upstream.body) {
    response.end();
    return;
  }

  Readable.fromWeb(upstream.body as never).pipe(response);
}

function serveDashboardAsset(
  request: IncomingMessage,
  response: ServerResponse,
  staticDir: string,
  pathname: string,
): void {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.statusCode = 405;
    response.setHeader("allow", "GET, HEAD");
    response.end();
    return;
  }

  const root = resolve(staticDir);
  const decodedPath = safeDecodePath(pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const candidate = resolve(root, relativePath);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(rootPrefix)) {
    response.statusCode = 403;
    response.end("Forbidden");
    return;
  }

  const filePath = readableFile(candidate)
    ? candidate
    : extname(relativePath) === ""
      ? resolve(root, "index.html")
      : null;
  if (!filePath) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }
  if (!readableFile(filePath)) {
    response.statusCode = 404;
    response.end("Not found");
    return;
  }

  const stat = statSync(filePath);
  response.statusCode = 200;
  response.setHeader("content-type", contentTypeFor(filePath));
  response.setHeader(
    "cache-control",
    filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
  );
  response.setHeader("content-length", String(stat.size));
  if (method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function safeDecodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "/";
  }
}

function readableFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function contentTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += buffer.length;
    if (totalSize > STATIC_BODY_LIMIT_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isHopByHopHeader(header: string): boolean {
  return [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ].includes(header.toLowerCase());
}

async function safeClose(
  service: StartedHttpServer | StartedHarnessServer | StartedDashboardWebServer | undefined,
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
  const openChild = spawn(command, args, { stdio: "ignore", detached: true });
  openChild.unref();
}
