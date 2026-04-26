export function normalizeStringArray(
  values: ReadonlyArray<string | null | undefined>,
): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}
