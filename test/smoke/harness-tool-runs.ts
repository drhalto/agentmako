import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PermissionEngine,
  SessionEventBus,
  ToolDispatch,
} from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

function payloadMeta(payload: unknown): {
  toolFamily?: string;
  sessionId?: string;
  callId?: string;
} {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  return payload as {
    toolFamily?: string;
    sessionId?: string;
    callId?: string;
  };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-harness-tool-runs-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(path.join(projectRoot, ".mako"), { recursive: true });
  writeFileSync(path.join(projectRoot, "README.md"), "# Test\n\nHello world.\n");
  writeFileSync(
    path.join(projectRoot, ".mako", "permissions.json"),
    JSON.stringify({
      rules: [{ permission: "file_edit", pattern: "README.md", action: "allow" }],
    }),
  );

  const stateDirName = `.mako-ai-tool-runs-${process.pid}`;
  const projectId = "proj-tool-runs";
  process.env.MAKO_STATE_HOME = tmp;

  const store = openProjectStore({ projectRoot, stateDirName });

  try {
    const session = store.createHarnessSession({
      projectId,
      tier: "cloud-agent",
      activeProvider: "mock",
      activeModel: "mock-model",
    });
    const noMemorySession = store.createHarnessSession({
      projectId,
      tier: "cloud-agent",
      activeProvider: "mock",
      activeModel: "mock-model",
    });

    const bus = new SessionEventBus(store);
    const engine = new PermissionEngine({ store, projectRoot });

    const dispatch = new ToolDispatch({
      store,
      bus,
      engine,
      projectId,
      context: {
        projectRoot,
        sessionId: session.sessionId,
        messageOrdinal: 0,
      },
      memoryContext: {
        store,
        projectId,
        embeddingProvider: null,
      },
      persistToolPart: () => undefined,
    });

    const noMemoryDispatch = new ToolDispatch({
      store,
      bus,
      engine,
      projectId,
      context: {
        projectRoot,
        sessionId: noMemorySession.sessionId,
        messageOrdinal: 1,
      },
      persistToolPart: () => undefined,
    });

    await (
      dispatch.tools.file_edit!.execute as (args: {
        path: string;
        oldString: string;
        newString: string;
      }) => Promise<unknown>
    )({
      path: "README.md",
      oldString: "Hello world.",
      newString: "Hello, mako.",
    });

    await (
      dispatch.tools.memory_remember!.execute as (args: {
        text: string;
        category?: string;
      }) => Promise<unknown>
    )({
      text: "attendance window opens 10 minutes before class",
      category: "product",
    });

    await (
      dispatch.tools.semantic_search!.execute as (args: {
        query: string;
        kinds: Array<"memory">;
      }) => Promise<unknown>
    )({
      query: "attendance window",
      kinds: ["memory"],
    });

    assert.equal(
      typeof noMemoryDispatch.tools.memory_list,
      "undefined",
      "memory tools should be hidden when no memory context is bound",
    );
    const blockedSearch = (await (
      noMemoryDispatch.tools.tool_search!.execute as (args: {
        query: string;
        limit?: number;
      }) => Promise<{
        results: Array<{
          name: string;
          availability: string;
          reason: string | null;
        }>;
      }>
    )({
      query: "memory_list",
      limit: 5,
    })) as {
      results: Array<{
        name: string;
        availability: string;
        reason: string | null;
      }>;
    };
    const blockedMemory = blockedSearch.results.find((item) => item.name === "memory_list");
    assert.ok(blockedMemory, "tool_search should still surface blocked memory tools");
    assert.equal(blockedMemory.availability, "blocked");
    assert.match(blockedMemory.reason ?? "", /no memory context/i);

    const runs = store.queryToolRuns({ limit: 20 });
    assert.equal(runs.length, 3, `expected 3 internal tool_runs rows, got ${runs.length}`);

    const fileEditRun = runs.find((row) => row.toolName === "file_edit");
    assert.ok(fileEditRun, "expected file_edit tool_runs row");
    assert.equal(fileEditRun.outcome, "success");
    assert.equal(fileEditRun.projectId, projectId);
    assert.equal(payloadMeta(fileEditRun.payload).toolFamily, "action");
    assert.equal(payloadMeta(fileEditRun.payload).sessionId, session.sessionId);
    assert.equal(typeof payloadMeta(fileEditRun.payload).callId, "string");

    const rememberRun = runs.find((row) => row.toolName === "memory_remember");
    assert.ok(rememberRun, "expected memory_remember tool_runs row");
    assert.equal(rememberRun.outcome, "success");
    assert.equal(payloadMeta(rememberRun.payload).toolFamily, "memory");

    const semanticRun = runs.find((row) => row.toolName === "semantic_search");
    assert.ok(semanticRun, "expected semantic_search tool_runs row");
    assert.equal(semanticRun.outcome, "success");
    assert.equal(payloadMeta(semanticRun.payload).toolFamily, "semantic");

    const memoryListRun = runs.find((row) => row.toolName === "memory_list");
    assert.equal(memoryListRun, undefined, "hidden blocked tools should not emit tool_runs rows");

    console.log("harness-tool-runs: PASS");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
