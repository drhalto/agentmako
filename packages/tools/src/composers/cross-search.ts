/**
 * `cross_search` — Phase 3.6.1 composer.
 *
 * Cross-source retrieval over code chunks, schema objects, schema bodies,
 * routes, and harness memories. This is the retrieval-layer composer — it
 * surfaces every candidate hit for a term without structural refinement.
 * Downstream composers (`trace_table`, `trace_rpc`, `trace_error`) layer
 * ast-grep proof on top; `cross_search` is deliberately permissive.
 */

import type {
  ComposerQueryKind,
  CrossSearchToolInput,
  CrossSearchToolOutput,
  EvidenceBlock,
} from "@mako-ai/contracts";
import {
  CrossSearchToolInputSchema,
  CrossSearchToolOutputSchema,
} from "@mako-ai/contracts";
import type {
  CodeChunkHit,
  FileSearchMatch,
  ProjectStore,
  ResolvedSchemaObjectRecord,
  SchemaBodyHit,
} from "@mako-ai/store";
import {
  blocksFromChunkHits,
  blocksFromFileMatches,
  blocksFromMemories,
  blocksFromRoutes,
  blocksFromSchemaBodies,
  blocksFromSchemaObjects,
} from "./_shared/blocks.js";
import { defineComposer } from "./_shared/define.js";
import { makePacket } from "./_shared/packet.js";

const QUERY_KIND: ComposerQueryKind = "cross_search";
const DEFAULT_COMPACT_LIMIT = 8;
const DEFAULT_FULL_LIMIT = 15;
const SOURCE_FILE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|sql)$/i;

function isRelevantSourceFile(filePath: string): boolean {
  return SOURCE_FILE_RE.test(filePath);
}

function expandSearchTerms(term: string): string[] {
  const trimmed = term.trim();
  if (trimmed === "") return [];

  const terms = new Set<string>([trimmed]);
  const loweredTokens = trimmed
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 2);

  if (loweredTokens.length >= 2) {
    terms.add(loweredTokens.join("_"));
    terms.add(loweredTokens.join("-"));
  }

  return [...terms];
}

function schemaSearchTerms(term: string): string[] {
  const expanded = expandSearchTerms(term);
  if (!/\s/.test(term.trim())) {
    return expanded;
  }

  const schemaTerms = expanded.filter((candidate) => candidate.includes("_"));
  return schemaTerms.length > 0 ? schemaTerms : [term.trim()];
}

