import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ProviderEntry } from "../api-types";
import {
  buildPickableModels,
  type ModelPick,
  type PickableModel,
} from "../lib/model-catalog";
import { ProviderIcon } from "./ProviderIcon";

interface Props {
  providers: ProviderEntry[];
  value: ModelPick | null;
  disabled?: boolean;
  onChange(next: ModelPick): void;
}

export function SessionModelPicker({ providers, value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const models = useMemo(
    () => buildPickableModels(providers).filter((entry) => entry.usable),
    [providers],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => {
      const hay = `${m.providerName} ${m.providerId} ${m.modelDisplay} ${m.modelId}`.toLowerCase();
      return hay.includes(q);
    });
  }, [models, query]);

  // Flat array for keyboard navigation; grouped rendering derives from
  // the same filtered set so the active row tracks correctly even when
  // the search collapses providers.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; models: PickableModel[] }>();
    for (const model of filtered) {
      const existing = map.get(model.providerId);
      if (existing) existing.models.push(model);
      else map.set(model.providerId, { label: model.providerName, models: [model] });
    }
    return [...map.entries()];
  }, [filtered]);

  const active = models.find(
    (entry) =>
      value &&
      entry.providerId === value.providerId &&
      entry.modelId === value.modelId,
  );

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
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
      setAnchor({ left: rect.left, top: rect.top - 8, width: rect.width });
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
    const initial = filtered.findIndex(
      (m) => value && m.providerId === value.providerId && m.modelId === value.modelId,
    );
    setActiveIdx(initial >= 0 ? initial : 0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(
      `[data-idx="${activeIdx}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open, filtered.length]);

  const commit = (pick: ModelPick) => {
    onChange(pick);
    setOpen(false);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(Math.max(filtered.length - 1, 0), i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = filtered[activeIdx];
      if (row) commit({ providerId: row.providerId, modelId: row.modelId });
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const label = active?.modelDisplay ?? active?.modelId ?? value?.modelId ?? "No agent";
  const providerId = active?.providerId ?? value?.providerId ?? null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || models.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        title={label}
        className={[
          "flex h-7 min-w-0 max-w-[260px] items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
          open
            ? "border-mk-signal-dim bg-mk-ridge/40 text-mk-crest"
            : "border-mk-current bg-mk-depth text-mk-surface hover:border-mk-surface hover:bg-mk-ridge/40 hover:text-mk-crest",
          "disabled:cursor-not-allowed disabled:opacity-40",
        ].join(" ")}
      >
        {providerId ? <ProviderIcon providerId={providerId} size={13} /> : null}
        <span className="truncate">{label}</span>
        <ChevronIcon flipped={open} />
      </button>

      {open && anchor
        ? createPortal(
            <div
              ref={popoverRef}
              style={{
                position: "fixed",
                left: anchor.left,
                bottom: Math.max(window.innerHeight - anchor.top, 12),
                width: Math.max(anchor.width, 320),
              }}
              className="z-50 flex max-h-[360px] flex-col rounded-md border border-mk-current bg-mk-depth shadow-xl"
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
              <div ref={listRef} role="listbox" className="flex-1 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <div className="px-2.5 py-3 text-[12.5px] text-mk-tide">
                    No matches.
                  </div>
                ) : (
                  groups.map(([groupId, group]) => (
                    <section key={groupId}>
                      <div className="px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mk-tide">
                        {group.label}
                      </div>
                      {group.models.map((model) => {
                        const flatIdx = filtered.findIndex(
                          (m) => m.providerId === model.providerId && m.modelId === model.modelId,
                        );
                        const highlighted = flatIdx === activeIdx;
                        const selected =
                          value?.providerId === model.providerId &&
                          value?.modelId === model.modelId;
                        return (
                          <div
                            key={`${model.providerId}:${model.modelId}`}
                            role="option"
                            data-idx={flatIdx}
                            aria-selected={selected}
                            onMouseEnter={() => setActiveIdx(flatIdx)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              commit({
                                providerId: model.providerId,
                                modelId: model.modelId,
                              });
                            }}
                            className={[
                              "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12.5px]",
                              highlighted ? "bg-mk-ridge/70" : "",
                            ].join(" ")}
                          >
                            <ProviderIcon providerId={model.providerId} size={13} />
                            <span className="min-w-0 flex-1 truncate text-mk-crest">
                              {model.modelDisplay || model.modelId}
                            </span>
                            {selected ? (
                              <span className="mk-label shrink-0 text-mk-ok">active</span>
                            ) : null}
                          </div>
                        );
                      })}
                    </section>
                  ))
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ChevronIcon({ flipped }: { flipped: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      aria-hidden
      className={[
        "shrink-0 text-mk-tide transition-transform",
        flipped ? "rotate-180" : "",
      ].join(" ")}
    >
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
