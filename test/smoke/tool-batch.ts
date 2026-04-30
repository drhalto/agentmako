import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolBatchInputSchema, type ToolBatchToolOutput } from "../../packages/contracts/src/index.ts";
import { createProjectStoreCache, openProjectStore } from "../../packages/store/src/index.ts";
import { createHotIndexCache } from "../../packages/tools/src/hot-index/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { indexProject } from "../../services/indexer/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-tool-batch-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "tool-batch-smoke" }));
  writeFileSync(
    path.join(projectRoot, "src", "auth.ts"),
    [
      "export interface UserSession { id: string }",
      "export function getSession(): UserSession { return { id: 'u1' }; }",
    ].join("\n"),
  );

  const projectStoreCache = createProjectStoreCache();
  const hotIndexCache = createHotIndexCache();

  try {
    const indexed = await indexProject(projectRoot, { projectStoreCache });
    const output = await invokeTool(
      "tool_batch",
      {
        projectId: indexed.project.projectId,
        verbosity: "compact",
        ops: [
          { label: "status", tool: "project_index_status", args: { includeUnindexed: false } },
          { label: "map", tool: "repo_map", args: { maxFiles: 3 }, resultMode: "full" },
          { label: "packet", tool: "context_packet", args: { request: "auth user session type broke" } },
        ],
      },
      {
        projectStoreCache,
        hotIndexCache,
        requestContext: { requestId: "req_tool_batch_smoke" },
      },
    ) as ToolBatchToolOutput;

    assert.equal(output.toolName, "tool_batch");
    assert.equal(output.summary.requestedOps, 3);
    assert.equal(output.summary.executedOps, 3);
    assert.equal(output.summary.succeededOps, 3);
    assert.equal(output.summary.rejectedOps, 0);
    assert.equal(output.results.find((result) => result.label === "status")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "map")?.ok, true);
    assert.equal(output.results.find((result) => result.label === "packet")?.ok, true);
    assert.ok(
      output.results.find((result) => result.label === "status")?.resultSummary,
      "compact verbosity should return a summary for ops without resultMode: full",
    );
    assert.ok(output.results.find((result) => result.label === "map")?.result, "resultMode: full should keep full payload");

    const coercedTransportOutput = await invokeTool(
      "tool_batch",
      {
        projectId: indexed.project.projectId,
        verbosity: "compact",
        continueOnError: "true",
        ops: JSON.stringify([
          { label: "status", tool: "project_index_status", args: { includeUnindexed: "false" } },
          {
            label: "ast",
            tool: "ast_find_pattern",
            args: {
              pattern: "export function $NAME()",
              languages: JSON.stringify(["ts"]),
              maxMatches: "5",
            },
          },
        ]),
      },
      {
        projectStoreCache,
        hotIndexCache,
        requestContext: { requestId: "req_tool_batch_coerced_smoke" },
      },
    ) as ToolBatchToolOutput;

    assert.equal(coercedTransportOutput.summary.requestedOps, 2);
    assert.equal(coercedTransportOutput.summary.succeededOps, 2);
    assert.equal(coercedTransportOutput.results.find((result) => result.label === "status")?.ok, true);
    assert.equal(coercedTransportOutput.results.find((result) => result.label === "ast")?.ok, true);

    const noMatchLiveSearch = await invokeTool(
      "tool_batch",
      {
        projectId: indexed.project.projectId,
        verbosity: "compact",
        ops: [
          {
            label: "live-no-match",
            tool: "live_text_search",
            args: {
              query: "definitely_not_present_tool_batch_smoke",
              fixedStrings: true,
              pathGlob: "src/**/*.ts",
              maxMatches: 5,
            },
          },
        ],
      },
      {
        projectStoreCache,
        hotIndexCache,
        requestContext: { requestId: "req_tool_batch_live_no_match_smoke" },
      },
    ) as ToolBatchToolOutput;

    const liveNoMatchResult = noMatchLiveSearch.results.find((result) => result.label === "live-no-match");
    assert.equal(noMatchLiveSearch.summary.succeededOps, 1);
    assert.equal(liveNoMatchResult?.ok, true);
    assert.deepEqual(liveNoMatchResult?.resultSummary?.matches, { count: 0 });
    assert.deepEqual(liveNoMatchResult?.resultSummary?.filesMatched, { count: 0 });

    const mutationInput = ToolBatchInputSchema.safeParse({
      projectId: indexed.project.projectId,
      ops: [{ label: "refresh", tool: "project_index_refresh", args: { mode: "force" } }],
    });
    assert.equal(mutationInput.success, false, "tool_batch schema should exclude mutation tools");

    const recursiveInput = ToolBatchInputSchema.safeParse({
      projectId: indexed.project.projectId,
      ops: [{ label: "recursive", tool: "tool_batch", args: { ops: [] } }],
    });
    assert.equal(recursiveInput.success, false, "tool_batch schema should exclude recursive tool_batch ops");

    const store = openProjectStore({ projectRoot });
    try {
      const events = store.queryUsefulnessEvents({
        decisionKind: "wrapper_usefulness",
        family: "tool_batch",
      });
      assert.ok(events.length >= 1, "tool_batch should emit wrapper telemetry");
      assert.equal(events.some((event) => event.requestId === "req_tool_batch_smoke"), true);
    } finally {
      store.close();
    }

    console.log("tool-batch: PASS");
  } finally {
    hotIndexCache.flush();
    projectStoreCache.flush();
    if (originalStateHome === undefined) {
      delete process.env.MAKO_STATE_HOME;
    } else {
      process.env.MAKO_STATE_HOME = originalStateHome;
    }
    if (originalStateDirName === undefined) {
      delete process.env.MAKO_STATE_DIRNAME;
    } else {
      process.env.MAKO_STATE_DIRNAME = originalStateDirName;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
