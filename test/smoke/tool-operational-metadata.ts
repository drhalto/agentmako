import assert from "node:assert/strict";
import { MAKO_TOOL_NAMES, ToolAnnotationsSchema } from "../../packages/contracts/src/index.ts";
import {
  TOOL_DEFINITIONS,
  TOOL_OPERATIONAL_METADATA,
  attachToolHints,
  getToolOperationalMetadata,
  listToolDefinitions,
  orderByContextLayout,
} from "../../packages/tools/src/index.ts";

function schemaHasHints(schema: unknown): boolean {
  return JSON.stringify(schema).includes("\"_hints\"");
}

function main(): void {
  assert.deepEqual(
    Object.keys(TOOL_OPERATIONAL_METADATA).sort(),
    [...MAKO_TOOL_NAMES].sort(),
    "operational metadata must cover every built-in Mako tool",
  );

  for (const definition of TOOL_DEFINITIONS) {
    const metadata = getToolOperationalMetadata(definition.name);
    ToolAnnotationsSchema.parse(metadata.annotations);
    assert.deepEqual(
      definition.annotations,
      metadata.annotations,
      `${definition.name} must use centralized operational annotations`,
    );
  }

  const summaries = listToolDefinitions();
  for (const summary of summaries) {
    assert.ok(schemaHasHints(summary.outputSchema), `${summary.name} output schema exposes _hints`);
  }

  assert.equal(getToolOperationalMetadata("repo_map").annotations.openWorldHint, undefined);
  assert.equal(getToolOperationalMetadata("db_ping").annotations.openWorldHint, true);
  assert.equal("readOnlyHint" in getToolOperationalMetadata("finding_ack").annotations, false);
  assert.equal(getToolOperationalMetadata("finding_ack_batch").previewDecision, "required");

  const hinted = attachToolHints({
    toolName: "finding_ack",
    input: {},
    annotations: getToolOperationalMetadata("finding_ack").annotations,
    output: {
      toolName: "finding_ack",
      projectId: "project_test",
      preview: true,
      wouldApply: {
        category: "test",
        subjectKind: "ast_match",
        fingerprint: "fingerprint",
        status: "ignored",
        reason: "reviewed",
      },
    },
  });
  assert.ok(hinted._hints.some((hint) => hint.includes("Preview only")));

  const ordered = orderByContextLayout([
    { id: "middle" },
    { id: "end", layoutZone: "end" as const },
    { id: "start", layoutZone: "start" as const },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["start", "middle", "end"]);

  console.log("tool-operational-metadata: PASS");
}

main();
