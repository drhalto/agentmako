/**
 * OWASP Top 10 (2025) detector catalog.
 *
 * This is the single extensible surface for owasp_audit. Each detector maps a
 * concrete, statically-detectable code shape to one OWASP 2025 category with a
 * CWE reference and a `strength` honesty signal:
 *   - `direct_evidence` — the shape is almost always the vulnerability itself
 *     (eval, md5, disabled TLS verification).
 *   - `weak_signal` — the shape is worth a human look but has legitimate uses
 *     (innerHTML assignment, Math.random near a secret, hardcoded-looking
 *     strings); these default to weak so the tool never overclaims.
 *
 * Detectors are either `astgrep` (capture-aware structural match via the shared
 * ast-patterns layer) or `regex` (for shapes ast-grep cannot express, like an
 * env flag or an empty catch block). A11 access-control via auth-guard analysis
 * is handled separately in result.ts because it reuses the git-guard analyzer.
 *
 * Adding coverage means adding an entry here only — result.ts and detectors.ts
 * are generic over this catalog.
 */

import type {
  OwaspAuditFindingStrength,
  OwaspAuditSeverity,
  OwaspCategoryId,
  OwaspCoverageStatus,
} from "@mako-ai/contracts";
import type { AstHit, AstQuery, SupportedLang } from "../../code-intel/ast-patterns.js";

const OWASP_2025_URL = "https://owasp.org/Top10/2025/";

export interface DetectorContext {
  filePath: string;
  content: string;
  lines: string[];
  language: SupportedLang;
}

interface OwaspDetectorBase {
  id: string;
  owaspCategory: OwaspCategoryId;
  severity: OwaspAuditSeverity;
  defaultStrength: OwaspAuditFindingStrength;
  cwe: string[];
  references: string[];
  message: string;
  /** Restrict to specific languages; defaults to all supported languages. */
  languages?: SupportedLang[];
  /** Cheap whole-file precondition to skip irrelevant files and cut noise. */
  fileGate?: (ctx: DetectorContext) => boolean;
}

export interface AstGrepDetector extends OwaspDetectorBase {
  kind: "astgrep";
  patterns: AstQuery[];
  /** Return false to drop a structural match (e.g. a constant-literal arg). */
  accept?: (hit: AstHit, ctx: DetectorContext) => boolean;
  /** Optionally upgrade/downgrade strength for a specific match. */
  strengthen?: (hit: AstHit, ctx: DetectorContext) => OwaspAuditFindingStrength | undefined;
}

export interface RegexDetector extends OwaspDetectorBase {
  kind: "regex";
  patterns: RegExp[];
  accept?: (match: RegExpExecArray, ctx: DetectorContext) => boolean;
}

export type OwaspDetector = AstGrepDetector | RegexDetector;

export interface OwaspCategoryMeta {
  title: string;
  ref: string;
  baseStatus: OwaspCoverageStatus;
  note: string;
}

