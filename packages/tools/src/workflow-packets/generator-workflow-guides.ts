import type {
  WorkflowComparisonContextItem,
  WorkflowContextItem,
  WorkflowDiagnosticContextItem,
  WorkflowImpactPacket,
  WorkflowPacketInput,
  WorkflowRecipePacket,
  WorkflowRecipeStep,
  WorkflowRecipeStepStatus,
  WorkflowTrustEvaluationContextItem,
  WorkflowVerificationPlanPacket,
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
  getComparisonItem,
  getItemsByKind,
  getTrustItem,
  implementationBriefInvariantItems,
  preferredTargetItem,
  primaryItemIdSet,
  rankItems,
  trustAssumptions,
} from "./generator-helpers.js";

function impactPacketTitle(input: WorkflowPacketInput): string {
  const preferredTarget = preferredTargetItem(input);
  if (preferredTarget?.kind === "file") {
    return `Impact Packet: ${preferredTarget.data.filePath}`;
  }
  return `Impact Packet: ${preferredTarget?.title ?? input.queryId}`;
}

function verificationPlanTitle(input: WorkflowPacketInput): string {
  const preferredTarget = preferredTargetItem(input);
  if (preferredTarget?.kind === "file") {
    return `Verification Plan: ${preferredTarget.data.filePath}`;
  }
  return `Verification Plan: ${preferredTarget?.title ?? input.queryId}`;
}

type WorkflowRecipeKind = "debug_fix" | "rerun_verify" | "review_verify";

function workflowRecipeKind(
  diagnostics: readonly WorkflowDiagnosticContextItem[],
  trustItem: WorkflowTrustEvaluationContextItem | null,
  comparisonItem: WorkflowComparisonContextItem | null,
): WorkflowRecipeKind {
  if (diagnostics.length > 0) {
    return "debug_fix";
  }
  if (comparisonItem || (trustItem && trustItem.data.state !== "stable")) {
    return "rerun_verify";
  }
  return "review_verify";
}

function workflowRecipeTitle(input: WorkflowPacketInput, recipeKind: WorkflowRecipeKind): string {
  const preferredTarget = preferredTargetItem(input);
  const targetLabel =
    preferredTarget?.kind === "file"
      ? preferredTarget.data.filePath
      : preferredTarget?.title ?? input.queryId;
  switch (recipeKind) {
    case "debug_fix":
      return `Workflow Recipe: Debug ${targetLabel}`;
    case "rerun_verify":
      return `Workflow Recipe: Rerun ${targetLabel}`;
    case "review_verify":
      return `Workflow Recipe: Review ${targetLabel}`;
  }
}

function recipeVerificationLines(
  values: readonly string[],
  fallback: string,
): string[] {
  const normalized = normalizeStringArray(values);
  return normalized.length > 0 ? normalized : [fallback];
}

function buildWorkflowRecipeStep(args: {
  packetId: string;
  index: number;
  title: string;
  status: WorkflowRecipeStepStatus;
  verification: readonly string[];
  stopConditions: readonly string[];
  rerunTriggers?: readonly string[];
}): WorkflowRecipeStep {
  return {
    stepId: `${args.packetId}:step:${args.index + 1}`,
    title: args.title,
    status: args.status,
    verification: normalizeStringArray(args.verification),
    stopConditions: normalizeStringArray(args.stopConditions),
    rerunTriggers: normalizeStringArray(args.rerunTriggers ?? []),
  };
}

