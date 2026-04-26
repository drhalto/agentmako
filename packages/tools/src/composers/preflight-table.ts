/**
 * `preflight_table` — Phase 3.6.1 composer.
 *
 * Returns an `AnswerResult`-shaped packet with the full preflight surface for
 * one table: columns, primary key, indexes, foreign keys (both directions),
 * RLS state + policies, triggers, routes that mention the table, and zod
 * schema declarations whose surrounding file references the table.
 *
 * Read-only, snapshot-strict. FTS is used as the retrieval layer to narrow
 * candidate files; ast-grep is the structural-proof layer that confirms a
 * zod schema is actually present.
 */

import type {
  ComposerQueryKind,
  EvidenceBlock,
  PreflightTableToolInput,
  PreflightTableToolOutput,
} from "@mako-ai/contracts";
import {
  PreflightTableToolInputSchema,
  PreflightTableToolOutputSchema,
} from "@mako-ai/contracts";
import {
  blocksFromAstHits,
  blocksFromFileMatches,
  blocksFromRoutes,
  blocksFromSchemaColumns,
  blocksFromSchemaForeignKeys,
  blocksFromSchemaIndexes,
  blocksFromSchemaRls,
  blocksFromSchemaTriggers,
} from "./_shared/blocks.js";
import { findAstMatches, langFromPath } from "../code-intel/ast-patterns.js";
import { defineComposer } from "./_shared/define.js";
import { makePacket } from "./_shared/packet.js";

const QUERY_KIND: ComposerQueryKind = "preflight_table";

const ZOD_SCAN_FILE_LIMIT = 12;
const TABLE_MENTION_WINDOW = 1;
const RELATED_FILE_LIMIT = 40;

function isRelevantRelatedFile(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|sql)$/i.test(filePath);
}

function hitHasNearbyTableMention(
  sourceText: string,
  lineStart: number,
  lineEnd: number,
  tableName: string,
): boolean {
  const normalizedTable = tableName.trim().toLowerCase();
  if (normalizedTable === "") return false;
  const lines = sourceText.split(/\r?\n/);
  const start = Math.max(0, lineStart - 1 - TABLE_MENTION_WINDOW);
  const end = Math.min(lines.length, lineEnd + TABLE_MENTION_WINDOW);
  const windowText = lines.slice(start, end).join("\n").toLowerCase();
  return windowText.includes(normalizedTable);
}

function summarize(
  schema: string,
  table: string,
  counts: {
    columns: number;
    indexes: number;
    fks: number;
    rls: number;
    triggers: number;
    routes: number;
    zod: number;
    relatedFiles: number;
  },
): string {
  const parts: string[] = [`Preflight for ${schema}.${table}.`];
  if (counts.columns > 0) parts.push(`${counts.columns} column${counts.columns === 1 ? "" : "s"}.`);
  if (counts.indexes > 0) parts.push(`${counts.indexes} index${counts.indexes === 1 ? "" : "es"}.`);
  if (counts.fks > 0) parts.push(`${counts.fks} foreign key${counts.fks === 1 ? "" : "s"}.`);
  if (counts.rls > 0) parts.push(`${counts.rls} RLS polic${counts.rls === 1 ? "y" : "ies"}.`);
  if (counts.triggers > 0)
    parts.push(`${counts.triggers} trigger${counts.triggers === 1 ? "" : "s"}.`);
  if (counts.routes > 0) parts.push(`${counts.routes} related route${counts.routes === 1 ? "" : "s"}.`);
  if (counts.zod > 0) parts.push(`${counts.zod} zod schema${counts.zod === 1 ? "" : "s"}.`);
  if (counts.relatedFiles > 0)
    parts.push(`${counts.relatedFiles} related file mention${counts.relatedFiles === 1 ? "" : "s"}.`);
  if (
    counts.columns === 0 &&
    counts.indexes === 0 &&
    counts.fks === 0 &&
    counts.rls === 0 &&
    counts.triggers === 0 &&
    counts.routes === 0 &&
    counts.zod === 0 &&
    counts.relatedFiles === 0
  ) {
    parts.push("No schema or code evidence found.");
  }
  return parts.join(" ");
}

