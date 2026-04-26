import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { createApiService } from "../../services/api/src/service.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import {
  extractImplementationHandoffArtifactFromToolOutput,
  extractReviewBundleArtifactFromToolOutput,
  extractTaskPreflightArtifactFromToolOutput,
  extractVerificationBundleArtifactFromToolOutput,
} from "../../packages/contracts/src/index.ts";

// The exported JSON body is the artifact's canonical projection — every
// identity/basis/freshness field except `renderings`. Renderings themselves
// land on disk as the separate files the caller asked for, so re-including
// them inside the JSON body would be circular. The projection shape tested
// here matches `buildArtifactRenderings` in packages/tools/src/artifacts/index.ts.
const CANONICAL_PROJECTION_KEYS = [
  "artifactId",
  "kind",
  "projectId",
  "title",
  "generatedAt",
  "basis",
  "freshness",
  "consumerTargets",
  "exportIntent",
  "payload",
] as const;

function assertCanonicalProjection(
  projection: Record<string, unknown>,
  expected: {
    artifactId: string;
    kind: string;
    projectId: string;
    basisLength: number;
  },
): void {
  for (const key of CANONICAL_PROJECTION_KEYS) {
    assert.ok(key in projection, `exported JSON must carry canonical field ${key}`);
  }
  assert.equal(projection.artifactId, expected.artifactId);
  assert.equal(projection.kind, expected.kind);
  assert.equal(projection.projectId, expected.projectId);
  const basis = projection.basis as unknown[];
  assert.equal(basis.length, expected.basisLength, "exported JSON basis length must match");
  const exportIntent = projection.exportIntent as { exportable: boolean; defaultTargets: string[] };
  assert.equal(exportIntent.exportable, true);
  assert.deepEqual(exportIntent.defaultTargets, ["file_export"]);
}

type ExportedFile = { format: string; path: string };
type ToolOutputWithExport = { exported?: { files: ExportedFile[] } };

