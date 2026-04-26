import {
  aggregateUsage,
  DEFAULT_COMPACTION_THRESHOLD,
  HARNESS_VERSION,
  parseSinceParam,
  parseUsageGroupBy,
  resolveTierFromConfig,
  type Harness,
} from "@mako-ai/harness-core";
import {
  type ModelSpec,
  ProviderSpecSchema,
  type ProviderSpec,
} from "@mako-ai/harness-contracts";
import { PermissionRuleSchema } from "@mako-ai/harness-core";
import { writeGlobalDefaults } from "@mako-ai/config";
import {
  buildDiscoveredModels,
  isLoopback,
  matchPath,
  parseDefaultsPatch,
  readJsonBody,
  readShapedDefaults,
  writeError,
  writeSuccess,
} from "./server-helpers.js";
import type { HarnessRouteContext } from "./server-route-context.js";

export async function handleSystemRoutes(ctx: HarnessRouteContext): Promise<boolean> {
  const {
    method,
    pathname,
    response,
    requestId,
    request,
    url,
    options,
    harness,
    store,
    port,
    host,
    syncCatalogIntoRegistry,
    syncLocalProviderIntoRegistry,
  } = ctx;

  if (method === "OPTIONS") {
    response.statusCode = 204;
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type,x-request-id");
    response.end();
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/health") {
    writeSuccess(response, requestId, 200, {
      status: "ok",
      harness: { projectRoot: options.projectRoot, port, host },
    });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/tier") {
    const resolution = await resolveTierFromConfig({
      providerRegistry: harness.providerRegistry,
      projectRoot: options.projectRoot,
    });
    const embeddingResolution = await harness.resolveEmbeddingProvider();
    const embedding = embeddingResolution.ok
      ? {
          ok: true as const,
          providerId: embeddingResolution.spec.id,
          modelId: embeddingResolution.modelId,
          source: embeddingResolution.source,
          reason: embeddingResolution.reason,
        }
      : {
          ok: false as const,
          reason: embeddingResolution.reason,
          attempted: embeddingResolution.attempted,
        };
    writeSuccess(response, requestId, 200, {
      ...resolution,
      embedding,
      compaction: {
        threshold: DEFAULT_COMPACTION_THRESHOLD,
        harnessVersion: HARNESS_VERSION,
      },
    });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/providers") {
    await syncCatalogIntoRegistry(false);
    const providers = await Promise.all(
      harness.providerRegistry.list().map(async (entry: { spec: ProviderSpec; source: string }) => {
        const { source } = entry;
        const synced =
          entry.spec.tier === "local"
            ? await syncLocalProviderIntoRegistry(entry.spec.id)
            : { spec: entry.spec, localProbe: null };
        const spec = synced.spec;
        const { apiKey: _omit, ...safe } = spec as ProviderSpec & { apiKey?: string };
        const resolvedBaseURL = harness.providerRegistry.resolveBaseURL(spec.id);
        const keyResolution =
          spec.auth === "none"
            ? { key: "not-needed", source: null }
            : await harness.providerRegistry.resolveApiKey(spec.id);
        const reachability =
          spec.tier === "local" && spec.auth === "none"
            ? await harness.providerRegistry.probeLocalProvider(spec.id)
            : null;
        return {
          source,
          keyResolved: spec.auth === "none" ? true : keyResolution.key !== null,
          keySource: keyResolution.source,
          reachable: reachability?.ok ?? null,
          resolvedBaseURL,
          localProbe: synced.localProbe,
          spec: { ...safe, models: safe.models },
        };
      }),
    );
    writeSuccess(response, requestId, 200, { providers });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/defaults") {
    const defaults = await readShapedDefaults(options.projectRoot, harness);
    writeSuccess(response, requestId, 200, defaults);
    return true;
  }

  if (method === "PUT" && pathname === "/api/v1/defaults") {
    const body = await readJsonBody(request);
    const patch = parseDefaultsPatch(body);
    if (patch === null) {
      writeError(
        response,
        requestId,
        400,
        "invalid_request",
        "body must be { agent?: {...}, embedding?: {...} }",
      );
      return true;
    }
    try {
      writeGlobalDefaults(patch);
    } catch (error) {
      writeError(
        response,
        requestId,
        500,
        "defaults/write-failed",
        error instanceof Error ? error.message : String(error),
      );
      return true;
    }
    const updated = await readShapedDefaults(options.projectRoot, harness);
    writeSuccess(response, requestId, 200, updated);
    return true;
  }

  if (method === "POST" && pathname === "/api/v1/providers") {
    const body = await readJsonBody(request);
    const parsed = ProviderSpecSchema.safeParse(body);
    if (!parsed.success) {
      writeError(
        response,
        requestId,
        400,
        "provider/custom-validation-failed",
        parsed.error.message,
      );
      return true;
    }
    await harness.providerRegistry.upsertPersistent(parsed.data);
    writeSuccess(response, requestId, 201, { provider: parsed.data });
    return true;
  }

  const providerTestMatch = matchPath(pathname, "/api/v1/providers/:id/test");
  if (providerTestMatch && method === "POST") {
    const id = providerTestMatch.id!;
    const resolved = harness.providerRegistry.get(id);
    if (!resolved) {
      writeError(response, requestId, 404, "provider/not-found", id);
      return true;
    }
    const baseURL = harness.providerRegistry.resolveBaseURL(id);
    if (resolved.spec.auth === "none") {
      const probe = await harness.providerRegistry.probeLocalProvider(id);
      writeSuccess(response, requestId, 200, {
        provider: id,
        transport: resolved.spec.transport,
        baseURL,
        keyResolved: true,
        keySource: null,
        reachable: probe.ok,
        note: probe.ok
          ? "Local provider endpoint responded to GET /models."
          : `Local provider endpoint did not respond${probe.url ? ` at ${probe.url}` : ""}.`,
      });
      return true;
    }
    const { key, source } = await harness.providerRegistry.resolveApiKey(id);
    const ok = key !== null;
    writeSuccess(response, requestId, 200, {
      provider: id,
      transport: resolved.spec.transport,
      baseURL,
      keyResolved: ok,
      keySource: ok ? source : null,
      note: ok
        ? "Key resolved or auth not required. Live ping is performed at first chat turn."
        : `No key found via env, config, or keyring. Try \`agentmako keys set ${id} --prompt\`.`,
    });
    return true;
  }

  const providerRemoveMatch = matchPath(pathname, "/api/v1/providers/:id");
  if (providerRemoveMatch && method === "DELETE") {
    const removed = await harness.providerRegistry.removePersistent(providerRemoveMatch.id!);
    if (!removed) {
      writeError(
        response,
        requestId,
        409,
        "provider/cannot-remove-bundled",
        `Provider \`${providerRemoveMatch.id}\` is bundled or unknown.`,
      );
      return true;
    }
    writeSuccess(response, requestId, 200, { ok: true });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/models") {
    await syncCatalogIntoRegistry(false);
    await Promise.all(
      harness.providerRegistry.list().map(async (entry: { spec: ProviderSpec }) => {
        if (entry.spec.tier === "local") {
          await syncLocalProviderIntoRegistry(entry.spec.id);
        }
      }),
    );
    const models = harness.providerRegistry.list().flatMap(
      (entry: { spec: ProviderSpec }) =>
        entry.spec.models.map((model: ModelSpec) => ({
          providerId: entry.spec.id,
          providerName: entry.spec.name,
          ...model,
        })),
    );
    writeSuccess(response, requestId, 200, { models });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/catalog/status") {
    const status = await ctx.catalogSource.status();
    writeSuccess(response, requestId, 200, status);
    return true;
  }

  if (method === "POST" && pathname === "/api/v1/catalog/refresh") {
    const catalog = await syncCatalogIntoRegistry(true);
    const status = await ctx.catalogSource.status();
    writeSuccess(response, requestId, 200, {
      ...status,
      providers: catalog.providers.length,
      models: catalog.providers.reduce((sum, provider) => sum + provider.models.length, 0),
    });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/usage") {
    const since = parseSinceParam(url.searchParams.get("since"), 30);
    const groupBy = parseUsageGroupBy(url.searchParams.get("group_by"));
    const projectIdParam = url.searchParams.get("project_id");
    const filter = {
      sinceIso: since,
      projectId: projectIdParam && projectIdParam.length > 0 ? projectIdParam : undefined,
    };
    const rows = store.listHarnessProviderCallsForUsage(filter);
    const rollup = aggregateUsage(rows, groupBy);
    writeSuccess(response, requestId, 200, {
      since,
      groupBy,
      rows: rollup,
      totalCalls: rows.length,
    });
    return true;
  }

  const keysMatch = matchPath(pathname, "/api/v1/keys/:provider");
  if (keysMatch && method === "POST") {
    const body = (await readJsonBody(request)) as { value?: string; from_env?: string };
    let value: string | undefined;
    if (body.from_env) {
      value = process.env[body.from_env];
      if (!value) {
        writeError(
          response,
          requestId,
          400,
          "keys/env-missing",
          `Env var \`${body.from_env}\` is not set.`,
        );
        return true;
      }
    } else if (typeof body.value === "string" && body.value.length > 0) {
      value = body.value;
    } else {
      writeError(
        response,
        requestId,
        400,
        "keys/missing-value",
        "Provide either `from_env` or `value`.",
      );
      return true;
    }
    const ok = await harness.providerRegistry.setApiKeyInKeyring(keysMatch.provider!, value);
    if (!ok) {
      writeError(
        response,
        requestId,
        503,
        "keyring/unavailable",
        "System keychain is unavailable. Set the env var instead.",
      );
      return true;
    }
    writeSuccess(response, requestId, 200, { provider: keysMatch.provider, stored: true });
    return true;
  }

  if (keysMatch && method === "DELETE") {
    const ok = await harness.providerRegistry.deleteApiKeyFromKeyring(keysMatch.provider!);
    writeSuccess(response, requestId, 200, { provider: keysMatch.provider, deleted: ok });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/permissions/rules") {
    const rules = harness.permissionEngine.listRules().map(
      (entry: {
        rule: { permission: string; pattern: string; action: string };
        source: string;
      }) => ({
        ...entry.rule,
        source: entry.source,
      }),
    );
    writeSuccess(response, requestId, 200, { rules });
    return true;
  }

  if (method === "POST" && pathname === "/api/v1/permissions/rules") {
    const body = (await readJsonBody(request)) as {
      permission?: string;
      pattern?: string;
      action?: string;
      scope?: string;
    };
    const parsed = PermissionRuleSchema.safeParse(body);
    if (!parsed.success) {
      writeError(response, requestId, 400, "permission/rule-invalid", parsed.error.message);
      return true;
    }
    const scope = body.scope === "global" ? "global" : "project";
    harness.permissionEngine.upsertPersistent(parsed.data, scope);
    writeSuccess(response, requestId, 201, { rule: parsed.data, scope });
    return true;
  }

  const ruleDeleteMatch = matchPath(pathname, "/api/v1/permissions/rules/:permission/:pattern");
  if (ruleDeleteMatch && method === "DELETE") {
    const permission = ruleDeleteMatch.permission!;
    const pattern = decodeURIComponent(ruleDeleteMatch.pattern!);
    const removed = harness.permissionEngine.removePersistent(permission, pattern);
    writeSuccess(response, requestId, 200, { removed });
    return true;
  }

  const sessionPendingMatch = matchPath(pathname, "/api/v1/sessions/:id/permissions/requests");
  if (sessionPendingMatch && method === "GET") {
    const pending = harness.listPendingApprovals(sessionPendingMatch.id!);
    writeSuccess(response, requestId, 200, { pending });
    return true;
  }

  const requestResolveMatch = matchPath(
    pathname,
    "/api/v1/sessions/:id/permissions/requests/:requestId",
  );
  if (requestResolveMatch && method === "POST") {
    const body = (await readJsonBody(request)) as {
      action?: "allow" | "deny";
      scope?: "turn" | "session" | "project" | "global";
    };
    if (body.action !== "allow" && body.action !== "deny") {
      writeError(response, requestId, 400, "invalid_request", "`action` must be 'allow' or 'deny'.");
      return true;
    }
    const scope = body.scope ?? "turn";
    const ok = harness.resolvePermissionRequest(requestResolveMatch.id!, requestResolveMatch.requestId!, {
      action: body.action,
      scope,
    });
    if (!ok) {
      writeError(
        response,
        requestId,
        404,
        "permission/request-not-found",
        `No pending request \`${requestResolveMatch.requestId}\` for session \`${requestResolveMatch.id}\`.`,
      );
      return true;
    }
    writeSuccess(response, requestId, 200, { resolved: true });
    return true;
  }

  return false;
}
