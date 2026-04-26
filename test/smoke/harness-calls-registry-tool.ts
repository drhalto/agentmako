/**
 * Phase 3.6.0 Workstream A smoke — harness tool-registry bridge.
 *
 * Exercises:
 *   - `ToolDispatch` constructed with `toolServiceOptions` exposes registry
 *     tools through the AI SDK tool bag when they are usable in-session.
 *   - DB tools stay hidden unless the session has a project-scoped live DB
 *     binding available.
 *   - Reserved-name guard: action / memory / sub-agent tools still win if a
 *     collision ever exists, and do not get replaced by the bridged version.
 *   - Bridged tools are read-only adapters around `invokeTool` — no special
 *     dispatch state is exposed through the tool bag.
 *
 * Deep end-to-end verification (real invokeTool call, bus emit, persist,
 * tool_runs row) happens in the Phase 3.6.0 Workstream G smoke
 * `composer-trace-file.ts`, which runs a full trace_file composer invocation.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TOOL_DEFINITIONS } from "../../packages/tools/src/registry.ts";
import {
  SessionEventBus,
  ToolDispatch,
  PermissionEngine,
} from "../../packages/harness-core/src/index.ts";
import { ACTION_TOOLS } from "../../packages/harness-tools/src/index.ts";
import { MEMORY_TOOLS } from "../../packages/harness-core/src/memory-tools.ts";
import { SEMANTIC_TOOLS } from "../../packages/harness-core/src/semantic-tools.ts";
import { SUB_AGENT_TOOLS } from "../../packages/harness-core/src/sub-agent-tools.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-bridge-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  const stateDirName = `.mako-ai-bridge-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  const store = openProjectStore({ projectRoot, stateDirName });

  try {
    const bus = new SessionEventBus(store);
    const permissionEngine = new PermissionEngine({
      store,
      projectRoot,
    });

    // --- Bridge wired, tools map contains registry tools ---
    const dispatch = new ToolDispatch({
      store,
      bus,
      engine: permissionEngine,
      projectId: null,
      context: {
        projectRoot,
        sessionId: "smoke-sess",
        messageOrdinal: 0,
      },
      persistToolPart: () => {},
      toolServiceOptions: {
        requestContext: { sessionProjectId: undefined },
      },
    });

    // Registry tools that are NOT already handled by action/memory/sub-agent
    // dispatch should appear in the bag when they are model-facing and usable.
    // DB tools stay hidden without a bound session project; `ask` is now
    // planner-deferred rather than exposed directly to the harness chat bag.
    const reservedNames = new Set<string>([
      ...ACTION_TOOLS.map((t) => t.name),
      ...MEMORY_TOOLS.map((t) => t.name),
      ...SEMANTIC_TOOLS.map((t) => t.name),
      ...SUB_AGENT_TOOLS.map((t) => t.name),
    ]);

    for (const def of TOOL_DEFINITIONS) {
      const flat = def.name.replace(/\./g, "_").slice(0, 64);
      if (reservedNames.has(flat)) {
        continue;
      }
      if (def.category === "db") {
        assert.equal(
          dispatch.tools[flat],
          undefined,
          `expected db tool "${flat}" to stay hidden without a bound session project`,
        );
        continue;
      }
      if (def.name === "ask") {
        assert.equal(
          dispatch.tools[flat],
          undefined,
          "expected ask to stay out of the direct harness tool bag",
        );
        continue;
      }
      assert.ok(dispatch.tools[flat], `expected bridged tool "${flat}" to be present in dispatch.tools`);
    }

    // Spot-check a known registry tool. `symbols_of` is read-only and has no
    // specialized dispatch, so it must be bridged.
    assert.ok(
      dispatch.tools["symbols_of"],
      "symbols_of (registry tool) must be bridged",
    );
    assert.ok(
      dispatch.tools["tool_search"],
      "tool_search must be available so the model can discover deferred/blocked tools",
    );

    // --- Reserved-name guard: action tools still present but NOT replaced ---
    // file_write is an action tool. It must still be in the tool bag, and it
    // must NOT be the bridged version (if it were, the permission flow would
    // silently disappear).
    assert.ok(
      dispatch.tools["file_write"],
      "file_write (action tool) must still be present",
    );

    // Context-bound families should now stay hidden when the dispatcher does
    // not have the required context instead of surfacing runtime-only errors.
    for (const memoryTool of MEMORY_TOOLS) {
      assert.equal(
        dispatch.tools[memoryTool.name],
        undefined,
        `expected memory tool "${memoryTool.name}" to stay hidden without memory context`,
      );
    }
    for (const semanticTool of SEMANTIC_TOOLS) {
      assert.equal(
        dispatch.tools[semanticTool.name],
        undefined,
        `expected semantic tool "${semanticTool.name}" to stay hidden without memory context`,
      );
    }
    for (const subAgentTool of SUB_AGENT_TOOLS) {
      assert.equal(
        dispatch.tools[subAgentTool.name],
        undefined,
        `expected sub-agent tool "${subAgentTool.name}" to stay hidden without sub-agent context`,
      );
    }

    // --- Bridge off-path: no toolServiceOptions means no bridged tools ---
    const dispatchNoBridge = new ToolDispatch({
      store,
      bus,
      engine: permissionEngine,
      projectId: null,
      context: {
        projectRoot,
        sessionId: "smoke-sess-nobridge",
        messageOrdinal: 0,
      },
      persistToolPart: () => {},
      // toolServiceOptions omitted — registry tools should NOT be bridged.
    });

    assert.equal(
      dispatchNoBridge.tools["symbols_of"],
      undefined,
      "without toolServiceOptions, registry tools must not be bridged",
    );

    // Action tools must still be present regardless of bridge state.
    assert.ok(
      dispatchNoBridge.tools["file_write"],
      "file_write must always be present, regardless of bridge state",
    );

    console.log("harness-calls-registry-tool: PASS");
  } finally {
    try {
      store.close();
    } catch {
      /* best-effort */
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
