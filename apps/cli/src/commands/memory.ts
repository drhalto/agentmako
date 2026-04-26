/**
 * CLI commands for the Roadmap 3 Phase 3.3 semantic-memory layer:
 * `memory remember`, `memory recall`, `memory list`.
 *
 * Every subcommand routes through the `services/harness` HTTP API — no direct
 * imports from `@mako-ai/harness-core`. The transport-parity rule is enforced
 * here the same way `harness.ts` enforces it for `chat` / `session` / `tier`.
 */

import { harnessHttp } from "./harness-http.js";

interface RecallHit {
  memoryId: string;
  text: string;
  category: string | null;
  tags: string[];
  createdAt: string;
  score: number;
  ftsRank: number | null;
  vectorScore: number | null;
}

interface RecallResponse {
  mode: "hybrid" | "fts-fallback";
  reason?: string;
  results: RecallHit[];
}

interface ListRow {
  id: string;
  text: string;
  category: string | null;
  tags: string[];
  createdAt: string;
}

interface ListResponse {
  count: number;
  memories: ListRow[];
}

interface RememberResponse {
  id: string;
  createdAt: string;
  embedded: boolean;
  embeddingModel: string | null;
  embeddingError: string | null;
}

export async function runMemoryCommand(raw: string[]): Promise<void> {
  const sub = raw[0];

  if (!sub || sub === "help" || sub === "--help") {
    process.stdout.write(
      "usage:\n" +
        "  agentmako memory remember <text> [--category X] [--tag t1 --tag t2]\n" +
        "  agentmako memory recall <query> [--k N]\n" +
        "  agentmako memory list [--category X] [--tag T] [--since ISO] [--limit N]\n",
    );
    return;
  }

  if (sub === "remember") {
    const text = raw.slice(1).filter((a) => !a.startsWith("--")).join(" ").trim();
    if (!text) {
      throw new Error("usage: agentmako memory remember <text> [--category X] [--tag t]");
    }
    const categoryIdx = raw.indexOf("--category");
    const category = categoryIdx >= 0 ? raw[categoryIdx + 1] : undefined;
    const tags = collectFlag(raw, "--tag");

    const result = await harnessHttp<RememberResponse>("POST", "/api/v1/memory/remember", {
      text,
      category,
      tags: tags.length > 0 ? tags : undefined,
    });
    if (!result.ok || !result.data) {
      throw new Error(
        `memory remember failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
      );
    }
    const r = result.data;
    process.stdout.write(`remembered ${r.id}\n`);
    if (r.embedded) {
      process.stdout.write(`  embedded with ${r.embeddingModel}\n`);
    } else {
      const why = r.embeddingError ?? "no embedding provider available (FTS-only mode)";
      process.stdout.write(`  not embedded: ${why}\n`);
    }
    return;
  }

  if (sub === "recall") {
    const queryParts = raw.slice(1).filter((a) => !a.startsWith("--"));
    const query = queryParts.join(" ").trim();
    if (!query) {
      throw new Error("usage: agentmako memory recall <query> [--k N]");
    }
    const kIdx = raw.indexOf("--k");
    const k = kIdx >= 0 ? raw[kIdx + 1] : undefined;

    const params = new URLSearchParams();
    params.set("q", query);
    if (k) params.set("k", k);

    const result = await harnessHttp<RecallResponse>(
      "GET",
      `/api/v1/memory/recall?${params.toString()}`,
    );
    if (!result.ok || !result.data) {
      throw new Error(
        `memory recall failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
      );
    }
    printRecall(result.data);
    return;
  }

  if (sub === "list") {
    const params = new URLSearchParams();
    const categoryIdx = raw.indexOf("--category");
    if (categoryIdx >= 0 && raw[categoryIdx + 1]) params.set("category", raw[categoryIdx + 1]!);
    const tagIdx = raw.indexOf("--tag");
    if (tagIdx >= 0 && raw[tagIdx + 1]) params.set("tag", raw[tagIdx + 1]!);
    const sinceIdx = raw.indexOf("--since");
    if (sinceIdx >= 0 && raw[sinceIdx + 1]) params.set("since", raw[sinceIdx + 1]!);
    const limitIdx = raw.indexOf("--limit");
    if (limitIdx >= 0 && raw[limitIdx + 1]) params.set("limit", raw[limitIdx + 1]!);

    const qs = params.toString();
    const result = await harnessHttp<ListResponse>(
      "GET",
      `/api/v1/memory${qs ? `?${qs}` : ""}`,
    );
    if (!result.ok || !result.data) {
      throw new Error(
        `memory list failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
      );
    }
    printList(result.data);
    return;
  }

  throw new Error(
    `unknown memory subcommand: ${sub}. Supported: remember, recall, list`,
  );
}

function collectFlag(raw: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === flag && raw[i + 1]) {
      out.push(raw[i + 1]!);
    }
  }
  return out;
}

function printRecall(res: RecallResponse): void {
  process.stdout.write(`mode: ${res.mode}${res.reason ? ` (${res.reason})` : ""}\n`);
  if (res.results.length === 0) {
    process.stdout.write("(no results)\n");
    return;
  }
  for (const hit of res.results) {
    const tags = hit.tags.length > 0 ? ` [${hit.tags.join(",")}]` : "";
    const cat = hit.category ? ` {${hit.category}}` : "";
    const scoreDetail =
      hit.vectorScore !== null
        ? `rrf=${hit.score.toFixed(4)} cos=${hit.vectorScore.toFixed(3)}`
        : `fts-rank=${hit.ftsRank ?? "?"}`;
    process.stdout.write(`  ${hit.memoryId}${cat}${tags} [${scoreDetail}]\n    ${hit.text}\n`);
  }
}

function printList(res: ListResponse): void {
  process.stdout.write(`${res.count} memor${res.count === 1 ? "y" : "ies"}\n`);
  for (const m of res.memories) {
    const tags = m.tags.length > 0 ? ` [${m.tags.join(",")}]` : "";
    const cat = m.category ? ` {${m.category}}` : "";
    process.stdout.write(`  ${m.id}${cat}${tags} ${m.createdAt}\n    ${m.text}\n`);
  }
}
