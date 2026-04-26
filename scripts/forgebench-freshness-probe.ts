import { openProjectStore } from "../packages/store/src/index.ts";
import { computeSnapshotFreshness } from "../services/indexer/src/schema-snapshot.ts";
import { readProjectManifest } from "../services/indexer/src/project-manifest.ts";
import {
  ensureFreshSchemaSnapshot,
  __resetSchemaFreshnessDebounceForTests,
} from "../packages/tools/src/schema-freshness.ts";

const FORGEBENCH_PATH = "C:/Users/Dustin/forgebench";
const PROJECT_ID = "4bf6ebbd-fe39-46a6-8b4f-4b594563b32e";

async function main() {
  __resetSchemaFreshnessDebounceForTests();

  const store = openProjectStore({ projectRoot: FORGEBENCH_PATH });
  const snapshot = store.loadSchemaSnapshot();
  console.log("current snapshot:");
  console.log(`  id: ${snapshot?.snapshotId}`);
  console.log(`  fingerprint: ${snapshot?.fingerprint}`);
  console.log(`  freshnessStatus (stored): ${snapshot?.freshnessStatus}`);
  console.log(`  generatedAt: ${snapshot?.generatedAt}`);
  console.log(`  refreshedAt: ${snapshot?.refreshedAt}`);
  console.log(`  age (ms): ${snapshot ? Date.now() - Date.parse(snapshot.refreshedAt) : "n/a"}`);

  const manifest = readProjectManifest(FORGEBENCH_PATH);
  console.log(`\nmanifest present: ${manifest != null}`);
  console.log(`liveBinding: ${manifest?.database.liveBinding ? "present" : "(none)"}`);

  if (snapshot && manifest) {
    const computed = computeSnapshotFreshness(FORGEBENCH_PATH, manifest.database, snapshot);
    console.log(`computeSnapshotFreshness → ${computed}`);
  }

  console.log("\ncalling ensureFreshSchemaSnapshot...");
  const start = Date.now();
  const result = await ensureFreshSchemaSnapshot({
    projectId: PROJECT_ID,
    projectRoot: FORGEBENCH_PATH,
    projectStore: store,
    maxSnapshotAgeMs: 0, // force age-based trigger
  });
  const durationMs = Date.now() - start;
  console.log(`took ${durationMs}ms`);
  console.log(`  refreshed: ${result.refreshed}`);
  console.log(`  skipReason: ${result.skipReason ?? "(none)"}`);
  console.log(`  freshnessBefore: ${result.freshnessBefore}`);
  console.log(`  freshnessAfter: ${result.freshnessAfter ?? "(n/a)"}`);
  console.log(`  warnings:`);
  for (const w of result.warnings) console.log(`    - ${w}`);

  const afterSnapshot = store.loadSchemaSnapshot();
  console.log(`\nsnapshot after: ${afterSnapshot?.snapshotId} (same as before: ${afterSnapshot?.snapshotId === snapshot?.snapshotId})`);
  console.log(`  refreshedAt: ${afterSnapshot?.refreshedAt}`);

  // Also directly introspect the events table after refresh.
  if (afterSnapshot) {
    const publicSchema = afterSnapshot.ir.schemas["public"];
    const events = publicSchema?.tables.find((t) => t.name === "events");
    if (events) {
      console.log(`\npublic.events in refreshed snapshot:`);
      console.log(`  columns: ${events.columns.length}`);
      console.log(`  rls.enabled: ${events.rls?.rlsEnabled ?? "(none)"}`);
      console.log(`  rls.policies: ${events.rls?.policies.length ?? 0}`);
      if (events.rls?.policies.length) {
        for (const p of events.rls.policies) {
          console.log(`    - ${p.name} (${p.command}): ${p.usingExpression ?? "(no USING)"}`);
        }
      }
    }
  }

  store.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
