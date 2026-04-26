import type {
  DbSchemaDiff,
  DbVerificationResult,
  JsonValue,
  SchemaIR,
} from "@mako-ai/contracts";
import { createLogger } from "@mako-ai/logger";
import { ProjectCommandError } from "../errors.js";
import { readProjectManifest } from "../project-manifest.js";
import type { IndexerOptions } from "../types.js";
import { durationMs, withResolvedProjectContext } from "../utils.js";
import { fetchLiveSchemaIR } from "./live-catalog.js";
import { resolveLiveDbUrl } from "./resolve.js";

const verifyLogger = createLogger("mako-indexer", { component: "db-verify" });

export interface VerifyProjectDbOptions {
  includedSchemas?: string[];
}

export interface VerificationDiff {
  tableDiff: DbSchemaDiff;
  columnDiff: DbSchemaDiff;
  enumDiff: DbSchemaDiff;
  rpcDiff: DbSchemaDiff;
  indexDiff: DbSchemaDiff;
  foreignKeyDiff: DbSchemaDiff;
  rlsDiff: DbSchemaDiff;
  triggerDiff: DbSchemaDiff;
}

function filterIRBySchemas(ir: SchemaIR, includedSchemas: readonly string[]): SchemaIR {
  const filtered: SchemaIR = { version: ir.version, schemas: {} };
  const included = new Set(includedSchemas);
  for (const [schemaName, namespace] of Object.entries(ir.schemas)) {
    if (included.has(schemaName)) {
      filtered.schemas[schemaName] = namespace;
    }
  }
  return filtered;
}

function collectTableKeys(ir: SchemaIR): Set<string> {
  const keys = new Set<string>();
  for (const [schemaName, namespace] of Object.entries(ir.schemas)) {
    for (const table of namespace.tables) {
      keys.add(`${schemaName}.${table.name}`);
    }
    for (const view of namespace.views) {
      keys.add(`${schemaName}.${view.name}`);
    }
  }
  return keys;
}

function collectColumnKeys(ir: SchemaIR): Set<string> {
  const keys = new Set<string>();
  for (const [schemaName, namespace] of Object.entries(ir.schemas)) {
    for (const table of namespace.tables) {
      for (const column of table.columns) {
        keys.add(`${schemaName}.${table.name}.${column.name}`);
      }
    }
  }
  return keys;
}

function collectEnumKeys(ir: SchemaIR): Set<string> {
  const keys = new Set<string>();
  for (const [schemaName, namespace] of Object.entries(ir.schemas)) {
    for (const enumDef of namespace.enums) {
      const values = [...enumDef.values].sort().join("|");
      keys.add(`${schemaName}.${enumDef.name}::${values}`);
    }
  }
  return keys;
}

function collectRpcKeys(ir: SchemaIR): Set<string> {
  const keys = new Set<string>();
  for (const [schemaName, namespace] of Object.entries(ir.schemas)) {
    for (const rpc of namespace.rpcs) {
      keys.add(`${schemaName}.${rpc.name}`);
    }
  }
  return keys;
}

function collectIndexKeys(ir: SchemaIR): Set<string> {
  const keys = new Set<string>();
  for (const [schemaName, namespace] of Object.entries(ir.schemas)) {
    for (const table of namespace.tables) {
      for (const index of table.indexes ?? []) {
        keys.add(
          [
            `${schemaName}.${table.name}.${index.name}`,
            `unique=${index.unique ? "1" : "0"}`,
            `primary=${index.primary ? "1" : "0"}`,
            `columns=${index.columns.join("|")}`,
            `definition=${index.definition ?? ""}`,
          ].join("::"),
        );
      }
    }
  }
  return keys;
}

function collectForeignKeyKeys(ir: SchemaIR): Set<string> {
  const keys = new Set<string>();
  for (const [schemaName, namespace] of Object.entries(ir.schemas)) {
    for (const table of namespace.tables) {
      for (const fk of table.foreignKeys?.outbound ?? []) {
        keys.add(
          [
            `${schemaName}.${table.name}.${fk.constraintName}`,
            `columns=${fk.columns.join("|")}`,
            `target=${fk.targetSchema}.${fk.targetTable}`,
            `targetColumns=${fk.targetColumns.join("|")}`,
            `onUpdate=${fk.onUpdate}`,
            `onDelete=${fk.onDelete}`,
          ].join("::"),
        );
      }
    }
  }
  return keys;
}

