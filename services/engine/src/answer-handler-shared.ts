import type {
  AnswerPacket,
  AnswerResult,
  AttachedProject,
  CandidateAction,
  EvidenceBlock,
  ProjectProfile,
  SupportLevel,
} from "@mako-ai/contracts";
import {
  createId,
  type FileDetailRecord,
  type FileSearchMatch,
  type ProjectStore,
  type ResolvedRouteRecord,
  type ResolvedSchemaObjectRecord,
  type SchemaObjectDetail,
} from "@mako-ai/store";

export const AUTH_HINT_PATTERN = /(auth|login|session|role|permission|guard|tenant|account|membership|rbac|acl)/i;
export const DEPENDENCY_HINT_PATTERN = /(depends? on|dependents?|used by|uses|imports?|imported by|consumers?|callers?)/i;
export const SCHEMA_HINT_PATTERN = /(table|model|column|schema|database|db|sql|migration|query)/i;
export const FILE_HINT_PATTERN = /(file|module|component|entry|handler|health)/i;
export const FEATURE_HINT_PATTERN = /(relevant|feature|flow|touches|related|surface|area)/i;
const AUTH_SCHEMA_TERMS = [
  "auth",
  "account",
  "accounts",
  "membership",
  "memberships",
  "permission",
  "permissions",
  "role",
  "roles",
  "session",
  "sessions",
  "tenant",
  "tenants",
  "user",
  "users",
] as const;
const GENERIC_QUERY_TERMS = new Set([
  "and",
  "api",
  "code",
  "column",
  "component",
  "db",
  "depend",
  "depends",
  "feature",
  "file",
  "files",
  "flow",
  "for",
  "from",
  "health",
  "how",
  "import",
  "imports",
  "likely",
  "model",
  "module",
  "path",
  "query",
  "relevant",
  "route",
  "schema",
  "sql",
  "table",
  "this",
  "trace",
  "usage",
  "used",
  "what",
  "where",
  "which",
  "who",
]);

export interface AnswerContext {
  packet: AnswerPacket;
  project: AttachedProject;
  profile: ProjectProfile;
  projectStore: ProjectStore;
}

interface SynthesizedAnswer {
  answer?: string;
  answerConfidence?: number;
  evidence: EvidenceBlock[];
  evidenceStatus: AnswerPacket["evidenceStatus"];
  missingInformation: string[];
  stalenessFlags: string[];
  candidateActions: CandidateAction[];
  supportLevel?: SupportLevel;
}

export function createEvidenceBlock(
  kind: EvidenceBlock["kind"],
  title: string,
  sourceRef: string,
  content: string,
  options: Partial<Pick<EvidenceBlock, "filePath" | "line" | "score" | "metadata">> = {},
): EvidenceBlock {
  return {
    blockId: createId("evidence"),
    kind,
    title,
    sourceRef,
    content,
    ...options,
  };
}

export function createAction(label: string, description: string, safeToAutomate = false): CandidateAction {
  return {
    actionId: createId("action"),
    label,
    description,
    safeToAutomate,
  };
}

