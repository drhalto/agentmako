import type {
  AnswerComparisonChange,
  AnswerTrustFacet,
  AnswerTrustReasonCode,
  AnswerResult,
  EvidenceBlock,
  WorkflowContextItemKind,
  WorkflowComparisonContextItem,
  WorkflowContextBundle,
  WorkflowContextItem,
  WorkflowDiagnosticContextItem,
  WorkflowFileContextItem,
  WorkflowPacketInput,
  WorkflowPacketRequest,
  WorkflowReferencePrecedentContextItem,
  WorkflowReferencePrecedentInput,
  WorkflowRouteContextItem,
  WorkflowRpcContextItem,
  WorkflowSymbolContextItem,
  WorkflowTableContextItem,
  WorkflowTrustEvaluationContextItem,
} from "@mako-ai/contracts";
import { normalizeStringArray } from "../workflow-packets/common.js";

type ItemRole = "primary" | "supporting";

const KIND_ORDER: Readonly<Record<WorkflowContextItem["kind"], number>> = Object.freeze({
  answer_packet: 1,
  file: 2,
  symbol: 3,
  route: 4,
  rpc: 5,
  table: 6,
  reference_precedent: 7,
  diagnostic: 8,
  trust_evaluation: 9,
  comparison: 10,
});

function normalizeTypedArray<T extends string>(values: Array<T | null | undefined>): T[] {
  return [...new Set(values.filter((value): value is T => typeof value === "string" && value.trim().length > 0))].sort(
    (left, right) => left.localeCompare(right),
  ) as T[];
}

function compareItems(left: WorkflowContextItem, right: WorkflowContextItem): number {
  if (left.kind !== right.kind) {
    return KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  }
  return left.itemId.localeCompare(right.itemId);
}

function isUnsetValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
}

function mergeDataObjects<T extends Record<string, unknown>>(existing: T, incoming: T): T {
  const merged: Record<string, unknown> = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (isUnsetValue(merged[key]) && !isUnsetValue(incoming[key])) {
      merged[key] = incoming[key];
    }
  }
  return merged as T;
}

function mergeContextItem(existing: WorkflowContextItem, incoming: WorkflowContextItem): WorkflowContextItem {
  const mergedData =
    existing.kind === incoming.kind
      ? mergeDataObjects(
          existing.data as unknown as Record<string, unknown>,
          incoming.data as unknown as Record<string, unknown>,
        )
      : existing.data;
  return {
    ...existing,
    sourceRefs: normalizeStringArray([...existing.sourceRefs, ...incoming.sourceRefs]),
    summary: isUnsetValue(existing.summary) ? incoming.summary : existing.summary,
    metadata: existing.metadata ?? incoming.metadata,
    data: mergedData,
  } as WorkflowContextItem;
}

function addItem(
  items: Map<string, WorkflowContextItem>,
  primaryIds: Set<string>,
  supportingIds: Set<string>,
  item: WorkflowContextItem,
  role: ItemRole,
): void {
  const existing = items.get(item.itemId);
  if (existing) {
    items.set(item.itemId, mergeContextItem(existing, item));
  } else {
    items.set(item.itemId, item);
  }
  if (role === "primary") {
    primaryIds.add(item.itemId);
    supportingIds.delete(item.itemId);
    return;
  }
  if (!primaryIds.has(item.itemId)) {
    supportingIds.add(item.itemId);
  }
}

function normalizeFilePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function referencePrecedentItem(
  projectId: string,
  queryId: string,
  reference: WorkflowReferencePrecedentInput,
): WorkflowReferencePrecedentContextItem {
  const normalizedPath = normalizeFilePath(reference.path);
  return {
    itemId: `reference:${reference.repoName}:${normalizedPath}:${reference.startLine}-${reference.endLine}:${reference.searchKind}`,
    kind: "reference_precedent",
    title: `${reference.repoName}/${normalizedPath}:${reference.startLine}-${reference.endLine}`,
    summary: reference.excerpt,
    projectId,
    queryId,
    source: "reference_repo",
    sourceRefs: [`${reference.repoName}/${normalizedPath}:${reference.startLine}-${reference.endLine}`],
    data: {
      repoName: reference.repoName,
      path: normalizedPath,
      startLine: reference.startLine,
      endLine: reference.endLine,
      excerpt: reference.excerpt,
      searchKind: reference.searchKind,
      score: reference.score ?? null,
      vecRank: reference.vecRank ?? null,
      ftsRank: reference.ftsRank ?? null,
    },
  };
}

