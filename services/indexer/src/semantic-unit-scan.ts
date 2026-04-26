import path from "node:path";
import type { JsonObject } from "@mako-ai/contracts";
import { hashText, type IndexSnapshot, type SemanticUnitInput } from "@mako-ai/store";
import { chunkMarkdownDocument } from "./doc-chunker.js";
import { readTextFile } from "./fs-utils.js";

function makeUnitId(
  unitKind: SemanticUnitInput["unitKind"],
  ownerRef: string,
  sourceHash: string,
): string {
  return `su_${hashText(`${unitKind}\n${ownerRef}\n${sourceHash}`)}`;
}

function normalizePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

function isSemanticDocPath(relativePath: string): boolean {
  const normalized = normalizePath(relativePath);
  const basename = path.posix.basename(normalized);
  return (
    normalized.startsWith("devdocs/") ||
    normalized.startsWith("docs/") ||
    /^README.*\.md$/i.test(basename)
  );
}

export interface BuildSemanticUnitsInput {
  projectId: string;
  projectRoot: string;
  snapshot: IndexSnapshot;
}

export function buildSemanticUnits(
  input: BuildSemanticUnitsInput,
): SemanticUnitInput[] {
  const units: SemanticUnitInput[] = [];

  for (const file of input.snapshot.files) {
    for (const chunk of file.chunks) {
      if (chunk.chunkKind !== "symbol") {
        continue;
      }
      const sourceHash = hashText(chunk.content);
      const ownerRef = `code:${file.path}:${chunk.lineStart ?? 0}:${chunk.lineEnd ?? 0}:${chunk.name ?? ""}`;
      const metadata: JsonObject = {
        language: file.language,
        symbolName: chunk.name ?? null,
      };
      units.push({
        unitId: makeUnitId("code_symbol", ownerRef, sourceHash),
        projectId: input.projectId,
        unitKind: "code_symbol",
        title: chunk.name ? `${chunk.name} (${file.path})` : file.path,
        text: chunk.content,
        filePath: file.path,
        lineStart: chunk.lineStart ?? null,
        lineEnd: chunk.lineEnd ?? null,
        ownerRef,
        metadata,
        sourceHash,
      });
    }

    if (!isSemanticDocPath(file.path)) {
      continue;
    }

    const absolutePath = path.join(input.projectRoot, file.path);
    const content = readTextFile(absolutePath);
    if (content == null) {
      continue;
    }

    const markdownChunks = chunkMarkdownDocument(file.path, content);
    for (const chunk of markdownChunks) {
      const sourceHash = hashText(chunk.text);
      const ownerRef = `doc:${file.path}:${chunk.lineStart}:${chunk.lineEnd}`;
      const metadata: JsonObject = {
        headingPath: chunk.headingPath,
        chunkId: chunk.chunkId,
      };
      if (Object.keys(chunk.frontmatter).length > 0) {
        metadata.frontmatter = chunk.frontmatter;
      }
      units.push({
        unitId: makeUnitId("doc_chunk", ownerRef, sourceHash),
        projectId: input.projectId,
        unitKind: "doc_chunk",
        title: chunk.title,
        text: chunk.text,
        filePath: file.path,
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        ownerRef,
        metadata,
        sourceHash,
      });
    }
  }

  return units;
}
