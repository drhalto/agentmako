/**
 * Zod schema for YAML rule-pack validation.
 *
 * The parsed YAML is an `unknown` until this schema stamps it. Every field
 * here matches `RuleDefinition` / `RulePack` in `./types.ts`; the schema is
 * the runtime enforcement layer for those contracts.
 */

import { z } from "zod";

const CATEGORY = z.enum([
  "trust",
  "producer_consumer_drift",
  "identity_key_mismatch",
  "rpc_helper_reuse",
  "auth_role_drift",
  "sql_alignment",
  "ranking",
]);

const SEVERITY = z.enum(["low", "medium", "high", "critical"]);
const CONFIDENCE = z.enum(["possible", "probable", "confirmed"]);
const LANGUAGE = z.enum(["ts", "tsx", "js", "jsx"]);
const CANONICAL_HELPER_MODE = z.enum(["absent_in_consumer"]);

const jsonLiteral = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonValue = z.infer<typeof jsonLiteral> | { [key: string]: JsonValue } | JsonValue[];
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonLiteral, z.array(jsonValue), z.record(z.string(), jsonValue)]),
);
const jsonObject: z.ZodType<Record<string, JsonValue>> = z.record(z.string(), jsonValue);
const canonicalHelper = z.object({
  symbol: z.string().min(1, "canonical helper symbol must be non-empty"),
  path: z.string().min(1, "canonical helper path must be non-empty").optional(),
  mode: CANONICAL_HELPER_MODE.optional(),
});

export const ruleDefinitionSchema = z
  .object({
    id: z.string().min(1, "rule id must be non-empty"),
    category: CATEGORY,
    severity: SEVERITY,
    confidence: CONFIDENCE.optional(),
    languages: z.array(LANGUAGE).nonempty().optional(),
    message: z.string().min(1, "rule message must be non-empty"),
    pattern: z.string().min(1).optional(),
    patterns: z.array(z.string().min(1)).nonempty().optional(),
    canonicalHelper: canonicalHelper.optional(),
    metadata: jsonObject.optional(),
  })
  .refine(
    (rule) => rule.pattern != null || (rule.patterns != null && rule.patterns.length > 0),
    { message: "rule must declare a `pattern` or a non-empty `patterns` array" },
  )
  .refine((rule) => !(rule.pattern != null && rule.patterns != null), {
    message: "rule must declare either `pattern` or `patterns`, not both",
  });

export const rulePackSchema = z.object({
  name: z.string().min(1).optional(),
  rules: z.array(ruleDefinitionSchema).nonempty("rule pack must declare at least one rule"),
});

export type RulePackInput = z.infer<typeof rulePackSchema>;
