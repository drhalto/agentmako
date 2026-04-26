import { DatabaseSync } from "node:sqlite";

const DB_PATH = "C:/Users/Dustin/courseconnect/.mako-ai/project.db";
const db = new DatabaseSync(DB_PATH, { readOnly: true });

function rows<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

// --- Overall shape ---
section("mako_usefulness_events — overall");
const [{ total, earliest, latest }] = rows<{
  total: number;
  earliest: string | null;
  latest: string | null;
}>(
  `SELECT COUNT(*) AS total, MIN(captured_at) AS earliest, MAX(captured_at) AS latest FROM mako_usefulness_events`,
);
console.log(`total events: ${total}`);
console.log(`window: ${earliest ?? "n/a"}  →  ${latest ?? "n/a"}`);

section("By decisionKind");
console.table(
  rows(`
    SELECT decision_kind AS decisionKind, COUNT(*) AS count
    FROM mako_usefulness_events
    GROUP BY decision_kind
    ORDER BY count DESC
  `),
);

section("By grade");
console.table(
  rows(`
    SELECT grade, COUNT(*) AS count
    FROM mako_usefulness_events
    GROUP BY grade
    ORDER BY count DESC
  `),
);

section("By decisionKind + family (top 25)");
console.table(
  rows(`
    SELECT decision_kind AS decisionKind, family, COUNT(*) AS count,
           SUM(CASE WHEN grade = 'full' THEN 1 ELSE 0 END) AS "full",
           SUM(CASE WHEN grade = 'partial' THEN 1 ELSE 0 END) AS "partial",
           SUM(CASE WHEN grade = 'no' THEN 1 ELSE 0 END) AS "no"
    FROM mako_usefulness_events
    GROUP BY decision_kind, family
    ORDER BY count DESC
    LIMIT 25
  `),
);

section("By toolName (top 25)");
console.table(
  rows(`
    SELECT tool_name AS toolName, COUNT(*) AS count,
           SUM(CASE WHEN grade = 'no' THEN 1 ELSE 0 END) AS "no"
    FROM mako_usefulness_events
    WHERE tool_name IS NOT NULL
    GROUP BY tool_name
    ORDER BY count DESC
    LIMIT 25
  `),
);

section("Events per day (last 14 days)");
console.table(
  rows(`
    SELECT substr(captured_at, 1, 10) AS day, COUNT(*) AS count
    FROM mako_usefulness_events
    GROUP BY day
    ORDER BY day DESC
    LIMIT 14
  `),
);

section("Top reason codes (flattened; top 20)");
// reason_codes_json is a JSON array per row; unroll via json_each.
console.table(
  rows(`
    SELECT je.value AS reasonCode, COUNT(*) AS count
    FROM mako_usefulness_events, json_each(reason_codes_json) AS je
    GROUP BY je.value
    ORDER BY count DESC
    LIMIT 20
  `),
);

section("Failure cluster proxy: (tool, family) with grade='no'");
console.table(
  rows(`
    SELECT tool_name AS toolName, family, COUNT(*) AS failures
    FROM mako_usefulness_events
    WHERE grade = 'no'
    GROUP BY tool_name, family
    ORDER BY failures DESC
    LIMIT 15
  `),
);

// --- Adjacent signals ---

section("tool_runs — volume");
const [{ toolRuns, oldest, newest }] = rows<{
  toolRuns: number;
  oldest: string | null;
  newest: string | null;
}>(
  `SELECT COUNT(*) AS toolRuns, MIN(started_at) AS oldest, MAX(started_at) AS newest FROM tool_runs`,
);
console.log(`tool_runs rows: ${toolRuns}`);
console.log(`window: ${oldest ?? "n/a"}  →  ${newest ?? "n/a"}`);

section("tool_runs outcomes");
console.table(
  rows(`
    SELECT outcome, COUNT(*) AS count
    FROM tool_runs
    GROUP BY outcome
    ORDER BY count DESC
  `),
);

section("tool_runs — top 15 tools by volume");
console.table(
  rows(`
    SELECT tool_name AS toolName, COUNT(*) AS calls,
           SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success,
           SUM(CASE WHEN outcome != 'success' THEN 1 ELSE 0 END) AS failed
    FROM tool_runs
    GROUP BY tool_name
    ORDER BY calls DESC
    LIMIT 15
  `),
);

section("workflow_followups count");
const [{ followupCount }] = rows<{ followupCount: number }>(
  `SELECT COUNT(*) AS followupCount FROM workflow_followups`,
);
console.log(`workflow_followups rows: ${followupCount}`);

section("answer_traces count");
const [{ traceCount }] = rows<{ traceCount: number }>(
  `SELECT COUNT(*) AS traceCount FROM answer_traces`,
);
console.log(`answer_traces rows: ${traceCount}`);

section("finding_acks count (Phase 1)");
try {
  const [{ ackCount }] = rows<{ ackCount: number }>(
    `SELECT COUNT(*) AS ackCount FROM finding_acks`,
  );
  console.log(`finding_acks rows: ${ackCount}`);
} catch {
  console.log("finding_acks table not present (project not migrated to 0026 yet)");
}

db.close();
