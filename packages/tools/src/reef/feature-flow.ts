import type {
  FactFreshness,
  JsonValue,
  ProjectFact,
  ProjectFinding,
  ReefAskFeatureFlowDatabaseObjectKind,
  ReefAskFeatureFlowDatabaseObjectSummary,
  ReefAskFeatureFlowFileRole,
  ReefAskFeatureFlowFindingSummary,
  ReefAskFeatureFlowLinkKind,
  ReefAskFeatureFlowLinkSummary,
  ReefAskFeatureFlowRouteSummary,
  ReefAskFeatureFlowSummary,
} from "@mako-ai/contracts";
import type {
  FileImportLink,
  FileSummaryRecord,
  ProjectStore,
  ResolvedRouteRecord,
  ResolvedSchemaObjectRecord,
  SchemaUsageMatch,
  SymbolRecord,
} from "@mako-ai/store";

export interface ReefFeatureFlowCalculationInput {
  projectStore: Pick<
    ProjectStore,
    | "getSchemaTableSnapshot"
    | "listAllImportEdges"
    | "listFiles"
    | "listFunctionTableRefs"
    | "listRoutes"
    | "listSchemaObjects"
    | "listSchemaUsages"
    | "listSymbolsForFile"
    | "queryReefFacts"
    | "queryReefFindings"
  >;
  projectId: string;
  fileSeeds: string[];
  routeSeeds: string[];
  databaseObjectSeeds: string[];
  symbolSeeds: string[];
  textSeeds: string[];
  importDepth: number;
  limit: number;
}

interface FileScore {
  file: FileSummaryRecord;
  score: number;
  reasons: string[];
}

interface SchemaUsageEntry {
  object: ResolvedSchemaObjectRecord;
  usage: SchemaUsageMatch;
}

interface DatabaseObjectAccumulator {
  kind: ReefAskFeatureFlowDatabaseObjectKind;
  schemaName?: string;
  objectName: string;
  tableName?: string;
  filePaths: Set<string>;
  reasons: string[];
  freshness?: FactFreshness;
}

interface LinkAccumulator {
  from: string;
  to: string;
  kind: ReefAskFeatureFlowLinkKind;
  reason: string;
  confidence: number;
}

const DEFAULT_IMPORT_DEPTH = 1;
const MAX_IMPORT_DEPTH = 2;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 80;
const FINDING_LIMIT = 500;
const DB_FACT_SCAN_LIMIT = 3000;
const DATABASE_FACT_KINDS = [
  "db_table",
  "db_column",
  "db_index",
  "db_foreign_key",
  "db_rls_policy",
  "db_trigger",
  "db_rpc",
  "db_view",
  "db_enum",
  "db_usage",
  "db_rpc_table_ref",
  "db_scheduled_job",
] as const;

