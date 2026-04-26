/**
 * `trace_edge` — Phase 3.6.1 composer.
 *
 * Trace a handler / edge function end-to-end:
 *   - the route metadata for the handler itself (via `searchRoutes`)
 *   - app-code callers invoking the edge by name, confirmed with ast-grep
 *     (`fetch('/functions/v1/$NAME')`, `supabase.functions.invoke('$NAME')`)
 *   - tables and RPCs the handler's own file touches, via ast-grep
 *     (`$C.from('$TABLE')`, `$C.rpc('$FN')`)
 *   - DB triggers whose body references the edge name, via `searchSchemaBodies`
 *
 * FTS narrows candidate files; ast-grep proves the structural match.
 * `listFunctionTableRefs` is intentionally NOT used here — that edge table
 * is keyed by PL/pgSQL RPC identity, and edge functions are app code.
 */

import type {
  ComposerQueryKind,
  EvidenceBlock,
  TraceEdgeToolInput,
  TraceEdgeToolOutput,
} from "@mako-ai/contracts";
import {
  TraceEdgeToolInputSchema,
  TraceEdgeToolOutputSchema,
} from "@mako-ai/contracts";
import {
  blocksFromAstHits,
  blocksFromFileMatches,
  blocksFromRoutes,
  blocksFromSchemaBodies,
} from "./_shared/blocks.js";
import { findAstMatches, langFromPath, type AstHit } from "../code-intel/ast-patterns.js";
import { defineComposer } from "./_shared/define.js";
import { makePacket } from "./_shared/packet.js";

const QUERY_KIND: ComposerQueryKind = "trace_edge";
const CANDIDATE_FILE_LIMIT = 12;

function isRelevantEdgeFile(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i.test(filePath);
}

function bodyReferencesEdge(bodyText: string, name: string): boolean {
  const normalizedName = name.trim().toLowerCase();
  if (normalizedName === "") return false;
  const normalizedBody = bodyText.toLowerCase();
  const executeIndex = normalizedBody.search(/\bexecute\s+(function|procedure)\b/);
  const relevantText =
    executeIndex >= 0 ? normalizedBody.slice(executeIndex) : normalizedBody;
  return relevantText.includes(normalizedName);
}

function uniqueFilePaths(
  filePaths: readonly string[],
  limit: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const filePath of filePaths) {
    if (seen.has(filePath)) continue;
    if (langFromPath(filePath) == null) continue;
    seen.add(filePath);
    out.push(filePath);
    if (out.length >= limit) break;
  }
  return out;
}

function summarize(
  name: string,
  counts: { routes: number; callers: number; touches: number; triggers: number; files: number },
): string {
  const parts: string[] = [`Traced edge '${name}'.`];
  if (counts.routes > 0) parts.push(`${counts.routes} route entr${counts.routes === 1 ? "y" : "ies"}.`);
  if (counts.callers > 0)
    parts.push(`${counts.callers} app-code caller${counts.callers === 1 ? "" : "s"}.`);
  if (counts.touches > 0)
    parts.push(`${counts.touches} table/RPC touch${counts.touches === 1 ? "" : "es"} in the handler.`);
  if (counts.triggers > 0)
    parts.push(`${counts.triggers} DB trigger body reference${counts.triggers === 1 ? "" : "s"}.`);
  if (counts.files > 0)
    parts.push(`${counts.files} related file mention${counts.files === 1 ? "" : "s"}.`);
  if (
    counts.routes === 0 &&
    counts.callers === 0 &&
    counts.touches === 0 &&
    counts.triggers === 0 &&
    counts.files === 0
  ) {
    parts.push("No routes, callers, handler touches, DB trigger references, or related files found.");
  }
  return parts.join(" ");
}

