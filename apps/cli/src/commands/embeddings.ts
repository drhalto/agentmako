import { harnessHttp } from "./harness-http.js";

interface EmbeddingReindexResponse {
  providerId: string;
  modelId: string;
  scanned: number;
  embedded: number;
  skipped: number;
  failed: number;
  failures: Array<{
    ownerKind: "memory" | "semantic_unit";
    ownerId: string;
    error: string;
  }>;
}

export async function runEmbeddingsCommand(raw: string[]): Promise<void> {
  const sub = raw[0];

  if (!sub || sub === "help" || sub === "--help") {
    process.stdout.write(
      "usage:\n" +
        "  agentmako embeddings reindex [--kind semantic-unit|memory|all]\n",
    );
    return;
  }

  if (sub !== "reindex") {
    throw new Error(`unknown embeddings subcommand: ${sub}. Supported: reindex`);
  }

  const kinds: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === "--kind" && raw[i + 1]) {
      kinds.push(raw[i + 1]!);
    }
  }

  const body =
    kinds.length === 0
      ? {}
      : kinds.length === 1
        ? { kind: kinds[0] }
        : { kinds };

  const result = await harnessHttp<EmbeddingReindexResponse>(
    "POST",
    "/api/v1/embeddings/reindex",
    body,
  );
  if (!result.ok || !result.data) {
    throw new Error(
      `embeddings reindex failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
    );
  }

  process.stdout.write(
    `reindexed via ${result.data.providerId}/${result.data.modelId}\n` +
      `  scanned:  ${result.data.scanned}\n` +
      `  embedded: ${result.data.embedded}\n` +
      `  skipped:  ${result.data.skipped}\n` +
      `  failed:   ${result.data.failed}\n`,
  );

  for (const failure of result.data.failures) {
    process.stdout.write(
      `  ! ${failure.ownerKind} ${failure.ownerId}: ${failure.error}\n`,
    );
  }
}
