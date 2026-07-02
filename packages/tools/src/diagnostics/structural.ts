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
          // Helper matching is convention-based (function naming + table
          // substring), so bypassing it may be intentional — reuse advice,
          // not a confirmed defect.
          severity: "medium",
          confidence: "probable",
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
        // Role sources are detected by name (`*.role`, `*Role()` calls), so a
        // rendered `member.role` and a gating `profile.role` can differ
        // legitimately — probable drift, not confirmed.
        severity: "medium",
        confidence: "probable",
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
          // Alias↔property pairing is plural/case-insensitive name matching
          // across "related" files, which can pair unrelated surfaces.
          severity: "medium",
          confidence: "probable",
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

// A canonical fetch helper is conventionally named like a data fetcher.
// Guards such as enforceAccountStatus / requireRole / assertOwner read the same
// table for a side effect, not to return it, so they are not "the fetch path"
// and must not be suggested as a replacement for a direct query.
const HELPER_FETCHER_NAME_RE = /^(?:fetch|get|load|list|find|query|select|read|lookup|resolve)[A-Z0-9_]/;

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
  const tableLower = tableName.toLowerCase();
  const visibleRpc = `get_visible_${tableName}`.toLowerCase();

  for (const file of readDiagnosticFiles(projectStore, files)) {
    // Exported async functions in declaration order, so each table/RPC usage can
    // be attributed to the function that actually contains it. Matching at the
    // file level (the previous behaviour) blamed every export in a file for one
    // query and treated any `.rpc(` anywhere as encapsulating any table.
    const functionDecls = [...file.content.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)]
      .map((match) => ({
        name: match[1],
        line: file.sourceFile.getLineAndCharacterOfPosition(match.index ?? 0).line + 1,
      }))
      .sort((left, right) => left.line - right.line);
    if (functionDecls.length === 0) continue;

    const enclosingFunction = (line: number): { name: string; line: number } | undefined => {
      let current: { name: string; line: number } | undefined;
      for (const decl of functionDecls) {
        if (decl.line <= line) current = decl;
        else break;
      }
      return current;
    };

    const seen = new Set<string>();
    for (const usage of collectQueryUsages(file)) {
      // The helper must genuinely access THIS table: a direct `.from(table)`, or
      // an RPC that encapsulates it (get_visible_<table>, or a name referencing
      // the table). A file merely mentioning the table no longer qualifies.
      const valueLower = usage.value.toLowerCase();
      const isFromTable = usage.kind === "from" && usage.value === tableName;
      const isRpcForTable = usage.kind === "rpc" &&
        (valueLower === visibleRpc || valueLower.includes(tableLower));
      if (!isFromTable && !isRpcForTable) continue;

      const fn = enclosingFunction(usage.line);
      if (!fn || !HELPER_FETCHER_NAME_RE.test(fn.name) || seen.has(fn.name)) continue;
      seen.add(fn.name);
      candidates.push({ path: file.path, line: fn.line, functionName: fn.name, usesRpc: isRpcForTable });
    }
  }

  return candidates;
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
