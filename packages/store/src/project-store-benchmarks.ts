import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { JsonValue } from "@mako-ai/contracts";
import { parseJson, stringifyJson } from "./json.js";
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

interface BenchmarkSuiteRow {
  suite_id: string;
  name: string;
  description: string | null;
  version: string;
  config_json: string;
}

interface BenchmarkCaseRow {
  case_id: string;
  suite_id: string;
  name: string;
  tool_name: string;
  input_json: string;
  expected_outcome: string;
}

interface BenchmarkAssertionRow {
  assertion_id: string;
  case_id: string;
  assertion_type: string;
  expected_value: string;
  tolerance: number | null;
}

interface BenchmarkRunRow {
  run_id: string;
  suite_id: string;
  started_at: string;
  finished_at: string;
  outcome: string;
  runner_version: string;
}

interface BenchmarkCaseResultRow {
  case_result_id: string;
  run_id: string;
  case_id: string;
  tool_run_id: string;
  outcome: string;
  actual_value: string | null;
}

interface BenchmarkAssertionResultRow {
  assertion_result_id: string;
  case_result_id: string;
  assertion_id: string;
  passed: number;
  actual_value: string | null;
  expected_value: string;
}

function mapBenchmarkSuiteRow(row: BenchmarkSuiteRow | undefined): BenchmarkSuiteRecord | null {
  if (!row) {
    return null;
  }

  return {
    suiteId: row.suite_id,
    name: row.name,
    description: row.description ?? undefined,
    version: row.version,
    config: parseJson<JsonValue>(row.config_json, {}),
  };
}

function mapBenchmarkCaseRow(row: BenchmarkCaseRow | undefined): BenchmarkCaseRecord | null {
  if (!row) {
    return null;
  }

  return {
    caseId: row.case_id,
    suiteId: row.suite_id,
    name: row.name,
    toolName: row.tool_name,
    input: parseJson<JsonValue>(row.input_json, null),
    expectedOutcome: parseJson<JsonValue>(row.expected_outcome, null),
  };
}

function mapBenchmarkAssertionRow(row: BenchmarkAssertionRow | undefined): BenchmarkAssertionRecord | null {
  if (!row) {
    return null;
  }

  return {
    assertionId: row.assertion_id,
    caseId: row.case_id,
    assertionType: row.assertion_type,
    expectedValue: parseJson<JsonValue>(row.expected_value, null),
    tolerance: row.tolerance ?? undefined,
  };
}

function mapBenchmarkRunRow(row: BenchmarkRunRow | undefined): BenchmarkRunRecord | null {
  if (!row) {
    return null;
  }

  return {
    runId: row.run_id,
    suiteId: row.suite_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outcome: row.outcome,
    runnerVersion: row.runner_version,
  };
}

function mapBenchmarkCaseResultRow(row: BenchmarkCaseResultRow | undefined): BenchmarkCaseResultRecord | null {
  if (!row) {
    return null;
  }

  return {
    caseResultId: row.case_result_id,
    runId: row.run_id,
    caseId: row.case_id,
    toolRunId: row.tool_run_id,
    outcome: row.outcome,
    actualValue: row.actual_value == null ? undefined : parseJson<JsonValue>(row.actual_value, null),
  };
}