export function calculateReefFeatureFlow(
  input: ReefFeatureFlowCalculationInput,
): ReefAskFeatureFlowSummary {
  const limit = normalizeLimit(input.limit);
  const importDepth = normalizeImportDepth(input.importDepth);
  const warnings: string[] = [];
  const seedKinds = new Set<string>();
  const files = input.projectStore.listFiles();
  const fileByPath = new Map(files.map((file) => [normalizePath(file.path), file] as const));
  const imports = input.projectStore.listAllImportEdges();
  const routes = input.projectStore.listRoutes();
  const routesByFile = groupBy(routes, (route) => normalizePath(route.filePath));
  const outboundImports = groupBy(imports, (edge) => normalizePath(edge.sourcePath));
  const inboundImports = groupBy(imports, (edge) => normalizePath(edge.targetPath));
  const schemaObjects = input.projectStore.listSchemaObjects();
  const schemaUsageEntries = collectSchemaUsageEntries(input.projectStore, schemaObjects);
  const schemaUsagesByFile = groupBy(schemaUsageEntries, (entry) => normalizePath(entry.usage.filePath));
  const dbFacts = collectDatabaseFacts({
    projectStore: input.projectStore,
    projectId: input.projectId,
    warnings,
  });

  const scores = new Map<string, FileScore>();
  const seedFilePaths = new Set<string>();
  const addFileScore = (filePath: string, score: number, reason: string, seed = false): void => {
    const file = resolveFile(filePath, fileByPath, files);
    if (!file) {
      if (seed) warnings.push(`Feature flow seed file was not indexed: ${filePath}.`);
      return;
    }
    const key = normalizePath(file.path);
    const current = scores.get(key) ?? { file, score: 0, reasons: [] };
    current.score += score;
    addReason(current.reasons, reason);
    scores.set(key, current);
    if (seed) seedFilePaths.add(key);
  };

  for (const fileSeed of unique(input.fileSeeds.map(normalizePath))) {
    seedKinds.add("file");
    addFileScore(fileSeed, 120, "explicit file focus", true);
  }

  for (const routeSeed of unique(input.routeSeeds)) {
    seedKinds.add("route");
    const matchedRoutes = matchRoutes(routes, routeSeed);
    if (matchedRoutes.length === 0) {
      warnings.push(`Feature flow route seed did not match an indexed route: ${routeSeed}.`);
    }
    for (const route of matchedRoutes) {
      addFileScore(route.filePath, 100, `route focus ${routeLabel(route)}`, true);
    }
  }

  for (const symbolSeed of unique(input.symbolSeeds)) {
    seedKinds.add("symbol");
    let matchedSymbol = false;
    for (const file of files) {
      const symbols = input.projectStore.listSymbolsForFile(file.path);
      if (symbols.some((symbol) => symbolMatchesSeed(symbol, symbolSeed))) {
        matchedSymbol = true;
        addFileScore(file.path, 80, `symbol focus ${symbolSeed}`, true);
      }
    }
    if (!matchedSymbol) {
      warnings.push(`Feature flow symbol seed did not match an indexed symbol: ${symbolSeed}.`);
    }
  }

  const databaseSeedEntries = unique(input.databaseObjectSeeds)
    .map((raw) => ({ raw, normalized: normalizeDatabaseSeed(raw) }))
    .filter((entry) => entry.normalized.length > 0)
    .filter((entry, index, entries) =>
      entries.findIndex((candidate) => candidate.normalized === entry.normalized) === index
    );
  const databaseSeeds = databaseSeedEntries.map((entry) => entry.normalized);
  for (const { raw, normalized: seed } of databaseSeedEntries) {
    seedKinds.add("database_object");
    const matchedObjects = schemaObjects.filter((object) => schemaObjectMatchesSeed(object, seed));
    const matchedFacts = dbFacts.filter((fact) => factMatchesDatabaseSeed(fact, seed));
    let matchedFileAnchor = false;
    for (const object of matchedObjects) {
      for (const usage of input.projectStore.listSchemaUsages(object.objectId)) {
        matchedFileAnchor = true;
        addFileScore(usage.filePath, 90, `uses database object ${qualifiedObjectName(object)}`, true);
      }
    }
    for (const fact of matchedFacts) {
      const filePath = jsonString(fact.data?.filePath);
      if (filePath) {
        matchedFileAnchor = true;
        addFileScore(filePath, 90, `uses database fact ${seed}`, true);
      }
    }
    if (matchedObjects.length === 0 && matchedFacts.length === 0) {
      warnings.push(`Feature flow database object seed did not match indexed schema objects or database facts: ${raw}.`);
    } else if (!matchedFileAnchor) {
      warnings.push(`Feature flow database object seed did not resolve to indexed code usage: ${raw}.`);
    }
  }

  for (const term of unique(input.textSeeds.map((value) => value.toLowerCase()).filter((value) => value.length >= 3))) {
    seedKinds.add("text");
    for (const file of files) {
      if (file.path.toLowerCase().includes(term)) {
        addFileScore(file.path, 28, `path matches query term ${term}`);
      }
    }
    for (const route of routes) {
      if (routeText(route).toLowerCase().includes(term)) {
        addFileScore(route.filePath, 28, `route matches query term ${term}`);
      }
    }
    for (const object of schemaObjects) {
      if (schemaObjectText(object).toLowerCase().includes(term)) {
        for (const usage of input.projectStore.listSchemaUsages(object.objectId)) {
          addFileScore(usage.filePath, 26, `database object matches query term ${term}`);
        }
      }
    }
  }

  expandImportNeighborhood({
    seedFilePaths,
    scores,
    outboundImports,
    inboundImports,
    addFileScore,
    depth: importDepth,
  });

  if (scores.size === 0) {
    warnings.push("Feature flow found no indexed file anchors; pass focusFiles, focusRoutes, focusSymbols, or focusDatabaseObjects for a tighter calculation.");
  }

  const allScoredFiles = [...scores.values()].sort(compareFileScores);
  const returnedFileScores = allScoredFiles.slice(0, limit);
  const returnedFileSet = new Set(returnedFileScores.map((score) => normalizePath(score.file.path)));
  const includedSchemaUsages = schemaUsageEntries.filter((entry) =>
    returnedFileSet.has(normalizePath(entry.usage.filePath)) ||
    databaseSeeds.some((seed) => schemaObjectMatchesSeed(entry.object, seed))
  );
  const includedTables = collectIncludedTables(includedSchemaUsages, databaseSeeds, dbFacts);
  const includedRpcs = collectIncludedRpcs(includedSchemaUsages, databaseSeeds, dbFacts);

  const databaseObjects = collectFeatureDatabaseObjects({
    projectStore: input.projectStore,
    dbFacts,
    includedSchemaUsages,
    includedTables,
    includedRpcs,
    databaseSeeds,
  });
  const findings = collectFeatureFindings({
    projectStore: input.projectStore,
    projectId: input.projectId,
    returnedFileSet,
    limit,
  });
  const routesOut = collectFeatureRoutes(routes, returnedFileSet);
  const links = collectFeatureLinks({
    imports,
    routes: routesOut,
    schemaUsages: includedSchemaUsages,
    databaseObjects,
    findings,
    returnedFileSet,
    includedTables,
    projectStore: input.projectStore,
  });

  const fileSummaries = returnedFileScores.map((score) =>
    summarizeFile({
      score,
      routesByFile,
      outboundImports,
      inboundImports,
      schemaUsagesByFile,
      findings,
    })
  );

  const returnedDatabaseObjects = databaseObjects.slice(0, limit);
  const returnedLinks = links.slice(0, limit * 3);
  const returnedFindings = findings.slice(0, Math.min(limit, 12));
  const truncated = allScoredFiles.length > fileSummaries.length ||
    routesOut.length > limit ||
    databaseObjects.length > returnedDatabaseObjects.length ||
    findings.length > returnedFindings.length ||
    links.length > returnedLinks.length;

  return {
    seedCount: unique([
      ...input.fileSeeds,
      ...input.routeSeeds,
      ...input.databaseObjectSeeds,
      ...input.symbolSeeds,
      ...input.textSeeds,
    ]).length,
    fileCount: allScoredFiles.length,
    routeCount: routesOut.length,
    databaseObjectCount: databaseObjects.length,
    findingCount: findings.length,
    linkCount: links.length,
    files: fileSummaries,
    routes: routesOut.slice(0, limit),
    databaseObjects: returnedDatabaseObjects,
    findings: returnedFindings,
    links: returnedLinks,
    coverage: {
      importDepth,
      seedKinds: [...seedKinds].sort(),
      databaseEvidenceKinds: unique(dbFacts.map((fact) => fact.kind)).sort(),
      findingCount: findings.length,
      staleDatabaseObjectCount: databaseObjects.filter((object) => object.freshness?.state && object.freshness.state !== "fresh").length,
    },
    truncated,
    warnings,
  };
}

