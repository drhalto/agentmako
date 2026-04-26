import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseJson, stringifyJson } from "./json.js";
import type {
  IndexedFileRecord,
  IndexRunRecord,
  IndexRunStats,
  IndexSnapshot,
  ProjectScanStats,
  ReplaceFileIndexRowsInput,
  SchemaObjectKind,
} from "./types.js";

interface IndexRunRow {
  run_id: string;
  trigger_source: string;
  status: IndexRunRecord["status"];
  stats_json: string | null;
  error_text: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface CountRow {
  value: number;
}

function mapIndexRunRow(row: IndexRunRow | undefined): IndexRunRecord | null {
  if (!row) {
    return null;
  }

  return {
    runId: row.run_id,
    triggerSource: row.trigger_source,
    status: row.status,
    stats: row.stats_json == null ? undefined : parseJson<IndexRunStats>(row.stats_json, {}),
    errorText: row.error_text ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.created_at,
  };
}

function countValue(db: DatabaseSync, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS value FROM ${tableName}`).get() as CountRow | undefined;
  return row?.value ?? 0;
}

function expandChunkSearchTerms(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/[_./\\:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandIdentifierForSearch(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const expanded = expandChunkSearchTerms(trimmed);
  if (expanded === "" || expanded.toLowerCase() === trimmed.toLowerCase()) {
    return trimmed;
  }
  return `${trimmed} ${expanded}`;
}

// search_text is the camelCase-aware, separator-aware expansion that lets
// FTS5 phrase queries ("load users") match identifiers like `loadUsers`.
// The default `unicode61` tokenizer does NOT split on case boundaries, so
// without this expansion a user searching "load users" finds nothing in
// code whose only reference is the raw `loadUsers` identifier.
//
// A chunk's search_text now carries:
//   - the chunk's own name expanded (file path, symbol name, etc.)
//   - every symbol name from the chunk's file, expanded (file-kind chunks
//     need this so a search for "load users" can reach a file whose
//     symbols are `loadUsers`, `loadUsersById`, etc.)
// Duplicates across chunks in the same file are acceptable — FTS folds
// them naturally.
function buildChunkSearchText(name: string | undefined, symbolNames: readonly string[] = []): string {
  const parts: string[] = [];
  const nameText = expandIdentifierForSearch(name ?? "");
  if (nameText !== "") parts.push(nameText);
  for (const symbolName of symbolNames) {
    const expanded = expandIdentifierForSearch(symbolName);
    if (expanded !== "") parts.push(expanded);
  }
  return parts.join(" ").trim();
}

function schemaObjectKey(row: {
  object_type: SchemaObjectKind;
  schema_name: string;
  object_name: string;
  parent_object_name: string | null;
}): string {
  return [row.object_type, row.schema_name, row.parent_object_name ?? "", row.object_name].join(":");
}

function insertFileOwnedRows(db: DatabaseSync, files: readonly IndexedFileRecord[]): Map<string, number> {
  const insertFile = db.prepare(`
    INSERT INTO files(
      path,
      sha256,
      language,
      size_bytes,
      line_count,
      is_generated,
      last_modified_at,
      indexed_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const insertChunk = db.prepare(`
    INSERT INTO chunks(file_id, chunk_kind, name, line_start, line_end, content, search_text)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSymbol = db.prepare(`
    INSERT INTO symbols(
      file_id,
      name,
      kind,
      export_name,
      line_start,
      line_end,
      signature_text,
      metadata_json
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertGraphNode = db.prepare(`
    INSERT OR REPLACE INTO graph_nodes(node_key, node_type, label, file_path, metadata_json)
    VALUES(?, ?, ?, ?, ?)
  `);

  const insertGraphEdge = db.prepare(`
    INSERT OR REPLACE INTO graph_edges(source_key, target_key, relation, metadata_json)
    VALUES(?, ?, ?, ?)
  `);

  const fileIdsByPath = new Map<string, number>();
  for (const file of files) {
    const result = insertFile.run(
      file.path,
      file.sha256,
      file.language,
      file.sizeBytes,
      file.lineCount,
      file.isGenerated ? 1 : 0,
      file.lastModifiedAt ?? null,
    );

    const fileId = Number(result.lastInsertRowid);
    fileIdsByPath.set(file.path, fileId);

    insertGraphNode.run(
      `file:${file.path}`,
      "file",
      file.path,
      file.path,
      stringifyJson({ language: file.language, generated: file.isGenerated ?? false }),
    );

    const symbolNamesForFile = file.symbols.map((symbol) => symbol.name).filter((name) => name.length > 0);
    for (const chunk of file.chunks) {
      insertChunk.run(
        fileId,
        chunk.chunkKind,
        chunk.name ?? null,
        chunk.lineStart ?? null,
        chunk.lineEnd ?? null,
        chunk.content,
        buildChunkSearchText(chunk.name, symbolNamesForFile),
      );
    }

    for (const symbol of file.symbols) {
      insertSymbol.run(
        fileId,
        symbol.name,
        symbol.kind,
        symbol.exportName ?? null,
        symbol.lineStart ?? null,
        symbol.lineEnd ?? null,
        symbol.signatureText ?? null,
        symbol.metadata == null ? null : stringifyJson(symbol.metadata),
      );

      const symbolKey = `symbol:${file.path}:${symbol.name}:${symbol.lineStart ?? 0}`;
      insertGraphNode.run(
        symbolKey,
        "symbol",
        symbol.name,
        file.path,
        stringifyJson({
          kind: symbol.kind,
          exportName: symbol.exportName ?? null,
          lineStart: symbol.lineStart ?? null,
          lineEnd: symbol.lineEnd ?? null,
        }),
      );
      insertGraphEdge.run(
        `file:${file.path}`,
        symbolKey,
        "defines",
        stringifyJson({ kind: symbol.kind }),
      );
    }
  }

  return fileIdsByPath;
}

function dropChunkFtsTriggers(db: DatabaseSync): void {
  db.exec(`
    DROP TRIGGER IF EXISTS chunks_ai;
    DROP TRIGGER IF EXISTS chunks_ad;
    DROP TRIGGER IF EXISTS chunks_au;
  `);
}

function recreateChunkFtsTriggers(db: DatabaseSync): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chunks_ai
    AFTER INSERT ON chunks
    FOR EACH ROW
    BEGIN
      INSERT INTO chunks_fts(rowid, content, path, name, search_text)
      VALUES (
        NEW.chunk_id,
        NEW.content,
        (SELECT path FROM files WHERE file_id = NEW.file_id),
        COALESCE(NEW.name, ''),
        COALESCE(NEW.search_text, '')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_ad
    AFTER DELETE ON chunks
    FOR EACH ROW
    BEGIN
      DELETE FROM chunks_fts
      WHERE rowid = OLD.chunk_id;
    END;

    CREATE TRIGGER IF NOT EXISTS chunks_au
    AFTER UPDATE ON chunks
    FOR EACH ROW
    BEGIN
      DELETE FROM chunks_fts
      WHERE rowid = OLD.chunk_id;

      INSERT INTO chunks_fts(rowid, content, path, name, search_text)
      VALUES (
        NEW.chunk_id,
        NEW.content,
        (SELECT path FROM files WHERE file_id = NEW.file_id),
        COALESCE(NEW.name, ''),
        COALESCE(NEW.search_text, '')
      );
    END;
  `);
}

function rebuildChunksFtsIndex(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM chunks_fts;
    INSERT INTO chunks_fts(rowid, content, path, name, search_text)
    SELECT c.chunk_id, c.content, f.path, COALESCE(c.name, ''), COALESCE(c.search_text, '')
    FROM chunks c
    INNER JOIN files f ON f.file_id = c.file_id;
  `);
}

export function backfillChunkSearchTextImpl(db: DatabaseSync): void {
  dropChunkFtsTriggers(db);
  try {
    // Join symbol names into the backfill so legacy-repaired chunks get the
    // same camelCase-aware search_text as freshly-indexed chunks. `GROUP_CONCAT`
    // with a separator gives us the symbol set per file; split and rebuild in
    // JS so `buildChunkSearchText` does the identifier expansion once.
    const rows = db
      .prepare(`
        SELECT c.chunk_id, c.name, (
          SELECT GROUP_CONCAT(s.name, CHAR(31))
          FROM symbols s
          WHERE s.file_id = c.file_id
        ) AS symbol_names
        FROM chunks c
        WHERE c.search_text IS NULL
      `)
      .all() as Array<{ chunk_id: number; name: string | null; symbol_names: string | null }>;

    if (rows.length > 0) {
      const updateChunkSearchText = db.prepare(`
        UPDATE chunks
        SET search_text = ?
        WHERE chunk_id = ?
      `);

      db.exec("BEGIN");
      try {
        for (const row of rows) {
          const symbolNames = (row.symbol_names ?? "")
            .split("\u001f")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);
          updateChunkSearchText.run(
            buildChunkSearchText(row.name ?? undefined, symbolNames),
            row.chunk_id,
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }

    rebuildChunksFtsIndex(db);
  } finally {
    recreateChunkFtsTriggers(db);
  }
}

export function beginIndexRunImpl(db: DatabaseSync, triggerSource: string): IndexRunRecord {
  const runId = `run_${randomUUID()}`;
  const startedAt = new Date().toISOString();

  db
    .prepare(`
      INSERT INTO index_runs(run_id, trigger_source, status, started_at)
      VALUES(?, ?, 'running', ?)
    `)
    .run(runId, triggerSource, startedAt);

  return getIndexRunImpl(db, runId) as IndexRunRecord;
}

export function getIndexRunImpl(db: DatabaseSync, runId: string): IndexRunRecord | null {
  const row = db
    .prepare(`
      SELECT
        run_id,
        trigger_source,
        status,
        stats_json,
        error_text,
        started_at,
        finished_at,
        created_at
      FROM index_runs
      WHERE run_id = ?
    `)
    .get(runId) as IndexRunRow | undefined;

  return mapIndexRunRow(row);
}

export function getLatestIndexRunImpl(db: DatabaseSync): IndexRunRecord | null {
  const row = db
    .prepare(`
      SELECT
        run_id,
        trigger_source,
        status,
        stats_json,
        error_text,
        started_at,
        finished_at,
        created_at
      FROM index_runs
      ORDER BY COALESCE(finished_at, started_at, created_at) DESC, rowid DESC
      LIMIT 1
    `)
    .get() as IndexRunRow | undefined;

  return mapIndexRunRow(row);
}

export function finishIndexRunImpl(
  db: DatabaseSync,
  runId: string,
  status: IndexRunRecord["status"],
  stats?: IndexRunStats,
  errorText?: string,
): IndexRunRecord {
  db
    .prepare(`
      UPDATE index_runs
      SET
        status = ?,
        stats_json = ?,
        error_text = ?,
        finished_at = CURRENT_TIMESTAMP
      WHERE run_id = ?
    `)
    .run(status, stats == null ? null : stringifyJson(stats), errorText ?? null, runId);

  return getIndexRunImpl(db, runId) as IndexRunRecord;
}

export function replaceIndexSnapshotImpl(db: DatabaseSync, snapshot: IndexSnapshot): ProjectScanStats {
  db.exec("BEGIN");

  try {
    dropChunkFtsTriggers(db);
    // Refresh is a full snapshot replacement: clear file-owned indexes first
    // so chunk/symbol/route rows cannot survive from stale files.
    db.exec(`
      DELETE FROM schema_usages;
      DELETE FROM schema_objects;
      DELETE FROM graph_edges;
      DELETE FROM graph_nodes;
      DELETE FROM routes;
      DELETE FROM import_edges;
      DELETE FROM symbols;
      DELETE FROM chunks;
      DELETE FROM files;
    `);

    const insertImportEdge = db.prepare(`
      INSERT INTO import_edges(
        source_file_id,
        target_file_id,
        target_path,
        specifier,
        import_kind,
        is_type_only,
        line
      )
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `);

    const insertRoute = db.prepare(`
      INSERT INTO routes(
        route_key,
        framework,
        file_id,
        pattern,
        method,
        handler_name,
        is_api,
        metadata_json
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertGraphEdge = db.prepare(`
      INSERT OR REPLACE INTO graph_edges(source_key, target_key, relation, metadata_json)
      VALUES(?, ?, ?, ?)
    `);

    const insertSchemaObject = db.prepare(`
      INSERT INTO schema_objects(
        object_type,
        schema_name,
        object_name,
        parent_object_name,
        data_type,
        definition_json
      )
      VALUES(?, ?, ?, ?, ?, ?)
    `);

    const insertSchemaUsage = db.prepare(`
      INSERT INTO schema_usages(
        schema_object_id,
        file_id,
        symbol_id,
        usage_kind,
        line,
        excerpt
      )
      VALUES(?, ?, NULL, ?, ?, ?)
    `);

    const fileIdsByPath = insertFileOwnedRows(db, snapshot.files);
    const schemaObjectIdsByKey = new Map<string, number>();

    for (const file of snapshot.files) {
      const sourceFileId = fileIdsByPath.get(file.path);
      if (sourceFileId == null) {
        continue;
      }

      for (const importEdge of file.imports) {
        const targetFileId = fileIdsByPath.get(importEdge.targetPath) ?? null;
        insertImportEdge.run(
          sourceFileId,
          targetFileId,
          importEdge.targetPath,
          importEdge.specifier,
          importEdge.importKind,
          importEdge.isTypeOnly ? 1 : 0,
          importEdge.line ?? null,
        );

        if (targetFileId != null) {
          insertGraphEdge.run(
            `file:${file.path}`,
            `file:${importEdge.targetPath}`,
            "imports",
            stringifyJson({
              specifier: importEdge.specifier,
              importKind: importEdge.importKind,
              line: importEdge.line ?? null,
            }),
          );
        }
      }

      for (const route of file.routes) {
        insertRoute.run(
          route.routeKey,
          route.framework,
          sourceFileId,
          route.pattern,
          route.method ?? null,
          route.handlerName ?? null,
          route.isApi ? 1 : 0,
          route.metadata == null ? null : stringifyJson(route.metadata),
        );
      }
    }

    for (const schemaObject of snapshot.schemaObjects) {
      const result = insertSchemaObject.run(
        schemaObject.objectType,
        schemaObject.schemaName,
        schemaObject.objectName,
        schemaObject.parentObjectName ?? null,
        schemaObject.dataType ?? null,
        schemaObject.definition == null ? null : stringifyJson(schemaObject.definition),
      );

      schemaObjectIdsByKey.set(schemaObject.objectKey, Number(result.lastInsertRowid));
    }

    for (const usage of snapshot.schemaUsages) {
      const schemaObjectId = schemaObjectIdsByKey.get(usage.objectKey);
      const fileId = fileIdsByPath.get(usage.filePath);

      if (schemaObjectId == null || fileId == null) {
        continue;
      }

      insertSchemaUsage.run(
        schemaObjectId,
        fileId,
        usage.usageKind,
        usage.line ?? null,
        usage.excerpt ?? null,
      );
    }

    // Bulk-rebuild chunks_fts to reflect the chunks we just inserted while the
    // per-row trigger was dropped for performance. (Previously the triggers
    // were recreated without rebuilding, which silently left chunks_fts empty —
    // `searchFiles` survived via its LIKE fallback, but chunk-level FTS search
    // returned no hits. Phase 3.6.0 Workstream B depends on this being correct.)
    rebuildChunksFtsIndex(db);

    recreateChunkFtsTriggers(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getScanStatsImpl(db);
}

export function replaceFileIndexRowsImpl(db: DatabaseSync, input: ReplaceFileIndexRowsInput): ProjectScanStats {
  const targetPaths = [...new Set([...input.deletedPaths, ...input.files.map((file) => file.path)])];
  db.exec("BEGIN");

  try {
    const selectFileId = db.prepare(`SELECT file_id FROM files WHERE path = ?`);
    const deleteGraphNodesForPath = db.prepare(`DELETE FROM graph_nodes WHERE file_path = ?`);
    const nullInboundImports = db.prepare(`UPDATE import_edges SET target_file_id = NULL WHERE target_file_id = ?`);
    const deleteFile = db.prepare(`DELETE FROM files WHERE file_id = ?`);

    for (const filePath of targetPaths) {
      const existing = selectFileId.get(filePath) as { file_id: number } | undefined;
      if (!existing) continue;
      deleteGraphNodesForPath.run(filePath);
      nullInboundImports.run(existing.file_id);
      deleteFile.run(existing.file_id);
    }

    const newFileIds = insertFileOwnedRows(db, input.files);
    const allFileIds = new Map<string, number>();
    const fileRows = db
      .prepare(`SELECT file_id, path FROM files`)
      .all() as Array<{ file_id: number; path: string }>;
    for (const row of fileRows) {
      allFileIds.set(row.path, row.file_id);
    }

    const insertImportEdge = db.prepare(`
      INSERT INTO import_edges(
        source_file_id,
        target_file_id,
        target_path,
        specifier,
        import_kind,
        is_type_only,
        line
      )
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `);

    const insertRoute = db.prepare(`
      INSERT INTO routes(
        route_key,
        framework,
        file_id,
        pattern,
        method,
        handler_name,
        is_api,
        metadata_json
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertGraphEdge = db.prepare(`
      INSERT OR REPLACE INTO graph_edges(source_key, target_key, relation, metadata_json)
      VALUES(?, ?, ?, ?)
    `);

    for (const file of input.files) {
      const sourceFileId = newFileIds.get(file.path);
      if (sourceFileId == null) continue;

      for (const importEdge of file.imports) {
        const targetFileId = allFileIds.get(importEdge.targetPath) ?? null;
        insertImportEdge.run(
          sourceFileId,
          targetFileId,
          importEdge.targetPath,
          importEdge.specifier,
          importEdge.importKind,
          importEdge.isTypeOnly ? 1 : 0,
          importEdge.line ?? null,
        );

        if (targetFileId != null) {
          insertGraphEdge.run(
            `file:${file.path}`,
            `file:${importEdge.targetPath}`,
            "imports",
            stringifyJson({
              specifier: importEdge.specifier,
              importKind: importEdge.importKind,
              line: importEdge.line ?? null,
            }),
          );
        }
      }

      for (const route of file.routes) {
        insertRoute.run(
          route.routeKey,
          route.framework,
          sourceFileId,
          route.pattern,
          route.method ?? null,
          route.handlerName ?? null,
          route.isApi ? 1 : 0,
          route.metadata == null ? null : stringifyJson(route.metadata),
        );
      }
    }

    const updateInboundTarget = db.prepare(`
      UPDATE import_edges
      SET target_file_id = ?
      WHERE target_path = ?
    `);
    const inboundImports = db.prepare(`
      SELECT src.path AS source_path, imp.specifier, imp.import_kind, imp.line
      FROM import_edges imp
      INNER JOIN files src ON src.file_id = imp.source_file_id
      WHERE imp.target_path = ?
    `);
    for (const file of input.files) {
      const targetFileId = newFileIds.get(file.path);
      if (targetFileId == null) continue;
      updateInboundTarget.run(targetFileId, file.path);
      const rows = inboundImports.all(file.path) as Array<{
        source_path: string;
        specifier: string;
        import_kind: string;
        line: number | null;
      }>;
      for (const row of rows) {
        if (row.source_path === file.path) continue;
        insertGraphEdge.run(
          `file:${row.source_path}`,
          `file:${file.path}`,
          "imports",
          stringifyJson({
            specifier: row.specifier,
            importKind: row.import_kind,
            line: row.line ?? null,
          }),
        );
      }
    }

    const schemaRows = db
      .prepare(`
        SELECT object_id, object_type, schema_name, object_name, parent_object_name
        FROM schema_objects
      `)
      .all() as Array<{
      object_id: number;
      object_type: SchemaObjectKind;
      schema_name: string;
      object_name: string;
      parent_object_name: string | null;
    }>;
    const schemaObjectIdsByKey = new Map(schemaRows.map((row) => [schemaObjectKey(row), row.object_id] as const));
    const insertSchemaUsage = db.prepare(`
      INSERT INTO schema_usages(
        schema_object_id,
        file_id,
        symbol_id,
        usage_kind,
        line,
        excerpt
      )
      VALUES(?, ?, NULL, ?, ?, ?)
    `);
    for (const usage of input.schemaUsages ?? []) {
      const schemaObjectId = schemaObjectIdsByKey.get(usage.objectKey);
      const fileId = newFileIds.get(usage.filePath);
      if (schemaObjectId == null || fileId == null) continue;
      insertSchemaUsage.run(
        schemaObjectId,
        fileId,
        usage.usageKind,
        usage.line ?? null,
        usage.excerpt ?? null,
      );
    }

    rebuildChunksFtsIndex(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getScanStatsImpl(db);
}

export function getScanStatsImpl(db: DatabaseSync): ProjectScanStats {
  return {
    files: countValue(db, "files"),
    chunks: countValue(db, "chunks"),
    symbols: countValue(db, "symbols"),
    importEdges: countValue(db, "import_edges"),
    routes: countValue(db, "routes"),
    schemaObjects: countValue(db, "schema_objects"),
    schemaUsages: countValue(db, "schema_usages"),
  };
}
