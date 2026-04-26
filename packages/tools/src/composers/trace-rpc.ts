/**
 * `trace_rpc` — Phase 3.6.1 composer.
 *
 * Full RPC lifecycle:
 *   - the RPC's own definition site, via `searchSchemaObjects` filtered to
 *     `objectType === "rpc"` matching name/schema
 *   - other PL/pgSQL function or trigger bodies that reference the RPC name,
 *     via `searchSchemaBodies`, with body-text proof and precise self-body
 *     exclusion when schema / argTypes identify the target overload
 *   - table edges reached from the RPC body, via
 *     `listFunctionTableRefs({ rpcSchema, rpcName, argTypes })`
 *   - app-code `.rpc('$FN')` call sites, FTS-retrieved then confirmed with
 *     ast-grep
 */

import type {
  ComposerQueryKind,
  EvidenceBlock,
  TraceRpcToolInput,
  TraceRpcToolOutput,
} from "@mako-ai/contracts";
import {
  TraceRpcToolInputSchema,
  TraceRpcToolOutputSchema,
} from "@mako-ai/contracts";
import {
  blocksFromAstHits,
  blocksFromFunctionTableRefs,
  blocksFromSchemaBodies,
  blocksFromSchemaObjects,
} from "./_shared/blocks.js";
import { findAstMatches, langFromPath, type AstHit } from "../code-intel/ast-patterns.js";
import { defineComposer } from "./_shared/define.js";
import { makePacket } from "./_shared/packet.js";

const QUERY_KIND: ComposerQueryKind = "trace_rpc";
const CANDIDATE_FILE_LIMIT = 20;

function sameArgTypes(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function bodyMentionsRpc(bodyText: string, rpcName: string): boolean {
  return bodyText.toLowerCase().includes(rpcName.trim().toLowerCase());
}

function isTargetRpcBody(
  hit: { objectType: string; schemaName: string; objectName: string; argTypes?: string[] },
  rpcName: string,
  schemaName: string | undefined,
  argTypes: readonly string[] | undefined,
): boolean {
  if (hit.objectType !== "rpc" || hit.objectName !== rpcName) return false;
  if (schemaName && hit.schemaName !== schemaName) return false;
  if (argTypes && !sameArgTypes(hit.argTypes, argTypes)) return false;
  return schemaName != null || argTypes != null;
}

function formatRpcQuery(schemaName: string | undefined, rpcName: string, argTypes: readonly string[] | undefined): string {
  const qualifiedName = schemaName ? `${schemaName}.${rpcName}` : rpcName;
  return argTypes && argTypes.length > 0
    ? `trace_rpc(${qualifiedName}(${argTypes.join(", ")}))`
    : `trace_rpc(${qualifiedName})`;
}

function summarize(
  schema: string,
  name: string,
  counts: {
    definitions: number;
    referencingBodies: number;
    tableRefs: number;
    callers: number;
  },
): string {
  const parts: string[] = [`Traced RPC ${schema}.${name}.`];
  if (counts.definitions > 0)
    parts.push(`${counts.definitions} definition${counts.definitions === 1 ? "" : "s"}.`);
  if (counts.referencingBodies > 0)
    parts.push(
      `${counts.referencingBodies} other DB bod${counts.referencingBodies === 1 ? "y references" : "ies reference"} the RPC.`,
    );
  if (counts.tableRefs > 0)
    parts.push(`${counts.tableRefs} table ref${counts.tableRefs === 1 ? "" : "s"} from the body.`);
  if (counts.callers > 0)
    parts.push(`${counts.callers} app-code caller${counts.callers === 1 ? "" : "s"}.`);
  if (
    counts.definitions === 0 &&
    counts.referencingBodies === 0 &&
    counts.tableRefs === 0 &&
    counts.callers === 0
  ) {
    parts.push("No definition, reference, or caller evidence found.");
  }
  return parts.join(" ");
}

export const traceRpcTool = defineComposer({
  name: "trace_rpc",
  description:
    "Trace an RPC end-to-end: the RPC definition (searchSchemaObjects filtered to rpc), other PL/pgSQL bodies whose body text references it (searchSchemaBodies), overload-aware table refs (listFunctionTableRefs), and app-code .rpc('$FN') call sites (FTS-retrieval + ast-grep proof). Snapshot-strict.",
  inputSchema: TraceRpcToolInputSchema,
  outputSchema: TraceRpcToolOutputSchema,
  run: async (
    input: TraceRpcToolInput,
    ctx,
  ): Promise<TraceRpcToolOutput> => {
    const schemaName = input.schema?.trim();
    const rpcName = input.name;
    const argTypes = input.argTypes;
    const missingInformation: string[] = [];

    const definitions = ctx.store
      .searchSchemaObjects(rpcName, 20)
      .filter(
        (obj) =>
          obj.objectType === "rpc" &&
          obj.objectName === rpcName &&
          (schemaName == null || obj.schemaName === schemaName),
      );
    if (definitions.length === 0) {
      missingInformation.push(
        `RPC ${schemaName ? `${schemaName}.` : ""}${rpcName} is not present in the current schema snapshot.`,
      );
    }

    // Other DB bodies referencing the RPC, excluding the RPC's own body.
    const referencingBodies = ctx.store
      .searchSchemaBodies(rpcName, 20)
      .filter(
        (hit) =>
          bodyMentionsRpc(hit.bodyText, rpcName) &&
          !isTargetRpcBody(hit, rpcName, schemaName, argTypes),
      );

    const tableRefs = ctx.store.listFunctionTableRefs({
      rpcName,
      rpcSchema: schemaName,
      argTypes,
    });

    const chunkHits = ctx.store.searchCodeChunks(rpcName, { limit: 40 });
    const fileHits = ctx.store.searchFiles(rpcName, 20);
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
        { pattern: `$CLIENT.rpc('${rpcName}', $$$ARGS)`, captures: [] },
        { pattern: `$CLIENT.rpc("${rpcName}", $$$ARGS)`, captures: [] },
      ]);
      callerHits.push(...matches);
    }

    const evidence: EvidenceBlock[] = [
      ...blocksFromSchemaObjects(definitions),
      ...blocksFromSchemaBodies(referencingBodies),
      ...blocksFromFunctionTableRefs(tableRefs),
      ...blocksFromAstHits(callerHits, {
        title: (hit) => `.rpc('${rpcName}') at ${hit.filePath}:${hit.lineStart}`,
        metadataKind: "rpc_caller",
      }),
    ];

    const summary = summarize(schemaName ?? "public", rpcName, {
      definitions: definitions.length,
      referencingBodies: referencingBodies.length,
      tableRefs: tableRefs.length,
      callers: callerHits.length,
    });

    const result = makePacket(ctx, {
      queryKind: QUERY_KIND,
      queryText: formatRpcQuery(schemaName, rpcName, argTypes),
      evidence,
      summary,
      missingInformation,
    });

    return {
      toolName: "trace_rpc",
      projectId: ctx.projectId,
      result,
    };
  },
});