function parseSymbolName(title: string): string {
  const match = /^\S+\s+(.+)$/.exec(title.trim());
  return match?.[1]?.trim() || title.trim();
}

function parseRouteContent(content: string): { method: string | null; pattern: string } {
  const match = /^([A-Z]+)\s+(.+)$/.exec(content.trim());
  if (!match) {
    return {
      method: null,
      pattern: content.trim(),
    };
  }
  return {
    method: match[1] ?? null,
    pattern: match[2] ?? content.trim(),
  };
}

function parseRouteTitle(title: string): { pattern: string; handlerName: string | null } {
  const [pattern, handlerName] = title.split("→").map((part) => part.trim());
  return {
    pattern: pattern || title.trim(),
    handlerName: handlerName || null,
  };
}

function buildRouteKey(method: string | null, pattern: string): string {
  const normalizedPattern = pattern.trim();
  return method ? `${method.trim().toUpperCase()} ${normalizedPattern}` : normalizedPattern;
}

function looksLikeFileRef(value: string): boolean {
  if (/^(schema|rpc|route|trace):/i.test(value)) {
    return false;
  }
  return /[\\/]/.test(value) || /\.[A-Za-z0-9]+(?::\d+)?$/.test(value);
}

function parseSourceRefLine(value: string): { ref: string; line: number | null } {
  const match = /^(.*):(\d+)$/.exec(value);
  if (!match) {
    return { ref: value, line: null };
  }
  const line = Number(match[2]);
  return {
    ref: match[1] ?? value,
    line: Number.isFinite(line) ? line : null,
  };
}

function normalizeComparisonChanges(changes: AnswerComparisonChange[]): AnswerComparisonChange[] {
  return [...changes].sort((left, right) =>
    left.code === right.code ? left.detail.localeCompare(right.detail) : left.code.localeCompare(right.code),
  );
}

function answerPacketItem(result: AnswerResult): WorkflowContextItem {
  return {
    itemId: `answer:${result.queryId}`,
    kind: "answer_packet",
    title: `${result.queryKind} answer`,
    summary: result.answer,
    projectId: result.projectId,
    queryId: result.queryId,
    source: "answer_result",
    sourceRefs: [result.packet.queryText],
    data: {
      queryKind: result.queryKind,
      queryText: result.packet.queryText,
      supportLevel: result.supportLevel,
      evidenceStatus: result.evidenceStatus,
      evidenceConfidence: result.packet.evidenceConfidence,
      answerConfidence: result.answerConfidence ?? null,
      stalenessFlags: normalizeStringArray(result.packet.stalenessFlags),
      candidateActionIds: normalizeStringArray(result.candidateActions.map((action) => action.actionId)),
      rankingDeEmphasized: result.ranking?.deEmphasized ?? null,
      rankingReasonCodes: normalizeStringArray(result.ranking?.reasons.map((reason) => reason.code) ?? []),
    },
  };
}

function trustEvaluationItem(result: AnswerResult): WorkflowTrustEvaluationContextItem | null {
  if (!result.trust) {
    return null;
  }
  return {
    itemId: `trust:${result.queryId}`,
    kind: "trust_evaluation",
    title: `trust ${result.trust.state}`,
    summary: result.trust.reasons[0]?.detail,
    projectId: result.projectId,
    queryId: result.queryId,
    source: "trust",
    sourceRefs: normalizeStringArray([
      result.trust.comparisonId,
      result.trust.clusterId,
      ...result.trust.basisTraceIds,
    ]),
    data: {
      state: result.trust.state,
      reasonCodes: normalizeTypedArray<AnswerTrustReasonCode>(
        result.trust.reasons.map((reason) => reason.code),
      ),
      scopeRelation: result.trust.scopeRelation,
      basisTraceIds: normalizeStringArray(result.trust.basisTraceIds),
      conflictingFacets: normalizeTypedArray<AnswerTrustFacet>(result.trust.conflictingFacets),
      comparisonId: result.trust.comparisonId ?? null,
      clusterId: result.trust.clusterId ?? null,
    },
  };
}

