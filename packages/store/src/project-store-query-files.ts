import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  type FileRow,
  type FileSearchRow,
  type ImportLinkRow,
  type RankedFileSearchRow,
  type RouteRow,
  type SymbolRow,
  buildFtsPhraseMatchExpression,
  buildFtsPrefixMatchExpression,
  extractSearchTokens,
  mapFileSearchRow,
  mapFileSummaryRow,
  mapImportLinkRow,
  mapRouteRow,
  mapSymbolRow,
  normalizeSearchText,
} from "./project-store-query-helpers.js";
import type {
  FileDetailRecord,
  FileImportLink,
  FileSearchMatch,
  FileSummaryRecord,
  ResolvedRouteRecord,
  SymbolRecord,
} from "./types.js";

type PreparedStatementResolver = (sql: string) => StatementSync;

function prepare(db: DatabaseSync, prepared: PreparedStatementResolver | undefined, sql: string): StatementSync {
  return prepared ? prepared(sql) : db.prepare(sql);
}

export function findFileImpl(
  db: DatabaseSync,
  fileQuery: string,
  prepared?: PreparedStatementResolver,
): FileSummaryRecord | null {
  const normalized = normalizeSearchText(fileQuery);
  const likeQuery = `%${normalized}%`;
  const row = prepare(
    db,
    prepared,
    `
      SELECT
        file_id,
        path,
        sha256,
        language,
        size_bytes,
        line_count,
        is_generated,
        last_modified_at,
        indexed_at
      FROM files
      WHERE path = ? OR path LIKE ?
      ORDER BY
        CASE
          WHEN path = ? THEN 0
          WHEN path LIKE ? THEN 1
          ELSE 2
        END,
        length(path) ASC
      LIMIT 1
    `,
  ).get(normalized, likeQuery, normalized, likeQuery) as FileRow | undefined;

  return mapFileSummaryRow(row);
}

export function searchFilesImpl(
  db: DatabaseSync,
  queryText: string,
  limit = 5,
  options: { mode?: "prefix_and" | "phrase" } = {},
): FileSearchMatch[] {
  const normalized = normalizeSearchText(queryText);
  if (normalized === "") {
    return [];
  }

  const likeQuery = `%${normalized}%`;
  const directRows = db
    .prepare(`
      SELECT DISTINCT
        f.file_id,
        f.path,
        f.sha256,
        f.language,
        f.size_bytes,
        f.line_count,
        f.is_generated,
        f.last_modified_at,
        f.indexed_at,
        NULL AS snippet
      FROM files f
      WHERE f.path LIKE ?
      ORDER BY
        CASE
          WHEN f.path = ? THEN 0
          WHEN f.path LIKE ? THEN 1
          ELSE 2
        END,
        f.path ASC
      LIMIT ?
    `)
    .all(likeQuery, normalized, likeQuery, limit * 2) as unknown as FileSearchRow[];

  const rankedRows: RankedFileSearchRow[] = directRows.map((row, index) => ({
    ...row,
    relevance_score: index,
  }));
  let ftsQuery: string | null;
  if (options.mode === "phrase") {
    ftsQuery = buildFtsPhraseMatchExpression(normalized);
  } else {
    ftsQuery = buildFtsPrefixMatchExpression(normalized);
  }

  const ftsRows =
    ftsQuery == null
      ? []
      : (db
          .prepare(`
            SELECT DISTINCT
              f.file_id,
              f.path,
              f.sha256,
              f.language,
              f.size_bytes,
              f.line_count,
              f.is_generated,
              f.last_modified_at,
              f.indexed_at,
              snippet(chunks_fts, 0, '', '', ' ... ', 24) AS snippet,
              bm25(chunks_fts) AS relevance_score
            FROM chunks_fts
            INNER JOIN chunks c ON c.chunk_id = chunks_fts.rowid
            INNER JOIN files f ON f.file_id = c.file_id
            WHERE chunks_fts MATCH ?
            ORDER BY relevance_score ASC, f.path ASC
            LIMIT ?
          `)
          .all(ftsQuery, limit * 3) as unknown as RankedFileSearchRow[]);

  const mergedRows = new Map<string, RankedFileSearchRow>();

  for (const row of rankedRows) {
    mergedRows.set(row.path, row);
  }

  for (const row of ftsRows) {
    if (!mergedRows.has(row.path)) {
      mergedRows.set(row.path, row);
    }
  }

  return [...mergedRows.values()].slice(0, limit).map(mapFileSearchRow);
}