function collectRlsKeys(ir: SchemaIR): Set<string> {
  const keys = new Set<string>();
  for (const [schemaName, namespace] of Object.entries(ir.schemas)) {
    for (const table of namespace.tables) {
      if (!table.rls) {
        continue;
      }

      keys.add(
        [
          `${schemaName}.${table.name}::__state`,
          `enabled=${table.rls.rlsEnabled ? "1" : "0"}`,
          `force=${table.rls.forceRls ? "1" : "0"}`,
        ].join("::"),
      );

      for (const policy of table.rls.policies) {
        keys.add(
          [
            `${schemaName}.${table.name}.${policy.name}`,
            `mode=${policy.mode}`,
            `command=${policy.command}`,
            `roles=${[...policy.roles].sort().join("|")}`,
            `using=${policy.usingExpression ?? ""}`,
            `withCheck=${policy.withCheckExpression ?? ""}`,
          ].join("::"),
        );
      }
    }
  }
  return keys;
}

function collectTriggerKeys(ir: SchemaIR): Set<string> {
  const keys = new Set<string>();
  for (const [schemaName, namespace] of Object.entries(ir.schemas)) {
    for (const table of namespace.tables) {
      for (const trigger of table.triggers ?? []) {
        keys.add(
          [
            `${schemaName}.${table.name}.${trigger.name}`,
            `enabledMode=${trigger.enabledMode}`,
            `timing=${trigger.timing}`,
            `events=${[...trigger.events].sort().join("|")}`,
          ].join("::"),
        );
      }
    }
  }
  return keys;
}

function hasIndexMetadata(ir: SchemaIR): boolean {
  for (const namespace of Object.values(ir.schemas)) {
    for (const table of namespace.tables) {
      if (table.indexes !== undefined) {
        return true;
      }
    }
  }
  return false;
}

function hasForeignKeyMetadata(ir: SchemaIR): boolean {
  for (const namespace of Object.values(ir.schemas)) {
    for (const table of namespace.tables) {
      if (table.foreignKeys !== undefined) {
        return true;
      }
    }
  }
  return false;
}

function hasRlsMetadata(ir: SchemaIR): boolean {
  for (const namespace of Object.values(ir.schemas)) {
    for (const table of namespace.tables) {
      if (table.rls !== undefined) {
        return true;
      }
    }
  }
  return false;
}

function hasTriggerMetadata(ir: SchemaIR): boolean {
  for (const namespace of Object.values(ir.schemas)) {
    for (const table of namespace.tables) {
      if (table.triggers !== undefined) {
        return true;
      }
    }
  }
  return false;
}

function diffKeys(stored: Set<string>, live: Set<string>): DbSchemaDiff {
  const additions: string[] = [];
  const removals: string[] = [];
  let unchangedCount = 0;

  for (const key of live) {
    if (!stored.has(key)) {
      additions.push(key);
    } else {
      unchangedCount += 1;
    }
  }

  for (const key of stored) {
    if (!live.has(key)) {
      removals.push(key);
    }
  }

  return {
    additions: additions.sort(),
    removals: removals.sort(),
    unchangedCount,
  };
}

function emptyDiff(): DbSchemaDiff {
  return {
    additions: [],
    removals: [],
    unchangedCount: 0,
  };
}

function diffRichKeys(
  storedIR: SchemaIR,
  liveIR: SchemaIR,
  hasStoredMetadata: (ir: SchemaIR) => boolean,
  collectKeys: (ir: SchemaIR) => Set<string>,
): DbSchemaDiff {
  if (!hasStoredMetadata(storedIR)) {
    return emptyDiff();
  }

  return diffKeys(collectKeys(storedIR), collectKeys(liveIR));
}

export function computeVerificationDiff(
  storedIR: SchemaIR,
  liveIR: SchemaIR,
  options: { includedSchemas?: readonly string[] } = {},
): VerificationDiff {
  const hasFilter = options.includedSchemas && options.includedSchemas.length > 0;
  const storedScoped = hasFilter
    ? filterIRBySchemas(storedIR, options.includedSchemas!)
    : storedIR;
  const liveScoped = hasFilter
    ? filterIRBySchemas(liveIR, options.includedSchemas!)
    : liveIR;

  return {
    tableDiff: diffKeys(collectTableKeys(storedScoped), collectTableKeys(liveScoped)),
    columnDiff: diffKeys(collectColumnKeys(storedScoped), collectColumnKeys(liveScoped)),
    enumDiff: diffKeys(collectEnumKeys(storedScoped), collectEnumKeys(liveScoped)),
    rpcDiff: diffKeys(collectRpcKeys(storedScoped), collectRpcKeys(liveScoped)),
    indexDiff: diffRichKeys(storedScoped, liveScoped, hasIndexMetadata, collectIndexKeys),
    foreignKeyDiff: diffRichKeys(storedScoped, liveScoped, hasForeignKeyMetadata, collectForeignKeyKeys),
    rlsDiff: diffRichKeys(storedScoped, liveScoped, hasRlsMetadata, collectRlsKeys),
    triggerDiff: diffRichKeys(storedScoped, liveScoped, hasTriggerMetadata, collectTriggerKeys),
  };
}