export function reefFeatureFlowToJson(value: ReefAskFeatureFlowSummary): JsonValue {
  return value as unknown as JsonValue;
}

export function reefFeatureFlowFromJson(value: JsonValue): ReefAskFeatureFlowSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<ReefAskFeatureFlowSummary>;
  if (
    typeof record.seedCount !== "number" ||
    typeof record.fileCount !== "number" ||
    typeof record.routeCount !== "number" ||
    typeof record.databaseObjectCount !== "number" ||
    typeof record.findingCount !== "number" ||
    typeof record.linkCount !== "number" ||
    !Array.isArray(record.files) ||
    !Array.isArray(record.routes) ||
    !Array.isArray(record.databaseObjects) ||
    !Array.isArray(record.findings) ||
    !Array.isArray(record.links) ||
    !record.coverage ||
    typeof record.coverage !== "object" ||
    typeof record.truncated !== "boolean" ||
    !Array.isArray(record.warnings)
  ) {
    return undefined;
  }
  return record as ReefAskFeatureFlowSummary;
}

function collectDatabaseFacts(args: {
  projectStore: Pick<ProjectStore, "queryReefFacts">;
  projectId: string;
  warnings: string[];
}): ProjectFact[] {
  const facts: ProjectFact[] = [];
  for (const kind of DATABASE_FACT_KINDS) {
    const rows = args.projectStore.queryReefFacts({
      projectId: args.projectId,
      kind,
      limit: DB_FACT_SCAN_LIMIT,
    });
    if (rows.length >= DB_FACT_SCAN_LIMIT) {
      args.warnings.push(`Feature flow scanned the first ${DB_FACT_SCAN_LIMIT} ${kind} fact(s); database edges may be incomplete.`);
    }
    facts.push(...rows);
  }
  return facts;
}

function collectSchemaUsageEntries(
  projectStore: Pick<ProjectStore, "listSchemaUsages">,
  schemaObjects: readonly ResolvedSchemaObjectRecord[],
): SchemaUsageEntry[] {
  return schemaObjects.flatMap((object) =>
    projectStore.listSchemaUsages(object.objectId).map((usage) => ({ object, usage }))
  );
}

function expandImportNeighborhood(args: {
  seedFilePaths: ReadonlySet<string>;
  scores: Map<string, FileScore>;
  outboundImports: Map<string, FileImportLink[]>;
  inboundImports: Map<string, FileImportLink[]>;
  addFileScore: (filePath: string, score: number, reason: string) => void;
  depth: number;
}): void {
  let frontier = new Set([...args.seedFilePaths]);
  const visited = new Set(frontier);
  for (let depth = 1; depth <= args.depth && frontier.size > 0; depth += 1) {
    const next = new Set<string>();
    for (const filePath of frontier) {
      for (const edge of args.outboundImports.get(filePath) ?? []) {
        const target = normalizePath(edge.targetPath);
        args.addFileScore(target, Math.max(8, 24 - depth * 6), `import dependency from ${edge.sourcePath}`);
        if (!visited.has(target)) {
          visited.add(target);
          next.add(target);
        }
      }
      for (const edge of args.inboundImports.get(filePath) ?? []) {
        const source = normalizePath(edge.sourcePath);
        args.addFileScore(source, Math.max(8, 22 - depth * 6), `dependent importing ${edge.targetPath}`);
        if (!visited.has(source)) {
          visited.add(source);
          next.add(source);
        }
      }
    }
    frontier = next;
  }
}

function collectIncludedTables(
  usages: readonly SchemaUsageEntry[],
  databaseSeeds: readonly string[],
  facts: readonly ProjectFact[],
): Set<string> {
  const tables = new Set<string>();
  for (const entry of usages) {
    const tableName = entry.object.objectType === "table"
      ? entry.object.objectName
      : entry.object.parentObjectName;
    if (tableName) tables.add(databaseKey("table", entry.object.schemaName, tableName));
  }
  for (const seed of databaseSeeds) {
    for (const fact of facts) {
      if (!factMatchesDatabaseSeed(fact, seed)) continue;
      const schemaName = jsonString(fact.data?.schemaName) ?? factSchemaName(fact);
      const tableName = jsonString(fact.data?.tableName) ?? tableNameFromFactObject(fact);
      if (schemaName && tableName) tables.add(databaseKey("table", schemaName, tableName));
    }
  }
  return tables;
}

function collectIncludedRpcs(
  usages: readonly SchemaUsageEntry[],
  databaseSeeds: readonly string[],
  facts: readonly ProjectFact[],
): Set<string> {
  const rpcs = new Set<string>();
  for (const entry of usages) {
    if (entry.object.objectType === "rpc") {
      rpcs.add(databaseKey("rpc", entry.object.schemaName, entry.object.objectName));
    }
  }
  for (const seed of databaseSeeds) {
    for (const fact of facts) {
      if (!factMatchesDatabaseSeed(fact, seed)) continue;
      const schemaName = jsonString(fact.data?.schemaName) ?? factSchemaName(fact);
      const rpcName = jsonString(fact.data?.rpcName);
      if (schemaName && rpcName) rpcs.add(databaseKey("rpc", schemaName, rpcName));
    }
  }
  return rpcs;
}

