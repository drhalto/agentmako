/**
 * `services/harness` — HTTP + SSE transport for the Roadmap 3 harness.
 */

import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import {
  createCatalogSource,
  createHarness,
  type CatalogSourceResolver,
  type Harness,
} from "@mako-ai/harness-core";
import type { ProviderSpec } from "@mako-ai/harness-contracts";
import { createLogger, runWithContext } from "@mako-ai/logger";
import { openProjectStore, type ProjectStore } from "@mako-ai/store";
import type { ToolServiceOptions } from "@mako-ai/tools";
import {
  buildDiscoveredModels,
  discoverLocalModelsCached,
  isLoopback,
  writeError,
} from "./server-helpers.js";
import { handleSystemRoutes } from "./server-system-routes.js";
import { handleSessionRoutes } from "./server-session-routes.js";
import { handleMemoryRoutes } from "./server-memory-routes.js";
import type { HarnessRouteContext } from "./server-route-context.js";

const harnessLogger = createLogger("mako-harness-server");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3018;

export interface HarnessServerOptions {
  projectRoot: string;
  host?: string;
  port?: number;
  stateDirName?: string;
  toolOptions?: ToolServiceOptions;
}

export interface StartedHarnessServer {
  host: string;
  port: number;
  harness: Harness;
  store: ProjectStore;
  close(): Promise<void>;
  server: Server;
}

export async function startHarnessServer(
  options: HarnessServerOptions,
): Promise<StartedHarnessServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  if (!isLoopback(host)) {
    throw new Error(`mako-harness only supports loopback hosts. Received: ${host}`);
  }

  const store = openProjectStore({
    projectRoot: options.projectRoot,
    stateDirName: options.stateDirName,
  });
  const catalogSource: CatalogSourceResolver = createCatalogSource();
  const harness = createHarness({
    store,
    toolOptions: options.toolOptions,
    projectRoot: options.projectRoot,
    catalogSource,
  });

  async function syncCatalogIntoRegistry(forceRefresh = false) {
    const catalog = forceRefresh
      ? await catalogSource.refresh()
      : await catalogSource.resolve();
    harness.providerRegistry.applyUpstreamCatalog(catalog.providers);
    return catalog;
  }

  async function syncLocalProviderIntoRegistry(
    providerId: string,
  ): Promise<{
    spec: ProviderSpec;
    localProbe: { ok: boolean; models: number; error?: string } | null;
  }> {
    const entry = harness.providerRegistry.get(providerId);
    if (!entry) {
      throw new Error(`provider-not-found: ${providerId}`);
    }
    const { spec } = entry;
    const resolvedBaseURL = harness.providerRegistry.resolveBaseURL(spec.id);
    if (spec.tier !== "local" || !resolvedBaseURL) {
      return { spec, localProbe: null };
    }
    const resolvedSpec =
      spec.baseURL === resolvedBaseURL
        ? spec
        : {
            ...spec,
            baseURL: resolvedBaseURL,
          };
    const probe = await discoverLocalModelsCached(spec.id, resolvedBaseURL);
    const localProbe = {
      ok: probe.ok,
      models: probe.models.length,
      error: probe.error,
    };
    if (!probe.ok) {
      harness.providerRegistry.applyRuntimeSpec(resolvedSpec);
      return { spec: resolvedSpec, localProbe };
    }
    const nextSpec: ProviderSpec = {
      ...resolvedSpec,
      models: buildDiscoveredModels(spec.models, probe.models),
    };
    harness.providerRegistry.applyRuntimeSpec(nextSpec);
    return { spec: nextSpec, localProbe };
  }

  await syncCatalogIntoRegistry(false);

  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = Date.now();
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const method = request.method ?? "GET";
    const pathname = url.pathname;

    response.on("finish", () => {
      harnessLogger.info("request.complete", {
        requestId,
        method,
        path: pathname,
        statusCode: response.statusCode,
        durationMs: Date.now() - started,
      });
    });

    await runWithContext({ requestId }, async () => {
      const routeContext: HarnessRouteContext = {
        request,
        response,
        requestId,
        url,
        method,
        pathname,
        harness,
        store,
        options: {
          projectRoot: options.projectRoot,
          toolOptions: options.toolOptions,
        },
        port,
        host,
        catalogSource,
        syncCatalogIntoRegistry,
        syncLocalProviderIntoRegistry,
      };

      try {
        if (await handleSystemRoutes(routeContext)) {
          return;
        }
        if (await handleSessionRoutes(routeContext)) {
          return;
        }
        if (await handleMemoryRoutes(routeContext)) {
          return;
        }
        writeError(response, requestId, 404, "not_found", `No route for ${method} ${pathname}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "request body too large") {
          writeError(response, requestId, 413, "request_too_large", message);
          return;
        }
        if (message === "invalid JSON body") {
          writeError(response, requestId, 400, "invalid_json", message);
          return;
        }
        writeError(response, requestId, 500, "internal_error", message);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;

  harnessLogger.info("harness.started", {
    host,
    port: resolvedPort,
    projectRoot: options.projectRoot,
  });

  return {
    host,
    port: resolvedPort,
    harness,
    store,
    server,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        const closeAll = (server as Server & { closeAllConnections?: () => void }).closeAllConnections;
        closeAll?.call(server);
      });
      store.close();
    },
  };
}
