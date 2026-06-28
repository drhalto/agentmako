import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizePath, openGlobalStore } from "../../packages/store/src/index.ts";
import { MakoToolError } from "../../packages/tools/src/errors.ts";
import { resolveProject } from "../../packages/tools/src/runtime.ts";
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

async function expectProjectContextAttachGuidance(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-project-context-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "unattached project");
  const nestedRoot = path.join(projectRoot, "packages", "app");
  const nestedCwd = path.join(nestedRoot, "src");
  mkdirSync(nestedCwd, { recursive: true });
  mkdirSync(path.join(projectRoot, ".git"));

  const globalStore = openGlobalStore({ homeDir: stateHome });
  try {
    await resolveProject(
      {},
      {
        sharedGlobalStore: globalStore,
        requestContext: {
          meta: { cwd: nestedCwd },
          getRoots: async () => [nestedRoot],
        },
      },
    );
    assert.fail("resolveProject should reject unmatched MCP roots/cwd");
  } catch (error) {
    assert.ok(error instanceof MakoToolError);
    assert.equal(error.code, "missing_project_context");
    assert.match(error.message, /MCP roots\/cwd did not match any attached Mako project/);
    assert.match(error.message, /agentmako connect/);
    assert.match(error.message, /--no-db/);

    const expectedProjectRef = normalizePath(realpathSync(projectRoot));
    assert.equal(error.details?.suggestedProjectRef, expectedProjectRef);
    assert.equal(
      error.details?.suggestedCommand,
      `agentmako connect "${expectedProjectRef}" --no-db`,
    );
    assert.equal(
      error.details?.suggestedAction,
      "Run the suggested command from a terminal, then retry the MCP tool call.",
    );

    const unmatchedLocations = error.details?.unmatchedLocations;
    assert.ok(Array.isArray(unmatchedLocations));
    assert.ok(
      unmatchedLocations.some(
        (entry) =>
          typeof entry === "object" &&
          entry != null &&
          !Array.isArray(entry) &&
          entry.source === "meta_cwd" &&
          entry.normalizedPath === normalizePath(realpathSync(nestedCwd)) &&
          entry.exists === true &&
          entry.suggestedProjectRoot === expectedProjectRef &&
          entry.suggestedProjectRootReason === "git_root",
      ),
      "expected unmatched location details to include _meta.cwd and discovered project root",
    );
  } finally {
    globalStore.close();
    rmSync(tmp, { recursive: true, force: true });
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
  await expectProjectContextAttachGuidance();

  console.log("tool-validation-errors: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
