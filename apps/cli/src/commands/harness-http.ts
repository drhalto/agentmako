const DEFAULT_ENDPOINT = process.env.MAKO_HARNESS_URL ?? "http://127.0.0.1:3018";

export interface HarnessHttpResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

export async function harnessHttp<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<HarnessHttpResult<T>> {
  const response = await fetch(`${DEFAULT_ENDPOINT}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: { ok?: boolean; data?: T; error?: { code: string; message: string } } = {};
  try {
    parsed = text ? (JSON.parse(text) as typeof parsed) : {};
  } catch {
    parsed = {};
  }
  return {
    ok: response.ok && parsed.ok !== false,
    status: response.status,
    data: parsed.data,
    error: parsed.error,
  };
}
