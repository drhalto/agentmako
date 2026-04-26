import type { WorkflowContextItem, WorkflowImplementationBriefPacket, WorkflowPacketInput } from "@mako-ai/contracts";
import { buildWorkflowPacketBasis, buildWorkflowPacketId, buildWorkflowPacketSection } from "./index.js";
import { normalizeStringArray } from "./common.js";
import {
  type PacketBuildContext,
  addCitation,
  getAnswerPacketItem,
  getComparisonItem,
  getItemsByKind,
  getTrustItem,
  implementationBriefInvariantItems,
  implementationBriefTitle,
  referencePrecedentAssumptions,
  trustAssumptions,
  rankItems,
  focusedItemIdSet,
  primaryItemIdSet,
} from "./generator-helpers.js";

function implementationBriefChangeItems(input: WorkflowPacketInput): WorkflowContextItem[] {
  const primaryIds = primaryItemIdSet(input);
  const focusedIds = focusedItemIdSet(input);
  const candidates = input.selectedItems.filter((item) =>
    item.kind === "file" || item.kind === "route" || item.kind === "rpc" || item.kind === "table",
  );
  const score = (item: WorkflowContextItem): number => {
    let total = 0;
    if (focusedIds.has(item.itemId)) total += 40;
    if (primaryIds.has(item.itemId)) total += 30;
    switch (item.kind) {
      case "file":
        total += 30;
        break;
      case "route":
        total += 24;
        break;
      case "rpc":
        total += 22;
        break;
      case "table":
        total += 18;
        break;
    }
    return total;
  };
  return rankItems(candidates, score).slice(0, 4);
}

