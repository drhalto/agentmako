import type {
  AstFindPatternLanguage,
  AstFindPatternMatch,
  AstFindPatternToolInput,
  AstFindPatternToolOutput,
  ReefQueryFreshness,
} from "@mako-ai/contracts";
import { computeAstMatchFingerprint } from "../finding-acks/fingerprint.js";
import { assessReefFileEvidence, assessReefLiveLineCount } from "../index-freshness/index.js";
import { isReefBackedToolViewEnabled } from "../reef/migration-flags.js";
import { buildReefToolExecution } from "../reef/tool-execution.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { findAstMatches, langFromPath, type SupportedLang } from "./ast-patterns.js";
import { matchesPathGlob } from "./path-globs.js";

/**
 * `ast_find_pattern` — read-only structural pattern search over indexed
 * project files. See `tool-ast-schemas.ts` for contract-level semantics.
 *
 * Implementation notes:
 * - Iterates `projectStore.listFiles()` so we only scan the indexed
 *   snapshot (no live filesystem walks).
 * - Per file: resolves language by extension, skips non-supported files
 *   and files outside the requested `languages` filter.
 * - `findAstMatches` catches parse errors internally; unparseable files
 *   contribute zero matches and do not throw.
 * - Limits: `maxMatches` caps the total match count; `maxFiles` caps the
 *   number of files scanned. When a cap trips, `truncated` is true and a
 *   warning explains which cap hit first.
 */

const DEFAULT_MAX_MATCHES = 500;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_LANGUAGES: readonly AstFindPatternLanguage[] = ["ts", "tsx", "js", "jsx"];

