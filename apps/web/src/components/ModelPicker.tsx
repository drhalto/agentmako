/**
 * Compound button + popover for picking a provider+model.
 *
 * Layout:
 *   [  New session · gemma4:latest   ▾  ]
 *      └── primary action (uses current pick)
 *          └── chevron opens the popover
 *
 * Popover lists every chat-capable model per reachable provider, grouped
 * by tier (local / cloud). Unusable models (no API key, provider
 * unreachable) are disabled with a reason badge.
 *
 * Keyboard: ⌘N / Ctrl+N fires the primary action from anywhere in the app.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/http";
import {
  buildPickableModels,
  isProviderUsable,
  loadLastPick,
  pickDefaultModel,
  saveLastPick,
  type ModelPick,
  type PickableModel,
} from "../lib/model-catalog";
import type { ProviderEntry } from "../api-types";

interface Props {
  onSubmit(pick: ModelPick | null): void;
  disabled?: boolean;
  /** When true, the primary button label drops the model name (e.g. for a compact header). */
  compact?: boolean;
  fullWidth?: boolean;
}

interface DefaultsResponse {
  agent: {
    active: { providerId: string; modelId: string } | null;
  };
}

export function ModelPicker({
  onSubmit,
  disabled,
  compact = false,
  fullWidth = false,
}: Props) {
  const [pick, setPick] = useState<ModelPick | null>(() => loadLastPick());
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const defaults = useQuery({
    queryKey: ["defaults"],
    queryFn: () => get<DefaultsResponse>("/api/v1/defaults"),
  });

  const providers = useQuery({
    queryKey: ["providers-for-picker"],
    queryFn: () => get<{ providers: ProviderEntry[] }>("/api/v1/providers"),
  });

  const models = useMemo(
    () => buildPickableModels(providers.data?.providers ?? []),
    [providers.data?.providers],
  );

  // Lock in a default as soon as models arrive, if nothing is saved yet.
  useEffect(() => {
    if (pick || models.length === 0) return;
    const preferred = defaults.data?.agent.active;
    const def =
      preferred &&
      models.some(
        (m) =>
          m.providerId === preferred.providerId &&
          m.modelId === preferred.modelId,
      )
        ? preferred
        : pickDefaultModel(models);
    if (def) {
      setPick(def);
      saveLastPick(def);
    }
  }, [defaults.data?.agent.active, models, pick]);

  // Close the popover on outside-click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  // ⌘N / Ctrl+N → primary submit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && !disabled) {
        e.preventDefault();
        onSubmit(pick);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick, onSubmit, disabled]);

  const choose = useCallback(
    (next: ModelPick) => {
      setPick(next);
      saveLastPick(next);
      setOpen(false);
    },
    [],
  );

  const active = models.find(
    (m) => pick && m.providerId === pick.providerId && m.modelId === pick.modelId,
  );

  return (
    <div
      ref={containerRef}
      className={["relative", fullWidth ? "flex w-full" : "inline-flex"].join(" ")}
    >
      <button
        type="button"
        onClick={() => onSubmit(pick)}
        disabled={disabled || !pick}
        className={[
          "flex h-9 min-w-0 items-center rounded-md rounded-r-none bg-mk-crest px-4 text-[13px] font-medium text-mk-abyss transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
          fullWidth ? "flex-1 justify-start" : "",
        ].join(" ")}
      >
        {compact ? "New session" : "New session"}
        {!compact && active ? (
          <span className="ml-2 min-w-0 truncate font-mono text-[11px] opacity-70">
            · {active.modelId}
          </span>
        ) : !compact && !pick ? (
          <span className="ml-2 min-w-0 truncate font-mono text-[11px] opacity-70">
            · choose a model
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-label="Select model"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex h-9 w-9 items-center justify-center rounded-md rounded-l-none border-l border-mk-abyss/30 bg-mk-crest text-mk-abyss transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Chevron open={open} />
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-30 w-[420px] overflow-hidden rounded-md border border-mk-current bg-mk-depth shadow-[0_4px_24px_-4px_rgb(0_0_0_/_0.5)]">
          <PickerHeader isLoading={providers.isLoading} total={models.length} />
          <PickerList
            models={models}
            activePick={pick}
            onChoose={choose}
          />
          <PickerFooter
            providers={providers.data?.providers ?? []}
            onCustomPick={choose}
          />
        </div>
      ) : null}
    </div>
  );
}