function impactDirectItems(input: WorkflowPacketInput): WorkflowContextItem[] {
  const focusedIds = focusedItemIdSet(input);
  const primaryIds = primaryItemIdSet(input);
  const candidates = input.selectedItems.filter((item) =>
    item.kind === "file" ||
    item.kind === "symbol" ||
    item.kind === "route" ||
    item.kind === "rpc" ||
    item.kind === "table",
  );
  const score = (item: WorkflowContextItem): number => {
    let total = 0;
    if (focusedIds.has(item.itemId)) total += 40;
    if (primaryIds.has(item.itemId)) total += 30;
    switch (item.kind) {
      case "file":
        total += 30;
        break;
      case "symbol":
        total += 26;
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

function impactAdjacentItems(
  input: WorkflowPacketInput,
  excludedItemIds: ReadonlySet<string>,
): WorkflowContextItem[] {
  const supportingIds = new Set(input.supportingItemIds);
  const primaryIds = primaryItemIdSet(input);
  const candidates = input.selectedItems.filter(
    (item) =>
      !excludedItemIds.has(item.itemId) &&
      (item.kind === "symbol" ||
        item.kind === "rpc" ||
        item.kind === "route" ||
        item.kind === "table" ||
        item.kind === "file"),
  );
  const score = (item: WorkflowContextItem): number => {
    let total = 0;
    if (supportingIds.has(item.itemId)) total += 20;
    if (!primaryIds.has(item.itemId)) total += 12;
    switch (item.kind) {
      case "symbol":
        total += 32;
        break;
      case "rpc":
        total += 28;
        break;
      case "route":
        total += 24;
        break;
      case "table":
        total += 18;
        break;
      case "file":
        total += 12;
        break;
    }
    return total;
  };
  return rankItems(candidates, score).slice(0, 4);
}

function impactUncertainItems(
  input: WorkflowPacketInput,
  excludedItemIds: ReadonlySet<string>,
): WorkflowContextItem[] {
  const candidates = input.selectedItems.filter(
    (item) =>
      !excludedItemIds.has(item.itemId) &&
      (item.kind === "diagnostic" ||
        item.kind === "trust_evaluation" ||
        item.kind === "comparison"),
  );
  const score = (item: WorkflowContextItem): number => {
    switch (item.kind) {
      case "diagnostic":
        return 30;
      case "trust_evaluation":
        return 24;
      case "comparison":
        return 18;
      default:
        return 0;
    }
  };
  return rankItems(candidates, score).slice(0, 4);
}

function formatDirectImpactEntry(item: WorkflowContextItem): string {
  switch (item.kind) {
    case "file":
      return `Direct impact: ${item.data.filePath} is in the immediate edit path.`;
    case "symbol":
      return `Direct impact: ${item.data.symbolName} is the shared implementation seam touched by this change.`;
    case "route":
      return `Direct impact: ${item.data.routeKey} should stay aligned with the edited flow.`;
    case "rpc":
      return `Direct impact: RPC ${item.data.rpcName} moves if this behavior changes.`;
    case "table":
      return `Direct impact: ${item.title} is part of the touched data surface.`;
    default:
      return `Direct impact: ${item.title}.`;
  }
}

function formatAdjacentImpactEntry(item: WorkflowContextItem): string {
  switch (item.kind) {
    case "file":
      return `Adjacent impact: ${item.data.filePath} is a nearby file that may need follow-through updates.`;
    case "symbol":
      return `Adjacent impact: ${item.data.symbolName} is a nearby shared seam worth rechecking.`;
    case "route":
      return `Adjacent impact: ${item.data.routeKey} is a neighboring interface that can drift with this change.`;
    case "rpc":
      return `Adjacent impact: RPC ${item.data.rpcName} is a nearby contract to verify.`;
    case "table":
      return `Adjacent impact: ${item.title} is a related data surface to recheck.`;
    default:
      return `Adjacent impact: ${item.title}.`;
  }
}

function formatUncertainImpactEntry(item: WorkflowContextItem): string {
  switch (item.kind) {
    case "diagnostic":
      return `Uncertain impact: diagnostic ${item.data.code} suggests additional follow-through beyond the direct edit.`;
    case "trust_evaluation":
      return `Uncertain impact: trust state ${item.data.state} means nearby surfaces may need revalidation even if they are not edited directly.`;
    case "comparison":
      return `Uncertain impact: recent compare history changed on ${item.data.summaryChanges.map((change) => change.code).join(", ")}.`;
    default:
      return `Uncertain impact: ${item.title}.`;
  }
}

export function buildImpactPacket(
  input: WorkflowPacketInput,
): WorkflowImpactPacket {
  const packetId = buildWorkflowPacketId(input, { family: "impact_packet", version: 1 });
  const context: PacketBuildContext = {
    packetId,
    input,
    citations: new Map(),
  };
  const diagnostics = getItemsByKind(input, "diagnostic");
  const trustItem = getTrustItem(input);
  const comparisonItem = getComparisonItem(input);
  const answerPacket = getAnswerPacketItem(input);
  const directItems = impactDirectItems(input);
  const directItemIds = new Set(directItems.map((item) => item.itemId));
  const adjacentItems = impactAdjacentItems(input, directItemIds);
  const adjacentItemIds = new Set(adjacentItems.map((item) => item.itemId));
  const uncertainItems = impactUncertainItems(
    input,
    new Set([...directItemIds, ...adjacentItemIds]),
  );

  const summaryParts: string[] = [];
  if (directItems[0]) summaryParts.push(`The change starts with ${directItems[0].title}.`);
  if (adjacentItems[0]) summaryParts.push(`Nearest adjacent reach is ${adjacentItems[0].title}.`);
  if (uncertainItems[0]) {
    summaryParts.push(`Treat ${uncertainItems[0].title} as the main caveat while editing.`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push("Use the selected context to map direct, adjacent, and uncertain impact before editing.");
  }

  const summarySection = buildWorkflowPacketSection({
    packetId,
    kind: "summary",
    title: "Summary",
    entries: [
      {
        text: summaryParts.join(" "),
        citationIds: normalizeStringArray([
          directItems[0] ? addCitation(context, directItems[0], "Direct impact anchor.").citationId : "",
          adjacentItems[0] ? addCitation(context, adjacentItems[0], "Closest adjacent impact.").citationId : "",
          uncertainItems[0] ? addCitation(context, uncertainItems[0], "Primary impact caveat.").citationId : "",
        ]),
      },
    ],
  });

  const impactEntries = [
    ...directItems.map((item) => ({
      text: formatDirectImpactEntry(item),
      citationIds: [addCitation(context, item, "Direct impact surface.").citationId],
      metadata: { impactType: "direct" },
    })),
    ...adjacentItems.map((item) => ({
      text: formatAdjacentImpactEntry(item),
      citationIds: [addCitation(context, item, "Adjacent impact surface.").citationId],
      metadata: { impactType: "adjacent" },
    })),
    ...uncertainItems.map((item) => ({
      text: formatUncertainImpactEntry(item),
      citationIds: [addCitation(context, item, "Uncertain or caveated impact surface.").citationId],
      metadata: { impactType: "uncertain" },
    })),
  ];
  const impactSection =
    impactEntries.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "impact",
          title: "Impact Map",
          entries: impactEntries.slice(0, 10),
        })
      : null;

  const risks: Array<{ text: string; citationIds: string[] }> = [];
  for (const diagnostic of diagnostics.slice(0, 2)) {
    risks.push({
      text: `Diagnostic ${diagnostic.data.code} indicates that downstream behavior can already drift from the intended shared path.`,
      citationIds: [addCitation(context, diagnostic, "Diagnostic impact caveat.").citationId],
    });
  }
  if (trustItem && trustItem.data.state !== "stable") {
    risks.push({
      text: `Trust state is ${trustItem.data.state}, so treat the impact map as provisional until the edited flow is rerun.`,
      citationIds: [addCitation(context, trustItem, "Trust caveat affecting impact confidence.").citationId],
    });
  }
  if (comparisonItem && comparisonItem.data.summaryChanges.length > 0) {
    risks.push({
      text: `Recent compare history changed on ${comparisonItem.data.summaryChanges.map((change) => change.code).join(", ")}, so adjacent reach may still move.`,
      citationIds: [addCitation(context, comparisonItem, "Comparison caveat affecting impact confidence.").citationId],
    });
  }
  if (input.openQuestions[0] && answerPacket) {
    risks.push({
      text: `Open question still unresolved: ${input.openQuestions[0]}`,
      citationIds: [addCitation(context, answerPacket, "Open question that widens impact uncertainty.").citationId],
    });
  }
  const risksSection =
    risks.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "risks",
          title: "Risks And Caveats",
          entries: risks.slice(0, 4),
        })
      : null;

  return {
    packetId,
    family: "impact_packet",
    title: impactPacketTitle(input),
    queryId: input.queryId,
    projectId: input.projectId,
    basis: buildWorkflowPacketBasis(input),
    sections: [summarySection, impactSection, risksSection].filter(
      (section): section is NonNullable<typeof section> => section != null,
    ),
    citations: [...context.citations.values()].sort((left, right) =>
      left.citationId.localeCompare(right.citationId),
    ),
    assumptions: trustAssumptions(input),
    openQuestions: [...input.openQuestions],
    payload: {
      summarySectionId: summarySection.sectionId,
      impactSectionId: impactSection?.sectionId ?? null,
      risksSectionId: risksSection?.sectionId ?? null,
      directImpactItemIds: directItems.map((item) => item.itemId),
      adjacentImpactItemIds: adjacentItems.map((item) => item.itemId),
      uncertainImpactItemIds: uncertainItems.map((item) => item.itemId),
    },
  };
}