function collectFeatureDatabaseObjects(args: {
  projectStore: Pick<ProjectStore, "getSchemaTableSnapshot" | "listFunctionTableRefs">;
  dbFacts: readonly ProjectFact[];
  includedSchemaUsages: readonly SchemaUsageEntry[];
  includedTables: ReadonlySet<string>;
  includedRpcs: ReadonlySet<string>;
  databaseSeeds: readonly string[];
}): ReefAskFeatureFlowDatabaseObjectSummary[] {
  const objects = new Map<string, DatabaseObjectAccumulator>();
  const addObject = (object: DatabaseObjectAccumulator): void => {
    const key = databaseKey(object.kind, object.schemaName, object.objectName);
    const current = objects.get(key) ?? {
      kind: object.kind,
      ...(object.schemaName ? { schemaName: object.schemaName } : {}),
      objectName: object.objectName,
      ...(object.tableName ? { tableName: object.tableName } : {}),
      filePaths: new Set<string>(),
      reasons: [],
      ...(object.freshness ? { freshness: object.freshness } : {}),
    };
    for (const filePath of object.filePaths) current.filePaths.add(filePath);
    for (const reason of object.reasons) addReason(current.reasons, reason);
    if (!current.freshness && object.freshness) current.freshness = object.freshness;
    objects.set(key, current);
  };

  for (const entry of args.includedSchemaUsages) {
    addObject({
      kind: schemaKindToFeatureKind(entry.object.objectType),
      schemaName: entry.object.schemaName,
      objectName: entry.object.objectName,
      ...(entry.object.parentObjectName ? { tableName: entry.object.parentObjectName } : {}),
      filePaths: new Set([entry.usage.filePath]),
      reasons: [`${entry.usage.usageKind} usage in ${entry.usage.filePath}`],
    });
  }

  for (const fact of args.dbFacts) {
    const object = databaseObjectFromFact(fact);
    if (!object) continue;
    const filePath = jsonString(fact.data?.filePath);
    const tableKey = object.tableName
      ? databaseKey("table", object.schemaName, object.tableName)
      : object.kind === "table"
        ? databaseKey("table", object.schemaName, object.objectName)
        : undefined;
    const rpcKey = object.kind === "rpc" || object.kind === "rpc_table_ref"
      ? databaseKey("rpc", object.schemaName, object.objectName.split("(")[0] ?? object.objectName)
      : undefined;
    const directlySeeded = args.databaseSeeds.some((seed) => factMatchesDatabaseSeed(fact, seed));
    if (
      directlySeeded ||
      (filePath && args.includedSchemaUsages.some((entry) => normalizePath(entry.usage.filePath) === normalizePath(filePath))) ||
      (tableKey && args.includedTables.has(tableKey)) ||
      (rpcKey && args.includedRpcs.has(rpcKey))
    ) {
      addObject({
        ...object,
        filePaths: new Set(filePath ? [filePath] : []),
        reasons: [factReason(fact)],
        freshness: fact.freshness,
      });
    }
  }

  for (const tableKey of args.includedTables) {
    const parsed = parseDatabaseKey(tableKey);
    if (!parsed) continue;
    const table = args.projectStore.getSchemaTableSnapshot(parsed.schemaName ?? "public", parsed.objectName);
    for (const policy of table?.rls?.policies ?? []) {
      addObject({
        kind: "rls_policy",
        schemaName: parsed.schemaName,
        objectName: `${parsed.objectName}.${policy.name}`,
        tableName: parsed.objectName,
        filePaths: new Set(),
        reasons: [`RLS policy protects table ${qualifiedName(parsed.schemaName, parsed.objectName)}`],
      });
    }
    for (const trigger of table?.triggers ?? []) {
      addObject({
        kind: "trigger",
        schemaName: parsed.schemaName,
        objectName: `${parsed.objectName}.${trigger.name}`,
        tableName: parsed.objectName,
        filePaths: new Set(),
        reasons: [`trigger runs on table ${qualifiedName(parsed.schemaName, parsed.objectName)}`],
      });
    }
  }

  for (const tableKey of args.includedTables) {
    const parsed = parseDatabaseKey(tableKey);
    if (!parsed) continue;
    for (const ref of args.projectStore.listFunctionTableRefs({
      targetSchema: parsed.schemaName,
      tableName: parsed.objectName,
    })) {
      addObject({
        kind: "rpc_table_ref",
        schemaName: ref.rpcSchema,
        objectName: `${ref.rpcName}(${ref.argTypes.join(",")}) -> ${ref.targetSchema}.${ref.targetTable}`,
        tableName: ref.targetTable,
        filePaths: new Set(),
        reasons: [`RPC ${ref.rpcSchema}.${ref.rpcName} references table ${ref.targetSchema}.${ref.targetTable}`],
      });
    }
  }

  return [...objects.values()]
    .map((object) => ({
      kind: object.kind,
      ...(object.schemaName ? { schemaName: object.schemaName } : {}),
      objectName: object.objectName,
      ...(object.tableName ? { tableName: object.tableName } : {}),
      fileCount: object.filePaths.size,
      reasons: object.reasons,
      ...(object.freshness ? { freshness: object.freshness } : {}),
    }))
    .sort((left, right) =>
      kindRank(left.kind) - kindRank(right.kind) ||
      (left.schemaName ?? "").localeCompare(right.schemaName ?? "") ||
      (left.tableName ?? "").localeCompare(right.tableName ?? "") ||
      left.objectName.localeCompare(right.objectName)
    );
}

