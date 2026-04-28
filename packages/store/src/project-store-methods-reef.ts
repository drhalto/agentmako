import type { FactSubject, ProjectFact, ProjectFinding, ReefRuleDescriptor } from "@mako-ai/contracts";
import {
  computeReefFactFingerprint,
  computeReefFindingFingerprint,
  computeReefSubjectFingerprint,
  computeReefArtifactId,
  computeDbReviewTargetFingerprint,
  addReefArtifactTagImpl,
  applyReefChangeSetImpl,
  ensureReefAnalysisStateImpl,
  insertDbReviewCommentImpl,
  listReefRuleDescriptorsImpl,
  loadReefAnalysisStateImpl,
  markReefChangeSetFailedImpl,
  markReefChangeSetMaterializedImpl,
  markReefChangeSetSkippedImpl,
  recordReefWatcherRecrawlImpl,
  queryDbReviewCommentsImpl,
  queryReefArtifactsImpl,
  queryReefArtifactTagsImpl,
  queryReefDiagnosticRunsImpl,
  queryReefAppliedChangeSetsImpl,
  queryReefFactsImpl,
  replaceReefFactsForSourceImpl,
  queryReefFindingsImpl,
  replaceReefFindingsForSourceImpl,
  removeReefArtifactTagsImpl,
  resolveReefFindingsForDeletedFilesImpl,
  saveReefDiagnosticRunImpl,
  saveReefRuleDescriptorsImpl,
  upsertReefArtifactImpl,
  upsertReefFactsImpl,
} from "./project-store-reef.js";
import type { ProjectStoreContext } from "./project-store-context.js";
import type {
  AddReefArtifactTagInput,
  QueryReefDiagnosticRunsOptions,
  ApplyReefChangeSetInput,
  EnsureReefAnalysisStateInput,
  QueryDbReviewCommentsOptions,
  QueryReefArtifactsOptions,
  QueryReefArtifactTagsOptions,
  MarkReefChangeSetFailedInput,
  MarkReefChangeSetMaterializedInput,
  QueryReefAppliedChangeSetsOptions,
  QueryReefFactsOptions,
  QueryReefFindingsOptions,
  DbReviewCommentRecord,
  InsertDbReviewCommentInput,
  ReefAnalysisStateRecord,
  ReefAppliedChangeSetRecord,
  ReefArtifactKey,
  ReefArtifactRecord,
  ReefArtifactTagRecord,
  ReefDiagnosticRunRecord,
  ReefFactRecord,
  ReefFindingRecord,
  ReefRuleDescriptorRecord,
  MarkReefChangeSetSkippedInput,
  RecordReefWatcherRecrawlInput,
  ReplaceReefFactsForSourceInput,
  ReplaceReefFindingsForSourceInput,
  RemoveReefArtifactTagsInput,
  RemoveReefArtifactTagsResult,
  ResolveReefFindingsForDeletedFilesInput,
  SaveReefDiagnosticRunInput,
  UpsertReefArtifactInput,
} from "./types.js";

