import { createHash, randomUUID } from "node:crypto";
import type {
  ProjectDatabaseManifest,
  ProjectManifest,
  SchemaColumn,
  SchemaEnum,
  SchemaFreshnessStatus,
  SchemaIR,
  SchemaRpc,
  SchemaSnapshot,
  SchemaSnapshotSource,
  SchemaSnapshotSummary,
  SchemaSnapshotWarning,
  SchemaSourceMode,
  SchemaSourceRef,
  SchemaTable,
  SchemaView,
} from "@mako-ai/contracts";
import { ProjectCommandError } from "./errors.js";
import { buildSchemaSourceInventory, type SchemaInventoryEntry } from "./schema-sources/inventory.js";
import { parseSqlSchemaSource } from "./schema-sources/sql.js";
import { parseSupabaseTypesSchemaSource } from "./schema-sources/supabase-types.js";

export interface BuildSchemaSnapshotResult {
  snapshot: SchemaSnapshot | null;
  warnings: SchemaSnapshotWarning[];
}

export interface BuildSchemaSnapshotOptions {
  projectRoot: string;
  manifest: ProjectManifest;
  sourceMode?: SchemaSourceMode;
}

function emptyIR(): SchemaIR {
  return { version: "1.0.0", schemas: {} };
}

function sortSources(sources: SchemaSourceRef[]): SchemaSourceRef[] {
  return [...sources].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    if (left.path !== right.path) {
      return left.path.localeCompare(right.path);
    }
    return (left.line ?? 0) - (right.line ?? 0);
  });
}

