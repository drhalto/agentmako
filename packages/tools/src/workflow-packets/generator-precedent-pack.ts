import type {
  WorkflowContextItem,
  WorkflowPacketInput,
  WorkflowPrecedentPack,
} from "@mako-ai/contracts";
import {
  buildWorkflowPacketBasis,
  buildWorkflowPacketId,
  buildWorkflowPacketSection,
} from "./index.js";
import { normalizeStringArray } from "./common.js";
import {
  type PacketBuildContext,
  addCitation,
  focusedItemIdSet,
  getAnswerPacketItem,
  getItemsByKind,
  getTrustItem,
  normalizeSecondaryPrecedents,
  primaryItemIdSet,
  rankItems,
  referencePrecedentAssumptions,
  reuseStrengthLabel,
  supportingItemIdSet,
  trustAssumptions,
} from "./generator-helpers.js";

function precedentCandidateFilePath(item: WorkflowContextItem): string | null {
  switch (item.kind) {
    case "file":
      return item.data.filePath;
    case "symbol":
      return item.data.filePath;
    case "route":
      return item.data.filePath;
    default:
      return null;
  }
}

function scoreReferencePrecedentCandidate(
  item: Extract<WorkflowContextItem, { kind: "reference_precedent" }>,
): number {
  let total = 0;
  switch (item.data.searchKind) {
    case "ref_file":
      total += 55;
      break;
    case "ref_search":
      total += 40;
      break;
    case "ref_ask":
      total += 24;
      break;
  }
  if (typeof item.data.vecRank === "number") total += 4;
  if (typeof item.data.ftsRank === "number") total += 4;
  if (typeof item.data.score === "number" && Number.isFinite(item.data.score) && item.data.score > 0) {
    total += Math.min(12, Math.round(item.data.score * 100));
  }
  return total;
}

function scorePrecedentCandidate(
  item: WorkflowContextItem,
  input: WorkflowPacketInput,
  producerPaths: Set<string>,
): number {
  const focusedIds = focusedItemIdSet(input);
  const primaryIds = primaryItemIdSet(input);
  const supportingIds = supportingItemIdSet(input);
  let total = 0;

  if (focusedIds.has(item.itemId)) total += 18;
  if (supportingIds.has(item.itemId)) total += 12;
  if (primaryIds.has(item.itemId)) total -= 8;

  const candidatePath = precedentCandidateFilePath(item);
  if (candidatePath && producerPaths.has(candidatePath)) {
    total += 18;
  }

  switch (item.kind) {
    case "symbol":
      total += 50;
      break;
    case "rpc":
      total += 45;
      break;
    case "route":
      total += 38;
      break;
    case "table":
      total += 34;
      break;
    case "file":
      total += 18;
      break;
    default:
      total -= 100;
  }

  return total;
}

function formatPrecedentEntry(
  item: WorkflowContextItem,
  strength: "safe" | "partial" | "weak",
): string {
  switch (item.kind) {
    case "symbol":
      return `${strength === "safe" ? "Start from" : "Consider"} ${item.data.symbolName} as the nearest shared implementation precedent.`;
    case "rpc":
      return `${strength === "safe" ? "Prefer" : "Review"} RPC ${item.data.rpcName} before inventing a parallel query path.`;
    case "route":
      return `${strength === "safe" ? "Follow" : "Inspect"} ${item.data.routeKey} as an existing route precedent.`;
    case "table":
      return `${strength === "safe" ? "Reuse" : "Inspect"} ${item.title} as the existing data surface.`;
    case "file":
      return `${strength === "safe" ? "Start from" : "Inspect"} ${item.data.filePath} as a nearby implementation precedent.`;
    case "reference_precedent":
      return `${strength === "safe" ? "Start from" : "Inspect"} ${item.data.path}:${item.data.startLine}-${item.data.endLine} via reference repo: ${item.data.repoName} as an external precedent to verify locally before reuse.`;
    default:
      return `Inspect ${item.title} as a precedent candidate.`;
  }
}

