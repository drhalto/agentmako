import path from "node:path";
import type { JsonObject, JsonValue } from "@mako-ai/contracts";
import { hashText } from "@mako-ai/store";
import matter from "gray-matter";
import { remark } from "remark";

export interface KnowledgeMarkdownChunk {
  chunkId: string;
  title: string;
  text: string;
  lineStart: number;
  lineEnd: number;
  headingPath: string[];
  frontmatter: JsonObject;
}

interface MarkdownNode {
  type?: string;
  value?: string;
  depth?: number;
  children?: MarkdownNode[];
  position?: {
    start?: {
      line?: number;
    };
  };
}

interface Section {
  headingPath: string[];
  startLine: number;
  endLine: number;
  lines: string[];
}

const MAX_CHUNK_CHARS = 2200;
const MAX_CHUNK_LINES = 80;

function normalizeTitle(relativePath: string, headingPath: string[]): string {
  if (headingPath.length > 0) {
    return headingPath.join(" > ");
  }
  return path.posix.basename(relativePath);
}

function normalizeJsonValue(value: unknown): JsonValue | undefined {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const values = value
      .map((entry) => normalizeJsonValue(entry))
      .filter((entry): entry is JsonValue => entry !== undefined);
    return values;
  }
  if (typeof value === "object") {
    const objectValue: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalized = normalizeJsonValue(entry);
      if (normalized !== undefined) {
        objectValue[key] = normalized;
      }
    }
    return objectValue;
  }
  return undefined;
}

function normalizeFrontmatter(data: Record<string, unknown>): JsonObject {
  const normalized: JsonObject = {};
  for (const [key, value] of Object.entries(data)) {
    const jsonValue = normalizeJsonValue(value);
    if (jsonValue !== undefined) {
      normalized[key] = jsonValue;
    }
  }
  return normalized;
}

function detectFrontmatterLineOffset(content: string): number {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return 0;
  }
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (line === "---" || line === "...") {
      return i + 1;
    }
  }
  return 0;
}

function headingText(node: MarkdownNode): string {
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? []).map((child) => headingText(child)).join("").trim();
}

function flushSection(
  sections: Section[],
  headingPath: string[],
  lines: string[],
  startLine: number,
  endLine: number,
): void {
  if (lines.length === 0) {
    return;
  }
  const text = lines.join("\n").trim();
  if (text.length === 0) {
    return;
  }
  sections.push({
    headingPath: [...headingPath],
    startLine,
    endLine,
    lines: [...lines],
  });
}

function makeChunkId(relativePath: string, lineStart: number, lineEnd: number, text: string): string {
  return `md_${hashText(`${relativePath}\n${lineStart}\n${lineEnd}\n${text}`)}`;
}

function splitSection(
  relativePath: string,
  section: Section,
  lineOffset: number,
  frontmatter: JsonObject,
): KnowledgeMarkdownChunk[] {
  const totalChars = section.lines.join("\n").length;
  if (totalChars <= MAX_CHUNK_CHARS && section.lines.length <= MAX_CHUNK_LINES) {
    const text = section.lines.join("\n").trim();
    const lineStart = section.startLine + lineOffset;
    const lineEnd = section.endLine + lineOffset;
    return [{
      chunkId: makeChunkId(relativePath, lineStart, lineEnd, text),
      title: normalizeTitle(relativePath, section.headingPath),
      text,
      lineStart,
      lineEnd,
      headingPath: [...section.headingPath],
      frontmatter,
    }];
  }

  const chunks: KnowledgeMarkdownChunk[] = [];
  let currentLines: string[] = [];
  let currentStartLine = section.startLine;
  let currentChars = 0;

  for (let i = 0; i < section.lines.length; i += 1) {
    const line = section.lines[i]!;
    const nextChars = currentChars + line.length + 1;
    const nextLineCount = currentLines.length + 1;
    if (currentLines.length > 0 && (nextChars > MAX_CHUNK_CHARS || nextLineCount > MAX_CHUNK_LINES)) {
      const text = currentLines.join("\n").trim();
      const lineStart = currentStartLine + lineOffset;
      const lineEnd = currentStartLine + currentLines.length - 1 + lineOffset;
      chunks.push({
        chunkId: makeChunkId(relativePath, lineStart, lineEnd, text),
        title:
          chunks.length === 0
            ? normalizeTitle(relativePath, section.headingPath)
            : `${normalizeTitle(relativePath, section.headingPath)} (part ${chunks.length + 1})`,
        text,
        lineStart,
        lineEnd,
        headingPath: [...section.headingPath],
        frontmatter,
      });
      currentLines = [];
      currentStartLine = section.startLine + i;
      currentChars = 0;
    }
    currentLines.push(line);
    currentChars += line.length + 1;
  }

  if (currentLines.length > 0) {
    const text = currentLines.join("\n").trim();
    const lineStart = currentStartLine + lineOffset;
    const lineEnd = currentStartLine + currentLines.length - 1 + lineOffset;
    chunks.push({
      chunkId: makeChunkId(relativePath, lineStart, lineEnd, text),
      title:
        chunks.length === 0
          ? normalizeTitle(relativePath, section.headingPath)
          : `${normalizeTitle(relativePath, section.headingPath)} (part ${chunks.length + 1})`,
      text,
      lineStart,
      lineEnd,
      headingPath: [...section.headingPath],
      frontmatter,
    });
  }

  return chunks.filter((chunk) => chunk.text.length > 0);
}

export function chunkKnowledgeMarkdownDocument(
  relativePath: string,
  content: string,
): KnowledgeMarkdownChunk[] {
  const parsedMatter = matter(content);
  const markdown = parsedMatter.content;
  const lineOffset = detectFrontmatterLineOffset(content);
  const frontmatter = normalizeFrontmatter(parsedMatter.data);
  const tree = remark().parse(markdown) as MarkdownNode;
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  const headingPath: string[] = [];
  let sectionStartLine = 1;

  for (const child of tree.children ?? []) {
    if (child.type !== "heading" || typeof child.depth !== "number") {
      continue;
    }
    const headingLine = child.position?.start?.line;
    if (typeof headingLine !== "number") {
      continue;
    }

    flushSection(
      sections,
      headingPath,
      lines.slice(sectionStartLine - 1, headingLine - 1),
      sectionStartLine,
      headingLine - 1,
    );

    const level = Math.max(1, Math.min(6, child.depth));
    const title = headingText(child).trim();
    headingPath.splice(level - 1);
    headingPath[level - 1] = title;
    sectionStartLine = headingLine;
  }

  flushSection(
    sections,
    headingPath,
    lines.slice(sectionStartLine - 1),
    sectionStartLine,
    lines.length,
  );

  return sections.flatMap((section) =>
    splitSection(relativePath, section, lineOffset, frontmatter),
  );
}
