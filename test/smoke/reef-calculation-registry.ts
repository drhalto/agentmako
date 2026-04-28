import assert from "node:assert/strict";
import {
  ReefCalculationRegistry,
  ReefCalculationNodeSchema,
  reefCalculationDependencyKey,
  reefCalculationOutputKey,
  type ReefCalculationNode,
} from "../../packages/contracts/src/index.ts";

const fileSnapshotNode: ReefCalculationNode = {
  id: "reef.file_snapshot",
  kind: "fact_writer",
  version: "1.0.0",
  outputs: [{ kind: "fact", factKind: "file_snapshot" }],
  dependsOn: [{ kind: "file", path: "src/routes.ts" }],
  refreshScope: "path_scoped",
  fallback: "mark_stale",
  durability: "low",
  backdating: { strategy: "output_fingerprint", equalityKeys: ["sha256", "sizeBytes"] },
};

const importFactsNode: ReefCalculationNode = {
  id: "reef.import_edges",
  kind: "fact_writer",
  version: "1.0.0",
  outputs: [{ kind: "fact", factKind: "import_edge" }],
  dependsOn: [
    { kind: "file", path: "src/routes.ts" },
    { kind: "config", path: "tsconfig.json" },
  ],
  refreshScope: "path_scoped",
  fallback: "full_refresh",
  durability: "low",
  backdating: {
    strategy: "structural_changed_ranges",
    relevantRangeKinds: ["import_declaration"],
    equalityKeys: ["imports"],
  },
};

const astArtifactNode: ReefCalculationNode = {
  id: "reef.ast_symbols_artifact",
  kind: "artifact_writer",
  version: "1.0.0",
  outputs: [
    {
      kind: "artifact",
      artifactKind: "ast_symbols",
      extractorVersion: "tree-sitter-typescript@smoke",
    },
  ],
  dependsOn: [{ kind: "file", path: "src/routes.ts" }],
  refreshScope: "path_scoped",
  fallback: "drop",
  durability: "low",
  backdating: {
    strategy: "structural_changed_ranges",
    relevantRangeKinds: ["function_declaration", "class_declaration"],
  },
};

function main(): void {
  assert.equal(
    reefCalculationDependencyKey({ kind: "artifact_kind", artifactKind: "ast_symbols" }),
    "artifact:ast_symbols:",
  );
  assert.equal(
    reefCalculationOutputKey({
      kind: "artifact",
      artifactKind: "ast_symbols",
      extractorVersion: "tree-sitter-typescript@smoke",
    }),
    "artifact:ast_symbols:tree-sitter-typescript@smoke",
  );

  const parsed = ReefCalculationNodeSchema.parse(importFactsNode);
  assert.equal(parsed.backdating.strategy, "structural_changed_ranges");

  const registry = new ReefCalculationRegistry([
    fileSnapshotNode,
    importFactsNode,
    astArtifactNode,
  ]);
  assert.deepEqual(
    registry.list().map((node) => node.id),
    ["reef.file_snapshot", "reef.import_edges", "reef.ast_symbols_artifact"],
  );
  assert.equal(
    registry.findProducer({ kind: "fact", factKind: "import_edge" })?.id,
    "reef.import_edges",
  );
  assert.equal(
    registry.findProducer({
      kind: "artifact",
      artifactKind: "ast_symbols",
      extractorVersion: "tree-sitter-typescript@smoke",
    })?.id,
    "reef.ast_symbols_artifact",
  );
  assert.deepEqual(
    registry.findDependents({ kind: "file", path: "src/routes.ts" }).map((node) => node.id),
    ["reef.file_snapshot", "reef.import_edges", "reef.ast_symbols_artifact"],
  );

  assert.throws(
    () => registry.register({ ...fileSnapshotNode }),
    /already registered/,
  );
  assert.throws(
    () =>
      new ReefCalculationRegistry([
        fileSnapshotNode,
        { ...fileSnapshotNode, id: "reef.file_snapshot.copy" },
      ]),
    /already produced/,
  );
  assert.throws(
    () =>
      ReefCalculationNodeSchema.parse({
        ...importFactsNode,
        dependsOn: [],
      }),
    /non-input calculation nodes must declare/,
  );
  assert.throws(
    () =>
      ReefCalculationNodeSchema.parse({
        ...importFactsNode,
        dependsOn: [{ kind: "fact_kind", factKind: "file_snapshot" }],
        backdating: {
          strategy: "structural_changed_ranges",
          relevantRangeKinds: ["import_declaration"],
        },
      }),
    /requires a file or glob dependency/,
  );

  console.log("reef-calculation-registry: PASS");
}

main();