export const projectStoreReefMethods = {
  computeReefSubjectFingerprint(subject: FactSubject): string {
    return computeReefSubjectFingerprint(subject);
  },

  computeReefFactFingerprint(input: Parameters<typeof computeReefFactFingerprint>[0]): string {
    return computeReefFactFingerprint(input);
  },

  computeReefFindingFingerprint(input: Parameters<typeof computeReefFindingFingerprint>[0]): string {
    return computeReefFindingFingerprint(input);
  },

  computeReefArtifactId(input: ReefArtifactKey): string {
    return computeReefArtifactId(input);
  },

  computeDbReviewTargetFingerprint(input: Parameters<typeof computeDbReviewTargetFingerprint>[0]): string {
    return computeDbReviewTargetFingerprint(input);
  },

  loadReefAnalysisState(
    this: ProjectStoreContext,
    projectId: string,
    root: string,
  ): ReefAnalysisStateRecord | null {
    return loadReefAnalysisStateImpl(this.db, projectId, root);
  },

  applyReefChangeSet(
    this: ProjectStoreContext,
    input: ApplyReefChangeSetInput,
  ): ReefAppliedChangeSetRecord {
    return applyReefChangeSetImpl(this.db, input);
  },

  ensureReefAnalysisState(
    this: ProjectStoreContext,
    input: EnsureReefAnalysisStateInput,
  ): ReefAnalysisStateRecord {
    return ensureReefAnalysisStateImpl(this.db, input);
  },

  markReefChangeSetMaterialized(
    this: ProjectStoreContext,
    input: MarkReefChangeSetMaterializedInput,
  ): ReefAnalysisStateRecord {
    return markReefChangeSetMaterializedImpl(this.db, input);
  },

  markReefChangeSetFailed(
    this: ProjectStoreContext,
    input: MarkReefChangeSetFailedInput,
  ): void {
    return markReefChangeSetFailedImpl(this.db, input);
  },

  markReefChangeSetSkipped(
    this: ProjectStoreContext,
    input: MarkReefChangeSetSkippedInput,
  ): void {
    return markReefChangeSetSkippedImpl(this.db, input);
  },

  recordReefWatcherRecrawl(
    this: ProjectStoreContext,
    input: RecordReefWatcherRecrawlInput,
  ): ReefAnalysisStateRecord {
    return recordReefWatcherRecrawlImpl(this.db, input);
  },

  queryReefAppliedChangeSets(
    this: ProjectStoreContext,
    options: QueryReefAppliedChangeSetsOptions,
  ): ReefAppliedChangeSetRecord[] {
    return queryReefAppliedChangeSetsImpl(this.db, options);
  },

  upsertReefArtifact(
    this: ProjectStoreContext,
    input: UpsertReefArtifactInput,
  ): ReefArtifactRecord {
    return upsertReefArtifactImpl(this.db, input);
  },

  addReefArtifactTag(
    this: ProjectStoreContext,
    input: AddReefArtifactTagInput,
  ): ReefArtifactTagRecord {
    return addReefArtifactTagImpl(this.db, input);
  },

  queryReefArtifacts(
    this: ProjectStoreContext,
    options?: QueryReefArtifactsOptions,
  ): ReefArtifactRecord[] {
    return queryReefArtifactsImpl(this.db, options);
  },

  queryReefArtifactTags(
    this: ProjectStoreContext,
    options?: QueryReefArtifactTagsOptions,
  ): ReefArtifactTagRecord[] {
    return queryReefArtifactTagsImpl(this.db, options);
  },

  removeReefArtifactTags(
    this: ProjectStoreContext,
    input: RemoveReefArtifactTagsInput,
  ): RemoveReefArtifactTagsResult {
    return removeReefArtifactTagsImpl(this.db, input);
  },

  upsertReefFacts(this: ProjectStoreContext, facts: ProjectFact[]): ReefFactRecord[] {
    return upsertReefFactsImpl(this.db, facts);
  },

  queryReefFacts(this: ProjectStoreContext, options: QueryReefFactsOptions): ReefFactRecord[] {
    return queryReefFactsImpl(this.db, options);
  },

  replaceReefFactsForSource(
    this: ProjectStoreContext,
    input: ReplaceReefFactsForSourceInput,
  ): ReefFactRecord[] {
    return replaceReefFactsForSourceImpl(this.db, input);
  },

  replaceReefFindingsForSource(
    this: ProjectStoreContext,
    input: ReplaceReefFindingsForSourceInput,
  ): ReefFindingRecord[] {
    return replaceReefFindingsForSourceImpl(this.db, input);
  },

  queryReefFindings(
    this: ProjectStoreContext,
    options: QueryReefFindingsOptions,
  ): ReefFindingRecord[] {
    return queryReefFindingsImpl(this.db, options);
  },

  resolveReefFindingsForDeletedFiles(
    this: ProjectStoreContext,
    input: ResolveReefFindingsForDeletedFilesInput,
  ): number {
    return resolveReefFindingsForDeletedFilesImpl(this.db, input);
  },

  saveReefRuleDescriptors(
    this: ProjectStoreContext,
    descriptors: ReefRuleDescriptor[],
  ): ReefRuleDescriptorRecord[] {
    return saveReefRuleDescriptorsImpl(this.db, descriptors);
  },

  listReefRuleDescriptors(this: ProjectStoreContext): ReefRuleDescriptorRecord[] {
    return listReefRuleDescriptorsImpl(this.db);
  },

  saveReefDiagnosticRun(
    this: ProjectStoreContext,
    input: SaveReefDiagnosticRunInput,
  ): ReefDiagnosticRunRecord {
    return saveReefDiagnosticRunImpl(this.db, input);
  },

  queryReefDiagnosticRuns(
    this: ProjectStoreContext,
    options: QueryReefDiagnosticRunsOptions,
  ): ReefDiagnosticRunRecord[] {
    return queryReefDiagnosticRunsImpl(this.db, options);
  },

  insertDbReviewComment(
    this: ProjectStoreContext,
    input: InsertDbReviewCommentInput,
  ): DbReviewCommentRecord {
    return insertDbReviewCommentImpl(this.db, input);
  },

  queryDbReviewComments(
    this: ProjectStoreContext,
    options: QueryDbReviewCommentsOptions,
  ): DbReviewCommentRecord[] {
    return queryDbReviewCommentsImpl(this.db, options);
  },
};

export type ProjectStoreReefMethods = {
  [K in keyof typeof projectStoreReefMethods]: OmitThisParameter<
    (typeof projectStoreReefMethods)[K]
  >;
};