export function buildImplementationBriefPacket(
  input: WorkflowPacketInput,
): WorkflowImplementationBriefPacket {
  const packetId = buildWorkflowPacketId(input, { family: "implementation_brief", version: 1 });
  const context: PacketBuildContext = {
    packetId,
    input,
    citations: new Map(),
  };
  const diagnostics = getItemsByKind(input, "diagnostic");
  const trustItem = getTrustItem(input);
  const comparisonItem = getComparisonItem(input);
  const answerPacket = getAnswerPacketItem(input);
  const referencePrecedents = getItemsByKind(input, "reference_precedent");
  const changeItems = implementationBriefChangeItems(input);
  const invariantItems = implementationBriefInvariantItems(input);

  const summaryParts: string[] = [];
  if (changeItems[0]?.kind === "file") {
    summaryParts.push(`Start in ${changeItems[0].data.filePath}.`);
  } else if (changeItems[0]) {
    summaryParts.push(`Start with ${changeItems[0].title}.`);
  }
  if (invariantItems[0]?.kind === "symbol") {
    summaryParts.push(`Preserve ${invariantItems[0].data.symbolName}.`);
  } else if (invariantItems[0]) {
    summaryParts.push(`Keep ${invariantItems[0].title} aligned while changing the target area.`);
  }
  if (diagnostics[0]) {
    summaryParts.push(`Address ${diagnostics[0].data.code} before widening the change.`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push("Use the selected context as the immediate change brief.");
  }

  const summaryCitationIds = normalizeStringArray([
    changeItems[0] ? addCitation(context, changeItems[0], "Primary change target.").citationId : "",
    invariantItems[0]
      ? addCitation(context, invariantItems[0], "Interface or precedent to preserve.").citationId
      : "",
    diagnostics[0]
      ? addCitation(context, diagnostics[0], "Current risk in the selected context.").citationId
      : "",
  ]);

  const summarySection = buildWorkflowPacketSection({
    packetId,
    kind: "summary",
    title: "Summary",
    entries: [
      {
        text: summaryParts.join(" "),
        citationIds: summaryCitationIds,
      },
    ],
  });

  const changeAreasSection =
    changeItems.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "change_areas",
          title: "Change Areas",
          entries: changeItems.map((item) => ({
            text:
              item.kind === "file"
                ? `Change ${item.data.filePath} first.`
                : item.kind === "route"
                  ? `Treat ${item.data.routeKey} as part of the immediate change surface.`
                  : item.kind === "rpc"
                    ? `If logic shifts, review RPC ${item.data.rpcName} before adding a parallel path.`
                    : `The ${item.title} surface moves with this change.`,
            citationIds: [addCitation(context, item, "Immediate change area.").citationId],
          })),
        })
      : null;

  const invariantsSection =
    invariantItems.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "invariants",
          title: "Invariants",
          entries: invariantItems.map((item) => ({
            text:
              item.kind === "symbol"
                ? `Preserve ${item.data.symbolName} as the canonical shared path.`
                : item.kind === "rpc"
                  ? `Keep RPC ${item.data.rpcName} aligned with the edited flow.`
                  : item.kind === "route"
                    ? `Do not drift away from ${item.data.routeKey}.`
                    : `Keep ${item.title} semantics intact while editing.`,
            citationIds: [addCitation(context, item, "Invariant or interface to preserve.").citationId],
          })),
        })
      : null;

  const risks: Array<{ text: string; citationIds: string[] }> = [];
  for (const diagnostic of diagnostics.slice(0, 3)) {
    risks.push({
      text: `Current diagnostic ${diagnostic.data.code} indicates a regression risk in ${diagnostic.data.path ?? diagnostic.title}.`,
      citationIds: [addCitation(context, diagnostic, "Current diagnostic risk.").citationId],
    });
  }
  if (trustItem && trustItem.data.state !== "stable") {
    risks.push({
      text: `Trust state is ${trustItem.data.state}, so treat the current answer as change-sensitive rather than settled.`,
      citationIds: [addCitation(context, trustItem, "Trust caveat that should affect the brief.").citationId],
    });
  }
  if (comparisonItem && comparisonItem.data.summaryChanges.length > 0) {
    risks.push({
      text: `Recent compare history changed on ${comparisonItem.data.summaryChanges
        .map((change) => change.code)
        .join(", ")}.`,
      citationIds: [addCitation(context, comparisonItem, "Recent comparison caveat.").citationId],
    });
  }
  for (const reference of referencePrecedents.slice(0, 2)) {
    risks.push({
      text: `External precedent ${reference.data.path}:${reference.data.startLine}-${reference.data.endLine} via reference repo: ${reference.data.repoName} is advisory only; verify it against the local project before reuse.`,
      citationIds: [addCitation(context, reference, "External reference precedent that should stay source-labeled.").citationId],
    });
  }
  const risksSection =
    risks.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "risks",
          title: "Risks",
          entries: risks.slice(0, 4),
        })
      : null;

  const verificationEntries: Array<{ text: string; citationIds: string[] }> = [];
  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics.slice(0, 2)) {
      verificationEntries.push({
        text: `Re-run and confirm ${diagnostic.data.code} is no longer present after the edit.`,
        citationIds: [addCitation(context, diagnostic, "Verification target based on current diagnostic.").citationId],
      });
    }
  }
  if (changeItems[0]) {
    verificationEntries.push({
      text: `Trace ${changeItems[0].title} again after the edit and confirm the same target still resolves cleanly.`,
      citationIds: [addCitation(context, changeItems[0], "Primary target to re-trace after changes.").citationId],
    });
  }
  if (answerPacket?.data.stalenessFlags.length) {
    verificationEntries.push({
      text: `Check the current result against staleness flags before treating the brief as done.`,
      citationIds: [addCitation(context, answerPacket, "Staleness caveat tied to the packet.").citationId],
    });
  }
  const verificationSection =
    verificationEntries.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "verification",
          title: "Acceptance And Verification",
          entries: verificationEntries.slice(0, 4),
        })
      : null;

  return {
    packetId,
    family: "implementation_brief",
    title: implementationBriefTitle(input),
    queryId: input.queryId,
    projectId: input.projectId,
    basis: buildWorkflowPacketBasis(input),
    sections: [
      summarySection,
      changeAreasSection,
      invariantsSection,
      risksSection,
      verificationSection,
    ].filter((section): section is NonNullable<typeof section> => section != null),
    citations: [...context.citations.values()].sort((left, right) =>
      left.citationId.localeCompare(right.citationId),
    ),
    assumptions: normalizeStringArray([
      ...trustAssumptions(input),
      ...referencePrecedentAssumptions(input),
    ]),
    openQuestions: [...input.openQuestions],
    payload: {
      summarySectionId: summarySection.sectionId,
      changeAreasSectionId: changeAreasSection?.sectionId ?? null,
      invariantsSectionId: invariantsSection?.sectionId ?? null,
      risksSectionId: risksSection?.sectionId ?? null,
      verificationSectionId: verificationSection?.sectionId ?? null,
    },
  };
}