export interface CodeChunkHit {
  filePath: string;
  sha256?: string;
  language?: string;
  sizeBytes?: number;
  lineCount?: number;
  isGenerated?: boolean;
  lastModifiedAt?: string;
  indexedAt?: string;
  chunkKind: string;
  name?: string;
  lineStart?: number;
  lineEnd?: number;
  snippet: string;
  score: number;
}

interface CodeChunkRow {
  chunk_kind: string;
  name: string | null;
  line_start: number | null;
  line_end: number | null;
  snippet: string;
  relevance_score: number;
  path: string;
  sha256: string | null;
  language: string;
  size_bytes: number | null;
  line_count: number | null;
  is_generated: number;
  last_modified_at: string | null;
  indexed_at: string;
}

export function searchCodeChunksImpl(
  db: DatabaseSync,
  queryText: string,
  options: { limit?: number; symbolOnly?: boolean; mode?: "prefix_and" | "phrase" } = {},
): CodeChunkHit[] {
  const normalized = normalizeSearchText(queryText);
  if (normalized === "") return [];
  const limit = options.limit ?? 20;
  let ftsQuery: string | null;
  if (options.mode === "phrase") {
    ftsQuery = buildFtsPhraseMatchExpression(normalized);
  } else {
    ftsQuery = buildFtsPrefixMatchExpression(normalized);
  }
  if (ftsQuery == null) return [];

  const symbolClause = options.symbolOnly ? "AND c.chunk_kind = 'symbol'" : "";
  const rows = db
    .prepare(`
      SELECT
        c.chunk_kind,
        c.name,
        c.line_start,
        c.line_end,
        snippet(chunks_fts, 0, '', '', ' ... ', 24) AS snippet,
        bm25(chunks_fts) AS relevance_score,
        f.path,
        f.sha256,
        f.language,
        f.size_bytes,
        f.line_count,
        f.is_generated,
        f.last_modified_at,
        f.indexed_at
      FROM chunks_fts
      INNER JOIN chunks c ON c.chunk_id = chunks_fts.rowid
      INNER JOIN files f ON f.file_id = c.file_id
      WHERE chunks_fts MATCH ?
        ${symbolClause}
      ORDER BY relevance_score ASC, f.path ASC
      LIMIT ?
    `)
    .all(ftsQuery, limit * 3) as unknown as CodeChunkRow[];

  return rows
    .slice(0, limit)
    .map((row) => ({
      filePath: row.path,
      sha256: row.sha256 ?? undefined,
      language: row.language,
      sizeBytes: row.size_bytes ?? undefined,
      lineCount: row.line_count ?? undefined,
      isGenerated: row.is_generated === 1,
      lastModifiedAt: row.last_modified_at ?? undefined,
      indexedAt: row.indexed_at,
      chunkKind: row.chunk_kind,
      name: row.name ?? undefined,
      lineStart: row.line_start ?? undefined,
      lineEnd: row.line_end ?? undefined,
      snippet: row.snippet,
      score: row.relevance_score,
    }));
}

