/**
 * AxisDefaultsCard — one card per axis (Agent or Embeddings).
 *
 * Each axis carries two slots (cloud, local) plus a `prefer` toggle the
 * operator flips explicitly. The harness resolves the active model with
 * preferred-first / fallback-second logic, so we just need to let the
 * operator pin the slots and read back what's currently active.
 *
 * Edits auto-save: on every dropdown / toggle change we PUT the patch
 * to `/api/v1/defaults`. No "Save" button.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProviderEntry } from "../api-types";
import { isEmbeddingModel } from "../lib/model-catalog";
import { ProviderIcon } from "./ProviderIcon";

export type AxisName = "agent" | "embedding";

export interface AxisShape {
  cloud: { providerId: string; modelId: string } | null;
  local: { providerId: string; modelId: string } | null;
  prefer: "cloud" | "local";
  active: { providerId: string; modelId: string } | null;
  source: "primary" | "fallback" | "none";
  reason?: string;
}

interface SelectableModel {
  providerId: string;
  modelId: string;
  modelDisplay: string;
  providerName: string;
  unavailableReason: string | null;
}

interface AxisDefaultsCardProps {
  axis: AxisName;
  shape: AxisShape;
  providers: ProviderEntry[];
}

function buildOptions(
  providers: ProviderEntry[],
  axis: AxisName,
  tier: "cloud" | "local",
): SelectableModel[] {
  const out: SelectableModel[] = [];
  for (const entry of providers) {
    const { spec } = entry;
    if (spec.tier !== tier) continue;

    // Filter by provider kind first (chat/embedding/both).
    if (axis === "agent" && spec.kind === "embedding") continue;
    if (axis === "embedding" && spec.kind === "chat") continue;

    const reason = providerUnavailableReason(entry);
    for (const m of spec.models ?? []) {
      // Per-model filter on the id since the provider catalog isn't
      // always rigorous about kind=both providers.
      const isEmbed = isEmbeddingModel(m.id);
      if (axis === "agent" && isEmbed) continue;
      if (axis === "embedding" && !isEmbed) continue;

      out.push({
        providerId: spec.id,
        modelId: m.id,
        modelDisplay: m.displayName,
        providerName: spec.name,
        unavailableReason: reason,
      });
    }
  }
  return out;
}

function providerUnavailableReason(entry: ProviderEntry): string | null {
  if (entry.spec.auth === "none") {
    return entry.reachable === true ? null : "unreachable";
  }
  return entry.keyResolved ? null : "no api key";
}

export function AxisDefaultsCard({ axis, shape, providers }: AxisDefaultsCardProps) {
  const qc = useQueryClient();
  const cloudOptions = useMemo(() => buildOptions(providers, axis, "cloud"), [providers, axis]);
  const localOptions = useMemo(() => buildOptions(providers, axis, "local"), [providers, axis]);

  const mutation = useMutation({
    mutationFn: (patch: {
      cloud?: { providerId: string; modelId: string } | null;
      local?: { providerId: string; modelId: string } | null;
      prefer?: "cloud" | "local";
    }) => putDefaults({ [axis]: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["defaults"] });
    },
  });

  const headerLabel = axis === "agent" ? "Agent" : "Embeddings";
  const subtitle =
    axis === "agent"
      ? "Used by chat, composers, and any backend code that drives the harness."
      : "Used for memory recall and semantic search; falls back to FTS5 if both are off.";

  return (
    <article className="mk-card overflow-hidden">
      <header className="border-b border-mk-current px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[14px] font-medium text-mk-crest" title={subtitle}>
            {headerLabel}
          </h3>
          <PreferToggle
            value={shape.prefer}
            disabled={mutation.isPending}
            onChange={(prefer) => mutation.mutate({ prefer })}
          />
        </div>
      </header>

      <div className="space-y-3 p-4">
        <SlotRow
          label="Cloud"
          options={cloudOptions}
          value={shape.cloud}
          disabled={mutation.isPending}
          onChange={(slot) => mutation.mutate({ cloud: slot })}
        />
        <SlotRow
          label="Local"
          options={localOptions}
          value={shape.local}
          disabled={mutation.isPending}
          onChange={(slot) => mutation.mutate({ local: slot })}
        />
      </div>

      <footer className="border-t border-mk-current bg-mk-ridge/40 px-4 py-2.5">
        <ActiveSummary shape={shape} />
        {mutation.isError ? (
          <div className="mt-1 font-mono text-[11px] text-mk-danger">
            {(mutation.error as Error).message}
          </div>
        ) : null}
      </footer>
    </article>
  );
}

function PreferToggle({
  value,
  disabled,
  onChange,
}: {
  value: "cloud" | "local";
  disabled: boolean;
  onChange(next: "cloud" | "local"): void;
}) {
  return (
    <div
      role="group"
      aria-label="Prefer"
      className="flex h-7 items-center rounded-md border border-mk-current bg-mk-depth p-0.5"
    >
      {(["cloud", "local"] as const).map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled || active}
            onClick={() => onChange(option)}
            className={[
              "h-6 min-w-[58px] rounded-sm px-2 text-[11.5px] font-medium capitalize transition-colors",
              active
                ? "bg-mk-crest text-mk-abyss"
                : "text-mk-surface hover:text-mk-crest",
            ].join(" ")}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function SlotRow({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: SelectableModel[];
  value: { providerId: string; modelId: string } | null;
  disabled: boolean;
  onChange(slot: { providerId: string; modelId: string } | null): void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-[56px] shrink-0">
        <span className="mk-label">{label}</span>
      </div>
      <ModelCombobox
        options={options}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

type ComboItem =
  | { kind: "none" }
  | { kind: "option"; option: SelectableModel };

function ModelCombobox({
  options,
  value,
  disabled,
  onChange,
}: {
  options: SelectableModel[];
  value: { providerId: string; modelId: string } | null;
  disabled: boolean;
  onChange(slot: { providerId: string; modelId: string } | null): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const known = useMemo(
    () =>
      value
        ? options.find(
            (o) => o.providerId === value.providerId && o.modelId === value.modelId,
          ) ?? null
        : null,
    [options, value],
  );

  const items = useMemo<ComboItem[]>(() => {
    const q = query.trim().toLowerCase();
    const filtered = options.filter((o) => {
      if (!q) return true;
      const hay = `${o.providerName} ${o.providerId} ${o.modelDisplay} ${o.modelId}`
        .toLowerCase();
      return hay.includes(q);
    });
    const entries: ComboItem[] = filtered.map((option) => ({ kind: "option", option }));
    if (!q) entries.unshift({ kind: "none" });
    return entries;
  }, [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return undefined;
    }
    const updateAnchor = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({ left: rect.left, top: rect.bottom + 4, width: rect.width });
    };
    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, true);
    return () => {
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery("");
    setActiveIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(
      `[data-idx="${activeIdx}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open, items.length]);

  const pickItem = (idx: number) => {
    const item = items[idx];
    if (!item) return;
    if (item.kind === "none") {
      onChange(null);
    } else {
      onChange({
        providerId: item.option.providerId,
        modelId: item.option.modelId,
      });
    }
    setOpen(false);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(Math.max(items.length - 1, 0), i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickItem(activeIdx);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const hasValue = !!value;
  const label = value
    ? known
      ? `${known.providerName} · ${known.modelDisplay || known.modelId}`
      : `${value.providerId}/${value.modelId} (not in current catalog)`
    : "— none —";

  return (
    <div className="relative flex-1" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          "relative flex h-9 w-full items-center gap-2 rounded-md border bg-mk-depth pl-2.5 pr-8 text-left text-[13px] transition-colors",
          hasValue ? "text-mk-crest" : "text-mk-tide",
          open
            ? "border-mk-signal-dim bg-mk-ridge/30"
            : "border-mk-current hover:border-mk-surface hover:bg-mk-ridge/40",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-mk-depth",
          disabled ? "" : "cursor-pointer",
        ].join(" ")}
      >
        {hasValue ? <ProviderIcon providerId={value!.providerId} size={14} /> : null}
        <span className="flex-1 truncate">{label}</span>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-mk-tide">
          <SelectChevron />
        </span>
      </button>

      {open && anchor
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                left: anchor.left,
                top: anchor.top,
                width: anchor.width,
              }}
              className="z-50 rounded-md border border-mk-current bg-mk-depth shadow-xl"
            >
          <div className="border-b border-mk-current px-2 py-1.5">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Search models…"
              spellCheck={false}
              autoComplete="off"
              className="h-7 w-full rounded-xs bg-transparent px-1.5 text-[12.5px] text-mk-crest placeholder:text-mk-tide focus:outline-none"
            />
          </div>
          <div
            ref={listRef}
            role="listbox"
            className="max-h-[260px] overflow-y-auto py-1"
          >
            {items.length === 0 ? (
              <div className="px-2.5 py-2 text-[12.5px] text-mk-tide">
                No matches.
              </div>
            ) : (
              items.map((item, idx) => {
                const active = idx === activeIdx;
                const isSelected =
                  item.kind === "none"
                    ? !value
                    : !!value &&
                      item.option.providerId === value.providerId &&
                      item.option.modelId === value.modelId;
                return (
                  <div
                    key={
                      item.kind === "none"
                        ? "__none__"
                        : toKey(item.option)
                    }
                    role="option"
                    data-idx={idx}
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickItem(idx);
                    }}
                    className={[
                      "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12.5px]",
                      active ? "bg-mk-ridge/70" : "",
                    ].join(" ")}
                  >
                    {item.kind === "none" ? (
                      <span className="pl-[22px] italic text-mk-tide">
                        — none —
                      </span>
                    ) : (
                      <>
                        <ProviderIcon
                          providerId={item.option.providerId}
                          size={14}
                        />
                        <span className="flex-1 truncate">
                          <span className="text-mk-tide">
                            {item.option.providerName}
                          </span>
                          <span className="mx-1.5 text-mk-tide">·</span>
                          <span className="text-mk-crest">
                            {item.option.modelDisplay || item.option.modelId}
                          </span>
                        </span>
                        {item.option.unavailableReason ? (
                          <span className="mk-label text-mk-warn">
                            {item.option.unavailableReason}
                          </span>
                        ) : null}
                        {isSelected ? (
                          <span className="mk-label text-mk-ok">selected</span>
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function SelectChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M3 5L6 8L9 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function ActiveSummary({ shape }: { shape: AxisShape }) {
  if (!shape.active) {
    return (
      <div className="font-mono text-[11px] text-mk-tide">
        Not configured · {shape.reason ?? "no model selected"}
      </div>
    );
  }
  const tag =
    shape.source === "primary" ? (
      <span className="mk-label text-mk-ok">primary</span>
    ) : (
      <span className="mk-label text-mk-warn">fallback</span>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-mk-surface">
      <span>active ·</span>
      <ProviderIcon providerId={shape.active.providerId} size={14} />
      <span className="text-mk-crest">
        {shape.active.providerId}/{shape.active.modelId}
      </span>
      {tag}
      {shape.reason && shape.source !== "primary" ? (
        <span className="text-mk-tide" title={shape.reason}>
          — {shape.reason}
        </span>
      ) : null}
    </div>
  );
}

function toKey(slot: { providerId: string; modelId: string }): string {
  return `${slot.providerId}\u0001${slot.modelId}`;
}

// =============================================================================
// transport
// =============================================================================

interface DefaultsResponse {
  agent: AxisShape;
  embedding: AxisShape;
}

async function putDefaults(patch: {
  agent?: { cloud?: AxisShape["cloud"]; local?: AxisShape["local"]; prefer?: AxisShape["prefer"] };
  embedding?: { cloud?: AxisShape["cloud"]; local?: AxisShape["local"]; prefer?: AxisShape["prefer"] };
}): Promise<DefaultsResponse> {
  // Reuse `post` helper but it always POSTs. Use fetch directly so we can PUT.
  const res = await fetch("/api/v1/defaults", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  let parsed: { ok?: boolean; data?: DefaultsResponse; error?: { message?: string } } = {};
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    /* keep empty */
  }
  if (!res.ok || parsed.ok === false) {
    throw new Error(parsed.error?.message ?? `defaults write failed (${res.status})`);
  }
  return parsed.data as DefaultsResponse;
}