function comparisonItem(result: AnswerResult): WorkflowComparisonContextItem | null {
  if (!result.trust || (result.trust.comparisonSummary.length === 0 && !result.trust.comparisonId)) {
    return null;
  }
  return {
    itemId: `comparison:${result.trust.comparisonId ?? result.queryId}`,
    kind: "comparison",
    title: result.trust.comparisonId ? `comparison ${result.trust.comparisonId}` : "comparison summary",
    summary: result.trust.comparisonSummary[0]?.detail,
    projectId: result.projectId,
    queryId: result.queryId,
    source: "comparison",
    sourceRefs: normalizeStringArray([result.trust.comparisonId]),
    data: {
      comparisonId: result.trust.comparisonId ?? null,
      summaryChanges: normalizeComparisonChanges(result.trust.comparisonSummary),
    },
  };
}

function diagnosticItems(result: AnswerResult): WorkflowDiagnosticContextItem[] {
  return (result.diagnostics ?? []).map((diagnostic) => ({
    itemId: `diagnostic:${diagnostic.identity.matchBasedId}`,
    kind: "diagnostic",
    title: diagnostic.code,
    summary: diagnostic.message,
    projectId: result.projectId,
    queryId: result.queryId,
    source: "diagnostic",
    sourceRefs: normalizeStringArray(diagnostic.evidenceRefs),
    data: {
      code: diagnostic.code,
      category: diagnostic.category,
      severity: diagnostic.severity,
      confidence: diagnostic.confidence,
      path: diagnostic.path ?? null,
      producerPath: diagnostic.producerPath ?? null,
      consumerPath: diagnostic.consumerPath ?? null,
      line: diagnostic.line ?? null,
    },
  }));
}

function fileItemFromEvidence(result: AnswerResult, block: EvidenceBlock): WorkflowFileContextItem | null {
  const explicitPath =
    typeof block.filePath === "string" && block.filePath.trim().length > 0 ? block.filePath : null;
  const fallbackPath =
    explicitPath == null && block.kind === "file" && looksLikeFileRef(block.sourceRef)
      ? parseSourceRefLine(block.sourceRef).ref
      : null;
  const filePath = explicitPath ?? fallbackPath;
  if (!filePath) {
    return null;
  }
  const parsed = parseSourceRefLine(block.sourceRef);
  const normalizedPath = normalizeFilePath(filePath);
  return {
    itemId: `file:${normalizedPath}`,
    kind: "file",
    title: normalizedPath,
    summary: block.title === normalizedPath ? undefined : block.title,
    projectId: result.projectId,
    queryId: result.queryId,
    source: "evidence",
    sourceRefs: normalizeStringArray([block.sourceRef]),
    data: {
      filePath: normalizedPath,
      line: block.line ?? parsed.line,
    },
  };
}

function symbolItemFromEvidence(result: AnswerResult, block: EvidenceBlock): WorkflowSymbolContextItem | null {
  if (block.kind !== "symbol") {
    return null;
  }
  const filePath = typeof block.filePath === "string" ? normalizeFilePath(block.filePath) : null;
  const exportName =
    block.metadata && typeof block.metadata.exportName === "string" ? block.metadata.exportName : null;
  const symbolName = exportName ?? parseSymbolName(block.title);
  return {
    itemId: `symbol:${filePath ?? "unknown"}:${symbolName}:${block.line ?? 0}`,
    kind: "symbol",
    title: symbolName,
    summary: block.content,
    projectId: result.projectId,
    queryId: result.queryId,
    source: "evidence",
    sourceRefs: normalizeStringArray([block.sourceRef]),
    data: {
      symbolName,
      filePath,
      line: block.line ?? null,
      exportName,
    },
  };
}

function routeItemFromEvidence(result: AnswerResult, block: EvidenceBlock): WorkflowRouteContextItem | null {
  if (block.kind !== "route") {
    return null;
  }
  const fromContent = parseRouteContent(block.content);
  const fromTitle = parseRouteTitle(block.title);
  const pattern = fromContent.pattern || fromTitle.pattern;
  const routeKey = buildRouteKey(fromContent.method, pattern);
  const isApi =
    block.metadata && typeof block.metadata.isApi === "boolean" ? block.metadata.isApi : null;
  return {
    itemId: `route:${routeKey}`,
    kind: "route",
    title: pattern,
    summary: block.title,
    projectId: result.projectId,
    queryId: result.queryId,
    source: "evidence",
    sourceRefs: normalizeStringArray([block.sourceRef]),
    data: {
      routeKey,
      pattern,
      method: fromContent.method,
      filePath: typeof block.filePath === "string" ? normalizeFilePath(block.filePath) : null,
      handlerName: fromTitle.handlerName,
      isApi,
    },
  };
}

