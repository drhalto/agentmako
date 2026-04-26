// Finding C regression: collectSchemaUsages must scan only code files.
// Previously any file whose content contained the RPC name matched —
// including markdown docs that merely mention the RPC. Those matches
// flowed into `calls_rpc` graph edges and into `tenant_leak_audit`
// weak signals, creating false-positive operator findings.
import assert from "node:assert/strict";
import type { IndexedFileRecord, SchemaObjectRecord } from "../../packages/store/src/index.ts";
import { collectSchemaUsages } from "../../services/indexer/src/schema-scan.ts";

function makeFile(path: string, language: string, content: string): IndexedFileRecord {
  return {
    path,
    sha256: `sha-${path}`,
    language,
    sizeBytes: content.length,
    lineCount: content.split("\n").length,
    chunks: [
      {
        chunkKind: "file",
        name: path,
        lineStart: 1,
        lineEnd: content.split("\n").length,
        content,
      },
    ],
    symbols: [],
    imports: [],
    routes: [],
  };
}

async function main(): Promise<void> {
  const schemaObjects: SchemaObjectRecord[] = [
    {
      objectKey: "public.admin_publish_event",
      objectType: "rpc",
      schemaName: "public",
      objectName: "admin_publish_event",
      definition: {
        sourceFilePath: "supabase/migrations/0001_rpcs.sql",
        line: 1,
        statementExcerpt: "create or replace function admin_publish_event(...)",
      },
    },
  ];

  // Code file — must be tracked.
  const codeFile = makeFile(
    "lib/events/actions.ts",
    "typescript",
    "import { supabase } from './client';\nawait supabase.rpc('admin_publish_event', args);\n",
  );

  // Markdown doc — RPC name appears but this must NOT produce a usage.
  const docFile = makeFile(
    "docs/benchmark-answer-key.md",
    "markdown",
    "The `admin_publish_event` RPC publishes events. See migrations for details.",
  );

  // Yaml config — likewise excluded.
  const yamlFile = makeFile(
    "config/permissions.yaml",
    "yaml",
    "rpcs:\n  - admin_publish_event\n",
  );

  // SQL file that legitimately references the RPC — must be tracked.
  const sqlFile = makeFile(
    "supabase/migrations/0002_other.sql",
    "sql",
    "select admin_publish_event(uuid_generate_v4(), uuid_generate_v4());\n",
  );

  const usages = collectSchemaUsages([codeFile, docFile, yamlFile, sqlFile], schemaObjects);

  // Expected: definition (from sourceFilePath) + code file reference + sql file reference = 3.
  const references = usages.filter((u) => u.usageKind === "reference");
  const definitions = usages.filter((u) => u.usageKind === "definition");

  assert.equal(
    definitions.length,
    1,
    "schema object definition must always be recorded regardless of language filter",
  );
  assert.equal(
    references.length,
    2,
    `expected exactly two usage references (typescript + sql), got ${references.length}: ${references.map((u) => u.filePath).join(",")}`,
  );
  const referencePaths = new Set(references.map((u) => u.filePath));
  assert.ok(referencePaths.has("lib/events/actions.ts"), "typescript usage must be tracked");
  assert.ok(referencePaths.has("supabase/migrations/0002_other.sql"), "sql usage must be tracked");
  assert.ok(
    !referencePaths.has("docs/benchmark-answer-key.md"),
    "markdown prose must not produce a usage reference",
  );
  assert.ok(
    !referencePaths.has("config/permissions.yaml"),
    "yaml config must not produce a usage reference",
  );

  console.log("schema-scan-usage: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
