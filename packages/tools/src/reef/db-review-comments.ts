import type {
  DbReviewCommentToolInput,
  DbReviewCommentToolOutput,
  DbReviewCommentsToolInput,
  DbReviewCommentsToolOutput,
  DbReviewObjectType,
  DbReviewTarget,
} from "@mako-ai/contracts";
import { withProjectContext } from "../entity-resolver.js";
import type { ToolServiceOptions } from "../runtime.js";

const SCHEMA_BOUND_OBJECT_TYPES = new Set<DbReviewObjectType>([
  "schema",
  "table",
  "view",
  "column",
  "index",
  "foreign_key",
  "rpc",
  "function",
  "policy",
  "rls_policy",
  "trigger",
  "enum",
]);

export async function dbReviewCommentTool(
  input: DbReviewCommentToolInput,
  options: ToolServiceOptions,
): Promise<DbReviewCommentToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const target = normalizeDbReviewTarget(input);
    const comment = projectStore.insertDbReviewComment({
      projectId: project.projectId,
      target,
      category: input.category ?? "review",
      ...(input.severity ? { severity: input.severity } : {}),
      comment: input.comment,
      tags: normalizeTags(input.tags),
      createdBy: input.createdBy ?? "ai",
      sourceToolName: "db_review_comment",
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });

    return {
      toolName: "db_review_comment",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      comment,
      warnings: [],
    };
  });
}

export async function dbReviewCommentsTool(
  input: DbReviewCommentsToolInput,
  options: ToolServiceOptions,
): Promise<DbReviewCommentsToolOutput> {
  return await withProjectContext(input, options, ({ project, projectStore }) => {
    const target = targetFromQuery(input);
    const requestedLimit = input.limit ?? 100;
    const queryLimit = input.tag ? Math.min(500, Math.max(requestedLimit * 5, requestedLimit)) : requestedLimit;
    const comments = projectStore.queryDbReviewComments({
      projectId: project.projectId,
      ...(input.targetFingerprint ? { targetFingerprint: input.targetFingerprint } : {}),
      ...(input.objectType ? { objectType: input.objectType } : {}),
      ...(input.objectName ? { objectName: input.objectName } : {}),
      ...(input.schemaName ? { schemaName: input.schemaName } : {}),
      ...(input.parentObjectName ? { parentObjectName: input.parentObjectName } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.query ? { query: input.query } : {}),
      limit: queryLimit,
    });
    const tag = input.tag?.trim().toLowerCase();
    const filtered = tag
      ? comments.filter((comment) => comment.tags.some((item) => item.toLowerCase() === tag))
      : comments;
    const limited = filtered.slice(0, requestedLimit);

    return {
      toolName: "db_review_comments",
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      comments: limited,
      totalReturned: limited.length,
      filters: {
        ...(target ? { target } : {}),
        ...(input.targetFingerprint ? { targetFingerprint: input.targetFingerprint } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(tag ? { tag } : {}),
        ...(input.query ? { query: input.query } : {}),
      },
      warnings: tag && filtered.length > limited.length
        ? [`Tag filter matched ${filtered.length} comment(s); output was limited to ${requestedLimit}.`]
        : [],
    };
  });
}

function normalizeDbReviewTarget(input: {
  objectType: DbReviewObjectType;
  objectName: string;
  schemaName?: string;
  parentObjectName?: string;
}): DbReviewTarget {
  const schemaName = input.schemaName?.trim()
    ?? (SCHEMA_BOUND_OBJECT_TYPES.has(input.objectType) ? "public" : undefined);
  return {
    objectType: input.objectType,
    objectName: input.objectName.trim(),
    ...(schemaName ? { schemaName } : {}),
    ...(input.parentObjectName?.trim() ? { parentObjectName: input.parentObjectName.trim() } : {}),
  };
}

function targetFromQuery(input: DbReviewCommentsToolInput): DbReviewTarget | undefined {
  if (!input.objectType && !input.objectName && !input.schemaName && !input.parentObjectName) {
    return undefined;
  }
  if (!input.objectType || !input.objectName) {
    return undefined;
  }
  return normalizeDbReviewTarget({
    objectType: input.objectType,
    objectName: input.objectName,
    schemaName: input.schemaName,
    parentObjectName: input.parentObjectName,
  });
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}
