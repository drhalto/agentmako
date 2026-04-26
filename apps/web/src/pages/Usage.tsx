/**
 * Phase 3.9 `/usage` page.
 *
 * Hits `GET /api/v1/usage` with the selected date range + group-by, renders
 * the resulting rollup as a sortable table: one row per (provider/model,
 * agent|chat) combination with token breakdown + dollar spend. Mirrors
 * `agentmako usage` and opencode's `stats` surface.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../lib/http";

type GroupBy = "model" | "kind" | "model+kind";

interface UsageRow {
  providerId: string | null;
  modelId: string | null;
  callerKind: "agent" | "chat" | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsdMicro: number;
  firstAt: string | null;
  lastAt: string | null;
}

interface UsageResponse {
  since: string;
  groupBy: GroupBy;
  rows: UsageRow[];
  totalCalls: number;
}

const WINDOWS: Array<{ key: string; label: string; days: number | null }> = [
  { key: "24h", label: "24h", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "all", label: "all time", days: null },
];

export function UsagePage() {
  const [windowKey, setWindowKey] = useState("30d");
  const [groupBy, setGroupBy] = useState<GroupBy>("model+kind");
  const selected = WINDOWS.find((w) => w.key === windowKey) ?? WINDOWS[2]!;

  const since = useMemo(() => {
    if (selected.days === null) return "1970-01-01T00:00:00.000Z";
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - selected.days);
    return d.toISOString();
  }, [selected]);

  const usage = useQuery({
    queryKey: ["usage", since, groupBy],
    queryFn: () =>
      get<UsageResponse>(
        `/api/v1/usage?since=${encodeURIComponent(since)}&group_by=${groupBy}`,
      ),
    refetchInterval: 60_000,
  });

  const rows = usage.data?.rows ?? [];
  const totalCost = rows.reduce((sum, r) => sum + r.costUsdMicro, 0);
  const totalCalls = usage.data?.totalCalls ?? 0;

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-8">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[20px] text-mk-crest">Usage</h1>
          <span className="mk-label text-mk-tide">model × agent/chat rollup</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <div className="flex overflow-hidden rounded-sm border border-mk-current">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setWindowKey(w.key)}
                className={[
                  "px-3 py-1.5 transition-colors",
                  w.key === windowKey
                    ? "bg-mk-depth text-mk-crest"
                    : "text-mk-tide hover:text-mk-crest",
                ].join(" ")}
              >
                {w.label}
              </button>
            ))}
          </div>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="rounded-sm border border-mk-current bg-mk-abyss px-2 py-1.5 text-mk-crest"
          >
            <option value="model+kind">group: model + origin</option>
            <option value="model">group: model</option>
            <option value="kind">group: origin</option>
          </select>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Total spend" value={formatUsd(totalCost)} />
        <Stat label="Total calls" value={totalCalls.toLocaleString("en-US")} />
        <Stat
          label="Distinct rollups"
          value={rows.length.toLocaleString("en-US")}
        />
      </div>

      <div className="mk-card overflow-hidden">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-mk-current bg-mk-ridge/40">
              <Th>Model</Th>
              <Th>Origin</Th>
              <Th align="right">Calls</Th>
              <Th align="right">Input</Th>
              <Th align="right">Output</Th>
              <Th align="right">Reasoning</Th>
              <Th align="right">Cache r/w</Th>
              <Th align="right">Cost</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !usage.isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-mk-tide">
                  No provider calls recorded in this window yet.
                </td>
              </tr>
            ) : null}
            {rows.map((r, i) => (
              <tr
                key={`${r.providerId ?? ""}/${r.modelId ?? ""}|${r.callerKind ?? ""}|${i}`}
                className={i === 0 ? "" : "border-t border-mk-current"}
              >
                <Td mono>
                  {r.providerId && r.modelId
                    ? `${r.providerId}/${r.modelId}`
                    : "—"}
                </Td>
                <Td mono muted>
                  {r.callerKind ?? "—"}
                </Td>
                <Td align="right">{r.calls.toLocaleString("en-US")}</Td>
                <Td align="right" mono>
                  {formatTokens(r.inputTokens)}
                </Td>
                <Td align="right" mono>
                  {formatTokens(r.outputTokens)}
                </Td>
                <Td align="right" mono muted>
                  {r.reasoningTokens > 0 ? formatTokens(r.reasoningTokens) : "—"}
                </Td>
                <Td align="right" mono muted>
                  {r.cacheReadTokens + r.cacheWriteTokens > 0
                    ? `${formatTokens(r.cacheReadTokens)} / ${formatTokens(r.cacheWriteTokens)}`
                    : "—"}
                </Td>
                <Td align="right" mono>
                  {formatUsd(r.costUsdMicro)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mk-card px-4 py-3">
      <div className="mk-label text-mk-tide">{label}</div>
      <div className="mt-1 font-mono text-[16px] text-mk-crest">{value}</div>
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th
      className={[
        "px-4 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-mk-tide",
        align === "right" ? "text-right" : "",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  muted,
  align,
}: {
  children: React.ReactNode;
  mono?: boolean;
  muted?: boolean;
  align?: "right";
}) {
  return (
    <td
      className={[
        "px-4 py-3 align-middle",
        mono ? "font-mono text-[12px]" : "text-[13px]",
        muted ? "text-mk-surface" : "text-mk-crest",
        align === "right" ? "text-right" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

function formatUsd(micro: number): string {
  const usd = micro / 1_000_000;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
