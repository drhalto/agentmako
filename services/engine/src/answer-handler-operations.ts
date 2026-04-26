import type { AnswerResult } from "@mako-ai/contracts";
import type { AnswerEngineQueryKind } from "./query-plans.js";
import type { FileDetailRecord } from "@mako-ai/store";
import {
  AUTH_HINT_PATTERN,
  DEPENDENCY_HINT_PATTERN,
  FEATURE_HINT_PATTERN,
  FILE_HINT_PATTERN,
  SCHEMA_HINT_PATTERN,
  type AnswerContext,
  authSchemaSeedTerms,
  buildAnswerResult,
  buildFileEvidence,
  buildFileRoles,
  buildRouteDefinitionEvidence,
  buildSchemaEvidence,
  buildSearchMatchEvidence,
  buildWeakEvidenceResult,
  collectFileDetails,
  createAction,
  createEvidenceBlock,
  formatSchemaObjectName,
  getRoutePriority,
  listPreview,
  normalizeQueryText,
  resolveFileFromQuery,
  resolveSchemaCandidates,
  resolveSchemaDetailFromQuery,
} from "./answer-handler-shared.js";

function handleRouteTrace(context: AnswerContext): AnswerResult {
  const routes = context.projectStore
    .searchRoutes(context.packet.queryText, 5)
    .sort((left, right) => getRoutePriority(right) - getRoutePriority(left));

  if (routes.length === 0) {
    return buildWeakEvidenceResult(
      context,
      `No indexed route matched "${context.packet.queryText}".`,
      {
        answerConfidence: 0.08,
        missingInformation: ["No route pattern in the current index matched this query."],
      },
    );
  }

  const bestRoute = routes[0];
  const handlerFile = context.projectStore.getFileDetail(bestRoute.filePath);
  const definitionEvidence = buildRouteDefinitionEvidence(bestRoute);
  const definitionFilePath =
    bestRoute.metadata != null && typeof bestRoute.metadata.definitionFilePath === "string"
      ? bestRoute.metadata.definitionFilePath
      : null;

  const evidence = [
    createEvidenceBlock(
      "route",
      `Route: ${bestRoute.method ?? "ANY"} ${bestRoute.pattern}`,
      bestRoute.routeKey,
      `${bestRoute.method ?? "ANY"} ${bestRoute.pattern} is handled by ${bestRoute.filePath}${bestRoute.handlerName ? ` (${bestRoute.handlerName})` : ""}.`,
      {
        filePath: bestRoute.filePath,
        score: 0.95,
        metadata: {
          routeKey: bestRoute.routeKey,
          framework: bestRoute.framework,
          handlerName: bestRoute.handlerName ?? null,
          isApi: bestRoute.isApi ?? null,
        },
      },
    ),
    ...(definitionEvidence ? [definitionEvidence] : []),
    ...(handlerFile ? buildFileEvidence(handlerFile) : []),
  ];

  const answer = handlerFile
    ? `The best route match is ${bestRoute.method ?? "ANY"} ${bestRoute.pattern} in ${bestRoute.filePath}.${definitionFilePath && definitionFilePath !== bestRoute.filePath ? ` The route is declared in ${definitionFilePath}.` : ""} The handler file has ${handlerFile.outboundImports.length} outbound imports and ${handlerFile.inboundImports.length} inbound dependents, which gives you the immediate execution neighborhood.`
    : `The best route match is ${bestRoute.method ?? "ANY"} ${bestRoute.pattern} in ${bestRoute.filePath}.${definitionFilePath && definitionFilePath !== bestRoute.filePath ? ` The route is declared in ${definitionFilePath}.` : ""} The handler file itself could not be expanded beyond the route record.`;

  return buildAnswerResult(context, {
    answer,
    answerConfidence: handlerFile ? 0.84 : 0.68,
    evidence,
    evidenceStatus: handlerFile ? "complete" : "partial",
    missingInformation: handlerFile ? [] : ["The route was found, but the handler file could not be expanded."],
    stalenessFlags: [],
    candidateActions: [
      createAction("Open handler file", `Inspect ${bestRoute.filePath} for the route implementation.`),
      createAction("Trace dependencies", `Review the imports and dependents around ${bestRoute.filePath}.`),
    ],
  });
}

