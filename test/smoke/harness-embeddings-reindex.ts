import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { indexProject } from "../../services/indexer/src/index-project.ts";
import { startHarnessServer } from "../../services/harness/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";
import { cleanupSmokeStateDir, rmSyncRetry } from "./state-cleanup.ts";

function isRetryableRmError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "EBUSY" ||
      (error as NodeJS.ErrnoException).code === "ENOTEMPTY" ||
      (error as NodeJS.ErrnoException).code === "EPERM")
  );
}

async function startMockEmbeddingServer(): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "nomic-embed-text" }] }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/embeddings") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          input?: string | string[];
        };
        const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? ""];
        const data = inputs.map((value, index) => {
          const text = String(value).toLowerCase();
          const embedding =
            text.includes("guide")
              ? [1, 0, 0]
              : text.includes("memory")
                ? [0, 1, 0]
                : [0.7, 0.3, 0];
          return { index, embedding };
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("mock embedding server failed to bind");
  }
  return { server, baseURL: `http://127.0.0.1:${address.port}/v1` };
}

async function jsonFetch<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!response.ok || !payload.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? `request failed: ${response.status}`);
  }
  return payload.data;
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-semantic-reindex-"));
  const projectRoot = path.join(tmp, "project");
  const stateDirName = `.mako-ai-semantic-reindex-${process.pid}`;
  const projectStateDir = path.join(projectRoot, stateDirName);
  process.env.MAKO_STATE_HOME = tmp;

  const mock = await startMockEmbeddingServer();
  let started: Awaited<ReturnType<typeof startHarnessServer>> | undefined;

  mkdirSync(path.join(projectRoot, ".mako"), { recursive: true });
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, ".mako", "providers.json"),
    JSON.stringify(
      {
        providers: [
          {
            id: "test-embed",
            name: "Test Embed",
            kind: "embedding",
            transport: "openai-compatible",
            baseURL: mock.baseURL,
            auth: "none",
            envVarHints: [],
            tier: "local",
            models: [
              {
                id: "nomic-embed-text",
                displayName: "Nomic Embed Text",
                contextWindow: 8192,
                supportsTools: false,
                supportsVision: false,
                supportsReasoning: false,
                tier: "local",
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(projectRoot, ".mako", "config.json"),
    JSON.stringify(
      {
        defaults: {
          embedding: {
            provider: "test-embed",
            model: "nomic-embed-text",
          },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(projectRoot, "src", "guide.ts"),
    [
      "export function buildGuideSummary(): string {",
      "  return 'guide summary';",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(projectRoot, "docs", "guide.md"),
    [
      "# Guide",
      "",
      "Guide documentation for semantic retrieval and embeddings reindex.",
      "",
    ].join("\n"),
  );

  const indexResult = await indexProject(projectRoot, {
    configOverrides: {
      stateDirName,
      databaseTools: { enabled: false },
    },
  });

  const store = openProjectStore({ projectRoot, stateDirName });
  try {
    store.insertHarnessMemory({
      projectId: indexResult.project.projectId,
      text: "Guide memory for semantic retrieval.",
      category: "guide",
    });
  } finally {
    store.close();
  }

  try {
    started = await startHarnessServer({ projectRoot, stateDirName });

    const reindex1 = await jsonFetch<{
      providerId: string;
      modelId: string;
      scanned: number;
      embedded: number;
      skipped: number;
      failed: number;
    }>("POST", `http://${started.host}:${started.port}/api/v1/embeddings/reindex`, {
      kind: "all",
    });
    assert.equal(reindex1.providerId, "test-embed");
    assert.equal(reindex1.modelId, "nomic-embed-text");
    assert.ok(reindex1.scanned >= 3, "expected semantic units + memory to be scanned");
    assert.ok(reindex1.embedded >= 3, "expected semantic units + memory to be embedded");
    assert.equal(reindex1.failed, 0);

    const search = await jsonFetch<{
      mode: "hybrid" | "fts-fallback";
      results: Array<{ vectorScore: number | null }>;
    }>(
      "GET",
      `http://${started.host}:${started.port}/api/v1/semantic/search?q=guide`,
    );
    assert.equal(search.mode, "hybrid");
    assert.ok(search.results.some((hit) => hit.vectorScore !== null));

    const reindex2 = await jsonFetch<{
      scanned: number;
      embedded: number;
      skipped: number;
      failed: number;
    }>("POST", `http://${started.host}:${started.port}/api/v1/embeddings/reindex`, {
      kind: "all",
    });
    assert.equal(reindex2.embedded, 0, "second pass should skip existing embeddings");
    assert.ok(reindex2.skipped >= reindex1.embedded);
    assert.equal(reindex2.failed, 0);

    console.log("harness-embeddings-reindex: PASS");
  } finally {
    await started?.close();
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
    cleanupSmokeStateDir(projectStateDir);
    try {
      rmSyncRetry(tmp);
    } catch (error: unknown) {
      if (
        process.platform === "win32" &&
        isRetryableRmError(error) &&
        typeof error.path === "string" &&
        error.path.startsWith(projectStateDir)
      ) {
        return;
      }
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
