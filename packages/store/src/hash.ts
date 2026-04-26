import { createHash, randomUUID } from "node:crypto";

function sortForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForHash);
  }

  if (value != null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => [key, sortForHash(record[key])] as const);

    return Object.fromEntries(entries);
  }

  return value;
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashJson(value: unknown): string {
  return hashText(JSON.stringify(sortForHash(value)));
}
