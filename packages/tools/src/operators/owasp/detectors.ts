/**
 * Detector runner for owasp_audit.
 *
 * Runs the OWASP catalog against one file's source text and returns raw hits
 * (detector id + line + evidence snippet + resolved strength). result.ts turns
 * these into typed OwaspAuditFinding rows. This module is generic over the
 * catalog — it never hardcodes a category.
 */

import type { OwaspAuditFindingStrength } from "@mako-ai/contracts";
import { findAstMatches, langFromPath } from "../../code-intel/ast-patterns.js";
import { OWASP_DETECTORS, type DetectorContext, type OwaspDetector } from "./catalog.js";

export interface RawDetectorHit {
  detectorId: string;
  line: number;
  evidence: string;
  strength: OwaspAuditFindingStrength;
}

const MAX_EVIDENCE_LENGTH = 200;

export function buildDetectorContext(filePath: string, content: string): DetectorContext | null {
  const language = langFromPath(filePath);
  if (language == null) {
    return null;
  }
  return {
    filePath,
    content,
    lines: content.split(/\r?\n/),
    language,
  };
}

export function runOwaspDetectorsOnFile(
  ctx: DetectorContext,
  detectors: readonly OwaspDetector[] = OWASP_DETECTORS,
): RawDetectorHit[] {
  const hits: RawDetectorHit[] = [];
  for (const detector of detectors) {
    if (detector.languages && !detector.languages.includes(ctx.language)) {
      continue;
    }
    if (detector.fileGate && !detector.fileGate(ctx)) {
      continue;
    }
    if (detector.kind === "astgrep") {
      collectAstGrepHits(detector, ctx, hits);
    } else {
      collectRegexHits(detector, ctx, hits);
    }
  }
  return hits;
}

function collectAstGrepHits(
  detector: Extract<OwaspDetector, { kind: "astgrep" }>,
  ctx: DetectorContext,
  out: RawDetectorHit[],
): void {
  const astHits = findAstMatches(ctx.filePath, ctx.content, [...detector.patterns]);
  for (const hit of astHits) {
    if (detector.accept && !detector.accept(hit, ctx)) {
      continue;
    }
    const strength = detector.strengthen?.(hit, ctx) ?? detector.defaultStrength;
    out.push({
      detectorId: detector.id,
      line: hit.lineStart,
      evidence: capEvidence(hit.matchText),
      strength,
    });
  }
}

function collectRegexHits(
  detector: Extract<OwaspDetector, { kind: "regex" }>,
  ctx: DetectorContext,
  out: RawDetectorHit[],
): void {
  for (const pattern of detector.patterns) {
    const regex = ensureGlobal(pattern);
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(ctx.content)) != null) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      if (!detector.accept || detector.accept(match, ctx)) {
        out.push({
          detectorId: detector.id,
          line: lineForOffset(ctx.content, match.index),
          evidence: capEvidence(match[0]),
          strength: detector.defaultStrength,
        });
      }
    }
  }
}

function ensureGlobal(pattern: RegExp): RegExp {
  if (pattern.flags.includes("g")) {
    return new RegExp(pattern.source, pattern.flags);
  }
  return new RegExp(pattern.source, `${pattern.flags}g`);
}

function lineForOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10 /* \n */) {
      line += 1;
    }
  }
  return line;
}

function capEvidence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_EVIDENCE_LENGTH
    ? `${normalized.slice(0, MAX_EVIDENCE_LENGTH)}…`
    : normalized;
}
