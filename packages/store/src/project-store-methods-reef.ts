import type { FactSubject, ProjectFact, ProjectFinding, ReefRuleDescriptor } from "@mako-ai/contracts";
import {
  computeReefFactFingerprint,
  computeReefFindingFingerprint,
  computeReefSubjectFingerprint,
  computeDbReviewTargetFingerprint,
  insertDbReviewCommentImpl,
  listReefRuleDescriptorsImpl,
  queryDbReviewCommentsImpl,
  queryReefDiagnosticRunsImpl,
  queryReefFactsImpl,
  replaceReefFactsForSourceImpl,
  queryReefFindingsImpl,
  replaceReefFindingsForSourceImpl,
  resolveReefFindingsForDeletedFilesImpl,
  saveReefDiagnosticRunImpl,
  saveReefRuleDescriptorsImpl,
  upsertReefFactsImpl,
} from "./project-store-reef.js";
import type { ProjectStoreContext } from "./project-store-context.js";
import type {
  QueryReefDiagnosticRunsOptions,
  QueryDbReviewCommentsOptions,
  QueryReefFactsOptions,
  QueryReefFindingsOptions,
  DbReviewCommentRecord,
  InsertDbReviewCommentInput,
  ReefDiagnosticRunRecord,
  ReefFactRecord,
  ReefFindingRecord,
  ReefRuleDescriptorRecord,
  ReplaceReefFactsForSourceInput,
  ReplaceReefFindingsForSourceInput,
  ResolveReefFindingsForDeletedFilesInput,
  SaveReefDiagnosticRunInput,
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

  computeDbReviewTargetFingerprint(input: Parameters<typeof computeDbReviewTargetFingerprint>[0]): string {
    return computeDbReviewTargetFingerprint(input);
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
