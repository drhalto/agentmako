import type { ReefCalculationNode } from "@mako-ai/contracts";
import { ReefCalculationRegistry } from "@mako-ai/contracts";

export const REEF_QUERY_CALCULATION_EXTRACTOR_VERSION = "mako-reef-query-calculation@1";

export const REEF_WHERE_USED_QUERY_KIND = "where_used";
export const REEF_IMPACT_QUERY_KIND = "impact";
export const REEF_TABLE_NEIGHBORHOOD_QUERY_KIND = "table_neighborhood";
export const REEF_RPC_NEIGHBORHOOD_QUERY_KIND = "rpc_neighborhood";
export const REEF_ROUTE_CONTEXT_QUERY_KIND = "route_context";
export const REEF_DIAGNOSTIC_COVERAGE_QUERY_KIND = "diagnostic_coverage";
export const REEF_ACTIVE_FINDING_STATUS_QUERY_KIND = "active_finding_status";
export const REEF_DUPLICATE_CANDIDATES_QUERY_KIND = "duplicate_candidates";

export const REEF_WHERE_USED_NODE: ReefCalculationNode = {
  id: "reef.query.where_used",
  kind: "derived_query",
  version: "1.0.0",
  description: "Calculates maintained definitions and direct usage surfaces for a file, route, symbol, component, or pattern.",
  outputs: [{ kind: "query", queryKind: REEF_WHERE_USED_QUERY_KIND }],
  dependsOn: [
    { kind: "artifact_kind", artifactKind: "ast_symbols", extractorVersion: "mako-ts-js-structure@1" },
    { kind: "artifact_kind", artifactKind: "import_edges", extractorVersion: "mako-ts-js-structure@1" },
    { kind: "artifact_kind", artifactKind: "routes", extractorVersion: "mako-ts-js-structure@1" },
    { kind: "diagnostic_source", source: "project_findings" },
  ],
  refreshScope: "project_scoped",
  fallback: "mark_stale",
  durability: "low",
  backdating: { strategy: "output_fingerprint", equalityKeys: ["definitions", "usages"] },
};

export const REEF_IMPACT_NODE: ReefCalculationNode = {
  id: "reef.query.impact",
  kind: "derived_query",
  version: "1.0.0",
  description: "Calculates import-graph callers affected by changed files before live overlay, finding, and convention filters are applied.",
  outputs: [{ kind: "query", queryKind: REEF_IMPACT_QUERY_KIND }],
  dependsOn: [
    { kind: "artifact_kind", artifactKind: "ast_symbols", extractorVersion: "mako-ts-js-structure@1" },
    { kind: "artifact_kind", artifactKind: "import_edges", extractorVersion: "mako-ts-js-structure@1" },
    { kind: "fact_kind", factKind: "file_snapshot" },
    { kind: "diagnostic_source", source: "project_findings" },
  ],
  refreshScope: "project_scoped",
  fallback: "mark_stale",
  durability: "low",
  backdating: { strategy: "output_fingerprint", equalityKeys: ["impactedCallers"] },
};

export const REEF_TABLE_NEIGHBORHOOD_NODE: ReefCalculationNode = {
  id: "reef.query.table_neighborhood",
  kind: "derived_query",
  version: "1.0.0",
  description: "Calculates table schema, app usage, dependent RPC, route, and RLS neighborhood evidence.",
  outputs: [{ kind: "query", queryKind: REEF_TABLE_NEIGHBORHOOD_QUERY_KIND }],
  dependsOn: [
    { kind: "schema_snapshot" },
    { kind: "fact_kind", factKind: "db_table" },
    { kind: "fact_kind", factKind: "db_usage" },
    { kind: "artifact_kind", artifactKind: "routes", extractorVersion: "mako-ts-js-structure@1" },
  ],
  refreshScope: "project_scoped",
  fallback: "mark_stale",
  durability: "low",
  backdating: { strategy: "output_fingerprint" },
};

export const REEF_RPC_NEIGHBORHOOD_NODE: ReefCalculationNode = {
  id: "reef.query.rpc_neighborhood",
  kind: "derived_query",
  version: "1.0.0",
  description: "Calculates RPC signature, app callers, touched tables, and RLS neighborhood evidence.",
  outputs: [{ kind: "query", queryKind: REEF_RPC_NEIGHBORHOOD_QUERY_KIND }],
  dependsOn: [
    { kind: "schema_snapshot" },
    { kind: "fact_kind", factKind: "db_rpc" },
    { kind: "fact_kind", factKind: "db_usage" },
    { kind: "fact_kind", factKind: "db_rls_policy" },
  ],
  refreshScope: "project_scoped",
  fallback: "mark_stale",
  durability: "low",
  backdating: { strategy: "output_fingerprint" },
};

