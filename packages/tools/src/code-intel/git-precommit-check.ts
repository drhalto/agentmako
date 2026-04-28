import { existsSync, readFileSync } from "node:fs";
import { basename, extname, isAbsolute, posix as pathPosix, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  GitPrecommitCheckToolInput,
  GitPrecommitCheckToolOutput,
  GitPrecommitFinding,
  GitPrecommitStagedChange,
  ProjectProfile,
  ProjectFinding,
  ReefRuleDescriptor,
} from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import { z } from "zod";
import * as ts from "typescript";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { isReefBackedToolViewEnabled } from "../reef/migration-flags.js";
import { matchesPathGlob, normalizePathForGlob } from "./path-globs.js";

const DEFAULT_INCLUDE_EXTENSIONS = [".ts", ".tsx"] as const;
const DEFAULT_AUTH_GUARDS = ["auth.getUser", "withAuth"] as const;
const SERVER_ONLY_IMPORTS = new Set(["next/headers", "next/cache", "server-only"]);
const SERVER_ONLY_CALLS = new Set(["unstable_cache", "revalidatePath", "revalidateTag", "cookies", "headers"]);
const CLIENT_HOOK_CALLS = new Set(["useState", "useEffect", "useRef"]);
const GIT_PRECOMMIT_SOURCE = "git_precommit_check";

const GIT_PRECOMMIT_RULES: ReefRuleDescriptor[] = [
  {
    id: "git.unprotected_route",
    version: "1.0.0",
    source: GIT_PRECOMMIT_SOURCE,
    sourceNamespace: "git_precommit_check",
    type: "problem",
    severity: "error",
    title: "Unprotected route",
    description: "A staged API route has no detected auth guard and is not allowlisted as public.",
    factKinds: ["git_precommit_check"],
    enabledByDefault: true,
  },
  {
    id: "git.client_uses_server_only",
    version: "1.0.0",
    source: GIT_PRECOMMIT_SOURCE,
    sourceNamespace: "git_precommit_check",
    type: "problem",
    severity: "error",
    title: "Client imports server-only code",
    description: "A staged client component imports or calls server-only APIs.",
    factKinds: ["git_precommit_check"],
    enabledByDefault: true,
  },
  {
    id: "git.server_uses_client_hook",
    version: "1.0.0",
    source: GIT_PRECOMMIT_SOURCE,
    sourceNamespace: "git_precommit_check",
    type: "problem",
    severity: "warning",
    title: "Server file uses client hook",
    description: "A staged file calls a React client hook without a top-level use client directive.",
    factKinds: ["git_precommit_check"],
    enabledByDefault: true,
  },
];

const GitGuardConfigSchema = z.object({
  publicRouteGlobs: z.array(z.string().trim().min(1)).default([]),
  authGuardSymbols: z.array(z.string().trim().min(1)).default([]),
  serverOnlyModules: z.array(z.string().trim().min(1)).default([]),
}).partial();

interface GitGuardConfig {
  publicRouteGlobs: string[];
  authGuardSymbols: string[];
  serverOnlyModules: string[];
  configSources: string[];
  warnings: string[];
}

interface StagedFile {
  projectPath: string;
  gitPath: string;
  content: string;
}

export interface GitGuardSourceFile {
  projectPath: string;
  content: string;
}

export interface GitGuardAnalysisResult {
  checkedFiles: string[];
  skippedFiles: string[];
  findings: GitPrecommitFinding[];
  warnings: string[];
  policy: GitPrecommitCheckToolOutput["policy"];
}

interface RawStagedChange {
  status: GitPrecommitStagedChange["status"];
  gitPath: string;
  oldGitPath?: string;
}

interface CallRecord {
  name: string;
  line: number;
}

interface ImportRecord {
  specifier: string;
  line: number;
}

function slashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function git(args: readonly string[], cwd: string, options: { allowFailure?: boolean; encoding?: BufferEncoding } = {}): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: options.encoding ?? "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout ?? "";
}

