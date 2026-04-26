import type { AnswerSurfaceIssue } from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import {
  buildSurfaceIssue,
  canonicalizeFieldName,
  canonicalizePluralAware,
  collectPropertyOccurrences,
  collectQueryUsages,
  collectRoleSources,
  dedupeIssuesByMatchBasedId,
  formatEvidenceRef,
  readDiagnosticFiles,
  type DiagnosticAstFile,
  type FilePropertyOccurrence,
} from "./common.js";

export interface StructuralDiagnosticsInput {
  projectStore: ProjectStore;
  focusFiles: string[];
  enableAppHeuristics?: boolean;
}

export function runStructuralAlignmentDiagnostics(
  input: StructuralDiagnosticsInput,
): AnswerSurfaceIssue[] {
  return dedupeIssuesByMatchBasedId([
    ...(input.enableAppHeuristics ? findHelperReuseMiss(input.projectStore, input.focusFiles) : []),
    ...(input.enableAppHeuristics ? findAuthRoleSourceDrift(input.projectStore, input.focusFiles) : []),
    ...findSqlRelationAliasDrift(input.projectStore, input.focusFiles),
  ]);
}

function findHelperReuseMiss(
  projectStore: ProjectStore,
  focusFiles: string[],
): AnswerSurfaceIssue[] {
  const issues: AnswerSurfaceIssue[] = [];
  for (const filePath of focusFiles) {
    if (!filePath.startsWith("app/api/")) {
      continue;
    }

    const file = readDiagnosticFiles(projectStore, [filePath])[0];
    if (!file) continue;

    const fromQueries = collectQueryUsages(file).filter((usage) => usage.kind === "from");
    if (fromQueries.length === 0) {
      continue;
    }

    for (const query of fromQueries) {
      const candidateHelpers = findHelperCandidates(projectStore, query.value, filePath);
      const preferredHelper = candidateHelpers.find((helper) => helper.usesRpc) ?? candidateHelpers[0];
      if (!preferredHelper) {
        continue;
      }

      issues.push(
        buildSurfaceIssue({
          category: "rpc_helper_reuse",
          code: "reuse.helper_bypass",
          message:
            `This route queries \`${query.value}\` directly even though ${preferredHelper.functionName} in ${preferredHelper.path} already encapsulates the same domain fetch path.`,
          severity: preferredHelper.usesRpc ? "high" : "medium",
          confidence: preferredHelper.usesRpc ? "confirmed" : "probable",
          path: file.path,
          line: query.line,
          producerPath: preferredHelper.path,
          consumerPath: file.path,
          evidenceRefs: [
            formatEvidenceRef(file.path, query.line),
            formatEvidenceRef(preferredHelper.path, preferredHelper.line),
          ],
          matchKey: {
            table: query.value,
            helperPath: preferredHelper.path,
            functionName: preferredHelper.functionName,
            consumerPath: file.path,
          },
          codeFingerprint: {
            directQuery: query.value,
            helperFunction: preferredHelper.functionName,
            usesRpc: preferredHelper.usesRpc,
          },
        }),
      );
    }
  }
  return issues;
}

function findAuthRoleSourceDrift(
  projectStore: ProjectStore,
  focusFiles: string[],
): AnswerSurfaceIssue[] {
  const issues: AnswerSurfaceIssue[] = [];

  for (const filePath of focusFiles) {
    if (!filePath.startsWith("app/dashboard/")) {
      continue;
    }
    const layoutPath = "app/dashboard/layout.tsx";
    if (filePath === layoutPath) {
      continue;
    }

    const [layoutFile, pageFile] = readDiagnosticFiles(projectStore, [layoutPath, filePath]);
    if (!layoutFile || !pageFile) continue;

    const layoutRoleSource = collectRoleSources(layoutFile)[0];
    const pageRoleSource = collectRoleSources(pageFile)[0];
    if (!layoutRoleSource || !pageRoleSource || layoutRoleSource.source === pageRoleSource.source) {
      continue;
    }

    issues.push(
      buildSurfaceIssue({
        category: "auth_role_drift",
        code: "auth.role_source_drift",
        message:
          `Dashboard access control resolves role from \`${layoutRoleSource.source}\` in the layout but \`${pageRoleSource.source}\` in the page, which can drift across the same scope.`,
        severity: "high",
        confidence: "confirmed",
        path: pageFile.path,
        line: pageRoleSource.line,
        producerPath: layoutFile.path,
        consumerPath: pageFile.path,
        evidenceRefs: [
          formatEvidenceRef(layoutFile.path, layoutRoleSource.line),
          formatEvidenceRef(pageFile.path, pageRoleSource.line),
        ],
        matchKey: {
          layoutPath: layoutFile.path,
          pagePath: pageFile.path,
          layoutRoleSource: layoutRoleSource.source,
          pageRoleSource: pageRoleSource.source,
        },
        codeFingerprint: {
          layoutRoleSource,
          pageRoleSource,
        },
      }),
    );
  }

  return issues;
}

