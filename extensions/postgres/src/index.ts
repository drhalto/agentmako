import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "postgres",
  displayName: "Postgres",
  version: "0.1.0",
  kind: "schema-source",
  capabilities: [
    {
      kind: "schema-introspection",
      description: "Reads database schema metadata without mutating the source database.",
    },
  ],
};

export {
  PgConnectionError,
  withReadOnlyConnection,
  type PgConnectionOptions,
  type PgReadContext,
} from "./connection.js";

export {
  fetchPingInfo,
  type PgPingResult,
  type PgPlatform,
} from "./ping.js";

export {
  resolveTable,
  resolveFunction,
  type PgObjectCandidate,
  type PgObjectKind,
  type PgRoutineCandidate,
  type PgResolvedFunction,
  type PgResolvedTable,
  type PgResolveResult,
  type PgTableObjectCandidate,
} from "./identifiers.js";

export {
  fetchColumns,
  type PgColumnDescriptor,
} from "./columns.js";

export {
  fetchForeignKeys,
  type PgForeignKeyInbound,
  type PgForeignKeyOutbound,
  type PgForeignKeyResult,
} from "./foreign-keys.js";

export {
  fetchRls,
  type PgRlsPolicy,
  type PgRlsResult,
} from "./rls.js";

export {
  fetchRpc,
  fetchRpcs,
  type PgRpcArgMode,
  type PgRpcArgument,
  type PgRpcListEntry,
  type PgRpcResult,
  type PgRpcVolatility,
  type FetchRpcOptions,
  type FetchRpcsOptions,
} from "./rpc.js";

export {
  fetchTableSchema,
  fetchTableSchemas,
  type PgConstraintDescriptor,
  type PgIndexDescriptor,
  type PgTableSchemaResult,
  type PgTriggerDescriptor,
} from "./table-schema.js";
