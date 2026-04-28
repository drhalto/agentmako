import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireReefRootWriterLock,
  createReefClient,
  readReefDaemonProcessInfo,
  ReefDaemonClient,
  resolveReefDaemonPaths,
  startReefDaemon,
  stopReefDaemon,
} from "../../services/indexer/src/index.ts";

interface ReefChangeSetsQueryOutput {
  snapshot: {
    behavior: "latest" | "pinned" | "restartable";
    revision: number;
    latestKnownRevision: number;
    state: "fresh" | "refreshing" | "stale" | "unknown";
  };
  changeSets: Array<{
    changeSetId: string;
    newRevision: number;
  }>;
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mako-reef-daemon-"));
  const stateHome = path.join(tmp, "state");
  const projectRoot = path.join(tmp, "project");
  const originalStateHome = process.env.MAKO_STATE_HOME;
  const originalStateDirName = process.env.MAKO_STATE_DIRNAME;
  const originalReefMode = process.env.MAKO_REEF_MODE;

  process.env.MAKO_STATE_HOME = stateHome;
  delete process.env.MAKO_STATE_DIRNAME;
  delete process.env.MAKO_REEF_MODE;

  mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "reef-daemon-smoke" }));
  writeFileSync(path.join(projectRoot, "src", "index.ts"), "export const daemonValue = 1;\n");

  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  const foreground = startReefDaemon({
    foreground: true,
    onReady: () => readyResolve(),
  });

  try {
    await ready;
    const paths = resolveReefDaemonPaths();
    assert.ok(existsSync(paths.processPath), "daemon process metadata should be persisted");
    assert.ok(existsSync(paths.tokenPath), "daemon token file should be persisted");
    const tokenValue = readFileSync(paths.tokenPath, "utf8").trim();

    const processInfo = await readReefDaemonProcessInfo();
    assert.ok(processInfo, "daemon process info should be readable");
    assert.equal(processInfo.pid, process.pid);
    assert.equal(processInfo.protocolVersion, "2.3");

    const daemonClient = new ReefDaemonClient();
    const handshake = await daemonClient.handshake();
    assert.equal(handshake.pid, process.pid);

    const registered = await daemonClient.registerProject({ root: projectRoot });
    assert.equal(registered.status, "active");

    const daemonStatus = await daemonClient.getProjectStatus(registered.projectId);
    assert.equal(daemonStatus.serviceMode, "daemon");
    assert.equal(daemonStatus.projectId, registered.projectId);

    const autoClient = createReefClient();
    const autoStatuses = await autoClient.listProjectStatuses();
    assert.equal(autoStatuses.length, 1);
    assert.equal(autoStatuses[0]?.serviceMode, "daemon");

    const refresh = await autoClient.requestRefresh({
      projectId: registered.projectId,
      reason: "reef_daemon_smoke",
    });
    assert.equal(refresh.state, "completed");
    assert.ok(refresh.operationId);

    const refreshedStatus = await daemonClient.getProjectStatus(registered.projectId);
    assert.equal(refreshedStatus.writerQueue.lastRunTrigger, "reef_daemon_smoke");
    assert.equal(refreshedStatus.writerQueue.lastRunResult, "succeeded");

    const daemonQuery = await daemonClient.query<Record<string, unknown>, ReefChangeSetsQueryOutput>({
      projectId: registered.projectId,
      kind: "reef.change_sets",
      freshnessPolicy: "require_fresh",
      snapshot: "latest",
      input: {
        limit: 5,
      },
    });
    assert.equal(daemonQuery.snapshot.behavior, "latest");
    assert.equal(daemonQuery.snapshot.revision, 1);
    assert.equal(daemonQuery.snapshot.latestKnownRevision, 1);
    assert.equal(daemonQuery.snapshot.state, "fresh");
    assert.ok(daemonQuery.changeSets.some((changeSet) => changeSet.newRevision === 1));

    const operations = await daemonClient.listOperations({ projectId: registered.projectId, limit: 50 });
    assert.ok(operations.some((operation) => operation.kind === "refresh_completed"));
    assert.ok(operations.some((operation) => operation.kind === "query_snapshot"));
    assert.ok(operations.some((operation) => operation.kind === "writer_lock"));
    assert.equal(JSON.stringify(operations).includes("daemonValue"), false);
    assert.equal(JSON.stringify(operations).includes(tokenValue), false);

    const lock = await acquireReefRootWriterLock({
      projectId: registered.projectId,
      canonicalRoot: projectRoot,
      analysisHostId: "smoke-lock-a",
      acquireTimeoutMs: 50,
    });
    await assert.rejects(
      () => acquireReefRootWriterLock({
        projectId: registered.projectId,
        canonicalRoot: projectRoot,
        analysisHostId: "smoke-lock-b",
        acquireTimeoutMs: 50,
      }),
      /Timed out waiting for Reef root writer lock/,
    );
    await lock.release();

    const stop = await stopReefDaemon();
    assert.equal(stop.stopped, true);
    await foreground;
    assert.equal(await readReefDaemonProcessInfo(), null);

    process.env.MAKO_REEF_MODE = "required";
    const requiredClient = createReefClient();
    await assert.rejects(
      () => requiredClient.listProjectStatuses(),
      /No Reef daemon process metadata found/,
    );

    const operationLog = readFileSync(paths.operationLogPath, "utf8");
    assert.equal(operationLog.includes("root writer lock acquired"), true);
    assert.equal(operationLog.includes(tokenValue), false);

    console.log("reef-daemon-lifecycle: PASS");
  } finally {
    await stopReefDaemon().catch(() => undefined);
    restoreEnv("MAKO_STATE_HOME", originalStateHome);
    restoreEnv("MAKO_STATE_DIRNAME", originalStateDirName);
    restoreEnv("MAKO_REEF_MODE", originalReefMode);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
