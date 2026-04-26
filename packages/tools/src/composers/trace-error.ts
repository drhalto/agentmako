/**
 * `trace_error` — Phase 3.6.1 composer.
 *
 * Trace an error term across throw sites, catch handlers, and DB function /
 * trigger bodies.
 *
 *   - FTS (`searchCodeChunks`) retrieves candidate files that mention the term.
 *   - ast-grep then runs three structural patterns against those files:
 *       throw new Error($MSG)
 *       throw new $ERR($MSG)     (with $ERR captured; e.g. TypeError, AppError)
 *       try { $$$ } catch ($E) { $$$ }
 *     and keeps only hits whose matchText contains the term (case-insensitive).
 *   - `searchSchemaBodies(term)` surfaces PL/pgSQL function / trigger bodies
 *     whose text references the term (e.g. "USING ERRCODE '23505'" or
 *     "RAISE EXCEPTION 'duplicate'").
 */

import type {
  ComposerQueryKind,
  EvidenceBlock,
  TraceErrorToolInput,
  TraceErrorToolOutput,
} from "@mako-ai/contracts";
import {
  TraceErrorToolInputSchema,
  TraceErrorToolOutputSchema,
} from "@mako-ai/contracts";
import {
  blocksFromAstHits,
  blocksFromFileMatches,
  blocksFromFindings,
  blocksFromSchemaBodies,
} from "./_shared/blocks.js";
import { findAstMatches, langFromPath, type AstHit } from "../code-intel/ast-patterns.js";
import { defineComposer } from "./_shared/define.js";
import { makePacket } from "./_shared/packet.js";

const QUERY_KIND: ComposerQueryKind = "trace_error";
const CANDIDATE_FILE_LIMIT = 20;

function isRelevantErrorFile(filePath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|sql)$/i.test(filePath);
}

function summarize(
  term: string,
  counts: { throws: number; catches: number; bodies: number; files: number; dependents: number },
): string {
  const parts: string[] = [`Traced error '${term}'.`];
  if (counts.throws > 0) parts.push(`${counts.throws} throw site${counts.throws === 1 ? "" : "s"}.`);
  if (counts.catches > 0)
    parts.push(`${counts.catches} catch handler${counts.catches === 1 ? "" : "s"}.`);
  if (counts.bodies > 0)
    parts.push(
      `${counts.bodies} DB function/trigger bod${counts.bodies === 1 ? "y" : "ies"} reference${counts.bodies === 1 ? "s" : ""} the term.`,
    );
  if (counts.files > 0)
    parts.push(`${counts.files} file mention${counts.files === 1 ? "" : "s"}.`);
  if (counts.dependents > 0)
    parts.push(`${counts.dependents} dependent flow file${counts.dependents === 1 ? "" : "s"}.`);
  if (
    counts.throws === 0 &&
    counts.catches === 0 &&
    counts.bodies === 0 &&
    counts.files === 0 &&
    counts.dependents === 0
  ) {
    parts.push("No throw sites, catch handlers, DB body references, or file mentions found.");
  }
  return parts.join(" ");
}

export const traceErrorTool = defineComposer({
  name: "trace_error",
  description:
    "Trace an error term across throw sites (ast-grep `throw new Error($MSG)`, `throw new $ERR($MSG)`), catch handlers (ast-grep `try/catch`), and PL/pgSQL bodies that reference the term. FTS narrows the ast-grep pass. Snapshot-strict.",
  inputSchema: TraceErrorToolInputSchema,
  outputSchema: TraceErrorToolOutputSchema,
  run: async (
    input: TraceErrorToolInput,
    ctx,
  ): Promise<TraceErrorToolOutput> => {
    const term = input.term;
    const termLower = term.toLowerCase();

    // Retrieval: union FTS (symbol-level precision) and `searchFiles` (LIKE
    // fallback) so camelCase error identifiers like `UserNotFound` — which the
    // porter tokenizer leaves as one token — still surface candidate files.
    const chunkHits = ctx.store.searchCodeChunks(term, { limit: 60 });
    const fileHits = ctx.store.searchFiles(term, 20);
    const relevantFileHits = fileHits.filter((hit) => isRelevantErrorFile(hit.path));
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

    const throwHits: AstHit[] = [];
    const catchHits: AstHit[] = [];
    for (const filePath of candidateFiles) {
      const content = ctx.store.getFileContent(filePath);
      if (content == null) continue;
      // Single pattern covers both `Error` and subclasses (TypeError, AppError, …)
      // via `$ERR` capture; a separate `throw new Error(...)` pattern would
      // emit duplicates on the `Error` case.
      throwHits.push(
        ...findAstMatches(filePath, content, [
          { pattern: "throw new $ERR($MSG)", captures: ["ERR", "MSG"] },
        ]),
      );
      catchHits.push(
        ...findAstMatches(filePath, content, [
          { pattern: "try { $$$TRY } catch ($E) { $$$HANDLER }", captures: ["E"] },
        ]),
      );
    }

    const filteredThrowHits = throwHits.filter((hit) =>
      hit.matchText.toLowerCase().includes(termLower),
    );
    const filteredCatchHits = catchHits.filter((hit) =>
      hit.matchText.toLowerCase().includes(termLower),
    );

    const bodyHits = ctx.store.searchSchemaBodies(term, 10);
    const dependentFlowFiles = new Set<string>();
    for (const hit of relevantFileHits) {
      for (const dependent of ctx.store.listDependentsForFile(hit.path)) {
        if (!dependent.targetExists) continue;
        if (!isRelevantErrorFile(dependent.sourcePath)) continue;
        dependentFlowFiles.add(dependent.sourcePath);
      }
    }

    const evidence: EvidenceBlock[] = [
      ...blocksFromAstHits(filteredThrowHits, {
        title: (hit) => `throw ${hit.captures.ERR ?? "Error"} at ${hit.filePath}:${hit.lineStart}`,
        metadataKind: "throw_site",
      }),
      ...blocksFromAstHits(filteredCatchHits, {
        title: (hit) => `catch handler at ${hit.filePath}:${hit.lineStart}`,
        metadataKind: "catch_handler",
      }),
      ...blocksFromSchemaBodies(bodyHits),
      ...blocksFromFileMatches(relevantFileHits, {
        title: (hit) => `file mentions '${term}' in ${hit.path}`,
        metadataKind: "error_file_hit",
      }),
      ...blocksFromFindings(
        [...dependentFlowFiles].sort().map((filePath) => ({
          title: `dependent flow file ${filePath}`,
          detail: `Imports or consumes a file that mentions '${term}'.`,
          sourceRef: filePath,
          filePath,
        })),
      ),
    ];

    const summary = summarize(term, {
      throws: filteredThrowHits.length,
      catches: filteredCatchHits.length,
      bodies: bodyHits.length,
      files: relevantFileHits.length,
      dependents: dependentFlowFiles.size,
    });

    const result = makePacket(ctx, {
      queryKind: QUERY_KIND,
      queryText: `trace_error(${term})`,
      evidence,
      summary,
    });

    return {
      toolName: "trace_error",
      projectId: ctx.projectId,
      result,
    };
  },
});
