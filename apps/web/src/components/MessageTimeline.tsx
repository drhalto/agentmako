/**
 * Chat timeline with role-aligned rows plus an explicit work-log section.
 *
 * The assistant no longer renders tool activity as "just more body content"
 * beneath the reply text. Instead each assistant turn gets:
 *   - a label row,
 *   - the streamed/final text body,
 *   - a separate work-log card for tool calls/results,
 *   - inline error blocks when the turn fails.
 *
 * This keeps the conversation readable while still surfacing the agent's
 * operational details in-place.
 */

import { useState } from "react";
import type { MessageView, MessagePartView } from "../lib/session-view";
import { MessageCopyButton } from "./MessageCopyButton";
import { MessageEditButton } from "./MessageEditButton";
import { ToolCallCard } from "./ToolCallCard";

interface Props {
  messages: MessageView[];
  archivedCount: number;
  onEditMessage?: (msg: MessageView, text: string) => void;
}

export function MessageTimeline({ messages, archivedCount, onEditMessage }: Props) {
  const [archivedOpen, setArchivedOpen] = useState(false);
  const archived = messages.filter((m) => m.archived);
  const active = messages.filter((m) => !m.archived);

  if (messages.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      {archivedCount > 0 ? (
        <section
          className="rounded-md border border-mk-current bg-mk-depth"
          aria-label="Archived turns"
        >
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-2.5 text-left"
            onClick={() => setArchivedOpen((v) => !v)}
          >
            <span className="mk-label text-mk-warn">
              Compacted · {archivedCount} {archivedCount === 1 ? "turn" : "turns"}
            </span>
            <span className="font-mono text-[11px] text-mk-tide">
              {archivedOpen ? "hide" : "show"}
            </span>
          </button>
          {archivedOpen ? (
            <div className="border-t border-mk-current p-4">
              <div className="space-y-4 opacity-70">
                {archived.map((m) => (
                  <MessageRow key={m.id} msg={m} />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {active.map((m) => (
        <MessageRow key={m.id} msg={m} onEditMessage={onEditMessage} />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mk-card flex flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mk-wordmark text-[28px]">mako</div>
      <div className="mk-rule mt-5 w-24" />
      <p className="mt-5 max-w-[380px] text-[13px] leading-relaxed text-mk-tide">
        Start a turn below. Replies stream in place, tool activity is grouped
        in a work log, and approvals pause mutations before they land.
      </p>
    </div>
  );
}

function MessageRow({
  msg,
  onEditMessage,
}: {
  msg: MessageView;
  onEditMessage?: (msg: MessageView, text: string) => void;
}) {
  if (msg.role === "user") return <UserRow msg={msg} onEditMessage={onEditMessage} />;
  if (msg.role === "assistant") return <AssistantRow msg={msg} />;
  if (msg.role === "system") return <SystemRow msg={msg} />;
  return null;
}

// -----------------------------------------------------------------------------
// Role-specific rows
// -----------------------------------------------------------------------------

function UserRow({
  msg,
  onEditMessage,
}: {
  msg: MessageView;
  onEditMessage?: (msg: MessageView, text: string) => void;
}) {
  const body = renderBody(msg);
  if (body.textContent.length === 0 && body.errors.length === 0) return null;
  return (
    <article className="group flex justify-end" data-role="user">
      <div className="max-w-[72ch]">
        <div className="rounded-2xl rounded-br-sm border border-mk-current bg-mk-ridge px-4 py-3 text-[14px] leading-relaxed text-mk-crest">
          <div className="whitespace-pre-wrap">{body.textContent}</div>
        </div>
        <div className="mt-1 flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {onEditMessage && body.textContent.length > 0 ? (
            <MessageEditButton onClick={() => onEditMessage(msg, body.textContent)} />
          ) : null}
          {body.textContent.length > 0 ? <MessageCopyButton text={body.textContent} /> : null}
        </div>
        {body.errors.map((err, i) => (
          <ErrorBlock key={`e-${i}`} err={err} />
        ))}
      </div>
    </article>
  );
}

function AssistantRow({ msg }: { msg: MessageView }) {
  const body = renderBody(msg);
  const isStreaming = msg.status === "streaming";
  const hasText = body.textContent.length > 0;
  if (!hasText && body.toolCalls.length === 0 && body.errors.length === 0 && !isStreaming) {
    return null;
  }

  return (
    <article className="group space-y-3" data-role="assistant">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-mk-current bg-mk-depth font-mono text-[10px] text-mk-surface">
          mk
        </span>
        <div className="mk-label flex items-center gap-2">
          <span>mako</span>
          {isStreaming ? (
            <>
              <span className="mk-sonar" />
              <span className="text-mk-signal">live</span>
            </>
          ) : null}
        </div>
      </div>

      {(hasText || isStreaming) ? (
        <div
          className={[
            "max-w-[78ch] border-l-2 pl-4 text-[14px] leading-relaxed text-mk-crest",
            isStreaming ? "border-mk-signal" : "border-mk-current",
          ].join(" ")}
        >
          {hasText ? (
            <div className="mk-cursor-host whitespace-pre-wrap">
              {body.textContent}
              {isStreaming ? <span className="mk-cursor" aria-hidden /> : null}
            </div>
          ) : (
            <div className="mk-cursor-host font-mono text-[11.5px] uppercase tracking-[0.08em] text-mk-tide">
              working
              <span className="mk-cursor" aria-hidden />
            </div>
          )}
        </div>
      ) : null}

      {hasText && !isStreaming ? (
        <div className="pl-6 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <MessageCopyButton text={body.textContent} />
        </div>
      ) : null}

      {body.toolCalls.length > 0 ? (
        <WorkLog toolCalls={body.toolCalls} live={isStreaming} />
      ) : null}

      <div className="w-full max-w-[78ch]">
        {body.errors.map((err, i) => (
          <ErrorBlock key={`e-${i}`} err={err} />
        ))}
      </div>
    </article>
  );
}

function SystemRow({ msg }: { msg: MessageView }) {
  const body = renderBody(msg);
  if (!body.textContent) return null;
  return (
    <article
      className="mk-card px-4 py-3"
      data-role="system"
    >
      <div className="mk-label mb-1 text-mk-warn">system · compaction summary</div>
      <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-mk-surface">
        {body.textContent}
      </div>
    </article>
  );
}

function ErrorBlock({ err }: { err: { code: string; message: string } }) {
  return (
    <div className="mt-3 rounded-md border border-mk-danger/50 bg-mk-danger/10 px-3 py-2 font-mono text-[11.5px] text-mk-danger">
      <div className="mk-label mb-1 text-mk-danger">error · {err.code}</div>
      {err.message}
    </div>
  );
}

function WorkLog({
  toolCalls,
  live,
}: {
  toolCalls: Array<{
    key: string;
    call: { callId: string; tool: string; args: unknown; preview?: unknown };
    result?: { ok: boolean; summary?: unknown; error?: string };
  }>;
  live: boolean;
}) {
  return (
    <section className="mk-card max-w-[78ch] overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-mk-current px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="mk-label text-mk-surface">work log</span>
          {live ? <span className="mk-sonar" /> : null}
        </div>
        <span className="font-mono text-[10.5px] text-mk-tide">
          {toolCalls.length} tool{toolCalls.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-2 p-3">
        {toolCalls.map((tc) => (
          <ToolCallCard key={tc.key} call={tc.call} result={tc.result} />
        ))}
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Body flattener
// -----------------------------------------------------------------------------

interface FlattenedBody {
  textContent: string;
  toolCalls: Array<{
    key: string;
    call: { callId: string; tool: string; args: unknown; preview?: unknown };
    result?: { ok: boolean; summary?: unknown; error?: string };
  }>;
  errors: Array<{ code: string; message: string }>;
}

function renderBody(msg: MessageView): FlattenedBody {
  const toolById = new Map<
    string,
    {
      call: { callId: string; tool: string; args: unknown; preview?: unknown };
      result?: { ok: boolean; summary?: unknown; error?: string };
    }
  >();
  const errors: FlattenedBody["errors"] = [];

  // Prefer streamingText when the turn is live; otherwise extract from parts.
  let text = "";
  if (msg.status === "streaming" && msg.streamingText !== undefined) {
    text = msg.streamingText;
  } else {
    const parts: string[] = [];
    for (const p of msg.parts) {
      if (p.kind === "text") {
        const t = extractText(p);
        if (t) parts.push(t);
      }
    }
    text = parts.join("\n");
  }

  for (const p of msg.parts) {
    if (p.kind === "tool_call") {
      const payload = (p.payload ?? {}) as {
        callId?: string;
        tool?: string;
        args?: unknown;
        preview?: unknown;
      };
      if (payload.callId) {
        toolById.set(payload.callId, {
          call: {
            callId: payload.callId,
            tool: payload.tool ?? "(tool)",
            args: payload.args,
            preview: payload.preview,
          },
        });
      }
    } else if (p.kind === "tool_result") {
      const payload = (p.payload ?? {}) as {
        callId?: string;
        ok?: boolean;
        summary?: unknown;
        error?: string;
      };
      if (payload.callId && toolById.has(payload.callId)) {
        toolById.get(payload.callId)!.result = {
          ok: payload.ok ?? false,
          summary: payload.summary,
          error: payload.error,
        };
      }
    } else if (p.kind === "error") {
      const payload = (p.payload ?? {}) as { code?: string; message?: string };
      errors.push({ code: payload.code ?? "error", message: payload.message ?? "" });
    }
  }

  return {
    textContent: text,
    toolCalls: Array.from(toolById.entries()).map(([callId, v]) => ({
      key: callId,
      call: v.call,
      result: v.result,
    })),
    errors,
  };
}

function extractText(part: MessagePartView): string {
  const payload = part.payload;
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object" && "text" in payload) {
    const t = (payload as { text?: unknown }).text;
    return typeof t === "string" ? t : "";
  }
  return "";
}
