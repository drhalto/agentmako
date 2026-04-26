import { harnessHttp } from "./harness-http.js";

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
}

interface UsageResponse {
  since: string;
  groupBy: "model" | "kind" | "model+kind";
  rows: UsageRow[];
  totalCalls: number;
}

function formatUsd(micro: number): string {
  const usd = micro / 1_000_000;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

export async function runUsageCommand(raw: string[]): Promise<void> {
  if (raw[0] === "help" || raw[0] === "--help") {
    process.stdout.write(
      "usage:\n" +
        "  agentmako usage [--days N] [--project ID] [--group-by model|kind|model+kind]\n",
    );
    return;
  }

  let days = 30;
  let projectId: string | null = null;
  let groupBy = "model+kind";
  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    if (arg === "--days" && raw[i + 1]) {
      const parsed = Number.parseInt(raw[i + 1]!, 10);
      if (Number.isFinite(parsed) && parsed > 0) days = parsed;
      i += 1;
    } else if (arg === "--project" && raw[i + 1]) {
      projectId = raw[i + 1]!;
      i += 1;
    } else if (arg === "--group-by" && raw[i + 1]) {
      groupBy = raw[i + 1]!;
      i += 1;
    }
  }

  const sinceDate = new Date();
  sinceDate.setUTCDate(sinceDate.getUTCDate() - days);
  const params = new URLSearchParams();
  params.set("since", sinceDate.toISOString());
  params.set("group_by", groupBy);
  if (projectId) params.set("project_id", projectId);

  const result = await harnessHttp<UsageResponse>(
    "GET",
    `/api/v1/usage?${params.toString()}`,
  );
  if (!result.ok || !result.data) {
    throw new Error(
      `usage failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
    );
  }

  const d = result.data;
  process.stdout.write(
    `since ${d.since}  groupBy=${d.groupBy}  calls=${d.totalCalls}\n`,
  );
  if (d.rows.length === 0) {
    process.stdout.write("(no rows)\n");
    return;
  }

  // Column widths
  const headers = [
    "model",
    "origin",
    "calls",
    "input",
    "output",
    "reasoning",
    "cache.r",
    "cache.w",
    "cost",
  ];
  const rows = d.rows.map((r) => [
    r.providerId && r.modelId ? `${r.providerId}/${r.modelId}` : "—",
    r.callerKind ?? "—",
    formatInt(r.calls),
    formatInt(r.inputTokens),
    formatInt(r.outputTokens),
    formatInt(r.reasoningTokens),
    formatInt(r.cacheReadTokens),
    formatInt(r.cacheWriteTokens),
    formatUsd(r.costUsdMicro),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length)),
  );
  const fmt = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");

  process.stdout.write(fmt(headers) + "\n");
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n");
  for (const r of rows) process.stdout.write(fmt(r) + "\n");

  const totalCost = d.rows.reduce((sum, r) => sum + r.costUsdMicro, 0);
  process.stdout.write(`\ntotal: ${formatUsd(totalCost)}\n`);
}