function collectFeatureFindings(args: {
  projectStore: Pick<ProjectStore, "queryReefFindings">;
  projectId: string;
  returnedFileSet: ReadonlySet<string>;
  limit: number;
}): ReefAskFeatureFlowFindingSummary[] {
  return args.projectStore.queryReefFindings({
    projectId: args.projectId,
    includeResolved: false,
    limit: FINDING_LIMIT,
  })
    .filter((finding) => findingMatchesFiles(finding, args.returnedFileSet))
    .sort(compareFindings)
    .slice(0, Math.max(args.limit, 12))
    .map((finding) => ({
      fingerprint: finding.fingerprint,
      source: finding.source,
      ...(finding.ruleId ? { ruleId: finding.ruleId } : {}),
      severity: finding.severity,
      ...(finding.filePath ? { filePath: finding.filePath } : {}),
      ...(finding.line ? { line: finding.line } : {}),
      message: finding.message,
      freshness: finding.freshness,
    }));
}

function collectFeatureRoutes(
  routes: readonly ResolvedRouteRecord[],
  returnedFileSet: ReadonlySet<string>,
): ReefAskFeatureFlowRouteSummary[] {
  return routes
    .filter((route) => returnedFileSet.has(normalizePath(route.filePath)))
    .map((route) => ({
      routeKey: route.routeKey,
      filePath: route.filePath,
      pattern: route.pattern,
      ...(route.method ? { method: route.method } : {}),
      ...(route.isApi !== undefined ? { isApi: route.isApi } : {}),
      reason: `route handled by ${route.filePath}`,
    }))
    .sort((left, right) => left.filePath.localeCompare(right.filePath) || left.routeKey.localeCompare(right.routeKey));
}

function collectFeatureLinks(args: {
  imports: readonly FileImportLink[];
  routes: readonly ReefAskFeatureFlowRouteSummary[];
  schemaUsages: readonly SchemaUsageEntry[];
  databaseObjects: readonly ReefAskFeatureFlowDatabaseObjectSummary[];
  findings: readonly ReefAskFeatureFlowFindingSummary[];
  returnedFileSet: ReadonlySet<string>;
  includedTables: ReadonlySet<string>;
  projectStore: Pick<ProjectStore, "listFunctionTableRefs">;
}): ReefAskFeatureFlowLinkSummary[] {
  const links = new Map<string, LinkAccumulator>();
  const add = (link: LinkAccumulator): void => {
    links.set(`${link.kind}\0${link.from}\0${link.to}\0${link.reason}`, link);
  };

  for (const edge of args.imports) {
    const source = normalizePath(edge.sourcePath);
    const target = normalizePath(edge.targetPath);
    if (!args.returnedFileSet.has(source) || !args.returnedFileSet.has(target)) continue;
    add({
      from: fileId(edge.sourcePath),
      to: fileId(edge.targetPath),
      kind: "imports",
      reason: edge.specifier,
      confidence: edge.targetExists ? 0.95 : 0.65,
    });
  }

  for (const route of args.routes) {
    add({
      from: fileId(route.filePath),
      to: routeId(route.routeKey),
      kind: "handles_route",
      reason: route.pattern,
      confidence: 0.95,
    });
  }

  const databaseObjectIds = new Set(args.databaseObjects.map(databaseObjectId));
  for (const entry of args.schemaUsages) {
    if (!args.returnedFileSet.has(normalizePath(entry.usage.filePath))) continue;
    const object = schemaUsageLinkObject(entry);
    const id = databaseObjectId(object);
    const tableId = object.tableName
      ? databaseObjectId({
          kind: "table",
          schemaName: object.schemaName,
          objectName: object.tableName,
        })
      : undefined;
    const target = databaseObjectIds.has(id) ? id : tableId && databaseObjectIds.has(tableId) ? tableId : id;
    add({
      from: fileId(entry.usage.filePath),
      to: target,
      kind: schemaUsageLinkKind(entry),
      reason: entry.usage.excerpt ?? entry.usage.usageKind,
      confidence: 0.86,
    });
  }

  for (const object of args.databaseObjects) {
    if (!object.tableName) continue;
    const tableNode = databaseObjectId({
      kind: "table",
      schemaName: object.schemaName,
      objectName: object.tableName,
    });
    if (object.kind === "rls_policy") {
      add({
        from: tableNode,
        to: databaseObjectId(object),
        kind: "protected_by_policy",
        reason: object.reasons[0] ?? "table protected by RLS policy",
        confidence: 0.9,
      });
    }
    if (object.kind === "trigger") {
      add({
        from: tableNode,
        to: databaseObjectId(object),
        kind: "has_trigger",
        reason: object.reasons[0] ?? "table has trigger",
        confidence: 0.9,
      });
    }
  }

  for (const finding of args.findings) {
    if (!finding.filePath) continue;
    add({
      from: fileId(finding.filePath),
      to: findingId(finding.fingerprint),
      kind: "has_finding",
      reason: finding.ruleId ?? finding.source,
      confidence: 0.92,
    });
  }

  for (const tableKey of args.includedTables) {
    const parsed = parseDatabaseKey(tableKey);
    if (!parsed) continue;
    for (const ref of args.projectStore.listFunctionTableRefs({
      targetSchema: parsed.schemaName,
      tableName: parsed.objectName,
    })) {
      add({
      from: databaseObjectId({
        kind: "rpc",
        schemaName: ref.rpcSchema,
        objectName: ref.rpcName,
      }),
      to: databaseObjectId({
        kind: "table",
        schemaName: ref.targetSchema,
        objectName: ref.targetTable,
      }),
        kind: "rpc_touches_table",
        reason: `${ref.rpcKind} ${ref.rpcSchema}.${ref.rpcName} references ${ref.targetSchema}.${ref.targetTable}`,
        confidence: 0.82,
      });
    }
  }

  return [...links.values()].sort((left, right) =>
    linkKindRank(left.kind) - linkKindRank(right.kind) ||
    left.from.localeCompare(right.from) ||
    left.to.localeCompare(right.to)
  );
}

