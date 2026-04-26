import type { ExtensionManifest } from "@mako-ai/sdk";

export const manifest: ExtensionManifest = {
  id: "supabase",
  displayName: "Supabase",
  version: "0.1.0",
  kind: "schema-source",
  capabilities: [
    {
      kind: "rls-introspection",
      description: "Adds Supabase-specific auth and RLS metadata to project indexing.",
    },
  ],
};

// Supabase platform detection lives in @mako-ai/extension-postgres `fetchPingInfo`
// because the detection is cheap catalog-based heuristics that reuse the same
// read-only connection. Phase 3 treats Supabase as PostgreSQL-compatible first;
// this module stays intentionally thin to avoid forking the design around
// Supabase-specific APIs before a real gap appears.

export const SUPABASE_MARKER_SCHEMAS = Object.freeze(["auth", "storage", "supabase_functions"] as const);
