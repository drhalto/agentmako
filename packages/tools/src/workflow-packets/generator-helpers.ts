import type {
  WorkflowAnswerPacketContextItem,
  WorkflowComparisonContextItem,
  WorkflowContextItem,
  WorkflowPacketCitation,
  WorkflowPacketInput,
  WorkflowTrustEvaluationContextItem,
} from "@mako-ai/contracts";
import { buildWorkflowPacketCitation } from "./index.js";

export type PacketItemKind = WorkflowContextItem["kind"];

export interface PacketBuildContext {
  packetId: string;
  input: WorkflowPacketInput;
  citations: Map<string, WorkflowPacketCitation>;
}

export function focusedItemIdSet(input: WorkflowPacketInput): Set<string> {
  return new Set(input.focusedItemIds);
}

export function primaryItemIdSet(input: WorkflowPacketInput): Set<string> {
  return new Set(input.primaryItemIds);
}

export function supportingItemIdSet(input: WorkflowPacketInput): Set<string> {
  return new Set(input.supportingItemIds);
}

export function getItemsByKind<TKind extends PacketItemKind>(
  input: WorkflowPacketInput,
  kind: TKind,
): Extract<WorkflowContextItem, { kind: TKind }>[] {
  return input.selectedItems.filter(
    (item): item is Extract<WorkflowContextItem, { kind: TKind }> => item.kind === kind,
  );
}

export function getAnswerPacketItem(
  input: WorkflowPacketInput,
): WorkflowAnswerPacketContextItem | null {
  return getItemsByKind(input, "answer_packet")[0] ?? null;
}

export function getTrustItem(
  input: WorkflowPacketInput,
): WorkflowTrustEvaluationContextItem | null {
  return getItemsByKind(input, "trust_evaluation")[0] ?? null;
}

export function getComparisonItem(
  input: WorkflowPacketInput,
): WorkflowComparisonContextItem | null {
  return getItemsByKind(input, "comparison")[0] ?? null;
}

export function rankItems<T extends WorkflowContextItem>(
  items: readonly T[],
  score: (item: T) => number,
): T[] {
  return [...items].sort((left, right) => {
    const delta = score(right) - score(left);
    if (delta !== 0) {
      return delta;
    }
    return left.itemId.localeCompare(right.itemId);
  });
}

export function normalizeSecondaryPrecedents(
  items: readonly WorkflowContextItem[],
): WorkflowContextItem[] {
  const seen = new Set<string>();
  const normalized: WorkflowContextItem[] = [];
  for (const item of items) {
    if (seen.has(item.itemId)) {
      continue;
    }
    seen.add(item.itemId);
    normalized.push(item);
    if (normalized.length >= 3) {
      break;
    }
  }
  return normalized;
}

export function reuseStrengthLabel(score: number): "safe" | "partial" | "weak" {
  if (score >= 60) {
    return "safe";
  }
  if (score >= 45) {
    return "partial";
  }
  return "weak";
}

function itemExcerpt(item: WorkflowContextItem): string | null {
  if (item.summary && item.summary.trim().length > 0) {
    return item.summary;
  }
  return item.title.trim().length > 0 ? item.title : null;
}

export function addCitation(
  context: PacketBuildContext,
  item: WorkflowContextItem,
  rationale: string,
): WorkflowPacketCitation {
  const key = `${item.itemId}|${rationale}`;
  const existing = context.citations.get(key);
  if (existing) {
    return existing;
  }
  const citation = buildWorkflowPacketCitation({
    packetId: context.packetId,
    item,
    excerpt: itemExcerpt(item),
    rationale,
  });
  context.citations.set(key, citation);
  return citation;
}

export function preferredTargetItem(input: WorkflowPacketInput): WorkflowContextItem | null {
  const focusedIds = focusedItemIdSet(input);
  const primaryIds = primaryItemIdSet(input);
  const fileItems = getItemsByKind(input, "file");
  const preferredFile =
    fileItems.find((item) => focusedIds.has(item.itemId)) ??
    fileItems.find((item) => primaryIds.has(item.itemId)) ??
    fileItems[0];
  if (preferredFile) {
    return preferredFile;
  }
  const focused =
    input.selectedItems.find((item) => focusedIds.has(item.itemId)) ??
    input.selectedItems.find((item) => primaryIds.has(item.itemId));
  return focused ?? null;
}

export function implementationBriefTitle(input: WorkflowPacketInput): string {
  const preferredTarget = preferredTargetItem(input);
  if (preferredTarget?.kind === "file") {
    return `Implementation Brief: ${preferredTarget.data.filePath}`;
  }
  return `Implementation Brief: ${preferredTarget?.title ?? input.queryId}`;
}

export function trustAssumptions(input: WorkflowPacketInput): string[] {
  const assumptions: string[] = [];
  const answerPacket = getAnswerPacketItem(input);
  if (!answerPacket) {
    return assumptions;
  }
  if (answerPacket.data.supportLevel !== "native") {
    assumptions.push(`Support level is ${answerPacket.data.supportLevel}.`);
  }
  if (answerPacket.data.evidenceStatus !== "complete") {
    assumptions.push("Selected context is based on partial evidence.");
  }
  return assumptions;
}

export function referencePrecedentAssumptions(input: WorkflowPacketInput): string[] {
  const referencePrecedents = getItemsByKind(input, "reference_precedent");
  if (referencePrecedents.length === 0) {
    return [];
  }
  return [
    "Reference repo precedents are advisory only and do not change local trust state.",
  ];
}

export function implementationBriefInvariantItems(input: WorkflowPacketInput): WorkflowContextItem[] {
  const primaryIds = primaryItemIdSet(input);
  const focusedIds = focusedItemIdSet(input);
  const candidates = input.selectedItems.filter((item) =>
    item.kind === "symbol" || item.kind === "rpc" || item.kind === "route" || item.kind === "table",
  );
  const score = (item: WorkflowContextItem): number => {
    let total = 0;
    if (focusedIds.has(item.itemId)) total += 25;
    if (!primaryIds.has(item.itemId)) total += 20;
    switch (item.kind) {
      case "symbol":
        total += 35;
        break;
      case "rpc":
        total += 30;
        break;
      case "route":
        total += 18;
        break;
      case "table":
        total += 14;
        break;
    }
    return total;
  };
  return rankItems(candidates, score).slice(0, 3);
}
