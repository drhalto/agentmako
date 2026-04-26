import { harnessHttp } from "./harness-http.js";

interface CatalogStatusResponse {
  source: "cache" | "fresh" | "snapshot" | "bundled";
  fetchedAt: string | null;
  modelCount: number;
  providerCount: number;
  ttlSecondsRemaining: number | null;
  cachePath: string;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export async function runCatalogCommand(raw: string[]): Promise<void> {
  const sub = raw[0];
  if (!sub || sub === "help" || sub === "--help") {
    process.stdout.write(
      "usage:\n" +
        "  agentmako catalog status      — show active catalog source + freshness\n" +
        "  agentmako catalog refresh     — force a re-fetch from models.dev\n",
    );
    return;
  }

  if (sub === "status") {
    const result = await harnessHttp<CatalogStatusResponse>(
      "GET",
      "/api/v1/catalog/status",
    );
    if (!result.ok || !result.data) {
      throw new Error(
        `catalog status failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
      );
    }
    const d = result.data;
    process.stdout.write(
      `source: ${d.source}\n` +
        `refreshed: ${formatRelative(d.fetchedAt)}${d.fetchedAt ? ` (${d.fetchedAt})` : ""}\n` +
        `providers: ${d.providerCount}\n` +
        `models: ${d.modelCount}\n` +
        `cache: ${d.cachePath}\n` +
        (d.ttlSecondsRemaining !== null
          ? `ttl remaining: ${d.ttlSecondsRemaining}s\n`
          : ""),
    );
    return;
  }

  if (sub === "refresh") {
    const result = await harnessHttp<
      CatalogStatusResponse & { providers: number; models: number }
    >("POST", "/api/v1/catalog/refresh");
    if (!result.ok || !result.data) {
      throw new Error(
        `catalog refresh failed: ${result.error?.code ?? result.status} ${result.error?.message ?? ""}`,
      );
    }
    process.stdout.write(
      `refreshed: source=${result.data.source} providers=${result.data.providers} models=${result.data.models}\n`,
    );
    return;
  }

  throw new Error(`unknown catalog subcommand: ${sub}. Supported: status, refresh`);
}
