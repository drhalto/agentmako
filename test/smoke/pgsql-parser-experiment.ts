import assert from "node:assert/strict";
import { runPgsqlParserExperiment } from "../../services/indexer/src/schema-sources/pgsql-parser-experiment.ts";

async function main(): Promise<void> {
  const sql = [
    "CREATE TABLE public.todos (",
    "  id bigint PRIMARY KEY,",
    "  title text NOT NULL",
    ");",
    "",
    "CREATE OR REPLACE FUNCTION public.touch_todo(todo_id bigint)",
    "RETURNS void",
    "LANGUAGE plpgsql",
    "AS $$",
    "BEGIN",
    "  UPDATE public.todos SET title = title WHERE id = todo_id;",
    "END;",
    "$$;",
    "",
  ].join("\n");

  const result = await runPgsqlParserExperiment("supabase/migrations/001.sql", sql);

  assert.equal(result.parserStatus, "parsed");
  assert.equal(result.statementCount, 2);
  assert.ok(result.statementKinds.some((statement) => statement.kind === "CreateStmt" && statement.objectName === "public.todos"));
  assert.ok(result.statementKinds.some((statement) => statement.kind === "CreateFunctionStmt" && statement.objectName === "public.touch_todo"));
  assert.ok(result.currentExtractor.schemaObjectCount >= 2);
  assert.ok(result.currentExtractor.pgObjectCount >= 1);
  assert.equal(result.recommendation, "park_for_normalization");

  console.log("pgsql-parser-experiment: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