function findSqlRelationAliasDrift(
  projectStore: ProjectStore,
  focusFiles: string[],
): AnswerSurfaceIssue[] {
  const issues: AnswerSurfaceIssue[] = [];

  for (const filePath of focusFiles) {
    const file = readDiagnosticFiles(projectStore, [filePath])[0];
    if (!file) continue;

    const selectAliases = collectQueryUsages(file)
      .filter((usage) => usage.kind === "select")
      .flatMap((usage) =>
        [...usage.value.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((match) => ({
          alias: match[1],
          line: usage.line,
          selectText: usage.value,
        })),
      );

    if (selectAliases.length === 0) continue;

    const relatedFiles = resolveStructuralRelatedFiles(projectStore, file.path);
    const parsedRelatedFiles = readDiagnosticFiles(projectStore, relatedFiles);
    const relatedProperties = parsedRelatedFiles
      .flatMap((relatedFile) => collectPropertyOccurrences(relatedFile))
      .filter((property) =>
        property.ownerKind === "interface_property" ||
        property.ownerKind === "type_property" ||
        property.ownerKind === "returned_object_property" ||
        property.ownerKind === "component_prop",
      );

    for (const alias of selectAliases) {
      const consumerProperty = relatedProperties.find((property) => {
        if (property.propertyName === alias.alias) return false;
        if (canonicalizePluralAware(property.propertyName) !== canonicalizePluralAware(alias.alias)) {
          return false;
        }
        return sharesRelationNeighbor(file, property);
      });
      if (!consumerProperty) {
        continue;
      }

      issues.push(
        buildSurfaceIssue({
          category: "sql_alignment",
          code: "sql.relation_alias_drift",
          message:
            `The query aliases this relation as \`${alias.alias}\`, but nearby consumer code expects \`${consumerProperty.propertyName}\` for the same relation surface.`,
          severity: "high",
          confidence: "confirmed",
          path: file.path,
          line: alias.line,
          producerPath: file.path,
          consumerPath: consumerProperty.path,
          evidenceRefs: [
            formatEvidenceRef(file.path, alias.line),
            formatEvidenceRef(consumerProperty.path, consumerProperty.line),
          ],
          matchKey: {
            alias: alias.alias,
            consumerProperty: consumerProperty.propertyName,
            producerPath: file.path,
            consumerPath: consumerProperty.path,
          },
          codeFingerprint: {
            selectText: alias.selectText,
            consumerProperty,
          },
        }),
      );
    }
  }

  return issues;
}

function sharesRelationNeighbor(file: DiagnosticAstFile, property: FilePropertyOccurrence): boolean {
  if (property.path === file.path) {
    return true;
  }
  if (property.ownerName && file.content.includes(property.ownerName)) {
    return true;
  }
  return basenameKey(property.path) === basenameKey(file.path);
}

function basenameKey(filePath: string): string {
  const rawName = filePath.split("/").at(-1) ?? filePath;
  return canonicalizeFieldName(rawName.replace(/\.[^.]+$/, ""));
}

function findHelperCandidates(
  projectStore: ProjectStore,
  tableName: string,
  consumerPath: string,
): Array<{ path: string; line: number; functionName: string; usesRpc: boolean }> {
  const files = projectStore
    .listFiles()
    .map((file) => file.path)
    .filter((path) => path.startsWith("lib/") && path !== consumerPath);
  const candidates: Array<{ path: string; line: number; functionName: string; usesRpc: boolean }> = [];

  for (const file of readDiagnosticFiles(projectStore, files)) {
    const text = file.content;
    if (!text.includes(tableName) && !text.includes(`get_visible_${tableName}`)) {
      continue;
    }
    const functionMatches = [...text.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)];
    const usesRpc = text.includes(".rpc(");
    for (const match of functionMatches) {
      const index = match.index ?? 0;
      const position = file.sourceFile.getLineAndCharacterOfPosition(index);
      candidates.push({
        path: file.path,
        line: position.line + 1,
        functionName: match[1],
        usesRpc,
      });
    }
  }

  return candidates.filter((candidate) =>
    canonicalizeFieldName(candidate.path).includes(canonicalizeFieldName(tableName)) ||
    candidate.functionName.toLowerCase().includes(tableName.toLowerCase()) ||
    candidate.usesRpc,
  );
}

function resolveStructuralRelatedFiles(projectStore: ProjectStore, focusPath: string): string[] {
  const related = new Set<string>([focusPath]);
  for (const edge of projectStore.listDependentsForFile(focusPath)) {
    related.add(edge.sourcePath);
  }
  for (const edge of projectStore.listImportsForFile(focusPath)) {
    related.add(edge.targetPath);
  }

  if (focusPath.includes("dashboard")) {
    for (const file of projectStore.listFiles()) {
      if (file.path.startsWith("components/dashboard/") || file.path.startsWith("app/dashboard/")) {
        related.add(file.path);
      }
    }
  }

  return [...related];
}