function tableItem(
  result: AnswerResult,
  sourceRef: string,
  schemaName: string | null,
  tableName: string,
): WorkflowTableContextItem {
  return {
    itemId: `table:${schemaName ?? "default"}.${tableName}`,
    kind: "table",
    title: schemaName ? `${schemaName}.${tableName}` : tableName,
    projectId: result.projectId,
    queryId: result.queryId,
    source: "evidence",
    sourceRefs: normalizeStringArray([sourceRef]),
    data: {
      schemaName,
      tableName,
    },
  };
}

function rpcItem(
  result: AnswerResult,
  sourceRef: string,
  schemaName: string | null,
  rpcName: string,
  argTypes: string[],
): WorkflowRpcContextItem {
  return {
    itemId: `rpc:${schemaName ?? "default"}.${rpcName}(${argTypes.join(",")})`,
    kind: "rpc",
    title: schemaName ? `${schemaName}.${rpcName}` : rpcName,
    projectId: result.projectId,
    queryId: result.queryId,
    source: "evidence",
    sourceRefs: normalizeStringArray([sourceRef]),
    data: {
      schemaName,
      rpcName,
      argTypes: [...argTypes],
    },
  };
}

function schemaDerivedItems(result: AnswerResult, block: EvidenceBlock): WorkflowContextItem[] {
  const metadata = block.metadata ?? {};
  const items: WorkflowContextItem[] = [];
  const schemaName = typeof metadata.schemaName === "string" ? metadata.schemaName : null;
  const tableName = typeof metadata.tableName === "string" ? metadata.tableName : null;
  const targetSchema = typeof metadata.targetSchema === "string" ? metadata.targetSchema : null;
  const targetTable = typeof metadata.targetTable === "string" ? metadata.targetTable : null;
  const rpcName =
    typeof metadata.rpcName === "string"
      ? metadata.rpcName
      : typeof metadata.objectType === "string" && metadata.objectType === "rpc" && typeof metadata.objectName === "string"
        ? metadata.objectName
        : null;
  const argTypes = Array.isArray(metadata.argTypes)
    ? metadata.argTypes.filter((value): value is string => typeof value === "string")
    : [];

  if (rpcName) {
    items.push(rpcItem(result, block.sourceRef, schemaName, rpcName, argTypes));
  }
  if (tableName) {
    items.push(tableItem(result, block.sourceRef, schemaName, tableName));
  }
  if (targetTable) {
    items.push(tableItem(result, block.sourceRef, targetSchema, targetTable));
  }
  return items;
}

function evidenceItems(result: AnswerResult, block: EvidenceBlock): WorkflowContextItem[] {
  const items: WorkflowContextItem[] = [];

  const fileItem = fileItemFromEvidence(result, block);
  if (fileItem) {
    items.push(fileItem);
  }

  const symbolItem = symbolItemFromEvidence(result, block);
  if (symbolItem) {
    items.push(symbolItem);
  }

  const routeItem = routeItemFromEvidence(result, block);
  if (routeItem) {
    items.push(routeItem);
  }

  if (block.kind === "schema" || block.kind === "trace" || block.kind === "finding") {
    items.push(...schemaDerivedItems(result, block));
  }

  return items;
}

export function buildWorkflowContextBundle(result: AnswerResult): WorkflowContextBundle {
  const items = new Map<string, WorkflowContextItem>();
  const primaryIds = new Set<string>();
  const supportingIds = new Set<string>();

  addItem(items, primaryIds, supportingIds, answerPacketItem(result), "supporting");

  const trustItem = trustEvaluationItem(result);
  if (trustItem) {
    addItem(items, primaryIds, supportingIds, trustItem, "supporting");
  }

  const comparison = comparisonItem(result);
  if (comparison) {
    addItem(items, primaryIds, supportingIds, comparison, "supporting");
  }

  for (const diagnostic of diagnosticItems(result)) {
    addItem(items, primaryIds, supportingIds, diagnostic, "supporting");
  }

  for (const block of result.packet.evidence) {
    for (const item of evidenceItems(result, block)) {
      addItem(items, primaryIds, supportingIds, item, "primary");
    }
  }

  const sortedItems = [...items.values()].sort(compareItems);
  const knownIds = new Set(sortedItems.map((item) => item.itemId));
  const primaryItemIds = [...primaryIds].filter((itemId) => knownIds.has(itemId)).sort((left, right) => left.localeCompare(right));
  const supportingItemIds = [...supportingIds].filter((itemId) => knownIds.has(itemId)).sort((left, right) => left.localeCompare(right));

  return {
    queryId: result.queryId,
    projectId: result.projectId,
    items: sortedItems,
    primaryItemIds,
    supportingItemIds,
    openQuestions: normalizeStringArray(result.packet.missingInformation),
  };
}