function summarizeFile(args: {
  score: FileScore;
  routesByFile: Map<string, ResolvedRouteRecord[]>;
  outboundImports: Map<string, FileImportLink[]>;
  inboundImports: Map<string, FileImportLink[]>;
  schemaUsagesByFile: Map<string, SchemaUsageEntry[]>;
  findings: readonly ReefAskFeatureFlowFindingSummary[];
}) {
  const filePath = normalizePath(args.score.file.path);
  const routeCount = args.routesByFile.get(filePath)?.length ?? 0;
  const outboundImportCount = args.outboundImports.get(filePath)?.length ?? 0;
  const inboundImportCount = args.inboundImports.get(filePath)?.length ?? 0;
  const schemaUsageCount = args.schemaUsagesByFile.get(filePath)?.length ?? 0;
  const findingCount = args.findings.filter((finding) => normalizePath(finding.filePath ?? "") === filePath).length;
  return {
    filePath: args.score.file.path,
    role: classifyFileRole(args.score.file.path, { routeCount, schemaUsageCount }),
    score: Math.round(args.score.score * 100) / 100,
    reasons: args.score.reasons.slice(0, 5),
    routeCount,
    outboundImportCount,
    inboundImportCount,
    schemaUsageCount,
    findingCount,
  };
}

function databaseObjectFromFact(fact: ProjectFact): DatabaseObjectAccumulator | undefined {
  const schemaName = jsonString(fact.data?.schemaName) ?? factSchemaName(fact);
  switch (fact.kind) {
    case "db_table":
      return schemaName && jsonString(fact.data?.tableName)
        ? dbObject("table", schemaName, jsonString(fact.data?.tableName)!, fact)
        : undefined;
    case "db_column": {
      const tableName = jsonString(fact.data?.tableName);
      const columnName = jsonString(fact.data?.columnName);
      return schemaName && tableName && columnName
        ? dbObject("column", schemaName, `${tableName}.${columnName}`, fact, tableName)
        : undefined;
    }
    case "db_index": {
      const tableName = jsonString(fact.data?.tableName);
      const indexName = jsonString(fact.data?.indexName);
      return schemaName && tableName && indexName
        ? dbObject("index", schemaName, `${tableName}.${indexName}`, fact, tableName)
        : undefined;
    }
    case "db_foreign_key": {
      const tableName = jsonString(fact.data?.tableName);
      const constraintName = jsonString(fact.data?.constraintName);
      return schemaName && tableName && constraintName
        ? dbObject("foreign_key", schemaName, `${tableName}.${constraintName}`, fact, tableName)
        : undefined;
    }
    case "db_rls_policy": {
      const tableName = jsonString(fact.data?.tableName);
      const policyName = jsonString(fact.data?.policyName);
      return schemaName && tableName && policyName
        ? dbObject("rls_policy", schemaName, `${tableName}.${policyName}`, fact, tableName)
        : undefined;
    }
    case "db_trigger": {
      const tableName = jsonString(fact.data?.tableName);
      const triggerName = jsonString(fact.data?.triggerName);
      return schemaName && tableName && triggerName
        ? dbObject("trigger", schemaName, `${tableName}.${triggerName}`, fact, tableName)
        : undefined;
    }
    case "db_rpc": {
      const rpcName = jsonString(fact.data?.rpcName);
      return schemaName && rpcName ? dbObject("rpc", schemaName, rpcName, fact) : undefined;
    }
    case "db_view": {
      const viewName = jsonString(fact.data?.viewName);
      return schemaName && viewName ? dbObject("view", schemaName, viewName, fact) : undefined;
    }
    case "db_enum": {
      const enumName = jsonString(fact.data?.enumName);
      return schemaName && enumName ? dbObject("enum", schemaName, enumName, fact) : undefined;
    }
    case "db_usage": {
      const objectName = jsonString(fact.data?.objectName);
      const objectType = jsonString(fact.data?.objectType);
      return schemaName && objectName
        ? dbObject(schemaKindToFeatureKind(objectType), schemaName, objectName, fact, jsonString(fact.data?.parentObjectName))
        : undefined;
    }
    case "db_rpc_table_ref": {
      const rpcSchema = jsonString(fact.data?.rpcSchema);
      const rpcName = jsonString(fact.data?.rpcName);
      const targetSchema = jsonString(fact.data?.targetSchema);
      const targetTable = jsonString(fact.data?.targetTable);
      return rpcSchema && rpcName && targetSchema && targetTable
        ? dbObject("rpc_table_ref", rpcSchema, `${rpcName} -> ${targetSchema}.${targetTable}`, fact, targetTable)
        : undefined;
    }
    case "db_scheduled_job": {
      const jobName = jsonString(fact.data?.jobName);
      return schemaName && jobName ? dbObject("scheduled_job", schemaName, jobName, fact) : undefined;
    }
    default:
      return undefined;
  }
}

function dbObject(
  kind: ReefAskFeatureFlowDatabaseObjectKind,
  schemaName: string | undefined,
  objectName: string,
  fact: ProjectFact,
  tableName?: string | null,
): DatabaseObjectAccumulator {
  return {
    kind,
    ...(schemaName ? { schemaName } : {}),
    objectName,
    ...(tableName ? { tableName } : {}),
    filePaths: new Set(jsonString(fact.data?.filePath) ? [jsonString(fact.data?.filePath)!] : []),
    reasons: [factReason(fact)],
    freshness: fact.freshness,
  };
}