export function listPreview(values: string[], limit = 5): string {
  if (values.length === 0) {
    return "none";
  }

  const preview = values.slice(0, limit).join(", ");
  return values.length > limit ? `${preview}, +${values.length - limit} more` : preview;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function dedupeBy<T>(items: T[], keySelector: (item: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const item of items) {
    const key = keySelector(item);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

export function normalizeQueryText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractMeaningfulTerms(queryText: string): string[] {
  const matches = normalizeQueryText(queryText).toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return unique(matches.filter((term) => term.length >= 2 && !GENERIC_QUERY_TERMS.has(term)));
}

function singularizeTerm(term: string): string {
  if (term.endsWith("ies") && term.length > 3) {
    return `${term.slice(0, -3)}y`;
  }

  if (term.endsWith("ses") && term.length > 3) {
    return term.slice(0, -2);
  }

  if (term.endsWith("s") && term.length > 3) {
    return term.slice(0, -1);
  }

  return term;
}

function pluralizeTerm(term: string): string {
  if (term.endsWith("s")) {
    return term;
  }

  if (term.endsWith("y") && term.length > 1) {
    return `${term.slice(0, -1)}ies`;
  }

  return `${term}s`;
}

function expandEntityTerms(queryText: string, seedTerms: readonly string[] = []): string[] {
  const tokens = extractMeaningfulTerms(queryText);
  const expanded = new Set<string>(seedTerms.map((term) => term.toLowerCase()));

  for (const token of tokens) {
    expanded.add(token);
    expanded.add(singularizeTerm(token));
    expanded.add(pluralizeTerm(token));
  }

  return [...expanded].filter((term) => term.length >= 2);
}

export function buildWeakEvidenceResult(
  context: AnswerContext,
  answer: string,
  options: {
    answerConfidence?: number;
    evidence?: EvidenceBlock[];
    missingInformation: string[];
    candidateActions?: CandidateAction[];
    supportLevel?: SupportLevel;
  },
): AnswerResult {
  return buildAnswerResult(context, {
    answer,
    answerConfidence: options.answerConfidence ?? 0.18,
    evidence: options.evidence ?? [],
    evidenceStatus: "partial",
    missingInformation: options.missingInformation,
    stalenessFlags: [],
    candidateActions: options.candidateActions ?? [],
    supportLevel: options.supportLevel,
  });
}

export function buildAnswerResult(context: AnswerContext, synthesized: SynthesizedAnswer): AnswerResult {
  const packet: AnswerPacket = {
    ...context.packet,
    supportLevel: synthesized.supportLevel ?? context.profile.supportLevel ?? context.packet.supportLevel,
    evidenceStatus: synthesized.evidenceStatus,
    evidenceConfidence: synthesized.answerConfidence ?? context.packet.evidenceConfidence,
    missingInformation: synthesized.missingInformation,
    stalenessFlags: synthesized.stalenessFlags,
    evidence: synthesized.evidence,
    generatedAt: new Date().toISOString(),
  };

  return {
    queryId: packet.queryId,
    projectId: packet.projectId,
    queryKind: packet.queryKind,
    tierUsed: packet.tierUsed,
    supportLevel: packet.supportLevel,
    evidenceStatus: packet.evidenceStatus,
    answer: synthesized.answer,
    answerConfidence: synthesized.answerConfidence,
    packet,
    candidateActions: synthesized.candidateActions,
    noSynthesis: synthesized.answer == null,
  };
}

function summarizeFile(file: FileDetailRecord): string {
  return `${file.path} is a ${file.language} file with ${file.lineCount} lines, ${file.symbols.length} exported symbols, ${file.outboundImports.length} outbound imports, and ${file.inboundImports.length} inbound dependents.`;
}

export function buildFileEvidence(file: FileDetailRecord): EvidenceBlock[] {
  const evidence: EvidenceBlock[] = [
    createEvidenceBlock(
      "file",
      `File: ${file.path}`,
      file.path,
      file.chunkPreview ?? summarizeFile(file),
      {
        filePath: file.path,
        score: 0.92,
        metadata: {
          language: file.language,
          lineCount: file.lineCount,
          sizeBytes: file.sizeBytes,
          isGenerated: file.isGenerated,
        },
      },
    ),
  ];

  if (file.symbols.length > 0) {
    evidence.push(
      createEvidenceBlock(
        "symbol",
        `Exported Symbols in ${file.path}`,
        file.path,
        listPreview(
          file.symbols.map((symbol: FileDetailRecord["symbols"][number]) => `${symbol.kind} ${symbol.name}`),
          8,
        ),
        {
          filePath: file.path,
          line: file.symbols[0]?.lineStart,
          score: 0.74,
          metadata: { count: file.symbols.length },
        },
      ),
    );
  }

  if (file.outboundImports.length > 0) {
    evidence.push(
      createEvidenceBlock(
        "file",
        `Outbound Imports from ${file.path}`,
        file.path,
        listPreview(
          file.outboundImports.map(
            (edge: FileDetailRecord["outboundImports"][number]) => `${edge.specifier} -> ${edge.targetPath}`,
          ),
          8,
        ),
        { filePath: file.path, score: 0.71, metadata: { count: file.outboundImports.length } },
      ),
    );
  }

  if (file.inboundImports.length > 0) {
    evidence.push(
      createEvidenceBlock(
        "file",
        `Inbound Dependents of ${file.path}`,
        file.path,
        listPreview(
          file.inboundImports.map(
            (edge: FileDetailRecord["inboundImports"][number]) => `${edge.sourcePath} imports ${edge.specifier}`,
          ),
          8,
        ),
        { filePath: file.path, score: 0.78, metadata: { count: file.inboundImports.length } },
      ),
    );
  }

  if (file.routes.length > 0) {
    evidence.push(
      createEvidenceBlock(
        "route",
        `Routes in ${file.path}`,
        file.path,
        listPreview(file.routes.map((route: FileDetailRecord["routes"][number]) => `${route.method ?? "ANY"} ${route.pattern}`), 8),
        { filePath: file.path, score: 0.88, metadata: { count: file.routes.length } },
      ),
    );
  }

  const missingInternalImports = file.outboundImports.filter(
    (edge) => !edge.targetExists && (edge.importKind === "relative" || edge.importKind === "re-export"),
  );

  if (missingInternalImports.length > 0) {
    evidence.push(
      createEvidenceBlock(
        "finding",
        `Unresolved Internal Imports in ${file.path}`,
        file.path,
        listPreview(missingInternalImports.map((edge) => `${edge.specifier} -> ${edge.targetPath}`), 8),
        {
          filePath: file.path,
          score: 0.85,
          metadata: { count: missingInternalImports.length },
        },
      ),
    );
  }

  return evidence;
}

export function resolveFileFromQuery(projectStore: ProjectStore, queryText: string): FileDetailRecord | null {
  const direct = projectStore.getFileDetail(queryText);
  if (direct) {
    return direct;
  }

  const searchMatch = projectStore.searchFiles(queryText, 1)[0];
  return searchMatch ? projectStore.getFileDetail(searchMatch.path) : null;
}

export function buildSearchMatchEvidence(title: string, match: FileSearchMatch): EvidenceBlock {
  return createEvidenceBlock("file", title, match.path, match.snippet ?? summarizeSearchMatch(match), {
    filePath: match.path,
    score: 0.54,
    metadata: {
      language: match.language,
    },
  });
}

export function collectFileDetails(
  projectStore: ProjectStore,
  filePaths: string[],
  limit = 4,
): FileDetailRecord[] {
  const files: FileDetailRecord[] = [];

  for (const filePath of unique(filePaths)) {
    const file = projectStore.getFileDetail(filePath);
    if (file) {
      files.push(file);
    }

    if (files.length >= limit) {
      break;
    }
  }

  return files;
}

export function resolveSchemaDetailFromQuery(projectStore: ProjectStore, queryText: string): SchemaObjectDetail | null {
  const direct = projectStore.getSchemaObjectDetail(queryText);
  if (direct) {
    return direct;
  }

  for (const term of expandEntityTerms(queryText)) {
    const detail = projectStore.getSchemaObjectDetail(term);
    if (detail) {
      return detail;
    }
  }

  return null;
}

export function resolveSchemaCandidates(
  projectStore: ProjectStore,
  queryText: string,
  limit = 4,
  seedTerms: readonly string[] = [],
): ResolvedSchemaObjectRecord[] {
  return dedupeBy(
    expandEntityTerms(queryText, seedTerms)
      .flatMap((term) => projectStore.searchSchemaObjects(term, Math.max(limit, 2)))
      .slice(0, limit * 3),
    (item) => `${item.objectType}:${item.schemaName}:${item.parentObjectName ?? ""}:${item.objectName}`,
  ).slice(0, limit);
}

export function buildRouteDefinitionEvidence(route: ResolvedRouteRecord): EvidenceBlock | null {
  const definitionFilePath =
    route.metadata != null && typeof route.metadata.definitionFilePath === "string"
      ? route.metadata.definitionFilePath
      : undefined;
  const definitionLine =
    route.metadata != null && typeof route.metadata.definitionLine === "number"
      ? route.metadata.definitionLine
      : undefined;
  const definitionExport =
    route.metadata != null && typeof route.metadata.definitionExport === "string"
      ? route.metadata.definitionExport
      : undefined;

  if (!definitionFilePath || definitionFilePath === route.filePath) {
    return null;
  }

  return createEvidenceBlock(
    "document",
    `Route Definition: ${route.method ?? "ANY"} ${route.pattern}`,
    definitionExport ?? definitionFilePath,
    `${route.method ?? "ANY"} ${route.pattern} is declared in ${definitionFilePath}${definitionExport ? ` as ${definitionExport}` : ""}.`,
    {
      filePath: definitionFilePath,
      line: definitionLine,
      score: 0.9,
    },
  );
}

export function buildFileRoles(context: AnswerContext, file: FileDetailRecord): string[] {
  const roles: string[] = [];

  if (context.profile.entryPoints.includes(file.path)) {
    roles.push("entry point");
  }

  if (context.profile.middlewareFiles.includes(file.path)) {
    roles.push("middleware");
  }

  if (context.profile.serverOnlyModules.includes(file.path)) {
    roles.push("server-only");
  }

  if (file.routes.length > 0) {
    roles.push(`${file.routes.length} route${file.routes.length === 1 ? "" : "s"}`);
  }

  return roles;
}

export function getRoutePriority(route: ResolvedRouteRecord): number {
  let priority = 0;

  if (route.isApi) {
    priority += 1;
  }

  if (route.handlerName) {
    priority += 1;
  }

  if (
    route.metadata != null &&
    typeof route.metadata.routeKind === "string" &&
    route.metadata.routeKind === "handler"
  ) {
    priority += 2;
  }

  return priority;
}

function summarizeSearchMatch(match: FileSearchMatch): string {
  return `${match.path} (${match.language}, ${match.lineCount} lines)${match.snippet ? `: ${match.snippet}` : ""}`;
}

export function formatSchemaObjectName(detail: SchemaObjectDetail["object"]): string {
  const qualifiedObjectName =
    detail.parentObjectName != null
      ? `${detail.schemaName}.${detail.parentObjectName}.${detail.objectName}`
      : `${detail.schemaName}.${detail.objectName}`;

  return `${detail.objectType} ${qualifiedObjectName}`;
}

export function buildSchemaEvidence(detail: SchemaObjectDetail): EvidenceBlock[] {
  const evidence: EvidenceBlock[] = [];
  const definition = detail.object.definition;
  const definitionFilePath =
    definition != null && typeof definition.sourceFilePath === "string"
      ? definition.sourceFilePath
      : undefined;
  const definitionLine =
    definition != null && typeof definition.line === "number"
      ? definition.line
      : undefined;
  const statementExcerpt =
    definition != null && typeof definition.statementExcerpt === "string"
      ? definition.statementExcerpt
      : undefined;

  evidence.push(
    createEvidenceBlock(
      "schema",
      `Schema Object: ${formatSchemaObjectName(detail.object)}`,
      `${detail.object.schemaName}.${detail.object.objectName}`,
      statementExcerpt ??
        `${formatSchemaObjectName(detail.object)}${detail.object.dataType ? ` (${detail.object.dataType})` : ""}.`,
      {
        filePath: definitionFilePath,
        line: definitionLine,
        metadata: {
          objectType: detail.object.objectType,
          schemaName: detail.object.schemaName,
          parentObjectName: detail.object.parentObjectName ?? null,
          dataType: detail.object.dataType ?? null,
        },
      },
    ),
  );

  for (const usage of detail.usages.filter((item) => item.usageKind !== "definition").slice(0, 4)) {
    evidence.push(
      createEvidenceBlock(
        "file",
        `Schema Usage in ${usage.filePath}`,
        usage.filePath,
        usage.excerpt ?? `${detail.object.objectName} is referenced in ${usage.filePath}.`,
        {
          filePath: usage.filePath,
          line: usage.line,
          metadata: {
            usageKind: usage.usageKind,
          },
        },
      ),
    );
  }

  return evidence;
}

export function authSchemaSeedTerms(queryText: string): string[] {
  return Array.from(new Set([...AUTH_SCHEMA_TERMS, ...expandEntityTerms(queryText)]));
}
