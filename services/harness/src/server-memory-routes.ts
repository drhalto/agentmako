import {
  recallMemories,
  reindexEmbeddings,
  searchSemantic,
} from "@mako-ai/harness-core";
import { matchPath, readJsonBody, writeError, writeSuccess } from "./server-helpers.js";
import type { HarnessRouteContext } from "./server-route-context.js";

export async function handleMemoryRoutes(ctx: HarnessRouteContext): Promise<boolean> {
  const { method, pathname, response, requestId, request, url, harness, store } = ctx;

  if (method === "POST" && pathname === "/api/v1/memory/remember") {
    const body = (await readJsonBody(request)) as {
      text?: unknown;
      category?: unknown;
      tags?: unknown;
      project_id?: unknown;
    };
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      writeError(response, requestId, 400, "invalid_request", "text must be a non-empty string");
      return true;
    }
    const category = typeof body.category === "string" ? body.category : null;
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    const projectId =
      typeof body.project_id === "string" && body.project_id.trim().length > 0
        ? body.project_id
        : undefined;

    const record = store.insertHarnessMemory({
      projectId,
      text: body.text,
      category,
      tags,
    });

    const resolution = await harness.resolveEmbeddingProvider();
    let embedded = false;
    let embeddingError: string | null = null;
    let embeddingModel: string | null = null;

    if (resolution.ok) {
      try {
        const vector = await resolution.provider.embed(body.text);
        store.insertEmbedding({
          ownerKind: "memory",
          ownerId: record.memoryId,
          provider: resolution.provider.providerId,
          model: resolution.provider.modelId,
          vector,
        });
        embedded = true;
        embeddingModel = resolution.provider.modelId;
      } catch (error) {
        embeddingError = error instanceof Error ? error.message : String(error);
      }
    } else {
      embeddingError = resolution.reason;
    }

    writeSuccess(response, requestId, 200, {
      id: record.memoryId,
      createdAt: record.createdAt,
      embedded,
      embeddingModel,
      embeddingError,
    });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/memory/recall") {
    const query = url.searchParams.get("q");
    if (!query || query.trim().length === 0) {
      writeError(response, requestId, 400, "invalid_request", "query param `q` is required");
      return true;
    }
    const kRaw = url.searchParams.get("k");
    const k = kRaw ? Math.max(1, Math.min(50, Number.parseInt(kRaw, 10) || 10)) : 10;
    const projectIdParam = url.searchParams.get("project_id");
    const projectId =
      projectIdParam && projectIdParam.trim().length > 0
        ? projectIdParam
        : undefined;

    const resolution = await harness.resolveEmbeddingProvider();
    const embeddingProvider = resolution.ok ? resolution.provider : null;

    const result = await recallMemories({
      store,
      query,
      embeddingProvider,
      projectId,
      k,
    });
    writeSuccess(response, requestId, 200, result);
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/memory") {
    const category = url.searchParams.get("category") ?? null;
    const tag = url.searchParams.get("tag") ?? null;
    const since = url.searchParams.get("since") ?? null;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Math.max(1, Math.min(500, Number.parseInt(limitRaw, 10) || 100)) : 100;
    const projectId = url.searchParams.get("project_id") ?? undefined;

    const rows = store.listHarnessMemories({
      projectId: projectId === undefined ? undefined : projectId,
      category,
      tag,
      since,
      limit,
    });
    writeSuccess(response, requestId, 200, {
      count: rows.length,
      memories: rows.map((row) => ({
        id: row.memoryId,
        text: row.text,
        category: row.category,
        tags: row.tags,
        createdAt: row.createdAt,
      })),
    });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/semantic/search") {
    const query = url.searchParams.get("q");
    if (!query || query.trim().length === 0) {
      writeError(response, requestId, 400, "invalid_request", "query param `q` is required");
      return true;
    }

    const kindValues = url.searchParams
      .getAll("kind")
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is "code" | "doc" | "memory" =>
        value === "code" || value === "doc" || value === "memory",
      );
    const rawKindValues = url.searchParams.getAll("kind");
    if (rawKindValues.length > 0 && kindValues.length !== rawKindValues.length) {
      writeError(response, requestId, 400, "invalid_request", "`kind` must be one of code, doc, memory");
      return true;
    }

    const includeMemoriesParam = url.searchParams.get("include_memories");
    const includeMemories =
      includeMemoriesParam == null
        ? undefined
        : includeMemoriesParam !== "false" &&
          includeMemoriesParam !== "0" &&
          includeMemoriesParam !== "no";

    const kRaw = url.searchParams.get("k");
    const k = kRaw ? Math.max(1, Math.min(50, Number.parseInt(kRaw, 10) || 10)) : 10;
    const projectIdParam = url.searchParams.get("project_id");
    const projectId =
      projectIdParam && projectIdParam.trim().length > 0
        ? projectIdParam
        : undefined;
    const resolution = await harness.resolveEmbeddingProvider();

    const result = await searchSemantic({
      store,
      query,
      embeddingProvider: resolution.ok ? resolution.provider : null,
      projectId,
      k,
      kinds: kindValues.length > 0 ? kindValues : undefined,
      includeMemories,
    });
    writeSuccess(response, requestId, 200, result);
    return true;
  }

  if (method === "POST" && pathname === "/api/v1/embeddings/reindex") {
    const body = (await readJsonBody(request)) as {
      kind?: unknown;
      kinds?: unknown;
      project_id?: unknown;
    };
    const rawKinds = Array.isArray(body.kinds)
      ? body.kinds
      : body.kind === undefined
        ? []
        : [body.kind];
    const normalizedKinds: Array<"memory" | "semantic_unit"> = [];
    for (const rawKind of rawKinds) {
      if (typeof rawKind !== "string") {
        writeError(response, requestId, 400, "invalid_request", "`kind` must be a string");
        return true;
      }
      const value = rawKind.trim().toLowerCase();
      if (value === "all") {
        normalizedKinds.push("semantic_unit", "memory");
        continue;
      }
      if (value === "semantic-unit" || value === "semantic_unit") {
        normalizedKinds.push("semantic_unit");
        continue;
      }
      if (value === "memory") {
        normalizedKinds.push("memory");
        continue;
      }
      writeError(
        response,
        requestId,
        400,
        "invalid_request",
        "`kind` must be one of memory, semantic-unit, all",
      );
      return true;
    }

    const resolution = await harness.resolveEmbeddingProvider();
    if (!resolution.ok) {
      writeError(response, requestId, 503, "embeddings/provider-unavailable", resolution.reason);
      return true;
    }

    const projectId =
      typeof body.project_id === "string" && body.project_id.trim().length > 0
        ? body.project_id
        : undefined;

    const result = await reindexEmbeddings({
      store,
      embeddingProvider: resolution.provider,
      kinds: normalizedKinds.length > 0 ? [...new Set(normalizedKinds)] : undefined,
      projectId,
    });
    writeSuccess(response, requestId, 200, result);
    return true;
  }

  return false;
}
