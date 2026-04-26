import { harnessHttp } from "./harness-http.js";

interface SemanticSearchHit {
  kind: "code" | "doc" | "memory";
  sourceRef: string;
  title: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  excerpt: string;
  score: number;
  ftsRank: number | null;
  vectorScore: number | null;
}

interface SemanticSearchResponse {
  mode: "hybrid" | "fts-fallback";
  reason?: string;
  results: SemanticSearchHit[];
}

export async function runSemanticCommand(raw: string[]): Promise<void> {
  const sub = raw[0];

  if (!sub || sub === "help" || sub === "--help") {
    process.stdout.write(
      "usage:\n" +
        "  agentmako semantic search <query> [--k N] [--kind code --kind doc --kind memory] [--no-memory]\n",
    );
    return;
  }

  if (sub !== "search") {
    throw new Error(`unknown semantic subcommand: ${sub}. Supported: search`);
  }

  const query = raw.slice(1).filter((arg) => !arg.startsWith("--")).join(" ").trim();
  if (!query) {
    throw new Error(
      "usage: agentmako semantic search <query> [--k N] [--kind code|doc|memory] [--no-memory]",
    );
  }

  const params = new URLSearchParams();
  params.set("q", query);

  const kIndex = raw.indexOf("--k");
  if (kIndex >= 0 && raw[kIndex + 1]) {
    params.set("k", raw[kIndex + 1]!);
  }

  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "--kind" && raw[i + 1]) {
      params.append("kind", raw[i + 1]!);
    }
  }

  if (raw.includes("--no-memory")) {
    params.set("include_memories", "false");
  }

  const result = await harnessHttp<SemanticSearchResponse>(
    "GET",
    `/api/v1/semantic/search?${params.toString()}`,
  );
  if (!result.ok || !result.data) {
    throw new Error(
      `semantic search failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
    );
  }

  process.stdout.write(`mode: ${result.data.mode}${result.data.reason ? ` (${result.data.reason})` : ""}\n`);
  if (result.data.results.length === 0) {
    process.stdout.write("(no results)\n");
    return;
  }

  for (const hit of result.data.results) {
    const location =
      hit.filePath == null
        ? ""
        : hit.lineStart != null && hit.lineEnd != null
          ? ` ${hit.filePath}:${hit.lineStart}-${hit.lineEnd}`
          : ` ${hit.filePath}`;
    const score =
      hit.vectorScore != null
        ? `rrf=${hit.score.toFixed(4)} cos=${hit.vectorScore.toFixed(3)}`
        : `fts-rank=${hit.ftsRank ?? "?"}`;
    process.stdout.write(
      `  [${hit.kind}] ${hit.title}${location} [${score}]\n    ${hit.excerpt}\n`,
    );
  }
}