function withReferencePrecedents(
  bundle: WorkflowContextBundle,
  references: readonly WorkflowReferencePrecedentInput[] | undefined,
): { bundle: WorkflowContextBundle; referenceItemIds: string[] } {
  if (!references || references.length === 0) {
    return { bundle, referenceItemIds: [] };
  }

  const items = new Map(bundle.items.map((item) => [item.itemId, item] as const));
  const primaryIds = new Set(bundle.primaryItemIds);
  const supportingIds = new Set(bundle.supportingItemIds);
  const referenceItemIds: string[] = [];

  for (const reference of references) {
    const item = referencePrecedentItem(bundle.projectId, bundle.queryId, reference);
    addItem(items, primaryIds, supportingIds, item, "supporting");
    referenceItemIds.push(item.itemId);
  }

  return {
    bundle: {
      ...bundle,
      items: [...items.values()].sort(compareItems),
      primaryItemIds: [...primaryIds].sort((left, right) => left.localeCompare(right)),
      supportingItemIds: [...supportingIds].sort((left, right) => left.localeCompare(right)),
    },
    referenceItemIds: normalizeStringArray(referenceItemIds),
  };
}

export function extractWorkflowContextItems(result: AnswerResult): WorkflowContextItem[] {
  return buildWorkflowContextBundle(result).items;
}

function isWorkflowContextBundle(value: AnswerResult | WorkflowContextBundle): value is WorkflowContextBundle {
  return Array.isArray((value as WorkflowContextBundle).items);
}

function normalizeFocusItemIds(
  bundle: WorkflowContextBundle,
  focusItemIds: readonly string[] | undefined,
  focusKinds: readonly WorkflowContextItemKind[] | undefined,
): Set<string> {
  const byId = new Map(bundle.items.map((item) => [item.itemId, item] as const));
  const focusSet = new Set<string>();

  for (const itemId of focusItemIds ?? []) {
    if (byId.has(itemId)) {
      focusSet.add(itemId);
    }
  }

  const focusKindSet = new Set(focusKinds ?? []);
  if (focusKindSet.size > 0) {
    for (const item of bundle.items) {
      if (focusKindSet.has(item.kind)) {
        focusSet.add(item.itemId);
      }
    }
  }

  return focusSet;
}

export function buildWorkflowPacketInput(
  source: AnswerResult | WorkflowContextBundle,
  request: WorkflowPacketRequest,
): WorkflowPacketInput {
  const baseBundle = isWorkflowContextBundle(source) ? source : buildWorkflowContextBundle(source);
  const { bundle, referenceItemIds } = withReferencePrecedents(baseBundle, request.referencePrecedents);
  const scope = request.scope ?? "all";
  const watchMode = request.watchMode ?? "off";

  const baseIds = new Set(scope === "primary" ? bundle.primaryItemIds : bundle.items.map((item) => item.itemId));
  for (const itemId of referenceItemIds) {
    baseIds.add(itemId);
  }
  const explicitFocusIds = normalizeFocusItemIds(bundle, request.focusItemIds, request.focusKinds);
  for (const itemId of explicitFocusIds) {
    baseIds.add(itemId);
  }

  const selectedItems = bundle.items.filter((item) => baseIds.has(item.itemId));
  const selectedIdSet = new Set(selectedItems.map((item) => item.itemId));
  const primaryItemIds = bundle.primaryItemIds.filter((itemId) => selectedIdSet.has(itemId));
  const supportingItemIds = bundle.supportingItemIds.filter((itemId) => selectedIdSet.has(itemId));
  const focusedItemIds =
    explicitFocusIds.size > 0
      ? selectedItems.filter((item) => explicitFocusIds.has(item.itemId)).map((item) => item.itemId)
      : primaryItemIds;

  return {
    family: request.family,
    queryId: bundle.queryId,
    projectId: bundle.projectId,
    scope,
    watchMode,
    selectedItems,
    selectedItemIds: selectedItems.map((item) => item.itemId),
    primaryItemIds,
    supportingItemIds,
    focusedItemIds,
    openQuestions: [...bundle.openQuestions],
  };
}