export const OWASP_CATEGORY_META: Record<OwaspCategoryId, OwaspCategoryMeta> = {
  A01: {
    title: "Broken Access Control",
    ref: "A01:2025",
    baseStatus: "scanned",
    note: "Scanned for unprotected API routes with no detected auth guard. Run tenant_leak_audit for RLS / tenant-scoping gaps.",
  },
  A02: {
    title: "Security Misconfiguration",
    ref: "A02:2025",
    baseStatus: "scanned",
    note: "Scanned for disabled TLS certificate verification and wildcard CORS. Not a full headers/config audit.",
  },
  A03: {
    title: "Software Supply Chain Failures",
    ref: "A03:2025",
    baseStatus: "not_covered",
    note: "Requires a software-composition/vulnerability database. Review lockfiles, dependency provenance, and install scripts manually.",
  },
  A04: {
    title: "Cryptographic Failures",
    ref: "A04:2025",
    baseStatus: "scanned",
    note: "Scanned for weak hashes/ciphers, insecure randomness used for secrets, and hardcoded secret literals.",
  },
  A05: {
    title: "Injection",
    ref: "A05:2025",
    baseStatus: "scanned",
    note: "Scanned for eval/dynamic code, command execution, XSS sinks, and raw SQL string building.",
  },
  A06: {
    title: "Insecure Design",
    ref: "A06:2025",
    baseStatus: "not_covered",
    note: "Design-level risk; not statically detectable. Needs threat modeling and human review.",
  },
  A07: {
    title: "Authentication Failures",
    ref: "A07:2025",
    baseStatus: "scanned",
    note: "Scanned for unsafe JWT verification and credential comparisons against string literals.",
  },
  A08: {
    title: "Software or Data Integrity Failures",
    ref: "A08:2025",
    baseStatus: "not_covered",
    note: "Future: untrusted deserialization and dynamic require/import detection. Review update/CI integrity manually.",
  },
  A09: {
    title: "Security Logging and Alerting Failures",
    ref: "A09:2025",
    baseStatus: "not_covered",
    note: "Future: secrets-in-logs and missing auth-failure logging detection. Review logging/alerting coverage manually.",
  },
  A10: {
    title: "Mishandling of Exceptional Conditions",
    ref: "A10:2025",
    baseStatus: "scanned",
    note: "Scanned for empty/swallowed catch blocks and error/stack exposure to clients.",
  },
};

/** Detector id used for the git-guard-backed A01 path in result.ts. */
export const A01_UNPROTECTED_ROUTE_DETECTOR_ID = "a01.unprotected_route";