function handleFileHealth(context: AnswerContext): AnswerResult {
  const file = resolveFileFromQuery(context.projectStore, context.packet.queryText);

  if (!file) {
    const matches = context.projectStore.searchFiles(context.packet.queryText, 4);
    return buildWeakEvidenceResult(
      context,
      matches.length > 0
        ? `I could not resolve an exact file for "${context.packet.queryText}", but the strongest indexed matches are ${matches.map((match) => match.path).join(", ")}.`
        : `No indexed file matched "${context.packet.queryText}".`,
      {
        answerConfidence: matches.length > 0 ? 0.24 : 0.1,
        evidence: matches.map((match) => buildSearchMatchEvidence(`Related File: ${match.path}`, match)),
        missingInformation: ["No exact file match was found in the current index."],
        candidateActions: matches.length > 0
          ? [createAction("Review closest file", `Inspect ${matches[0].path} for the nearest indexed match.`)]
          : [],
      },
    );
  }

  const evidence = buildFileEvidence(file);
  const roles = buildFileRoles(context, file);
  const risks: string[] = [];
  const positives: string[] = [];
  const missingInternalImports = file.outboundImports.filter(
    (edge) => !edge.targetExists && (edge.importKind === "relative" || edge.importKind === "re-export"),
  );

  if (roles.length > 0) {
    positives.push(`acts as ${listPreview(roles, 4)}`);
  }

  if (missingInternalImports.length > 0) {
    risks.push(`${missingInternalImports.length} unresolved internal import${missingInternalImports.length === 1 ? "" : "s"}`);
  }

  if (file.isGenerated) {
    risks.push("is generated");
  }

  if (file.routes.length > 0) {
    positives.push(`contains ${file.routes.length} route${file.routes.length === 1 ? "" : "s"}`);
  }

  const answerParts = [
    `${file.path} has ${file.lineCount} lines`,
    `${file.symbols.length} exported symbol${file.symbols.length === 1 ? "" : "s"}`,
    `${file.outboundImports.length} outbound import${file.outboundImports.length === 1 ? "" : "s"}`,
    `${file.inboundImports.length} inbound dependent${file.inboundImports.length === 1 ? "" : "s"}`,
    positives.length > 0 ? `and ${positives.join(", ")}` : null,
  ].filter((part): part is string => part != null);

  return buildAnswerResult(context, {
    answer: `${answerParts.join(", ")}.${risks.length > 0 ? ` Watch for: ${risks.join(", ")}.` : ""}`,
    answerConfidence: 0.86,
    evidence,
    evidenceStatus: "complete",
    missingInformation: [],
    stalenessFlags: file.isGenerated ? ["The file is generated; manual edits may be overwritten."] : [],
    candidateActions: [
      createAction("Open file", `Inspect ${file.path}.`),
      ...(missingInternalImports.length > 0
        ? [createAction("Resolve missing imports", `Investigate unresolved imports in ${file.path}.`)]
        : []),
    ],
  });
}