export const preflightTableTool = defineComposer({
  name: "preflight_table",
  description:
    "Return the full preflight surface for a table: columns, primary key, indexes, foreign keys, RLS state + policies, triggers, related routes, and zod schemas whose surrounding file references the table. Snapshot-strict.",
  inputSchema: PreflightTableToolInputSchema,
  outputSchema: PreflightTableToolOutputSchema,
  run: async (
    input: PreflightTableToolInput,
    ctx,
  ): Promise<PreflightTableToolOutput> => {
    const schemaName = input.schema?.trim() || "public";
    const tableName = input.table;
    const missingInformation: string[] = [];

    const table = ctx.store.getSchemaTableSnapshot(schemaName, tableName);
    if (!table) {
      missingInformation.push(
        `Table ${schemaName}.${tableName} is not present in the current schema snapshot.`,
      );
    }

    const evidence: EvidenceBlock[] = [];
    if (table) {
      evidence.push(
        ...blocksFromSchemaColumns(table.columns, schemaName, tableName),
        ...blocksFromSchemaIndexes(table.indexes ?? [], schemaName, tableName),
        ...blocksFromSchemaForeignKeys(
          table.foreignKeys?.outbound ?? [],
          table.foreignKeys?.inbound ?? [],
          schemaName,
          tableName,
        ),
        ...blocksFromSchemaRls(table.rls, schemaName, tableName),
        ...blocksFromSchemaTriggers(table.triggers, schemaName, tableName),
      );
    }

    const routes = ctx.store.searchRoutes(tableName, 10);
    evidence.push(...blocksFromRoutes(routes));
    const relatedFiles = ctx.store
      .searchFiles(tableName, RELATED_FILE_LIMIT)
      .filter((hit) => isRelevantRelatedFile(hit.path));
    evidence.push(
      ...blocksFromFileMatches(relatedFiles, {
        title: (hit) => `related file ${hit.path}`,
        metadataKind: "preflight_related_file",
      }),
    );

    // FTS retrieval — narrow to TS-like files that mention the table. We only
    // scan the top few results to keep the ast-grep pass bounded.
    const candidateHits = ctx.store
      .searchCodeChunks(tableName, { limit: 40 })
      .filter((hit) => langFromPath(hit.filePath) != null);

    const seenFiles = new Set<string>();
    const candidateFiles: string[] = [];
    for (const hit of candidateHits) {
      if (seenFiles.has(hit.filePath)) continue;
      seenFiles.add(hit.filePath);
      candidateFiles.push(hit.filePath);
      if (candidateFiles.length >= ZOD_SCAN_FILE_LIMIT) break;
    }

    const zodHits = [] as ReturnType<typeof findAstMatches>;
    for (const filePath of candidateFiles) {
      const content = ctx.store.getFileContent(filePath);
      if (content == null) continue;
      const matches = findAstMatches(filePath, content, [
        { pattern: "z.object({ $$$FIELDS })" },
      ]).filter((hit) =>
        hitHasNearbyTableMention(content, hit.lineStart, hit.lineEnd, tableName),
      );
      zodHits.push(...matches);
    }

    evidence.push(
      ...blocksFromAstHits(zodHits, {
        title: (hit) => `zod schema in ${hit.filePath}`,
        metadataKind: "zod_object",
      }),
    );

    const summary = summarize(schemaName, tableName, {
      columns: table?.columns.length ?? 0,
      indexes: table?.indexes?.length ?? 0,
      fks: (table?.foreignKeys?.outbound.length ?? 0) + (table?.foreignKeys?.inbound.length ?? 0),
      rls: table?.rls?.policies.length ?? 0,
      triggers: table?.triggers?.length ?? 0,
      routes: routes.length,
      zod: zodHits.length,
      relatedFiles: relatedFiles.length,
    });

    const result = makePacket(ctx, {
      queryKind: QUERY_KIND,
      queryText: `preflight_table(${schemaName}.${tableName})`,
      evidence,
      summary,
      missingInformation,
    });

    return {
      toolName: "preflight_table",
      projectId: ctx.projectId,
      result,
    };
  },
});