export async function astFindPatternTool(
  input: AstFindPatternToolInput,
  options: ToolServiceOptions = {},
): Promise<AstFindPatternToolOutput> {
  return withProjectContext(input, options, async ({ project, projectStore }) => {
    const startedAtMs = Date.now();
    const reefBacked = isReefBackedToolViewEnabled("ast_find_pattern");
    const warnings: string[] = [];
    const maxMatches = input.maxMatches ?? DEFAULT_MAX_MATCHES;
    const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
    const languagesApplied = input.languages ?? [...DEFAULT_LANGUAGES];
    const languageFilter = new Set<AstFindPatternLanguage>(languagesApplied);
    const glob = input.pathGlob;

    // Load the ack fingerprint Set once per call, not once per match.
    // Empty Set when no category is opted into — keeps the filter branch
    // uniform without requiring a conditional lookup in the hot path.
    const excludeCategory = input.excludeAcknowledgedCategory;
    const ackedFingerprints = excludeCategory
      ? projectStore.loadAcknowledgedFingerprints(project.projectId, excludeCategory)
      : new Set<string>();

    const matches: AstFindPatternMatch[] = [];
    let acknowledgedCount = 0;
    let filesScanned = 0;
    let patternInvalidReported = false;
    let truncatedByMaxMatches = false;
    let truncatedByMaxFiles = false;
    let impossibleLineRangeCount = 0;
    let nonFreshFileSkippedCount = 0;
    let nonFreshLineEvidenceDroppedCount = 0;
    let staleEvidenceDropped = 0;
    let filesMatchedFilters = 0;
    const checkedAt = new Date().toISOString();

    const allFiles = projectStore.listFiles();
    for (const file of allFiles) {
      if (filesScanned >= maxFiles) {
        truncatedByMaxFiles = true;
        break;
      }
      const lang = langFromPath(file.path);
      if (lang == null) continue;
      if (!languageFilter.has(lang as AstFindPatternLanguage)) continue;
      if (glob && !matchesPathGlob(file.path, glob)) continue;
      filesMatchedFilters += 1;

      if (reefBacked) {
        const decision = assessReefFileEvidence({
          projectRoot: project.canonicalPath,
          filePath: file.path,
          indexedAt: file.indexedAt,
          indexedMtime: file.lastModifiedAt,
          indexedSizeBytes: file.sizeBytes,
          freshnessPolicy: "require_fresh",
        });
        if (decision.action !== "return") {
          nonFreshFileSkippedCount += 1;
          staleEvidenceDropped += 1;
          continue;
        }
      }

      const content = projectStore.getFileContent(file.path);
      if (content == null) continue;

      filesScanned += 1;

      const hits = findAstMatches(file.path, content, [
        {
          pattern: input.pattern,
          ...(input.captures ? { captures: input.captures } : {}),
        },
      ]);
      if (hits.length === 0) {
        continue;
      }

      let liveLineCount: number | undefined;
      if (reefBacked) {
        const lineCountDecision = assessReefLiveLineCount({
          projectRoot: project.canonicalPath,
          filePath: file.path,
          indexedAt: file.indexedAt,
          indexedMtime: file.lastModifiedAt,
          indexedSizeBytes: file.sizeBytes,
          freshnessPolicy: "require_fresh",
        });
        if (lineCountDecision.action !== "return") {
          nonFreshLineEvidenceDroppedCount += hits.length;
          staleEvidenceDropped += hits.length;
          continue;
        }
        liveLineCount = lineCountDecision.lineCount ?? 0;
      }

      for (const hit of hits) {
        if (reefBacked && liveLineCount != null && (hit.lineStart > liveLineCount || hit.lineEnd > liveLineCount)) {
          staleEvidenceDropped += 1;
          impossibleLineRangeCount += 1;
          continue;
        } else if (!reefBacked && file.lineCount > 0 && (hit.lineStart > file.lineCount || hit.lineEnd > file.lineCount)) {
          impossibleLineRangeCount += 1;
          continue;
        }

        const ackableFingerprint = computeAstMatchFingerprint({
          filePath: hit.filePath,
          lineStart: hit.lineStart,
          lineEnd: hit.lineEnd,
          columnStart: hit.columnStart,
          columnEnd: hit.columnEnd,
          matchText: hit.matchText,
        });

        if (excludeCategory && ackedFingerprints.has(ackableFingerprint)) {
          acknowledgedCount += 1;
          continue;
        }

        if (matches.length >= maxMatches) {
          truncatedByMaxMatches = true;
          break;
        }
        matches.push({
          filePath: hit.filePath,
          language: lang as AstFindPatternLanguage,
          lineStart: hit.lineStart,
          lineEnd: hit.lineEnd,
          columnStart: hit.columnStart,
          columnEnd: hit.columnEnd,
          matchText: hit.matchText,
          captures: hit.captures,
          ackableFingerprint,
        });
      }
      if (truncatedByMaxMatches) break;
    }

    if (truncatedByMaxMatches) {
      warnings.push(`truncated: matches capped at ${maxMatches}. Raise maxMatches or narrow pathGlob / languages.`);
    }
    if (truncatedByMaxFiles) {
      warnings.push(`truncated: files scanned capped at ${maxFiles}. Raise maxFiles or narrow pathGlob / languages.`);
    }
    if (impossibleLineRangeCount > 0) {
      warnings.push(
        `filtered ${impossibleLineRangeCount} match(es) whose line range exceeded live file metadata; refresh the project index if this persists.`,
      );
    }
    if (nonFreshFileSkippedCount > 0) {
      warnings.push(
        `skipped ${nonFreshFileSkippedCount} non-fresh indexed file(s) via Reef freshness guard; refresh the project index or use live_text_search for live verification.`,
      );
    }
    if (nonFreshLineEvidenceDroppedCount > 0) {
      warnings.push(
        `filtered ${nonFreshLineEvidenceDroppedCount} match(es) whose backing file changed during live line validation.`,
      );
    }
    if (filesScanned === 0 && filesMatchedFilters === 0 && allFiles.length > 0) {
      warnings.push("no indexed files matched the language/glob filters.");
    } else if (filesScanned === 0 && nonFreshFileSkippedCount > 0) {
      warnings.push("all indexed files matching the language/glob filters were skipped by the Reef freshness guard.");
    }
    // Best-effort pattern-validity hint: if we scanned files with real
    // content but got zero hits, it's often a pattern typo. We can't tell
    // "invalid pattern" from "legitimately no matches" without a parsed
    // query object, so we surface it as a hint rather than an error.
    if (!patternInvalidReported && filesScanned > 0 && matches.length === 0) {
      warnings.push(
        "zero matches across scanned files — verify ast-grep pattern syntax (metavariables start with `$`).",
      );
    }

    const reefFreshness: ReefQueryFreshness = {
      ...(options.requestContext?.requestId ? { requestId: options.requestContext.requestId } : {}),
      projectId: project.projectId,
      root: project.canonicalPath,
      reefMode: reefBacked ? "in_process" : "legacy",
      freshnessPolicy: "require_fresh",
      state: reefBacked ? (staleEvidenceDropped > 0 ? "dirty" : "fresh") : "unknown",
      staleEvidenceDropped,
      fallbackUsed: false,
      snapshotPinned: false,
      queryRestarted: false,
      queryCanceled: false,
      checkedAt,
    };
    const reefExecution = await buildReefToolExecution({
      toolName: "ast_find_pattern",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      options,
      startedAtMs,
      freshnessPolicy: "require_fresh",
      queryPath: reefBacked ? "reef_query" : "legacy",
      staleEvidenceDropped,
      staleEvidenceLabeled: 0,
      returnedCount: matches.length,
    });

    return {
      toolName: "ast_find_pattern",
      projectId: project.projectId,
      pattern: input.pattern,
      languagesApplied,
      filesScanned,
      matches,
      acknowledgedCount,
      reefFreshness,
      reefExecution,
      truncated: truncatedByMaxMatches || truncatedByMaxFiles,
      warnings,
    } satisfies AstFindPatternToolOutput;
  });
}

export { type SupportedLang };
