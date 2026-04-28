/**
 * Regression smoke — semantic-unit ownerRef must disambiguate sibling
 * declarations that share a line range and name.
 *
 * Background: minified JS bundles (e.g. Playwright's `utilsBundleImpl.js`)
 * routinely contain repeated top-level statements on a single long line —
 * `let t=Pr();...;let t=Pr();`. Tree-sitter emits one `lexical_declaration`
 * chunk per statement, but both share `(name="t", lineStart=1, lineEnd=1)`
 * and identical truncated content. Before the fix, this collapsed to a
 * single `unitId`, tripping the UNIQUE constraint on
 * `harness_semantic_units.unit_id` and rolling back the entire index run —
 * the project would be permanently unindexable until purged.
 *
 * The fix: thread the chunker's per-node byte offsets into ownerRef so each
 * AST node gets a distinct unitId.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProject } from "../../services/indexer/src/file-scan.ts";
import { buildSemanticUnits } from "../../services/indexer/src/semantic-unit-scan.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-unitid-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  // Two top-level `let t=Pr()` statements on the same source line. Different
  // byte ranges, identical (name, line, content) → identical unitId pre-fix.
  writeFileSync(
    path.join(projectRoot, "src", "minified.js"),
    "function Pr(){return 1}let t=Pr();let t=Pr();\n",
  );
  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "unitid-smoke", version: "0.0.0" }),
  );

  const profile = {
    name: "unitid-smoke",
    rootPath: projectRoot,
    framework: "unknown" as const,
    orm: "unknown" as const,
    srcRoot: "src",
    entryPoints: [],
    pathAliases: {},
    middlewareFiles: [],
    serverOnlyModules: [],
    authGuardSymbols: [],
    supportLevel: "best_effort" as const,
    detectedAt: new Date().toISOString(),
  };

  try {
    const { snapshot } = await scanProject(projectRoot, profile);
    const minified = snapshot.files.find((f) => f.path.endsWith("minified.js"));
    assert.ok(minified, "minified.js must appear in the snapshot");

    const tChunks = minified.chunks.filter(
      (c) => c.chunkKind === "symbol" && c.name === "t",
    );
    assert.equal(
      tChunks.length,
      2,
      `chunker must emit both 'let t=Pr()' declarations as separate chunks; got ${tChunks.length}`,
    );
    for (const chunk of tChunks) {
      assert.ok(
        typeof chunk.startIndex === "number" && typeof chunk.endIndex === "number",
        "tree-sitter symbol chunks must carry byte offsets so semantic units can disambiguate",
      );
    }
    assert.notEqual(
      tChunks[0]!.startIndex,
      tChunks[1]!.startIndex,
      "the two 't' chunks must have distinct byte offsets",
    );

    const units = buildSemanticUnits({
      projectId: "p_unitid_smoke",
      projectRoot,
      snapshot,
    });
    const ids = new Set<string>();
    for (const unit of units) {
      assert.ok(
        !ids.has(unit.unitId),
        `duplicate unitId emitted by buildSemanticUnits: ${unit.unitId} (ownerRef=${unit.ownerRef})`,
      );
      ids.add(unit.unitId);
    }

    // End-to-end: persisting the units must not trip the UNIQUE constraint.
    const store = openProjectStore({ projectRoot });
    try {
      store.saveProjectProfile(profile);
      const inserted = store.replaceSemanticUnits(units);
      assert.equal(
        inserted,
        units.length,
        "replaceSemanticUnits must accept every unit without a UNIQUE constraint failure",
      );
    } finally {
      store.close();
    }

    console.log("semantic-unit-id-uniqueness: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
