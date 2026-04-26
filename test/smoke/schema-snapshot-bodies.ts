/**
 * Phase 3.6.0 Workstream C smoke — repo-SQL snapshot body persistence.
 *
 * Proves:
 *   - `extractPgObjectsFromSql` parses `CREATE FUNCTION` + `CREATE TRIGGER`
 *     from a Supabase-shaped migration, including dollar-quoted bodies.
 *   - `parseSqlSchemaSource` surfaces `bodyText` on SchemaRpc + SchemaTrigger.
 *   - `saveSchemaSnapshot` persists `body_text` into the read model and
 *     derives `schema_snapshot_function_refs` rows by regex-scanning bodies.
 *   - `searchSchemaBodies("events")` returns hits for functions whose body
 *     references the events table.
 *   - `listFunctionTableRefs({ tableName: "events" })` returns exact edges from
 *     every function body that references events, preserving overload identity.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SchemaSnapshotSchema, type SchemaSnapshot } from "../../packages/contracts/src/schema-snapshot.ts";
import {
  deriveFunctionTableRefs,
  extractPgObjectsFromSql,
} from "../../services/indexer/src/extract-pg-functions.ts";
import { parseSqlSchemaSource } from "../../services/indexer/src/schema-sources/sql.ts";
import { openProjectStore } from "../../packages/store/src/index.ts";

const MIGRATION_SQL = `
-- Supabase-shaped migration fixture
-- CREATE TABLE public.comment_only (id uuid);
SELECT 'CREATE TABLE public.string_only (id uuid);';

CREATE TABLE public.users (
  id uuid PRIMARY KEY
);

CREATE TABLE private.audit_log (
  id uuid PRIMARY KEY,
  ref_id uuid NOT NULL
);

CREATE TABLE private.events (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  payload jsonb NOT NULL
);

CREATE UNIQUE INDEX idx_private_events_owner_payload
  ON private.events (owner_id, payload);

ALTER TABLE private.events
  ADD CONSTRAINT events_owner_id_fkey
  FOREIGN KEY (owner_id) REFERENCES public.users(id)
  ON DELETE CASCADE;

ALTER TABLE private.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.events FORCE ROW LEVEL SECURITY;

CREATE POLICY private_events_read
ON private.events
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (owner_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.record_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO private.audit_log(id, ref_id) VALUES (gen_random_uuid(), NEW.id);
  PERFORM 1 FROM private.events WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_events()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  DELETE FROM private.events WHERE owner_id IS NOT NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.lookup_owner(owner_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $lookup$
BEGIN
  PERFORM 1 FROM private.events WHERE id = owner_id;
  RETURN owner_id;
END;
$lookup$;

CREATE OR REPLACE FUNCTION public.lookup_owner(owner_email text)
RETURNS text
LANGUAGE plpgsql
AS $lookup$
BEGIN
  PERFORM 1 FROM private.audit_log WHERE ref_id IS NOT NULL;
  RETURN owner_email;
END;
$lookup$;

CREATE TRIGGER events_audit
BEFORE UPDATE OF owner_id OR DELETE ON private.events
FOR EACH ROW
WHEN (OLD.owner_id IS NOT NULL)
EXECUTE FUNCTION public.record_event();
`;

async function main(): Promise<void> {
  // --- Unit-level: extractor + ref derivation ---
  const extracted = extractPgObjectsFromSql("supabase/migrations/0001_events.sql", MIGRATION_SQL);
  const fns = extracted.filter((e) => e.kind === "function");
  assert.equal(fns.length, 4, `expected 4 functions extracted; got ${fns.length}`);
  assert.ok(
    fns.some((f) => f.name === "record_event"),
    "record_event function must be extracted",
  );
  assert.ok(
    fns.some((f) => f.name === "rotate_events"),
    "rotate_events function must be extracted",
  );
  const lookupOwnerOverloads = fns.filter((f) => f.name === "lookup_owner");
  assert.equal(lookupOwnerOverloads.length, 2, "lookup_owner overloads must both be extracted");
  assert.ok(
    lookupOwnerOverloads.some((f) => JSON.stringify(f.argTypes) === JSON.stringify(["uuid"])),
    "uuid overload must preserve argTypes",
  );
  assert.ok(
    lookupOwnerOverloads.some((f) => JSON.stringify(f.argTypes) === JSON.stringify(["text"])),
    "text overload must preserve argTypes",
  );

  const recordEvent = fns.find((f) => f.name === "record_event")!;
  assert.ok(recordEvent.bodyText.includes("FROM private.events"), "body must contain private.events reference");
  assert.ok(recordEvent.bodyText.includes("audit_log"), "body must contain audit_log reference");

  const refs = deriveFunctionTableRefs(recordEvent.bodyText);
  assert.ok(
    refs.some((r) => r.targetTable === "events"),
    "record_event body must reference events table",
  );
  assert.ok(
    refs.some((r) => r.targetTable === "audit_log"),
    "record_event body must reference audit_log table",
  );
  const refsIgnoringNoise = deriveFunctionTableRefs([
    "-- FROM public.comment_only",
    "select 'JOIN public.string_only';",
    "select * from public.real_table;",
  ].join("\n"));
  assert.deepEqual(
    refsIgnoringNoise.map((ref) => `${ref.targetSchema}.${ref.targetTable}`),
    ["public.real_table"],
    "function table refs must ignore comments and string literals",
  );

  const triggers = extracted.filter((e) => e.kind === "trigger");
  assert.equal(triggers.length, 1, "one trigger expected");
  const eventsAudit = triggers[0]!;
  if (eventsAudit.kind !== "trigger") throw new Error("expected trigger");
  assert.equal(eventsAudit.table, "events");
  assert.equal(eventsAudit.schema, "private");
  assert.equal(eventsAudit.timing, "BEFORE");
  assert.deepEqual(eventsAudit.events, ["UPDATE", "DELETE"]);
  assert.equal(eventsAudit.executesFunction, "record_event");

  // --- Integration-level: parseSqlSchemaSource populates bodyText + triggers ---
  const ir = await parseSqlSchemaSource({
    kind: "sql_migration",
    relativePath: "supabase/migrations/0001_events.sql",
    content: MIGRATION_SQL,
  } as never);

  const publicNs = ir.schemas["public"]!;
  const privateNs = ir.schemas["private"]!;
  assert.ok(publicNs, "public namespace must exist");
  assert.ok(privateNs, "private namespace must exist");
  assert.ok(
    !publicNs.tables.some((table) => table.name === "comment_only" || table.name === "string_only"),
    "repo-SQL parser must ignore CREATE TABLE text inside comments and string literals",
  );
  const recordEventRpc = publicNs.rpcs.find((r) => r.name === "record_event");
  assert.ok(recordEventRpc, "record_event should appear on SchemaRpc[]");
  assert.ok(
    recordEventRpc.bodyText && recordEventRpc.bodyText.includes("FROM private.events"),
    "SchemaRpc.bodyText must be populated",
  );
  const eventsTable = privateNs.tables.find((t) => t.name === "events");
  assert.ok(eventsTable, "events table should appear");
  assert.ok(
    eventsTable.indexes?.some((index) => index.name === "idx_private_events_owner_payload"),
    "repo-SQL index definitions must populate SchemaTable.indexes",
  );
  assert.ok(
    eventsTable.foreignKeys?.outbound.some((fk) => fk.constraintName === "events_owner_id_fkey"),
    "repo-SQL foreign keys must populate SchemaTable.foreignKeys",
  );
  assert.equal(eventsTable.rls?.rlsEnabled, true, "RLS enable statements must be reflected");
  assert.equal(eventsTable.rls?.forceRls, true, "RLS force statements must be reflected");
  assert.ok(
    eventsTable.rls?.policies.some((policy) => policy.name === "private_events_read"),
    "repo-SQL policies must populate SchemaTable.rls.policies",
  );
  assert.ok(
    eventsTable.triggers?.some(
      (t) =>
        t.name === "events_audit" &&
        t.timing === "BEFORE" &&
        t.events.includes("UPDATE") &&
        t.events.includes("DELETE") &&
        t.bodyText,
    ),
    "events table trigger must carry bodyText",
  );

  // --- Store-level: saveSchemaSnapshot persists + derives function_refs ---
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-schema-bodies-"));
  const projectRoot = path.join(tmp, "project");
  mkdirSync(projectRoot, { recursive: true });
  process.env.MAKO_STATE_HOME = path.join(tmp, "state");
  mkdirSync(process.env.MAKO_STATE_HOME, { recursive: true });
  delete process.env.MAKO_STATE_DIRNAME;

  try {
    let store = openProjectStore({ projectRoot });
    try {
      const now = new Date().toISOString();
      const snapshot: SchemaSnapshot = {
        snapshotId: `snap_${randomUUID()}`,
        sourceMode: "repo_only",
        generatedAt: now,
        refreshedAt: now,
        fingerprint: "smoke-fingerprint",
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: [],
        warnings: [],
        ir,
      };
      SchemaSnapshotSchema.parse(snapshot);
      store.saveSchemaSnapshot(snapshot);
      store.close();

      // Reopen to prove the derived function-ref read model survives actual
      // store lifecycle and constructor backfills.
      store = openProjectStore({ projectRoot });

      const bodyHits = store.searchSchemaBodies("events");
      assert.ok(
        bodyHits.length > 0,
        "searchSchemaBodies('events') must return at least one hit",
      );
      const recordEventHit = bodyHits.find(
        (h) => h.objectType === "rpc" && h.objectName === "record_event",
      );
      assert.ok(recordEventHit, "record_event must appear in body search results");
      const triggerHit = bodyHits.find(
        (h) => h.objectType === "trigger" && h.objectName === "events_audit",
      );
      assert.ok(triggerHit, "events_audit must appear in body search results");
      assert.equal(triggerHit.tableName, "events", "trigger body hits must expose owner table");

      const eventsRefs = store.listFunctionTableRefs({ tableName: "events" });
      assert.ok(
        eventsRefs.length > 0,
        "listFunctionTableRefs({ tableName: 'events' }) must return at least one edge",
      );
      assert.ok(
        eventsRefs.some((r) => r.rpcName === "record_event"),
        "record_event must be a function referencing events",
      );
      assert.ok(
        eventsRefs.some((r) => r.rpcName === "rotate_events"),
        "rotate_events must be a function referencing events",
      );

      const recordEventRefs = store.listFunctionTableRefs({ rpcName: "record_event" });
      assert.ok(
        recordEventRefs.some((r) => r.targetTable === "events"),
        "rpcName filter must return 'events' among record_event's targets",
      );
      const lookupOwnerRefs = store.listFunctionTableRefs({ rpcName: "lookup_owner" });
      assert.deepEqual(
        lookupOwnerRefs.map((ref) => ({ argTypes: ref.argTypes, targetTable: ref.targetTable })),
        [
          { argTypes: ["text"], targetTable: "audit_log" },
          { argTypes: ["uuid"], targetTable: "events" },
        ],
        "overloaded RPC refs must preserve argTypes and not merge targets across overloads",
      );
      const snapshotTable = store.getSchemaTableSnapshot("private", "events");
      assert.ok(snapshotTable, "snapshot table accessor must return repo-only tables");
      assert.ok(
        snapshotTable.indexes?.some((index) => index.name === "idx_private_events_owner_payload"),
        "snapshot table accessor must return indexes in one call",
      );
      assert.ok(
        snapshotTable.rls?.policies.some((policy) => policy.name === "private_events_read"),
        "snapshot table accessor must return RLS policies in one call",
      );
      assert.ok(
        snapshotTable.triggers?.some((trigger) => trigger.name === "events_audit"),
        "snapshot table accessor must return triggers in one call",
      );
    } finally {
      store.close();
    }

    console.log("schema-snapshot-bodies: PASS");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
