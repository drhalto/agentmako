/**
 * `trace_table` — Phase 3.6.1 composer.
 *
 * Full table trace:
 *   - schema surface (columns, primary key, indexes, foreign keys, RLS,
 *     triggers) via `getSchemaTableSnapshot`
 *   - RPC → table edges from `listFunctionTableRefs({ tableName, targetSchema })`
 *   - app-code call sites confirmed with ast-grep `$C.from('$TABLE')`,
 *     constrained by the captured $TABLE matching the input table
 *
 * FTS retrieval narrows the ast-grep pass to files that mention the table.
 */

import type {
  ComposerQueryKind,
  EvidenceBlock,
  TraceTableToolInput,
  TraceTableToolOutput,
} from "@mako-ai/contracts";
import {
  TraceTableToolInputSchema,
  TraceTableToolOutputSchema,
} from "@mako-ai/contracts";
import {
  blocksFromAstHits,
  blocksFromFileMatches,
  blocksFromFindings,
  blocksFromFunctionTableRefs,
  blocksFromSchemaColumns,
  blocksFromSchemaForeignKeys,
  blocksFromSchemaIndexes,
  blocksFromSchemaRls,
  blocksFromSchemaTriggers,
} from "./_shared/blocks.js";
import { findAstMatches, langFromPath, type AstHit } from "../code-intel/ast-patterns.js";
import { defineComposer } from "./_shared/define.js";
import { makePacket } from "./_shared/packet.js";

const QUERY_KIND: ComposerQueryKind = "trace_table";
const CANDIDATE_FILE_LIMIT = 20;

function isRelevantRelatedFile(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|sql)$/i.test(filePath);
}

function summarize(
  schema: string,
  table: string,
  counts: {
    columns: number;
    fks: number;
    rls: number;
    triggers: number;
    indexes: number;
    callers: number;
    rpcRefs: number;
    relatedFiles: number;
    dependents: number;
  },
): string {
  const parts: string[] = [`Traced ${schema}.${table}.`];
  if (counts.columns > 0) parts.push(`${counts.columns} column${counts.columns === 1 ? "" : "s"}.`);
  if (counts.indexes > 0) parts.push(`${counts.indexes} index${counts.indexes === 1 ? "" : "es"}.`);
  if (counts.fks > 0) parts.push(`${counts.fks} foreign key${counts.fks === 1 ? "" : "s"}.`);
  if (counts.rls > 0) parts.push(`${counts.rls} RLS polic${counts.rls === 1 ? "y" : "ies"}.`);
  if (counts.triggers > 0) parts.push(`${counts.triggers} trigger${counts.triggers === 1 ? "" : "s"}.`);
  if (counts.callers > 0)
    parts.push(`${counts.callers} app-code .from() call${counts.callers === 1 ? "" : "s"}.`);
  if (counts.rpcRefs > 0)
    parts.push(`${counts.rpcRefs} RPC bod${counts.rpcRefs === 1 ? "y" : "ies"} reference${counts.rpcRefs === 1 ? "s" : ""} the table.`);
  if (counts.relatedFiles > 0)
    parts.push(`${counts.relatedFiles} related file mention${counts.relatedFiles === 1 ? "" : "s"}.`);
  if (counts.dependents > 0)
    parts.push(`${counts.dependents} dependent flow file${counts.dependents === 1 ? "" : "s"}.`);
  if (Object.values(counts).every((n) => n === 0)) {
    parts.push("No schema, caller, or RPC-ref evidence found.");
  }
  return parts.join(" ");
}

