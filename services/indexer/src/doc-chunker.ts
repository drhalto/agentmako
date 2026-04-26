import {
  chunkKnowledgeMarkdownDocument,
  type KnowledgeMarkdownChunk,
} from "./knowledge/markdown-parser.js";

export type MarkdownChunk = KnowledgeMarkdownChunk;

export function chunkMarkdownDocument(
  relativePath: string,
  content: string,
): MarkdownChunk[] {
  return chunkKnowledgeMarkdownDocument(relativePath, content);
}