function verificationFocusItems(input: WorkflowPacketInput): WorkflowContextItem[] {
  const focusedIds = focusedItemIdSet(input);
  const primaryIds = primaryItemIdSet(input);
  const candidates = input.selectedItems.filter((item) =>
    item.kind === "file" ||
    item.kind === "symbol" ||
    item.kind === "route" ||
    item.kind === "rpc" ||
    item.kind === "table",
  );
  const score = (item: WorkflowContextItem): number => {
    let total = 0;
    if (focusedIds.has(item.itemId)) total += 30;
    if (primaryIds.has(item.itemId)) total += 20;
    switch (item.kind) {
      case "file":
        total += 24;
        break;
      case "symbol":
        total += 22;
        break;
      case "route":
        total += 18;
        break;
      case "rpc":
        total += 18;
        break;
      case "table":
        total += 14;
        break;
    }
    return total;
  };
  return rankItems(candidates, score).slice(0, 4);
}

export function buildVerificationPlanPacket(
  input: WorkflowPacketInput,
): WorkflowVerificationPlanPacket {
  const packetId = buildWorkflowPacketId(input, { family: "verification_plan", version: 1 });
  const context: PacketBuildContext = {
    packetId,
    input,
    citations: new Map(),
  };
  const diagnostics = getItemsByKind(input, "diagnostic");
  const trustItem = getTrustItem(input);
  const comparisonItem = getComparisonItem(input);
  const answerPacket = getAnswerPacketItem(input);
  const focusItems = verificationFocusItems(input);
  const invariantItems = implementationBriefInvariantItems(input);

  const summaryParts: string[] = [];
  if (diagnostics[0]) summaryParts.push(`Reproduce ${diagnostics[0].data.code} first.`);
  if (focusItems[0]) summaryParts.push(`Verify ${focusItems[0].title} after the edit.`);
  if (comparisonItem) summaryParts.push("Rerun compare before calling the work done.");
  if (summaryParts.length === 0) {
    summaryParts.push("Establish the current baseline, verify the focused surface, and record explicit done criteria.");
  }

  const summarySection = buildWorkflowPacketSection({
    packetId,
    kind: "summary",
    title: "Summary",
    entries: [
      {
        text: summaryParts.join(" "),
        citationIds: normalizeStringArray([
          diagnostics[0] ? addCitation(context, diagnostics[0], "Primary issue to reproduce first.").citationId : "",
          focusItems[0] ? addCitation(context, focusItems[0], "Primary verification target.").citationId : "",
          comparisonItem ? addCitation(context, comparisonItem, "Comparison history that should be rerun.").citationId : "",
        ]),
      },
    ],
  });

  const baselineEntries: Array<{ text: string; citationIds: string[]; metadata?: Record<string, string> }> = [];
  if (diagnostics[0]) {
    baselineEntries.push({
      text: `Confirm ${diagnostics[0].data.code} is reproducible before editing anything.`,
      citationIds: [addCitation(context, diagnostics[0], "Current diagnostic baseline.").citationId],
    });
  }
  if (trustItem) {
    baselineEntries.push({
      text: `Record the current trust state as ${trustItem.data.state} before changing behavior.`,
      citationIds: [addCitation(context, trustItem, "Current trust-state baseline.").citationId],
    });
  }
  if (comparisonItem) {
    baselineEntries.push({
      text: `Capture the latest compare summary (${comparisonItem.data.summaryChanges.map((change) => change.code).join(", ")}) so post-edit drift is measurable.`,
      citationIds: [addCitation(context, comparisonItem, "Current comparison baseline.").citationId],
    });
  }
  if (baselineEntries.length === 0 && answerPacket) {
    baselineEntries.push({
      text: `Capture the current ${answerPacket.data.queryKind} result before editing so you can verify the intended delta.`,
      citationIds: [addCitation(context, answerPacket, "Current packet baseline.").citationId],
    });
  }
  const baselineSection =
    baselineEntries.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "baseline",
          title: "Baseline And Current State",
          entries: baselineEntries.slice(0, 4).map((entry) => ({
            ...entry,
            metadata: { verificationKind: "baseline" },
          })),
        })
      : null;

  const verificationEntries: Array<{ text: string; citationIds: string[]; metadata?: Record<string, string> }> = [];
  if (focusItems[0]) {
    verificationEntries.push({
      text: `Re-trace ${focusItems[0].title} after the edit and confirm the intended target still resolves cleanly.`,
      citationIds: [addCitation(context, focusItems[0], "Primary verification target.").citationId],
      metadata: { verificationKind: "main_check" },
    });
  }
  for (const diagnostic of diagnostics.slice(0, 2)) {
    verificationEntries.push({
      text: `Confirm ${diagnostic.data.code} no longer appears after the change.`,
      citationIds: [addCitation(context, diagnostic, "Regression check tied to a current diagnostic.").citationId],
      metadata: { verificationKind: "regression_check" },
    });
  }
  for (const item of invariantItems.slice(0, 2)) {
    verificationEntries.push({
      text:
        item.kind === "symbol"
          ? `Check ${item.data.symbolName} still matches the edited flow.`
          : item.kind === "rpc"
            ? `Check RPC ${item.data.rpcName} still matches the edited flow.`
            : item.kind === "route"
              ? `Check ${item.data.routeKey} still matches the edited flow.`
              : `Check ${item.title} still matches the edited flow.`,
      citationIds: [addCitation(context, item, "Invariant or interface to re-check.").citationId],
      metadata: { verificationKind: "invariant_check" },
    });
  }
  if (input.openQuestions[0] && answerPacket) {
    verificationEntries.push({
      text: `Exercise the unresolved case: ${input.openQuestions[0]}`,
      citationIds: [addCitation(context, answerPacket, "Open question that should become an explicit check.").citationId],
      metadata: { verificationKind: "open_question" },
    });
  }
  const verificationSection =
    verificationEntries.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "verification",
          title: "Verification",
          entries: verificationEntries.slice(0, 5),
        })
      : null;

  const doneCriteriaEntries: Array<{ text: string; citationIds: string[]; metadata?: Record<string, string> }> = [];
  if (focusItems[0]) {
    doneCriteriaEntries.push({
      text: `${focusItems[0].title} resolves cleanly after the edit.`,
      citationIds: [addCitation(context, focusItems[0], "Focused target for done criteria.").citationId],
      metadata: { verificationKind: "done" },
    });
  }
  if (diagnostics[0]) {
    doneCriteriaEntries.push({
      text: "Current diagnostic findings are gone or intentionally explained.",
      citationIds: [addCitation(context, diagnostics[0], "Diagnostic gate for done criteria.").citationId],
      metadata: { verificationKind: "done" },
    });
  }
  if (invariantItems[0]) {
    doneCriteriaEntries.push({
      text: "Shared interfaces remain aligned with the edited flow.",
      citationIds: [addCitation(context, invariantItems[0], "Invariant gate for done criteria.").citationId],
      metadata: { verificationKind: "done" },
    });
  }
  if (input.openQuestions[0] && answerPacket) {
    doneCriteriaEntries.push({
      text: "Any remaining open question is either resolved or explicitly documented as follow-up work.",
      citationIds: [addCitation(context, answerPacket, "Open-question gate for done criteria.").citationId],
      metadata: { verificationKind: "done" },
    });
  }
  const doneCriteriaSection =
    doneCriteriaEntries.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "done_criteria",
          title: "Done Criteria",
          entries: doneCriteriaEntries.slice(0, 4),
        })
      : null;

  const rerunTriggerEntries: Array<{ text: string; citationIds: string[]; metadata?: Record<string, string> }> = [];
  if (comparisonItem) {
    rerunTriggerEntries.push({
      text: "Rerun and compare again if the evidence set, support level, or answer status changes after the edit.",
      citationIds: [addCitation(context, comparisonItem, "Comparison history that should trigger a rerun.").citationId],
      metadata: { verificationKind: "rerun_trigger" },
    });
  }
  if (trustItem && trustItem.data.state !== "stable") {
    rerunTriggerEntries.push({
      text: `Refresh trust state before calling the change done if the answer remains ${trustItem.data.state}.`,
      citationIds: [addCitation(context, trustItem, "Trust caveat that should trigger refresh.").citationId],
      metadata: { verificationKind: "rerun_trigger" },
    });
  }
  if (answerPacket?.data.stalenessFlags.length) {
    rerunTriggerEntries.push({
      text: "Refresh the verification plan if packet staleness flags remain after the edit.",
      citationIds: [addCitation(context, answerPacket, "Staleness caveat that should trigger refresh.").citationId],
      metadata: { verificationKind: "rerun_trigger" },
    });
  }
  if (input.openQuestions[0] && answerPacket) {
    rerunTriggerEntries.push({
      text: "Rerun after resolving the current open question so the verification plan reflects the new evidence.",
      citationIds: [addCitation(context, answerPacket, "Open question that should trigger a rerun.").citationId],
      metadata: { verificationKind: "rerun_trigger" },
    });
  }
  const rerunTriggerSection =
    rerunTriggerEntries.length > 0
      ? buildWorkflowPacketSection({
          packetId,
          kind: "rerun_triggers",
          title: "Rerun And Refresh Triggers",
          entries: rerunTriggerEntries.slice(0, 4),
        })
      : null;

  return {
    packetId,
    family: "verification_plan",
    title: verificationPlanTitle(input),
    queryId: input.queryId,
    projectId: input.projectId,
    basis: buildWorkflowPacketBasis(input),
    sections: [summarySection, baselineSection, verificationSection, doneCriteriaSection, rerunTriggerSection].filter(
      (section): section is NonNullable<typeof section> => section != null,
    ),
    citations: [...context.citations.values()].sort((left, right) =>
      left.citationId.localeCompare(right.citationId),
    ),
    assumptions: trustAssumptions(input),
    openQuestions: [...input.openQuestions],
    payload: {
      summarySectionId: summarySection.sectionId,
      baselineSectionId: baselineSection?.sectionId ?? null,
      verificationSectionId: verificationSection?.sectionId ?? null,
      doneCriteriaSectionId: doneCriteriaSection?.sectionId ?? null,
      rerunTriggerSectionId: rerunTriggerSection?.sectionId ?? null,
    },
  };
}

