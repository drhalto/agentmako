import {
  createHarnessSessionImpl,
  deleteHarnessSessionImpl,
  getHarnessSessionImpl,
  insertHarnessMessageImpl,
  insertHarnessMessagePartImpl,
  insertHarnessPermissionDecisionImpl,
  insertHarnessProviderCallImpl,
  insertHarnessSessionEventImpl,
  listHarnessProviderCallsForUsageImpl,
  listHarnessProviderCallsImpl,
  listHarnessMessagePartsImpl,
  listHarnessMessagesImpl,
  listHarnessPermissionDecisionsImpl,
  listHarnessSessionEventsImpl,
  listHarnessSessionsImpl,
  markHarnessMessagesArchivedImpl,
  sumProjectCostUsdMicroImpl,
  updateHarnessSessionImpl,
  type CreateHarnessSessionInput,
  type HarnessMessagePartRecord,
  type HarnessMessageRecord,
  type HarnessPermissionDecisionRecord,
  type HarnessProviderCallFilter,
  type HarnessProviderCallInput,
  type HarnessProviderCallRecord,
  type HarnessSessionEventRow,
  type HarnessSessionRecord,
  type InsertHarnessMessageInput,
  type InsertHarnessMessagePartInput,
  type InsertHarnessPermissionDecisionInput,
  type InsertHarnessSessionEventInput,
  type UpdateHarnessSessionInput,
} from "./project-store-harness.js";
import {
  countEmbeddingsForModelImpl,
  getEmbeddingForOwnerImpl,
  insertEmbeddingImpl,
  listEmbeddingsByModelImpl,
  type EmbeddingOwnerKind,
  type EmbeddingRecord,
  type InsertEmbeddingInput,
  type ListEmbeddingsByModelOptions,
} from "./project-store-embeddings.js";
import {
  ftsSearchHarnessMemoriesImpl,
  getHarnessMemoryByRowidImpl,
  getHarnessMemoryImpl,
  insertHarnessMemoryImpl,
  listHarnessMemoriesImpl,
  type HarnessMemoryRecord,
  type InsertHarnessMemoryInput,
  type ListHarnessMemoriesOptions,
  type MemoryFtsMatch,
} from "./project-store-memories.js";
import {
  countSemanticUnitsImpl,
  getSemanticUnitImpl,
  listSemanticUnitsImpl,
  replaceSemanticUnitsForFilesImpl,
  replaceSemanticUnitsImpl,
  searchSemanticUnitsImpl,
  type ListSemanticUnitsOptions,
  type SemanticUnitFtsMatch,
  type SemanticUnitInput,
  type SemanticUnitKind,
  type SemanticUnitRecord,
} from "./project-store-semantic-units.js";
import type { ProjectStoreContext } from "./project-store-context.js";

