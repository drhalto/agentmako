/**
 * Phase 3.9 smoke: local daemon discovery stays aligned with runtime use.
 *
 * Covers three seams:
 *   - direct helper probes for Ollama / LM Studio still work
 *   - `GET /api/v1/providers` reflects the daemon's installed model list,
 *     including the zero-model case
 *   - a discovered local model can actually execute a turn through the real
 *     harness server path instead of failing `model-not-in-catalog`
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderSpec } from "../../packages/harness-contracts/src/index.ts";
import type { EmittedSessionEvent } from "../../packages/harness-core/src/event-bus.ts";
import { discoverOllamaModels } from "../../extensions/ollama/src/index.ts";
import { discoverLmStudioModels } from "../../extensions/lmstudio/src/index.ts";
import { startHarnessServer, type StartedHarnessServer } from "../../services/harness/src/server.ts";
import { cleanupSmokeStateDir } from "./state-cleanup.ts";

interface ProviderResponseEntry {
  spec: ProviderSpec;
  localProbe: { ok: boolean; models: number; error?: string } | null;
}

interface SessionCreateResponse {
  session: { id: string };
}

function sseChunk(model: string, content: string, done = false): string {
  const payload = done
    ? {
        id: "chatcmpl-local-1",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
      }
    : {
        id: "chatcmpl-local-1",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
      };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function startMockOllama(installed: string[]): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: installed.map((name) => ({ name })) }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("mock ollama failed to bind");
  return { server, baseURL: `http://127.0.0.1:${address.port}/v1` };
}

async function startMockLmStudio(
  installed: string[],
): Promise<{ server: Server; baseURL: string }> {
  const activeModel = installed[0] ?? "no-model-installed";
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: installed.map((id) => ({ id })) }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      req.on("data", () => undefined);
      req.on("end", () => {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(sseChunk(activeModel, "local"));
        res.write(sseChunk(activeModel, " discovery"));
        res.write(sseChunk(activeModel, " works"));
        res.write(sseChunk(activeModel, "", true));
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") throw new Error("mock lmstudio failed to bind");
  return { server, baseURL: `http://127.0.0.1:${address.port}/v1` };
}

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as
    | { ok: true; data: T }
    | { ok: false; error?: { message?: string } };
  assert.ok(
    response.ok,
    `expected HTTP ok, got ${response.status}: ${JSON.stringify(body)}`,
  );
  assert.ok(body.ok, `expected ok:true envelope, got ${JSON.stringify(body)}`);
  return body.data;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  return readData<T>(response);
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  });
  return readData<T>(response);
}

async function waitForKind(
  events: EmittedSessionEvent[],
  kind: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.some((event) => event.event.kind === kind)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${kind}`);
}

function findProvider(
  providers: ProviderResponseEntry[],
  providerId: string,
): ProviderResponseEntry {
  const match = providers.find((entry) => entry.spec.id === providerId);
  assert.ok(match, `expected provider ${providerId} in /api/v1/providers`);
  return match!;
}

async function main(): Promise<void> {
  const discoveredModel = "mako-local-discovered-model";
  const cleanEnv = { ...process.env };
  const ollama = await startMockOllama(["qwen3:8b", "llama3:70b"]);
  const lmstudio = await startMockLmStudio([discoveredModel]);
  const lmstudioEmpty = await startMockLmStudio([]);
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mako-local-discovery-"));
  const projectRoot = path.join(tmpRoot, "project");
  const stateDirName = `.mako-ai-local-discovery-${Date.now()}-${process.pid}`;
  const stateDir = path.join(projectRoot, stateDirName);
  let harnessServer: StartedHarnessServer | undefined;

  try {
    const o = await discoverOllamaModels(ollama.baseURL);
    assert.equal(o.ok, true, "ollama discovery should succeed against live mock");
    assert.deepEqual(o.models.sort(), ["llama3:70b", "qwen3:8b"]);

    const l = await discoverLmStudioModels(lmstudio.baseURL);
    assert.equal(l.ok, true, "lmstudio discovery should succeed against live mock");
    assert.deepEqual(l.models, [discoveredModel]);

    const dead = await discoverOllamaModels("http://127.0.0.1:1/v1");
    assert.equal(dead.ok, false, "unreachable daemon should return ok:false");
    assert.equal(dead.models.length, 0);
    assert.ok(typeof dead.error === "string");

    process.env.MAKO_LMSTUDIO_BASE_URL = lmstudio.baseURL;
    process.env.LMSTUDIO_BASE_URL = lmstudio.baseURL;
    mkdirSync(projectRoot, { recursive: true });
    harnessServer = await startHarnessServer({
      projectRoot,
      port: 0,
      stateDirName,
    });
    const baseURL = `http://${harnessServer.host}:${harnessServer.port}`;

    const firstProviders = await getJson<{ providers: ProviderResponseEntry[] }>(
      `${baseURL}/api/v1/providers`,
    );
    const liveLmstudio = findProvider(firstProviders.providers, "lmstudio");
    assert.equal(liveLmstudio.localProbe?.ok, true, "live daemon should report ok:true");
    assert.equal(liveLmstudio.localProbe?.models, 1, "installed-model count should reflect daemon");
    assert.deepEqual(
      liveLmstudio.spec.models.map((model) => model.id),
      [discoveredModel],
      "provider list should expose the discovered model ids, not the stale catalog list",
    );
    assert.equal(
      liveLmstudio.spec.models[0]?.discovered,
      true,
      "discovered models should be marked as runtime-discovered",
    );

    const created = await postJson<SessionCreateResponse>(`${baseURL}/api/v1/sessions`, {
      tier: "local-agent",
      provider: "lmstudio",
      model: discoveredModel,
      title: "local-discovery-smoke",
    });
    const sessionId = created.session.id;

    const events: EmittedSessionEvent[] = [];
    const unsubscribe = harnessServer.harness.bus.subscribe(sessionId, (event) => {
      events.push(event);
    });
    try {
      await postJson<{ messageId: string; started: true }>(
        `${baseURL}/api/v1/sessions/${sessionId}/messages`,
        { content: "hello local", caller: { kind: "agent" } },
      );
      await waitForKind(events, "turn.done");
    } finally {
      unsubscribe();
    }

    const providerCalls = harnessServer.store.listHarnessProviderCalls(sessionId);
    assert.equal(providerCalls.length, 1, "expected one persisted provider call");
    assert.equal(providerCalls[0]?.provider, "lmstudio");
    assert.equal(providerCalls[0]?.model, discoveredModel);
    assert.equal(providerCalls[0]?.ok, true, "discovered model should execute successfully");

    const { messages } = harnessServer.harness.listMessages(sessionId);
    const assistant = messages.find((message) => message.role === "assistant");
    const textPart = assistant?.parts.find((part) => part.kind === "text");
    const text = (textPart?.payload as { text?: string } | undefined)?.text ?? "";
    assert.ok(
      text.includes("local discovery works"),
      `expected streamed assistant text from the discovered local model, got ${JSON.stringify(text)}`,
    );

    process.env.MAKO_LMSTUDIO_BASE_URL = lmstudioEmpty.baseURL;
    process.env.LMSTUDIO_BASE_URL = lmstudioEmpty.baseURL;
    const emptyProviders = await getJson<{ providers: ProviderResponseEntry[] }>(
      `${baseURL}/api/v1/providers`,
    );
    const emptyLmstudio = findProvider(emptyProviders.providers, "lmstudio");
    assert.equal(
      emptyLmstudio.localProbe?.ok,
      true,
      "reachable daemon with zero models should still report ok:true",
    );
    assert.equal(emptyLmstudio.localProbe?.models, 0, "zero installed models should be surfaced");
    assert.deepEqual(
      emptyLmstudio.spec.models,
      [],
      "reachable zero-model daemon should not fall back to stale catalog models",
    );

    console.log("harness-local-discovery: PASS");
  } finally {
    await harnessServer?.close();
    cleanupSmokeStateDir(stateDir);
    rmSync(tmpRoot, { recursive: true, force: true });
    await new Promise<void>((resolve) => ollama.server.close(() => resolve()));
    await new Promise<void>((resolve) => lmstudio.server.close(() => resolve()));
    await new Promise<void>((resolve) => lmstudioEmpty.server.close(() => resolve()));
    process.env = cleanEnv;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