function handleAuthPath(context: AnswerContext): AnswerResult {
  const queryText = normalizeQueryText(context.packet.queryText);
  const routeMatches = context.projectStore.searchRoutes(queryText, 3);
  const authFileCandidates = [
    ...context.profile.middlewareFiles,
    ...context.profile.serverOnlyModules.filter((filePath) => AUTH_HINT_PATTERN.test(filePath)),
    ...authSchemaSeedTerms(queryText)
      .slice(0, 6)
      .flatMap((term) => context.projectStore.searchFiles(term, 2))
      .filter((match) =>
        AUTH_HINT_PATTERN.test(match.path) ||
        context.profile.serverOnlyModules.includes(match.path) ||
        context.profile.middlewareFiles.includes(match.path),
      )
      .map((match) => match.path),
    ...routeMatches.map((route) => route.filePath),
  ];
  const authFiles = collectFileDetails(
    context.projectStore,
    Array.from(new Set(authFileCandidates)),
    5,
  );
  const authSchemaObjects = resolveSchemaCandidates(
    context.projectStore,
    queryText,
    4,
    authSchemaSeedTerms(queryText),
  );
  const evidence = [
    createEvidenceBlock(
      "document",
      "Project Auth Profile",
      context.project.projectId,
      `Support level: ${context.profile.supportLevel}. Middleware files: ${listPreview(context.profile.middlewareFiles)}. Auth guard symbols: ${listPreview(context.profile.authGuardSymbols)}. Server-only modules: ${listPreview(context.profile.serverOnlyModules, 8)}.`,
      {
        metadata: {
          framework: context.profile.framework,
          orm: context.profile.orm,
        },
      },
    ),
  ];

  if (routeMatches[0]) {
    evidence.push(
      createEvidenceBlock(
        "route",
        `Likely Auth Route: ${routeMatches[0].method ?? "ANY"} ${routeMatches[0].pattern}`,
        routeMatches[0].routeKey,
        `${routeMatches[0].method ?? "ANY"} ${routeMatches[0].pattern} -> ${routeMatches[0].filePath}`,
        {
          filePath: routeMatches[0].filePath,
          score: 0.86,
        },
      ),
    );

    const definitionEvidence = buildRouteDefinitionEvidence(routeMatches[0]);
    if (definitionEvidence) {
      evidence.push(definitionEvidence);
    }
  }

  for (const file of authFiles.slice(0, 3)) {
    evidence.push(...buildFileEvidence(file).slice(0, 2));
  }

  for (const schemaObject of authSchemaObjects.slice(0, 3)) {
    evidence.push(
      createEvidenceBlock(
        "schema",
        `Auth-related Schema: ${formatSchemaObjectName(schemaObject)}`,
        `${schemaObject.schemaName}.${schemaObject.objectName}`,
        `${formatSchemaObjectName(schemaObject)}${schemaObject.dataType ? ` (${schemaObject.dataType})` : ""}.`,
        {
          filePath:
            schemaObject.definition != null && typeof schemaObject.definition.sourceFilePath === "string"
              ? schemaObject.definition.sourceFilePath
              : undefined,
          line:
            schemaObject.definition != null && typeof schemaObject.definition.line === "number"
              ? schemaObject.definition.line
              : undefined,
          score: 0.67,
        },
      ),
    );
  }

  const likelyBoundaries = Array.from(
    new Set([...authFiles.map((file) => file.path), ...context.profile.middlewareFiles]),
  );
  const schemaNames = authSchemaObjects.map((object) => `${object.schemaName}.${object.objectName}`);
  const missingInformation: string[] = [];

  if (routeMatches.length === 0) {
    missingInformation.push("No route-specific auth entrypoint matched the query text.");
  }

  if (likelyBoundaries.length === 0 && context.profile.authGuardSymbols.length === 0) {
    missingInformation.push("No explicit auth middleware, guard file, or guard symbol was detected.");
  }

  if (schemaNames.length === 0) {
    missingInformation.push("No auth-related schema object was found in the current index.");
  }

  if (evidence.length === 0) {
    return buildWeakEvidenceResult(
      context,
      `I could not find a strong auth-related path for "${context.packet.queryText}" in the current index.`,
      {
        answerConfidence: 0.14,
        missingInformation: ["No indexed route, file, or schema surface matched this auth query strongly enough."],
      },
    );
  }

  const answer = routeMatches.length > 0 && (likelyBoundaries.length > 0 || schemaNames.length > 0)
    ? `The strongest indexed auth path for "${context.packet.queryText}" goes through ${routeMatches[0].method ?? "ANY"} ${routeMatches[0].pattern} in ${routeMatches[0].filePath}. Likely auth boundaries include ${listPreview(likelyBoundaries, 4)}${schemaNames.length > 0 ? `, with related schema objects ${listPreview(schemaNames, 4)}` : ""}. This is static repo evidence, not a runtime proof.`
    : likelyBoundaries.length > 0 || context.profile.authGuardSymbols.length > 0
      ? `I only have heuristic auth evidence for "${context.packet.queryText}": likely boundary files are ${listPreview(likelyBoundaries, 4)} and guard symbols are ${listPreview(context.profile.authGuardSymbols, 6)}. I do not have a route-level proof.`
      : `I do not have a clear indexed auth path for "${context.packet.queryText}". The current evidence is limited to broad project-profile signals.`;

  return buildAnswerResult(context, {
    answer,
    answerConfidence:
      routeMatches.length > 0 && (likelyBoundaries.length > 0 || schemaNames.length > 0)
        ? 0.74
        : likelyBoundaries.length > 0 || context.profile.authGuardSymbols.length > 0
          ? 0.48
          : 0.2,
    evidence,
    evidenceStatus: "partial",
    missingInformation,
    stalenessFlags: [],
    candidateActions: [
      ...(routeMatches.length > 0
        ? [createAction("Inspect route handler", `Review ${routeMatches[0].filePath} for the auth gate in this flow.`)]
        : []),
      ...(likelyBoundaries.length > 0
        ? [createAction("Inspect auth boundary files", `Review ${likelyBoundaries[0]} and related auth files.`)]
        : []),
      ...(schemaNames.length > 0
        ? [createAction("Inspect auth schema usage", `Review references to ${schemaNames[0]}.`)]
        : []),
    ],
  });
}

