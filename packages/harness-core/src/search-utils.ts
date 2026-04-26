export const RRF_K = 60;

export function sanitizeFtsQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return "zzzzzz_mako_empty_query_zzzzzz";
  }
  return tokens.map((t) => `${t}*`).join(" OR ");
}
