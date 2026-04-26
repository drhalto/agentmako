import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { del, get, post } from "../lib/http";
import type { ProviderEntry } from "../api-types";
import {
  isChatCapable,
  isEmbeddingModel,
  isProviderUsable,
  providerUnavailableReason,
} from "../lib/model-catalog";
import { AxisDefaultsCard, type AxisShape } from "../components/AxisDefaultsCard";
import { ProviderIcon } from "../components/ProviderIcon";

interface DefaultsResponse {
  agent: AxisShape;
  embedding: AxisShape;
}

interface CatalogStatus {
  source: "cache" | "fresh" | "snapshot" | "bundled";
  fetchedAt: string | null;
  modelCount: number;
  providerCount: number;
  ttlSecondsRemaining: number | null;
}

const EMPTY_AXIS: AxisShape = {
  cloud: null,
  local: null,
  prefer: "cloud",
  active: null,
  source: "none",
};

const PROVIDER_SETUP_LINKS: Record<string, { label: string; href: string }> = {
  anthropic: { label: "Get API key", href: "https://console.anthropic.com/settings/keys" },
  cerebras: { label: "Get API key", href: "https://cloud.cerebras.ai/platform/api-keys" },
  deepseek: { label: "Get API key", href: "https://platform.deepseek.com/api_keys" },
  google: { label: "Get API key", href: "https://aistudio.google.com/app/apikey" },
  groq: { label: "Get API key", href: "https://console.groq.com/keys" },
  lmstudio: { label: "Setup", href: "https://lmstudio.ai/docs" },
  mistral: { label: "Get API key", href: "https://console.mistral.ai/api-keys/" },
  moonshot: { label: "Get API key", href: "https://platform.moonshot.ai/console/api-keys" },
  ollama: { label: "Setup", href: "https://ollama.com/download" },
  openai: { label: "Get API key", href: "https://platform.openai.com/api-keys" },
  openrouter: { label: "Get API key", href: "https://openrouter.ai/settings/keys" },
  together: { label: "Get API key", href: "https://api.together.ai/settings/api-keys" },
  xai: { label: "Get API key", href: "https://console.x.ai/" },
};

