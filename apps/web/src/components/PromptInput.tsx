/**
 * Prompt input — autosizing multi-line textarea with a dev-tool bearing.
 *
 * Bindings:
 *   - Enter               → newline (standard textarea behavior)
 *   - ⌘Enter / Ctrl+Enter → submit
 *   - Esc                 → blur
 *   - `/` anywhere        → focus the input
 *
 * Sizing:
 *   - Minimum 3 visible lines (~72px), grows to ~280px, then scrolls.
 *   - Generous internal padding so the caret isn't glued to the border.
 *
 * Phase 3.9: when a `sessionId` is supplied, the unsent draft is persisted
 * to localStorage on a 250ms debounce and flushed on `beforeunload`.
 * Successful `onSubmit` clears the draft for that session.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionUsageSnapshot } from "../api-types";

interface Props {
  onSubmit(content: string): void | Promise<unknown>;
  disabled?: boolean;
  placeholder?: string;
  usage?: SessionUsageSnapshot;
  footerLeading?: ReactNode;
  /**
   * When present, the unsent value is persisted per-session so that a
   * reload or route change doesn't drop in-progress text. Only used on the
   * `/agent/:sessionId` surface.
   */
  sessionId?: string;
}

const MIN_HEIGHT_PX = 72;
const MAX_HEIGHT_PX = 280;
const DRAFT_DEBOUNCE_MS = 250;

function draftStorageKey(sessionId: string): string {
  return `mako:prompt-draft:${sessionId}`;
}

function loadDraft(sessionId: string | undefined): string {
  if (!sessionId) return "";
  try {
    return window.localStorage.getItem(draftStorageKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

function persistDraft(sessionId: string | undefined, value: string): void {
  if (!sessionId) return;
  try {
    if (value.length === 0) {
      window.localStorage.removeItem(draftStorageKey(sessionId));
    } else {
      window.localStorage.setItem(draftStorageKey(sessionId), value);
    }
  } catch {
    // localStorage may be disabled (private mode, quota). Drafts are a
    // best-effort affordance — swallow and carry on.
  }
}

function formatTokenCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(value));
}

export function PromptInput({
  onSubmit,
  disabled,
  placeholder,
  sessionId,
  usage,
  footerLeading,
}: Props) {
  const [value, setValue] = useState<string>(() => loadDraft(sessionId));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  // Hydrate when the session changes — a route transition replaces the
  // component's session context without remounting.
  useEffect(() => {
    setValue(loadDraft(sessionId));
  }, [sessionId]);

  // Debounced persistence. Any in-flight timeout for the prior keystroke is
  // cleared on each change so only the trailing value hits localStorage.
  useEffect(() => {
    if (!sessionId) return;
    const handle = window.setTimeout(() => {
      persistDraft(sessionId, value);
    }, DRAFT_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [value, sessionId]);

  // Flush on navigation away. `beforeunload` runs before the page unloads
  // and guarantees the latest value lands in storage even if the debounced
  // write hasn't fired yet.
  useEffect(() => {
    if (!sessionId) return;
    const onBeforeUnload = () => persistDraft(sessionId, valueRef.current);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      persistDraft(sessionId, valueRef.current);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [sessionId]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.min(Math.max(ta.scrollHeight, MIN_HEIGHT_PX), MAX_HEIGHT_PX);
    ta.style.height = `${next}px`;
  }, [value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.key === "/" && tag !== "TEXTAREA" && tag !== "INPUT") {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || disabled) return;
    try {
      await onSubmit(trimmed);
      setValue("");
      persistDraft(sessionId, "");
    } catch {
      textareaRef.current?.focus();
    }
  }, [value, disabled, onSubmit, sessionId]);

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div className="rounded-xl border border-mk-current bg-mk-depth shadow-sm transition-colors focus-within:border-mk-signal-dim">
      <textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        placeholder={placeholder ?? "Message mako — ⌘Enter to send"}
        spellCheck={false}
        rows={3}
        style={{ minHeight: MIN_HEIGHT_PX, maxHeight: MAX_HEIGHT_PX }}
        className="block w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[14px] leading-relaxed text-mk-crest placeholder:text-mk-tide focus:outline-none"
      />
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {footerLeading}
          {usage ? <PromptContextMeter usage={usage} /> : null}
        </div>
        <span
          className="hidden font-mono text-[10.5px] text-mk-tide md:inline"
          aria-hidden
          title="/ focus · ⌘↵ send · Esc blur"
        >
          <kbd className="font-mono">⌘↵</kbd>
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          aria-label="Send message"
          title={disabled ? "Waiting…" : "Send (⌘ Enter)"}
          className={[
            "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
            canSend
              ? "bg-mk-crest text-mk-abyss hover:opacity-90"
              : "bg-mk-ridge text-mk-tide opacity-60 cursor-not-allowed",
          ].join(" ")}
        >
          <SendArrowIcon />
        </button>
      </div>
    </div>
  );
}

function SendArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none">
      <path
        d="M8 13V3M3.5 7.5L8 3L12.5 7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PromptContextMeter({ usage }: { usage: SessionUsageSnapshot }) {
  const pct = Math.max(0, Math.min(100, (usage.contextUtilization ?? 0) * 100));
  const radius = 8.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;
  const stroke =
    pct >= 90
      ? "var(--color-mk-danger)"
      : pct >= 70
        ? "var(--color-mk-warn)"
        : "var(--color-mk-signal)";
  const label =
    usage.contextWindow !== null
      ? `${Math.round(pct)}`
      : formatTokenCount(usage.contextTokens);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-mk-current bg-mk-abyss px-2 py-1"
      title={
        usage.contextWindow !== null
          ? `Context usage ${pct.toFixed(1)}% (${formatTokenCount(usage.contextTokens)} / ${formatTokenCount(usage.contextWindow)})`
          : `Context estimate ${formatTokenCount(usage.contextTokens)} tokens`
      }
    >
      <span className="relative flex h-6 w-6 items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          className="-rotate-90 absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r={radius}
            fill="none"
            stroke="var(--color-mk-current)"
            strokeWidth="2.5"
          />
          {usage.contextWindow !== null ? (
            <circle
              cx="12"
              cy="12"
              r={radius}
              fill="none"
              stroke={stroke}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          ) : null}
        </svg>
        <span className="font-mono text-[8px] text-mk-crest">{label}</span>
      </span>
      <span className="font-mono text-[10.5px] text-mk-tide">
        ctx{" "}
        <span className="text-mk-crest">
          {formatTokenCount(usage.contextTokens)}
          {usage.contextWindow !== null
            ? `/${formatTokenCount(usage.contextWindow)}`
            : ""}
        </span>
      </span>
    </div>
  );
}