function handleSchemaUsage(context: AnswerContext): AnswerResult {
  const detail = resolveSchemaDetailFromQuery(context.projectStore, context.packet.queryText);

  if (!detail) {
    const candidates = resolveSchemaCandidates(context.projectStore, context.packet.queryText, 4);
    return buildWeakEvidenceResult(
      context,
      candidates.length > 0
        ? `I could not resolve an exact schema object for "${context.packet.queryText}", but the strongest indexed matches are ${candidates.map((candidate) => `${candidate.schemaName}.${candidate.objectName}`).join(", ")}.`
        : `No indexed schema object matched "${context.packet.queryText}".`,
      {
        answerConfidence: candidates.length > 0 ? 0.22 : 0.1,
        evidence: candidates.map((candidate) =>
          createEvidenceBlock(
            "schema",
            `Related Schema: ${candidate.schemaName}.${candidate.objectName}`,
            `${candidate.schemaName}.${candidate.objectName}`,
            `${candidate.objectType} ${candidate.schemaName}.${candidate.objectName}${candidate.dataType ? ` (${candidate.dataType})` : ""}.`,
            {
              filePath:
                candidate.definition != null && typeof candidate.definition.sourceFilePath === "string"
                  ? candidate.definition.sourceFilePath
                  : undefined,
              line:
                candidate.definition != null && typeof candidate.definition.line === "number"
                  ? candidate.definition.line
                  : undefined,
              score: 0.58,
            },
          ),
        ),
        missingInformation: ["No exact schema object match was found in the current index."],
      },
    );
  }

  const evidence = buildSchemaEvidence(detail);
  const usageFiles = collectFileDetails(
    context.projectStore,
    detail.usages.map((usage) => usage.filePath),
    4,
  );
  evidence.push(...usageFiles.flatMap((file) => buildFileEvidence(file).slice(0, 1)));

  const answer = detail.usages.length > 0
    ? `${formatSchemaObjectName(detail.object)} is used in ${listPreview(detail.usages.map((usage) => usage.filePath), 4)}.`
    : `${formatSchemaObjectName(detail.object)} is defined, but no non-definition usages were indexed.`;

  return buildAnswerResult(context, {
    answer,
    answerConfidence: detail.usages.length > 0 ? 0.82 : 0.58,
    evidence,
    evidenceStatus: detail.usages.length > 0 ? "complete" : "partial",
    missingInformation: detail.usages.length > 0 ? [] : ["No non-definition usages were indexed for this schema object."],
    stalenessFlags: [],
    candidateActions: usageFiles.length > 0
      ? [createAction("Inspect top usage", `Review ${usageFiles[0].path} for the strongest indexed usage.`)]
      : [],
  });
}

function handleDependentsQuery(context: AnswerContext, file: FileDetailRecord): AnswerResult {
  const dependentFiles = collectFileDetails(
    context.projectStore,
    file.inboundImports.map((edge) => edge.sourcePath),
    5,
  );

  const evidence = [
    ...buildFileEvidence(file),
    ...dependentFiles.flatMap((dependent) => buildFileEvidence(dependent).slice(0, 1)),
  ];

  return buildAnswerResult(context, {
    answer:
      dependentFiles.length > 0
        ? `${file.path} is used by ${listPreview(dependentFiles.map((dependent) => dependent.path), 5)}.`
        : `No indexed inbound dependents were found for ${file.path}.`,
    answerConfidence: dependentFiles.length > 0 ? 0.8 : 0.48,
    evidence,
    evidenceStatus: "complete",
    missingInformation: file.inboundImports.length > 0 ? [] : ["No indexed inbound dependents were found for this file."],
    stalenessFlags: [],
    candidateActions: dependentFiles.length > 0
      ? [createAction("Inspect top dependent", `Review ${dependentFiles[0].path} to see how ${file.path} is consumed.`)]
      : [createAction("Confirm expected callers", `If ${file.path} should have callers, re-run indexing after broader repo changes.`)],
  });
}

