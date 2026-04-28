import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProjectStoreCache, hashText } from "../../packages/store/src/index.ts";
import {
  createReefIndexerCalculationRegistry,
  indexProject,
  REEF_AST_SYMBOLS_ARTIFACT_KIND,
  REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
  REEF_IMPORT_EDGES_ARTIFACT_KIND,
  REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
  REEF_ROUTES_ARTIFACT_KIND,
  REEF_ROUTES_EXTRACTOR_VERSION,
  refreshProjectPaths,
} from "../../services/indexer/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-structural-artifacts-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-structural-artifacts-smoke" }));
  writeFileSync(path.join(projectRoot, "src", "beta.ts"), "export const beta = 'beta';\n");
  const routePath = "src/routes.ts";
  const firstRouteSource = [
    "export const apiRoutes = {",
    "  hello: { path: '/api/hello', method: 'GET' },",
    "};",
  ].join("\n") + "\n";
  writeFileSync(path.join(projectRoot, routePath), firstRouteSource);
  const firstSource = [
    "import { beta } from './beta';",
    "export function stableValue() {",
    "  return 'first';",
    "}",
    "// smoke marker",
  ].join("\n") + "\n";
  writeFileSync(path.join(projectRoot, "src", "alpha.ts"), firstSource);

  const cache = createProjectStoreCache();
  try {
    const registry = createReefIndexerCalculationRegistry();
    assert.equal(
      registry.findProducer({
        kind: "artifact",
        artifactKind: REEF_AST_SYMBOLS_ARTIFACT_KIND,
        extractorVersion: REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
      })?.id,
      "reef.indexer.ast_symbols",
    );
    assert.equal(
      registry.findProducer({
        kind: "artifact",
        artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
        extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
      })?.id,
      "reef.indexer.import_edges",
    );
    assert.equal(
      registry.findProducer({
        kind: "artifact",
        artifactKind: REEF_ROUTES_ARTIFACT_KIND,
        extractorVersion: REEF_ROUTES_EXTRACTOR_VERSION,
      })?.id,
      "reef.indexer.routes",
    );

    const indexed = await indexProject(projectRoot, { projectStoreCache: cache, reefRevision: 1 });
    const store = cache.borrow({ projectRoot });
    const firstTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_AST_SYMBOLS_ARTIFACT_KIND,
      extractorVersion: REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
    });
    assert.equal(firstTags.length, 1);
    const firstSymbolOutputHash = firstTags[0]!.contentHash;
    assert.equal(firstTags[0]?.lastVerifiedRevision, 1);
    assert.equal(firstTags[0]?.lastChangedRevision, 1);
    const firstArtifact = store.queryReefArtifacts({ artifactId: firstTags[0]!.artifactId })[0];
    assert.ok(JSON.stringify(firstArtifact?.payload).includes("stableValue"));
    assert.equal(firstArtifact?.metadata?.outputFingerprint, firstSymbolOutputHash);
    assert.equal(firstArtifact?.metadata?.inputContentHash, hashText(firstSource));

    const firstImportTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
      extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
    });
    assert.equal(firstImportTags.length, 1);
    const firstImportOutputHash = firstImportTags[0]!.contentHash;
    assert.equal(firstImportTags[0]?.lastVerifiedRevision, 1);
    assert.equal(firstImportTags[0]?.lastChangedRevision, 1);
    const firstImportArtifact = store.queryReefArtifacts({ artifactId: firstImportTags[0]!.artifactId })[0];
    assert.ok(JSON.stringify(firstImportArtifact?.payload).includes("./beta"));
    assert.equal(firstImportArtifact?.metadata?.outputFingerprint, firstImportOutputHash);
    assert.equal(firstImportArtifact?.metadata?.inputContentHash, hashText(firstSource));

    const firstRouteTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: routePath,
      artifactKind: REEF_ROUTES_ARTIFACT_KIND,
      extractorVersion: REEF_ROUTES_EXTRACTOR_VERSION,
    });
    assert.equal(firstRouteTags.length, 1);
    const firstRouteOutputHash = firstRouteTags[0]!.contentHash;
    const firstRouteArtifact = store.queryReefArtifacts({ artifactId: firstRouteTags[0]!.artifactId })[0];
    assert.ok(JSON.stringify(firstRouteArtifact?.payload).includes("local-http:GET:/api/hello"));
    assert.equal(firstRouteArtifact?.metadata?.outputFingerprint, firstRouteOutputHash);
    assert.equal(firstRouteArtifact?.metadata?.inputContentHash, hashText(firstRouteSource));

    const secondSource = [
      "import { beta } from './beta';",
      "export function stableValue() {",
      "  return 'first';",
      "}",
      "// smoke marker changed",
    ].join("\n") + "\n";
    writeFileSync(path.join(projectRoot, "src", "alpha.ts"), secondSource);
    const refreshed = await refreshProjectPaths(projectRoot, ["src/alpha.ts"], {
      projectStoreCache: cache,
      triggerSource: "reef_structural_artifacts_smoke",
      reefRevision: 2,
    });
    assert.equal(refreshed.mode, "paths");

    const refreshedTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_AST_SYMBOLS_ARTIFACT_KIND,
      extractorVersion: REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
    });
    assert.equal(refreshedTags.length, 1);
    assert.equal(refreshedTags[0]?.contentHash, firstSymbolOutputHash);
    assert.equal(refreshedTags[0]?.artifactId, firstTags[0]?.artifactId);
    assert.equal(refreshedTags[0]?.lastVerifiedRevision, 2);
    assert.equal(refreshedTags[0]?.lastChangedRevision, 1);
    const refreshedImportTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
      extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
    });
    assert.equal(refreshedImportTags.length, 1);
    assert.equal(refreshedImportTags[0]?.contentHash, firstImportOutputHash);
    assert.equal(refreshedImportTags[0]?.artifactId, firstImportTags[0]?.artifactId);
    assert.equal(refreshedImportTags[0]?.lastVerifiedRevision, 2);
    assert.equal(refreshedImportTags[0]?.lastChangedRevision, 1);
    const structuralBackdatedEvent = store.queryLifecycleEvents({ eventType: "project_index", limit: 5 })
      .find((event) => event.metadata?.triggerSource === "reef_structural_artifacts_smoke");
    assert.equal(
      structuralProducerResult(structuralBackdatedEvent, REEF_AST_SYMBOLS_ARTIFACT_KIND)?.changedRangeBackdatedCount,
      1,
    );
    assert.equal(
      structuralProducerResult(structuralBackdatedEvent, REEF_IMPORT_EDGES_ARTIFACT_KIND)?.changedRangeBackdatedCount,
      1,
    );

    const bodySource = [
      "import { beta } from './beta';",
      "export function stableValue() {",
      "  return 'second';",
      "}",
      "// smoke marker changed",
    ].join("\n") + "\n";
    writeFileSync(path.join(projectRoot, "src", "alpha.ts"), bodySource);
    const bodyRefreshed = await refreshProjectPaths(projectRoot, ["src/alpha.ts"], {
      projectStoreCache: cache,
      triggerSource: "reef_structural_artifacts_body_smoke",
    });
    assert.equal(bodyRefreshed.mode, "paths");
    const bodyTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_AST_SYMBOLS_ARTIFACT_KIND,
      extractorVersion: REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
    });
    assert.equal(bodyTags.length, 1);
    assert.equal(bodyTags[0]?.contentHash, firstSymbolOutputHash);
    assert.equal(bodyTags[0]?.artifactId, firstTags[0]?.artifactId);
    const bodyImportTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
      extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
    });
    assert.equal(bodyImportTags.length, 1);
    assert.equal(bodyImportTags[0]?.contentHash, firstImportOutputHash);
    assert.equal(bodyImportTags[0]?.artifactId, firstImportTags[0]?.artifactId);
    const bodyBackdatedEvent = store.queryLifecycleEvents({ eventType: "project_index", limit: 5 })
      .find((event) => event.metadata?.triggerSource === "reef_structural_artifacts_body_smoke");
    assert.equal(
      structuralProducerResult(bodyBackdatedEvent, REEF_AST_SYMBOLS_ARTIFACT_KIND)?.changedRangeBackdatedCount,
      1,
    );
    assert.equal(
      structuralProducerResult(bodyBackdatedEvent, REEF_IMPORT_EDGES_ARTIFACT_KIND)?.changedRangeBackdatedCount,
      1,
    );

    const topCommentSource = "// inserted header comment\n" + bodySource;
    writeFileSync(path.join(projectRoot, "src", "alpha.ts"), topCommentSource);
    const topCommentRefreshed = await refreshProjectPaths(projectRoot, ["src/alpha.ts"], {
      projectStoreCache: cache,
      triggerSource: "reef_structural_artifacts_top_comment_smoke",
    });
    assert.equal(topCommentRefreshed.mode, "paths");
    const topCommentTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_AST_SYMBOLS_ARTIFACT_KIND,
      extractorVersion: REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
    });
    assert.equal(topCommentTags.length, 1);
    assert.equal(topCommentTags[0]?.contentHash, firstSymbolOutputHash);
    assert.equal(topCommentTags[0]?.artifactId, firstTags[0]?.artifactId);
    const topCommentImportTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
      extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
    });
    assert.equal(topCommentImportTags.length, 1);
    assert.equal(topCommentImportTags[0]?.contentHash, firstImportOutputHash);
    assert.equal(topCommentImportTags[0]?.artifactId, firstImportTags[0]?.artifactId);
    const topCommentArtifact = store.queryReefArtifacts({ artifactId: firstTags[0]!.artifactId })[0];
    assert.equal(topCommentArtifact?.metadata?.inputContentHash, hashText(topCommentSource));

    const routeCommentSource = "// inserted route comment\n" + firstRouteSource;
    writeFileSync(path.join(projectRoot, routePath), routeCommentSource);
    const routeCommentRefreshed = await refreshProjectPaths(projectRoot, [routePath], {
      projectStoreCache: cache,
      triggerSource: "reef_structural_artifacts_route_comment_smoke",
    });
    assert.equal(routeCommentRefreshed.mode, "paths");
    const routeCommentTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: routePath,
      artifactKind: REEF_ROUTES_ARTIFACT_KIND,
      extractorVersion: REEF_ROUTES_EXTRACTOR_VERSION,
    });
    assert.equal(routeCommentTags.length, 1);
    assert.equal(routeCommentTags[0]?.contentHash, firstRouteOutputHash);
    assert.equal(routeCommentTags[0]?.artifactId, firstRouteTags[0]?.artifactId);
    const routeCommentArtifact = store.queryReefArtifacts({ artifactId: firstRouteTags[0]!.artifactId })[0];
    assert.equal(routeCommentArtifact?.metadata?.inputContentHash, hashText(routeCommentSource));
    const routeBackdatedEvent = store.queryLifecycleEvents({ eventType: "project_index", limit: 5 })
      .find((event) => event.metadata?.triggerSource === "reef_structural_artifacts_route_comment_smoke");
    assert.equal(
      structuralProducerResult(routeBackdatedEvent, REEF_ROUTES_ARTIFACT_KIND)?.outputFingerprintBackdatedCount,
      1,
    );

    const routePostSource = routeCommentSource.replace("GET", "POST");
    writeFileSync(path.join(projectRoot, routePath), routePostSource);
    const routeChanged = await refreshProjectPaths(projectRoot, [routePath], {
      projectStoreCache: cache,
      triggerSource: "reef_structural_artifacts_route_changed_smoke",
    });
    assert.equal(routeChanged.mode, "paths");
    const routeChangedTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: routePath,
      artifactKind: REEF_ROUTES_ARTIFACT_KIND,
      extractorVersion: REEF_ROUTES_EXTRACTOR_VERSION,
    });
    assert.equal(routeChangedTags.length, 1);
    assert.notEqual(routeChangedTags[0]?.contentHash, firstRouteOutputHash);
    assert.notEqual(routeChangedTags[0]?.artifactId, firstRouteTags[0]?.artifactId);

    const packageImportSource = [
      "import React from 'react';",
      "export function stableValue() {",
      "  return React.createElement('span');",
      "}",
      "// smoke marker changed",
    ].join("\n") + "\n";
    writeFileSync(path.join(projectRoot, "src", "alpha.ts"), packageImportSource);
    const importRefreshed = await refreshProjectPaths(projectRoot, ["src/alpha.ts"], {
      projectStoreCache: cache,
      triggerSource: "reef_structural_artifacts_import_smoke",
    });
    assert.equal(importRefreshed.mode, "paths");
    const packageImportTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
      extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
    });
    assert.equal(packageImportTags.length, 1);
    const packageImportOutputHash = packageImportTags[0]!.contentHash;
    assert.notEqual(packageImportOutputHash, firstImportOutputHash);
    assert.notEqual(packageImportTags[0]?.artifactId, firstImportTags[0]?.artifactId);

    const renamedSource = [
      "import React from 'react';",
      "export function renamedValue() {",
      "  return 'renamed';",
      "}",
      "// smoke marker changed",
    ].join("\n") + "\n";
    writeFileSync(path.join(projectRoot, "src", "alpha.ts"), renamedSource);
    const renamed = await refreshProjectPaths(projectRoot, ["src/alpha.ts"], {
      projectStoreCache: cache,
      triggerSource: "reef_structural_artifacts_renamed_smoke",
    });
    assert.equal(renamed.mode, "full");
    const renamedTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_AST_SYMBOLS_ARTIFACT_KIND,
      extractorVersion: REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
    });
    assert.equal(renamedTags.length, 1);
    assert.notEqual(renamedTags[0]?.contentHash, firstSymbolOutputHash);
    assert.notEqual(renamedTags[0]?.artifactId, firstTags[0]?.artifactId);
    const renamedImportTags = store.queryReefArtifactTags({
      projectId: indexed.project.projectId,
      root: indexed.project.canonicalPath,
      branch: "",
      worktree: "",
      overlay: "indexed",
      path: "src/alpha.ts",
      artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
      extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
    });
    assert.equal(renamedImportTags.length, 1);
    assert.equal(renamedImportTags[0]?.contentHash, packageImportOutputHash);
    assert.equal(renamedImportTags[0]?.artifactId, packageImportTags[0]?.artifactId);

    unlinkSync(path.join(projectRoot, routePath));
    const routeDeleted = await refreshProjectPaths(projectRoot, [routePath], {
      projectStoreCache: cache,
      triggerSource: "reef_structural_artifacts_route_delete_smoke",
    });
    assert.equal(routeDeleted.mode, "paths");
    assert.equal(
      store.queryReefArtifactTags({
        projectId: indexed.project.projectId,
        root: indexed.project.canonicalPath,
        branch: "",
        worktree: "",
        overlay: "indexed",
        path: routePath,
        artifactKind: REEF_ROUTES_ARTIFACT_KIND,
        extractorVersion: REEF_ROUTES_EXTRACTOR_VERSION,
      }).length,
      0,
    );

    unlinkSync(path.join(projectRoot, "src", "alpha.ts"));
    const deleted = await refreshProjectPaths(projectRoot, ["src/alpha.ts"], {
      projectStoreCache: cache,
      triggerSource: "reef_structural_artifacts_delete_smoke",
    });
    assert.equal(deleted.mode, "paths");
    assert.equal(
      store.queryReefArtifactTags({
        projectId: indexed.project.projectId,
        root: indexed.project.canonicalPath,
        branch: "",
        worktree: "",
        overlay: "indexed",
        path: "src/alpha.ts",
        artifactKind: REEF_AST_SYMBOLS_ARTIFACT_KIND,
        extractorVersion: REEF_AST_SYMBOLS_EXTRACTOR_VERSION,
      }).length,
      0,
    );
    assert.equal(
      store.queryReefArtifactTags({
        projectId: indexed.project.projectId,
        root: indexed.project.canonicalPath,
        branch: "",
        worktree: "",
        overlay: "indexed",
        path: "src/alpha.ts",
        artifactKind: REEF_IMPORT_EDGES_ARTIFACT_KIND,
        extractorVersion: REEF_IMPORT_EDGES_EXTRACTOR_VERSION,
      }).length,
      0,
    );

    console.log("reef-structural-artifacts: PASS");
  } finally {
    cache.flush();
    restoreEnv("MAKO_STATE_HOME", originalStateHome);
    restoreEnv("MAKO_STATE_DIRNAME", originalStateDirName);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function structuralProducerResult(
  event: { metadata?: Record<string, unknown> } | undefined,
  artifactKind: string,
): Record<string, unknown> | undefined {
  const materialization = asRecord(event?.metadata?.structuralArtifactMaterialization);
  const producerResults = materialization?.producerResults;
  if (!Array.isArray(producerResults)) {
    return undefined;
  }
  return producerResults
    .map(asRecord)
    .find((result) => result?.artifactKind === artifactKind);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
