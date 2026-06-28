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

function assertRetrievalPlanGuide(output: MakoHelpToolOutput, sourceStepId = "context") {
  const guide = output.retrievalPlanGuide;
  assert.ok(guide, "expected retrieval plan guide");
  assert.equal(guide.sourceStepId, sourceStepId);
  assert.equal(guide.planPath, "retrievalDiagnostics.retrievalPlan");
  assert.equal(guide.recommendedToolsPath, "retrievalDiagnostics.retrievalPlan.recommendedTools");
  assert.equal(guide.recommendedFollowUpsPath, "retrievalDiagnostics.retrievalPlan.recommendedFollowUps");
  assert.equal(guide.expandableToolsPath, "expandableTools");
  assert.equal(guide.requiredEvidencePath, "retrievalDiagnostics.retrievalPlan.requiredEvidence");
  assert.equal(guide.evidenceGapsPath, "retrievalDiagnostics.retrievalPlan.evidenceGaps");
  assert.equal(guide.preferToolBatch, true);
  assert.ok(
    guide.evidenceGate.includes("evidenceGaps") &&
      guide.evidenceGate.includes("requiredEvidence") &&
      guide.evidenceGate.includes("recommendedFollowUps"),
    "retrieval plan guide should make evidence and expansion requirements explicit",
  );
  assert.deepEqual(
    guide.strategyActions.map((entry) => entry.strategy),
    ["entity_lookup", "graph_expansion", "literal_search", "hybrid"],
  );
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
  assert.equal(auth.steps[0]?.toolName, "reef_ask");
  assert.equal((step(auth, "reef-ask").suggestedArgs as { question?: unknown }).question, "audit auth flow for tenant scoped dashboard role checks");
  assert.deepEqual(
    (step(auth, "reef-ask").suggestedArgs as { focusRoutes?: unknown }).focusRoutes,
    ["/dashboard"],
  );
  assert.equal(step(auth, "auth-path").toolName, "auth_path");
  assert.equal((step(auth, "auth-path").suggestedArgs as { route?: unknown }).route, "/dashboard");
  assert.equal(step(auth, "file-preflight").toolName, "file_preflight");
  assert.equal(
    (step(auth, "file-preflight").suggestedArgs as { filePath?: unknown }).filePath,
    "app/dashboard/layout.tsx",
  );
  assert.equal(step(auth, "lint-after-edit").toolName, "lint_files");
  assert.equal(step(auth, "lint-after-edit").readOnly, false);
  assert.equal(auth.batchHint.eligibleStepIds.includes("reef-ask"), false);
  assert.ok(auth.batchHint.eligibleStepIds.includes("auth-path"));
  assert.equal(auth.batchHint.eligibleStepIds.includes("lint-after-edit"), false);
  assert.equal((auth.batchHint.suggestedArgs as { projectId?: unknown }).projectId, "project_auth");
  assert.equal(typeof (auth.batchHint.suggestedArgs as { maxConcurrency?: unknown }).maxConcurrency, "number");
  assert.equal(auth.retrievalPlanGuide, null);

  const db = MakoHelpToolOutputSchema.parse(await invokeTool("mako_help", {
    task: "audit RLS for admin_audit_log",
    table: "admin_audit_log",
  }));
  assert.equal(db.recipeId, "db_schema_rls_audit");
  assert.equal(db.steps[0]?.toolName, "reef_ask");
  assert.deepEqual(
    (step(db, "reef-ask").suggestedArgs as { focusDatabaseObjects?: unknown }).focusDatabaseObjects,
    ["admin_audit_log"],
  );
  assert.equal(step(db, "context").toolName, "context_packet");
  assert.deepEqual(
    (step(db, "context").suggestedArgs as { focusDatabaseObjects?: unknown }).focusDatabaseObjects,
    ["admin_audit_log"],
  );
  assert.equal((step(db, "context").suggestedArgs as { mode?: unknown }).mode, "review");
  assert.equal(step(db, "table-schema").toolName, "db_table_schema");
  assert.equal((step(db, "table-schema").suggestedArgs as { table?: unknown }).table, "admin_audit_log");
  assert.ok(db.batchHint.eligibleStepIds.includes("table-neighborhood"));
  assertRetrievalPlanGuide(db);

  const general = MakoHelpToolOutputSchema.parse(await invokeTool("mako_help", {
    task: "understand how this feature is wired",
    maxSteps: 4,
  }));
  assert.equal(general.recipeId, "general_orientation");
  assert.equal(general.steps.length, 4);
  assert.equal(general.steps[0]?.toolName, "reef_ask");
  assert.equal(step(general, "repo-map").toolName, "repo_map");
  assert.ok(general.batchHint.eligibleStepIds.includes("repo-map"));
  assert.equal(typeof (general.batchHint.suggestedArgs as { maxConcurrency?: unknown }).maxConcurrency, "number");
  assert.ok(general.steps.some((entry) => entry.toolName === "cross_search"));
  assertRetrievalPlanGuide(general);

  const truncatedGeneral = MakoHelpToolOutputSchema.parse(await invokeTool("mako_help", {
    task: "understand how this feature is wired",
    maxSteps: 1,
  }));
  assert.equal(truncatedGeneral.steps.length, 1);
  assert.equal(truncatedGeneral.steps[0]?.toolName, "reef_ask");
  assert.equal(
    truncatedGeneral.retrievalPlanGuide,
    null,
    "mako_help should not expose a context_packet retrieval guide when maxSteps removed the context step",
  );

  const anchoredGeneral = MakoHelpToolOutputSchema.parse(await invokeTool("mako_help", {
    task: "understand checkout flow wiring",
    focusFiles: ["app/checkout/page.tsx"],
    changedFiles: ["lib/checkout.ts"],
    focusRoutes: ["/checkout"],
    focusSymbols: ["loadCheckout"],
    focusDatabaseObjects: ["public.checkout_sessions"],
    maxSteps: 3,
  }));
  assert.equal(anchoredGeneral.recipeId, "general_orientation");
  assert.deepEqual(
    (step(anchoredGeneral, "reef-ask").suggestedArgs as { focusFiles?: unknown }).focusFiles,
    ["app/checkout/page.tsx"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "reef-ask").suggestedArgs as { changedFiles?: unknown }).changedFiles,
    ["lib/checkout.ts"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "reef-ask").suggestedArgs as { focusRoutes?: unknown }).focusRoutes,
    ["/checkout"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "reef-ask").suggestedArgs as { focusSymbols?: unknown }).focusSymbols,
    ["loadCheckout"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "reef-ask").suggestedArgs as { focusDatabaseObjects?: unknown }).focusDatabaseObjects,
    ["public.checkout_sessions"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "context").suggestedArgs as { changedFiles?: unknown }).changedFiles,
    ["lib/checkout.ts"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "context").suggestedArgs as { focusRoutes?: unknown }).focusRoutes,
    ["/checkout"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "context").suggestedArgs as { focusSymbols?: unknown }).focusSymbols,
    ["loadCheckout"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "context").suggestedArgs as { focusDatabaseObjects?: unknown }).focusDatabaseObjects,
    ["public.checkout_sessions"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "repo-map").suggestedArgs as { focusFiles?: unknown }).focusFiles,
    ["app/checkout/page.tsx", "lib/checkout.ts"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "repo-map").suggestedArgs as { focusRoutes?: unknown }).focusRoutes,
    ["/checkout"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "repo-map").suggestedArgs as { focusSymbols?: unknown }).focusSymbols,
    ["loadCheckout"],
  );
  assert.deepEqual(
    (step(anchoredGeneral, "repo-map").suggestedArgs as { focusDatabaseObjects?: unknown }).focusDatabaseObjects,
    ["public.checkout_sessions"],
  );
  assert.ok(anchoredGeneral.batchHint.eligibleStepIds.includes("repo-map"));
  assertRetrievalPlanGuide(anchoredGeneral);

  const fileEditLiteral = MakoHelpToolOutputSchema.parse(await invokeTool("mako_help", {
    projectId: "project_literal",
    task: "fix the displayed text \"Welcome\" in the banner component",
    focusFiles: ["components/Banner.tsx"],
  }));
  assert.equal(fileEditLiteral.recipeId, "file_edit_preflight");
  assert.deepEqual(
    step(fileEditLiteral, "exact-text").suggestedArgs,
    {
      projectId: "project_literal",
      query: "Welcome",
      fixedStrings: true,
      maxMatches: 50,
    },
    "mako_help should suggest a bounded exact search for the quoted literal",
  );

  const duplicateRpc = MakoHelpToolOutputSchema.parse(await invokeTool("mako_help", {
    task: "find duplicates including RPCs",
  }));
  assert.equal(duplicateRpc.recipeId, "general_orientation");
  assert.equal(duplicateRpc.steps[0]?.toolName, "reef_ask");
  assert.ok(duplicateRpc.steps.some((entry) => entry.toolName === "context_packet"));
  assert.equal(
    duplicateRpc.steps.some((entry) => entry.toolName === "db_table_schema"),
    false,
    "duplicate search should not jump to DB-object inspection only because RPCs are mentioned",
  );
  assert.ok(
    duplicateRpc.notes.some((note) => note.includes("duplicate or structural search")),
    "general recipe should explain why DB terms do not force DB tooling",
  );

  console.log("mako-help: PASS");
}

main().catch((error) => {
  console.error("mako-help: FAIL");
  console.error(error);
  process.exit(1);
});
