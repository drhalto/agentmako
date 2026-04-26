/**
 * `trace_file` — Phase 3.6.0 tracer-bullet composer.
 *
 * Returns an `AnswerPacket`-shaped result describing a file's context:
 * its symbols, its outbound imports, its inbound dependents, its routes,
 * and any related snapshot usages. Read-only, snapshot-strict.
 *
 * This composer is the 3.6.0 tracer-bullet: it stays on the simpler end of the
 * composer surface while still exercising the shipped shared packet/factory
 * path end-to-end through CLI, HTTP, MCP, harness tool-calling, and the web UI.
 */

import type {
  ComposerQueryKind,
  EvidenceBlock,
  TraceFileToolInput,
  TraceFileToolOutput,
} from "@mako-ai/contracts";
import { TraceFileToolInputSchema, TraceFileToolOutputSchema } from "@mako-ai/contracts";
import type { FileImportLink, ProjectStore } from "@mako-ai/store";
import { resolveIndexedFilePath } from "../runtime.js";
import {
  blocksFromImports,
  blocksFromRoutes,
  blocksFromSymbols,
  blocksFromFindings,
} from "./_shared/blocks.js";
import { defineComposer } from "./_shared/define.js";
import { makePacket } from "./_shared/packet.js";

const QUERY_KIND: ComposerQueryKind = "trace_file";
const FILE_GRAPH_DEPTH = 2;

function uniqueInternalEdges(edges: FileImportLink[]): FileImportLink[] {
  const seen = new Set<string>();
  const out: FileImportLink[] = [];
  for (const edge of edges) {
    if (!edge.targetExists) continue;
    const key = `${edge.sourcePath}->${edge.targetPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

function collectFileNeighborhood(
  store: ProjectStore,
  rootFilePath: string,
  maxDepth: number,
): Array<{ filePath: string; depth: number; via: string }> {
  const visited = new Set<string>([rootFilePath]);
  const queue: Array<{ filePath: string; depth: number }> = [{ filePath: rootFilePath, depth: 0 }];
  const related: Array<{ filePath: string; depth: number; via: string }> = [];

  while (queue.length > 0) {
    const current = queue.shift() as { filePath: string; depth: number };
    if (current.depth >= maxDepth) continue;

    const nextEdges = [
      ...uniqueInternalEdges(store.listImportsForFile(current.filePath)).map((edge) => ({
        filePath: edge.targetPath,
        via: `imports ${edge.targetPath}`,
      })),
      ...uniqueInternalEdges(store.listDependentsForFile(current.filePath)).map((edge) => ({
        filePath: edge.sourcePath,
        via: `imported by ${edge.sourcePath}`,
      })),
    ];

    for (const next of nextEdges) {
      if (visited.has(next.filePath)) continue;
      visited.add(next.filePath);
      const depth = current.depth + 1;
      related.push({ filePath: next.filePath, depth, via: next.via });
      queue.push({ filePath: next.filePath, depth });
    }
  }

  related.sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }
    return left.filePath.localeCompare(right.filePath);
  });
  return related;
}

function summarize(
  file: string,
  outbound: number,
  inbound: number,
  symbols: number,
  routes: number,
  related: number,
): string {
  const parts: string[] = [`Traced ${file}.`];
  if (symbols > 0) parts.push(`${symbols} symbol${symbols === 1 ? "" : "s"} declared.`);
  if (outbound > 0) parts.push(`Imports ${outbound} module${outbound === 1 ? "" : "s"}.`);
  if (inbound > 0)
    parts.push(`Imported by ${inbound} file${inbound === 1 ? "" : "s"}.`);
  if (routes > 0) parts.push(`Contributes ${routes} route${routes === 1 ? "" : "s"}.`);
  if (related > 0)
    parts.push(`${related} related file${related === 1 ? "" : "s"} within ${FILE_GRAPH_DEPTH} graph hops.`);
  if (symbols === 0 && outbound === 0 && inbound === 0 && routes === 0 && related === 0) {
    parts.push("No symbols, imports, dependents, or routes found in the snapshot.");
  }
  return parts.join(" ");
}

export const traceFileTool = defineComposer({
  name: "trace_file",
  description:
    "Trace a file end-to-end from the snapshot: declared symbols, outbound imports, inbound dependents, routes contributed, and related evidence. Read-only.",
  inputSchema: TraceFileToolInputSchema,
  outputSchema: TraceFileToolOutputSchema,
  run: async (input: TraceFileToolInput, ctx): Promise<TraceFileToolOutput> => {
    const missingInformation: string[] = [];
    let resolvedFilePath: string | null = null;
    try {
      resolvedFilePath = resolveIndexedFilePath(ctx.canonicalPath, ctx.store, input.file);
    } catch {
      missingInformation.push(`File ${input.file} is not indexed in the current snapshot.`);
    }

    const evidence: EvidenceBlock[] = [];
    let outboundCount = 0;
    let inboundCount = 0;
    let symbolCount = 0;
    let routeCount = 0;
    let relatedCount = 0;

    if (resolvedFilePath != null) {
      const outbound = ctx.store.listImportsForFile(resolvedFilePath);
      const inbound = ctx.store.listDependentsForFile(resolvedFilePath);
      const symbols = ctx.store.listSymbolsForFile(resolvedFilePath);
      const routes = ctx.store.listRoutesForFile(resolvedFilePath);
      const relatedFiles = collectFileNeighborhood(
        ctx.store,
        resolvedFilePath,
        FILE_GRAPH_DEPTH,
      );

      outboundCount = outbound.length;
      inboundCount = inbound.length;
      symbolCount = symbols.length;
      routeCount = routes.length;
      relatedCount = relatedFiles.length;

      evidence.push(
        ...blocksFromSymbols(symbols, resolvedFilePath),
        ...blocksFromImports(outbound, "outbound"),
        ...blocksFromImports(inbound, "inbound"),
        ...blocksFromRoutes(routes),
        ...blocksFromFindings(
          relatedFiles.map((related) => ({
            title: `related file (${related.depth} hop${related.depth === 1 ? "" : "s"})`,
            detail: related.via,
            sourceRef: related.filePath,
            filePath: related.filePath,
          })),
        ),
      );

      if (
        symbolCount === 0 &&
        outboundCount === 0 &&
        inboundCount === 0 &&
        routeCount === 0 &&
        relatedCount === 0
      ) {
        // File is indexed but has no structural evidence — surface as a finding
        // so consumers see "we looked, there is nothing here" rather than an
        // empty packet. The `fallback_evidence` metadata flag lets the trust
        // compare layer recognize this block without string-matching the title.
        evidence.push(
          ...blocksFromFindings([
            {
              title: "No structural evidence",
              detail: `The file ${resolvedFilePath} is indexed but has no symbols, imports, dependents, or routes.`,
              sourceRef: resolvedFilePath,
              filePath: resolvedFilePath,
              metadata: { kind: "fallback_evidence" },
            },
          ]),
        );
      }
    }

    const summary = summarize(
      resolvedFilePath ?? input.file,
      outboundCount,
      inboundCount,
      symbolCount,
      routeCount,
      relatedCount,
    );

    const result = makePacket(ctx, {
      queryKind: QUERY_KIND,
      queryText: `trace_file(${resolvedFilePath ?? input.file})`,
      evidence,
      summary,
      missingInformation,
    });

    return {
      toolName: "trace_file",
      projectId: ctx.projectId,
      result,
    };
  },
});