export function searchRoutesImpl(db: DatabaseSync, queryText: string, limit = 5): ResolvedRouteRecord[] {
  const normalized = normalizeSearchText(queryText).toLowerCase();
  if (normalized === "") {
    return [];
  }

  const searchTokens = extractSearchTokens(normalized);
  const routeLikeQuery = normalized.startsWith("/") || /^(any|get|post|put|patch|delete|head|options)\s+\//i.test(normalized);
  const rows = db
    .prepare(`
      SELECT
        r.route_key,
        r.framework,
        r.pattern,
        r.method,
        r.handler_name,
        r.is_api,
        r.metadata_json,
        f.path AS file_path
      FROM routes r
      INNER JOIN files f ON f.file_id = r.file_id
    `)
    .all() as unknown as RouteRow[];

  return rows
    .map((row) => {
      const route = mapRouteRow(row);
      const haystack = [
        route.pattern,
        route.routeKey,
        route.method ?? "",
        route.handlerName ?? "",
        route.filePath,
      ]
        .join(" ")
        .toLowerCase();

      let score = 0;

      if (route.pattern.toLowerCase() === normalized) {
        score += 100;
      }

      if (route.routeKey.toLowerCase() === normalized) {
        score += 90;
      }

      const phraseMatched = haystack.includes(normalized);
      if (phraseMatched) {
        score += 60;
      }

      const matchedTokens = searchTokens.filter((token) => haystack.includes(token));
      if (routeLikeQuery && !phraseMatched && matchedTokens.length !== searchTokens.length) {
        return { route, score: 0 };
      }
      score += matchedTokens.length * 10;

      if (searchTokens.length > 1 && matchedTokens.length === searchTokens.length) {
        score += 20;
      }

      return { route, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.route.pattern !== right.route.pattern) {
        return left.route.pattern.localeCompare(right.route.pattern);
      }

      return (left.route.method ?? "ANY").localeCompare(right.route.method ?? "ANY");
    })
    .slice(0, limit)
    .map((item) => item.route);
}

export function listRoutesImpl(
  db: DatabaseSync,
  prepared?: PreparedStatementResolver,
): ResolvedRouteRecord[] {
  const rows = prepare(
    db,
    prepared,
    `
      SELECT
        r.route_key,
        r.framework,
        r.pattern,
        r.method,
        r.handler_name,
        r.is_api,
        r.metadata_json,
        f.path AS file_path
      FROM routes r
      INNER JOIN files f ON f.file_id = r.file_id
      ORDER BY r.pattern ASC, COALESCE(r.method, '') ASC, f.path ASC
    `,
  ).all() as unknown as RouteRow[];

  return rows.map(mapRouteRow);
}

export function listFilesImpl(
  db: DatabaseSync,
  prepared?: PreparedStatementResolver,
): FileSummaryRecord[] {
  const rows = prepare(
    db,
    prepared,
    `
      SELECT
        file_id,
        path,
        sha256,
        language,
        size_bytes,
        line_count,
        is_generated,
        last_modified_at,
        indexed_at
      FROM files
      ORDER BY path ASC
    `,
  ).all() as unknown as FileRow[];

  return rows.map((row) => mapFileSummaryRow(row)).filter((row): row is FileSummaryRecord => row != null);
}

export function listAllImportEdgesImpl(db: DatabaseSync): FileImportLink[] {
  const rows = db
    .prepare(`
      SELECT
        src.path AS source_path,
        imp.target_path,
        imp.specifier,
        imp.import_kind,
        imp.is_type_only,
        imp.line,
        CASE WHEN tgt.file_id IS NULL THEN 0 ELSE 1 END AS target_exists
      FROM import_edges imp
      INNER JOIN files src ON src.file_id = imp.source_file_id
      LEFT JOIN files tgt ON tgt.file_id = imp.target_file_id
      ORDER BY src.path ASC, COALESCE(imp.line, 0) ASC, imp.target_path ASC
    `)
    .all() as unknown as ImportLinkRow[];

  return rows.map(mapImportLinkRow);
}

export function listImportsForFileImpl(db: DatabaseSync, filePath: string): FileImportLink[] {
  const rows = db
    .prepare(`
      SELECT
        src.path AS source_path,
        imp.target_path,
        imp.specifier,
        imp.import_kind,
        imp.is_type_only,
        imp.line,
        CASE WHEN tgt.file_id IS NULL THEN 0 ELSE 1 END AS target_exists
      FROM import_edges imp
      INNER JOIN files src ON src.file_id = imp.source_file_id
      LEFT JOIN files tgt ON tgt.file_id = imp.target_file_id
      WHERE src.path = ?
      ORDER BY COALESCE(imp.line, 0) ASC, imp.target_path ASC
    `)
    .all(filePath) as unknown as ImportLinkRow[];

  return rows.map(mapImportLinkRow);
}

