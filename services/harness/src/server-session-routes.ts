import { applyUndo } from "@mako-ai/harness-tools";
import {
  CreateSessionRequestSchema,
  PostMessageRequestSchema,
  UpdateSessionRequestSchema,
} from "@mako-ai/harness-contracts";
import type { ProviderSpec } from "@mako-ai/harness-contracts";
import {
  computeSessionUsage,
  matchPath,
  readJsonBody,
  sseFormat,
  writeError,
  writeSuccess,
} from "./server-helpers.js";
import type { HarnessRouteContext } from "./server-route-context.js";

async function syncRequestProviders(
  ctx: HarnessRouteContext,
  providerIds: Iterable<string>,
): Promise<void> {
  await ctx.syncCatalogIntoRegistry(false);
  await Promise.all(
    [...new Set(providerIds)].map(async (providerId) => {
      const entry = ctx.harness.providerRegistry.get(providerId);
      if (entry?.spec.tier === "local") {
        await ctx.syncLocalProviderIntoRegistry(providerId);
      }
    }),
  );
}

export async function handleSessionRoutes(ctx: HarnessRouteContext): Promise<boolean> {
  const { method, pathname, response, requestId, request, url, options, harness, store } = ctx;

  const resumeMatch = matchPath(pathname, "/api/v1/sessions/:id/resume");
  if (resumeMatch && method === "POST") {
    try {
      const result = await harness.resume(resumeMatch.id!);
      writeSuccess(response, requestId, 200, result);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? "resume/failed";
      const message = error instanceof Error ? error.message : String(error);
      const status = code === "resume/session-not-found" ? 404 : 400;
      writeError(response, requestId, status, code, message);
    }
    return true;
  }

  const undoMatch = matchPath(pathname, "/api/v1/sessions/:id/undo/:ordinal");
  if (undoMatch && method === "POST") {
    const ordinal = Number.parseInt(undoMatch.ordinal!, 10);
    if (!Number.isFinite(ordinal)) {
      writeError(response, requestId, 400, "invalid_request", "ordinal must be an integer");
      return true;
    }
    try {
      const result = applyUndo(options.projectRoot, undoMatch.id!, ordinal);
      writeSuccess(response, requestId, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeError(response, requestId, 404, "action/snapshot-not-found", message);
    }
    return true;
  }

  if (method === "POST" && pathname === "/api/v1/sessions") {
    const body = await readJsonBody(request);
    const parsed = CreateSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      writeError(response, requestId, 400, "invalid_request", parsed.error.message);
      return true;
    }
    const providerIds = new Set<string>();
    if (parsed.data.provider) providerIds.add(parsed.data.provider);
    for (const entry of parsed.data.fallbackChain ?? []) {
      providerIds.add(entry.provider);
    }
    await syncRequestProviders(ctx, providerIds);
    const session = await harness.createSession(parsed.data);
    writeSuccess(response, requestId, 201, { session });
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/sessions") {
    const projectId = url.searchParams.get("project_id") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const sessions = harness.listSessions({
      projectId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    writeSuccess(response, requestId, 200, { sessions });
    return true;
  }

  const sessionMatch = matchPath(pathname, "/api/v1/sessions/:id");
  if (sessionMatch && method === "GET") {
    const session = harness.getSession(sessionMatch.id!);
    if (!session) {
      writeError(response, requestId, 404, "session_not_found", sessionMatch.id!);
      return true;
    }
    const { messages, archivedCount } = harness.listMessages(sessionMatch.id!);
    const usage = computeSessionUsage(harness, store, session);
    writeSuccess(response, requestId, 200, {
      session,
      messages,
      archivedCount,
      usage,
    });
    return true;
  }

  if (sessionMatch && method === "PATCH") {
    const body = await readJsonBody(request);
    const parsed = UpdateSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      writeError(response, requestId, 400, "invalid_request", parsed.error.message);
      return true;
    }
    const providerIds = new Set<string>();
    if (parsed.data.provider) providerIds.add(parsed.data.provider);
    for (const entry of parsed.data.fallbackChain ?? []) {
      providerIds.add(entry.provider);
    }
    await syncRequestProviders(ctx, providerIds);
    try {
      const session = harness.updateSession(sessionMatch.id!, parsed.data);
      writeSuccess(response, requestId, 200, { session });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("session-not-found")) {
        writeError(response, requestId, 404, "session_not_found", sessionMatch.id!);
        return true;
      }
      writeError(response, requestId, 400, "session/update-failed", message);
    }
    return true;
  }

  if (sessionMatch && method === "DELETE") {
    harness.deleteSession(sessionMatch.id!);
    writeSuccess(response, requestId, 200, { ok: true });
    return true;
  }

  const truncateMatch = matchPath(pathname, "/api/v1/sessions/:id/truncate");
  if (truncateMatch && method === "POST") {
    const body = await readJsonBody(request);
    const fromMessageIdRaw =
      body && typeof body === "object" && body !== null
        ? (body as { fromMessageId?: unknown }).fromMessageId
        : undefined;
    if (typeof fromMessageIdRaw !== "string" || fromMessageIdRaw.length === 0) {
      writeError(response, requestId, 400, "invalid_request", "fromMessageId must be a non-empty string");
      return true;
    }
    try {
      const result = harness.truncateMessagesFromId(truncateMatch.id!, fromMessageIdRaw);
      writeSuccess(response, requestId, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("session-not-found")) {
        writeError(response, requestId, 404, "session_not_found", truncateMatch.id!);
        return true;
      }
      if (message.includes("message-not-found")) {
        writeError(response, requestId, 404, "message_not_found", message);
        return true;
      }
      writeError(response, requestId, 500, "internal_error", message);
    }
    return true;
  }

  const messagesMatch = matchPath(pathname, "/api/v1/sessions/:id/messages");
  if (messagesMatch && method === "POST") {
    const body = await readJsonBody(request);
    const parsed = PostMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      writeError(response, requestId, 400, "invalid_request", parsed.error.message);
      return true;
    }
    await ctx.syncCatalogIntoRegistry(false);
    const session = store.getHarnessSession(messagesMatch.id!);
    if (session?.activeProvider) {
      const entry = harness.providerRegistry.get(session.activeProvider);
      if (entry?.spec.tier === "local") {
        await ctx.syncLocalProviderIntoRegistry(session.activeProvider);
      }
    }
    try {
      const result = harness.postMessage(
        messagesMatch.id!,
        parsed.data.content,
        parsed.data.caller ? { caller: parsed.data.caller } : undefined,
      );
      writeSuccess(response, requestId, 202, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("session-not-found")) {
        writeError(response, requestId, 404, "session_not_found", messagesMatch.id!);
        return true;
      }
      writeError(response, requestId, 500, "internal_error", message);
    }
    return true;
  }

  const streamMatch = matchPath(pathname, "/api/v1/sessions/:id/stream");
  if (streamMatch && method === "GET") {
    const sessionId = streamMatch.id!;
    const session = harness.getSession(sessionId);
    if (!session) {
      writeError(response, requestId, 404, "session_not_found", sessionId);
      return true;
    }

    response.statusCode = 200;
    response.setHeader("content-type", "text/event-stream");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("x-request-id", requestId);
    response.write("retry: 5000\n\n");

    const afterParam = url.searchParams.get("after");
    const afterOrdinal = afterParam ? Number.parseInt(afterParam, 10) : undefined;
    for (const replayed of harness.replayEvents(sessionId, afterOrdinal)) {
      response.write(sseFormat(replayed));
    }

    const unsubscribe = harness.bus.subscribe(sessionId, (event) => {
      response.write(sseFormat(event));
      if (event.event.kind === "turn.done" || event.event.kind === "error") {
        setImmediate(() => {
          try {
            response.end();
          } catch {
            // Ignore — client may have closed already.
          }
        });
      }
    });
    request.on("close", () => {
      unsubscribe();
    });
    return true;
  }

  return false;
}
