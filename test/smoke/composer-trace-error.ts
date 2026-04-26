/**
 * Phase 3.6.1 smoke — trace_error composer end-to-end.
 *
 * Proves:
 *   - ast-grep finds `throw new Error('...')` sites whose match text contains
 *     the error term
 *   - ast-grep finds `throw new $ERR($MSG)` sites (e.g. TypeError) with the
 *     term captured in the message
 *   - ast-grep finds `try { ... } catch ($E) { ... }` blocks whose body
 *     references the term
 *   - PL/pgSQL bodies that reference the term surface as schema blocks
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-trace-error-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "trace-error-smoke", version: "0.0.0" }),
  );

  const throwerPath = path.join(projectRoot, "src", "validate.ts");
  const throwerBody = [
    "export function validate(input: string) {",
    "  if (input.length === 0) {",
    "    throw new Error('UserNotFound');",
    "  }",
    "  if (input.startsWith('!')) {",
    "    throw new TypeError('UserNotFound in TypeError');",
    "  }",
    "  return input;",
    "}",
  ].join("\n");
  writeFileSync(throwerPath, throwerBody);

  const catcherPath = path.join(projectRoot, "src", "handler.ts");
  const catcherBody = [
    "import { validate } from './validate';",
    "",
    "export function handle(input: string) {",
    "  try {",
    "    return validate(input);",
    "  } catch (err) {",
    "    if (err instanceof Error && err.message === 'UserNotFound') {",
    "      return null;",
    "    }",
    "    throw err;",
    "  }",
    "}",
  ].join("\n");
  writeFileSync(catcherPath, catcherBody);

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "trace-error-smoke",
        canonicalPath: projectRoot,
        lastSeenPath: projectRoot,
        supportTarget: "best_effort",
      });
    } finally {
      globalStore.close();
    }

    const store = openProjectStore({ projectRoot });
    try {
      store.saveProjectProfile({
        name: "trace-error-smoke",
        rootPath: projectRoot,
        framework: "unknown",
        orm: "unknown",
        srcRoot: "src",
        entryPoints: [],
        pathAliases: {},
        middlewareFiles: [],
        serverOnlyModules: [],
        authGuardSymbols: [],
        supportLevel: "best_effort",
        detectedAt: new Date().toISOString(),
      });

      store.replaceIndexSnapshot({
        files: [
          {
            path: "src/validate.ts",
            sha256: "validate",
            language: "typescript",
            sizeBytes: throwerBody.length,
            lineCount: throwerBody.split("\n").length,
            chunks: [
              {
                chunkKind: "file",
                name: "src/validate.ts",
                lineStart: 1,
                lineEnd: throwerBody.split("\n").length,
                content: throwerBody,
              },
            ],
            symbols: [],
            imports: [],
            routes: [],
          },
          {
            path: "src/handler.ts",
            sha256: "handler",
            language: "typescript",
            sizeBytes: catcherBody.length,
            lineCount: catcherBody.split("\n").length,
            chunks: [
              {
                chunkKind: "file",
                name: "src/handler.ts",
                lineStart: 1,
                lineEnd: catcherBody.split("\n").length,
                content: catcherBody,
              },
            ],
            symbols: [],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
      store.beginIndexRun("smoke");

      const now = new Date().toISOString();
      store.saveSchemaSnapshot({
        snapshotId: `snap_${randomUUID()}`,
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "trace-error-smoke",
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: [],
        warnings: [],
        ir: {
          version: "1.0.0",
          schemas: {
            public: {
              tables: [],
              views: [],
              enums: [],
              rpcs: [
                {
                  name: "raise_user_not_found",
                  schema: "public",
                  sources: [],
                  bodyText: "BEGIN RAISE EXCEPTION 'UserNotFound'; END;",
                },
              ],
            },
          },
        },
      });
    } finally {
      store.close();
    }

    const output = (await invokeTool("trace_error", {
      projectId,
      term: "UserNotFound",
    })) as {
      toolName: string;
      result: {
        packet: {
          evidence: Array<{ kind: string; title: string; content: string }>;
        };
      };
    };

    assert.equal(output.toolName, "trace_error");
    const evidence = output.result.packet.evidence;

    assert.ok(
      evidence.some(
        (b) =>
          b.kind === "finding" &&
          b.title.startsWith("throw Error at ") &&
          b.content.includes("UserNotFound"),
      ),
      "expected throw new Error('UserNotFound') to surface as a finding",
    );
    assert.ok(
      evidence.some(
        (b) =>
          b.kind === "finding" &&
          b.title.startsWith("throw TypeError at ") &&
          b.content.includes("UserNotFound"),
      ),
      "expected throw new TypeError('...') to surface with captured err",
    );
    assert.ok(
      evidence.some(
        (b) =>
          b.kind === "finding" &&
          b.title.startsWith("catch handler at ") &&
          b.content.includes("UserNotFound"),
      ),
      "expected a try/catch block whose body references the term",
    );
    assert.ok(
      evidence.some(
        (b) =>
          b.kind === "schema" &&
          b.title.startsWith("rpc public.raise_user_not_found"),
      ),
      "expected PL/pgSQL body reference to surface",
    );

    console.log("composer-trace-error: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