export const projectStoreHarnessMethods = {
  createHarnessSession(
    this: ProjectStoreContext,
    input: CreateHarnessSessionInput,
  ): HarnessSessionRecord {
    return createHarnessSessionImpl(this.db, input);
  },

  getHarnessSession(this: ProjectStoreContext, sessionId: string): HarnessSessionRecord | null {
    return getHarnessSessionImpl(this.db, sessionId);
  },

  listHarnessSessions(
    this: ProjectStoreContext,
    options: { projectId?: string | null; limit?: number } = {},
  ): HarnessSessionRecord[] {
    return listHarnessSessionsImpl(this.db, options);
  },

  updateHarnessSession(
    this: ProjectStoreContext,
    sessionId: string,
    input: UpdateHarnessSessionInput,
  ): HarnessSessionRecord {
    return updateHarnessSessionImpl(this.db, sessionId, input);
  },

  deleteHarnessSession(this: ProjectStoreContext, sessionId: string): void {
    return deleteHarnessSessionImpl(this.db, sessionId);
  },

  insertHarnessMessage(
    this: ProjectStoreContext,
    input: InsertHarnessMessageInput,
  ): HarnessMessageRecord {
    return insertHarnessMessageImpl(this.db, input);
  },

  listHarnessMessages(
    this: ProjectStoreContext,
    sessionId: string,
    options: { includeArchived?: boolean } = {},
  ): HarnessMessageRecord[] {
    return listHarnessMessagesImpl(this.db, sessionId, options);
  },

  markHarnessMessagesArchived(this: ProjectStoreContext, messageIds: string[]): number {
    return markHarnessMessagesArchivedImpl(this.db, messageIds);
  },

  insertHarnessMessagePart(
    this: ProjectStoreContext,
    input: InsertHarnessMessagePartInput,
  ): HarnessMessagePartRecord {
    return insertHarnessMessagePartImpl(this.db, input);
  },

  listHarnessMessageParts(
    this: ProjectStoreContext,
    messageId: string,
  ): HarnessMessagePartRecord[] {
    return listHarnessMessagePartsImpl(this.db, messageId);
  },

  insertHarnessSessionEvent(
    this: ProjectStoreContext,
    input: InsertHarnessSessionEventInput,
  ): HarnessSessionEventRow {
    return insertHarnessSessionEventImpl(this.db, input);
  },

  listHarnessSessionEvents(
    this: ProjectStoreContext,
    sessionId: string,
    afterOrdinal?: number,
  ): HarnessSessionEventRow[] {
    return listHarnessSessionEventsImpl(this.db, sessionId, afterOrdinal);
  },

  insertHarnessProviderCall(this: ProjectStoreContext, input: HarnessProviderCallInput): void {
    return insertHarnessProviderCallImpl(this.db, input);
  },

  listHarnessProviderCalls(
    this: ProjectStoreContext,
    sessionId: string,
  ): HarnessProviderCallRecord[] {
    return listHarnessProviderCallsImpl(this.db, sessionId);
  },

  listHarnessProviderCallsForUsage(
    this: ProjectStoreContext,
    filter: HarnessProviderCallFilter = {},
  ): HarnessProviderCallRecord[] {
    return listHarnessProviderCallsForUsageImpl(this.db, filter);
  },

  sumProjectCostUsdMicro(
    this: ProjectStoreContext,
    projectId: string,
    sinceIso: string,
  ): number {
    return sumProjectCostUsdMicroImpl(this.db, projectId, sinceIso);
  },

  insertHarnessPermissionDecision(
    this: ProjectStoreContext,
    input: InsertHarnessPermissionDecisionInput,
  ): HarnessPermissionDecisionRecord {
    return insertHarnessPermissionDecisionImpl(this.db, input);
  },

  listHarnessPermissionDecisions(
    this: ProjectStoreContext,
    sessionId: string,
  ): HarnessPermissionDecisionRecord[] {
    return listHarnessPermissionDecisionsImpl(this.db, sessionId);
  },

  insertHarnessMemory(
    this: ProjectStoreContext,
    input: InsertHarnessMemoryInput,
  ): HarnessMemoryRecord {
    return insertHarnessMemoryImpl(this.db, input);
  },

  getHarnessMemory(this: ProjectStoreContext, memoryId: string): HarnessMemoryRecord | null {
    return getHarnessMemoryImpl(this.db, memoryId);
  },

  getHarnessMemoryByRowid(
    this: ProjectStoreContext,
    memoryRowid: number,
  ): HarnessMemoryRecord | null {
    return getHarnessMemoryByRowidImpl(this.db, memoryRowid);
  },

  listHarnessMemories(
    this: ProjectStoreContext,
    options: ListHarnessMemoriesOptions = {},
  ): HarnessMemoryRecord[] {
    return listHarnessMemoriesImpl(this.db, options);
  },

  ftsSearchHarnessMemories(
    this: ProjectStoreContext,
    query: string,
    options: { projectId?: string | null; limit?: number; rawUserInput?: boolean } = {},
  ): MemoryFtsMatch[] {
    return ftsSearchHarnessMemoriesImpl(this.db, query, options);
  },

  insertEmbedding(this: ProjectStoreContext, input: InsertEmbeddingInput): EmbeddingRecord {
    return insertEmbeddingImpl(this.db, input);
  },

  listEmbeddingsByModel(
    this: ProjectStoreContext,
    options: ListEmbeddingsByModelOptions,
  ): EmbeddingRecord[] {
    return listEmbeddingsByModelImpl(this.db, options);
  },

  getEmbeddingForOwner(
    this: ProjectStoreContext,
    ownerKind: EmbeddingOwnerKind,
    ownerId: string,
    model: string,
  ): EmbeddingRecord | null {
    return getEmbeddingForOwnerImpl(this.db, ownerKind, ownerId, model);
  },

  countEmbeddingsForModel(
    this: ProjectStoreContext,
    ownerKind: EmbeddingOwnerKind,
    model: string,
  ): number {
    return countEmbeddingsForModelImpl(this.db, ownerKind, model);
  },

  replaceSemanticUnits(this: ProjectStoreContext, units: SemanticUnitInput[]): number {
    return replaceSemanticUnitsImpl(this.db, units);
  },

  replaceSemanticUnitsForFiles(
    this: ProjectStoreContext,
    filePaths: string[],
    units: SemanticUnitInput[],
  ): number {
    return replaceSemanticUnitsForFilesImpl(this.db, filePaths, units);
  },

  getSemanticUnit(this: ProjectStoreContext, unitId: string): SemanticUnitRecord | null {
    return getSemanticUnitImpl(this.db, unitId);
  },

  listSemanticUnits(
    this: ProjectStoreContext,
    options: ListSemanticUnitsOptions = {},
  ): SemanticUnitRecord[] {
    return listSemanticUnitsImpl(this.db, options);
  },

  countSemanticUnits(
    this: ProjectStoreContext,
    unitKinds?: SemanticUnitKind[],
  ): number {
    return countSemanticUnitsImpl(this.db, unitKinds);
  },

  searchSemanticUnits(
    this: ProjectStoreContext,
    query: string,
    options: ListSemanticUnitsOptions = {},
  ): SemanticUnitFtsMatch[] {
    return searchSemanticUnitsImpl(this.db, query, options);
  },
};

export type ProjectStoreHarnessMethods = {
  [K in keyof typeof projectStoreHarnessMethods]: OmitThisParameter<
    (typeof projectStoreHarnessMethods)[K]
  >;
};
