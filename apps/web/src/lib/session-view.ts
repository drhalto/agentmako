import type { HarnessStreamEvent } from "../hooks/useHarnessStream";
import type { PersistedSessionMessage } from "../api-types";

export interface MessagePartView {
  kind: "text" | "tool_call" | "tool_result" | "reasoning" | "error";
  payload: unknown;
}

export interface MessageView {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  archived: boolean;
  parts: MessagePartView[];
  /** Accumulated streaming text for an assistant message mid-turn. */
  streamingText?: string;
  status: "streaming" | "final";
}

export function hydratePersistedMessages(messages: PersistedSessionMessage[]): MessageView[] {
  return messages
    .map((message) => {
      const role = coerceRole(message.role);
      if (!role) return null;
      const hydrated: MessageView = {
        id: message.id,
        role,
        archived: message.archived,
        parts: message.parts
          .map((part) => normalizePart(part.kind, part.payload))
          .filter((part): part is MessagePartView => part !== null),
        status: "final",
      };
      return hydrated;
    })
    .filter((message): message is MessageView => message !== null);
}

export function reduceStreamEventsIntoView(
  persisted: MessageView[],
  events: HarnessStreamEvent[],
): MessageView[] {
  const out: MessageView[] = persisted.map((m) => ({
    ...m,
    parts: m.parts
      .map((part) => normalizePart(part.kind, part.payload))
      .filter((part): part is MessagePartView => part !== null),
    status: m.status ?? "final",
  }));
  const byId = new Map<string, MessageView>();
  for (const m of out) byId.set(m.id, m);

  for (const { event } of events) {
    switch (event.kind) {
      case "message.created": {
        if (byId.has(event.messageId)) break;
        const created: MessageView = {
          id: event.messageId,
          role: event.role,
          archived: false,
          parts: [],
          streamingText: event.role === "assistant" ? "" : undefined,
          status: event.role === "assistant" ? "streaming" : "final",
        };
        out.push(created);
        byId.set(event.messageId, created);
        break;
      }
      case "text.delta": {
        const msg = byId.get(event.messageId);
        if (!msg) break;
        if (msg.role === "user") {
          if (!msg.parts.some((p) => p.kind === "text")) {
            msg.parts.push({ kind: "text", payload: { text: event.text } });
          }
          msg.status = "final";
        } else {
          msg.streamingText = (msg.streamingText ?? "") + event.text;
          msg.status = "streaming";
        }
        break;
      }
      case "turn.done": {
        const msg = byId.get(event.messageId);
        if (!msg) break;
        msg.status = "final";
        // Promote the streamed text to a persisted text part so it renders
        // from `parts` after the turn ends. Idempotent: we only add if
        // there isn't already a matching text part.
        if (
          typeof msg.streamingText === "string" &&
          msg.streamingText.length > 0 &&
          !msg.parts.some((p) => p.kind === "text")
        ) {
          msg.parts.push({
            kind: "text",
            payload: { text: msg.streamingText },
          });
        }
        msg.streamingText = undefined;
        break;
      }
      case "tool.call": {
        const last = findLastByRole(out, "assistant");
        if (!last) break;
        // Idempotent: skip if we've already attached this callId.
        if (
          last.parts.some(
            (p) =>
              p.kind === "tool_call" &&
              (p.payload as { callId?: string } | null)?.callId === event.callId,
          )
        ) {
          break;
        }
        last.parts.push({
          kind: "tool_call",
          payload: normalizeToolCallPayload({
            callId: event.callId,
            tool: event.tool,
            argsPreview: event.argsPreview,
          }),
        });
        break;
      }
      case "tool.result": {
        const last = findLastByRole(out, "assistant");
        if (!last) break;
        if (
          last.parts.some(
            (p) =>
              p.kind === "tool_result" &&
              (p.payload as { callId?: string } | null)?.callId === event.callId,
          )
        ) {
          break;
        }
        last.parts.push({
          kind: "tool_result",
          payload: normalizeToolResultPayload({
            callId: event.callId,
            ok: event.ok,
            resultPreview: event.resultPreview,
          }),
        });
        break;
      }
      case "compaction.started": {
        for (const archivedId of event.archivedMessageIds) {
          const msg = byId.get(archivedId);
          if (msg) msg.archived = true;
        }
        break;
      }
      case "error": {
        const last = findLastByRole(out, "assistant");
        if (!last) break;
        last.parts.push({
          kind: "error",
          payload: { code: event.code, message: event.message },
        });
        last.status = "final";
        last.streamingText = undefined;
        break;
      }
      default:
        break;
    }
  }

  return out;
}

function coerceRole(role: string): MessageView["role"] | null {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }
  return null;
}

function normalizePart(kind: string, payload: unknown): MessagePartView | null {
  switch (kind) {
    case "text":
      return { kind, payload: normalizeTextPayload(payload) };
    case "tool_call":
      return { kind, payload: normalizeToolCallPayload(payload) };
    case "tool_result":
      return { kind, payload: normalizeToolResultPayload(payload) };
    case "reasoning":
      return { kind, payload };
    case "error":
      return { kind, payload: normalizeErrorPayload(payload) };
    default:
      return null;
  }
}

function normalizeTextPayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    return { text: payload };
  }
  if (
    payload &&
    typeof payload === "object" &&
    "text" in payload &&
    typeof (payload as { text?: unknown }).text === "string"
  ) {
    return payload;
  }
  return { text: "" };
}

function normalizeToolCallPayload(payload: unknown): unknown {
  const raw = (payload ?? {}) as {
    callId?: unknown;
    tool?: unknown;
    args?: unknown;
    argsPreview?: unknown;
    preview?: unknown;
  };
  return {
    callId: typeof raw.callId === "string" ? raw.callId : "",
    tool: typeof raw.tool === "string" ? raw.tool : "(tool)",
    args: raw.args ?? raw.argsPreview,
    preview: raw.preview ?? raw.argsPreview,
  };
}

function normalizeToolResultPayload(payload: unknown): unknown {
  const raw = (payload ?? {}) as {
    callId?: unknown;
    ok?: unknown;
    summary?: unknown;
    result?: unknown;
    resultPreview?: unknown;
    error?: unknown;
  };
  const summary =
    raw.summary ??
    raw.result ??
    raw.resultPreview ??
    (payload && typeof payload === "object" ? payload : undefined);
  const summaryError =
    summary &&
    typeof summary === "object" &&
    "error" in summary &&
    typeof (summary as { error?: unknown }).error === "string"
      ? (summary as { error: string }).error
      : undefined;
  return {
    callId: typeof raw.callId === "string" ? raw.callId : "",
    ok: raw.ok === true,
    summary,
    error:
      typeof raw.error === "string"
        ? raw.error
        : raw.ok === false
          ? summaryError
          : undefined,
  };
}

function normalizeErrorPayload(payload: unknown): unknown {
  const raw = (payload ?? {}) as { code?: unknown; message?: unknown };
  return {
    code: typeof raw.code === "string" ? raw.code : "error",
    message: typeof raw.message === "string" ? raw.message : "",
  };
}

function findLastByRole(
  messages: MessageView[],
  role: MessageView["role"],
): MessageView | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === role) return messages[i];
  }
  return undefined;
}
