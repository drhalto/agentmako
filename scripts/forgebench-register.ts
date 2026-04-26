import { randomUUID } from "node:crypto";
import { openGlobalStore, openProjectStore } from "../packages/store/src/index.ts";

const FORGEBENCH_PATH = "C:/Users/Dustin/forgebench";

const globalStore = openGlobalStore();
try {
  const existing = globalStore.getProjectByPath(FORGEBENCH_PATH);
  if (existing) {
    console.log(`already registered: ${existing.projectId}`);
  } else {
    const projectId = randomUUID();
    globalStore.saveProject({
      projectId,
      displayName: "forgebench",
      canonicalPath: FORGEBENCH_PATH,
      lastSeenPath: FORGEBENCH_PATH,
      supportTarget: "native",
    });
    console.log(`registered as ${projectId}`);
  }
} finally {
  globalStore.close();
}

const store = openProjectStore({ projectRoot: FORGEBENCH_PATH });
try {
  const files = store.listFiles();
  console.log(`project store has ${files.length} indexed files`);
  const latestRun = store.getLatestIndexRun();
  console.log(`latest index run: ${latestRun?.runId ?? "(none)"}`);
} finally {
  store.close();
}
