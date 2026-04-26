/**
 * Approval modal — triggered when the harness emits a live
 * `permission.request` event and no matching `permission.decision` has
 * arrived yet.
 *
 * Renders:
 *   - Tool name + pattern in the header.
 *   - Unified diff for `file_edit` / `apply_patch`; proposed content for
 *     `file_write` / `create_file`; command preview for `shell_run`.
 *   - Four actions: allow (turn / session) · deny (turn / session).
 *
 * Keyboard: `a` allow-turn, `A` allow-session, `d` deny-turn, `D` deny-session,
 * `Esc` close without deciding.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PendingPermissionRequest, PermissionScope } from "../api-types";
import type { HarnessStreamEvent } from "../hooks/useHarnessStream";
import { get, post } from "../lib/http";
import { safeJson } from "../lib/safe-json.js";

interface Props {
  sessionId: string;
  pendingEvents: HarnessStreamEvent[];
}

interface PendingRequest {
  requestId: string;
  tool: string;
  permission?: string;
  pattern?: string;
  preview?: unknown;
  status: "live" | "abandoned";
  note?: string;
  ordinal: number;
}

export function ApprovalModal({ sessionId, pendingEvents }: Props) {
  const [selectedScope, setSelectedScope] = useState<PermissionScope>("turn");
  const [hiddenRequestId, setHiddenRequestId] = useState<string | null>(null);

  const pendingQuery = useQuery({
    queryKey: ["permission-requests", sessionId],
    queryFn: () =>
      get<{ pending: PendingPermissionRequest[] }>(
        `/api/v1/sessions/${sessionId}/permissions/requests`,
      ),
    refetchInterval: 2_000,
  });

  const pending = useMemo(
    () => collectPendingRequests(pendingEvents, pendingQuery.data?.pending ?? []),
    [pendingEvents, pendingQuery.data?.pending],
  );
  const active = pending.find((item) => item.requestId !== hiddenRequestId) ?? null;

  const decide = useMutation({
    mutationFn: ({
      requestId,
      action,
      scope,
    }: {
      requestId: string;
      action: "allow" | "deny";
      scope: "turn" | "session" | "project" | "global";
    }) =>
      post(
        `/api/v1/sessions/${sessionId}/permissions/requests/${requestId}`,
        { action, scope },
      ),
    onSuccess: async () => {
      setHiddenRequestId(null);
      await pendingQuery.refetch();
    },
  });

  useEffect(() => {
    if (hiddenRequestId && !pending.some((item) => item.requestId === hiddenRequestId)) {
      setHiddenRequestId(null);
    }
  }, [hiddenRequestId, pending]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHiddenRequestId(active.requestId);
      }
      if (active.status !== "live") return;
      if (e.key === "a" && !e.shiftKey) decide.mutate({ requestId: active.requestId, action: "allow", scope: "turn" });
      if (e.key === "A" && e.shiftKey) decide.mutate({ requestId: active.requestId, action: "allow", scope: "session" });
      if (e.key === "d" && !e.shiftKey) decide.mutate({ requestId: active.requestId, action: "deny", scope: "turn" });
      if (e.key === "D" && e.shiftKey) decide.mutate({ requestId: active.requestId, action: "deny", scope: "session" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, decide]);

  useEffect(() => {
    if (active) {
      setSelectedScope("turn");
    }
  }, [active?.requestId]);

  if (!active) {
    if (pending.length === 0) return null;
    return (
      <PendingTray
        count={pending.length}
        onOpen={() => setHiddenRequestId(null)}
      />
    );
  }

  const preview = extractPreview(active.preview);
  const title =
    active.tool === "file_edit" || active.tool === "apply_patch"
      ? "Proposed edit"
      : active.tool === "file_write"
        ? "Proposed write"
        : active.tool === "create_file"
          ? "Proposed create"
          : active.tool === "delete_file"
            ? "Proposed delete"
            : active.tool === "shell_run"
              ? "Proposed shell command"
              : "Proposed change";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-mk-abyss/80 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Approve ${active.tool}`}
    >
      <div className="w-[min(780px,90vw)] overflow-hidden rounded-md border border-mk-current bg-mk-depth">
        <header className="flex items-center justify-between border-b border-mk-current px-5 py-3">
          <div>
            <div className="mk-label text-mk-warn">Approval required</div>
            <h2 className="mt-0.5 text-[15px] font-medium text-mk-crest">{title}</h2>
          </div>
          <div className="text-right">
            <div className="font-mono text-[11px] text-mk-surface">{active.tool}</div>
            <div className="font-mono text-[10.5px] text-mk-tide">
              {active.pattern ?? active.requestId.slice(0, 8)}
            </div>
          </div>
        </header>

        <section className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {active.permission ? (
            <div className="mb-3 font-mono text-[11px] text-mk-tide">
              permission · {active.permission}
            </div>
          ) : null}
          {active.status === "abandoned" ? (
            <div className="mb-4 rounded-md border border-mk-current bg-mk-abyss px-3 py-2 text-[12px] text-mk-warn">
              {active.note ?? "This approval was abandoned when the previous harness process exited."}
            </div>
          ) : null}
          <PreviewBlock tool={active.tool} preview={preview} />
        </section>

        <footer className="flex items-center justify-between gap-3 border-t border-mk-current bg-mk-abyss px-5 py-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(["turn", "session", "project", "global"] as const).map((scope) => (
                <ScopeChip
                  key={scope}
                  scope={scope}
                  active={selectedScope === scope}
                  onClick={() => setSelectedScope(scope)}
                />
              ))}
            </div>
            <div className="mk-label text-mk-tide">
              <kbd>a</kbd> allow-turn · <kbd className="ml-1">⇧A</kbd> allow-session ·
              <kbd className="ml-1">d</kbd> deny-turn · <kbd className="ml-1">⇧D</kbd> deny-session ·
              <kbd className="ml-1">Esc</kbd> hide
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ActionButton
              onClick={() => setHiddenRequestId(active.requestId)}
              disabled={decide.isPending}
              kind="secondary"
            >
              Hide
            </ActionButton>
            {active.status === "live" ? (
              <>
                <ActionButton
                  onClick={() =>
                    decide.mutate({
                      requestId: active.requestId,
                      action: "deny",
                      scope: selectedScope,
                    })
                  }
                  disabled={decide.isPending}
                  kind="danger"
                >
                  {`Deny ${selectedScope}`}
                </ActionButton>
                <ActionButton
                  onClick={() =>
                    decide.mutate({
                      requestId: active.requestId,
                      action: "allow",
                      scope: selectedScope,
                    })
                  }
                  disabled={decide.isPending}
                  kind="primary"
                >
                  {`Allow ${selectedScope}`}
                </ActionButton>
              </>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function PendingTray({ count, onOpen }: { count: number; onOpen(): void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed bottom-5 right-5 z-40 rounded-md border border-mk-current bg-mk-depth px-3 py-2 text-left shadow-[0_4px_24px_-4px_rgb(0_0_0_/_0.5)]"
    >
      <div className="mk-label text-mk-warn">Approval queue</div>
      <div className="mt-1 font-mono text-[12px] text-mk-crest">
        {count} pending {count === 1 ? "request" : "requests"} · review
      </div>
    </button>
  );
}

function ActionButton({
  onClick,
  disabled,
  kind,
  children,
}: {
  onClick(): void;
  disabled?: boolean;
  kind: "primary" | "secondary" | "danger";
  children: React.ReactNode;
}) {
  const cls =
    kind === "primary"
      ? "bg-mk-crest text-mk-abyss hover:opacity-90"
      : kind === "danger"
        ? "border border-mk-current bg-mk-depth text-mk-danger hover:bg-mk-ridge"
        : "border border-mk-current bg-mk-depth text-mk-crest hover:bg-mk-ridge";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-9 rounded-xs px-4 text-[12.5px] font-medium transition ${cls} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function ScopeChip({
  scope,
  active,
  onClick,
}: {
  scope: PermissionScope;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-xs border px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] transition-colors",
        active
          ? "border-mk-signal bg-mk-depth text-mk-signal"
          : "border-mk-current bg-mk-depth text-mk-tide hover:text-mk-crest",
      ].join(" ")}
    >
      {scope}
    </button>
  );
}

function PreviewBlock({ tool, preview }: { tool: string; preview: ExtractedPreview }) {
  if (tool === "shell_run") {
    return (
      <div>
        <div className="mk-label mb-2">Command</div>
        <pre className="overflow-auto rounded-xs border border-mk-current bg-mk-abyss px-3 py-2 font-mono text-[12px] text-mk-crest">
          {preview.command ?? "(unknown)"}
        </pre>
        {preview.cwd ? (
          <>
            <div className="mk-label mb-1 mt-3">Working directory</div>
            <div className="font-mono text-[11.5px] text-mk-surface">{preview.cwd}</div>
          </>
        ) : null}
      </div>
    );
  }

  if (preview.diff) {
    return <DiffBlock diff={preview.diff} />;
  }

  if (preview.content) {
    return (
      <div>
        <div className="mk-label mb-2">Proposed content</div>
        <pre className="max-h-[50vh] overflow-auto rounded-xs border border-mk-current bg-mk-abyss px-3 py-2 font-mono text-[12px] leading-relaxed text-mk-crest">
          {preview.content}
        </pre>
      </div>
    );
  }

  return (
    <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xs border border-mk-current bg-mk-abyss px-3 py-2 font-mono text-[12px] text-mk-surface">
      {safeJson(preview.raw)}
    </pre>
  );
}

function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <div>
      <div className="mk-label mb-2">Unified diff</div>
      <div className="overflow-auto rounded-xs border border-mk-current bg-mk-abyss">
        <pre className="font-mono text-[12px] leading-[1.55]">
          {lines.map((line, i) => {
            const isAdd = line.startsWith("+") && !line.startsWith("+++");
            const isDel = line.startsWith("-") && !line.startsWith("---");
            const isMeta = line.startsWith("@@") || line.startsWith("+++") || line.startsWith("---");
            const bg =
              isAdd
                ? "bg-[color-mix(in_oklch,var(--color-mk-ok)_8%,transparent)]"
                : isDel
                  ? "bg-[color-mix(in_oklch,var(--color-mk-danger)_8%,transparent)]"
                  : "";
            const color = isAdd
              ? "text-mk-crest"
              : isDel
                ? "text-mk-crest"
                : isMeta
                  ? "text-mk-tide"
                  : "text-mk-surface";
            const prefix = isAdd ? "+" : isDel ? "-" : " ";
            return (
              <div key={i} className={`flex ${bg}`}>
                <span className="w-6 shrink-0 px-1 text-center text-[11px] text-mk-tide">
                  {i + 1}
                </span>
                <span className={`flex-1 whitespace-pre px-2 ${color}`}>
                  <span
                    className={
                      isAdd ? "text-mk-ok" : isDel ? "text-mk-danger" : "text-mk-tide"
                    }
                  >
                    {prefix}
                  </span>{" "}
                  {line.replace(/^[+-]/, "")}
                </span>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

interface ExtractedPreview {
  diff?: string;
  content?: string;
  command?: string;
  cwd?: string;
  raw?: unknown;
}

function extractPreview(raw: unknown): ExtractedPreview {
  // The harness emits preview under `preview.dryRun.detail` (the ActionToolDefinition
  // returns a `DryRunPreview { kind, summary, detail }`). Unwrap defensively.
  const maybePreview = (raw ?? {}) as {
    dryRun?: { detail?: unknown };
    args?: unknown;
    pattern?: string;
    permission?: string;
  };
  const detail = maybePreview.dryRun?.detail ?? raw;

  if (detail && typeof detail === "object") {
    const d = detail as {
      diff?: unknown;
      unifiedDiff?: unknown;
      content?: unknown;
      command?: unknown;
      cwd?: unknown;
      args?: unknown[];
    };
    return {
      diff: typeof d.diff === "string" ? d.diff : typeof d.unifiedDiff === "string" ? d.unifiedDiff : undefined,
      content: typeof d.content === "string" ? d.content : undefined,
      command:
        typeof d.command === "string"
          ? [d.command, ...(Array.isArray(d.args) ? (d.args as string[]) : [])].join(" ")
          : undefined,
      cwd: typeof d.cwd === "string" ? d.cwd : undefined,
      raw: detail,
    };
  }
  return { raw };
}

function collectPendingRequests(
  events: HarnessStreamEvent[],
  pendingFromServer: PendingPermissionRequest[],
): PendingRequest[] {
  const requestMeta = new Map<string, PendingRequest>();
  const resolved = new Set<string>();
  const abandoned = new Map<string, string>();

  for (const frame of events) {
    const { event } = frame;
    if (event.kind === "permission.request") {
      const preview = (event.preview ?? {}) as { pattern?: string; permission?: string };
      requestMeta.set(event.requestId, {
        requestId: event.requestId,
        tool: event.tool,
        permission: preview.permission,
        pattern: preview.pattern,
        preview: event.preview,
        status: "live",
        ordinal: frame.ordinal,
      });
    } else if (event.kind === "permission.decision") {
      resolved.add(event.requestId);
    } else if (event.kind === "resume.pending_approvals") {
      for (const requestId of event.requestIds) {
        abandoned.set(requestId, event.note);
      }
    }
  }

  const live = new Map<string, PendingRequest>();
  for (const pending of pendingFromServer) {
    if (resolved.has(pending.requestId)) continue;
    const meta = requestMeta.get(pending.requestId);
    live.set(pending.requestId, {
      requestId: pending.requestId,
      tool: meta?.tool ?? pending.permission,
      permission: pending.permission,
      pattern: pending.pattern,
      preview: meta?.preview,
      status: "live",
      note: meta?.note,
      ordinal: meta?.ordinal ?? Number.MAX_SAFE_INTEGER,
    });
  }

  for (const [requestId, meta] of requestMeta.entries()) {
    if (resolved.has(requestId) || abandoned.has(requestId) || live.has(requestId)) continue;
    live.set(requestId, meta);
  }

  const out = [...live.values()];
  for (const [requestId, note] of abandoned.entries()) {
    if (resolved.has(requestId) || live.has(requestId)) continue;
    const meta = requestMeta.get(requestId);
    out.push({
      requestId,
      tool: meta?.tool ?? "pending approval",
      permission: meta?.permission,
      pattern: meta?.pattern,
      preview: meta?.preview,
      status: "abandoned",
      note,
      ordinal: meta?.ordinal ?? Number.MAX_SAFE_INTEGER,
    });
  }

  out.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "live" ? -1 : 1;
    }
    return a.ordinal - b.ordinal;
  });
  return out;
}
