import type {
  ContextPacketIntent,
  ContextPacketLiveTextMiss,
  ContextPacketReadableCandidate,
  ContextPacketRequestCoverage,
  ContextPacketRequestCoverageItem,
  ContextPacketRequestCoverageKind,
  ContextPacketRequestCoverageKindSummary,
  ContextPacketRequestCoverageStatus,
  ContextPacketToolInput,
  JsonObject,
} from "@mako-ai/contracts";

type CoverageValues = Record<ContextPacketRequestCoverageKind, Map<string, Set<string>>>;

const COVERAGE_KINDS: ContextPacketRequestCoverageKind[] = [
  "file",
  "symbol",
  "route",
  "database_object",
  "quoted_text",
];

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

function normalizeLoose(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRoute(value: string): string {
  return normalizeLoose(value)
    .replace(/^nextjs:/, "")
    .replace(/^(get|post|put|patch|delete|options|head):/, "$1 ")
    .replace(/\s+/g, " ");
}

function normalizeDatabaseObject(value: string): string {
  return normalizeLoose(value).replace(/["'`]/g, "");
}

function uniqueStrings(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function jsonRecord(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function candidateRef(candidate: ContextPacketReadableCandidate): string {
  return [
    candidate.source,
    candidate.path ?? candidate.routeKey ?? candidate.databaseObjectName ?? candidate.symbolName ?? candidate.id,
    candidate.lineStart ?? "",
  ].filter((part) => String(part).length > 0).join(":");
}

function addCoverageValue(
  values: CoverageValues,
  kind: ContextPacketRequestCoverageKind,
  value: string | undefined,
  ref: string,
): void {
  if (!value) return;
  const normalized = normalizeCoverageValue(kind, value);
  if (!normalized) return;
  const current = values[kind].get(normalized) ?? new Set<string>();
  current.add(ref);
  values[kind].set(normalized, current);
}

function normalizeCoverageValue(kind: ContextPacketRequestCoverageKind, value: string): string {
  switch (kind) {
    case "file":
      return normalizePath(value);
    case "route":
      return normalizeRoute(value);
    case "database_object":
      return normalizeDatabaseObject(value);
    case "symbol":
    case "quoted_text":
      return normalizeLoose(value);
  }
  return normalizeLoose(value);
}

function collectCoveredValues(candidates: readonly ContextPacketReadableCandidate[]): CoverageValues {
  const values = Object.fromEntries(COVERAGE_KINDS.map((kind) => [kind, new Map<string, Set<string>>()])) as CoverageValues;

  for (const candidate of candidates) {
    const ref = candidateRef(candidate);
    addCoverageValue(values, "file", candidate.path, ref);
    addCoverageValue(values, "symbol", candidate.symbolName, ref);
    addCoverageValue(values, "route", candidate.routeKey, ref);
    addCoverageValue(values, "route", stringValue(candidate.metadata?.pattern), ref);
    addCoverageValue(values, "database_object", candidate.databaseObjectName, ref);
    addCoverageValue(values, "database_object", stringValue(candidate.metadata?.schemaObject), ref);
    if (candidate.source === "live_text_provider") {
      addCoverageValue(values, "quoted_text", stringValue(candidate.metadata?.query), ref);
    }

    for (const raw of jsonArray(candidate.metadata?.supportingSignals)) {
      const signal = jsonRecord(raw);
      if (!signal) continue;
      const signalRef = [
        stringValue(signal.source) ?? candidate.source,
        stringValue(signal.path) ?? stringValue(signal.routeKey) ?? stringValue(signal.databaseObjectName) ?? ref,
        signal.lineStart ?? "",
      ].filter((part) => String(part).length > 0).join(":");
      addCoverageValue(values, "file", stringValue(signal.path), signalRef);
      addCoverageValue(values, "symbol", stringValue(signal.symbolName), signalRef);
      addCoverageValue(values, "route", stringValue(signal.routeKey), signalRef);
      const metadata = jsonRecord(signal.metadata);
      addCoverageValue(values, "route", stringValue(metadata?.pattern), signalRef);
      addCoverageValue(values, "database_object", stringValue(signal.databaseObjectName), signalRef);
      addCoverageValue(values, "database_object", stringValue(metadata?.schemaObject), signalRef);
    }
  }

  return values;
}

function requestedValues(input: ContextPacketToolInput, intent: ContextPacketIntent): Record<ContextPacketRequestCoverageKind, string[]> {
  return {
    file: uniqueStrings([
      ...(input.focusFiles ?? []),
      ...(input.changedFiles ?? []),
      ...intent.entities.files,
    ].map(normalizePath)),
    symbol: uniqueStrings([
      ...(input.focusSymbols ?? []),
      ...intent.entities.symbols,
    ]),
    route: uniqueStrings([
      ...(input.focusRoutes ?? []),
      ...intent.entities.routes,
    ]),
    database_object: uniqueStrings([
      ...(input.focusDatabaseObjects ?? []),
      ...intent.entities.databaseObjects,
    ]),
    quoted_text: uniqueStrings(intent.entities.quotedText),
  };
}

function valueMatches(
  kind: ContextPacketRequestCoverageKind,
  requested: string,
  covered: string,
): boolean {
  const normalizedRequested = normalizeCoverageValue(kind, requested);
  if (!normalizedRequested) return false;
  if (covered === normalizedRequested) return true;

  if (kind === "route") {
    return covered.includes(normalizedRequested) || normalizedRequested.includes(covered);
  }
  if (kind === "database_object") {
    return covered.endsWith(`.${normalizedRequested}`) || normalizedRequested.endsWith(`.${covered}`);
  }
  return false;
}

function matchedRefs(
  kind: ContextPacketRequestCoverageKind,
  requested: string,
  coveredValues: CoverageValues,
): string[] {
  const refs = new Set<string>();
  for (const [covered, matchedBy] of coveredValues[kind]) {
    if (!valueMatches(kind, requested, covered)) continue;
    for (const ref of matchedBy) refs.add(ref);
  }
  return [...refs].slice(0, 6);
}

function liveTextMissed(
  value: string,
  liveTextMisses: readonly ContextPacketLiveTextMiss[],
): boolean {
  return liveTextMisses.some((miss) => miss.query.toLowerCase() === value.toLowerCase());
}

function itemReason(item: Pick<ContextPacketRequestCoverageItem, "kind" | "value" | "status">): string {
  if (item.status === "covered") {
    return `Requested ${item.kind} "${item.value}" is represented in returned context.`;
  }
  if (item.status === "not_checked") {
    return `Requested quoted text "${item.value}" was not checked by the live text provider.`;
  }
  return `Requested ${item.kind} "${item.value}" was not represented in returned context.`;
}

function coverageItems(args: {
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
  coveredValues: CoverageValues;
  liveTextMisses: readonly ContextPacketLiveTextMiss[];
  liveTextRan: boolean;
}): ContextPacketRequestCoverageItem[] {
  const requested = requestedValues(args.input, args.intent);
  const items: ContextPacketRequestCoverageItem[] = [];

  for (const kind of COVERAGE_KINDS) {
    for (const value of requested[kind]) {
      const matchedBy = matchedRefs(kind, value, args.coveredValues);
      const status = matchedBy.length > 0
        ? "covered"
        : kind === "quoted_text" && !args.liveTextRan && !liveTextMissed(value, args.liveTextMisses)
          ? "not_checked"
          : "uncovered";
      items.push({
        kind,
        value,
        status,
        matchedBy,
        reason: itemReason({ kind, value, status }),
      });
    }
  }

  return items;
}

function kindSummary(
  items: readonly ContextPacketRequestCoverageItem[],
  kind: ContextPacketRequestCoverageKind,
): ContextPacketRequestCoverageKindSummary {
  const scoped = items.filter((item) => item.kind === kind);
  return {
    requested: scoped.length,
    covered: scoped.filter((item) => item.status === "covered").length,
    uncovered: scoped.filter((item) => item.status === "uncovered").length,
    notChecked: scoped.filter((item) => item.status === "not_checked").length,
  };
}

function coverageStatus(args: {
  requestedCount: number;
  coveredCount: number;
  unresolvedCount: number;
}): ContextPacketRequestCoverageStatus {
  if (args.requestedCount === 0) return "not_requested";
  if (args.coveredCount === args.requestedCount) return "complete";
  if (args.coveredCount === 0 && args.unresolvedCount > 0) return "missing";
  return "partial";
}

function recommendations(items: readonly ContextPacketRequestCoverageItem[]): string[] {
  const unresolvedKinds = new Set(items
    .filter((item) => item.status !== "covered")
    .map((item) => item.kind));
  const out: string[] = [];
  if (unresolvedKinds.has("file")) {
    out.push("Verify missing file anchors with live_text_search or project_index_status before assuming the file does not exist.");
  }
  if (unresolvedKinds.has("symbol")) {
    out.push("Use reef_where_used or cross_search for unresolved symbols before editing callers.");
  }
  if (unresolvedKinds.has("route")) {
    out.push("Use route_context or route_trace for unresolved routes before relying on route-level conclusions.");
  }
  if (unresolvedKinds.has("database_object")) {
    out.push("Use schema_usage, table_neighborhood, or db_reef_refresh for unresolved database objects.");
  }
  if (items.some((item) => item.kind === "quoted_text" && item.status === "not_checked")) {
    out.push("Enable live hints or run live_text_search to verify quoted literals against the current filesystem.");
  }
  if (items.some((item) => item.kind === "quoted_text" && item.status === "uncovered")) {
    out.push("Broaden live_text_search when quoted literals are not found in scoped current files.");
  }
  return out;
}

export function buildContextPacketRequestCoverage(args: {
  input: ContextPacketToolInput;
  intent: ContextPacketIntent;
  candidates: readonly ContextPacketReadableCandidate[];
  liveTextMisses: readonly ContextPacketLiveTextMiss[];
  liveTextRan: boolean;
}): ContextPacketRequestCoverage {
  const items = coverageItems({
    input: args.input,
    intent: args.intent,
    coveredValues: collectCoveredValues(args.candidates),
    liveTextMisses: args.liveTextMisses,
    liveTextRan: args.liveTextRan,
  });
  const coveredCount = items.filter((item) => item.status === "covered").length;
  const uncoveredCount = items.filter((item) => item.status === "uncovered").length;
  const notCheckedCount = items.filter((item) => item.status === "not_checked").length;
  const requestedCount = items.length;

  return {
    status: coverageStatus({
      requestedCount,
      coveredCount,
      unresolvedCount: uncoveredCount + notCheckedCount,
    }),
    requestedCount,
    coveredCount,
    uncoveredCount,
    notCheckedCount,
    byKind: {
      file: kindSummary(items, "file"),
      symbol: kindSummary(items, "symbol"),
      route: kindSummary(items, "route"),
      database_object: kindSummary(items, "database_object"),
      quoted_text: kindSummary(items, "quoted_text"),
    },
    items,
    recommendations: recommendations(items),
  };
}
