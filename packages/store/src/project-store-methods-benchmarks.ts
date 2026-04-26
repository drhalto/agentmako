import {
  deleteBenchmarkAssertionImpl,
  deleteBenchmarkCaseImpl,
  deleteBenchmarkSuiteImpl,
  getBenchmarkAssertionImpl,
  getBenchmarkAssertionResultImpl,
  getBenchmarkCaseImpl,
  getBenchmarkCaseResultImpl,
  getBenchmarkRunImpl,
  getBenchmarkSuiteImpl,
  insertBenchmarkAssertionResultImpl,
  insertBenchmarkCaseResultImpl,
  insertBenchmarkRunImpl,
  listBenchmarkAssertionResultsImpl,
  listBenchmarkAssertionsImpl,
  listBenchmarkCaseResultsImpl,
  listBenchmarkCasesImpl,
  listBenchmarkRunsImpl,
  listBenchmarkSuitesImpl,
  saveBenchmarkAssertionImpl,
  saveBenchmarkCaseImpl,
  saveBenchmarkSuiteImpl,
} from "./project-store-benchmarks.js";
import type { ProjectStoreContext } from "./project-store-context.js";
import type {
  BenchmarkAssertionRecord,
  BenchmarkAssertionResultInsert,
  BenchmarkAssertionResultRecord,
  BenchmarkCaseRecord,
  BenchmarkCaseResultInsert,
  BenchmarkCaseResultRecord,
  BenchmarkRunInsert,
  BenchmarkRunRecord,
  BenchmarkSuiteRecord,
  QueryBenchmarkAssertionResultsOptions,
  QueryBenchmarkCaseResultsOptions,
  QueryBenchmarkRunsOptions,
  SaveBenchmarkAssertionInput,
  SaveBenchmarkCaseInput,
  SaveBenchmarkSuiteInput,
} from "./types.js";

export const projectStoreBenchmarkMethods = {
  saveBenchmarkSuite(
    this: ProjectStoreContext,
    input: SaveBenchmarkSuiteInput,
  ): BenchmarkSuiteRecord {
    return saveBenchmarkSuiteImpl(this.db, input);
  },

  getBenchmarkSuite(this: ProjectStoreContext, suiteId: string): BenchmarkSuiteRecord | null {
    return getBenchmarkSuiteImpl(this.db, suiteId);
  },

  listBenchmarkSuites(this: ProjectStoreContext, limit = 50): BenchmarkSuiteRecord[] {
    return listBenchmarkSuitesImpl(this.db, limit);
  },

  deleteBenchmarkSuite(this: ProjectStoreContext, suiteId: string): void {
    return deleteBenchmarkSuiteImpl(this.db, suiteId);
  },

  saveBenchmarkCase(
    this: ProjectStoreContext,
    input: SaveBenchmarkCaseInput,
  ): BenchmarkCaseRecord {
    return saveBenchmarkCaseImpl(this.db, input);
  },

  getBenchmarkCase(this: ProjectStoreContext, caseId: string): BenchmarkCaseRecord | null {
    return getBenchmarkCaseImpl(this.db, caseId);
  },

  listBenchmarkCases(this: ProjectStoreContext, suiteId: string): BenchmarkCaseRecord[] {
    return listBenchmarkCasesImpl(this.db, suiteId);
  },

  deleteBenchmarkCase(this: ProjectStoreContext, caseId: string): void {
    return deleteBenchmarkCaseImpl(this.db, caseId);
  },

  saveBenchmarkAssertion(
    this: ProjectStoreContext,
    input: SaveBenchmarkAssertionInput,
  ): BenchmarkAssertionRecord {
    return saveBenchmarkAssertionImpl(this.db, input);
  },

  getBenchmarkAssertion(
    this: ProjectStoreContext,
    assertionId: string,
  ): BenchmarkAssertionRecord | null {
    return getBenchmarkAssertionImpl(this.db, assertionId);
  },

  listBenchmarkAssertions(
    this: ProjectStoreContext,
    caseId: string,
  ): BenchmarkAssertionRecord[] {
    return listBenchmarkAssertionsImpl(this.db, caseId);
  },

  deleteBenchmarkAssertion(this: ProjectStoreContext, assertionId: string): void {
    return deleteBenchmarkAssertionImpl(this.db, assertionId);
  },

  insertBenchmarkRun(this: ProjectStoreContext, input: BenchmarkRunInsert): BenchmarkRunRecord {
    return insertBenchmarkRunImpl(this.db, input);
  },

  getBenchmarkRun(this: ProjectStoreContext, runId: string): BenchmarkRunRecord | null {
    return getBenchmarkRunImpl(this.db, runId);
  },

  listBenchmarkRuns(
    this: ProjectStoreContext,
    options: QueryBenchmarkRunsOptions = {},
  ): BenchmarkRunRecord[] {
    return listBenchmarkRunsImpl(this.db, options);
  },

  insertBenchmarkCaseResult(
    this: ProjectStoreContext,
    input: BenchmarkCaseResultInsert,
  ): BenchmarkCaseResultRecord {
    return insertBenchmarkCaseResultImpl(this.db, input);
  },

  getBenchmarkCaseResult(
    this: ProjectStoreContext,
    caseResultId: string,
  ): BenchmarkCaseResultRecord | null {
    return getBenchmarkCaseResultImpl(this.db, caseResultId);
  },

  listBenchmarkCaseResults(
    this: ProjectStoreContext,
    options: QueryBenchmarkCaseResultsOptions = {},
  ): BenchmarkCaseResultRecord[] {
    return listBenchmarkCaseResultsImpl(this.db, options);
  },

  insertBenchmarkAssertionResult(
    this: ProjectStoreContext,
    input: BenchmarkAssertionResultInsert,
  ): BenchmarkAssertionResultRecord {
    return insertBenchmarkAssertionResultImpl(this.db, input);
  },

  getBenchmarkAssertionResult(
    this: ProjectStoreContext,
    assertionResultId: string,
  ): BenchmarkAssertionResultRecord | null {
    return getBenchmarkAssertionResultImpl(this.db, assertionResultId);
  },

  listBenchmarkAssertionResults(
    this: ProjectStoreContext,
    options: QueryBenchmarkAssertionResultsOptions = {},
  ): BenchmarkAssertionResultRecord[] {
    return listBenchmarkAssertionResultsImpl(this.db, options);
  },
};

export type ProjectStoreBenchmarkMethods = {
  [K in keyof typeof projectStoreBenchmarkMethods]: OmitThisParameter<
    (typeof projectStoreBenchmarkMethods)[K]
  >;
};
