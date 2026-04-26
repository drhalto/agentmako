import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { indexProject } from "../../services/indexer/src/index-project.ts";
import { searchSemantic } from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-semantic-fts-"));
  const projectRoot = path.join(tmp, "project");
  const stateDirName = `.mako-ai-semantic-fts-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  mkdirSync(path.join(projectRoot, "devdocs"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "src", "audit.ts"),
    [
      "export async function buildAuditEmailReport(userEmail: string): Promise<string> {",
      "  return `audit report for ${userEmail}`;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(projectRoot, "devdocs", "audit.md"),
    [
      "# Audit Guide",
      "",
      "The audit email report explains how user email events are retained.",
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
    const otherProjectUnitId = "semantic-other-project-audit";
    store.replaceSemanticUnitsForFiles(["other-project-audit.ts"], [
      {
        unitId: otherProjectUnitId,
        projectId: "other-project",
        unitKind: "code_symbol",
        title: "Other project audit token",
        text: "Other project audit email report user retention secret.",
        filePath: "other-project-audit.ts",
        lineStart: 1,
        lineEnd: 1,
        ownerRef: "other-project-audit.ts#audit",
        metadata: null,
        sourceHash: "other-project-audit",
      },
    ]);

    store.insertHarnessMemory({
      projectId: indexResult.project.projectId,
      text: "Audit email report memory for user email retention.",
      category: "notes",
    });

    assert.ok(
      store.countSemanticUnits(["code_symbol"]) >= 1,
      "expected at least one code symbol semantic unit",
    );
    assert.ok(
      store.countSemanticUnits(["doc_chunk"]) >= 1,
      "expected at least one doc semantic unit",
    );

    const result = await searchSemantic({
      store,
      query: "audit email report user retention",
      embeddingProvider: null,
      projectId: indexResult.project.projectId,
      k: 10,
    });

    assert.equal(result.mode, "fts-fallback");
    assert.ok(result.reason, "fts-fallback should include a reason");
    assert.ok(result.results.some((hit) => hit.kind === "code"), "expected a code hit");
    assert.ok(result.results.some((hit) => hit.kind === "doc"), "expected a doc hit");
    assert.ok(result.results.some((hit) => hit.kind === "memory"), "expected a memory hit");
    assert.ok(
      result.results.every((hit) => hit.sourceRef !== `semantic:${otherProjectUnitId}`),
      "project-scoped FTS search must not surface code/doc units from another project",
    );

    console.log("harness-semantic-search-fts-fallback: PASS");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