function handleFreeForm(context: AnswerContext): AnswerResult {
  const queryText = normalizeQueryText(context.packet.queryText);
  const queryLower = queryText.toLowerCase();
  const resolvedFile = resolveFileFromQuery(context.projectStore, queryText);
  const routes = context.projectStore.searchRoutes(queryText, 3);
  const schemaDetail = resolveSchemaDetailFromQuery(context.projectStore, queryText);

  if (AUTH_HINT_PATTERN.test(queryLower)) {
    return handleAuthPath(context);
  }

  if (resolvedFile && DEPENDENCY_HINT_PATTERN.test(queryLower)) {
    return handleDependentsQuery(context, resolvedFile);
  }

  if ((queryText.includes("/") || routes.length > 0) && routes.length > 0) {
    return handleRouteTrace(context);
  }

  if (schemaDetail != null && (SCHEMA_HINT_PATTERN.test(queryLower) || resolvedFile == null)) {
    return handleSchemaUsage(context);
  }

  if (resolvedFile != null && (FILE_HINT_PATTERN.test(queryLower) || /^[\w./\\-]+\.[a-z0-9]+$/i.test(queryText))) {
    return handleFileHealth(context);
  }

  const schemaCandidates = resolveSchemaCandidates(context.projectStore, queryText, 3);
  const fileMatches = context.projectStore.searchFiles(queryText, FEATURE_HINT_PATTERN.test(queryLower) ? 6 : 4);
  const evidence = [
    ...routes.map((route) =>
      createEvidenceBlock(
        "route",
        `Relevant Route: ${route.method ?? "ANY"} ${route.pattern}`,
        route.routeKey,
        `${route.method ?? "ANY"} ${route.pattern} -> ${route.filePath}`,
        { filePath: route.filePath, score: 0.7 },
      ),
    ),
    ...schemaCandidates.map((candidate) =>
      createEvidenceBlock(
        "schema",
        `Relevant Schema: ${formatSchemaObjectName(candidate)}`,
        `${candidate.schemaName}.${candidate.objectName}`,
        `${formatSchemaObjectName(candidate)}${candidate.dataType ? ` (${candidate.dataType})` : ""}.`,
        {
          filePath:
            candidate.definition != null && typeof candidate.definition.sourceFilePath === "string"
              ? candidate.definition.sourceFilePath
              : undefined,
          line:
            candidate.definition != null && typeof candidate.definition.line === "number"
              ? candidate.definition.line
              : undefined,
          score: 0.66,
        },
      ),
    ),
    ...fileMatches.map((match) => buildSearchMatchEvidence(`Relevant File: ${match.path}`, match)),
  ];

  if (evidence.length === 0) {
    return buildWeakEvidenceResult(context, `I could not find a strong indexed match for "${context.packet.queryText}".`, {
      answerConfidence: 0.1,
      evidence: [],
      missingInformation: ["The current index did not produce a strong lexical or structural match for this query."],
      candidateActions: [],
    });
  }

  const answer = [
    routes.length > 0 ? `Relevant routes: ${listPreview(routes.map((route) => `${route.method ?? "ANY"} ${route.pattern}`), 3)}.` : undefined,
    fileMatches.length > 0 ? `Relevant files: ${listPreview(fileMatches.map((match) => match.path), 5)}.` : undefined,
    schemaCandidates.length > 0 ? `Relevant schema objects: ${listPreview(schemaCandidates.map((candidate) => `${candidate.schemaName}.${candidate.objectName}`), 4)}.` : undefined,
  ]
    .filter((part): part is string => part != null)
    .join(" ");

  return buildAnswerResult(context, {
    answer,
    answerConfidence: routes.length > 0 || schemaCandidates.length > 0 ? 0.54 : 0.4,
    evidence,
    evidenceStatus: "partial",
    missingInformation: [],
    stalenessFlags: [],
    candidateActions: [
      ...(fileMatches.length > 0 ? [createAction("Inspect top file match", `Review ${fileMatches[0].path}.`)] : []),
      ...(routes.length > 0 ? [createAction("Inspect top route match", `Review ${routes[0].filePath}.`)] : []),
      ...(schemaCandidates.length > 0 ? [createAction("Inspect top schema match", `Review ${schemaCandidates[0].schemaName}.${schemaCandidates[0].objectName}.`)] : []),
    ],
  });
}

export const HANDLERS: Record<AnswerEngineQueryKind, (context: AnswerContext) => AnswerResult> = {
  route_trace: handleRouteTrace,
  schema_usage: handleSchemaUsage,
  auth_path: handleAuthPath,
  file_health: handleFileHealth,
  free_form: handleFreeForm,
};