function factReason(fact: ProjectFact): string {
  return `${fact.kind} from ${fact.source}`;
}

function schemaUsageLinkObject(entry: SchemaUsageEntry): ReefAskFeatureFlowDatabaseObjectSummary {
  const tableName = entry.object.objectType === "table"
    ? entry.object.objectName
    : entry.object.parentObjectName;
  return {
    kind: schemaKindToFeatureKind(entry.object.objectType),
    schemaName: entry.object.schemaName,
    objectName: entry.object.objectName,
    ...(tableName ? { tableName } : {}),
    fileCount: 1,
    reasons: [entry.usage.usageKind],
  };
}

function schemaUsageLinkKind(entry: SchemaUsageEntry): ReefAskFeatureFlowLinkKind {
  if (entry.object.objectType === "rpc") return "calls_rpc";
  if (entry.object.objectType === "table" || entry.object.objectType === "column") {
    return isWriteUsage(entry.usage.usageKind) ? "writes_table" : "reads_table";
  }
  return "references_database_object";
}

function classifyFileRole(
  filePath: string,
  counts: { routeCount: number; schemaUsageCount: number },
): ReefAskFeatureFlowFileRole {
  const normalized = filePath.toLowerCase();
  if (/\b(test|spec)\.[cm]?[tj]sx?$|(^|[\\/])(__tests__|test|tests|spec)([\\/]|$)/u.test(normalized)) {
    return "test";
  }
  if (counts.routeCount > 0 || /(^|[\\/])app[\\/]api[\\/].*[\\/]route\.[cm]?[tj]sx?$/u.test(normalized)) {
    return "route";
  }
  if (/\.tsx$/u.test(normalized) || /(^|[\\/])(components|pages|app[\\/]dashboard|app[\\(])/u.test(normalized)) {
    return "frontend";
  }
  if (/(^|[\\/])(lib|server|services|dal|auth|api|actions|db)([\\/]|$)|(^|[\\/])(auth|session|service|dal)\.[cm]?[tj]s$/u.test(normalized)) {
    return "backend";
  }
  if (counts.schemaUsageCount > 0 || /(^|[\\/])(migrations|schema|supabase|database)([\\/]|$)/u.test(normalized)) {
    return "database_touch";
  }
  if (/(^|[\\/])(utils|shared|types|constants)([\\/]|$)/u.test(normalized)) {
    return "shared";
  }
  return "unknown";
}

function schemaKindToFeatureKind(value: string | undefined): ReefAskFeatureFlowDatabaseObjectKind {
  switch (value) {
    case "table":
    case "column":
    case "rpc":
    case "view":
    case "enum":
    case "trigger":
      return value;
    case "policy":
      return "rls_policy";
    default:
      return "database_object";
  }
}

function schemaObjectMatchesSeed(object: ResolvedSchemaObjectRecord, seed: string): boolean {
  const normalized = seed.toLowerCase();
  return object.objectName.toLowerCase() === normalized ||
    `${object.schemaName}.${object.objectName}`.toLowerCase() === normalized ||
    `${object.objectType}:${object.schemaName}.${object.objectName}`.toLowerCase() === normalized ||
    (object.parentObjectName != null && `${object.schemaName}.${object.parentObjectName}`.toLowerCase() === normalized) ||
    (object.parentObjectName != null && `${object.parentObjectName}.${object.objectName}`.toLowerCase() === normalized);
}

function factMatchesDatabaseSeed(fact: ProjectFact, seed: string): boolean {
  const normalized = seed.toLowerCase();
  const schemaName = jsonString(fact.data?.schemaName) ?? factSchemaName(fact);
  const subjectObjectName = fact.subject.kind === "schema_object" ? fact.subject.objectName : "";
  const objectName = jsonString(fact.data?.objectName);
  const tableName = jsonString(fact.data?.tableName);
  const rpcName = jsonString(fact.data?.rpcName);
  const searchable = [
    schemaName,
    subjectObjectName,
    schemaName && subjectObjectName ? `${schemaName}.${subjectObjectName}` : "",
    objectName,
    schemaName && objectName ? `${schemaName}.${objectName}` : "",
    tableName,
    schemaName && tableName ? `${schemaName}.${tableName}` : "",
    jsonString(fact.data?.columnName),
    rpcName,
    schemaName && rpcName ? `${schemaName}.${rpcName}` : "",
    jsonString(fact.data?.policyName),
    jsonString(fact.data?.triggerName),
    jsonString(fact.data?.indexName),
    jsonString(fact.data?.constraintName),
    jsonString(fact.data?.parentObjectName),
    jsonString(fact.data?.jobName),
    jsonString(fact.data?.schedule),
    jsonString(fact.data?.command),
  ].filter(Boolean).join(" ").toLowerCase();
  if (searchable.split(/\s+/u).includes(normalized)) return true;
  return searchable.includes(normalized);
}

function findingMatchesFiles(finding: ProjectFinding, filePaths: ReadonlySet<string>): boolean {
  if (finding.filePath && filePaths.has(normalizePath(finding.filePath))) return true;
  return (finding.evidenceRefs ?? []).some((ref) =>
    [...filePaths].some((filePath) => normalizePath(ref).startsWith(filePath))
  );
}

function symbolMatchesSeed(symbol: SymbolRecord, seed: string): boolean {
  const normalized = seed.toLowerCase();
  return symbol.name.toLowerCase() === normalized || symbol.exportName?.toLowerCase() === normalized;
}

function matchRoutes(routes: readonly ResolvedRouteRecord[], seed: string): ResolvedRouteRecord[] {
  const normalized = seed.toLowerCase();
  return routes.filter((route) =>
    route.routeKey.toLowerCase() === normalized ||
    route.pattern.toLowerCase() === normalized ||
    routeText(route).toLowerCase().includes(normalized)
  );
}

function routeText(route: ResolvedRouteRecord): string {
  return [
    route.routeKey,
    route.method ? `${route.method} ${route.pattern}` : "",
    route.framework,
    route.pattern,
    route.method ?? "",
    route.handlerName ?? "",
    route.filePath,
  ].join(" ");
}

function schemaObjectText(object: ResolvedSchemaObjectRecord): string {
  return [
    object.objectType,
    object.schemaName,
    object.objectName,
    object.parentObjectName ?? "",
    object.dataType ?? "",
  ].join(" ");
}

function routeLabel(route: ResolvedRouteRecord): string {
  return route.method ? `${route.method} ${route.pattern}` : route.pattern;
}

function resolveFile(
  filePath: string,
  fileByPath: ReadonlyMap<string, FileSummaryRecord>,
  files: readonly FileSummaryRecord[],
): FileSummaryRecord | undefined {
  const normalized = normalizePath(filePath);
  return fileByPath.get(normalized) ??
    files.find((file) => normalizePath(file.path).endsWith(`/${normalized}`) || normalized.endsWith(`/${normalizePath(file.path)}`));
}

function compareFileScores(left: FileScore, right: FileScore): number {
  return right.score - left.score ||
    left.file.path.localeCompare(right.file.path);
}

function compareFindings(left: ProjectFinding, right: ProjectFinding): number {
  return severityRank(right.severity) - severityRank(left.severity) ||
    right.capturedAt.localeCompare(left.capturedAt) ||
    (left.filePath ?? "").localeCompare(right.filePath ?? "") ||
    left.message.localeCompare(right.message);
}

function severityRank(severity: ProjectFinding["severity"]): number {
  switch (severity) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

function kindRank(kind: ReefAskFeatureFlowDatabaseObjectKind): number {
  return [
    "table",
    "rpc",
    "column",
    "rls_policy",
    "trigger",
    "index",
    "foreign_key",
    "rpc_table_ref",
    "scheduled_job",
    "usage",
    "view",
    "enum",
    "database_object",
  ].indexOf(kind);
}

function linkKindRank(kind: ReefAskFeatureFlowLinkKind): number {
  return [
    "handles_route",
    "imports",
    "imported_by",
    "reads_table",
    "writes_table",
    "calls_rpc",
    "references_database_object",
    "protected_by_policy",
    "has_trigger",
    "rpc_touches_table",
    "has_finding",
  ].indexOf(kind);
}

function normalizeLimit(value: number): number {
  return Math.min(Math.max(1, Math.trunc(value || DEFAULT_LIMIT)), MAX_LIMIT);
}

function normalizeImportDepth(value: number): number {
  return Math.min(Math.max(0, Math.trunc(value || DEFAULT_IMPORT_DEPTH)), MAX_IMPORT_DEPTH);
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function normalizeDatabaseSeed(value: string): string {
  return value.trim()
    .replace(/^(?:table|view|rpc|function|policy|trigger|column|schema_object):/iu, "")
    .replace(/\s+/gu, "");
}

function qualifiedObjectName(object: ResolvedSchemaObjectRecord): string {
  return `${object.schemaName}.${object.objectName}`;
}

function qualifiedName(schemaName: string | undefined, objectName: string): string {
  return schemaName ? `${schemaName}.${objectName}` : objectName;
}

function databaseKey(kind: string, schemaName: string | undefined, objectName: string): string {
  return `${kind}:${qualifiedName(schemaName, objectName)}`.toLowerCase();
}

function parseDatabaseKey(value: string): { kind: string; schemaName?: string; objectName: string } | undefined {
  const match = value.match(/^(?<kind>[^:]+):(?:(?<schema>[A-Za-z_][A-Za-z0-9_]*)\.)?(?<object>.+)$/u);
  const kind = match?.groups?.kind;
  const objectName = match?.groups?.object;
  if (!kind || !objectName) return undefined;
  return {
    kind,
    ...(match.groups?.schema ? { schemaName: match.groups.schema } : {}),
    objectName,
  };
}

function databaseObjectId(object: Pick<ReefAskFeatureFlowDatabaseObjectSummary, "kind" | "schemaName" | "objectName">): string {
  return `${object.kind}:${qualifiedName(object.schemaName, object.objectName)}`;
}

function fileId(filePath: string): string {
  return `file:${filePath}`;
}

function routeId(routeKey: string): string {
  return `route:${routeKey}`;
}

function findingId(fingerprint: string): string {
  return `finding:${fingerprint}`;
}

function tableNameFromFactObject(fact: ProjectFact): string | undefined {
  if (fact.subject.kind !== "schema_object") return undefined;
  return fact.subject.objectName.split(".")[0];
}

function factSchemaName(fact: ProjectFact): string | undefined {
  return fact.subject.kind === "schema_object" ? fact.subject.schemaName : undefined;
}

function jsonString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isWriteUsage(usageKind: string): boolean {
  return /\b(write|insert|update|delete|upsert|mutation|modify|call_write)\b/iu.test(usageKind);
}

function addReason(reasons: string[], reason: string): void {
  if (reason.trim().length > 0 && !reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const existing = out.get(groupKey) ?? [];
    existing.push(value);
    out.set(groupKey, existing);
  }
  return out;
}
