/**
 * Session view — the chat surface.
 *
 * Source-of-truth split:
 *   - `/api/v1/sessions/:id`     → session metadata (title, tier, provider,
 *                                   model, archivedCount, usage).
 *   - `useHarnessStream(…)`      → the message list. The SSE `?after=-1`
 *                                   replays every event from ordinal 0
 *                                   forward, so reducing over the stream
 *                                   produces the full message history.
 *
 * Collapsing to a single-source message pipeline kills the race that was
 * hiding live text.delta updates behind a React Query refetch trigger.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post } from "../lib/http";
import type {
  PersistedSessionMessage,
  ProviderEntry,
  Session,
  SessionUsageSnapshot,
} from "../api-types";
import { useHarnessStream } from "../hooks/useHarnessStream";
import {
  hydratePersistedMessages,
  reduceStreamEventsIntoView,
} from "../lib/session-view";
import { MessageTimeline } from "../components/MessageTimeline";
import { PromptInput } from "../components/PromptInput";
import { ApprovalModal } from "../components/ApprovalModal";
import { SessionModelPicker } from "../components/SessionModelPicker";

interface SessionShowResponse {
  session: Session & { harnessVersion?: string | null };
  messages: PersistedSessionMessage[];
  archivedCount?: number;
  usage?: SessionUsageSnapshot;
}

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const qc = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => get<SessionShowResponse>(`/api/v1/sessions/${sessionId}`),
    enabled: !!sessionId,
    refetchOnWindowFocus: false,
  });

  // Phase 3.9: cross-reference the session's active provider against the
  // live `/api/v1/providers` snapshot so we can surface an inline banner
  // when the provider is unreachable / degraded / no longer present.
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: () => get<{ providers: ProviderEntry[] }>("/api/v1/providers"),
    refetchInterval: 30_000,
  });

  const stream = useHarnessStream({ sessionId });
  const invalidateSessionViews = async () => {
    await qc.invalidateQueries({ queryKey: ["session", sessionId] });
    qc.invalidateQueries({ queryKey: ["sessions"] });
  };

  const persistedMessages = useMemo(
    () => hydratePersistedMessages(sessionQuery.data?.messages ?? []),
    [sessionQuery.data?.messages],
  );

  const liveView = useMemo(
    () => reduceStreamEventsIntoView(persistedMessages, stream.events),
    [persistedMessages, stream.events],
  );

  const lastEventKind = stream.events[stream.events.length - 1]?.event.kind;
  const turnInFlight =
    liveView.some((m) => m.status === "streaming") ||
    (lastEventKind !== undefined &&
      lastEventKind !== "turn.done" &&
      lastEventKind !== "error" &&
      (liveView.some((m) => m.role === "user") || liveView.length > 0) &&
      stream.status !== "closed");

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveView.length, liveView[liveView.length - 1]?.streamingText]);

  useEffect(() => {
    if (lastEventKind === "turn.done" || lastEventKind === "error") {
      void invalidateSessionViews();
    }
  }, [lastEventKind, qc, sessionId]);

  useEffect(() => {
    if (lastEventKind === "compaction.summary_inserted") {
      void qc.invalidateQueries({ queryKey: ["session", sessionId] });
    }
  }, [lastEventKind, qc, sessionId]);

  const postMessage = useMutation({
    mutationFn: (content: string) =>
      post<{ messageId: string; started: true }>(
        `/api/v1/sessions/${sessionId}/messages`,
        { content },
      ),
    onSuccess: invalidateSessionViews,
  });

  const updateSessionModel = useMutation({
    mutationFn: (input: { providerId: string; modelId: string }) => {
      const provider = providersQuery.data?.providers.find(
        (entry) => entry.spec.id === input.providerId,
      );
      if (!provider) {
        throw new Error(`provider not found: ${input.providerId}`);
      }
      return patch<{ session: Session }>(`/api/v1/sessions/${sessionId}`, {
        provider: input.providerId,
        model: input.modelId,
        tier: provider.spec.tier === "local" ? "local-agent" : "cloud-agent",
        fallbackChain: [{ provider: input.providerId, model: input.modelId }],
      });
    },
    onSuccess: invalidateSessionViews,
  });

  // Edit & rollback: when the operator clicks the edit button on a user
  // message we POST /truncate to archive that message plus every later
  // reply, then seed the composer with the original text so they can
  // revise and resend.
  const [editSeed, setEditSeed] = useState<{ text: string; token: number } | null>(null);
  const truncateFromMessage = useMutation({
    mutationFn: async (input: { fromMessageId: string; text: string }) => {
      await post<{ archived: number; fromOrdinal: number | null }>(
        `/api/v1/sessions/${sessionId}/truncate`,
        { fromMessageId: input.fromMessageId },
      );
      return input;
    },
    onSuccess: async (input) => {
      // Write the edit text into the session's draft store BEFORE we
      // remount PromptInput — the component reads its initial value via
      // `loadDraft(sessionId)` on mount.
      try {
        window.localStorage.setItem(`mako:prompt-draft:${sessionId}`, input.text);
      } catch {
        /* noop */
      }
      await invalidateSessionViews();
      stream.reconnect();
      // Token cycles PromptInput's React key so it remounts and re-reads
      // the draft even when the same text was edited twice in a row.
      setEditSeed({ text: input.text, token: Date.now() });
    },
  });


  if (!sessionId) return null;

  const session = sessionQuery.data?.session;
  const archivedCount = sessionQuery.data?.archivedCount ?? 0;
  const usage = sessionQuery.data?.usage;

  // Phase 3.9: provider-health check. Banner fires when the session's
  // active provider is either absent from the registry or reachable=false
  // (local) or key-unresolved (cloud). Silent when the session has no
  // active provider yet (fresh no-agent session, etc.).
  const providerHealth = useMemo(() => {
    if (!session?.activeProvider) return null;
    if (!providersQuery.data || providersQuery.isLoading || providersQuery.isError) {
      return null;
    }
    const providers = providersQuery.data?.providers ?? [];
    const match = providers.find((p) => p.spec.id === session.activeProvider);
    if (!match) {
      return {
        level: "error" as const,
        message: `Provider \`${session.activeProvider}\` is no longer registered — this session can't take a turn until it's re-added on the Providers page.`,
      };
    }
    if (match.spec.tier === "local" && match.reachable === false) {
      return {
        level: "warn" as const,
        message: `\`${session.activeProvider}\` daemon is offline — start it to resume turns.`,
      };
    }
    if (match.spec.tier === "cloud" && match.keyResolved === false) {
      return {
        level: "error" as const,
        message: `No API key is available for \`${session.activeProvider}\` — set one via \`agentmako keys set\` or an env var.`,
      };
    }
    if (session.activeModel) {
      const knownModel = match.spec.models.find((m) => m.id === session.activeModel);
      if (!knownModel) {
        return {
          level: "warn" as const,
          message: `Model \`${session.activeModel}\` is no longer listed for \`${session.activeProvider}\` — it may have been removed on the provider side.`,
        };
      }
    }
    return null;
  }, [
    session?.activeProvider,
    session?.activeModel,
    providersQuery.data,
    providersQuery.isError,
    providersQuery.isLoading,
  ]);

  return (
    <div className="flex h-full flex-col">
      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {stream.status === "reconnecting" || stream.status === "error" ? (
          <div className="sticky top-0 z-10 flex justify-center bg-gradient-to-b from-mk-abyss via-mk-abyss/90 to-transparent px-4 pt-3 pb-5">
            {stream.status === "reconnecting" ? (
              <span className="rounded-full border border-mk-warn/40 bg-mk-abyss px-3 py-1 font-mono text-[11px] text-mk-warn">
                reconnecting…
              </span>
            ) : (
              <button
                type="button"
                onClick={stream.reconnect}
                className="rounded-full border border-mk-danger/50 bg-mk-abyss px-3 py-1 font-mono text-[11px] text-mk-danger transition-colors hover:bg-mk-danger/10 hover:text-mk-crest"
              >
                stream offline — reconnect
              </button>
            )}
          </div>
        ) : null}
        <div className="mx-auto max-w-[940px] px-8 py-8">
          <MessageTimeline
            messages={liveView}
            archivedCount={archivedCount}
            onEditMessage={(msg, text) => {
              if (truncateFromMessage.isPending || postMessage.isPending || turnInFlight) return;
              truncateFromMessage.mutate({ fromMessageId: msg.id, text });
            }}
          />
        </div>
      </div>

      {/* Prompt input */}
      <footer className="border-t border-mk-current bg-mk-abyss">
        <div className="mx-auto max-w-[940px] px-8 py-5">
          {providerHealth ? (
            <div
              role="status"
              className={[
                "mb-3 rounded-sm border px-3 py-2 font-mono text-[11px]",
                providerHealth.level === "error"
                  ? "border-mk-danger/60 bg-mk-danger/10 text-mk-danger"
                  : "border-mk-warn/60 bg-mk-warn/10 text-mk-warn",
              ].join(" ")}
            >
              {providerHealth.message}
            </div>
          ) : null}
          <PromptInput
            key={editSeed ? `seed-${editSeed.token}` : "live"}
            sessionId={sessionId}
            usage={usage}
            footerLeading={
              <SessionModelPicker
                providers={providersQuery.data?.providers ?? []}
                value={
                  session?.activeProvider && session?.activeModel
                    ? {
                        providerId: session.activeProvider,
                        modelId: session.activeModel,
                      }
                    : null
                }
                disabled={turnInFlight || updateSessionModel.isPending}
                onChange={(next) => updateSessionModel.mutate(next)}
              />
            }
            disabled={turnInFlight || postMessage.isPending}
            placeholder={
              turnInFlight
                ? "Waiting for the current turn to finish…"
                : "Message mako — ⌘Enter to send"
            }
            onSubmit={(text) => postMessage.mutateAsync(text)}
          />
          {updateSessionModel.isError ? (
            <div className="mt-2 font-mono text-[11px] text-mk-danger">
              model change failed — {(updateSessionModel.error as Error).message}
            </div>
          ) : null}
          {postMessage.isError ? (
            <div className="mt-2 font-mono text-[11px] text-mk-danger">
              send failed — {(postMessage.error as Error).message}
            </div>
          ) : null}
        </div>
      </footer>

      <ApprovalModal sessionId={sessionId} pendingEvents={stream.events} />
    </div>
  );
}