function exportedFiles(output: unknown): ExportedFile[] {
  const exported = (output as ToolOutputWithExport | undefined)?.exported;
  return exported?.files ?? [];
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-artifact-file-export-"));
  const stateHome = path.join(tmp, "state");
  mkdirSync(stateHome, { recursive: true });
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  const projectFile = "src/foo.ts";
  const projectSymbolKey = `${projectFile}:foo:1:foo`;
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "artifact-file-export-smoke", version: "0.0.0" }),
  );
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, projectFile), "export const foo = 1;\n");

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "artifact-file-export-smoke",
        canonicalPath: projectRoot,
        lastSeenPath: projectRoot,
        supportTarget: "best_effort",
      });
    } finally {
      globalStore.close();
    }

    const projectStore = openProjectStore({ projectRoot });
    try {
      projectStore.saveProjectProfile({
        name: "artifact-file-export-smoke",
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

      projectStore.replaceIndexSnapshot({
        files: [
          {
            path: projectFile,
            sha256: "cafebabe",
            language: "typescript",
            sizeBytes: 22,
            lineCount: 1,
            chunks: [
              {
                chunkKind: "file",
                name: projectFile,
                lineStart: 1,
                lineEnd: 1,
                content: "export const foo = 1;",
              },
            ],
            symbols: [
              {
                name: "foo",
                kind: "constant",
                exportName: "foo",
                lineStart: 1,
                lineEnd: 1,
                signatureText: "export const foo = 1",
              },
            ],
            imports: [],
            routes: [],
          },
        ],
        schemaObjects: [],
        schemaUsages: [],
      });
      projectStore.beginIndexRun("smoke");
    } finally {
      projectStore.close();
    }

    const api = createApiService();
    try {
      // 1. implementation_handoff with default directory + both formats.
      const handoffOutput = await api.callTool("implementation_handoff_artifact", {
        projectId,
        queryKind: "file_health",
        queryText: projectFile,
        queryArgs: { file: projectFile },
        export: { file: {} },
      } as never);

      const handoffArtifact = extractImplementationHandoffArtifactFromToolOutput(handoffOutput);
      assert.ok(handoffArtifact, "expected handoff artifact");
      const handoffFiles = exportedFiles(handoffOutput);
      assert.equal(handoffFiles.length, 2, "default export should write both json and markdown");
      assert.ok(handoffFiles.some((f) => f.format === "json"));
      assert.ok(handoffFiles.some((f) => f.format === "markdown"));
      for (const file of handoffFiles) {
        assert.ok(
          file.path.startsWith(".mako/artifacts/implementation_handoff/"),
          `default export path should live under .mako/artifacts/<kind>/, got ${file.path}`,
        );
        assert.ok(file.path.includes(handoffArtifact!.artifactId), "filename should include artifactId");
        const absolute = path.join(projectRoot, file.path);
        assert.ok(fs.existsSync(absolute), `expected ${absolute} to exist`);
      }
      const handoffJsonFile = handoffFiles.find((f) => f.format === "json")!;
      const handoffJsonBody = fs.readFileSync(path.join(projectRoot, handoffJsonFile.path), "utf8");
      assertCanonicalProjection(JSON.parse(handoffJsonBody) as Record<string, unknown>, {
        artifactId: handoffArtifact!.artifactId,
        kind: "implementation_handoff",
        projectId,
        basisLength: handoffArtifact!.basis.length,
      });

      // 2. task_preflight with custom directory and markdown-only formats.
      const customDir = "reports/preflight";
      const preflightOutput = await api.callTool("task_preflight_artifact", {
        projectId,
        queryKind: "file_health",
        queryText: projectFile,
        queryArgs: { file: projectFile },
        startEntity: { kind: "file", key: projectFile },
        targetEntity: { kind: "symbol", key: projectSymbolKey },
        export: { file: { directory: customDir, formats: ["markdown"] } },
      } as never);
      const preflightArtifact = extractTaskPreflightArtifactFromToolOutput(preflightOutput);
      assert.ok(preflightArtifact, "expected task preflight artifact");
      const preflightFiles = exportedFiles(preflightOutput);
      assert.equal(preflightFiles.length, 1, "formats:[markdown] should write exactly one file");
      assert.equal(preflightFiles[0]?.format, "markdown");
      assert.ok(
        preflightFiles[0]?.path.startsWith(`${customDir}/`),
        `custom directory should prefix the exported path, got ${preflightFiles[0]?.path}`,
      );
      assert.ok(
        fs.existsSync(path.join(projectRoot, preflightFiles[0]!.path)),
        "custom-directory markdown export should exist on disk",
      );

      // 3. review_bundle calls without export — ensure no files written and no
      // `exported` field.
      const reviewOutput = await api.callTool("review_bundle_artifact", {
        projectId,
        queryKind: "file_health",
        queryText: projectFile,
        queryArgs: { file: projectFile },
        startEntity: { kind: "file", key: projectFile },
        targetEntity: { kind: "symbol", key: projectSymbolKey },
      } as never);
      const reviewArtifact = extractReviewBundleArtifactFromToolOutput(reviewOutput);
      assert.ok(reviewArtifact, "expected review bundle artifact");
      assert.equal(
        exportedFiles(reviewOutput).length,
        0,
        "omitting export should not write files",
      );
      assert.ok(
        !fs.existsSync(path.join(projectRoot, ".mako/artifacts/review_bundle")),
        "review_bundle default export directory must stay absent when export is not requested",
      );

      // 4. review_bundle WITH export — round-trip JSON.
      const reviewExportOutput = await api.callTool("review_bundle_artifact", {
        projectId,
        queryKind: "file_health",
        queryText: projectFile,
        queryArgs: { file: projectFile },
        startEntity: { kind: "file", key: projectFile },
        targetEntity: { kind: "symbol", key: projectSymbolKey },
        export: { file: { formats: ["json"] } },
      } as never);
      const reviewExportArtifact = extractReviewBundleArtifactFromToolOutput(reviewExportOutput);
      const reviewExportFiles = exportedFiles(reviewExportOutput);
      assert.equal(reviewExportFiles.length, 1);
      assert.equal(reviewExportFiles[0]?.format, "json");
      const reviewJsonBody = fs.readFileSync(
        path.join(projectRoot, reviewExportFiles[0]!.path),
        "utf8",
      );
      assertCanonicalProjection(JSON.parse(reviewJsonBody) as Record<string, unknown>, {
        artifactId: reviewExportArtifact!.artifactId,
        kind: "review_bundle",
        projectId,
        basisLength: reviewExportArtifact!.basis.length,
      });

      // 5. verification_bundle with export.
      const verificationOutput = await api.callTool("verification_bundle_artifact", {
        projectId,
        queryKind: "file_health",
        queryText: projectFile,
        queryArgs: { file: projectFile },
        export: { file: {} },
      } as never);
      const verificationArtifact = extractVerificationBundleArtifactFromToolOutput(
        verificationOutput,
      );
      assert.ok(verificationArtifact, "expected verification bundle artifact");
      const verificationFiles = exportedFiles(verificationOutput);
      assert.equal(verificationFiles.length, 2);
      const verificationJson = verificationFiles.find((f) => f.format === "json")!;
      const verificationJsonBody = fs.readFileSync(
        path.join(projectRoot, verificationJson.path),
        "utf8",
      );
      assertCanonicalProjection(JSON.parse(verificationJsonBody) as Record<string, unknown>, {
        artifactId: verificationArtifact!.artifactId,
        kind: "verification_bundle",
        projectId,
        basisLength: verificationArtifact!.basis.length,
      });

      // 6. The exported artifact's exportIntent must declare file_export as a
      // default target, matching the 7.4 capability flip.
      assert.equal(verificationArtifact?.exportIntent.exportable, true);
      assert.deepEqual(verificationArtifact?.exportIntent.defaultTargets, ["file_export"]);
      assert.ok(
        verificationArtifact?.consumerTargets.includes("file_export"),
        "consumerTargets must include file_export so refineArtifactShape accepts the exportIntent",
      );

      // 7. Path traversal is rejected.
      await assert.rejects(
        () =>
          api.callTool("implementation_handoff_artifact", {
            projectId,
            queryKind: "file_health",
            queryText: projectFile,
            queryArgs: { file: projectFile },
            export: { file: { directory: "../outside" } },
          } as never),
        /resolves outside project root/i,
        "path traversal through export directory must be rejected",
      );

      // 8. The returned `exported.files` paths must match files actually on
      // disk — the caller should be able to trust the response without
      // re-scanning the directory.
      for (const file of verificationFiles) {
        const absolute = path.join(projectRoot, file.path);
        assert.ok(fs.existsSync(absolute), `exported path ${file.path} must exist on disk`);
        assert.ok(
          file.path.startsWith(".mako/artifacts/verification_bundle/"),
          `default directory layout should be .mako/artifacts/<kind>/, got ${file.path}`,
        );
      }
    } finally {
      api.close();
    }

    console.log("artifact-file-export: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
