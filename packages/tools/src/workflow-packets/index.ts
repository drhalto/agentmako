import {
  WorkflowPacketSchema,
  type JsonObject,
  type WorkflowContextItem,
  type WorkflowPacket,
  type WorkflowPacketBasis,
  type WorkflowPacketCitation,
  type WorkflowPacketEntry,
  type WorkflowPacketFamily,
  type WorkflowPacketForFamily,
  type WorkflowPacketGenerator,
  type WorkflowPacketInput,
  type WorkflowRecipePacket,
  type WorkflowRecipeStep,
  type WorkflowPacketSection,
  type WorkflowPacketSectionKind,
} from "@mako-ai/contracts";
import { hashJson } from "@mako-ai/store";
import { normalizeStringArray } from "./common.js";

function buildPacketHashSeed(input: WorkflowPacketInput, discriminator?: unknown): unknown {
  return {
    family: input.family,
    queryId: input.queryId,
    projectId: input.projectId,
    scope: input.scope,
    watchMode: input.watchMode,
    selectedItemIds: [...input.selectedItemIds],
    focusedItemIds: [...input.focusedItemIds],
    discriminator: discriminator ?? null,
  };
}

export function buildWorkflowPacketId(
  input: WorkflowPacketInput,
  discriminator?: unknown,
): string {
  return `workflow_packet_${hashJson(buildPacketHashSeed(input, discriminator))}`;
}

export function buildWorkflowPacketBasis(
  input: WorkflowPacketInput,
): WorkflowPacketBasis {
  return {
    scope: input.scope,
    watchMode: input.watchMode,
    selectedItemIds: [...input.selectedItemIds],
    focusedItemIds: [...input.focusedItemIds],
    primaryItemIds: [...input.primaryItemIds],
    supportingItemIds: [...input.supportingItemIds],
  };
}

export function buildWorkflowPacketCitation(args: {
  packetId: string;
  item: Pick<WorkflowContextItem, "itemId" | "sourceRefs">;
  sourceRef?: string | null;
  excerpt?: string | null;
  rationale?: string | null;
}): WorkflowPacketCitation {
  const sourceRef =
    args.sourceRef && args.sourceRef.trim().length > 0
      ? args.sourceRef
      : args.item.sourceRefs[0] ?? null;
  const excerpt =
    args.excerpt && args.excerpt.trim().length > 0 ? args.excerpt : null;
  const rationale =
    args.rationale && args.rationale.trim().length > 0 ? args.rationale : null;

  return {
    citationId: `workflow_citation_${hashJson({
      packetId: args.packetId,
      itemId: args.item.itemId,
      sourceRef,
      excerpt,
      rationale,
    })}`,
    itemId: args.item.itemId,
    sourceRef,
    excerpt,
    rationale,
  };
}

export function buildWorkflowPacketSectionId(
  packetId: string,
  kind: WorkflowPacketSectionKind,
  title: string,
): string {
  return `workflow_section_${hashJson({ packetId, kind, title })}`;
}

export function buildWorkflowPacketEntry(args: {
  packetId: string;
  sectionId: string;
  text: string;
  citationIds?: readonly string[];
  metadata?: JsonObject;
}): WorkflowPacketEntry {
  const citationIds = normalizeStringArray(args.citationIds ?? []);
  return {
    entryId: `workflow_entry_${hashJson({
      packetId: args.packetId,
      sectionId: args.sectionId,
      text: args.text,
      citationIds,
    })}`,
    text: args.text,
    citationIds,
    metadata: args.metadata,
  };
}

export function buildWorkflowPacketSection(args: {
  packetId: string;
  kind: WorkflowPacketSectionKind;
  title: string;
  entries: ReadonlyArray<{
    text: string;
    citationIds?: readonly string[];
    metadata?: JsonObject;
  }>;
}): WorkflowPacketSection {
  const sectionId = buildWorkflowPacketSectionId(args.packetId, args.kind, args.title);
  return {
    sectionId,
    kind: args.kind,
    title: args.title,
    entries: args.entries.map((entry) =>
      buildWorkflowPacketEntry({
        packetId: args.packetId,
        sectionId,
        text: entry.text,
        citationIds: entry.citationIds,
        metadata: entry.metadata,
      }),
    ),
  };
}

function assertSectionIdsExist(
  packet: WorkflowPacket,
  sectionIds: Array<string | null | undefined>,
): void {
  const known = new Set(packet.sections.map((section) => section.sectionId));
  for (const sectionId of sectionIds) {
    if (sectionId && !known.has(sectionId)) {
      throw new Error(`Workflow packet ${packet.packetId} references unknown section ${sectionId}.`);
    }
  }
}

function assertItemIdsExist(
  packet: WorkflowPacket,
  itemIds: readonly string[],
  input: WorkflowPacketInput,
): void {
  const known = new Set(input.selectedItems.map((item) => item.itemId));
  for (const itemId of itemIds) {
    if (!known.has(itemId)) {
      throw new Error(`Workflow packet ${packet.packetId} references unknown item ${itemId}.`);
    }
  }
}

