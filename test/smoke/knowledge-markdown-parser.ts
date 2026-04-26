import assert from "node:assert/strict";
import { chunkKnowledgeMarkdownDocument } from "../../services/indexer/src/knowledge/markdown-parser.ts";

function main(): void {
  const content = [
    "---",
    "title: Phase 3",
    "rank: 3",
    "---",
    "# Overview",
    "Parser-backed Markdown chunks keep frontmatter out of text.",
    "",
    "## Details",
    "The chunker follows the mdast heading tree.",
    "",
  ].join("\n");

  const chunks = chunkKnowledgeMarkdownDocument("devdocs/roadmap/phase-3.md", content);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.title, "Overview");
  assert.equal(chunks[0]?.lineStart, 5);
  assert.deepEqual(chunks[0]?.headingPath, ["Overview"]);
  assert.equal(chunks[0]?.frontmatter.title, "Phase 3");
  assert.equal(chunks[0]?.frontmatter.rank, 3);
  assert.ok(!chunks[0]?.text.includes("title: Phase 3"), "frontmatter should not be indexed as doc text");
  assert.equal(chunks[1]?.title, "Overview > Details");
  assert.deepEqual(chunks[1]?.headingPath, ["Overview", "Details"]);
  assert.ok(chunks.every((chunk) => chunk.chunkId.startsWith("md_")));

  console.log("knowledge-markdown-parser: PASS");
}

main();