export function listDependentsForFileImpl(db: DatabaseSync, filePath: string): FileImportLink[] {
  const rows = db
    .prepare(`
      SELECT
        src.path AS source_path,
        imp.target_path,
        imp.specifier,
        imp.import_kind,
        imp.is_type_only,
        imp.line,
        CASE WHEN tgt.file_id IS NULL THEN 0 ELSE 1 END AS target_exists
      FROM import_edges imp
      INNER JOIN files src ON src.file_id = imp.source_file_id
      LEFT JOIN files tgt ON tgt.file_id = imp.target_file_id
      WHERE imp.target_path = ?
      ORDER BY src.path ASC, COALESCE(imp.line, 0) ASC
    `)
    .all(filePath) as unknown as ImportLinkRow[];

  return rows.map(mapImportLinkRow);
}

export function listRoutesForFileImpl(db: DatabaseSync, filePath: string): ResolvedRouteRecord[] {
  const rows = db
    .prepare(`
      SELECT
        r.route_key,
        r.framework,
        r.pattern,
        r.method,
        r.handler_name,
        r.is_api,
        r.metadata_json,
        f.path AS file_path
      FROM routes r
      INNER JOIN files f ON f.file_id = r.file_id
      WHERE f.path = ?
      ORDER BY r.pattern ASC, COALESCE(r.method, '') ASC
    `)
    .all(filePath) as unknown as RouteRow[];

  return rows.map(mapRouteRow);
}

export function listSymbolsForFileImpl(
  db: DatabaseSync,
  filePath: string,
  prepared?: PreparedStatementResolver,
): SymbolRecord[] {
  const rows = prepare(
    db,
    prepared,
    `
      SELECT
        s.name,
        s.kind,
        s.export_name,
        s.line_start,
        s.line_end,
        s.signature_text,
        s.metadata_json
      FROM symbols s
      INNER JOIN files f ON f.file_id = s.file_id
      WHERE f.path = ?
      ORDER BY COALESCE(s.line_start, 0) ASC, s.name ASC
    `,
  ).all(filePath) as unknown as SymbolRow[];

  return rows.map(mapSymbolRow);
}

export function getFileContentImpl(
  db: DatabaseSync,
  filePath: string,
  prepared?: PreparedStatementResolver,
): string | null {
  const fileChunk = prepare(
    db,
    prepared,
    `
      SELECT c.content AS content
      FROM chunks c
      INNER JOIN files f ON f.file_id = c.file_id
      WHERE f.path = ? AND c.chunk_kind = 'file'
      ORDER BY COALESCE(c.line_start, 0) ASC, c.chunk_id ASC
      LIMIT 1
    `,
  ).get(filePath) as { content: string | null } | undefined;

  if (typeof fileChunk?.content === "string") {
    return fileChunk.content;
  }

  // Legacy snapshots may predate the file-level chunk. Fall back to the old
  // reconstruction path only when no canonical file chunk is available.
  const rows = prepare(
    db,
    prepared,
    `
      SELECT c.content AS content
      FROM chunks c
      INNER JOIN files f ON f.file_id = c.file_id
      WHERE f.path = ?
      ORDER BY COALESCE(c.line_start, 0) ASC, c.chunk_id ASC
    `,
  ).all(filePath) as Array<{ content: string | null }>;

  if (rows.length === 0) {
    return null;
  }

  let out = "";
  for (const row of rows) {
    if (typeof row.content === "string") {
      if (out.length > 0) {
        out += "\n";
      }
      out += row.content;
    }
  }
  return out;
}

export function getFileDetailImpl(db: DatabaseSync, fileQuery: string): FileDetailRecord | null {
  const file = findFileImpl(db, fileQuery);
  if (!file) {
    return null;
  }

  const previewRow = db
    .prepare(`
      SELECT substr(content, 1, 400) AS snippet
      FROM chunks c
      INNER JOIN files f ON f.file_id = c.file_id
      WHERE f.path = ?
      ORDER BY c.line_start ASC, c.chunk_id ASC
      LIMIT 1
    `)
    .get(file.path) as { snippet: string | null } | undefined;

  return {
    ...file,
    chunkPreview: previewRow?.snippet ?? undefined,
    symbols: listSymbolsForFileImpl(db, file.path),
    outboundImports: listImportsForFileImpl(db, file.path),
    inboundImports: listDependentsForFileImpl(db, file.path),
    routes: listRoutesForFileImpl(db, file.path),
  };
}
