import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseSupabaseTypesSchemaSource } from "../../services/indexer/src/schema-sources/supabase-types.ts";
import type { SchemaInventoryEntry } from "../../services/indexer/src/schema-sources/inventory.ts";

function makeEntry(content: string): SchemaInventoryEntry {
  return {
    kind: "generated_types",
    relativePath: "types/supabase.ts",
    absolutePath: "types/supabase.ts",
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
    lastModifiedAt: new Date("2026-04-24T00:00:00.000Z").toISOString(),
    sizeBytes: Buffer.byteLength(content),
  };
}

async function main(): Promise<void> {
  const content = [
    "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
    "export type Database = {",
    "  public: {",
    "    Tables: {",
    "      todos: {",
    "        Row: {",
    "          id: string;",
    "          title: string | null;",
    "          metadata?: Json | null;",
    "        };",
    "        Insert: { id?: string; title?: string | null };",
    "        Update: { title?: string | null };",
    "      };",
    "    };",
    "    Views: { active_todos: { Row: { id: string } } };",
    "    Enums: { todo_status: \"open\" | \"closed\" };",
    "    Functions: { publish_todo: { Args: { id: string }; Returns: void } };",
    "  };",
    "};",
    "",
  ].join("\n");

  const ir = parseSupabaseTypesSchemaSource(makeEntry(content));
  const publicSchema = ir.schemas.public;

  assert.ok(publicSchema);
  assert.equal(publicSchema.tables.length, 1);
  assert.equal(publicSchema.tables[0]?.name, "todos");
  assert.deepEqual(
    publicSchema.tables[0]?.columns.map((column) => ({
      name: column.name,
      dataType: column.dataType,
      nullable: column.nullable,
    })),
    [
      { name: "id", dataType: "string", nullable: false },
      { name: "title", dataType: "string", nullable: true },
      { name: "metadata", dataType: "Json", nullable: true },
    ],
  );
  assert.equal(publicSchema.views[0]?.name, "active_todos");
  assert.deepEqual(publicSchema.enums[0]?.values, ["open", "closed"]);
  assert.equal(publicSchema.rpcs[0]?.name, "publish_todo");

  console.log("supabase-types-ast-parser: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
