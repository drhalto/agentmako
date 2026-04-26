import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-cross-search-ranking-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  mkdirSync(path.join(projectRoot, "docs"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "cross-search-ranking-smoke", version: "0.0.0" }),
  );

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "cross-search-ranking-smoke",
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
        name: "cross-search-ranking-smoke",
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
            path: "src/learner-overview.tsx",
            sha256: "source",
            language: "tsx",
            sizeBytes: 120,
            lineCount: 6,
            chunks: [
              {
                chunkKind: "symbol",
                name: "LearnerOverview",
                lineStart: 1,
                lineEnd: 6,
                content:
                  "export function LearnerOverview() {\n  return <p>{registration.event?.title ?? 'Unknown event'}</p>;\n}",
              },
              {
                chunkKind: "file",
                name: "src/learner-overview.tsx",
                lineStart: 1,
                lineEnd: 6,
                content:
                  "export function LearnerOverview() {\n  return <p>{registration.event?.title ?? 'Unknown event'}</p>;\n}",
              },
            ],
            symbols: [
              {
                name: "LearnerOverview",
                kind: "function",
                exportName: "LearnerOverview",
                lineStart: 1,
                lineEnd: 6,
                signatureText: "export function LearnerOverview()",
              },
            ],
            imports: [],
            routes: [],
          },
          {
            path: "docs/mako-seeded-defects.md",
            sha256: "doc",
            language: "markdown",
            sizeBytes: 120,
            lineCount: 4,
            chunks: [
              {
                chunkKind: "file",
                name: "docs/mako-seeded-defects.md",
                lineStart: 1,
                lineEnd: 4,
                content:
                  "Why does learner dashboard show Unknown event for registrations?\nThis doc exists only to catch ranking drift.",
              },
            ],
            symbols: [],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [
          {
            objectKey: "public.support_tickets",
            objectType: "table",
            schemaName: "public",
            objectName: "support_tickets",
          },
        ],
        schemaUsages: [],
      });
      store.beginIndexRun("smoke");
    } finally {
      store.close();
    }

    const phraseOutput = (await invokeTool("cross_search", {
      projectId,
      term: "unknown event",
    })) as {
      toolName: string;
      result: {
        packet: {
          evidence: Array<{ kind: string; filePath?: string; sourceRef: string }>;
        };
      };
    };

    assert.equal(phraseOutput.toolName, "cross_search");
    const phraseEvidence = phraseOutput.result.packet.evidence;
    assert.ok(
      phraseEvidence.some((block) => block.filePath === "src/learner-overview.tsx"),
      "expected source-code evidence for the unknown event phrase",
    );
    assert.ok(
      phraseEvidence.every((block) => block.filePath !== "docs/mako-seeded-defects.md"),
      "expected markdown docs to stay out of code-hit evidence",
    );

    const schemaOutput = (await invokeTool("cross_search", {
      projectId,
      term: "support tickets",
    })) as {
      toolName: string;
      result: {
        packet: {
          evidence: Array<{ kind: string; sourceRef: string }>;
        };
      };
    };

    assert.equal(schemaOutput.toolName, "cross_search");
    assert.ok(
      schemaOutput.result.packet.evidence.some(
        (block) => block.kind === "schema" && block.sourceRef === "public.support_tickets",
      ),
      "expected natural-language table phrase to surface snake_case schema objects",
    );

    console.log("composer-cross-search-ranking: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