function sourcePathBoost(filePath: string): number {
  if (/^(?:app|components|lib|services|packages|src)\//i.test(filePath)) return 80;
  if (/^supabase\/functions\//i.test(filePath)) return 75;
  if (/^types\//i.test(filePath)) return 35;
  if (/^supabase\/(?:migrations\/|seed\.sql$)/i.test(filePath)) return 20;
  if (/^(?:docs|devdocs|test)\//i.test(filePath)) return -80;
  return 0;
}

function textBoost(text: string, terms: string[]): number {
  const lowered = text.toLowerCase();
  let boost = 0;
  for (const term of terms) {
    const normalizedTerm = term.toLowerCase();
    if (normalizedTerm.length === 0) continue;
    if (lowered.includes(normalizedTerm)) {
      boost += normalizedTerm.includes(" ") ? 140 : 90;
    }
  }
  return boost;
}

function containsExactTerm(text: string, terms: string[]): boolean {
  const lowered = text.toLowerCase();
  return terms.some((term) => term.trim().length > 0 && lowered.includes(term.toLowerCase()));
}

function rankChunkHit(hit: CodeChunkHit, terms: string[]): number {
  return (
    textBoost(`${hit.filePath} ${hit.name ?? ""} ${hit.snippet}`, terms) +
    sourcePathBoost(hit.filePath) +
    (hit.chunkKind === "symbol" ? 30 : 0) +
    Math.max(0, -hit.score)
  );
}

function rankFileHit(hit: FileSearchMatch, terms: string[]): number {
  return textBoost(`${hit.path} ${hit.snippet ?? ""}`, terms) + sourcePathBoost(hit.path);
}

function rankSchemaObject(hit: ResolvedSchemaObjectRecord, terms: string[]): number {
  return textBoost(
    `${hit.schemaName}.${hit.objectName} ${hit.parentObjectName ?? ""} ${hit.dataType ?? ""}`,
    terms,
  );
}

function rankSchemaBody(hit: SchemaBodyHit, terms: string[]): number {
  return textBoost(
    `${hit.schemaName}.${hit.objectName} ${hit.tableName ?? ""} ${hit.bodyText}`,
    terms,
  );
}

function dedupeByKey<T>(items: T[], keyOf: (item: T) => string): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

type CrossSearchToolContext = {
  store: ProjectStore;
};

function isMultiWordTerm(term: string): boolean {
  // Whitespace → explicit multi-word.
  if (/\s/.test(term.trim())) return true;
  // Any non-alphanumeric separator (.,:,(,)/,\,_,-) splits into multiple
  // FTS5 tokens even though the raw string looks like one identifier. The
  // FTS default tokenizer strips those characters, so without phrase mode
  // we would over-match docs containing the tokens anywhere.
  return /[.:_\-()/\\]/.test(term);
}

function collectChunkHits(
  ctx: CrossSearchToolContext,
  terms: string[],
  limit: number,
): CodeChunkHit[] {
  const rawHits = dedupeByKey(
    terms.flatMap((term) =>
      ctx.store.searchCodeChunks(term, {
        limit: limit * 3,
        mode: isMultiWordTerm(term) ? "phrase" : "prefix_and",
      }),
    ),
    (hit) =>
      `${hit.filePath}:${hit.chunkKind}:${hit.name ?? ""}:${hit.lineStart ?? ""}:${hit.lineEnd ?? ""}`,
  ).filter((hit) => isRelevantSourceFile(hit.filePath));

  return rawHits
    .sort((left, right) => {
      const scoreDiff = rankChunkHit(right, terms) - rankChunkHit(left, terms);
      if (scoreDiff !== 0) return scoreDiff;
      return left.filePath.localeCompare(right.filePath);
    })
    .slice(0, limit);
}

function collectFileHits(ctx: CrossSearchToolContext, terms: string[], limit: number): FileSearchMatch[] {
  return dedupeByKey(
    terms.flatMap((term) =>
      ctx.store.searchFiles(term, limit * 3, {
        mode: isMultiWordTerm(term) ? "phrase" : "prefix_and",
      }),
    ),
    (hit) => hit.path,
  )
    .filter((hit) => isRelevantSourceFile(hit.path))
    .sort((left, right) => {
      const scoreDiff = rankFileHit(right, terms) - rankFileHit(left, terms);
      if (scoreDiff !== 0) return scoreDiff;
      return left.path.localeCompare(right.path);
    })
    .slice(0, limit);
}

function collectSchemaHits(
  ctx: CrossSearchToolContext,
  terms: string[],
  limit: number,
  requireExactTermMatch: boolean,
): ResolvedSchemaObjectRecord[] {
  return dedupeByKey(
    terms.flatMap((term) => ctx.store.searchSchemaObjects(term, limit * 2)),
    (hit) => `${hit.objectType}:${hit.schemaName}.${hit.objectName}:${hit.parentObjectName ?? ""}`,
  )
    .filter((hit) =>
      !requireExactTermMatch ||
      containsExactTerm(
        `${hit.schemaName}.${hit.objectName} ${hit.parentObjectName ?? ""} ${hit.dataType ?? ""}`,
        terms,
      ),
    )
    .sort((left, right) => {
      const scoreDiff = rankSchemaObject(right, terms) - rankSchemaObject(left, terms);
      if (scoreDiff !== 0) return scoreDiff;
      if (left.schemaName !== right.schemaName) {
        return left.schemaName.localeCompare(right.schemaName);
      }
      return left.objectName.localeCompare(right.objectName);
    })
    .slice(0, limit);
}

function collectSchemaBodyHits(
  ctx: CrossSearchToolContext,
  terms: string[],
  limit: number,
  requireExactTermMatch: boolean,
): SchemaBodyHit[] {
  return dedupeByKey(
    terms.flatMap((term) => ctx.store.searchSchemaBodies(term, limit * 2)),
    (hit) =>
      `${hit.objectType}:${hit.schemaName}.${hit.objectName}:${hit.tableName ?? ""}:${hit.argTypes?.join(",") ?? ""}`,
  )
    .filter((hit) =>
      !requireExactTermMatch ||
      containsExactTerm(
        `${hit.schemaName}.${hit.objectName} ${hit.tableName ?? ""} ${hit.bodyText}`,
        terms,
      ),
    )
    .sort((left, right) => {
      const scoreDiff = rankSchemaBody(right, terms) - rankSchemaBody(left, terms);
      if (scoreDiff !== 0) return scoreDiff;
      if (left.schemaName !== right.schemaName) {
        return left.schemaName.localeCompare(right.schemaName);
      }
      return left.objectName.localeCompare(right.objectName);
    })
    .slice(0, limit);
}

function summarize(term: string, counts: Record<string, number>): string {
  const parts: string[] = [`Searched '${term}'.`];
  for (const [label, count] of Object.entries(counts)) {
    if (count > 0) parts.push(`${count} ${label}.`);
  }
  if (Object.values(counts).every((n) => n === 0)) {
    parts.push("No hits across code, schema, routes, or memories.");
  }
  return parts.join(" ");
}

export const crossSearchTool = defineComposer({
  name: "cross_search",
  description:
    "Search a term across code chunks, schema objects, RPC/trigger bodies, routes, and stored memories in one call. Returns grouped indexed evidence with freshness details per source. Snapshot-strict; use live_text_search when you need a live disk fallback for recently edited or unindexed files.",
  inputSchema: CrossSearchToolInputSchema,
  outputSchema: CrossSearchToolOutputSchema,
  run: async (
    input: CrossSearchToolInput,
    ctx,
  ): Promise<CrossSearchToolOutput> => {
    const term = input.term;
    const verbosity = input.verbosity ?? "compact";
    const limit = input.limit ?? (verbosity === "full" ? DEFAULT_FULL_LIMIT : DEFAULT_COMPACT_LIMIT);
    const searchTerms = expandSearchTerms(term);
    const schemaTerms = schemaSearchTerms(term);
    const requireExactSchemaTerm = /\s/.test(term.trim());

    const chunkHits = collectChunkHits(ctx, searchTerms, limit);
    const chunkFiles = new Set(chunkHits.map((hit) => hit.filePath));
    const fileHits = collectFileHits(ctx, searchTerms, limit).filter(
      (hit) => !chunkFiles.has(hit.path),
    );
    const schemaHits = collectSchemaHits(ctx, schemaTerms, limit, requireExactSchemaTerm);
    const schemaBodyHits = collectSchemaBodyHits(
      ctx,
      schemaTerms,
      limit,
      requireExactSchemaTerm,
    );
    const routeHits = ctx.store.searchRoutes(term, limit);
    const memoryHits = ctx.store.ftsSearchHarnessMemories(term, {
      projectId: ctx.projectId,
      limit,
      rawUserInput: true,
    });
    const memoryRecords = memoryHits
      .map((match) => ctx.store.getHarnessMemoryByRowid(match.memoryRowid))
      .filter((row): row is NonNullable<typeof row> => row != null);

    const evidence: EvidenceBlock[] = [
      ...blocksFromChunkHits(chunkHits),
      ...blocksFromFileMatches(fileHits, {
        title: (hit) => `file hit ${hit.path}`,
        metadataKind: "cross_search_file_hit",
      }),
      ...blocksFromSchemaObjects(schemaHits),
      ...blocksFromSchemaBodies(schemaBodyHits),
      ...blocksFromRoutes(routeHits),
      ...blocksFromMemories(memoryRecords),
    ];

    const summary = summarize(term, {
      "code hit": chunkHits.length,
      "file hit": fileHits.length,
      "schema object": schemaHits.length,
      "body match": schemaBodyHits.length,
      route: routeHits.length,
      memory: memoryRecords.length,
    });

    const result = makePacket(ctx, {
      queryKind: QUERY_KIND,
      queryText: `cross_search(${term})`,
      evidence,
      summary,
    });

    return {
      toolName: "cross_search",
      projectId: ctx.projectId,
      result,
    };
  },
});
