export type Timestamp = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type SupportLevel = "native" | "adapted" | "best_effort";
export type EvidenceStatus = "complete" | "partial";
export type ReasoningTier = "fast" | "standard" | "deep";

export type ProjectStatus = "active" | "detached" | "archived";
export type IndexRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Severity = "low" | "medium" | "high" | "critical";
export type FindingStatus = "open" | "accepted" | "ignored" | "fixed";
