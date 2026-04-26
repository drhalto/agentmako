import {
  recallAnswersImpl,
  recallToolRunsImpl,
} from "./project-store-recall.js";
import type { ProjectStoreContext } from "./project-store-context.js";
import type {
  RecallAnswersOptions,
  RecallAnswersResult,
  RecallToolRunsOptions,
  RecallToolRunsResult,
} from "./types.js";

export const projectStoreRecallMethods = {
  recallAnswers(
    this: ProjectStoreContext,
    options: RecallAnswersOptions,
  ): RecallAnswersResult {
    return recallAnswersImpl(this.db, options);
  },

  recallToolRuns(
    this: ProjectStoreContext,
    options: RecallToolRunsOptions,
  ): RecallToolRunsResult {
    return recallToolRunsImpl(this.db, options);
  },
};

export type ProjectStoreRecallMethods = {
  [K in keyof typeof projectStoreRecallMethods]: OmitThisParameter<
    (typeof projectStoreRecallMethods)[K]
  >;
};
