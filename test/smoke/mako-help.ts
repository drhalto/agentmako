import assert from "node:assert/strict";
import {
  MakoHelpToolOutputSchema,
  type MakoHelpToolOutput,
} from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

function step(output: MakoHelpToolOutput, id: string) {
  const found = output.steps.find((entry) => entry.id === id);
  assert.ok(found, `expected step ${id}`);
  return found;
}

async function main(): Promise<void> {
  const auth = MakoHelpToolOutputSchema.parse(await invokeTool("mako_help", {
    projectId: "project_auth",
    task: "audit auth flow for tenant scoped dashboard role checks",
    focusFiles: ["app/dashboard/layout.tsx"],
    changedFiles: ["app/dashboard/layout.tsx"],
    route: "/dashboard",
  }));

  assert.equal(auth.toolName, "mako_help");
  assert.equal(auth.recipeId, "auth_flow_audit");
  assert.equal(auth.steps[0]?.toolName, "context_packet");
  assert.equal(step(auth, "auth-path").toolName, "auth_path");
  assert.equal((step(auth, "auth-path").suggestedArgs as { route?: unknown }).route, "/dashboard");
  assert.equal(step(auth, "file-preflight").toolName, "file_preflight");
  assert.equal(
    (step(auth, "file-preflight").suggestedArgs as { filePath?: unknown }).filePath,
    "app/dashboard/layout.tsx",
  );
  assert.equal(step(auth, "lint-after-edit").toolName, "lint_files");
  assert.equal(step(auth, "lint-after-edit").readOnly, false);
  assert.ok(auth.batchHint.eligibleStepIds.includes("auth-path"));
  assert.equal(auth.batchHint.eligibleStepIds.includes("lint-after-edit"), false);
  assert.equal((auth.batchHint.suggestedArgs as { projectId?: unknown }).projectId, "project_auth");

  const db = MakoHelpToolOutputSchema.parse(await invokeTool("mako_help", {
    task: "audit RLS for admin_audit_log",
    table: "admin_audit_log",
  }));
  assert.equal(db.recipeId, "db_schema_rls_audit");
  assert.equal(step(db, "table-schema").toolName, "db_table_schema");
  assert.equal((step(db, "table-schema").suggestedArgs as { table?: unknown }).table, "admin_audit_log");
  assert.ok(db.batchHint.eligibleStepIds.includes("table-neighborhood"));

  const general = MakoHelpToolOutputSchema.parse(await invokeTool("mako_help", {
    task: "understand how this feature is wired",
    maxSteps: 3,
  }));
  assert.equal(general.recipeId, "general_orientation");
  assert.equal(general.steps.length, 3);
  assert.ok(general.steps.some((entry) => entry.toolName === "cross_search"));

  console.log("mako-help: PASS");
}

main().catch((error) => {
  console.error("mako-help: FAIL");
  console.error(error);
  process.exit(1);
});