export function ProvidersPage() {
  const qc = useQueryClient();
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: () => get<{ providers: ProviderEntry[] }>("/api/v1/providers"),
  });

  const defaults = useQuery({
    queryKey: ["defaults"],
    queryFn: () => get<DefaultsResponse>("/api/v1/defaults"),
    refetchInterval: 30_000,
  });

  const catalogStatus = useQuery({
    queryKey: ["catalog-status"],
    queryFn: () => get<CatalogStatus>("/api/v1/catalog/status"),
    refetchInterval: 60_000,
  });

  const refreshCatalog = useMutation({
    mutationFn: () => post<CatalogStatus>("/api/v1/catalog/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog-status"] });
      qc.invalidateQueries({ queryKey: ["providers"] });
    },
  });

  const providerList = providers.data?.providers ?? [];
  const agent = defaults.data?.agent ?? EMPTY_AXIS;
  const embedding = defaults.data?.embedding ?? EMPTY_AXIS;
  const selectedProvider = useMemo(
    () => providerList.find((entry) => entry.spec.id === selectedProviderId) ?? null,
    [providerList, selectedProviderId],
  );

  useEffect(() => {
    if (selectedProviderId && !providerList.some((entry) => entry.spec.id === selectedProviderId)) {
      setSelectedProviderId(null);
    }
  }, [providerList, selectedProviderId]);

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-8">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="text-[20px] text-mk-crest">Providers</h1>
        {catalogStatus.data ? (
          <div className="flex items-center gap-2 font-mono text-[11px] text-mk-tide">
            <span>
              Catalog: <span className="text-mk-crest">{catalogStatus.data.source}</span>
              {" · "}
              refreshed {formatCatalogFreshness(catalogStatus.data.fetchedAt)}
              {" · "}
              {catalogStatus.data.modelCount} models / {catalogStatus.data.providerCount} providers
            </span>
            <button
              type="button"
              onClick={() => refreshCatalog.mutate()}
              disabled={refreshCatalog.isPending}
              className="rounded-xs border border-mk-current px-2 py-1 text-mk-surface transition-colors hover:bg-mk-depth hover:text-mk-crest disabled:opacity-40"
            >
              {refreshCatalog.isPending ? "refreshing…" : "Refresh"}
            </button>
          </div>
        ) : null}
      </div>

      {/* ---- Defaults --------------------------------------------------- */}
      <section className="mb-10">
        <h2
          className="mb-3 text-[14px] font-medium text-mk-crest"
          title="Persistent agent identity and embedding choice. Sessions and composers inherit; the chat surface keeps its own per-session picker."
        >
          Defaults
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <AxisDefaultsCard axis="embedding" shape={embedding} providers={providerList} />
          <AxisDefaultsCard axis="agent" shape={agent} providers={providerList} />
        </div>
      </section>

      {/* ---- Configured providers ------------------------------------- */}
      <section>
        <h2
          className="mb-3 text-[14px] font-medium text-mk-crest"
          title="Reachability and key resolution for every provider mako knows about."
        >
          Configured providers
        </h2>
        <div className="mk-card overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-mk-current bg-mk-ridge/40">
                <Th>Provider</Th>
                <Th>Transport</Th>
                <Th>Tier</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {providerList.map((e, i) => (
                <tr
                  key={e.spec.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open provider details for ${e.spec.name}`}
                  onClick={() => setSelectedProviderId(e.spec.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedProviderId(e.spec.id);
                    }
                  }}
                  className={[
                    i === 0 ? "" : "border-t border-mk-current",
                    "cursor-pointer transition-colors hover:bg-mk-ridge/30 focus-visible:bg-mk-ridge/30 focus-visible:outline-none",
                  ].join(" ")}
                >
                  <Td mono>
                    <span className="flex items-center gap-2">
                      <ProviderIcon providerId={e.spec.id} size={16} />
                      <span>{e.spec.id}</span>
                    </span>
                  </Td>
                  <Td>{e.spec.transport}</Td>
                  <Td>{e.spec.tier}</Td>
                  <Td>
                    <ProviderStatusCell
                      entry={e}
                      onOpenProvider={() => setSelectedProviderId(e.spec.id)}
                    />
                  </Td>
                </tr>
              ))}
              {!providers.isLoading && providerList.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-mk-tide">
                    No providers configured.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <ProviderDetailsSheet
        entry={selectedProvider}
        agent={agent}
        embedding={embedding}
        onClose={() => setSelectedProviderId(null)}
      />
    </div>
  );
}

function ProviderStatusCell({
  entry,
  onOpenProvider,
}: {
  entry: ProviderEntry;
  onOpenProvider(): void;
}) {
  if (entry.spec.auth === "none") {
    return isProviderUsable(entry) ? (
      <span className="font-mono text-[11px] text-mk-ok">online</span>
    ) : (
      <span className="font-mono text-[11px] text-mk-warn">
        {providerUnavailableReason(entry)}
      </span>
    );
  }

  const canDeleteKey = entry.keySource === "keychain";
  const label = canDeleteKey ? "Remove" : "Add API key";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenProvider();
      }}
      className={[
        "h-7 rounded-xs px-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
        canDeleteKey
          ? "border border-mk-danger/40 text-mk-danger hover:bg-mk-danger/10"
          : "border border-mk-signal/50 bg-mk-signal/10 text-mk-signal hover:bg-mk-signal/20 hover:text-mk-crest",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ProviderDetailsSheet({
  entry,
  agent,
  embedding,
  onClose,
}: {
  entry: ProviderEntry | null;
  agent: AxisShape;
  embedding: AxisShape;
  onClose(): void;
}) {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  useEffect(() => {
    if (!entry) return undefined;
    setApiKey("");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entry, onClose]);

  const storeKey = useMutation({
    mutationFn: (input: { providerId: string; value: string }) =>
      post<{ provider: string; stored: true }>(
        `/api/v1/keys/${encodeURIComponent(input.providerId)}`,
        { value: input.value },
      ),
    onSuccess: () => {
      setApiKey("");
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["defaults"] });
    },
  });

  const deleteKey = useMutation({
    mutationFn: (providerId: string) =>
      del<{ provider: string; deleted: boolean }>(`/api/v1/keys/${encodeURIComponent(providerId)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["defaults"] });
    },
  });

  const updateDefaults = useMutation({
    mutationFn: (patch: DefaultsPatch) => putDefaultsPatch(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["defaults"] });
    },
  });

  if (!entry) return null;

  const setupLink = PROVIDER_SETUP_LINKS[entry.spec.id] ?? null;
  const keySource = entry.keySource ?? "unresolved";
  const localProbeMessage =
    entry.spec.tier === "local" && entry.localProbe
      ? entry.localProbe.ok
        ? `${entry.localProbe.models} live model${entry.localProbe.models === 1 ? "" : "s"}`
        : entry.localProbe.error ?? "daemon offline"
      : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-mk-abyss/65 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-sheet-title"
        onClick={(event) => event.stopPropagation()}
        className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-mk-current bg-mk-depth shadow-2xl"
      >
        <header className="border-b border-mk-current px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ProviderIcon providerId={entry.spec.id} size={18} />
                <h2 id="provider-sheet-title" className="text-[16px] text-mk-crest">
                  {entry.spec.name}
                </h2>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-mk-tide">
                <span>{entry.spec.id}</span>
                <span>{entry.spec.transport}</span>
                <span>{entry.spec.tier}</span>
                <span>{entry.spec.kind}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xs border border-mk-current px-2 py-1 font-mono text-[11px] text-mk-surface transition-colors hover:bg-mk-ridge hover:text-mk-crest"
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="grid gap-3 sm:grid-cols-2">
            <SheetStat label="Availability">
              {isProviderUsable(entry)
                ? entry.spec.auth === "none"
                  ? "online"
                  : "ready"
                : providerUnavailableReason(entry) ?? "unknown"}
            </SheetStat>
            <SheetStat label="Base URL">{entry.resolvedBaseURL ?? entry.spec.baseURL ?? "—"}</SheetStat>
            <SheetStat label="Catalog source">{entry.source}</SheetStat>
            <SheetStat label="Key source">{entry.spec.auth === "none" ? "not required" : keySource}</SheetStat>
            {localProbeMessage ? (
              <SheetStat label="Local probe">{localProbeMessage}</SheetStat>
            ) : null}
            {entry.spec.envVarHints.length > 0 ? (
              <SheetStat label="Env vars">{entry.spec.envVarHints.join(", ")}</SheetStat>
            ) : null}
          </section>

          {entry.spec.auth === "api-key" ? (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <h3 className="text-[13px] font-medium text-mk-crest">API key</h3>
                  <p className="mt-1 text-[12px] text-mk-tide">
                    Store a provider key in the system keychain for this machine.
                  </p>
                </div>
                {setupLink ? (
                  <a
                    href={setupLink.href}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-mk-signal underline decoration-mk-signal/40 underline-offset-3 hover:text-mk-crest"
                  >
                    {setupLink.label}
                  </a>
                ) : null}
              </div>

              {entry.keySource?.startsWith("env:") ? (
                <div className="rounded-xs border border-mk-warn/40 bg-mk-abyss px-3 py-2 text-[11px] text-mk-warn">
                  Resolved from <span className="font-mono">{entry.keySource.slice(4)}</span>. A keychain
                  entry can be stored here, but the env var will keep winning until you remove it.
                </div>
              ) : null}

              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={`Paste ${entry.spec.name} API key`}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 flex-1 rounded-xs border border-mk-current bg-mk-abyss px-3 font-mono text-[12px] text-mk-crest placeholder:text-mk-tide focus:border-mk-signal-dim focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    const value = apiKey.trim();
                    if (!value || storeKey.isPending) return;
                    storeKey.mutate({ providerId: entry.spec.id, value });
                  }}
                  disabled={apiKey.trim().length === 0 || storeKey.isPending}
                  className="h-9 rounded-xs bg-mk-crest px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-mk-abyss transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {storeKey.isPending ? "Saving…" : "Save key"}
                </button>
                <button
                  type="button"
                  onClick={() => deleteKey.mutate(entry.spec.id)}
                  disabled={entry.keySource !== "keychain"}
                  className="h-9 rounded-xs border border-mk-current px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-mk-surface transition-colors hover:bg-mk-ridge disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Remove
                </button>
              </div>

              {storeKey.isError ? (
                <SheetError message={(storeKey.error as Error).message} />
              ) : null}
              {deleteKey.isError ? (
                <SheetError message={(deleteKey.error as Error).message} />
              ) : null}
            </section>
          ) : null}

          <section className="space-y-3">
            <div>
              <h3 className="text-[13px] font-medium text-mk-crest">Models</h3>
              <p className="mt-1 text-[12px] text-mk-tide">
                Select a model here to update the current default slot for this provider tier.
              </p>
            </div>

            <div className="space-y-2">
              {entry.spec.models.map((model) => {
                const isAgentModel = entry.spec.kind !== "embedding" && isChatCapable(model.id);
                const isEmbeddingCapable = entry.spec.kind !== "chat" && isEmbeddingModel(model.id);
                const tierKey = entry.spec.tier;
                const agentSelected =
                  agent[tierKey]?.providerId === entry.spec.id && agent[tierKey]?.modelId === model.id;
                const embeddingSelected =
                  embedding[tierKey]?.providerId === entry.spec.id &&
                  embedding[tierKey]?.modelId === model.id;

                return (
                  <div
                    key={model.id}
                    className="rounded-xs border border-mk-current bg-mk-abyss/55 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] text-mk-crest">{model.displayName}</span>
                          {model.discovered ? (
                            <span className="mk-label text-mk-ok">live</span>
                          ) : null}
                          {agentSelected ? <span className="mk-label text-mk-ok">agent</span> : null}
                          {embeddingSelected ? (
                            <span className="mk-label text-mk-signal">embeddings</span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-mk-tide">
                          <span>{model.id}</span>
                          <span>{formatContextWindow(model.contextWindow)}</span>
                          {model.supportsTools ? <span>tools</span> : null}
                          {model.supportsReasoning ? <span>reasoning</span> : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {isAgentModel ? (
                          <button
                            type="button"
                            disabled={updateDefaults.isPending}
                            onClick={() =>
                              updateDefaults.mutate({
                                agent: {
                                  [tierKey]: { providerId: entry.spec.id, modelId: model.id },
                                },
                              })
                            }
                            className={[
                              "h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
                              agentSelected
                                ? "border border-mk-ok/40 bg-mk-ok/10 text-mk-ok"
                                : "border border-mk-current text-mk-surface hover:bg-mk-ridge",
                            ].join(" ")}
                          >
                            {agentSelected ? `Selected ${tierKey} agent` : `Set ${tierKey} agent`}
                          </button>
                        ) : null}
                        {isEmbeddingCapable ? (
                          <button
                            type="button"
                            disabled={updateDefaults.isPending}
                            onClick={() =>
                              updateDefaults.mutate({
                                embedding: {
                                  [tierKey]: { providerId: entry.spec.id, modelId: model.id },
                                },
                              })
                            }
                            className={[
                              "h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
                              embeddingSelected
                                ? "border border-mk-signal/40 bg-mk-signal/10 text-mk-signal"
                                : "border border-mk-current text-mk-surface hover:bg-mk-ridge",
                            ].join(" ")}
                          >
                            {embeddingSelected
                              ? `Selected ${tierKey} embed`
                              : `Set ${tierKey} embed`}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {updateDefaults.isError ? (
              <SheetError message={(updateDefaults.error as Error).message} />
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  );
}

function SheetStat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xs border border-mk-current bg-mk-abyss/45 px-3 py-2">
      <div className="mk-label text-mk-tide">{label}</div>
      <div className="mt-1 font-mono text-[11.5px] text-mk-crest break-all">{children}</div>
    </div>
  );
}

function SheetError({ message }: { message: string }) {
  return (
    <div className="rounded-xs border border-mk-danger/40 bg-mk-abyss px-3 py-2 font-mono text-[11px] text-mk-danger">
      {message}
    </div>
  );
}

function formatCatalogFreshness(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return iso;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function formatContextWindow(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M ctx`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k ctx`;
  return `${value} ctx`;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-mk-tide">
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  muted,
}: {
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={[
        "px-4 py-3 align-middle",
        mono ? "font-mono text-[12px]" : "text-[13px]",
        muted ? "text-mk-surface" : "text-mk-crest",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

interface DefaultsPatch {
  agent?: Partial<Record<"cloud" | "local" | "prefer", AxisShape["cloud"] | AxisShape["prefer"]>>;
  embedding?: Partial<Record<"cloud" | "local" | "prefer", AxisShape["cloud"] | AxisShape["prefer"]>>;
}

async function putDefaultsPatch(patch: DefaultsPatch): Promise<DefaultsResponse> {
  const response = await fetch("/api/v1/defaults", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const text = await response.text();
  let parsed: { ok?: boolean; data?: DefaultsResponse; error?: { message?: string } } = {};
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    /* keep empty */
  }
  if (!response.ok || parsed.ok === false) {
    throw new Error(parsed.error?.message ?? `defaults write failed (${response.status})`);
  }
  return parsed.data as DefaultsResponse;
}
