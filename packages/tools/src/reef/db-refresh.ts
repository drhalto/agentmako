import type {
  DbReefRefreshToolInput,
  DbReefRefreshToolOutput,
  FactFreshness,
  FactSubject,
  JsonObject,
  ProjectFact,
  ReefCalculationDependency,
  ReefProjectSchemaStatus,
  SchemaSnapshot,
  SchemaSourceRef,
} from "@mako-ai/contracts";
import { REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS } from "@mako-ai/contracts";
import { computeSnapshotFreshness, readProjectManifest } from "@mako-ai/indexer";
import type { ProjectStore } from "@mako-ai/store";
import { withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";
import { ensureFreshSchemaSnapshot } from "../schema-freshness.js";

const SOURCE = "db_reef_refresh";
const DEFAULT_FACTS_LIMIT = 100;

const DB_REEF_FACT_KINDS = [
  "db_schema",
  "db_table",
  "db_view",
  "db_column",
  "db_index",
  "db_foreign_key",
  "db_rls_policy",
  "db_trigger",
  "db_enum",
  "db_rpc",
  "db_rpc_table_ref",
  "db_usage",
] as const;

type DbReefFactKind = (typeof DB_REEF_FACT_KINDS)[number];

interface DbFactBuilder {
  projectId: string;
  projectStore: ProjectStore;
  checkedAt: string;
  freshness: FactFreshness;
  schemaFreshness: ReefProjectSchemaStatus;
}

export async function dbReefRefreshTool(
  input: DbReefRefreshToolInput,
  options: ToolServiceOptions,
): Promise<DbReefRefreshToolOutput> {
  return await withProjectContext(input, options, async ({ project, projectStore }) => {
    const checkedAt = new Date().toISOString();
    const freshness = await ensureFreshSchemaSnapshot({
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      projectStore,
      freshen: input.freshen ?? true,
      toolOptions: options,
    });
    const snapshot = freshness.snapshot;
    const schemaFreshness = schemaFreshnessFromSnapshot(project.canonicalPath, snapshot, checkedAt);
    const warnings: string[] = [...freshness.warnings];
    const facts: ProjectFact[] = [];

    if (!snapshot) {
      projectStore.replaceReefFactsForSource({
        projectId: project.projectId,
        overlay: "indexed",
        source: SOURCE,
        facts: [],
        kinds: [...DB_REEF_FACT_KINDS],
      });
      return {
        toolName: "db_reef_refresh",
        projectId: project.projectId,
        projectRoot: project.canonicalPath,
        ...(input.includeFacts ? { facts: [], factsTruncated: false } : {}),
        schemaFreshness,
        summary: emptySummary(),
        warnings: [...warnings, "No schema snapshot is available. Run project_index_refresh before refreshing DB Reef facts."],
      };
    }

    const builder: DbFactBuilder = {
      projectId: project.projectId,
      projectStore,
      checkedAt,
      freshness: freshnessFromSchemaStatus(schemaFreshness, checkedAt),
      schemaFreshness,
    };

    facts.push(...factsFromSnapshot(snapshot, builder));
    facts.push(...functionTableRefFacts(projectStore, builder));

    if (input.includeAppUsage ?? true) {
      facts.push(...schemaUsageFacts(projectStore, builder));
    }

    const persisted = projectStore.replaceReefFactsForSource({
      projectId: project.projectId,
      overlay: "indexed",
      source: SOURCE,
      facts,
      kinds: [...DB_REEF_FACT_KINDS],
    });

    if (snapshot.warnings.length > 0) {
      warnings.push(`${snapshot.warnings.length} schema snapshot warning(s) were present when DB Reef facts were refreshed.`);
    }
    if (freshness.refreshed) {
      warnings.push("schema snapshot was refreshed from the live DB before DB Reef facts were generated.");
    }

    const factPayload = input.includeFacts
      ? factsPayload(persisted, input.factsLimit)
      : null;

    return {
      toolName: "db_reef_refresh",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      ...(factPayload ? { facts: factPayload.facts, factsTruncated: factPayload.truncated } : {}),
      schemaFreshness,
      summary: summarizeFacts(persisted),
      warnings: [
        ...warnings,
        ...(factPayload?.truncated
          ? [`facts payload truncated to ${factPayload.facts.length} of ${persisted.length}; set factsLimit or omit includeFacts for summary-only output.`]
          : []),
      ],
    };
  });
}

function factsPayload(facts: readonly ProjectFact[], limit: number | undefined): { facts: ProjectFact[]; truncated: boolean } {
  const effectiveLimit = limit ?? DEFAULT_FACTS_LIMIT;
  return {
    facts: facts.slice(0, effectiveLimit),
    truncated: facts.length > effectiveLimit,
  };
}

function factsFromSnapshot(snapshot: SchemaSnapshot, builder: DbFactBuilder): ProjectFact[] {
  const facts: ProjectFact[] = [];
  const snapshotDependencies = dependenciesFromSnapshot(snapshot);

  for (const [schemaName, namespace] of Object.entries(snapshot.ir.schemas)) {
    facts.push(makeFact(builder, {
      kind: "db_schema",
      subject: { kind: "schema_object", schemaName, objectName: schemaName },
      data: {
        schemaName,
        tableCount: namespace.tables.length,
        viewCount: namespace.views.length,
        enumCount: namespace.enums.length,
        rpcCount: namespace.rpcs.length,
      },
      dependencies: snapshotDependencies,
    }));

    for (const table of namespace.tables) {
      const tableDependencies = dependenciesFromRefs(table.sources, snapshotDependencies);
      facts.push(makeFact(builder, {
        kind: "db_table",
        subject: schemaSubject(table.schema, table.name),
        data: {
          schemaName: table.schema,
          tableName: table.name,
          columnCount: table.columns.length,
          primaryKey: table.primaryKey ?? [],
          indexCount: table.indexes?.length ?? 0,
          outboundForeignKeyCount: table.foreignKeys?.outbound.length ?? 0,
          inboundForeignKeyCount: table.foreignKeys?.inbound.length ?? 0,
          rlsEnabled: table.rls?.rlsEnabled ?? false,
          forceRls: table.rls?.forceRls ?? false,
          policyCount: table.rls?.policies.length ?? 0,
          triggerCount: table.triggers?.length ?? 0,
        },
        dependencies: tableDependencies,
      }));

      for (const column of table.columns) {
        facts.push(makeFact(builder, {
          kind: "db_column",
          subject: schemaSubject(table.schema, `${table.name}.${column.name}`),
          data: {
            schemaName: table.schema,
            tableName: table.name,
            columnName: column.name,
            dataType: column.dataType,
            nullable: column.nullable,
            defaultExpression: column.defaultExpression ?? null,
            isPrimaryKey: column.isPrimaryKey ?? false,
          },
          dependencies: dependenciesFromRefs(column.sources, tableDependencies),
        }));
      }

      for (const index of table.indexes ?? []) {
        facts.push(makeFact(builder, {
          kind: "db_index",
          subject: schemaSubject(table.schema, `${table.name}.${index.name}`),
          data: {
            schemaName: table.schema,
            tableName: table.name,
            indexName: index.name,
            unique: index.unique,
            primary: index.primary,
            columns: index.columns,
            definition: index.definition ?? null,
          },
          dependencies: tableDependencies,
        }));
      }

      for (const foreignKey of table.foreignKeys?.outbound ?? []) {
        facts.push(makeFact(builder, {
          kind: "db_foreign_key",
          subject: schemaSubject(table.schema, `${table.name}.${foreignKey.constraintName}`),
          data: {
            direction: "outbound",
            schemaName: table.schema,
            tableName: table.name,
            constraintName: foreignKey.constraintName,
            columns: foreignKey.columns,
            targetSchema: foreignKey.targetSchema,
            targetTable: foreignKey.targetTable,
            targetColumns: foreignKey.targetColumns,
            onUpdate: foreignKey.onUpdate,
            onDelete: foreignKey.onDelete,
          },
          dependencies: tableDependencies,
        }));
      }

      for (const foreignKey of table.foreignKeys?.inbound ?? []) {
        facts.push(makeFact(builder, {
          kind: "db_foreign_key",
          subject: schemaSubject(
            table.schema,
            `${table.name}.${foreignKey.constraintName}.inbound.${foreignKey.sourceSchema}.${foreignKey.sourceTable}`,
          ),
          data: {
            direction: "inbound",
            schemaName: table.schema,
            tableName: table.name,
            constraintName: foreignKey.constraintName,
            sourceSchema: foreignKey.sourceSchema,
            sourceTable: foreignKey.sourceTable,
            sourceColumns: foreignKey.sourceColumns,
            columns: foreignKey.columns,
            onUpdate: foreignKey.onUpdate,
            onDelete: foreignKey.onDelete,
          },
          dependencies: tableDependencies,
        }));
      }

      for (const policy of table.rls?.policies ?? []) {
        facts.push(makeFact(builder, {
          kind: "db_rls_policy",
          subject: schemaSubject(table.schema, `${table.name}.${policy.name}`),
          data: {
            schemaName: table.schema,
            tableName: table.name,
            policyName: policy.name,
            mode: policy.mode,
            command: policy.command,
            roles: policy.roles,
            usingExpression: policy.usingExpression,
            withCheckExpression: policy.withCheckExpression,
          },
          dependencies: tableDependencies,
        }));
      }

      for (const trigger of table.triggers ?? []) {
        facts.push(makeFact(builder, {
          kind: "db_trigger",
          subject: schemaSubject(table.schema, `${table.name}.${trigger.name}`),
          data: {
            schemaName: table.schema,
            tableName: table.name,
            triggerName: trigger.name,
            enabled: trigger.enabled,
            enabledMode: trigger.enabledMode,
            timing: trigger.timing,
            events: trigger.events,
            hasBodyText: Boolean(trigger.bodyText),
          },
          dependencies: tableDependencies,
        }));
      }
    }

    for (const view of namespace.views) {
      facts.push(makeFact(builder, {
        kind: "db_view",
        subject: schemaSubject(view.schema, view.name),
        data: {
          schemaName: view.schema,
          viewName: view.name,
        },
        dependencies: dependenciesFromRefs(view.sources, snapshotDependencies),
      }));
    }

    for (const enumObject of namespace.enums) {
      facts.push(makeFact(builder, {
        kind: "db_enum",
        subject: schemaSubject(enumObject.schema, enumObject.name),
        data: {
          schemaName: enumObject.schema,
          enumName: enumObject.name,
          values: enumObject.values,
        },
        dependencies: dependenciesFromRefs(enumObject.sources, snapshotDependencies),
      }));
    }

    for (const rpc of namespace.rpcs) {
      facts.push(makeFact(builder, {
        kind: "db_rpc",
        subject: schemaSubject(rpc.schema, rpcSignature(rpc.name, rpc.argTypes ?? [])),
        data: {
          schemaName: rpc.schema,
          rpcName: rpc.name,
          argTypes: rpc.argTypes ?? [],
          returnType: rpc.returnType ?? null,
          hasBodyText: Boolean(rpc.bodyText),
        },
        dependencies: dependenciesFromRefs(rpc.sources, snapshotDependencies),
      }));
    }
  }

  return facts;
}

function functionTableRefFacts(projectStore: ProjectStore, builder: DbFactBuilder): ProjectFact[] {
  return projectStore.listFunctionTableRefs().map((ref) =>
    makeFact(builder, {
      kind: "db_rpc_table_ref",
      subject: schemaSubject(
        ref.rpcSchema,
        `${rpcSignature(ref.rpcName, ref.argTypes)} -> ${ref.targetSchema}.${ref.targetTable}`,
      ),
      data: {
        rpcSchema: ref.rpcSchema,
        rpcName: ref.rpcName,
        rpcKind: ref.rpcKind,
        argTypes: ref.argTypes,
        targetSchema: ref.targetSchema,
        targetTable: ref.targetTable,
      },
      dependencies: [{ kind: "fact_kind", factKind: "db_rpc" }, { kind: "fact_kind", factKind: "db_table" }],
    })
  );
}

function schemaUsageFacts(projectStore: ProjectStore, builder: DbFactBuilder): ProjectFact[] {
  const facts: ProjectFact[] = [];
  for (const object of projectStore.listSchemaObjects()) {
    for (const usage of projectStore.listSchemaUsages(object.objectId)) {
      const subject: FactSubject = {
        kind: "diagnostic",
        path: usage.filePath,
        ruleId: "db_usage",
        code: `${object.schemaName}.${object.objectName}:${usage.usageKind}:${usage.line ?? 0}`,
      };
      facts.push(makeFact(builder, {
        kind: "db_usage",
        subject,
        data: {
          schemaName: object.schemaName,
          objectName: object.objectName,
          objectType: object.objectType,
          parentObjectName: object.parentObjectName ?? null,
          dataType: object.dataType ?? null,
          filePath: usage.filePath,
          line: usage.line ?? null,
          usageKind: usage.usageKind,
          excerpt: usage.excerpt ?? null,
        },
        dependencies: [{ kind: "file", path: usage.filePath }],
      }));
    }
  }
  return facts;
}

function makeFact(
  builder: DbFactBuilder,
  args: {
    kind: DbReefFactKind;
    subject: FactSubject;
    data: JsonObject;
    dependencies?: ReefCalculationDependency[];
    confidence?: number;
  },
): ProjectFact {
  const subjectFingerprint = builder.projectStore.computeReefSubjectFingerprint(args.subject);
  return {
    projectId: builder.projectId,
    kind: args.kind,
    subject: args.subject,
    subjectFingerprint,
    overlay: "indexed",
    source: SOURCE,
    confidence: args.confidence ?? 1,
    fingerprint: builder.projectStore.computeReefFactFingerprint({
      projectId: builder.projectId,
      kind: args.kind,
      subjectFingerprint,
      overlay: "indexed",
      source: SOURCE,
      data: args.data,
    }),
    freshness: builder.freshness,
    provenance: {
      source: SOURCE,
      capturedAt: builder.checkedAt,
      ...(args.dependencies && args.dependencies.length > 0 ? { dependencies: args.dependencies } : {}),
      metadata: schemaFreshnessMetadata(builder.schemaFreshness),
    },
    data: args.data,
  };
}

function schemaSubject(schemaName: string, objectName: string): FactSubject {
  return { kind: "schema_object", schemaName, objectName };
}

function rpcSignature(name: string, argTypes: readonly string[]): string {
  return `${name}(${argTypes.join(",")})`;
}

function schemaFreshnessFromSnapshot(
  projectRoot: string,
  snapshot: SchemaSnapshot | null,
  checkedAt: string,
): ReefProjectSchemaStatus {
  const checkedAtMs = Date.parse(checkedAt);
  const manifest = readProjectManifest(projectRoot);
  const liveDbBound = Boolean(
    manifest?.database.liveBinding.enabled &&
    manifest.database.liveBinding.ref.trim().length > 0,
  );
  if (!snapshot) {
    return {
      checkedAt,
      state: "no_snapshot",
      reason: "schema snapshot state is not_built",
      sourceFreshness: "no_snapshot",
      liveDbFreshness: liveDbBound ? "stale" : "not_bound",
      liveDbBound,
      liveSnapshotMaxAgeMs: REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS,
    };
  }

  const sourceStatus = manifest
    ? computeSnapshotFreshness(projectRoot, manifest.database, snapshot)
    : snapshot.freshnessStatus;
  const sourceFreshness = sourceStatus === "fresh" || sourceStatus === "verified"
    ? "fresh"
    : sourceStatus === "unknown"
      ? "unknown"
      : "stale";
  const refreshedAtMs = Date.parse(snapshot.refreshedAt);
  const snapshotAgeMs = Number.isFinite(checkedAtMs) && Number.isFinite(refreshedAtMs)
    ? Math.max(0, checkedAtMs - refreshedAtMs)
    : undefined;
  const liveDbFreshness = liveDbFreshnessFromSnapshot({
    liveDbBound,
    sourceMode: snapshot.sourceMode,
    snapshotAgeMs,
    refreshedAtMs,
  });
  const state = sourceFreshness === "stale" || liveDbFreshness === "stale"
    ? "stale"
    : sourceFreshness === "unknown" || liveDbFreshness === "unknown"
      ? "unknown"
      : "fresh";

  return {
    checkedAt,
    state,
    reason: schemaFreshnessReason({
      sourceFreshness,
      liveDbFreshness,
      liveDbBound,
      sourceMode: snapshot.sourceMode,
      snapshotAgeMs,
    }),
    snapshotId: snapshot.snapshotId,
    sourceMode: snapshot.sourceMode,
    freshnessStatus: sourceStatus,
    sourceFreshness,
    liveDbFreshness,
    liveDbBound,
    lastSnapshotAt: snapshot.refreshedAt,
    ...(snapshot.verifiedAt ? { lastVerifiedAt: snapshot.verifiedAt } : {}),
    liveSnapshotMaxAgeMs: REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS,
    ...(snapshotAgeMs !== undefined ? { snapshotAgeMs } : {}),
    driftDetected: snapshot.driftDetected,
  };
}

function liveDbFreshnessFromSnapshot(args: {
  liveDbBound: boolean;
  sourceMode: SchemaSnapshot["sourceMode"];
  snapshotAgeMs: number | undefined;
  refreshedAtMs: number;
}): ReefProjectSchemaStatus["liveDbFreshness"] {
  if (!args.liveDbBound) {
    return "not_bound";
  }
  if (args.sourceMode !== "live_refresh_enabled") {
    return "stale";
  }
  if (!Number.isFinite(args.refreshedAtMs) || args.snapshotAgeMs === undefined) {
    return "stale";
  }
  return args.snapshotAgeMs <= REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS ? "fresh" : "stale";
}

function schemaFreshnessReason(args: {
  sourceFreshness: ReefProjectSchemaStatus["sourceFreshness"];
  liveDbFreshness: ReefProjectSchemaStatus["liveDbFreshness"];
  liveDbBound: boolean;
  sourceMode: SchemaSnapshot["sourceMode"];
  snapshotAgeMs: number | undefined;
}): string {
  if (args.sourceFreshness === "stale") {
    return "schema snapshot source hashes are stale or drift was detected";
  }
  if (args.liveDbFreshness === "stale") {
    if (!args.liveDbBound) {
      return "schema snapshot has no live DB binding";
    }
    if (args.sourceMode !== "live_refresh_enabled") {
      return "live DB binding exists but the latest schema snapshot was not produced by live refresh";
    }
    if (args.snapshotAgeMs === undefined) {
      return "live DB snapshot age could not be computed";
    }
    return `live DB schema snapshot is older than ${REEF_SCHEMA_LIVE_SNAPSHOT_MAX_AGE_MS} ms`;
  }
  if (args.sourceFreshness === "unknown" || args.liveDbFreshness === "unknown") {
    return "schema freshness could not be fully determined";
  }
  return args.liveDbFreshness === "fresh"
    ? "schema snapshot is source-fresh and within the live DB snapshot age budget"
    : "schema snapshot is source-fresh and no live DB binding is configured";
}

function freshnessFromSchemaStatus(schemaFreshness: ReefProjectSchemaStatus, checkedAt: string): FactFreshness {
  const state = schemaFreshness.state === "fresh"
    ? "fresh"
    : schemaFreshness.state === "unknown" || schemaFreshness.state === "no_snapshot"
      ? "unknown"
      : "stale";
  return {
    state,
    checkedAt,
    reason: schemaFreshness.reason,
  };
}

function schemaFreshnessMetadata(status: ReefProjectSchemaStatus): JsonObject {
  return {
    state: status.state,
    reason: status.reason,
    sourceFreshness: status.sourceFreshness,
    liveDbFreshness: status.liveDbFreshness,
    liveDbBound: status.liveDbBound,
    liveSnapshotMaxAgeMs: status.liveSnapshotMaxAgeMs,
    ...(status.snapshotId ? { snapshotId: status.snapshotId } : {}),
    ...(status.sourceMode ? { sourceMode: status.sourceMode } : {}),
    ...(status.freshnessStatus ? { freshnessStatus: status.freshnessStatus } : {}),
    ...(status.lastSnapshotAt ? { lastSnapshotAt: status.lastSnapshotAt } : {}),
    ...(status.snapshotAgeMs !== undefined ? { snapshotAgeMs: status.snapshotAgeMs } : {}),
    ...(status.driftDetected !== undefined ? { driftDetected: status.driftDetected } : {}),
  };
}

function dependenciesFromSnapshot(snapshot: SchemaSnapshot): ReefCalculationDependency[] {
  return uniqueDependencies(snapshot.sources.map((source) =>
    source.kind === "live_catalog"
      ? { kind: "config" as const, path: "db_binding" }
      : { kind: "file" as const, path: source.path }
  ));
}

function dependenciesFromRefs(
  refs: readonly SchemaSourceRef[],
  fallback: readonly ReefCalculationDependency[],
): ReefCalculationDependency[] {
  const fromRefs = refs.map((ref) =>
    ref.kind === "live_catalog"
      ? { kind: "config" as const, path: "db_binding" }
      : { kind: "file" as const, path: ref.path }
  );
  return uniqueDependencies(fromRefs.length > 0 ? fromRefs : fallback);
}

function uniqueDependencies(dependencies: readonly ReefCalculationDependency[]): ReefCalculationDependency[] {
  const seen = new Set<string>();
  const out: ReefCalculationDependency[] = [];
  for (const dependency of dependencies) {
    const key = JSON.stringify(dependency);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dependency);
  }
  return out;
}

function summarizeFacts(facts: readonly ProjectFact[]): DbReefRefreshToolOutput["summary"] {
  const byKind: Record<string, number> = {};
  for (const fact of facts) {
    byKind[fact.kind] = (byKind[fact.kind] ?? 0) + 1;
  }
  return {
    factCount: facts.length,
    byKind,
    schemaCount: byKind.db_schema ?? 0,
    tableCount: byKind.db_table ?? 0,
    viewCount: byKind.db_view ?? 0,
    enumCount: byKind.db_enum ?? 0,
    rpcCount: byKind.db_rpc ?? 0,
    columnCount: byKind.db_column ?? 0,
    indexCount: byKind.db_index ?? 0,
    foreignKeyCount: byKind.db_foreign_key ?? 0,
    rlsPolicyCount: byKind.db_rls_policy ?? 0,
    triggerCount: byKind.db_trigger ?? 0,
    functionTableRefCount: byKind.db_rpc_table_ref ?? 0,
    appUsageCount: byKind.db_usage ?? 0,
  };
}

function emptySummary(): DbReefRefreshToolOutput["summary"] {
  return summarizeFacts([]);
}
