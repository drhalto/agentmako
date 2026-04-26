/**
 * Agent workspace.
 *
 * The shell owns the session rail on /agent routes, so this page only
 * handles the two main states:
 *   /agent             → empty workspace with an interactive composer
 *                        (first send creates a session and navigates
 *                        into it)
 *   /agent/:sessionId  → live SessionPage
 */

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "../lib/http";
import type { ProviderEntry } from "../api-types";
import { useSelectedProject } from "../hooks/useSelectedProject";
import type { ModelPick } from "../lib/model-catalog";
import { PromptInput } from "../components/PromptInput";
import { SessionModelPicker } from "../components/SessionModelPicker";
import type { AxisShape } from "../components/AxisDefaultsCard";
import { SessionPage } from "./Session";

interface DefaultsResponse {
  agent: AxisShape;
  embedding: AxisShape;
}

interface CreatedSession {
  session: { id: string };
}

const SUGGESTIONS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Explore the codebase",
    body: "Give me a tour of the main entry points in this project.",
  },
  {
    title: "Trace a symbol",
    body: "Where is `getCurrentProfile` defined and who uses it?",
  },
  {
    title: "Plan a change",
    body: "I want to add a new column to `events`. What do I need to know first?",
  },
  {
    title: "Debug an error",
    body: "A user saw 'Registration capacity check failed' — trace it from UI to SQL.",
  },
];

export function AgentPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (sessionId) return <SessionPage />;
  return <AgentEmptyState />;
}

function AgentEmptyState() {
  const { selectedProjectId, selectedProject, scopedPath } = useSelectedProject();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: () => get<{ providers: ProviderEntry[] }>("/api/v1/providers"),
  });

  const defaultsQuery = useQuery({
    queryKey: ["defaults"],
    queryFn: () => get<DefaultsResponse>("/api/v1/defaults"),
  });

  // Resolve the active default into a picker-shape the composer can use.
  const defaultPick = useMemo<ModelPick | null>(() => {
    const active = defaultsQuery.data?.agent?.active;
    if (!active) return null;
    return { providerId: active.providerId, modelId: active.modelId };
  }, [defaultsQuery.data]);

  // Local state so the operator can override the default before sending
  // without mutating the global defaults.
  const [pick, setPick] = useState<ModelPick | null>(null);
  const effectivePick = pick ?? defaultPick;

  const [seedDraft, setSeedDraft] = useState<string>("");

  const sendFirstMessage = useMutation({
    mutationFn: async (content: string) => {
      const created = await post<CreatedSession>("/api/v1/sessions", {
        projectId: selectedProjectId ?? undefined,
        provider: effectivePick?.providerId,
        model: effectivePick?.modelId,
        fallbackChain: effectivePick
          ? [{ provider: effectivePick.providerId, model: effectivePick.modelId }]
          : undefined,
        // No explicit tier: let the harness derive from the provider's
        // registered tier (cloud/local). Drops to "no-agent" only when
        // the operator has no model configured and clicks through a
        // later prompt.
      });
      const id = created.session?.id;
      if (!id) throw new Error("Session created without an id");
      await post(`/api/v1/sessions/${id}/messages`, { content });
      return id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      navigate(scopedPath(`/agent/${id}`));
    },
  });

  const providers = providersQuery.data?.providers ?? [];
  const scopeLabel = selectedProject?.displayName ?? "all attached projects";
  const hasModel = effectivePick !== null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-8 py-10">
        <div className="mx-auto flex max-w-[760px] flex-col items-center text-center">
          <div className="mk-wordmark text-[26px]">mako</div>
          <h1 className="mt-5 text-[34px] font-medium text-mk-crest">
            How can I help you?
          </h1>
          <p className="mx-auto mt-3 max-w-[520px] text-[13.5px] leading-7 text-mk-surface">
            Start typing to open a new session, or pick one from the left rail.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <span className="rounded-full border border-mk-current px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-mk-tide">
              scope · {scopeLabel}
            </span>
            <Link
              to={scopedPath("/providers")}
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-mk-tide hover:text-mk-surface"
            >
              tune defaults →
            </Link>
          </div>

          <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.title}
                type="button"
                onClick={() => setSeedDraft(suggestion.body)}
                className="mk-card group flex flex-col gap-1 p-4 text-left transition-colors hover:border-mk-signal/40 hover:bg-mk-ridge/30"
              >
                <span className="text-[13px] font-medium text-mk-crest">
                  {suggestion.title}
                </span>
                <span className="text-[12px] text-mk-surface line-clamp-2">
                  {suggestion.body}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-mk-current bg-mk-abyss">
        <div className="mx-auto w-full max-w-[760px] px-8 py-4">
          <AgentEmptyComposer
            providers={providers}
            effectivePick={effectivePick}
            onPickChange={setPick}
            seedDraft={seedDraft}
            onDraftConsumed={() => setSeedDraft("")}
            submitting={sendFirstMessage.isPending}
            disabled={!hasModel || sendFirstMessage.isPending}
            onSubmit={(text) => sendFirstMessage.mutateAsync(text)}
          />
          {!hasModel && !defaultsQuery.isLoading ? (
            <div className="mt-2 text-center font-mono text-[11px] text-mk-warn">
              No agent configured.{" "}
              <Link to={scopedPath("/providers")} className="underline decoration-mk-warn/50 hover:text-mk-crest">
                Configure one in Providers →
              </Link>
            </div>
          ) : null}
          {sendFirstMessage.isError ? (
            <div className="mt-2 text-center font-mono text-[11px] text-mk-danger">
              send failed — {(sendFirstMessage.error as Error).message}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentEmptyComposer({
  providers,
  effectivePick,
  onPickChange,
  seedDraft,
  onDraftConsumed,
  submitting,
  disabled,
  onSubmit,
}: {
  providers: ProviderEntry[];
  effectivePick: ModelPick | null;
  onPickChange(pick: ModelPick): void;
  seedDraft: string;
  onDraftConsumed(): void;
  submitting: boolean;
  disabled: boolean;
  onSubmit(text: string): Promise<unknown>;
}) {
  // Re-mount the PromptInput whenever a suggestion is clicked so its
  // internal value seeds from `loadDraft(sessionId)` — but since this
  // surface has no sessionId yet, we use a keyed remount to pipe the
  // seed into the draft store under a stable ephemeral id.
  const draftKey = "__agent_empty__";
  if (seedDraft.length > 0) {
    try {
      window.localStorage.setItem(`mako:prompt-draft:${draftKey}`, seedDraft);
    } catch {
      /* ignore */
    }
    onDraftConsumed();
  }

  return (
    <PromptInput
      key={`empty-${seedDraft.length}`}
      sessionId={draftKey}
      disabled={disabled}
      placeholder={
        submitting
          ? "Starting session…"
          : effectivePick
            ? "Message mako — ⌘Enter to send"
            : "Configure a model in Providers to get started"
      }
      footerLeading={
        <SessionModelPicker
          providers={providers}
          value={effectivePick}
          disabled={submitting}
          onChange={onPickChange}
        />
      }
      onSubmit={onSubmit}
    />
  );
}
