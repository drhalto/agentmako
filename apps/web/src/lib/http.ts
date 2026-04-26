/**
 * Tiny HTTP helper. Every call uses a relative path; Vite's dev proxy (or
 * the production static-serve) routes /api/v1/* appropriately.
 *
 * The harness + API services return envelope bodies `{ ok, requestId,
 * data, error }`. This helper unwraps on success and throws on failure so
 * React Query's `error` state handles it.
 */

export class HarnessHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HarnessHttpError";
  }
}

interface Envelope<T> {
  ok?: boolean;
  requestId?: string;
  data?: T;
  error?: { code: string; message: string };
}

export async function http<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Envelope<T> = {};
  try {
    parsed = text.length > 0 ? (JSON.parse(text) as Envelope<T>) : {};
  } catch {
    parsed = {};
  }
  if (!response.ok || parsed.ok === false) {
    throw new HarnessHttpError(
      response.status,
      parsed.error?.code ?? "http/unknown",
      parsed.error?.message ?? response.statusText,
    );
  }
  return (parsed.data ?? (parsed as unknown as T)) as T;
}

/** Short-hand GET. */
export const get = <T>(path: string) => http<T>("GET", path);
/** Short-hand POST. */
export const post = <T>(path: string, body?: unknown) => http<T>("POST", path, body);
/** Short-hand PATCH. */
export const patch = <T>(path: string, body?: unknown) => http<T>("PATCH", path, body);
/** Short-hand DELETE. */
export const del = <T>(path: string) => http<T>("DELETE", path);
