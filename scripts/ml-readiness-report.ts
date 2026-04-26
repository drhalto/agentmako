import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type CountRow = { count: number };
type WindowRow = { count: number; oldest: string | null; newest: string | null };
type GradeRow = { grade: string; count: number };
type FamilyRow = { family: string; count: number };
type ToolRow = { toolName: string | null; calls: number; failed: number };

interface Metric {
  name: string;
  value: number | string;
  target: number | string;
  status: "ready" | "collecting" | "blocked";
  note: string;
}

const [inputPath = process.env.MAKO_ML_READINESS_PROJECT] = process.argv
  .slice(2)
  .filter((arg) => arg !== "--");

if (!inputPath) {
  throw new Error("Usage: pnpm ml:readiness -- <project-root-or-project.db>");
}

const dbPath = resolveDbPath(inputPath);

if (!existsSync(dbPath)) {
  throw new Error(`Mako project database not found: ${dbPath}`);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

try {
  const metrics = collectMetrics(db);
  printReport(dbPath, metrics);
} finally {
  db.close();
}

function resolveDbPath(input: string): string {
  const absolute = path.resolve(input);
  if (existsSync(absolute) && statSync(absolute).isFile()) {
    return absolute;
  }

  const makoAiDb = path.join(absolute, ".mako-ai", "project.db");
  if (existsSync(makoAiDb)) {
    return makoAiDb;
  }

  const makoDb = path.join(absolute, ".mako", "project.db");
  if (existsSync(makoDb)) {
    return makoDb;
  }

  return makoAiDb;
}

function collectMetrics(db: DatabaseSync): Metric[] {
  const files = countTable(db, "files");
  const chunks = countTable(db, "chunks");
  const symbols = countTable(db, "symbols");
  const routes = countTable(db, "routes");
  const importEdges = countTable(db, "import_edges");
  const embeddings = countTable(db, "harness_embeddings");
  const semanticUnits = countTable(db, "harness_semantic_units");
  const toolRuns = windowCount(db, "tool_runs", "started_at");
  const failedToolRuns = scalar(
    db,
    "tool_runs",
    "SELECT COUNT(*) AS count FROM tool_runs WHERE outcome != 'success'",
  );
  const answerTraces = countTable(db, "answer_traces");
  const sessions = countTable(db, "harness_sessions");
  const usefulness = windowCount(db, "mako_usefulness_events", "captured_at");
  const usefulnessGrades = rows<GradeRow>(
    db,
    "mako_usefulness_events",
    `
      SELECT grade, COUNT(*) AS count
      FROM mako_usefulness_events
      GROUP BY grade
      ORDER BY count DESC
    `,
  );
  const noOrPartialLabels = usefulnessGrades
    .filter((row) => row.grade === "no" || row.grade === "partial")
    .reduce((total, row) => total + row.count, 0);
  const ackCount = countTable(db, "finding_acks");
  const ackFamilies = rows<FamilyRow>(
    db,
    "finding_acks",
    `
      SELECT category AS family, COUNT(*) AS count
      FROM finding_acks
      GROUP BY category
      ORDER BY count DESC
    `,
  );
  const toolRows = rows<ToolRow>(
    db,
    "tool_runs",
    `
      SELECT tool_name AS toolName,
             COUNT(*) AS calls,
             SUM(CASE WHEN outcome != 'success' THEN 1 ELSE 0 END) AS failed
      FROM tool_runs
      GROUP BY tool_name
      ORDER BY calls DESC
      LIMIT 10
    `,
  );

  const topTools = toolRows
    .slice(0, 5)
    .map((row) => `${row.toolName ?? "unknown"}:${row.calls}`)
    .join(", ");
  const gradeSummary = usefulnessGrades
    .map((row) => `${row.grade}:${row.count}`)
    .join(", ") || "none";
  const ackFamilySummary = ackFamilies
    .slice(0, 5)
    .map((row) => `${row.family}:${row.count}`)
    .join(", ") || "none";

  return [
    metric(
      "repo corpus",
      files,
      1000,
      files >= 1000,
      files >= 200,
      `${chunks} chunks, ${symbols} symbols, ${routes} routes, ${importEdges} import edges`,
    ),
    metric(
      "embedding corpus",
      embeddings,
      5000,
      embeddings >= 5000,
      embeddings >= 1000,
      `${semanticUnits} semantic units`,
    ),
    metric(
      "tool-run volume",
      toolRuns.count,
      1000,
      toolRuns.count >= 1000,
      toolRuns.count >= 100,
      `window ${formatWindow(toolRuns)}; top tools ${topTools || "none"}`,
    ),
    metric(
      "negative/error signal",
      failedToolRuns + noOrPartialLabels,
      50,
      failedToolRuns + noOrPartialLabels >= 50,
      failedToolRuns + noOrPartialLabels >= 10,
      `${failedToolRuns} failed tool runs, ${noOrPartialLabels} partial/no labels`,
    ),
    metric(
      "usefulness labels",
      usefulness.count,
      "100+ with mixed grades",
      usefulness.count >= 100 && usefulnessGrades.length >= 2,
      usefulness.count >= 25,
      `window ${formatWindow(usefulness)}; grades ${gradeSummary}`,
    ),
    metric(
      "finding ack labels",
      ackCount,
      "100+ across 5+ families",
      ackCount >= 100 && ackFamilies.length >= 5,
      ackCount >= 25,
      `families ${ackFamilySummary}`,
    ),
    metric(
      "session diversity",
      sessions,
      20,
      sessions >= 20,
      sessions >= 5,
      "multiple sessions reduce one-task overfitting",
    ),
    metric(
      "answer traces",
      answerTraces,
      100,
      answerTraces >= 100,
      answerTraces >= 25,
      "needed for ranking and packet-quality evaluation",
    ),
  ];
}

function metric(
  name: string,
  value: number | string,
  target: number | string,
  ready: boolean,
  collecting: boolean,
  note: string,
): Metric {
  return {
    name,
    value,
    target,
    status: ready ? "ready" : collecting ? "collecting" : "blocked",
    note,
  };
}

function countTable(db: DatabaseSync, tableName: string): number {
  return scalar(db, tableName, `SELECT COUNT(*) AS count FROM ${tableName}`);
}

function scalar(db: DatabaseSync, tableName: string, sql: string): number {
  if (!tableExists(db, tableName)) {
    return 0;
  }
  const row = db.prepare(sql).get() as CountRow | undefined;
  return Number(row?.count ?? 0);
}

function windowCount(db: DatabaseSync, tableName: string, columnName: string): WindowRow {
  if (!tableExists(db, tableName)) {
    return { count: 0, oldest: null, newest: null };
  }
  return db
    .prepare(
      `SELECT COUNT(*) AS count, MIN(${columnName}) AS oldest, MAX(${columnName}) AS newest FROM ${tableName}`,
    )
    .get() as WindowRow;
}

function rows<T>(db: DatabaseSync, tableName: string, sql: string): T[] {
  if (!tableExists(db, tableName)) {
    return [];
  }
  return db.prepare(sql).all() as T[];
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as CountRow | undefined;
  return row !== undefined;
}

function printReport(dbPath: string, metrics: Metric[]): void {
  const ready = metrics.filter((item) => item.status === "ready").length;
  const collecting = metrics.filter((item) => item.status === "collecting").length;
  const blocked = metrics.filter((item) => item.status === "blocked").length;

  console.log(`\nML readiness report`);
  console.log(`db: ${dbPath}`);
  console.log(`summary: ${ready} ready, ${collecting} collecting, ${blocked} blocked\n`);

  console.table(metrics);

  console.log("\nRecommended interpretation:");
  if (ready >= 2) {
    console.log("- Corpus/eval work can start now: embeddings, offline evals, and deterministic reranking probes.");
  }
  if (blocked > 0) {
    console.log("- Supervised ML should wait until label volume, negative examples, and session diversity improve.");
  }
  if (collecting > 0 || blocked > 0) {
    console.log("- Keep capturing agent_feedback, finding_ack, context_packet usefulness, and failed tool runs.");
  }
}

function formatWindow(row: WindowRow): string {
  if (!row.oldest || !row.newest) {
    return "n/a";
  }
  return `${row.oldest} to ${row.newest}`;
}
