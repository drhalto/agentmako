import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { ProjectFinding } from "../../packages/contracts/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";
import { openSqliteDatabase } from "../../packages/store/src/sqlite.ts";

const FINDING_COUNT = 500;
const FILE_COUNT = 50;
const PROJECT_P95_LIMIT_MS = 500;
const FILE_P95_LIMIT_MS = 200;
const DB_SIZE_LIMIT_BYTES = 16 * 1024 * 1024;

function now(): string {
  return new Date().toISOString();
}

function p95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function totalDbSizeBytes(dbPath: string): number {
  return [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
    .filter((candidate) => existsSync(candidate))
    .reduce((total, candidate) => total + statSync(candidate).size, 0);
}

function assertFailedMigrationRollsBack(tmp: string): void {
  const dbPath = path.join(tmp, "failed-migration.sqlite");
  assert.throws(
    () =>
      openSqliteDatabase(dbPath, [
        {
          version: 1,
          name: "ok",
          sql: "CREATE TABLE survives(id INTEGER PRIMARY KEY);",
        },
        {
          version: 2,
          name: "fails_and_rolls_back",
          sql: [
            "CREATE TABLE rolled_back(id INTEGER PRIMARY KEY);",
            "INSERT INTO missing_table(id) VALUES(1);",
          ].join("\n"),
        },
      ]),
    /Failed to apply migration 2/,
  );

  const db = new DatabaseSync(dbPath);
  try {
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
    assert.ok(tables.has("survives"), "prior committed migration should remain");
    assert.equal(tables.has("rolled_back"), false, "failed migration DDL should roll back");
    const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>;
    assert.deepEqual(versions.map((row) => row.version), [1]);
  } finally {
    db.close();
  }
}

function seedFindings(projectRoot: string): {
  projectId: string;
  projectP95Ms: number;
  fileP95Ms: number;
  dbSizeBytes: number;
} {
  const projectId = "reef_baseline_project";
  const store = openProjectStore({ projectRoot });
  try {
    const capturedAt = now();
    const freshness = {
      state: "fresh" as const,
      checkedAt: capturedAt,
      reason: "reef baseline fixture",
    };
    const findings: ProjectFinding[] = [];
    for (let index = 0; index < FINDING_COUNT; index++) {
      const filePath = `src/file-${index % FILE_COUNT}.ts`;
      const subject = { kind: "diagnostic" as const, path: filePath, code: "reef.baseline" };
      const subjectFingerprint = store.computeReefSubjectFingerprint(subject);
      findings.push({
        projectId,
        fingerprint: store.computeReefFindingFingerprint({
          source: "reef_rule:baseline",
          ruleId: "reef.baseline",
          subjectFingerprint,
          message: `Baseline finding ${index}`,
        }),
        source: "reef_rule:baseline",
        subjectFingerprint,
        overlay: "working_tree",
        severity: index % 3 === 0 ? "error" : "warning",
        status: "active",
        filePath,
        line: (index % 20) + 1,
        ruleId: "reef.baseline",
        freshness,
        capturedAt,
        message: `Baseline finding ${index}`,
        factFingerprints: [],
      });
    }

    store.replaceReefFindingsForSource({
      projectId,
      source: "reef_rule:baseline",
      overlay: "working_tree",
      findings,
    });

    const projectDurations: number[] = [];
    const fileDurations: number[] = [];
    for (let iteration = 0; iteration < 25; iteration++) {
      let started = performance.now();
      assert.equal(
        store.queryReefFindings({
          projectId,
          overlay: "working_tree",
          status: "active",
          limit: FINDING_COUNT,
        }).length,
        FINDING_COUNT,
      );
      projectDurations.push(performance.now() - started);

      started = performance.now();
      assert.equal(
        store.queryReefFindings({
          projectId,
          filePath: "src/file-0.ts",
          overlay: "working_tree",
          status: "active",
          limit: FINDING_COUNT,
        }).length,
        FINDING_COUNT / FILE_COUNT,
      );
      fileDurations.push(performance.now() - started);
    }

    store.checkpoint({ truncate: true });
    return {
      projectId,
      projectP95Ms: p95(projectDurations),
      fileP95Ms: p95(fileDurations),
      dbSizeBytes: totalDbSizeBytes(store.dbPath),
    };
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-migration-baseline-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  try {
    assertFailedMigrationRollsBack(tmp);

    const store = openProjectStore({ projectRoot });
    try {
      const migration = store.db
        .prepare("SELECT name FROM schema_migrations WHERE version = 30")
        .get() as { name: string } | undefined;
      assert.equal(migration?.name, "0030_project_reef_foundation");
      const tables = new Set(
        (store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
          .map((row) => row.name),
      );
      assert.ok(tables.has("reef_facts"));
      assert.ok(tables.has("reef_findings"));
      assert.ok(tables.has("reef_finding_events"));
      assert.ok(tables.has("reef_rule_descriptors"));
    } finally {
      store.close();
    }

    const reopened = openProjectStore({ projectRoot });
    try {
      const rows = reopened.db
        .prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 30")
        .get() as { count: number };
      assert.equal(rows.count, 1, "migration 30 should be idempotently recorded once");
    } finally {
      reopened.close();
    }

    const baseline = seedFindings(projectRoot);
    assert.ok(
      baseline.projectP95Ms < PROJECT_P95_LIMIT_MS,
      `project findings p95 ${baseline.projectP95Ms.toFixed(2)}ms exceeds ${PROJECT_P95_LIMIT_MS}ms`,
    );
    assert.ok(
      baseline.fileP95Ms < FILE_P95_LIMIT_MS,
      `file findings p95 ${baseline.fileP95Ms.toFixed(2)}ms exceeds ${FILE_P95_LIMIT_MS}ms`,
    );
    assert.ok(
      baseline.dbSizeBytes < DB_SIZE_LIMIT_BYTES,
      `reef baseline db size ${baseline.dbSizeBytes} exceeds ${DB_SIZE_LIMIT_BYTES}`,
    );

    console.log(
      `reef-migration-baseline: PASS projectP95Ms=${baseline.projectP95Ms.toFixed(2)} fileP95Ms=${baseline.fileP95Ms.toFixed(2)} dbSizeBytes=${baseline.dbSizeBytes}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