export function diffHasAnyDifference(diff: VerificationDiff): boolean {
  return (
    diff.tableDiff.additions.length > 0 ||
    diff.tableDiff.removals.length > 0 ||
    diff.columnDiff.additions.length > 0 ||
    diff.columnDiff.removals.length > 0 ||
    diff.enumDiff.additions.length > 0 ||
    diff.enumDiff.removals.length > 0 ||
    diff.rpcDiff.additions.length > 0 ||
    diff.rpcDiff.removals.length > 0 ||
    diff.indexDiff.additions.length > 0 ||
    diff.indexDiff.removals.length > 0 ||
    diff.foreignKeyDiff.additions.length > 0 ||
    diff.foreignKeyDiff.removals.length > 0 ||
    diff.rlsDiff.additions.length > 0 ||
    diff.rlsDiff.removals.length > 0 ||
    diff.triggerDiff.additions.length > 0 ||
    diff.triggerDiff.removals.length > 0
  );
}

export async function verifyProjectDb(
  projectReference: string,
  options: IndexerOptions & VerifyProjectDbOptions = {},
): Promise<DbVerificationResult> {
  return withResolvedProjectContext(projectReference, options, async ({ project, projectStore }) => {
    const manifest = readProjectManifest(project.canonicalPath);
    if (!manifest) {
      throw new ProjectCommandError(
        422,
        "project_manifest_invalid",
        `Project manifest is missing for: ${project.canonicalPath}`,
      );
    }

    const resolvedUrl = resolveLiveDbUrl(manifest.database.liveBinding);

    const verifyStartedAt = new Date().toISOString();
    let verificationResult: DbVerificationResult | undefined;
    let verificationError: unknown;

    try {
      const storedSnapshot = projectStore.loadSchemaSnapshot();
      if (!storedSnapshot) {
        throw new ProjectCommandError(
          412,
          "db_refresh_failed",
          "No stored schema snapshot to verify against. Run `mako project index` first.",
          { projectReference },
        );
      }

      const liveIR = await fetchLiveSchemaIR({
        databaseUrl: resolvedUrl.url,
        includedSchemas: options.includedSchemas,
      });

      const diff = computeVerificationDiff(storedSnapshot.ir, liveIR, {
        includedSchemas: options.includedSchemas,
      });

      const verifiedAt = new Date().toISOString();
      const drift = diffHasAnyDifference(diff);
      const isPartial = Boolean(options.includedSchemas && options.includedSchemas.length > 0);

      // Partial verifies (--schemas) are informational only. They must not stamp
      // project-wide verification state because the comparison excludes other schemas.
      if (!isPartial) {
        if (drift) {
          projectStore.markSchemaSnapshotDrift({ driftDetectedAt: verifiedAt });
        } else {
          projectStore.markSchemaSnapshotVerified({ verifiedAt });
        }
        projectStore.markDbBindingVerified({ verifiedAt });
      }

      verificationResult = {
        outcome: drift ? "drift_detected" : "verified",
        verifiedAt,
        partial: isPartial,
        ...(options.includedSchemas ? { includedSchemas: [...options.includedSchemas] } : {}),
        snapshotId: storedSnapshot.snapshotId,
        tableDiff: diff.tableDiff,
        columnDiff: diff.columnDiff,
        enumDiff: diff.enumDiff,
        rpcDiff: diff.rpcDiff,
        indexDiff: diff.indexDiff,
        foreignKeyDiff: diff.foreignKeyDiff,
        rlsDiff: diff.rlsDiff,
        triggerDiff: diff.triggerDiff,
      };

      return verificationResult;
    } catch (error) {
      verificationError = error;
      throw error;
    } finally {
      const finishedAt = new Date().toISOString();
      try {
        projectStore.insertLifecycleEvent({
          projectId: project.projectId,
          eventType: "db_verify",
          outcome: verificationError ? "failed" : "success",
          startedAt: verifyStartedAt,
          finishedAt,
          durationMs: durationMs(verifyStartedAt, finishedAt),
          metadata: {
            includedSchemas: options.includedSchemas ?? [],
            verificationOutcome: verificationResult?.outcome ?? null,
            partial: verificationResult?.partial ?? null,
            snapshotId: verificationResult?.snapshotId ?? null,
            diff: (verificationResult
              ? {
                  tableDiff: verificationResult.tableDiff,
                  columnDiff: verificationResult.columnDiff,
                  enumDiff: verificationResult.enumDiff,
                  rpcDiff: verificationResult.rpcDiff,
                  indexDiff: verificationResult.indexDiff,
                  foreignKeyDiff: verificationResult.foreignKeyDiff,
                  rlsDiff: verificationResult.rlsDiff,
                  triggerDiff: verificationResult.triggerDiff,
                }
              : null) as unknown as JsonValue,
          },
          errorText:
            verificationError instanceof Error
              ? verificationError.message
              : verificationError
                ? String(verificationError)
                : undefined,
        });
      } catch (error) {
        verifyLogger.warn("log-write-failed", {
          eventType: "db_verify",
          projectId: project.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}
