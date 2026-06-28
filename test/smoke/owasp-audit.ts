import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { OwaspAuditToolOutputSchema } from "../../packages/contracts/src/index.ts";
import { invokeTool } from "../../packages/tools/src/registry.ts";
import { openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";

interface PlantedFile {
  path: string;
  content: string;
}

function indexedFile(file: PlantedFile) {
  const lineCount = file.content.split("\n").length;
  return {
    path: file.path,
    sha256: file.path,
    language: "typescript",
    sizeBytes: file.content.length,
    lineCount,
    chunks: [
      {
        chunkKind: "file" as const,
        name: file.path,
        lineStart: 1,
        lineEnd: lineCount,
        content: file.content,
      },
    ],
    symbols: [],
    imports: [],
    routes: file.path.includes("app/api/")
      ? [
          {
            routeKey: `GET /${file.path.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`,
            framework: "nextjs-app-router",
            pattern: `/${file.path.replace(/^app\/api\//, "api/").replace(/\/route\.ts$/, "")}`,
            method: "GET",
            handlerName: "GET",
            isApi: true,
          },
        ]
      : [],
  };
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-owasp-audit-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");

  mkdirSync(stateHome, { recursive: true });
  mkdirSync(path.join(projectRoot, "app", "api", "admin"), { recursive: true });
  mkdirSync(path.join(projectRoot, "src"), { recursive: true });

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;

  // A01: API route with no auth guard, not public-allowlisted.
  const unprotectedRoute = [
    "export async function GET() {",
    "  return Response.json({ ok: true });",
    "}",
  ].join("\n");

  // A04 (weak hash) + A05 (eval) in one module.
  const cryptoModule = [
    "import crypto from 'crypto';",
    "",
    "export function digest(input: string) {",
    "  return crypto.createHash('md5').update(input).digest('hex');",
    "}",
    "",
    "export function run(req: { body: { code: string } }) {",
    "  return eval(req.body.code);",
    "}",
  ].join("\n");

  // A02 (TLS verification disabled) + A10 (empty catch).
  const utilModule = [
    "import https from 'https';",
    "",
    "export const agent = new https.Agent({ rejectUnauthorized: false });",
    "",
    "export function safe(fn: () => void) {",
    "  try {",
    "    fn();",
    "  } catch (e) {}",
    "}",
  ].join("\n");

  const files: PlantedFile[] = [
    { path: "app/api/admin/route.ts", content: unprotectedRoute },
    { path: "src/crypto.ts", content: cryptoModule },
    { path: "src/util.ts", content: utilModule },
  ];

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "owasp-audit-smoke", version: "0.0.0" }),
  );
  for (const file of files) {
    writeFileSync(path.join(projectRoot, file.path), file.content);
  }

  const projectId = randomUUID();

  try {
    const globalStore = openGlobalStore();
    try {
      globalStore.saveProject({
        projectId,
        displayName: "owasp-audit-smoke",
        canonicalPath: projectRoot,
        lastSeenPath: projectRoot,
        supportTarget: "best_effort",
      });
    } finally {
      globalStore.close();
    }

    const store = openProjectStore({ projectRoot });
    try {
      store.saveProjectProfile({
        name: "owasp-audit-smoke",
        rootPath: projectRoot,
        framework: "nextjs",
        orm: "supabase",
        srcRoot: "src",
        entryPoints: [],
        pathAliases: {},
        middlewareFiles: [],
        serverOnlyModules: [],
        authGuardSymbols: [],
        supportLevel: "native",
        detectedAt: new Date().toISOString(),
      });

      store.replaceIndexSnapshot({
        files: files.map(indexedFile),
        schemaObjects: [],
        schemaUsages: [],
      });
    } finally {
      store.close();
    }

    // Advisory gate: missing acknowledgeAdvisory must be rejected.
    await assert.rejects(
      () => invokeTool("owasp_audit", { projectId }),
      (error: unknown) => {
        assert.equal(typeof error, "object");
        assert.equal((error as { code?: string }).code, "invalid_tool_input");
        assert.match(
          JSON.stringify((error as { details?: unknown }).details ?? {}),
          /acknowledgeAdvisory/,
        );
        return true;
      },
    );

    const output = OwaspAuditToolOutputSchema.parse(
      await invokeTool("owasp_audit", { projectId, acknowledgeAdvisory: true }),
    );

    assert.equal(output.toolName, "owasp_audit");
    assert.equal(output.result.advisoryOnly, true);
    assert.equal(output.result.rolloutStage, "opt_in");
    assert.equal(output.result.basis.scannedFileCount, files.length);

    const byDetector = new Map(output.result.findings.map((f) => [f.detectorId, f] as const));

    // A05 injection — eval with non-literal arg → direct evidence.
    const evalFinding = byDetector.get("a05.eval");
    assert.ok(evalFinding, "expected a05.eval finding");
    assert.equal(evalFinding?.owaspCategory, "A05");
    assert.equal(evalFinding?.strength, "direct_evidence");
    assert.ok((evalFinding?.cwe ?? []).includes("CWE-95"));
    assert.ok((evalFinding?.evidenceRefs.length ?? 0) > 0);

    // A04 cryptographic failure — md5 → direct evidence.
    const hashFinding = byDetector.get("a04.weak_hash");
    assert.ok(hashFinding, "expected a04.weak_hash finding");
    assert.equal(hashFinding?.owaspCategory, "A04");
    assert.equal(hashFinding?.strength, "direct_evidence");

    // A02 misconfiguration — disabled TLS verification → direct evidence.
    const tlsFinding = byDetector.get("a02.tls_verify_disabled");
    assert.ok(tlsFinding, "expected a02.tls_verify_disabled finding");
    assert.equal(tlsFinding?.owaspCategory, "A02");
    assert.equal(tlsFinding?.strength, "direct_evidence");

    // A10 exceptional conditions — empty catch → weak signal.
    const catchFinding = byDetector.get("a10.empty_catch");
    assert.ok(catchFinding, "expected a10.empty_catch finding");
    assert.equal(catchFinding?.strength, "weak_signal");

    // A01 broken access control — unprotected route via git-guard reuse.
    const routeFinding = byDetector.get("a01.unprotected_route");
    assert.ok(routeFinding, "expected a01.unprotected_route finding");
    assert.equal(routeFinding?.owaspCategory, "A01");
    assert.equal(routeFinding?.surfaceKind, "route");
    assert.equal(routeFinding?.strength, "direct_evidence");

    // Coverage section lists all 10 categories with honest gaps.
    assert.equal(output.result.coverage.length, 10);
    const coverageByCategory = new Map(
      output.result.coverage.map((entry) => [entry.owaspCategory, entry] as const),
    );
    for (const gap of ["A03", "A06", "A08", "A09"] as const) {
      assert.equal(coverageByCategory.get(gap)?.status, "not_covered", `${gap} must be not_covered`);
    }
    assert.equal(coverageByCategory.get("A05")?.status, "scanned");
    assert.ok((coverageByCategory.get("A05")?.detectorIds.length ?? 0) > 0);

    // Summary is internally consistent.
    assert.equal(
      output.result.summary.findingCount,
      output.result.findings.length,
    );
    assert.equal(
      output.result.summary.directEvidenceCount +
        output.result.summary.weakSignalCount,
      output.result.findings.length,
    );
    assert.ok(output.result.summary.directEvidenceCount >= 4);
    assert.equal(output.result.summary.notCoveredCategoryCount, 4);

    // Direct-evidence findings drive an implementation-brief follow-on.
    assert.equal(output.result.recommendedFollowOn?.family, "implementation_brief");

    // Category filter narrows the scan to one OWASP category.
    const filtered = OwaspAuditToolOutputSchema.parse(
      await invokeTool("owasp_audit", {
        projectId,
        acknowledgeAdvisory: true,
        categories: ["A05"],
      }),
    );
    assert.ok(filtered.result.findings.length > 0);
    assert.ok(
      filtered.result.findings.every((f) => f.owaspCategory === "A05"),
      "category filter must only return A05 findings",
    );
    assert.equal(coverageStatus(filtered, "A01"), "not_covered");
    assert.equal(coverageStatus(filtered, "A05"), "scanned");

    console.log(
      `owasp-audit smoke ok: ${output.result.findings.length} findings across ${output.result.summary.scannedCategoryCount} scanned categories`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function coverageStatus(
  output: ReturnType<typeof OwaspAuditToolOutputSchema.parse>,
  category: string,
): string | undefined {
  return output.result.coverage.find((entry) => entry.owaspCategory === category)?.status;
}

void main();