function isStringLiteral(text: string | undefined): boolean {
  if (!text) return false;
  const value = text.trim();
  return /^(['"]).*\1$/s.test(value) || /^`[^`]*`$/s.test(value);
}

function stripQuotes(text: string): string {
  const value = text.trim();
  if (/^(['"`]).*\1$/s.test(value)) {
    return value.slice(1, -1);
  }
  return value;
}

const SECRET_CONTEXT_RE =
  /\b(token|secret|password|passwd|nonce|otp|salt|api[_-]?key|apikey|session|csrf|verification[_-]?code|reset[_-]?code|private[_-]?key)\b/i;
const PLACEHOLDER_SECRET_RE = /(example|placeholder|changeme|change-me|your[-_]?|xxxx|<.*>|\$\{)/i;

export const OWASP_DETECTORS: readonly OwaspDetector[] = [
  // -- A05 Injection -------------------------------------------------------
  {
    id: "a05.eval",
    kind: "astgrep",
    owaspCategory: "A05",
    severity: "high",
    defaultStrength: "direct_evidence",
    cwe: ["CWE-95"],
    references: [OWASP_2025_URL],
    message: "Dynamic code execution via eval(); attacker-influenced input here is remote code execution.",
    patterns: [{ pattern: "eval($X)", captures: ["X"] }],
    accept: (hit) => !isStringLiteral(hit.captures.X),
  },
  {
    id: "a05.dynamic_function",
    kind: "astgrep",
    owaspCategory: "A05",
    severity: "medium",
    defaultStrength: "weak_signal",
    cwe: ["CWE-95"],
    references: [OWASP_2025_URL],
    message: "Dynamic code generation via new Function(...); avoid building executable code from runtime values.",
    patterns: [{ pattern: "new Function($$$ARGS)" }],
  },
  {
    id: "a05.command_injection",
    kind: "astgrep",
    owaspCategory: "A05",
    severity: "high",
    defaultStrength: "weak_signal",
    cwe: ["CWE-78"],
    references: [OWASP_2025_URL],
    message: "Shell command execution with a non-literal argument; prefer execFile/spawn with an argument array to avoid command injection.",
    fileGate: (ctx) => /child_process/.test(ctx.content),
    patterns: [
      { pattern: "exec($X)", captures: ["X"] },
      { pattern: "execSync($X)", captures: ["X"] },
      { pattern: "$M.exec($X)", captures: ["M", "X"] },
      { pattern: "$M.execSync($X)", captures: ["M", "X"] },
    ],
    accept: (hit) => !isStringLiteral(hit.captures.X),
  },
  {
    id: "a05.xss_innerhtml",
    kind: "astgrep",
    owaspCategory: "A05",
    severity: "medium",
    defaultStrength: "weak_signal",
    cwe: ["CWE-79"],
    references: [OWASP_2025_URL],
    message: "Assignment to innerHTML with a non-literal value can introduce DOM XSS; sanitize or use textContent.",
    patterns: [{ pattern: "$EL.innerHTML = $X", captures: ["EL", "X"] }],
    accept: (hit) => !isStringLiteral(hit.captures.X),
  },
  {
    id: "a05.xss_dangerously_set",
    kind: "regex",
    owaspCategory: "A05",
    severity: "medium",
    defaultStrength: "weak_signal",
    cwe: ["CWE-79"],
    references: [OWASP_2025_URL],
    message: "dangerouslySetInnerHTML renders raw HTML; ensure the value is sanitized.",
    patterns: [/dangerouslySetInnerHTML/g],
  },
  {
    id: "a05.sql_concat",
    kind: "regex",
    owaspCategory: "A05",
    severity: "high",
    defaultStrength: "weak_signal",
    cwe: ["CWE-89"],
    references: [OWASP_2025_URL],
    message: "SQL built by string interpolation/concatenation; use parameterized queries to avoid SQL injection.",
    patterns: [
      /\.(query|execute|raw)\s*\(\s*`[^`]*\$\{/g,
      /\.(query|execute|raw)\s*\(\s*['"][^'"]*['"]\s*\+/g,
    ],
  },
  // -- A04 Cryptographic Failures -----------------------------------------
  {
    id: "a04.weak_hash",
    kind: "astgrep",
    owaspCategory: "A04",
    severity: "high",
    defaultStrength: "direct_evidence",
    cwe: ["CWE-327", "CWE-328"],
    references: [OWASP_2025_URL],
    message: "Weak hash algorithm (MD5/SHA-1); use SHA-256+ or a password hash like bcrypt/argon2.",
    patterns: [
      { pattern: "createHash($ALGO)", captures: ["ALGO"] },
      { pattern: "$M.createHash($ALGO)", captures: ["M", "ALGO"] },
    ],
    accept: (hit) => {
      const algo = stripQuotes(hit.captures.ALGO ?? "").toLowerCase();
      return algo === "md5" || algo === "sha1" || algo === "sha-1";
    },
  },
  {
    id: "a04.weak_cipher",
    kind: "astgrep",
    owaspCategory: "A04",
    severity: "high",
    defaultStrength: "direct_evidence",
    cwe: ["CWE-327"],
    references: [OWASP_2025_URL],
    message: "Deprecated createCipher/createDecipher (no IV, weak key derivation); use createCipheriv with a random IV.",
    patterns: [
      { pattern: "createCipher($$$A)" },
      { pattern: "$M.createCipher($$$A)" },
      { pattern: "createDecipher($$$A)" },
      { pattern: "$M.createDecipher($$$A)" },
    ],
  },
  {
    id: "a04.insecure_random",
    kind: "astgrep",
    owaspCategory: "A04",
    severity: "medium",
    defaultStrength: "weak_signal",
    cwe: ["CWE-338"],
    references: [OWASP_2025_URL],
    message: "Math.random() is not cryptographically secure; use crypto.randomBytes/randomUUID for tokens or secrets.",
    patterns: [{ pattern: "Math.random()" }],
    accept: (hit, ctx) => {
      const idx = hit.lineStart - 1;
      const around = [ctx.lines[idx - 1], ctx.lines[idx], ctx.lines[idx + 1]]
        .filter((line): line is string => Boolean(line))
        .join(" ");
      return SECRET_CONTEXT_RE.test(around);
    },
  },
  {
    id: "a04.hardcoded_secret",
    kind: "regex",
    owaspCategory: "A04",
    severity: "high",
    defaultStrength: "weak_signal",
    cwe: ["CWE-798"],
    references: [OWASP_2025_URL],
    message: "Possible hardcoded secret/credential literal; move secrets to environment variables or a secret store.",
    patterns: [
      /\b(password|passwd|secret|api[_-]?key|apikey|access[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    ],
    accept: (match) => !PLACEHOLDER_SECRET_RE.test(match[0]),
  },
  // -- A02 Security Misconfiguration --------------------------------------
  {
    id: "a02.tls_verify_disabled",
    kind: "regex",
    owaspCategory: "A02",
    severity: "high",
    defaultStrength: "direct_evidence",
    cwe: ["CWE-295"],
    references: [OWASP_2025_URL],
    message: "TLS certificate verification disabled; this allows man-in-the-middle attacks.",
    patterns: [
      /rejectUnauthorized\s*:\s*false/g,
      /NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0/g,
    ],
  },
  {
    id: "a02.cors_wildcard",
    kind: "regex",
    owaspCategory: "A02",
    severity: "medium",
    defaultStrength: "weak_signal",
    cwe: ["CWE-942"],
    references: [OWASP_2025_URL],
    message: "Wildcard CORS origin ('*'); scope allowed origins, especially when credentials are sent.",
    patterns: [
      /origin\s*:\s*['"]\*['"]/g,
      /['"]Access-Control-Allow-Origin['"]\s*[,:]\s*['"]\*['"]/g,
    ],
  },
  // -- A07 Authentication Failures ----------------------------------------
  {
    id: "a07.jwt_alg_none",
    kind: "regex",
    owaspCategory: "A07",
    severity: "high",
    defaultStrength: "direct_evidence",
    cwe: ["CWE-347"],
    references: [OWASP_2025_URL],
    message: "JWT configured with the 'none' algorithm disables signature verification; pin a strong algorithm.",
    fileGate: (ctx) => /jwt|jsonwebtoken/i.test(ctx.content),
    patterns: [/algorithm[s]?\s*:\s*\[?\s*['"]none['"]/gi],
  },
  {
    id: "a07.hardcoded_credential",
    kind: "regex",
    owaspCategory: "A07",
    severity: "high",
    defaultStrength: "weak_signal",
    cwe: ["CWE-798"],
    references: [OWASP_2025_URL],
    message: "Credential compared against a string literal; authenticate against a stored hash, not an inline constant.",
    patterns: [
      /\b(password|passwd|token|secret|api[_-]?key|apikey)\b\s*===?\s*['"][^'"]+['"]/gi,
    ],
    accept: (match) => !PLACEHOLDER_SECRET_RE.test(match[0]),
  },
  // -- A10 Mishandling of Exceptional Conditions --------------------------
  {
    id: "a10.empty_catch",
    kind: "regex",
    owaspCategory: "A10",
    severity: "low",
    defaultStrength: "weak_signal",
    cwe: ["CWE-390"],
    references: [OWASP_2025_URL],
    message: "Empty catch block swallows errors; log or handle the exception so failures are not hidden.",
    patterns: [/catch\s*(\([^)]*\))?\s*\{\s*\}/g],
  },
  {
    id: "a10.swallowed_rejection",
    kind: "regex",
    owaspCategory: "A10",
    severity: "low",
    defaultStrength: "weak_signal",
    cwe: ["CWE-390"],
    references: [OWASP_2025_URL],
    message: "Promise rejection swallowed by an empty .catch(); handle or surface the error.",
    patterns: [/\.catch\s*\(\s*(\(\s*[a-zA-Z0-9_$]*\s*\)|[a-zA-Z0-9_$]+)\s*=>\s*\{\s*\}\s*\)/g],
  },
  {
    id: "a10.error_exposure",
    kind: "regex",
    owaspCategory: "A10",
    severity: "medium",
    defaultStrength: "weak_signal",
    cwe: ["CWE-209"],
    references: [OWASP_2025_URL],
    message: "Raw error/stack returned to the client can leak internal details; return a generic message.",
    patterns: [
      /\b(res|reply|response|ctx)\.(send|json|end)\(\s*(err|error|e)(\.(stack|message))?\s*\)/g,
    ],
  },
];

export function getDetectorById(id: string): OwaspDetector | undefined {
  return OWASP_DETECTORS.find((detector) => detector.id === id);
}
