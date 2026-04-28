import type {
  JsonObject,
  SchemaSnapshot,
  SchemaSourceRef,
} from "@mako-ai/contracts";
import type {
  ResolvedSchemaObjectRecord,
  SchemaObjectDetail,
} from "./types.js";

export function listSchemaSnapshotObjects(snapshot: SchemaSnapshot | null | undefined): ResolvedSchemaObjectRecord[] {
  if (!snapshot) {
    return [];
  }

  const out: ResolvedSchemaObjectRecord[] = [];
  let objectId = -1;
  for (const [schemaName, namespace] of Object.entries(snapshot.ir.schemas)) {
    out.push({
      objectId: objectId--,
      objectType: "schema",
      schemaName,
      objectName: schemaName,
      definition: snapshotDefinition([], { snapshotId: snapshot.snapshotId }),
    });

    for (const table of namespace.tables) {
      out.push({
        objectId: objectId--,
        objectType: "table",
        schemaName: table.schema,
        objectName: table.name,
        definition: snapshotDefinition(table.sources, {
          snapshotId: snapshot.snapshotId,
          columnCount: table.columns.length,
          rlsEnabled: table.rls?.rlsEnabled ?? false,
        }),
      });

      for (const column of table.columns) {
        out.push({
          objectId: objectId--,
          objectType: "column",
          schemaName: table.schema,
          parentObjectName: table.name,
          objectName: column.name,
          dataType: column.dataType,
          definition: snapshotDefinition(column.sources, {
            snapshotId: snapshot.snapshotId,
            nullable: column.nullable,
            isPrimaryKey: column.isPrimaryKey ?? false,
          }),
        });
      }

      for (const policy of table.rls?.policies ?? []) {
        out.push({
          objectId: objectId--,
          objectType: "policy",
          schemaName: table.schema,
          parentObjectName: table.name,
          objectName: policy.name,
          definition: snapshotDefinition(table.sources, {
            snapshotId: snapshot.snapshotId,
            command: policy.command,
            mode: policy.mode,
          }),
        });
      }

      for (const trigger of table.triggers ?? []) {
        out.push({
          objectId: objectId--,
          objectType: "trigger",
          schemaName: table.schema,
          parentObjectName: table.name,
          objectName: trigger.name,
          definition: snapshotDefinition(table.sources, {
            snapshotId: snapshot.snapshotId,
            timing: trigger.timing,
            events: trigger.events,
          }),
        });
      }
    }

    for (const view of namespace.views) {
      out.push({
        objectId: objectId--,
        objectType: "view",
        schemaName: view.schema,
        objectName: view.name,
        definition: snapshotDefinition(view.sources, { snapshotId: snapshot.snapshotId }),
      });
    }

    for (const enumObject of namespace.enums) {
      out.push({
        objectId: objectId--,
        objectType: "enum",
        schemaName: enumObject.schema,
        objectName: enumObject.name,
        dataType: enumObject.values.join(" | "),
        definition: snapshotDefinition(enumObject.sources, {
          snapshotId: snapshot.snapshotId,
          values: enumObject.values,
        }),
      });
    }

    for (const rpc of namespace.rpcs) {
      out.push({
        objectId: objectId--,
        objectType: "rpc",
        schemaName: rpc.schema,
        objectName: rpc.name,
        dataType: rpc.returnType,
        definition: snapshotDefinition(rpc.sources, {
          snapshotId: snapshot.snapshotId,
          argTypes: rpc.argTypes ?? [],
        }),
      });
    }
  }

  return out;
}

export function searchSchemaSnapshotObjects(
  snapshot: SchemaSnapshot | null | undefined,
  queryText: string,
  limit = 5,
): ResolvedSchemaObjectRecord[] {
  const normalized = queryText.trim().toLowerCase();
  if (normalized === "") {
    return [];
  }

  return listSchemaSnapshotObjects(snapshot)
    .map((object) => ({
      object,
      score: scoreSnapshotObject(object, normalized),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      left.object.objectType.localeCompare(right.object.objectType) ||
      left.object.schemaName.localeCompare(right.object.schemaName) ||
      (left.object.parentObjectName ?? "").localeCompare(right.object.parentObjectName ?? "") ||
      left.object.objectName.localeCompare(right.object.objectName)
    )
    .slice(0, limit)
    .map((entry) => entry.object);
}

export function getSchemaSnapshotObjectDetail(
  snapshot: SchemaSnapshot | null | undefined,
  queryText: string,
): SchemaObjectDetail | null {
  const normalized = queryText.trim().toLowerCase();
  if (normalized === "") {
    return null;
  }

  const object = listSchemaSnapshotObjects(snapshot).find((candidate) =>
    schemaSnapshotObjectIdentifiers(candidate).includes(normalized),
  );
  return object ? { object, usages: [] } : null;
}

export function schemaSnapshotObjectIdentifiers(object: ResolvedSchemaObjectRecord): string[] {
  const identifiers = [object.objectName];

  if (object.parentObjectName) {
    identifiers.push(`${object.parentObjectName}.${object.objectName}`);
    identifiers.push(`${object.schemaName}.${object.parentObjectName}.${object.objectName}`);
  }

  identifiers.push(`${object.schemaName}.${object.objectName}`);
  return [...new Set(identifiers.map((identifier) => identifier.toLowerCase()))];
}

function scoreSnapshotObject(object: ResolvedSchemaObjectRecord, normalizedQuery: string): number {
  const identifiers = schemaSnapshotObjectIdentifiers(object);
  if (identifiers.includes(normalizedQuery)) {
    return object.objectType === "table" || object.objectType === "rpc" ? 500 : 450;
  }

  const terms = normalizedQuery.split(/[^a-z0-9_]+/i).filter(Boolean);
  if (terms.length === 0) {
    return 0;
  }

  const haystack = [
    object.objectType,
    object.schemaName,
    object.parentObjectName ?? "",
    object.objectName,
    ...identifiers,
  ].join(" ").toLowerCase();
  if (!terms.every((term) => haystack.includes(term))) {
    return 0;
  }

  let score = 100;
  if (object.objectName.toLowerCase().includes(normalizedQuery)) score += 120;
  if (`${object.schemaName}.${object.objectName}`.toLowerCase().includes(normalizedQuery)) score += 160;
  if (object.objectType === "table" || object.objectType === "rpc") score += 40;
  return score;
}

function snapshotDefinition(refs: readonly SchemaSourceRef[], metadata: JsonObject): JsonObject {
  const source = refs[0];
  return {
    source: "schema_snapshot",
    ...metadata,
    ...(source ? { sourceKind: source.kind, sourceFilePath: source.path } : {}),
    ...(source?.line != null ? { line: source.line } : {}),
  };
}