function mapBenchmarkAssertionResultRow(
  row: BenchmarkAssertionResultRow | undefined,
): BenchmarkAssertionResultRecord | null {
  if (!row) {
    return null;
  }

  return {
    assertionResultId: row.assertion_result_id,
    caseResultId: row.case_result_id,
    assertionId: row.assertion_id,
    passed: row.passed === 1,
    actualValue: row.actual_value == null ? undefined : parseJson<JsonValue>(row.actual_value, null),
    expectedValue: parseJson<JsonValue>(row.expected_value, null),
  };
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createBenchmarkRecordError(target: string, error: unknown): Error {
  return new Error(`benchmark-record-failed: ${target}: ${toErrorText(error)}`);
}

function createBenchmarkLinkError(toolRunId: string): Error {
  return new Error(
    `benchmark-link-failed: benchmark_case_results.tool_run_id must reference an existing tool_runs row: ${toolRunId}`,
  );
}

export function saveBenchmarkSuiteImpl(db: DatabaseSync, input: SaveBenchmarkSuiteInput): BenchmarkSuiteRecord {
  const suiteId = input.suiteId ?? randomUUID();

  try {
    db
      .prepare(`
        INSERT INTO benchmark_suites(suite_id, name, description, version, config_json)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(suite_id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          version = excluded.version,
          config_json = excluded.config_json
      `)
      .run(
        suiteId,
        input.name,
        input.description ?? null,
        input.version,
        stringifyJson(input.config ?? {}),
      );
  } catch (error) {
    throw createBenchmarkRecordError("benchmark_suites", error);
  }

  return getBenchmarkSuiteImpl(db, suiteId) as BenchmarkSuiteRecord;
}

export function getBenchmarkSuiteImpl(db: DatabaseSync, suiteId: string): BenchmarkSuiteRecord | null {
  const row = db
    .prepare(`
      SELECT suite_id, name, description, version, config_json
      FROM benchmark_suites
      WHERE suite_id = ?
    `)
    .get(suiteId) as BenchmarkSuiteRow | undefined;

  return mapBenchmarkSuiteRow(row);
}

export function listBenchmarkSuitesImpl(db: DatabaseSync, limit = 50): BenchmarkSuiteRecord[] {
  const rows = db
    .prepare(`
      SELECT suite_id, name, description, version, config_json
      FROM benchmark_suites
      ORDER BY name ASC, version DESC, suite_id ASC
      LIMIT ?
    `)
    .all(limit) as unknown as BenchmarkSuiteRow[];

  return rows
    .map((row) => mapBenchmarkSuiteRow(row))
    .filter((row): row is BenchmarkSuiteRecord => row !== null);
}

export function deleteBenchmarkSuiteImpl(db: DatabaseSync, suiteId: string): void {
  db.prepare(`DELETE FROM benchmark_suites WHERE suite_id = ?`).run(suiteId);
}

export function saveBenchmarkCaseImpl(db: DatabaseSync, input: SaveBenchmarkCaseInput): BenchmarkCaseRecord {
  const caseId = input.caseId ?? randomUUID();

  try {
    db
      .prepare(`
        INSERT INTO benchmark_cases(case_id, suite_id, name, tool_name, input_json, expected_outcome)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(case_id) DO UPDATE SET
          suite_id = excluded.suite_id,
          name = excluded.name,
          tool_name = excluded.tool_name,
          input_json = excluded.input_json,
          expected_outcome = excluded.expected_outcome
      `)
      .run(
        caseId,
        input.suiteId,
        input.name,
        input.toolName,
        stringifyJson(input.input),
        stringifyJson(input.expectedOutcome),
      );
  } catch (error) {
    throw createBenchmarkRecordError("benchmark_cases", error);
  }

  return getBenchmarkCaseImpl(db, caseId) as BenchmarkCaseRecord;
}

export function getBenchmarkCaseImpl(db: DatabaseSync, caseId: string): BenchmarkCaseRecord | null {
  const row = db
    .prepare(`
      SELECT case_id, suite_id, name, tool_name, input_json, expected_outcome
      FROM benchmark_cases
      WHERE case_id = ?
    `)
    .get(caseId) as BenchmarkCaseRow | undefined;

  return mapBenchmarkCaseRow(row);
}

export function listBenchmarkCasesImpl(db: DatabaseSync, suiteId: string): BenchmarkCaseRecord[] {
  const rows = db
    .prepare(`
      SELECT case_id, suite_id, name, tool_name, input_json, expected_outcome
      FROM benchmark_cases
      WHERE suite_id = ?
      ORDER BY name ASC, case_id ASC
    `)
    .all(suiteId) as unknown as BenchmarkCaseRow[];

  return rows
    .map((row) => mapBenchmarkCaseRow(row))
    .filter((row): row is BenchmarkCaseRecord => row !== null);
}

export function deleteBenchmarkCaseImpl(db: DatabaseSync, caseId: string): void {
  db.prepare(`DELETE FROM benchmark_cases WHERE case_id = ?`).run(caseId);
}

export function saveBenchmarkAssertionImpl(
  db: DatabaseSync,
  input: SaveBenchmarkAssertionInput,
): BenchmarkAssertionRecord {
  const assertionId = input.assertionId ?? randomUUID();

  try {
    db
      .prepare(`
        INSERT INTO benchmark_assertions(assertion_id, case_id, assertion_type, expected_value, tolerance)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(assertion_id) DO UPDATE SET
          case_id = excluded.case_id,
          assertion_type = excluded.assertion_type,
          expected_value = excluded.expected_value,
          tolerance = excluded.tolerance
      `)
      .run(
        assertionId,
        input.caseId,
        input.assertionType,
        stringifyJson(input.expectedValue),
        input.tolerance ?? null,
      );
  } catch (error) {
    throw createBenchmarkRecordError("benchmark_assertions", error);
  }

  return getBenchmarkAssertionImpl(db, assertionId) as BenchmarkAssertionRecord;
}

export function getBenchmarkAssertionImpl(db: DatabaseSync, assertionId: string): BenchmarkAssertionRecord | null {
  const row = db
    .prepare(`
      SELECT assertion_id, case_id, assertion_type, expected_value, tolerance
      FROM benchmark_assertions
      WHERE assertion_id = ?
    `)
    .get(assertionId) as BenchmarkAssertionRow | undefined;

  return mapBenchmarkAssertionRow(row);
}

export function listBenchmarkAssertionsImpl(db: DatabaseSync, caseId: string): BenchmarkAssertionRecord[] {
  const rows = db
    .prepare(`
      SELECT assertion_id, case_id, assertion_type, expected_value, tolerance
      FROM benchmark_assertions
      WHERE case_id = ?
      ORDER BY assertion_type ASC, assertion_id ASC
    `)
    .all(caseId) as unknown as BenchmarkAssertionRow[];

  return rows
    .map((row) => mapBenchmarkAssertionRow(row))
    .filter((row): row is BenchmarkAssertionRecord => row !== null);
}

export function deleteBenchmarkAssertionImpl(db: DatabaseSync, assertionId: string): void {
  db.prepare(`DELETE FROM benchmark_assertions WHERE assertion_id = ?`).run(assertionId);
}

export function insertBenchmarkRunImpl(db: DatabaseSync, input: BenchmarkRunInsert): BenchmarkRunRecord {
  const runId = randomUUID();

  try {
    db
      .prepare(`
        INSERT INTO benchmark_runs(run_id, suite_id, started_at, finished_at, outcome, runner_version)
        VALUES(?, ?, ?, ?, ?, ?)
      `)
      .run(runId, input.suiteId, input.startedAt, input.finishedAt, input.outcome, input.runnerVersion);
  } catch (error) {
    throw createBenchmarkRecordError("benchmark_runs", error);
  }

  return getBenchmarkRunImpl(db, runId) as BenchmarkRunRecord;
}

export function getBenchmarkRunImpl(db: DatabaseSync, runId: string): BenchmarkRunRecord | null {
  const row = db
    .prepare(`
      SELECT run_id, suite_id, started_at, finished_at, outcome, runner_version
      FROM benchmark_runs
      WHERE run_id = ?
    `)
    .get(runId) as BenchmarkRunRow | undefined;

  return mapBenchmarkRunRow(row);
}

export function listBenchmarkRunsImpl(
  db: DatabaseSync,
  options: QueryBenchmarkRunsOptions = {},
): BenchmarkRunRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (options.suiteId) {
    clauses.push("suite_id = ?");
    values.push(options.suiteId);
  }

  if (options.outcome) {
    clauses.push("outcome = ?");
    values.push(options.outcome);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(`
      SELECT run_id, suite_id, started_at, finished_at, outcome, runner_version
      FROM benchmark_runs
      ${whereClause}
      ORDER BY finished_at DESC, started_at DESC, run_id DESC
      LIMIT ?
    `)
    .all(...values, limit) as unknown as BenchmarkRunRow[];

  return rows
    .map((row) => mapBenchmarkRunRow(row))
    .filter((row): row is BenchmarkRunRecord => row !== null);
}

export function insertBenchmarkCaseResultImpl(
  db: DatabaseSync,
  input: BenchmarkCaseResultInsert,
): BenchmarkCaseResultRecord {
  const caseResultId = randomUUID();
  const toolRunRow = db.prepare(`SELECT run_id FROM tool_runs WHERE run_id = ?`).get(input.toolRunId) as
    | { run_id: string }
    | undefined;

  if (!toolRunRow) {
    throw createBenchmarkLinkError(input.toolRunId);
  }

  try {
    db
      .prepare(`
        INSERT INTO benchmark_case_results(
          case_result_id,
          run_id,
          case_id,
          tool_run_id,
          outcome,
          actual_value
        )
        VALUES(?, ?, ?, ?, ?, ?)
      `)
      .run(
        caseResultId,
        input.runId,
        input.caseId,
        input.toolRunId,
        input.outcome,
        input.actualValue == null ? null : stringifyJson(input.actualValue),
      );
  } catch (error) {
    throw createBenchmarkRecordError("benchmark_case_results", error);
  }

  return getBenchmarkCaseResultImpl(db, caseResultId) as BenchmarkCaseResultRecord;
}

export function getBenchmarkCaseResultImpl(db: DatabaseSync, caseResultId: string): BenchmarkCaseResultRecord | null {
  const row = db
    .prepare(`
      SELECT case_result_id, run_id, case_id, tool_run_id, outcome, actual_value
      FROM benchmark_case_results
      WHERE case_result_id = ?
    `)
    .get(caseResultId) as BenchmarkCaseResultRow | undefined;

  return mapBenchmarkCaseResultRow(row);
}

export function listBenchmarkCaseResultsImpl(
  db: DatabaseSync,
  options: QueryBenchmarkCaseResultsOptions = {},
): BenchmarkCaseResultRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (options.runId) {
    clauses.push("run_id = ?");
    values.push(options.runId);
  }

  if (options.caseId) {
    clauses.push("case_id = ?");
    values.push(options.caseId);
  }

  if (options.outcome) {
    clauses.push("outcome = ?");
    values.push(options.outcome);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(`
      SELECT case_result_id, run_id, case_id, tool_run_id, outcome, actual_value
      FROM benchmark_case_results
      ${whereClause}
      ORDER BY case_result_id DESC
      LIMIT ?
    `)
    .all(...values, limit) as unknown as BenchmarkCaseResultRow[];

  return rows
    .map((row) => mapBenchmarkCaseResultRow(row))
    .filter((row): row is BenchmarkCaseResultRecord => row !== null);
}

export function insertBenchmarkAssertionResultImpl(
  db: DatabaseSync,
  input: BenchmarkAssertionResultInsert,
): BenchmarkAssertionResultRecord {
  const assertionResultId = randomUUID();

  try {
    db
      .prepare(`
        INSERT INTO benchmark_assertion_results(
          assertion_result_id,
          case_result_id,
          assertion_id,
          passed,
          actual_value,
          expected_value
        )
        VALUES(?, ?, ?, ?, ?, ?)
      `)
      .run(
        assertionResultId,
        input.caseResultId,
        input.assertionId,
        input.passed ? 1 : 0,
        input.actualValue == null ? null : stringifyJson(input.actualValue),
        stringifyJson(input.expectedValue),
      );
  } catch (error) {
    throw createBenchmarkRecordError("benchmark_assertion_results", error);
  }

  return getBenchmarkAssertionResultImpl(db, assertionResultId) as BenchmarkAssertionResultRecord;
}

export function getBenchmarkAssertionResultImpl(
  db: DatabaseSync,
  assertionResultId: string,
): BenchmarkAssertionResultRecord | null {
  const row = db
    .prepare(`
      SELECT
        assertion_result_id,
        case_result_id,
        assertion_id,
        passed,
        actual_value,
        expected_value
      FROM benchmark_assertion_results
      WHERE assertion_result_id = ?
    `)
    .get(assertionResultId) as BenchmarkAssertionResultRow | undefined;

  return mapBenchmarkAssertionResultRow(row);
}

export function listBenchmarkAssertionResultsImpl(
  db: DatabaseSync,
  options: QueryBenchmarkAssertionResultsOptions = {},
): BenchmarkAssertionResultRecord[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (options.caseResultId) {
    clauses.push("case_result_id = ?");
    values.push(options.caseResultId);
  }

  if (options.assertionId) {
    clauses.push("assertion_id = ?");
    values.push(options.assertionId);
  }

  if (options.passed != null) {
    clauses.push("passed = ?");
    values.push(options.passed ? 1 : 0);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 50;
  const rows = db
    .prepare(`
      SELECT
        assertion_result_id,
        case_result_id,
        assertion_id,
        passed,
        actual_value,
        expected_value
      FROM benchmark_assertion_results
      ${whereClause}
      ORDER BY assertion_result_id DESC
      LIMIT ?
    `)
    .all(...values, limit) as unknown as BenchmarkAssertionResultRow[];

  return rows
    .map((row) => mapBenchmarkAssertionResultRow(row))
    .filter((row): row is BenchmarkAssertionResultRecord => row !== null);
}