export function buildPrecedentPack(
  input: WorkflowPacketInput,
): WorkflowPrecedentPack {
  const packetId = buildWorkflowPacketId(input, { family: "precedent_pack", version: 1 });
  const context: PacketBuildContext = {
    packetId,
    input,
    citations: new Map(),
  };
  const diagnostics = getItemsByKind(input, "diagnostic");
  const trustItem = getTrustItem(input);
  const answerPacket = getAnswerPacketItem(input);
  const referenceCandidates = getItemsByKind(input, "reference_precedent");
  const producerPaths = new Set(
    diagnostics
      .map((diagnostic) => diagnostic.data.producerPath)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  );
  const localCandidates = input.selectedItems.filter((item) =>
    item.kind === "symbol" || item.kind === "rpc" || item.kind === "route" || item.kind === "table" || item.kind === "file",
  );
  const rankedLocalCandidates = rankItems(localCandidates, (item) =>
    scorePrecedentCandidate(item, input, producerPaths),
  );
  const rankedReferenceCandidates = rankItems(referenceCandidates, (item) =>
    scoreReferencePrecedentCandidate(item),
  );
  const canonicalLocal = rankedLocalCandidates[0] ?? null;
  const canonicalLocalScore = canonicalLocal ? scorePrecedentCandidate(canonicalLocal, input, producerPaths) : null;
  const canonicalReference = rankedReferenceCandidates[0] ?? null;
  const useReferenceCanonical =
    canonicalReference != null &&
    (canonicalLocal == null || (canonicalLocalScore != null && reuseStrengthLabel(canonicalLocalScore) === "weak"));
  const canonical = useReferenceCanonical ? canonicalReference : canonicalLocal;
  const secondary = normalizeSecondaryPrecedents(
    useReferenceCanonical
      ? [...rankedLocalCandidates.slice(0, 2), ...rankedReferenceCandidates.slice(1, 3)]
      : [...rankedLocalCandidates.slice(1, 3), ...rankedReferenceCandidates.slice(0, 2)],
  );
  const referencePrecedentItemIds = normalizeStringArray(
    [canonical, ...secondary]
      .filter(
        (item): item is Extract<WorkflowContextItem, { kind: "reference_precedent" }> =>
          item?.kind === "reference_precedent",
      )
      .map((item) => item.itemId),
  );

  const summaryCitationIds = canonical
    ? [addCitation(context, canonical, "Canonical precedent to start from.").citationId]
    : [];
  const summaryText =
    canonical == null
      ? "No strong reusable precedent appears in the selected context."
      : canonical.kind === "reference_precedent"
        ? `No strong local precedent is present. Start from ${canonical.data.path}:${canonical.data.startLine}-${canonical.data.endLine} via reference repo: ${canonical.data.repoName}, then verify it against the local code before reuse.`
        : `Start from ${canonical.title}. It is the strongest reusable precedent in the current selected context.`;

  const summarySection = buildWorkflowPacketSection({
    packetId,
    kind: "summary",
    title: "Summary",
    entries: [
      {
        text: summaryText,
        citationIds: summaryCitationIds,
      },
    ],
  });

  const precedentsSection =
    (canonical ? [canonical, ...secondary] : []).length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "precedents",
          title: "Precedents",
          entries: [canonical, ...secondary].filter((item): item is WorkflowContextItem => item != null).map((item) => {
            const score =
              item.kind === "reference_precedent"
                ? scoreReferencePrecedentCandidate(item)
                : scorePrecedentCandidate(item, input, producerPaths);
            const strength = reuseStrengthLabel(score);
            return {
              text: `${formatPrecedentEntry(item, strength)} Reuse looks ${strength}.`,
              citationIds: [
                addCitation(
                  context,
                  item,
                  item.itemId === canonical?.itemId
                    ? "Canonical precedent to start from."
                    : "Secondary precedent that may still be useful.",
                ).citationId,
              ],
            };
          }),
        })
      : null;

  const gaps: Array<{ text: string; citationIds: string[] }> = [];
  if (!canonical || (canonicalLocalScore != null && reuseStrengthLabel(canonicalLocalScore) === "weak" && referenceCandidates.length === 0)) {
    gaps.push({
      text: "No strong reusable precedent is present in the selected context yet.",
      citationIds: canonical ? [addCitation(context, canonical, "Weak precedent that leaves a gap.").citationId] : [],
    });
  }
  if (referencePrecedentItemIds.length > 0) {
    gaps.push({
      text: "External reference precedents are advisory only; confirm the local project still supports the same pattern before reusing them.",
      citationIds: referencePrecedentItemIds
        .slice(0, 2)
        .map((itemId) => {
          const item = input.selectedItems.find((candidate) => candidate.itemId === itemId);
          return item
            ? addCitation(context, item, "External precedent that requires local confirmation.").citationId
            : "";
        })
        .filter((value) => value.length > 0),
    });
  }
  if (diagnostics.length > 0) {
    gaps.push({
      text: `Current diagnostics suggest the existing precedent is not being followed cleanly yet (${diagnostics
        .map((item) => item.data.code)
        .slice(0, 2)
        .join(", ")}).`,
      citationIds: diagnostics
        .slice(0, 2)
        .map((item) => addCitation(context, item, "Diagnostic that weakens reuse confidence.").citationId),
    });
  }
  if (trustItem && trustItem.data.state !== "stable") {
    gaps.push({
      text: `Trust state is ${trustItem.data.state}, so precedent guidance should be treated as provisional rather than final.`,
      citationIds: [addCitation(context, trustItem, "Trust caveat for precedent guidance.").citationId],
    });
  }
  const gapsSection =
    gaps.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "gaps",
          title: "Gaps And Caveats",
          entries: gaps.slice(0, 4),
        })
      : null;

  const assumptions = normalizeStringArray([
    ...trustAssumptions(input),
    ...referencePrecedentAssumptions(input),
    answerPacket?.data.queryKind === "trace_file"
      ? "Selected precedent candidates were derived from the current trace context."
      : "",
  ]);

  return {
    packetId,
    family: "precedent_pack",
    title: canonical
      ? `Precedent Pack: ${canonical.title}`
      : "Precedent Pack",
    queryId: input.queryId,
    projectId: input.projectId,
    basis: buildWorkflowPacketBasis(input),
    sections: [summarySection, precedentsSection, gapsSection].filter(
      (section): section is NonNullable<typeof section> => section != null,
    ),
    citations: [...context.citations.values()].sort((left, right) =>
      left.citationId.localeCompare(right.citationId),
    ),
    assumptions,
    openQuestions: [...input.openQuestions],
    payload: {
      summarySectionId: summarySection.sectionId,
      precedentsSectionId: precedentsSection?.sectionId ?? null,
      gapsSectionId: gapsSection?.sectionId ?? null,
      canonicalPrecedentItemIds: canonical ? [canonical.itemId] : [],
      secondaryPrecedentItemIds: secondary.map((item) => item.itemId),
      referencePrecedentItemIds,
    },
  };
}
