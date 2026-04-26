import { hashJson } from "@mako-ai/store";

/**
 * Fingerprint for an `ast_find_pattern` match. Location-aware by design:
 * identical snippets in the same file still get distinct fingerprints via
 * line/column coordinates.
 *
 * `matchText` is NFC-normalized with no trimming or whitespace collapse —
 * future callers must normalize identically or break existing acks.
 * Hashing uses `hashJson` for consistency with diagnostic identity in
 * `packages/tools/src/diagnostics/common.ts`.
 */
export interface AstMatchFingerprintInput {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
  matchText: string;
}

export function computeAstMatchFingerprint(
  input: AstMatchFingerprintInput,
): string {
  return hashJson({
    tool: "ast_find_pattern",
    filePath: input.filePath,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    columnStart: input.columnStart,
    columnEnd: input.columnEnd,
    matchText: input.matchText.normalize("NFC"),
    version: 1,
  });
}