function dedupeSources(sources: SchemaSourceRef[]): SchemaSourceRef[] {
  const seen = new Set<string>();
  const unique: SchemaSourceRef[] = [];
  for (const ref of sources) {
    const key = `${ref.kind}|${ref.path}|${ref.line ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function mergeColumns(base: SchemaColumn[], addition: SchemaColumn[]): SchemaColumn[] {
  const byName = new Map<string, SchemaColumn>();
  for (const column of base) {
    byName.set(column.name, { ...column, sources: [...column.sources] });
  }
  for (const column of addition) {
    const existing = byName.get(column.name);
    if (existing) {
      existing.sources = dedupeSources([...existing.sources, ...column.sources]);
      if (existing.dataType === "unknown" && column.dataType !== "unknown") {
        existing.dataType = column.dataType;
      }
      if (existing.isPrimaryKey == null && column.isPrimaryKey != null) {
        existing.isPrimaryKey = column.isPrimaryKey;
      }
    } else {
      byName.set(column.name, { ...column, sources: [...column.sources] });
    }
  }
  return [...byName.values()];
}

function sortStringArray(values: string[] | undefined): string[] | undefined {
  return values ? [...values].sort((left, right) => left.localeCompare(right)) : undefined;
}

function rpcArgSignature(argTypes: string[] | undefined): string {
  return (argTypes ?? []).join("|");
}

function rpcMatches(existing: SchemaRpc, incoming: SchemaRpc): boolean {
  if (existing.name !== incoming.name) {
    return false;
  }

  if (existing.argTypes && incoming.argTypes) {
    return rpcArgSignature(existing.argTypes) === rpcArgSignature(incoming.argTypes);
  }

  return true;
}

export function mergeIRInto(target: SchemaIR, addition: SchemaIR): void {
  for (const [schemaName, additionNs] of Object.entries(addition.schemas)) {
    const targetNs = target.schemas[schemaName] ?? {
      tables: [],
      views: [],
      enums: [],
      rpcs: [],
    };

    const tableIndex = new Map<string, SchemaTable>();
    for (const table of targetNs.tables) {
      tableIndex.set(table.name, table);
    }
    for (const incoming of additionNs.tables) {
      const existing = tableIndex.get(incoming.name);
      if (existing) {
        existing.columns = mergeColumns(existing.columns, incoming.columns);
        existing.sources = dedupeSources([...existing.sources, ...incoming.sources]);
        if (!existing.primaryKey && incoming.primaryKey) {
          existing.primaryKey = [...incoming.primaryKey];
        }
        if (!existing.indexes && incoming.indexes) {
          existing.indexes = incoming.indexes.map((index) => ({
            ...index,
            columns: [...index.columns],
          }));
        }
        if (!existing.foreignKeys && incoming.foreignKeys) {
          existing.foreignKeys = {
            outbound: incoming.foreignKeys.outbound.map((fk) => ({
              ...fk,
              columns: [...fk.columns],
              targetColumns: [...fk.targetColumns],
            })),
            inbound: incoming.foreignKeys.inbound.map((fk) => ({
              ...fk,
              sourceColumns: [...fk.sourceColumns],
              columns: [...fk.columns],
            })),
          };
        }
        // RLS policies and triggers are typically added/edited directly
        // against the live DB (Supabase dashboard, psql, etc.), so the live
        // catalog is the authoritative source. Repo migrations often declare
        // an empty `rls: { policies: [] }` shape even when the live DB has
        // policies. Prefer incoming (live) over existing (repo) whenever
        // incoming carries policy/trigger information.
        if (incoming.rls) {
          existing.rls = {
            ...incoming.rls,
            policies: incoming.rls.policies.map((policy) => ({
              ...policy,
              roles: [...policy.roles],
            })),
          };
        }
        if (incoming.triggers && incoming.triggers.length > 0) {
          existing.triggers = incoming.triggers.map((trigger) => ({
            ...trigger,
            events: [...trigger.events],
          }));
        }
      } else {
        const cloned: SchemaTable = {
          ...incoming,
          columns: incoming.columns.map((column) => ({ ...column, sources: [...column.sources] })),
          sources: [...incoming.sources],
          ...(incoming.primaryKey ? { primaryKey: [...incoming.primaryKey] } : {}),
          ...(incoming.indexes
            ? {
                indexes: incoming.indexes.map((index) => ({
                  ...index,
                  columns: [...index.columns],
                })),
              }
            : {}),
          ...(incoming.foreignKeys
            ? {
                foreignKeys: {
                  outbound: incoming.foreignKeys.outbound.map((fk) => ({
                    ...fk,
                    columns: [...fk.columns],
                    targetColumns: [...fk.targetColumns],
                  })),
                  inbound: incoming.foreignKeys.inbound.map((fk) => ({
                    ...fk,
                    sourceColumns: [...fk.sourceColumns],
                    columns: [...fk.columns],
                  })),
                },
              }
            : {}),
          ...(incoming.rls
            ? {
                rls: {
                  ...incoming.rls,
                  policies: incoming.rls.policies.map((policy) => ({
                    ...policy,
                    roles: [...policy.roles],
                  })),
                },
              }
            : {}),
          ...(incoming.triggers
            ? {
                triggers: incoming.triggers.map((trigger) => ({
                  ...trigger,
                  events: [...trigger.events],
                })),
              }
            : {}),
        };
        tableIndex.set(cloned.name, cloned);
        targetNs.tables.push(cloned);
      }
    }

    const viewIndex = new Map<string, SchemaView>();
    for (const view of targetNs.views) {
      viewIndex.set(view.name, view);
    }
    for (const incoming of additionNs.views) {
      const existing = viewIndex.get(incoming.name);
      if (existing) {
        existing.sources = dedupeSources([...existing.sources, ...incoming.sources]);
      } else {
        const cloned: SchemaView = { ...incoming, sources: [...incoming.sources] };
        viewIndex.set(cloned.name, cloned);
        targetNs.views.push(cloned);
      }
    }

    const enumIndex = new Map<string, SchemaEnum>();
    for (const enumDef of targetNs.enums) {
      enumIndex.set(enumDef.name, enumDef);
    }
    for (const incoming of additionNs.enums) {
      const existing = enumIndex.get(incoming.name);
      if (existing) {
        existing.sources = dedupeSources([...existing.sources, ...incoming.sources]);
        if (existing.values.length === 0 && incoming.values.length > 0) {
          existing.values = [...incoming.values];
        }
      } else {
        const cloned: SchemaEnum = {
          ...incoming,
          values: [...incoming.values],
          sources: [...incoming.sources],
        };
        enumIndex.set(cloned.name, cloned);
        targetNs.enums.push(cloned);
      }
    }

    // Group existing RPCs by name so every incoming RPC is matched in amortized
    // O(1) against its name bucket, then filtered by arg signature via the
    // rpcMatches contract. The previous `.find(...)` form was O(n²) per namespace
    // and would get expensive on schemas with many overloaded functions.
    const rpcBucketsByName = new Map<string, SchemaRpc[]>();
    for (const rpc of targetNs.rpcs) {
      const bucket = rpcBucketsByName.get(rpc.name);
      if (bucket) {
        bucket.push(rpc);
      } else {
        rpcBucketsByName.set(rpc.name, [rpc]);
      }
    }

    for (const incoming of additionNs.rpcs) {
      const bucket = rpcBucketsByName.get(incoming.name);
      const existing = bucket?.find((rpc) => rpcMatches(rpc, incoming));
      if (existing) {
        existing.sources = dedupeSources([...existing.sources, ...incoming.sources]);
        if (!existing.argTypes && incoming.argTypes) {
          existing.argTypes = [...incoming.argTypes];
        }
        if (!existing.returnType && incoming.returnType) {
          existing.returnType = incoming.returnType;
        }
        // Critical: carry the SQL body text across the merge. Previously only
        // argTypes and returnType were copied, which dropped the body every
        // time a supabase-types entry was merged in first (types.ts carries
        // no body, so the types entry became the winner and the SQL
        // extractor's body was silently discarded — leaving
        // `function_table_refs` empty and any file→table graph path
        // `disconnected`).
        if (!existing.bodyText && incoming.bodyText) {
          existing.bodyText = incoming.bodyText;
        }
      } else {
        const cloned: SchemaRpc = {
          ...incoming,
          ...(incoming.argTypes ? { argTypes: [...incoming.argTypes] } : {}),
          sources: [...incoming.sources],
        };
        targetNs.rpcs.push(cloned);
        if (bucket) {
          bucket.push(cloned);
        } else {
          rpcBucketsByName.set(cloned.name, [cloned]);
        }
      }
    }

    target.schemas[schemaName] = targetNs;
  }
}

export function sortIR(ir: SchemaIR): SchemaIR {
  const sorted: SchemaIR = { version: ir.version, schemas: {} };
  for (const schemaName of Object.keys(ir.schemas).sort()) {
    const namespace = ir.schemas[schemaName];
    sorted.schemas[schemaName] = {
      tables: [...namespace.tables]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((table) => ({
          ...table,
          columns: [...table.columns]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((column) => ({
              ...column,
              sources: sortSources(column.sources),
            })),
          sources: sortSources(table.sources),
          ...(table.primaryKey ? { primaryKey: [...table.primaryKey] } : {}),
          ...(table.indexes
            ? {
                indexes: [...table.indexes]
                  .sort((left, right) => left.name.localeCompare(right.name))
                  .map((index) => ({
                    ...index,
                    columns: [...index.columns],
                  })),
              }
            : {}),
          ...(table.foreignKeys
            ? {
                foreignKeys: {
                  outbound: [...table.foreignKeys.outbound]
                    .sort((left, right) => left.constraintName.localeCompare(right.constraintName))
                    .map((fk) => ({
                      ...fk,
                      columns: [...fk.columns],
                      targetColumns: [...fk.targetColumns],
                    })),
                  inbound: [...table.foreignKeys.inbound]
                    .sort((left, right) => left.constraintName.localeCompare(right.constraintName))
                    .map((fk) => ({
                      ...fk,
                      sourceColumns: [...fk.sourceColumns],
                      columns: [...fk.columns],
                    })),
                },
              }
            : {}),
          ...(table.rls
            ? {
                rls: {
                  ...table.rls,
                  policies: [...table.rls.policies]
                    .sort((left, right) => left.name.localeCompare(right.name))
                    .map((policy) => ({
                      ...policy,
                      roles: sortStringArray(policy.roles) ?? [],
                    })),
                },
              }
            : {}),
          ...(table.triggers
            ? {
                triggers: [...table.triggers]
                  .sort((left, right) => left.name.localeCompare(right.name))
                  .map((trigger) => ({
                    ...trigger,
                    events: sortStringArray(trigger.events) ?? [],
                  })),
              }
            : {}),
        })),
      views: [...namespace.views]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((view) => ({ ...view, sources: sortSources(view.sources) })),
      enums: [...namespace.enums]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((enumDef) => ({
          ...enumDef,
          values: [...enumDef.values],
          sources: sortSources(enumDef.sources),
        })),
      rpcs: [...namespace.rpcs]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((rpc) => ({
          ...rpc,
          ...(rpc.argTypes ? { argTypes: [...rpc.argTypes] } : {}),
          sources: sortSources(rpc.sources),
        })),
    };
  }
  return sorted;
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(",")}}`;
}

export function fingerprintIR(ir: SchemaIR): string {
  return createHash("sha256").update(canonicalStringify(ir), "utf8").digest("hex");
}

async function parseEntry(entry: SchemaInventoryEntry): Promise<SchemaIR> {
  switch (entry.kind) {
    case "sql_migration":
      return parseSqlSchemaSource(entry);
    case "generated_types":
      return parseSupabaseTypesSchemaSource(entry);
    default:
      return emptyIR();
  }
}

function toSnapshotSource(entry: SchemaInventoryEntry): SchemaSnapshotSource {
  return {
    kind: entry.kind,
    path: entry.relativePath,
    sha256: entry.sha256,
    lastModifiedAt: entry.lastModifiedAt,
    sizeBytes: entry.sizeBytes,
  };
}

export async function buildSchemaSnapshot(options: BuildSchemaSnapshotOptions): Promise<BuildSchemaSnapshotResult> {
  const { projectRoot, manifest } = options;
  const sourceMode = options.sourceMode ?? "repo_only";

  if (manifest.database.schemaSources.length === 0) {
    return { snapshot: null, warnings: [] };
  }

  let inventory;
  try {
    inventory = buildSchemaSourceInventory(projectRoot, manifest.database);
  } catch (error) {
    throw new ProjectCommandError(
      500,
      "snapshot_build_failed",
      `Failed to enumerate schema sources: ${error instanceof Error ? error.message : String(error)}`,
      { projectRoot },
    );
  }

  if (inventory.entries.length === 0) {
    // All declared sources were unsupported, missing, or unresolvable. Surface the warnings
    // to the caller but leave the snapshot unpersisted so status reports `not_built` rather
    // than a misleading "present/fresh" row with an empty IR.
    return { snapshot: null, warnings: inventory.warnings };
  }

  const warnings: SchemaSnapshotWarning[] = [...inventory.warnings];
  const mergedIR = emptyIR();

  for (const entry of inventory.entries) {
    try {
      const parsed = await parseEntry(entry);
      mergeIRInto(mergedIR, parsed);
    } catch (error) {
      warnings.push({
        kind: "parser_partial",
        sourceKind: entry.kind,
        sourcePath: entry.relativePath,
        message: `Parser failed for ${entry.relativePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  const sortedIR = sortIR(mergedIR);
  const fingerprint = fingerprintIR(sortedIR);
  const now = new Date().toISOString();

  const snapshot: SchemaSnapshot = {
    snapshotId: `snapshot_${randomUUID()}`,
    sourceMode,
    generatedAt: now,
    refreshedAt: now,
    fingerprint,
    freshnessStatus: "fresh",
    driftDetected: false,
    sources: inventory.entries
      .map(toSnapshotSource)
      .sort((left, right) => left.path.localeCompare(right.path)),
    warnings,
    ir: sortedIR,
  };

  return { snapshot, warnings };
}

function buildPresentSummary(
  snapshot: SchemaSnapshot,
  freshnessOverride?: SchemaFreshnessStatus,
): SchemaSnapshotSummary {
  return {
    state: "present",
    snapshotId: snapshot.snapshotId,
    sourceMode: snapshot.sourceMode,
    generatedAt: snapshot.generatedAt,
    refreshedAt: snapshot.refreshedAt,
    fingerprint: snapshot.fingerprint,
    freshnessStatus: freshnessOverride ?? snapshot.freshnessStatus,
    driftDetected: snapshot.driftDetected,
    sourceCount: snapshot.sources.length,
    warningCount: snapshot.warnings.length,
  };
}

export function toSchemaSnapshotSummary(
  snapshot: SchemaSnapshot | null,
  manifestSchemaSources: readonly string[],
): SchemaSnapshotSummary {
  if (snapshot === null) {
    if (manifestSchemaSources.length === 0) {
      return { state: "no_sources" };
    }
    return { state: "not_built" };
  }
  return buildPresentSummary(snapshot);
}

export function computeSnapshotFreshness(
  projectRoot: string,
  database: ProjectDatabaseManifest,
  snapshot: SchemaSnapshot,
): SchemaFreshnessStatus {
  let inventory;
  try {
    inventory = buildSchemaSourceInventory(projectRoot, database);
  } catch {
    return "refresh_required";
  }

  const currentByPath = new Map(
    inventory.entries.map((entry) => [entry.relativePath, entry] as const),
  );
  const storedByPath = new Map(
    snapshot.sources.map((source) => [source.path, source] as const),
  );

  if (currentByPath.size !== storedByPath.size) {
    return "refresh_required";
  }

  for (const [storedPath, storedSource] of storedByPath) {
    const current = currentByPath.get(storedPath);
    if (!current) {
      return "refresh_required";
    }
    if (current.kind !== storedSource.kind) {
      return "refresh_required";
    }
    if (current.sha256 !== storedSource.sha256) {
      return "refresh_required";
    }
  }

  return snapshot.freshnessStatus;
}

export function resolveSchemaSnapshotSummary(
  projectRoot: string,
  database: ProjectDatabaseManifest | null,
  storedSnapshot: SchemaSnapshot | null,
): SchemaSnapshotSummary {
  const schemaSources = database?.schemaSources ?? [];

  if (storedSnapshot === null) {
    if (schemaSources.length === 0) {
      return { state: "no_sources" };
    }
    return { state: "not_built" };
  }

  if (!database) {
    return buildPresentSummary(storedSnapshot);
  }

  const freshness = computeSnapshotFreshness(projectRoot, database, storedSnapshot);
  return buildPresentSummary(storedSnapshot, freshness);
}
