import assert from "node:assert/strict";
import {
  createMcpProgressReporter,
  GenericAgentClient,
  NOOP_PROGRESS_REPORTER,
  type McpProgressNotification,
} from "../../packages/tools/src/index.ts";

async function main(): Promise<void> {
  assert.doesNotThrow(() =>
    NOOP_PROGRESS_REPORTER.report({
      stage: "impact",
      message: "ignored",
      current: 1,
      total: 3,
    }),
  );

  const notifications: McpProgressNotification[] = [];
  const reporter = createMcpProgressReporter({
    progressToken: "progress-token-1",
    client: GenericAgentClient,
    sendNotification: (notification) => {
      notifications.push(notification);
    },
  });

  await reporter.report({
    stage: "impact",
    message: "Collecting impact context.",
    current: 1,
    total: 3,
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.method, "notifications/progress");
  assert.deepEqual(notifications[0]?.params, {
    progressToken: "progress-token-1",
    progress: 1,
    total: 3,
    message: "impact: Collecting impact context.",
  });

  // Stage-only emissions (no caller-supplied `current`) must still advance
  // the progress counter — MCP clients can deduplicate consecutive events
  // that share the same `progress` value, so two stage-only events in a row
  // would collapse to one. Each reporter owns a monotonic tick so the
  // fallback counter is observable on the wire.
  const counterNotifications: McpProgressNotification[] = [];
  const counterReporter = createMcpProgressReporter({
    progressToken: "progress-token-counter",
    client: GenericAgentClient,
    sendNotification: (notification) => {
      counterNotifications.push(notification);
    },
  });

  await counterReporter.report({ stage: "indexing" });
  await counterReporter.report({ stage: "composing", message: "Writing bundle." });
  await counterReporter.report({ stage: "finalize", current: 42 });

  assert.equal(counterNotifications.length, 3);
  assert.equal(counterNotifications[0]?.params.progress, 1, "first stage-only event starts the tick at 1");
  assert.equal(counterNotifications[1]?.params.progress, 2, "second stage-only event advances the tick");
  assert.equal(
    counterNotifications[2]?.params.progress,
    42,
    "explicit current from the caller overrides the tick",
  );
  assert.equal(counterNotifications[0]?.params.message, "indexing");
  assert.equal(counterNotifications[1]?.params.message, "composing: Writing bundle.");

  const errors: string[] = [];
  const failingReporter = createMcpProgressReporter({
    progressToken: "progress-token-2",
    client: GenericAgentClient,
    sendNotification: () => {
      throw new Error("transport closed");
    },
    logger: (message) => errors.push(message),
  });

  await assert.doesNotReject(() =>
    Promise.resolve(failingReporter.report({
      stage: "diagnostics",
      message: "This emission failure must not fail the tool.",
    })),
  );
  assert.deepEqual(errors, ["progress.emit-failed"]);

  const asyncErrors: string[] = [];
  const asyncFailingReporter = createMcpProgressReporter({
    progressToken: "progress-token-3",
    client: GenericAgentClient,
    sendNotification: async () => {
      throw new Error("async transport closed");
    },
    logger: (message) => asyncErrors.push(message),
  });

  await assert.doesNotReject(() =>
    Promise.resolve(asyncFailingReporter.report({
      stage: "composing",
    })),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(asyncErrors, ["progress.emit-failed"]);

  console.log("progress-reporter-basic: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
