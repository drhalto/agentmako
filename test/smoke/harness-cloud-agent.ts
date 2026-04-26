/**
 * Phase 3.1 acceptance smoke (model side).
 *
 * Spins up a local mock OpenAI-compatible HTTP server, registers a custom
 * provider that points at it, creates a session targeted at that provider,
 * posts a message, and asserts that:
 *
 *   - the harness emits text.delta and turn.done
 *   - a `harness_provider_calls` row lands with ok=1
 *   - the assistant message persists with the mocked text content
 *
 * No real cloud provider is touched. The mock exposes
 * `POST /v1/chat/completions` with streaming SSE chunks the way the
 * `@ai-sdk/openai-compatible` adapter expects.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiService } from "../../services/api/src/service.ts";
import { createHarness } from "../../packages/harness-core/src/index.ts";
import {
  ProviderRegistry,
} from "../../packages/harness-core/src/index.ts";
import type { EmittedSessionEvent } from "../../packages/harness-core/src/event-bus.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";
import { cleanupSmokeStateDir } from "./state-cleanup.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.MAKO_STATE_HOME = os.tmpdir();
const stateDirName = `.mako-ai-cloud-agent-${Date.now()}-${process.pid}`;
const homeStateDir = path.join(os.tmpdir(), stateDirName);
const projectStateDir = path.join(repoRoot, stateDirName);
const repoManifestDir = path.join(repoRoot, ".mako");
const repoManifestExisted = existsSync(repoManifestDir);

function cleanup(): void {
  cleanupSmokeStateDir(homeStateDir);
  cleanupSmokeStateDir(projectStateDir);
  if (!repoManifestExisted) {
    rmSync(repoManifestDir, { recursive: true, force: true });
  }
}

async function startMockProvider(): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      // Drain body
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const chunks = [
          "Hello",
          " from",
          " the",
          " mock",
          " provider",
          ".",
        ];
        const id = "chatcmpl-mock-1";
        const created = Math.floor(Date.now() / 1000);
        for (const piece of chunks) {
          const payload = {
            id,
            object: "chat.completion.chunk",
            created,
            model: "mock-model",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: piece },
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
        const finalPayload = {
          id,
          object: "chat.completion.chunk",
          created,
          model: "mock-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
        };
        res.write(`data: ${JSON.stringify(finalPayload)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-model" }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("mock server failed to bind");
  return { server, baseURL: `http://127.0.0.1:${address.port}/v1` };
}

async function waitForKind(
  events: EmittedSessionEvent[],
  kind: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.some((e) => e.event.kind === kind)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${kind}`);
}

async function main(): Promise<void> {
  cleanup();
  const options = {
    configOverrides: {
      stateDirName,
      databaseTools: { enabled: false },
    },
  };
  const api = createApiService(options);
  let store: ReturnType<typeof openProjectStore> | undefined;
  let mock: { server: Server; baseURL: string } | undefined;

  try {
    api.attachProject(repoRoot);
    await api.indexProject(repoRoot);
    const status = api.getProjectStatus(repoRoot);
    assert.ok(status?.project, "expected attached project for cloud-agent smoke");

    mock = await startMockProvider();

    store = openProjectStore({ projectRoot: repoRoot, stateDirName });

    const registry = new ProviderRegistry({ noConfig: true });
    registry.upsert({
      id: "mock",
      name: "Mock provider",
      kind: "chat",
      transport: "openai-compatible",
      baseURL: mock.baseURL,
      auth: "none",
      envVarHints: [],
      models: [
        {
          id: "mock-model",
          displayName: "Mock model",
          contextWindow: 8192,
          supportsTools: false,
          supportsVision: false,
          supportsReasoning: false,
          tier: "cloud",
        },
      ],
      tier: "cloud",
    });

    const harness = createHarness({
      store,
      providerRegistry: registry,
      toolOptions: { configOverrides: options.configOverrides },
    });

    const session = await harness.createSession({
      projectId: status.project.projectId,
      tier: "cloud-agent",
      fallbackChain: [{ provider: "mock", model: "mock-model" }],
    });
    assert.equal(session.tier, "cloud-agent");
    assert.equal(session.activeProvider, "mock");
    assert.equal(session.activeModel, "mock-model");
    assert.deepEqual(session.fallbackChain, [{ provider: "mock", model: "mock-model" }]);

    const collected: EmittedSessionEvent[] = [];
    const unsubscribe = harness.bus.subscribe(session.id, (e) => {
      collected.push(e);
    });

    harness.postMessage(session.id, "hi");
    await waitForKind(collected, "turn.done");
    unsubscribe();

    const kinds = collected.map((e) => e.event.kind);
    assert.ok(kinds.includes("text.delta"), `expected text.delta, got ${kinds.join(",")}`);
    assert.ok(kinds.includes("provider.call"), "expected provider.call event");
    assert.ok(kinds.includes("turn.done"), "expected turn.done");

    const providerCallEvent = collected.find((e) => e.event.kind === "provider.call")?.event as
      | { kind: "provider.call"; provider: string; model: string; ok: boolean; latencyMs: number }
      | undefined;
    assert.ok(providerCallEvent?.ok, "provider.call event should report ok=true");
    assert.equal(providerCallEvent?.provider, "mock");
    assert.equal(providerCallEvent?.model, "mock-model");

    const providerCalls = store.listHarnessProviderCalls(session.id);
    assert.equal(providerCalls.length, 1, "expected one persisted provider call");
    assert.equal(providerCalls[0]?.promptTokens, 12, "prompt token count persisted");
    assert.equal(providerCalls[0]?.completionTokens, 6, "completion token count persisted");

    const fetched = harness.getSession(session.id);
    assert.equal(fetched?.title, "hi", "first user message should auto-title untitled sessions");

    const { messages } = harness.listMessages(session.id);
    const assistant = messages.find((m) => m.role === "assistant");
    assert.ok(assistant, "assistant message persisted");
    const textParts = assistant.parts.filter((p) => p.kind === "text");
    const text = (textParts[0]?.payload as { text?: string } | undefined)?.text ?? "";
    assert.ok(
      text.startsWith("Hello from the mock provider"),
      `expected mocked text content, got: ${JSON.stringify(text)}`,
    );

    console.log("harness-cloud-agent: PASS");
  } finally {
    mock?.server.close();
    store?.close();
    api.close();
    cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