function PickerHeader({ isLoading, total }: { isLoading: boolean; total: number }) {
  return (
    <header className="flex items-center justify-between border-b border-mk-current px-3 py-2">
      <span className="mk-label">Choose a model</span>
      <span className="mk-label text-mk-tide">
        {isLoading ? "loading…" : `${total} available`}
      </span>
    </header>
  );
}

function PickerFooter({
  providers,
  onCustomPick,
}: {
  providers: ProviderEntry[];
  onCustomPick(pick: ModelPick): void;
}) {
  // Default the custom-input provider to the first reachable local one, or
  // the first provider with a key.
  const defaultProvider =
    providers.find((p) => p.spec.tier === "local" && isProviderUsable(p))?.spec.id ??
    providers.find((p) => isProviderUsable(p))?.spec.id ??
    providers[0]?.spec.id ??
    "";

  const [providerId, setProviderId] = useState<string>(defaultProvider);
  const [modelId, setModelId] = useState<string>("");

  useEffect(() => {
    setProviderId((current) => current || defaultProvider);
  }, [defaultProvider]);

  const submit = () => {
    const trimmed = modelId.trim();
    if (trimmed.length === 0 || !providerId) return;
    onCustomPick({ providerId, modelId: trimmed });
    setModelId("");
  };

  return (
    <footer className="border-t border-mk-current bg-mk-abyss px-3 py-2">
      <div className="mk-label mb-1.5 text-mk-tide">Custom model id</div>
      <div className="flex items-center gap-1.5">
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          className="h-7 rounded-xs border border-mk-current bg-mk-depth px-1.5 font-mono text-[11px] text-mk-crest focus:outline-none"
        >
          {providers.map((p) => (
            <option key={p.spec.id} value={p.spec.id}>
              {p.spec.id}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={modelId}
          spellCheck={false}
          onChange={(e) => setModelId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="qwen3.6:35b-a3b"
          className="h-7 flex-1 rounded-xs border border-mk-current bg-mk-depth px-2 font-mono text-[11px] text-mk-crest placeholder:text-mk-tide focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={modelId.trim().length === 0}
          className="h-7 rounded-xs border border-mk-current bg-mk-depth px-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-mk-signal transition-colors hover:bg-mk-ridge disabled:opacity-40"
        >
          use
        </button>
      </div>
    </footer>
  );
}

function PickerList({
  models,
  activePick,
  onChoose,
}: {
  models: PickableModel[];
  activePick: ModelPick | null;
  onChoose(pick: ModelPick): void;
}) {
  const groups = {
    local: models.filter((m) => m.providerTier === "local"),
    cloud: models.filter((m) => m.providerTier === "cloud"),
  };
  if (models.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] text-mk-tide">
        No chat-capable models declared in the bundled catalog.
      </div>
    );
  }
  return (
    <div className="max-h-[360px] overflow-y-auto py-1">
      <PickerGroup title="Local" entries={groups.local} activePick={activePick} onChoose={onChoose} />
      {groups.cloud.length > 0 ? (
        <PickerGroup title="Cloud" entries={groups.cloud} activePick={activePick} onChoose={onChoose} />
      ) : null}
    </div>
  );
}

function PickerGroup({
  title,
  entries,
  activePick,
  onChoose,
}: {
  title: string;
  entries: PickableModel[];
  activePick: ModelPick | null;
  onChoose(pick: ModelPick): void;
}) {
  if (entries.length === 0) return null;
  return (
    <section>
      <div className="mk-label px-3 py-1.5 text-mk-tide">{title}</div>
      <ul role="list">
        {entries.map((m) => {
          const isActive =
            activePick?.providerId === m.providerId && activePick?.modelId === m.modelId;
          return (
            <li key={`${m.providerId}:${m.modelId}`}>
              <button
                type="button"
                onClick={() =>
                  m.usable && onChoose({ providerId: m.providerId, modelId: m.modelId })
                }
                disabled={!m.usable}
                data-active={isActive ? "true" : undefined}
                className={[
                  "group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                  m.usable
                    ? "cursor-pointer hover:bg-mk-ridge"
                    : "cursor-not-allowed opacity-50",
                  isActive ? "mk-active" : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    m.usable ? "bg-mk-signal" : "bg-mk-tide",
                  ].join(" ")}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12.5px] text-mk-crest">
                    {m.providerId}
                    <span className="text-mk-tide"> / </span>
                    {m.modelId}
                  </div>
                  <div className="truncate font-mono text-[10.5px] uppercase tracking-[0.06em] text-mk-tide">
                    {m.modelDisplay} · {formatContext(m.contextWindow)}
                    {m.supportsTools ? " · tools" : ""}
                    {m.reason ? ` · ${m.reason}` : ""}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return `${tokens}`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
