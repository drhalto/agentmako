import assert from "node:assert/strict";
import { MakoToolError } from "../../packages/tools/src/errors.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";

async function expectSuggestion(args: {
  toolName: string;
  input: Record<string, unknown>;
  received: string;
  expected: string;
}): Promise<void> {
  try {
    await invokeTool(args.toolName, args.input);
    assert.fail(`${args.toolName} should reject invalid input`);
  } catch (error) {
    assert.ok(error instanceof MakoToolError);
    assert.equal(error.code, "invalid_tool_input");
    assert.match(error.message, /Tool input validation failed/);
    assert.match(error.message, new RegExp(`"${args.received}" \\(did you mean "${args.expected}"\\?\\)`));
    assert.ok(error.message.includes("Expected top-level fields:"));
    const suggestions = error.details?.suggestions;
    assert.ok(Array.isArray(suggestions));
    assert.equal(
      suggestions.some((suggestion) =>
        typeof suggestion === "object" &&
        suggestion != null &&
        !Array.isArray(suggestion) &&
        suggestion.received === args.received &&
        suggestion.expected === args.expected
      ),
      true,
    );
  }
}

async function main(): Promise<void> {
  await expectSuggestion({
    toolName: "file_facts",
    input: { projectId: "proj_smoke", path: "src/auth.ts" },
    received: "path",
    expected: "filePath",
  });
  await expectSuggestion({
    toolName: "cross_search",
    input: { projectId: "proj_smoke", query: "supabase.rpc(" },
    received: "query",
    expected: "term",
  });
  await expectSuggestion({
    toolName: "db_table_schema",
    input: { projectId: "proj_smoke", tableName: "users", schemaName: "public" },
    received: "tableName",
    expected: "table",
  });
  await expectSuggestion({
    toolName: "db_table_schema",
    input: { projectId: "proj_smoke", tableName: "users", schemaName: "public" },
    received: "schemaName",
    expected: "schema",
  });

  console.log("tool-validation-errors: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