export function buildWorkflowRecipePacket(
  input: WorkflowPacketInput,
): WorkflowRecipePacket {
  const packetId = buildWorkflowPacketId(input, { family: "workflow_recipe", version: 1 });
  const context: PacketBuildContext = {
    packetId,
    input,
    citations: new Map(),
  };
  const diagnostics = getItemsByKind(input, "diagnostic");
  const trustItem = getTrustItem(input);
  const comparisonItem = getComparisonItem(input);
  const answerPacket = getAnswerPacketItem(input);
  const focusItems = verificationFocusItems(input);
  const directImpact = impactDirectItems(input);
  const invariantItems = implementationBriefInvariantItems(input);
  const recipeKind = workflowRecipeKind(diagnostics, trustItem, comparisonItem);

  const primaryTarget = focusItems[0] ?? preferredTargetItem(input);
  const summaryParts: string[] = [];
  switch (recipeKind) {
    case "debug_fix":
      summaryParts.push("Use a debug/fix loop: reproduce, edit, verify, then rerun.");
      break;
    case "rerun_verify":
      summaryParts.push("Use a rerun/verify loop: capture current state, recheck the target, then refresh trust.");
      break;
    case "review_verify":
      summaryParts.push("Use a review/verify loop: inspect the target, verify expected behavior, then close open questions.");
      break;
  }
  if (primaryTarget) {
    summaryParts.push(`Primary target is ${primaryTarget.title}.`);
  }
  if (diagnostics[0]) {
    summaryParts.push(`Current issue is ${diagnostics[0].data.code}.`);
  } else if (trustItem) {
    summaryParts.push(`Current trust state is ${trustItem.data.state}.`);
  }

  const summarySection = buildWorkflowPacketSection({
    packetId,
    kind: "summary",
    title: "Summary",
    entries: [
      {
        text: summaryParts.join(" "),
        citationIds: normalizeStringArray([
          primaryTarget ? addCitation(context, primaryTarget, "Primary workflow target.").citationId : "",
          diagnostics[0] ? addCitation(context, diagnostics[0], "Current issue driving the recipe.").citationId : "",
          trustItem ? addCitation(context, trustItem, "Current trust state shaping the recipe.").citationId : "",
        ]),
      },
    ],
  });

  const rerunTriggerTexts = normalizeStringArray([
    comparisonItem
      ? "Rerun compare if the evidence set, support level, or answer status changes."
      : "",
    trustItem && trustItem.data.state !== "stable"
      ? `Refresh trust state before closing the loop while the answer remains ${trustItem.data.state}.`
      : "",
    answerPacket?.data.stalenessFlags.length
      ? "Refresh the recipe if staleness flags remain after the change."
      : "",
    input.openQuestions[0]
      ? "Rerun after resolving the current open question so the latest evidence is reflected."
      : "",
  ]);

  const steps: WorkflowRecipeStep[] = [
    buildWorkflowRecipeStep({
      packetId,
      index: 0,
      title:
        recipeKind === "debug_fix"
          ? "Capture the current failure or drift"
          : recipeKind === "rerun_verify"
            ? "Capture the current state before changing anything"
            : "Inspect the current target and expected behavior",
      status: "in_progress",
      verification: recipeVerificationLines([
        diagnostics[0]
          ? `Confirm ${diagnostics[0].data.code} is observable before editing.`
          : "",
        trustItem
          ? `Record the current trust state as ${trustItem.data.state}.`
          : "",
        primaryTarget
          ? `Verify ${primaryTarget.title} resolves from the current context.`
          : "",
      ], "Capture one concrete baseline before editing."),
      stopConditions: normalizeStringArray([
        "You can describe the current state in concrete terms before editing.",
        diagnostics[0] ? "The current issue has been reproduced or otherwise confirmed." : "",
      ]),
      rerunTriggers: rerunTriggerTexts,
    }),
    buildWorkflowRecipeStep({
      packetId,
      index: 1,
      title:
        recipeKind === "review_verify"
          ? "Inspect the primary target and nearby precedent"
          : "Make the smallest targeted change",
      status: "todo",
      verification: recipeVerificationLines([
        primaryTarget
          ? `Keep the change anchored in ${primaryTarget.title}.`
          : "",
        directImpact[0]
          ? `Stay within the direct impact surface starting at ${directImpact[0].title}.`
          : "",
        invariantItems[0]
          ? `Preserve ${invariantItems[0].title} while editing.`
          : "",
      ], "State the next targeted change or inspection before proceeding."),
      stopConditions: normalizeStringArray([
        "The planned change stays inside the primary target or an explicitly adjacent surface.",
        "You are not inventing a parallel path without checking the existing precedent first.",
      ]),
      rerunTriggers: rerunTriggerTexts,
    }),
    buildWorkflowRecipeStep({
      packetId,
      index: 2,
      title: "Verify the focused path and regression-sensitive surfaces",
      status: "todo",
      verification: recipeVerificationLines([
        primaryTarget
          ? `Recheck ${primaryTarget.title} after the change.`
          : "",
        diagnostics[0]
          ? `Confirm ${diagnostics[0].data.code} no longer appears.`
          : "",
        invariantItems[0]
          ? `Confirm ${invariantItems[0].title} still matches the edited flow.`
          : "",
      ], "Run one focused verification pass after the change."),
      stopConditions: normalizeStringArray([
        "Focused verification passes.",
        "Regression-sensitive surfaces have been checked explicitly.",
      ]),
      rerunTriggers: rerunTriggerTexts,
    }),
    buildWorkflowRecipeStep({
      packetId,
      index: 3,
      title: "Exercise edge cases and unresolved questions",
      status: "todo",
      verification: recipeVerificationLines([
        input.openQuestions[0]
          ? `Exercise or document the unresolved case: ${input.openQuestions[0]}`
          : "Check at least one edge case beyond the main happy path.",
        answerPacket?.data.stalenessFlags.length
          ? "Confirm staleness-sensitive checks are still valid after the edit."
          : "",
      ], "Check at least one edge case beyond the main happy path."),
      stopConditions: normalizeStringArray([
        "Edge cases have been exercised or intentionally deferred with a note.",
        "Open questions are either resolved or explicitly documented as follow-up work.",
      ]),
      rerunTriggers: rerunTriggerTexts,
    }),
    buildWorkflowRecipeStep({
      packetId,
      index: 4,
      title:
        recipeKind === "review_verify"
          ? "Refresh the target state and decide whether to stop"
          : "Rerun compare, refresh trust, and decide whether to stop",
      status: "todo",
      verification: recipeVerificationLines([
        comparisonItem
          ? "Rerun compare and confirm the intended delta only."
          : "Refresh the primary target after the edit.",
        trustItem
          ? "Refresh trust state before calling the work done."
          : "",
      ], "Refresh the latest target state before deciding to stop."),
      stopConditions: normalizeStringArray([
        "The latest verification and trust signals are acceptable for this change.",
        "No remaining rerun trigger is unresolved.",
      ]),
      rerunTriggers: rerunTriggerTexts,
    }),
  ];

  const stepSection = buildWorkflowPacketSection({
    packetId,
    kind: "steps",
    title: "Steps",
    entries: steps.map((step, index) => ({
      text: `${index + 1}. ${step.title} (${step.status})`,
      citationIds: normalizeStringArray([
        index === 0 && primaryTarget ? addCitation(context, primaryTarget, "Primary workflow target.").citationId : "",
        index === 0 && diagnostics[0] ? addCitation(context, diagnostics[0], "Current issue driving the recipe.").citationId : "",
        index === 0 && trustItem ? addCitation(context, trustItem, "Current trust state shaping the recipe.").citationId : "",
        index > 0 && invariantItems[0] ? addCitation(context, invariantItems[0], "Invariant checked during the recipe.").citationId : "",
        index > 0 && comparisonItem ? addCitation(context, comparisonItem, "Comparison history that should be rerun.").citationId : "",
      ]),
      metadata: {
        stepId: step.stepId,
        status: step.status,
        verification: step.verification.join(" | "),
        stopConditions: step.stopConditions.join(" | "),
        rerunTriggers: step.rerunTriggers.join(" | "),
      },
    })),
  });

  return {
    packetId,
    family: "workflow_recipe",
    title: workflowRecipeTitle(input, recipeKind),
    queryId: input.queryId,
    projectId: input.projectId,
    basis: buildWorkflowPacketBasis(input),
    sections: [summarySection, stepSection],
    citations: [...context.citations.values()].sort((left, right) =>
      left.citationId.localeCompare(right.citationId),
    ),
    assumptions: trustAssumptions(input),
    openQuestions: [...input.openQuestions],
    payload: {
      summarySectionId: summarySection.sectionId,
      stepSectionId: stepSection.sectionId,
      steps,
    },
    metadata: {
      recipeKind,
    },
  };
}
