import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashText } from "../../packages/store/src/index.ts";
import { seedReefProject } from "../fixtures/reef/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-artifact-store-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });

  const seeded = await seedReefProject({ projectRoot });
  try {
    const artifact = seeded.store.upsertReefArtifact({
      contentHash: hashText("export function route() { return 1; }"),
      artifactKind: "ast_symbols",
      extractorVersion: "tree-sitter-typescript@smoke",
      payload: { symbols: ["route"] },
      metadata: { source: "reef-artifact-store-smoke" },
    });

    const duplicate = seeded.store.upsertReefArtifact({
      contentHash: artifact.contentHash,
      artifactKind: artifact.artifactKind,
      extractorVersion: artifact.extractorVersion,
      payload: { symbols: ["route"] },
    });
    assert.equal(duplicate.artifactId, artifact.artifactId);

    const mainTag = seeded.store.addReefArtifactTag({
      artifactId: artifact.artifactId,
      projectId: seeded.projectId,
      root: projectRoot,
      branch: "main",
      overlay: "indexed",
      path: "src/routes.ts",
    });
    const featureTag = seeded.store.addReefArtifactTag({
      artifactId: artifact.artifactId,
      projectId: seeded.projectId,
      root: projectRoot,
      branch: "feature/reuse",
      overlay: "indexed",
      path: "src/routes.ts",
    });

    const reused = seeded.store.queryReefArtifacts({
      projectId: seeded.projectId,
      root: projectRoot,
      branch: "feature/reuse",
      overlay: "indexed",
      path: "src/routes.ts",
      artifactKind: "ast_symbols",
    });
    assert.equal(reused.length, 1);
    assert.equal(reused[0]?.artifactId, artifact.artifactId);
    assert.equal(
      seeded.store.queryReefArtifactTags({ artifactId: artifact.artifactId }).length,
      2,
      "one content-addressed artifact should be attachable to multiple branches",
    );

    const changed = seeded.store.upsertReefArtifact({
      contentHash: hashText("export function route() { return 2; }"),
      artifactKind: "ast_symbols",
      extractorVersion: "tree-sitter-typescript@smoke",
      payload: { symbols: ["route"], changed: true },
    });
    const updatedMainTag = seeded.store.addReefArtifactTag({
      artifactId: changed.artifactId,
      projectId: seeded.projectId,
      root: projectRoot,
      branch: "main",
      overlay: "indexed",
      path: "src/routes.ts",
    });
    assert.equal(updatedMainTag.tagId, mainTag.tagId);
    assert.equal(updatedMainTag.artifactId, changed.artifactId);

    const mainTags = seeded.store.queryReefArtifactTags({
      projectId: seeded.projectId,
      root: projectRoot,
      branch: "main",
      overlay: "indexed",
      path: "src/routes.ts",
      artifactKind: "ast_symbols",
    });
    assert.equal(mainTags.length, 1);
    assert.equal(mainTags[0]?.artifactId, changed.artifactId);

    const removedFeature = seeded.store.removeReefArtifactTags({
      tagId: featureTag.tagId,
      pruneArtifacts: true,
    });
    assert.deepEqual(removedFeature, { removedTagCount: 1, prunedArtifactCount: 1 });
    assert.equal(seeded.store.queryReefArtifacts({ artifactId: artifact.artifactId }).length, 0);
    assert.equal(seeded.store.queryReefArtifacts({ artifactId: changed.artifactId }).length, 1);

    const removedMain = seeded.store.removeReefArtifactTags({
      tagId: updatedMainTag.tagId,
      pruneArtifacts: true,
    });
    assert.deepEqual(removedMain, { removedTagCount: 1, prunedArtifactCount: 1 });
    assert.equal(seeded.store.queryReefArtifacts({ artifactKind: "ast_symbols" }).length, 0);

    console.log("reef-artifact-store: PASS");
  } finally {
    await seeded.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
