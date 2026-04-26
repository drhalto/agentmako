import type { ComposerQueryKind, QueryKind, ReasoningTier } from "@mako-ai/contracts";

export interface QueryPlan {
  kind: QueryKind;
  defaultTier: ReasoningTier;
  description: string;
  primaryEvidence: string[];
}

// Composers produce their own AnswerPackets and do not flow through the answer
// engine's plan→handler path. QUERY_PLANS intentionally excludes composer kinds.
export type AnswerEngineQueryKind = Exclude<QueryKind, ComposerQueryKind>;

export const QUERY_PLANS: Record<AnswerEngineQueryKind, QueryPlan> = {
  route_trace: {
    kind: "route_trace",
    defaultTier: "standard",
    description: "Trace a route from entrypoint to handler and adjacent dependencies.",
    primaryEvidence: ["routes", "files", "symbols", "graph"],
  },
  schema_usage: {
    kind: "schema_usage",
    defaultTier: "standard",
    description: "Find where a schema object is defined and consumed in the repo.",
    primaryEvidence: ["schema_objects", "schema_usages", "files", "symbols"],
  },
  auth_path: {
    kind: "auth_path",
    defaultTier: "deep",
    description: "Trace likely authorization and session boundaries for a flow.",
    primaryEvidence: ["project_profile", "routes", "files", "graph", "findings"],
  },
  file_health: {
    kind: "file_health",
    defaultTier: "fast",
    description: "Summarize the health of a file and its nearby dependencies.",
    primaryEvidence: ["files", "findings", "graph", "symbols"],
  },
  free_form: {
    kind: "free_form",
    defaultTier: "standard",
    description: "Fallback plan when a question does not map cleanly to a named query kind.",
    primaryEvidence: ["files", "findings", "graph"],
  },
};
