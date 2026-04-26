export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value == null || value === "") {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
