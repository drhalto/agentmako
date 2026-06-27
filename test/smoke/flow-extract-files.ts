/**
 * Unit smoke for the Flow visualization's tool→file extraction.
 *
 * The Flow graph has no normalized tool↔file edge to read — it reconstructs
 * edges by mining file paths out of `tool_runs` JSON summaries and live SSE
 * previews. This test pins that extraction against the real summary shapes
 * (file_edit / repo_map / search results / truncated previews / live events)
 * and the false positives it must reject (URLs, globs, version strings,
 * `node:` schemes, bare non-file tokens).
 *
 * Pure / node-only: imports the framework-free helper directly.
 */

import assert from "node:assert/strict";
import {
  extractTouchedFiles,
  extractFilesFromValue,
  isMutationRun,
  looksLikeFilePath,
  normalizeFilePath,
} from "../../apps/web/src/lib/flow/extract-files.ts";

function sortedSet(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function main(): void {
  // --- file_edit: path in input, filesAffected in output -------------------
  const fileEdit = extractTouchedFiles({
    toolName: "file_edit",
    inputSummary: { projectId: "p1", path: "src/app.ts", edits: [{ old: "a", new: "b" }] },
    outputSummary: { ok: true, snapshotId: "snap_1", bytesAffected: 42, filesAffected: ["src/app.ts"] },
  });
  assert.deepEqual(sortedSet(fileEdit), ["src/app.ts"], "file_edit touches src/app.ts");
  assert.equal(
    isMutationRun({ toolName: "file_edit", outputSummary: { filesAffected: ["src/app.ts"] } }),
    true,
    "file_edit is a mutation",
  );

  // --- repo_map: file list lives under payload.files -----------------------
  const repoMap = extractTouchedFiles({
    toolName: "repo_map",
    inputSummary: { projectId: "p1" },
    payload: { files: ["src/index.ts", "src/util.ts", "package.json"] },
  });
  assert.deepEqual(
    sortedSet(repoMap),
    ["package.json", "src/index.ts", "src/util.ts"],
    "repo_map collects payload.files incl. bare package.json",
  );
  assert.equal(isMutationRun({ toolName: "repo_map", payload: { files: ["src/index.ts"] } }), false, "repo_map is read-only");

  // --- search results: paths nested under arbitrary result objects ---------
  const search = extractTouchedFiles({
    toolName: "search_files",
    inputSummary: { projectId: "p1", query: "useState" },
    outputSummary: {
      results: [
        { filePath: "apps/web/src/App.tsx", line: 3, preview: "import { useState }" },
        { filePath: "services/api/src/routes/tools.ts", line: 21 },
        { filePath: "apps/web/src/App.tsx", line: 9 }, // duplicate path, distinct line
      ],
    },
  });
  assert.deepEqual(
    sortedSet(search),
    ["apps/web/src/App.tsx", "services/api/src/routes/tools.ts"],
    "search dedupes repeated file paths",
  );

  // --- truncated preview: recover paths from the preview text --------------
  const truncated = extractFilesFromValue({
    truncated: true,
    originalLength: 9000,
    preview: '{"matches":[{"path":"src/a.ts","line":4},{"path":"pkg/b/c.tsx"}],"note":"https://example.com/skip.ts"}',
  });
  assert.deepEqual(sortedSet(truncated), ["pkg/b/c.tsx", "src/a.ts"], "preview scan recovers paths, skips URL");

  // truncated preview where escaped newlines abut paths (the `\ncomponents`
  // phantom-dir regression seen on real recall data).
  const escaped = extractFilesFromValue({
    truncated: true,
    originalLength: 5000,
    preview: 'lib/utils.ts:\\n⋮...\\ncomponents/ui/button.tsx:\\n│export',
  });
  assert.deepEqual(
    sortedSet(escaped),
    ["components/ui/button.tsx", "lib/utils.ts"],
    "escaped newlines must not produce ncomponents/nlib phantoms",
  );

  // multiply-escaped (JSON-in-JSON) previews: a newline arrives as a run of
  // backslashes + n. `\\\\\\\\n` in TS source = four backslashes + n at runtime.
  const nested = extractFilesFromValue({
    truncated: true,
    originalLength: 8000,
    preview: "string => {\\\\\\\\n⋮...\\\\\\\\n\\\\\\\\ncomponents/ui/button.tsx\\\\\\\\nlib/utils/get-initials.ts",
  });
  assert.deepEqual(
    sortedSet(nested),
    ["components/ui/button.tsx", "lib/utils/get-initials.ts"],
    "multiply-escaped newlines must not orphan the escape letter",
  );

  // --- live event shape (tool.call args + tool.result preview) -------------
  const liveEvent = extractTouchedFiles({
    tool: "file_write",
    argsPreview: { path: "src/new-feature.ts", content: "export const x = 1;" },
    resultPreview: { ok: true, filesAffected: ["src/new-feature.ts"] },
  });
  assert.deepEqual(sortedSet(liveEvent), ["src/new-feature.ts"], "live event extracts from argsPreview/resultPreview");
  assert.equal(isMutationRun({ tool: "file_write", resultPreview: {} }), true, "file_write tool name flags mutation");

  // --- Windows backslashes normalize to POSIX ------------------------------
  assert.equal(normalizeFilePath("src\\components\\Flow.tsx"), "src/components/Flow.tsx");
  assert.equal(normalizeFilePath("C:\\Users\\dev\\proj\\src\\a.ts"), "Users/dev/proj/src/a.ts");
  assert.equal(normalizeFilePath("./src/a.ts"), "src/a.ts");

  // --- negatives: things that must NOT be treated as files -----------------
  const negatives = extractFilesFromValue({
    url: "https://example.com/app.ts",
    glob: "**/*.ts",
    scheme: "node:fs",
    version: "v1.2.3",
    prose: "What is in the repository right now?",
    bareWord: "Math.max",
    number: 12.34,
  });
  assert.deepEqual(negatives, [], `negatives must yield no files, got ${JSON.stringify(negatives)}`);

  // path-likeness unit checks
  assert.equal(looksLikeFilePath("src/index.ts"), true);
  assert.equal(looksLikeFilePath("package.json"), true);
  assert.equal(looksLikeFilePath("README.md"), true);
  assert.equal(looksLikeFilePath("Math.max"), false, "bare unknown ext rejected");
  assert.equal(looksLikeFilePath("v1.2.3"), false, "version string rejected");
  assert.equal(looksLikeFilePath("**/*.ts"), false, "glob rejected");
  assert.equal(looksLikeFilePath("node:fs"), false, "scheme rejected");

  // --- empty / no-path run yields nothing ----------------------------------
  const empty = extractTouchedFiles({
    toolName: "ask",
    inputSummary: { projectId: "p1", queryText: "What should I inspect next?" },
    outputSummary: { answer: "Look at the auth module and its callers." },
  });
  assert.deepEqual(empty, [], "free-form ask touches no files");

  console.log("flow-extract-files: PASS");
}

try {
  main();
} catch (error) {
  console.error("flow-extract-files: FAIL");
  console.error(error);
  process.exit(1);
}
