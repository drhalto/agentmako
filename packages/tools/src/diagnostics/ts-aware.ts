import type { AnswerSurfaceIssue } from "@mako-ai/contracts";
import type { ProjectStore } from "@mako-ai/store";
import {
  buildSurfaceIssue,
  canonicalizeFieldName,
  classifyIdentityKind,
  collectCallSites,
  collectFunctionParameters,
  collectImportBindings,
  collectPropertyOccurrences,
  dedupeIssuesByMatchBasedId,
  formatEvidenceRef,
  isCamelCase,
  isSnakeCase,
  readDiagnosticFiles,
  type DiagnosticAstFile,
  type FilePropertyOccurrence,
} from "./common.js";

export interface TsAwareDiagnosticsInput {
  projectStore: ProjectStore;
  focusFiles: string[];
}

interface FieldVariantGroup {
  canonicalKey: string;
  occurrences: FilePropertyOccurrence[];
}

export function runTsAwareAlignmentDiagnostics(
  input: TsAwareDiagnosticsInput,
): AnswerSurfaceIssue[] {
  const files = readDiagnosticFiles(input.projectStore, input.focusFiles);
  if (files.length === 0) {
    return [];
  }

  return dedupeIssuesByMatchBasedId([
    ...findFieldShapeDrift(files),
    ...findIdentityBoundaryMismatch(files, input.projectStore),
  ]);
}

function findFieldShapeDrift(files: DiagnosticAstFile[]): AnswerSurfaceIssue[] {
  const groups = new Map<string, FieldVariantGroup>();

  for (const file of files) {
    for (const occurrence of collectPropertyOccurrences(file)) {
      const canonicalKey = canonicalizeFieldName(occurrence.propertyName);
      const group = groups.get(canonicalKey) ?? {
        canonicalKey,
        occurrences: [],
      };
      group.occurrences.push(occurrence);
      groups.set(canonicalKey, group);
    }
  }

  const issues: AnswerSurfaceIssue[] = [];
  for (const group of groups.values()) {
    const variants = [...new Set(group.occurrences.map((occurrence) => occurrence.propertyName))];
    if (variants.length < 2) {
      continue;
    }

    const hasShapeVariant =
      variants.some((variant) => isSnakeCase(variant)) &&
      variants.some((variant) => isCamelCase(variant));
    if (!hasShapeVariant) {
      continue;
    }

    const declaration = group.occurrences.find((occurrence) =>
      occurrence.ownerKind === "interface_property" ||
      occurrence.ownerKind === "type_property",
    );
    const returned = group.occurrences.find((occurrence) => occurrence.ownerKind === "returned_object_property");
    if (!declaration || !returned || declaration.propertyName === returned.propertyName) {
      continue;
    }

    issues.push(
      buildSurfaceIssue({
        category: "producer_consumer_drift",
        code: "producer.field_shape_drift",
        message:
          `The same data surface is spelled both \`${declaration.propertyName}\` and \`${returned.propertyName}\` across producer/consumer boundaries.`,
        severity: "high",
        confidence: "confirmed",
        path: returned.path,
        line: returned.line,
        producerPath: returned.path,
        consumerPath: declaration.path,
        evidenceRefs: [
          formatEvidenceRef(declaration.path, declaration.line),
          formatEvidenceRef(returned.path, returned.line),
        ],
        matchKey: {
          canonicalKey: group.canonicalKey,
          declarationPath: declaration.path,
          returnedPath: returned.path,
          declarationVariant: declaration.propertyName,
          returnedVariant: returned.propertyName,
        },
        codeFingerprint: {
          declaration,
          returned,
        },
        metadata: {
          variants,
          declarationOwner: declaration.ownerName ?? null,
          returnedOwner: returned.ownerName ?? null,
        },
      }),
    );
  }

  return issues;
}

function findIdentityBoundaryMismatch(
  files: DiagnosticAstFile[],
  projectStore: ProjectStore,
): AnswerSurfaceIssue[] {
  const issues: AnswerSurfaceIssue[] = [];
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const parameterIndex = new Map<string, ReturnType<typeof collectFunctionParameters>[number]>();

  for (const file of files) {
    for (const parameterRecord of collectFunctionParameters(file)) {
      parameterIndex.set(`${file.path}:${parameterRecord.functionName}`, parameterRecord);
    }
  }

  for (const file of files) {
    const importBindings = collectImportBindings(file, projectStore);
    const bindingMap = new Map(importBindings.map((binding) => [binding.localName, binding]));
    for (const callSite of collectCallSites(file)) {
      const binding = bindingMap.get(callSite.calleeName);
      if (!binding?.targetPath) {
        continue;
      }

      let parameterRecord = parameterIndex.get(`${binding.targetPath}:${binding.importedName}`);
      if (!parameterRecord) {
        const targetFile = filesByPath.get(binding.targetPath) ?? readDiagnosticFiles(projectStore, [binding.targetPath])[0];
        if (!targetFile) continue;
        filesByPath.set(binding.targetPath, targetFile);
        for (const record of collectFunctionParameters(targetFile)) {
          parameterIndex.set(`${binding.targetPath}:${record.functionName}`, record);
        }
        parameterRecord = parameterIndex.get(`${binding.targetPath}:${binding.importedName}`);
      }

      if (!parameterRecord) {
        continue;
      }

      parameterRecord.parameterNames.forEach((parameterName, index) => {
        const expectedIdentity = classifyIdentityKind(parameterName);
        const actualIdentity = callSite.argIdentityKinds[index] ?? null;
        if (!expectedIdentity || !actualIdentity || expectedIdentity === actualIdentity) {
          return;
        }

        issues.push(
          buildSurfaceIssue({
            category: "identity_key_mismatch",
            code: "identity.boundary_mismatch",
            message:
              `Callers pass a ${actualIdentity}-scoped identity into \`${binding.importedName}\`, but parameter \`${parameterName}\` expects ${expectedIdentity}-scoped input.`,
            severity: expectedIdentity === "tenant" ? "critical" : "high",
            confidence: "confirmed",
            path: file.path,
            line: callSite.line,
            producerPath: binding.targetPath,
            consumerPath: file.path,
            evidenceRefs: [
              formatEvidenceRef(file.path, callSite.line),
              formatEvidenceRef(parameterRecord.path, parameterRecord.line),
            ],
            matchKey: {
              callee: binding.importedName,
              targetPath: binding.targetPath,
              parameterName,
              expectedIdentity,
              actualIdentity,
            },
            codeFingerprint: {
              callSite,
              parameterRecord,
            },
            metadata: {
              argumentText: callSite.args[index] ?? null,
            },
          }),
        );
      });
    }
  }

  return issues;
}