export const traceTableTool = defineComposer({
  name: "trace_table",
  description:
    "Trace a table end-to-end: columns, indexes, foreign keys, RLS, triggers (via getSchemaTableSnapshot), schema-scoped RPC → table edges (via listFunctionTableRefs), and app-code .from('$TABLE') call sites (FTS-retrieval + ast-grep proof). Snapshot-strict.",
  inputSchema: TraceTableToolInputSchema,
  outputSchema: TraceTableToolOutputSchema,
  run: async (
    input: TraceTableToolInput,
    ctx,
  ): Promise<TraceTableToolOutput> => {
    const schemaName = input.schema?.trim() || "public";
    const tableName = input.table;
    const missingInformation: string[] = [];

    const table = ctx.store.getSchemaTableSnapshot(schemaName, tableName);
    if (!table) {
      missingInformation.push(
        `Table ${schemaName}.${tableName} is not present in the current schema snapshot.`,
      );
    }

    const rpcRefs = ctx.store.listFunctionTableRefs({
      tableName,
      targetSchema: schemaName,
    });
    const relatedFiles = ctx.store
      .searchFiles(tableName, 20)
      .filter((hit) => isRelevantRelatedFile(hit.path));
    const dependentFiles = new Set<string>();
    for (const hit of relatedFiles) {
      for (const dependent of ctx.store.listDependentsForFile(hit.path)) {
        if (!dependent.targetExists) continue;
        if (!isRelevantRelatedFile(dependent.sourcePath)) continue;
        dependentFiles.add(dependent.sourcePath);
      }
    }

    // FTS + LIKE retrieval for caller candidate files.
    const chunkHits = ctx.store.searchCodeChunks(tableName, { limit: 40 });
    const fileHits = ctx.store.searchFiles(tableName, 20);
    const seen = new Set<string>();
    const candidateFiles: string[] = [];
    for (const filePath of [
      ...chunkHits.map((hit) => hit.filePath),
      ...fileHits.map((hit) => hit.path),
    ]) {
      if (seen.has(filePath)) continue;
      if (langFromPath(filePath) == null) continue;
      seen.add(filePath);
      candidateFiles.push(filePath);
      if (candidateFiles.length >= CANDIDATE_FILE_LIMIT) break;
    }

    const callerHits: AstHit[] = [];
    for (const filePath of candidateFiles) {
      const content = ctx.store.getFileContent(filePath);
      if (content == null) continue;
      const matches = findAstMatches(filePath, content, [
        { pattern: `$CLIENT.from('${tableName}')`, captures: [] },
        { pattern: `$CLIENT.from("${tableName}")`, captures: [] },
      ]);
      callerHits.push(...matches);
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

    evidence.push(
      ...blocksFromFunctionTableRefs(rpcRefs),
      ...blocksFromAstHits(callerHits, {
        title: (hit) => `.from('${tableName}') at ${hit.filePath}:${hit.lineStart}`,
        metadataKind: "table_caller",
      }),
      ...blocksFromFileMatches(relatedFiles, {
        title: (hit) => `related file ${hit.path}`,
        metadataKind: "table_related_file",
      }),
      ...blocksFromFindings(
        [...dependentFiles].sort().map((filePath) => ({
          title: `dependent flow file ${filePath}`,
          detail: `Imports or consumes a file that directly references ${schemaName}.${tableName}.`,
          sourceRef: filePath,
          filePath,
        })),
      ),
    );

    const summary = summarize(schemaName, tableName, {
      columns: table?.columns.length ?? 0,
      indexes: table?.indexes?.length ?? 0,
      fks: (table?.foreignKeys?.outbound.length ?? 0) + (table?.foreignKeys?.inbound.length ?? 0),
      rls: table?.rls?.policies.length ?? 0,
      triggers: table?.triggers?.length ?? 0,
      callers: callerHits.length,
      rpcRefs: rpcRefs.length,
      relatedFiles: relatedFiles.length,
      dependents: dependentFiles.size,
    });

    const result = makePacket(ctx, {
      queryKind: QUERY_KIND,
      queryText: `trace_table(${schemaName}.${tableName})`,
      evidence,
      summary,
      missingInformation,
    });

    return {
      toolName: "trace_table",
      projectId: ctx.projectId,
      result,
    };
  },
});
