/**
 * Bump when the indexer starts writing richer content to the project store
 * (new symbol kinds, new edge semantics, …). Multiple agentmako installs can
 * share one project store (a global MCP server plus a workspace CLI, say);
 * a writer with a LOWER capability than the store's latest run silently
 * downgrades the index — e.g. re-indexing away method symbols. Stamping runs
 * with this number lets newer readers detect and warn about that.
 *
 * 1: baseline (top-level exported symbols only)
 * 2: class methods indexed as symbols
 */
export const INDEXER_CAPABILITY_VERSION = 2;

export function indexCapabilityFromStats(stats: unknown): number | undefined {
  if (!stats || typeof stats !== "object") return undefined;
  const value = (stats as Record<string, unknown>).indexerCapability;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