export function assertWorkflowPacketIntegrity(
  packet: WorkflowPacket,
  input: WorkflowPacketInput,
): WorkflowPacket {
  const parsed = WorkflowPacketSchema.parse(packet);
  if (parsed.family !== input.family) {
    throw new Error(
      `Workflow packet family mismatch: expected ${input.family}, received ${parsed.family}.`,
    );
  }
  if (parsed.queryId !== input.queryId || parsed.projectId !== input.projectId) {
    throw new Error(`Workflow packet ${parsed.packetId} does not match the input query/project.`);
  }
  if (hashJson(parsed.basis) !== hashJson(buildWorkflowPacketBasis(input))) {
    throw new Error(`Workflow packet ${parsed.packetId} does not match the input basis.`);
  }

  const citationIds = new Set<string>();
  for (const citation of parsed.citations) {
    if (citationIds.has(citation.citationId)) {
      throw new Error(`Workflow packet ${parsed.packetId} has duplicate citation ${citation.citationId}.`);
    }
    citationIds.add(citation.citationId);
  }

  const itemIds = new Set(input.selectedItems.map((item) => item.itemId));
  for (const citation of parsed.citations) {
    if (!itemIds.has(citation.itemId)) {
      throw new Error(
        `Workflow packet ${parsed.packetId} cites unknown item ${citation.itemId}.`,
      );
    }
  }

  const sectionIds = new Set<string>();
  const entryIds = new Set<string>();
  for (const section of parsed.sections) {
    if (sectionIds.has(section.sectionId)) {
      throw new Error(`Workflow packet ${parsed.packetId} has duplicate section ${section.sectionId}.`);
    }
    sectionIds.add(section.sectionId);
    for (const entry of section.entries) {
      if (entryIds.has(entry.entryId)) {
        throw new Error(`Workflow packet ${parsed.packetId} has duplicate entry ${entry.entryId}.`);
      }
      entryIds.add(entry.entryId);
      for (const citationId of entry.citationIds) {
        if (!citationIds.has(citationId)) {
          throw new Error(
            `Workflow packet ${parsed.packetId} entry ${entry.entryId} references unknown citation ${citationId}.`,
          );
        }
      }
    }
  }

  switch (parsed.family) {
    case "implementation_brief":
      assertSectionIdsExist(parsed, [
        parsed.payload.summarySectionId,
        parsed.payload.changeAreasSectionId,
        parsed.payload.invariantsSectionId,
        parsed.payload.risksSectionId,
        parsed.payload.verificationSectionId,
      ]);
      break;
    case "precedent_pack":
      assertSectionIdsExist(parsed, [
        parsed.payload.summarySectionId,
        parsed.payload.precedentsSectionId,
        parsed.payload.gapsSectionId,
      ]);
      assertItemIdsExist(parsed, parsed.payload.canonicalPrecedentItemIds, input);
      assertItemIdsExist(parsed, parsed.payload.secondaryPrecedentItemIds, input);
      assertItemIdsExist(parsed, parsed.payload.referencePrecedentItemIds, input);
      break;
    case "impact_packet":
      assertSectionIdsExist(parsed, [
        parsed.payload.summarySectionId,
        parsed.payload.impactSectionId,
        parsed.payload.risksSectionId,
      ]);
      assertItemIdsExist(parsed, parsed.payload.directImpactItemIds, input);
      assertItemIdsExist(parsed, parsed.payload.adjacentImpactItemIds, input);
      assertItemIdsExist(parsed, parsed.payload.uncertainImpactItemIds, input);
      break;
    case "verification_plan":
      assertSectionIdsExist(parsed, [
        parsed.payload.summarySectionId,
        parsed.payload.baselineSectionId,
        parsed.payload.verificationSectionId,
        parsed.payload.doneCriteriaSectionId,
        parsed.payload.rerunTriggerSectionId,
      ]);
      break;
    case "workflow_recipe":
      assertSectionIdsExist(parsed, [
        parsed.payload.summarySectionId,
        parsed.payload.stepSectionId,
      ]);
      if (parsed.payload.steps.length === 0) {
        throw new Error(`Workflow packet ${parsed.packetId} must contain at least one recipe step.`);
      }
      const stepIds = new Set<string>();
      let activeStepCount = 0;
      for (const step of parsed.payload.steps) {
        if (stepIds.has(step.stepId)) {
          throw new Error(`Workflow packet ${parsed.packetId} has duplicate recipe step ${step.stepId}.`);
        }
        stepIds.add(step.stepId);
        if (step.verification.length === 0) {
          throw new Error(
            `Workflow packet ${parsed.packetId} recipe step ${step.stepId} must include verification rules.`,
          );
        }
        if (step.stopConditions.length === 0) {
          throw new Error(
            `Workflow packet ${parsed.packetId} recipe step ${step.stepId} must include stop conditions.`,
          );
        }
        if (step.status === "in_progress") {
          activeStepCount += 1;
        }
      }
      if (activeStepCount !== 1) {
        throw new Error(
          `Workflow packet ${parsed.packetId} must have exactly one in_progress recipe step.`,
        );
      }
      break;
  }

  return parsed;
}

