import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { indexProject } from "../../services/indexer/src/index-project.ts";
import {
  reindexEmbeddings,
  searchSemantic,
  type EmbeddingProbeResult,
  type EmbeddingProvider,
} from "../../packages/harness-core/src/index.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

function fauxProvider(
  providerId: string,
  modelId: string,
  queryVector: Float32Array,
): EmbeddingProvider {
  return {
    providerId,
    modelId,
    get dim(): number {
      return queryVector.length;
    },
    async embed(): Promise<Float32Array> {
      return queryVector;
    },
    async embedMany(texts: string[]): Promise<Float32Array[]> {
      return texts.map(() => queryVector);
    },
    async probe(): Promise<EmbeddingProbeResult> {
      return { ok: true, dim: queryVector.length };
    },
  };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-semantic-hybrid-"));
  const projectRoot = path.join(tmp, "project");
  const stateDirName = `.mako-ai-semantic-hybrid-${process.pid}`;
  process.env.MAKO_STATE_HOME = tmp;

  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, "src", "incident.ts"),
    [
      "export function buildIncidentReportSummary(incidentId: string): string {",
      "  return `incident report summary ${incidentId}`;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(projectRoot, "docs", "incident.md"),
    [
      "# Incident Report",
      "",
      "Incident report documentation explains the summary workflow.",
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
    const memory = store.insertHarnessMemory({
      projectId: indexResult.project.projectId,
      text: "Incident report memory about paging and escalation.",
      category: "incident",
    });

    const otherProjectUnitId = "semantic-other-project-incident";
    store.replaceSemanticUnitsForFiles(["other-project-incident.ts"], [
      {
        unitId: otherProjectUnitId,
        projectId: "other-project",
        unitKind: "code_symbol",
        title: "Other project incident summary",
        text: "Other project incident report summary with secret escalation notes.",
        filePath: "other-project-incident.ts",
        lineStart: 1,
        lineEnd: 1,
        ownerRef: "other-project-incident.ts#summary",
        metadata: null,
        sourceHash: "other-project-incident",
      },
    ]);

    const units = store.listSemanticUnits({
      projectId: indexResult.project.projectId,
    });
    const codeUnit = units.find((unit) => unit.unitKind === "code_symbol");
    const docUnit = units.find((unit) => unit.unitKind === "doc_chunk");
    assert.ok(codeUnit, "expected a code semantic unit");
    assert.ok(docUnit, "expected a doc semantic unit");

    store.insertEmbedding({
      ownerKind: "semantic_unit",
      ownerId: codeUnit!.unitId,
      provider: "fake",
      model: "semantic-model-v1",
      vector: Float32Array.of(1, 0, 0),
    });
    store.insertEmbedding({
      ownerKind: "semantic_unit",
      ownerId: docUnit!.unitId,
      provider: "fake",
      model: "semantic-model-v1",
      vector: Float32Array.of(0.6, 0.4, 0),
    });
    store.insertEmbedding({
      ownerKind: "memory",
      ownerId: memory.memoryId,
      provider: "fake",
      model: "semantic-model-v1",
      vector: Float32Array.of(0, 1, 0),
    });
    store.insertEmbedding({
      ownerKind: "semantic_unit",
      ownerId: otherProjectUnitId,
      provider: "fake",
      model: "semantic-model-v1",
      vector: Float32Array.of(1, 0, 0),
    });

    const provider = fauxProvider("fake", "semantic-model-v1", Float32Array.of(1, 0, 0));
    const result = await searchSemantic({
      store,
      query: "incident report summary",
      embeddingProvider: provider,
      projectId: indexResult.project.projectId,
      k: 5,
      kinds: ["code", "doc"],
      includeMemories: false,
    });

    assert.equal(result.mode, "hybrid");
    assert.ok(result.results.length > 0, "expected hybrid hits");
    assert.ok(result.results.every((hit) => hit.kind !== "memory"), "memory hits should be filtered out");
    assert.ok(
      result.results.some((hit) => hit.vectorScore !== null),
      "expected at least one vector-backed hit",
    );
    assert.ok(
      result.results.every((hit) => hit.sourceRef !== `semantic:${otherProjectUnitId}`),
      "project-scoped hybrid search must not surface code/doc units from another project",
    );
    const topVectorHit = [...result.results]
      .filter((hit) => hit.vectorScore !== null)
      .sort((a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0))[0];
    assert.ok(topVectorHit, "expected at least one vector-ranked hit");
    assert.equal(
      topVectorHit!.sourceRef,
      `semantic:${codeUnit!.unitId}`,
      "code unit should have the strongest vector match",
    );

    const scopedUnitCount = store.listSemanticUnits({
      projectId: indexResult.project.projectId,
    }).length;
    const allUnitCount = store.listSemanticUnits().length;
    assert.ok(allUnitCount > scopedUnitCount, "test fixture should include an out-of-scope unit");
    const reindex = await reindexEmbeddings({
      store,
      embeddingProvider: provider,
      kinds: ["semantic_unit"],
      projectId: indexResult.project.projectId,
    });
    assert.equal(
      reindex.scanned,
      scopedUnitCount,
      "project-scoped semantic-unit reindex should scan only the selected project",
    );

    console.log("harness-semantic-search-hybrid: PASS");
  } finally {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