export const REEF_ROUTE_CONTEXT_NODE: ReefCalculationNode = {
  id: "reef.query.route_context",
  kind: "derived_query",
  version: "1.0.0",
  description: "Calculates route handler context, import neighborhood, downstream schema touches, and RLS surfaces.",
  outputs: [{ kind: "query", queryKind: REEF_ROUTE_CONTEXT_QUERY_KIND }],
  dependsOn: [
    { kind: "artifact_kind", artifactKind: "routes", extractorVersion: "mako-ts-js-structure@1" },
    { kind: "artifact_kind", artifactKind: "import_edges", extractorVersion: "mako-ts-js-structure@1" },
    { kind: "schema_snapshot" },
    { kind: "fact_kind", factKind: "db_usage" },
  ],
  refreshScope: "project_scoped",
  fallback: "mark_stale",
  durability: "low",
  backdating: { strategy: "output_fingerprint" },
};

export const REEF_DIAGNOSTIC_COVERAGE_NODE: ReefCalculationNode = {
  id: "reef.query.diagnostic_coverage",
  kind: "derived_query",
  version: "1.0.0",
  description: "Calculates diagnostic freshness and changed-file coverage across persisted diagnostic runs.",
  outputs: [{ kind: "query", queryKind: REEF_DIAGNOSTIC_COVERAGE_QUERY_KIND }],
  dependsOn: [
    { kind: "diagnostic_source", source: "all" },
    { kind: "fact_kind", factKind: "file_snapshot" },
  ],
  refreshScope: "project_scoped",
  fallback: "mark_stale",
  durability: "low",
  backdating: { strategy: "output_fingerprint" },
};

export const REEF_ACTIVE_FINDING_STATUS_NODE: ReefCalculationNode = {
  id: "reef.query.active_finding_status",
  kind: "derived_query",
  version: "1.0.0",
  description: "Calculates active durable finding status grouped by file, rule, source, severity, and freshness.",
  outputs: [{ kind: "query", queryKind: REEF_ACTIVE_FINDING_STATUS_QUERY_KIND }],
  dependsOn: [{ kind: "diagnostic_source", source: "project_findings" }],
  refreshScope: "project_scoped",
  fallback: "mark_stale",
  durability: "low",
  backdating: { strategy: "output_fingerprint" },
};

export const REEF_DUPLICATE_CANDIDATES_NODE: ReefCalculationNode = {
  id: "reef.query.duplicate_candidates",
  kind: "derived_query",
  version: "1.0.0",
  description: "Calculates duplicate and near-duplicate candidates from durable findings, risks, imports, routes, and interaction artifacts.",
  outputs: [{ kind: "query", queryKind: REEF_DUPLICATE_CANDIDATES_QUERY_KIND }],
  dependsOn: [
    { kind: "artifact_kind", artifactKind: "code_interactions", extractorVersion: "mako-ts-js-structure@1" },
    { kind: "artifact_kind", artifactKind: "routes", extractorVersion: "mako-ts-js-structure@1" },
    { kind: "diagnostic_source", source: "project_findings" },
  ],
  refreshScope: "project_scoped",
  fallback: "mark_stale",
  durability: "low",
  backdating: { strategy: "output_fingerprint" },
};

export const REEF_QUERY_CALCULATION_NODES = [
  REEF_WHERE_USED_NODE,
  REEF_IMPACT_NODE,
  REEF_TABLE_NEIGHBORHOOD_NODE,
  REEF_RPC_NEIGHBORHOOD_NODE,
  REEF_ROUTE_CONTEXT_NODE,
  REEF_DIAGNOSTIC_COVERAGE_NODE,
  REEF_ACTIVE_FINDING_STATUS_NODE,
  REEF_DUPLICATE_CANDIDATES_NODE,
] as const;

export function createReefQueryCalculationRegistry(): ReefCalculationRegistry {
  return new ReefCalculationRegistry([...REEF_QUERY_CALCULATION_NODES]);
}