export const traceEdgeTool = defineComposer({
  name: "trace_edge",
  description:
    "Trace a handler / edge function: its own route, app-code callers (ast-grep on fetch('/functions/v1/$NAME') and supabase.functions.invoke('$NAME')), tables and RPCs the handler touches, and DB triggers whose body references the name. Snapshot-strict.",
  inputSchema: TraceEdgeToolInputSchema,
  outputSchema: TraceEdgeToolOutputSchema,
  run: async (
    input: TraceEdgeToolInput,
    ctx,
  ): Promise<TraceEdgeToolOutput> => {
    const name = input.name;
    const missingInformation: string[] = [];

    const routeHits = ctx.store.searchRoutes(name, 10);
    const relatedFiles = ctx.store
      .searchFiles(name, 20)
      .filter((hit) => isRelevantEdgeFile(hit.path));
    const handlerFilePaths = uniqueFilePaths(
      [
        ...routeHits.map((route) => route.filePath),
        ...relatedFiles
          .map((hit) => hit.path)
          .filter((filePath) => filePath.includes(`/functions/${name}/`)),
      ],
      CANDIDATE_FILE_LIMIT,
    );
    if (handlerFilePaths.length === 0) {
      missingInformation.push(
        `No indexed route or handler file matches '${name}'; handler-scoped ast-grep pass skipped.`,
      );
    }

    // FTS retrieval of candidate caller files: anywhere that mentions the name.
    const chunkHits = ctx.store.searchCodeChunks(name, { limit: 40 });
    const callerCandidatePaths = uniqueFilePaths(
      chunkHits
        .map((hit) => hit.filePath)
        // Skip handler files from the caller scan — those aren't callers.
        .filter((filePath) => !handlerFilePaths.includes(filePath)),
      CANDIDATE_FILE_LIMIT,
    );

    const callerHits: AstHit[] = [];
    for (const filePath of callerCandidatePaths) {
      const content = ctx.store.getFileContent(filePath);
      if (content == null) continue;
      const matches = findAstMatches(filePath, content, [
        { pattern: `fetch('/functions/v1/${name}')`, captures: [] },
        { pattern: `fetch("/functions/v1/${name}")`, captures: [] },
        { pattern: `$CLIENT.functions.invoke('${name}', $$$ARGS)`, captures: [] },
        { pattern: `$CLIENT.functions.invoke("${name}", $$$ARGS)`, captures: [] },
      ]);
      callerHits.push(...matches);
    }

    const handlerTouchHits: AstHit[] = [];
    for (const filePath of handlerFilePaths) {
      const content = ctx.store.getFileContent(filePath);
      if (content == null) continue;
      const matches = findAstMatches(filePath, content, [
        { pattern: "$CLIENT.from('$TABLE')", captures: ["TABLE"] },
        { pattern: "$CLIENT.from(\"$TABLE\")", captures: ["TABLE"] },
        { pattern: "$CLIENT.rpc('$FN', $$$ARGS)", captures: ["FN"] },
        { pattern: "$CLIENT.rpc(\"$FN\", $$$ARGS)", captures: ["FN"] },
      ]);
      handlerTouchHits.push(...matches);
    }

    const triggerBodies = ctx.store
      .searchSchemaBodies(name, 20)
      .filter(
        (hit) =>
          hit.objectType === "trigger" && bodyReferencesEdge(hit.bodyText, name),
      );

    const evidence: EvidenceBlock[] = [
      ...blocksFromRoutes(routeHits),
      ...blocksFromAstHits(callerHits, {
        title: (hit) => `invokes '${name}' at ${hit.filePath}:${hit.lineStart}`,
        metadataKind: "edge_caller",
      }),
      ...blocksFromAstHits(handlerTouchHits, {
        title: (hit) => {
          const captured = hit.captures.TABLE ?? hit.captures.FN;
          const kind = hit.matchText.includes(".from(") ? "table" : "rpc";
          return captured
            ? `handler touches ${kind} ${captured}`
            : `handler ${kind} call at ${hit.filePath}:${hit.lineStart}`;
        },
        metadataKind: "edge_handler_touch",
      }),
      ...blocksFromSchemaBodies(triggerBodies),
      ...blocksFromFileMatches(relatedFiles, {
        title: (hit) => `related file ${hit.path}`,
        metadataKind: "edge_related_file",
      }),
    ];

    const summary = summarize(name, {
      routes: routeHits.length,
      callers: callerHits.length,
      touches: handlerTouchHits.length,
      triggers: triggerBodies.length,
      files: relatedFiles.length,
    });

    const result = makePacket(ctx, {
      queryKind: QUERY_KIND,
      queryText: `trace_edge(${name})`,
      evidence,
      summary,
      missingInformation,
    });

    return {
      toolName: "trace_edge",
      projectId: ctx.projectId,
      result,
    };
  },
});