function loadGitGuardConfig(projectRoot: string): GitGuardConfig {
  const configPath = resolve(projectRoot, ".mako", "git-guard.json");
  if (!existsSync(configPath)) {
    return {
      publicRouteGlobs: [],
      authGuardSymbols: [],
      serverOnlyModules: [],
      configSources: [],
      warnings: [],
    };
  }

  try {
    const parsed = GitGuardConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));
    return {
      publicRouteGlobs: parsed.publicRouteGlobs ?? [],
      authGuardSymbols: parsed.authGuardSymbols ?? [],
      serverOnlyModules: parsed.serverOnlyModules ?? [],
      configSources: [".mako/git-guard.json"],
      warnings: [],
    };
  } catch (error) {
    return {
      publicRouteGlobs: [],
      authGuardSymbols: [],
      serverOnlyModules: [],
      configSources: [],
      warnings: [`ignored invalid .mako/git-guard.json: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function stagedChanges(gitRoot: string): RawStagedChange[] {
  const output = git(["diff", "--cached", "--name-status", "--find-renames", "--diff-filter=ACMRD", "-z"], gitRoot);
  const parts = output.split("\0").filter(Boolean);
  const changes: RawStagedChange[] = [];
  for (let index = 0; index < parts.length;) {
    const rawStatus = parts[index++] ?? "";
    const status = stagedChangeStatus(rawStatus);
    if (!status) {
      continue;
    }
    if (status === "renamed" || status === "copied") {
      const oldGitPath = parts[index++];
      const gitPath = parts[index++];
      if (oldGitPath && gitPath) {
        changes.push({ status, oldGitPath: slashPath(oldGitPath), gitPath: slashPath(gitPath) });
      }
      continue;
    }
    const gitPath = parts[index++];
    if (gitPath) {
      changes.push({ status, gitPath: slashPath(gitPath) });
    }
  }
  return changes;
}

function stagedChangeStatus(rawStatus: string): RawStagedChange["status"] | null {
  switch (rawStatus[0]) {
    case "A":
      return "added";
    case "C":
      return "copied";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    case "D":
      return "deleted";
    default:
      return null;
  }
}

function readStagedFile(gitRoot: string, gitPath: string): string {
  return git(["show", `:${gitPath}`], gitRoot);
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function hasDirective(sourceFile: ts.SourceFile, directive: string): boolean {
  for (const statement of sourceFile.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      if (statement.expression.text === directive) {
        return true;
      }
      continue;
    }
    return false;
  }
  return false;
}

function expressionName(sourceFile: ts.SourceFile, expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const left = expressionName(sourceFile, expression.expression);
    return left ? `${left}.${expression.name.text}` : expression.getText(sourceFile);
  }
  return null;
}

function collectCalls(sourceFile: ts.SourceFile): CallRecord[] {
  const calls: CallRecord[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = expressionName(sourceFile, node.expression);
      if (name) {
        calls.push({ name, line: lineOf(sourceFile, node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function collectImports(sourceFile: ts.SourceFile): ImportRecord[] {
  const imports: ImportRecord[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        line: lineOf(sourceFile, statement),
      });
    }
  }
  return imports;
}

function isApiRoutePath(projectPath: string): boolean {
  const normalized = normalizePathForGlob(projectPath);
  const name = basename(normalized).toLowerCase();
  return (
    normalized.startsWith("app/api/") &&
    (name === "route.ts" || name === "route.tsx")
  ) || (
    normalized.startsWith("pages/api/") &&
    (name.endsWith(".ts") || name.endsWith(".tsx"))
  );
}

function isPublicRoute(projectPath: string, publicRouteGlobs: readonly string[]): boolean {
  return publicRouteGlobs.some((glob) => matchesPathGlob(projectPath, glob));
}

function isAuthGuardCall(callName: string, guards: Set<string>): boolean {
  if (guards.has(callName)) {
    return true;
  }
  const lastSegment = callName.split(".").at(-1) ?? callName;
  if (guards.has(lastSegment)) {
    return true;
  }
  return callName === "auth.getUser" || callName.endsWith(".auth.getUser");
}

function resolveImportPath(
  projectRoot: string,
  importerPath: string,
  specifier: string,
  knownFiles: Set<string>,
  pathAliases: Record<string, string>,
): string | null {
  if (!specifier.startsWith(".") && !Object.keys(pathAliases).some((alias) => specifier.startsWith(alias))) {
    return null;
  }

  let base: string | null = null;
  if (specifier.startsWith(".")) {
    base = pathPosix.normalize(pathPosix.join(pathPosix.dirname(normalizePathForGlob(importerPath)), specifier));
  } else {
    const alias = Object.keys(pathAliases)
      .sort((left, right) => right.length - left.length)
      .find((candidate) => specifier.startsWith(candidate));
    if (!alias) return null;
    const rawAliasRoot = pathAliases[alias] ?? "";
    const aliasRoot = isAbsolute(rawAliasRoot)
      ? normalizePathForGlob(relative(projectRoot, rawAliasRoot))
      : normalizePathForGlob(rawAliasRoot).replace(/^\.\//, "");
    const suffix = specifier.slice(alias.length);
    base = pathPosix.normalize(pathPosix.join(aliasRoot, suffix));
  }

  const normalizedBase = normalizePathForGlob(base);
  const candidates = [
    normalizedBase,
    `${normalizedBase}.ts`,
    `${normalizedBase}.tsx`,
    `${normalizedBase}.js`,
    `${normalizedBase}.jsx`,
    `${normalizedBase}/index.ts`,
    `${normalizedBase}/index.tsx`,
    `${normalizedBase}/index.js`,
    `${normalizedBase}/index.jsx`,
  ].map((candidate) => normalizePathForGlob(candidate));
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

function codeLine(finding: GitPrecommitFinding): string {
  const loc = typeof finding.line === "number" ? `${finding.path}:${finding.line}` : finding.path;
  if (finding.code === "git.unprotected_route") {
    return `UNPROTECTED: ${loc} -- ${finding.message}`;
  }
  return `BOUNDARY: ${loc} -- ${finding.message}`;
}

function buildStopReason(findings: readonly GitPrecommitFinding[]): string | undefined {
  if (findings.length === 0) {
    return undefined;
  }
  return `Pre-commit check failed:\n${findings.map(codeLine).join("\n")}`;
}

function reefSeverity(finding: GitPrecommitFinding): ProjectFinding["severity"] {
  return finding.severity === "critical" ? "error" : "warning";
}

function reefSubjectForFinding(finding: GitPrecommitFinding) {
  return {
    kind: "diagnostic" as const,
    path: finding.path,
    code: finding.code,
  };
}

function persistGitPrecommitFindings(args: {
  projectId: string;
  checkedFiles: readonly string[];
  resolvedOnlyFiles?: readonly string[];
  findings: readonly GitPrecommitFinding[];
  projectStore: ProjectStore;
}): void {
  const capturedAt = new Date().toISOString();
  const freshness = {
    state: "fresh" as const,
    checkedAt: capturedAt,
    reason: "staged git blob checked by git_precommit_check",
  };
  const subjectFingerprints = new Set<string>();
  const knownCodes = GIT_PRECOMMIT_RULES.map((rule) => rule.id);

  for (const filePath of [...args.checkedFiles, ...(args.resolvedOnlyFiles ?? [])]) {
    for (const code of knownCodes) {
      subjectFingerprints.add(args.projectStore.computeReefSubjectFingerprint({
        kind: "diagnostic",
        path: filePath,
        code,
      }));
    }
  }

  const reefFindings: ProjectFinding[] = args.findings.map((finding) => {
    const subject = reefSubjectForFinding(finding);
    const subjectFingerprint = args.projectStore.computeReefSubjectFingerprint(subject);
    subjectFingerprints.add(subjectFingerprint);
    const evidenceRefs = finding.evidence ? [finding.evidence] : [];
    return {
      projectId: args.projectId,
      fingerprint: args.projectStore.computeReefFindingFingerprint({
        source: GIT_PRECOMMIT_SOURCE,
        ruleId: finding.code,
        subjectFingerprint,
        message: finding.message,
        evidenceRefs,
      }),
      source: GIT_PRECOMMIT_SOURCE,
      subjectFingerprint,
      overlay: "staged",
      severity: reefSeverity(finding),
      status: "active",
      filePath: finding.path,
      ...(finding.line ? { line: finding.line } : {}),
      ruleId: finding.code,
      evidenceRefs,
      freshness,
      capturedAt,
      message: finding.message,
      factFingerprints: [],
    };
  });

  args.projectStore.saveReefRuleDescriptors(GIT_PRECOMMIT_RULES);
  args.projectStore.replaceReefFindingsForSource({
    projectId: args.projectId,
    source: GIT_PRECOMMIT_SOURCE,
    overlay: "staged",
    subjectFingerprints: [...subjectFingerprints],
    findings: reefFindings,
    reason: "git_precommit_check no longer produced finding for staged subject",
  });
}

function checkStagedFile(args: {
  file: StagedFile;
  projectRoot: string;
  authGuards: Set<string>;
  publicRouteGlobs: readonly string[];
  serverOnlyModules: Set<string>;
  knownFiles: Set<string>;
  pathAliases: Record<string, string>;
}): GitPrecommitFinding[] {
  const sourceFile = ts.createSourceFile(
    args.file.projectPath,
    args.file.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(args.file.projectPath),
  );
  const findings: GitPrecommitFinding[] = [];
  const calls = collectCalls(sourceFile);
  const imports = collectImports(sourceFile);
  const isClient = hasDirective(sourceFile, "use client");

  if (
    isApiRoutePath(args.file.projectPath) &&
    !isPublicRoute(args.file.projectPath, args.publicRouteGlobs) &&
    !calls.some((call) => isAuthGuardCall(call.name, args.authGuards))
  ) {
    findings.push({
      code: "git.unprotected_route",
      severity: "critical",
      path: args.file.projectPath,
      message: "no auth guard detected",
      evidence: `guards checked: ${[...args.authGuards].sort().join(", ")}`,
      metadata: { publicRouteGlobs: [...args.publicRouteGlobs] },
    });
  }

  if (isClient) {
    for (const imported of imports) {
      const resolvedImport = resolveImportPath(
        args.projectRoot,
        args.file.projectPath,
        imported.specifier,
        args.knownFiles,
        args.pathAliases,
      );
      if (SERVER_ONLY_IMPORTS.has(imported.specifier) || (resolvedImport && args.serverOnlyModules.has(resolvedImport))) {
        findings.push({
          code: "git.client_uses_server_only",
          severity: "critical",
          path: args.file.projectPath,
          line: imported.line,
          message: `"use client" file imports server-only module ${imported.specifier}`,
          evidence: imported.specifier,
          metadata: resolvedImport ? { resolvedImport } : undefined,
        });
      }
    }

    for (const call of calls) {
      const lastSegment = call.name.split(".").at(-1) ?? call.name;
      if (SERVER_ONLY_CALLS.has(lastSegment)) {
        findings.push({
          code: "git.client_uses_server_only",
          severity: "critical",
          path: args.file.projectPath,
          line: call.line,
          message: `"use client" file calls server-only API ${call.name}`,
          evidence: call.name,
        });
      }
    }
  } else {
    for (const call of calls) {
      const lastSegment = call.name.split(".").at(-1) ?? call.name;
      if (CLIENT_HOOK_CALLS.has(lastSegment)) {
        findings.push({
          code: "git.server_uses_client_hook",
          severity: "high",
          path: args.file.projectPath,
          line: call.line,
          message: `file calls client hook ${call.name} without a top-level "use client" directive`,
          evidence: call.name,
        });
      }
    }
  }

  return findings;
}

export function analyzeGitGuardSourceFiles(args: {
  projectRoot: string;
  projectStore: ProjectStore;
  profile: ProjectProfile | null;
  files: readonly GitGuardSourceFile[];
  includeExtensions?: readonly string[];
  authGuardSymbols?: readonly string[];
  publicRouteGlobs?: readonly string[];
  serverOnlyModules?: readonly string[];
}): GitGuardAnalysisResult {
  const includeExtensions = args.includeExtensions ?? [...DEFAULT_INCLUDE_EXTENSIONS];
  const config = loadGitGuardConfig(args.projectRoot);
  const warnings = [...config.warnings];
  const knownFiles = new Set(args.projectStore.listFiles().map((file) => normalizePathForGlob(file.path)));
  const authGuardSymbols = uniqueSorted([
    ...DEFAULT_AUTH_GUARDS,
    ...(args.profile?.authGuardSymbols ?? []),
    ...config.authGuardSymbols,
    ...(args.authGuardSymbols ?? []),
  ]);
  const publicRouteGlobs = uniqueSorted([
    ...config.publicRouteGlobs,
    ...(args.publicRouteGlobs ?? []),
  ]);
  const serverOnlyModules = uniqueSorted([
    ...(args.profile?.serverOnlyModules ?? []),
    ...config.serverOnlyModules,
    ...(args.serverOnlyModules ?? []),
  ]).map(normalizePathForGlob);

  if (args.profile == null) {
    warnings.push("project profile is missing; using only default and input-provided guard policy.");
  }

  const checkedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const sourceFiles: StagedFile[] = [];
  for (const file of args.files) {
    if (!includeExtensions.includes(extname(file.projectPath))) {
      skippedFiles.push(file.projectPath);
      continue;
    }
    checkedFiles.push(file.projectPath);
    sourceFiles.push({
      projectPath: file.projectPath,
      gitPath: file.projectPath,
      content: file.content,
    });
  }

  return {
    checkedFiles,
    skippedFiles,
    findings: sourceFiles.flatMap((file) =>
      checkStagedFile({
        file,
        projectRoot: args.projectRoot,
        authGuards: new Set(authGuardSymbols),
        publicRouteGlobs,
        serverOnlyModules: new Set(serverOnlyModules),
        knownFiles: new Set([...knownFiles, ...serverOnlyModules]),
        pathAliases: args.profile?.pathAliases ?? {},
      })
    ),
    warnings,
    policy: {
      publicRouteGlobs,
      authGuardSymbols,
      serverOnlyModules,
      includeExtensions: [...includeExtensions],
      configSources: config.configSources,
    },
  };
}

export async function gitPrecommitCheckTool(
  input: GitPrecommitCheckToolInput,
  options: ToolServiceOptions = {},
): Promise<GitPrecommitCheckToolOutput> {
  return withProjectContext(input, options, ({ project, profile, projectStore }) => {
    const projectRoot = resolve(project.canonicalPath);
    const reefBacked = isReefBackedToolViewEnabled("git_precommit_check");
    const gitRoot = resolve(git(["rev-parse", "--show-toplevel"], projectRoot).trim());
    const rawStagedChanges = stagedChanges(gitRoot);
    const includeExtensions = input.includeExtensions ?? [...DEFAULT_INCLUDE_EXTENSIONS];
    const config = loadGitGuardConfig(projectRoot);
    const warnings = [...config.warnings];
    const knownFiles = new Set(projectStore.listFiles().map((file) => normalizePathForGlob(file.path)));
    const authGuardSymbols = uniqueSorted([
      ...DEFAULT_AUTH_GUARDS,
      ...(profile?.authGuardSymbols ?? []),
      ...config.authGuardSymbols,
      ...(input.authGuardSymbols ?? []),
    ]);
    const publicRouteGlobs = uniqueSorted([
      ...config.publicRouteGlobs,
      ...(input.publicRouteGlobs ?? []),
    ]);
    const serverOnlyModules = uniqueSorted([
      ...(profile?.serverOnlyModules ?? []),
      ...config.serverOnlyModules,
      ...(input.serverOnlyModules ?? []),
    ]).map(normalizePathForGlob);

    const stagedFiles: string[] = [];
    const stagedChangeRecords: GitPrecommitStagedChange[] = [];
    const checkedFiles: string[] = [];
    const skippedFiles: string[] = [];
    const resolvedOnlyFiles = new Set<string>();
    const stagedSourceFiles: StagedFile[] = [];

    const toProjectPath = (gitPath: string): string | null => {
      const absolutePath = resolve(gitRoot, gitPath);
      if (!isWithinRoot(projectRoot, absolutePath)) {
        return null;
      }
      return normalizePathForGlob(relative(projectRoot, absolutePath));
    };

    for (const change of rawStagedChanges) {
      const projectPath = toProjectPath(change.gitPath);
      const oldProjectPath = change.oldGitPath ? toProjectPath(change.oldGitPath) : null;
      if (!projectPath && !oldProjectPath) {
        continue;
      }

      const outputPath = projectPath ?? oldProjectPath;
      if (!outputPath) {
        continue;
      }
      stagedChangeRecords.push({
        status: change.status,
        path: outputPath,
        ...(oldProjectPath && oldProjectPath !== outputPath ? { oldPath: oldProjectPath } : {}),
      });
      stagedFiles.push(outputPath);
      if (oldProjectPath && change.status === "renamed") {
        resolvedOnlyFiles.add(oldProjectPath);
      }
      if (change.status === "deleted" || !projectPath) {
        resolvedOnlyFiles.add(outputPath);
        continue;
      }
      if (!includeExtensions.includes(extname(projectPath))) {
        skippedFiles.push(projectPath);
        continue;
      }
      checkedFiles.push(projectPath);
      stagedSourceFiles.push({
        projectPath,
        gitPath: change.gitPath,
        content: readStagedFile(gitRoot, change.gitPath),
      });
    }

    if (profile == null) {
      warnings.push("project profile is missing; using only default and input-provided guard policy.");
    }

    const findings = stagedSourceFiles.flatMap((file) =>
      checkStagedFile({
        file,
        projectRoot,
        authGuards: new Set(authGuardSymbols),
        publicRouteGlobs,
        serverOnlyModules: new Set(serverOnlyModules),
        knownFiles: new Set([...knownFiles, ...serverOnlyModules]),
        pathAliases: profile?.pathAliases ?? {},
      }),
    );
    const stopReason = buildStopReason(findings);
    if (reefBacked) {
      persistGitPrecommitFindings({
        projectId: project.projectId,
        checkedFiles,
        resolvedOnlyFiles: [...resolvedOnlyFiles],
        findings,
        projectStore,
      });
    } else {
      warnings.push("Reef-backed staged finding persistence is disabled by MAKO_REEF_BACKED.");
    }

    return {
      toolName: "git_precommit_check",
      projectId: project.projectId,
      projectRoot,
      gitRoot,
      stagedChanges: stagedChangeRecords,
      stagedFiles,
      checkedFiles,
      skippedFiles,
      findings,
      warnings,
      policy: {
        publicRouteGlobs,
        authGuardSymbols,
        serverOnlyModules,
        includeExtensions,
        configSources: config.configSources,
      },
      continue: findings.length === 0,
      ...(stopReason ? { stopReason } : {}),
    } satisfies GitPrecommitCheckToolOutput;
  });
}