function formatEntry(entry: WorkflowPacketEntry): string {
  if (entry.citationIds.length === 0) {
    return `- ${entry.text}`;
  }
  return `- ${entry.text} [${entry.citationIds.join(", ")}]`;
}

function stepEntryCitationIds(
  section: WorkflowPacketSection,
  stepId: string,
): string[] {
  // `workflow_recipe` currently emits exactly one step entry per stepId in the
  // shared steps section. Keep the formatter aligned with that contract instead
  // of flattening multiple entries into one synthetic citation list.
  const entry = section.entries.find((candidate) => candidate.metadata?.stepId === stepId);
  return entry ? [...entry.citationIds] : [];
}

function formatWorkflowRecipeStep(
  step: WorkflowRecipeStep,
  index: number,
  citationIds: readonly string[],
): string[] {
  const header =
    citationIds.length === 0
      ? `- ${index + 1}. ${step.title} (${step.status})`
      : `- ${index + 1}. ${step.title} (${step.status}) [${citationIds.join(", ")}]`;
  const lines = [header];
  lines.push(...step.verification.map((value) => `  Verify: ${value}`));
  lines.push(...step.stopConditions.map((value) => `  Stop when: ${value}`));
  lines.push(...step.rerunTriggers.map((value) => `  Refresh when: ${value}`));
  return lines;
}

function formatWorkflowRecipeSection(
  packet: WorkflowRecipePacket,
  section: WorkflowPacketSection,
): string[] {
  const lines = [`## ${section.title}`];
  for (let index = 0; index < packet.payload.steps.length; index += 1) {
    const step = packet.payload.steps[index];
    lines.push(...formatWorkflowRecipeStep(step, index, stepEntryCitationIds(section, step.stepId)));
  }
  lines.push("");
  return lines;
}

function formatStringList(title: string, values: readonly string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  return [
    `## ${title}`,
    ...values.map((value) => `- ${value}`),
    "",
  ];
}

export function formatWorkflowPacket(packet: WorkflowPacket): string {
  const lines: string[] = [`# ${packet.title}`, ""];

  for (const section of packet.sections) {
    if (section.entries.length === 0) {
      continue;
    }
    if (packet.family === "workflow_recipe" && section.kind === "steps") {
      lines.push(...formatWorkflowRecipeSection(packet, section));
      continue;
    }
    lines.push(`## ${section.title}`);
    lines.push(...section.entries.map(formatEntry));
    lines.push("");
  }

  lines.push(...formatStringList("Assumptions", packet.assumptions));
  lines.push(...formatStringList("Open Questions", packet.openQuestions));

  if (packet.citations.length > 0) {
    lines.push("## Citations");
    for (const citation of [...packet.citations].sort((left, right) =>
      left.citationId.localeCompare(right.citationId),
    )) {
      const parts = [citation.itemId];
      if (citation.sourceRef) parts.push(citation.sourceRef);
      if (citation.rationale) parts.push(citation.rationale);
      lines.push(`- ${citation.citationId}: ${parts.join(" | ")}`);
    }
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
}

export class WorkflowPacketRegistry {
  private readonly generators = new Map<
    WorkflowPacketFamily,
    WorkflowPacketGenerator
  >();

  constructor(generators: readonly WorkflowPacketGenerator[] = []) {
    for (const generator of generators) {
      this.register(generator);
    }
  }

  register<TFamily extends WorkflowPacketFamily>(
    generator: WorkflowPacketGenerator<TFamily>,
  ): this {
    this.generators.set(generator.family, generator as WorkflowPacketGenerator);
    return this;
  }

  unregister(family: WorkflowPacketFamily): this {
    this.generators.delete(family);
    return this;
  }

  get<TFamily extends WorkflowPacketFamily>(
    family: TFamily,
  ): WorkflowPacketGenerator<TFamily> | undefined {
    return this.generators.get(family) as WorkflowPacketGenerator<TFamily> | undefined;
  }

  listFamilies(): WorkflowPacketFamily[] {
    return [...this.generators.keys()].sort((left, right) =>
      left.localeCompare(right),
    ) as WorkflowPacketFamily[];
  }

  async generate<TFamily extends WorkflowPacketFamily>(
    input: WorkflowPacketInput & { family: TFamily },
  ): Promise<WorkflowPacketForFamily<TFamily>> {
    const generator = this.get(input.family);
    if (!generator) {
      throw new Error(`No workflow packet generator registered for ${input.family}.`);
    }
    const packet = await generator.generate(input);
    return assertWorkflowPacketIntegrity(
      packet as WorkflowPacket,
      input,
    ) as WorkflowPacketForFamily<TFamily>;
  }
}
