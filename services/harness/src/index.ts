export { startHarnessServer } from "./server.js";
export type { HarnessServerOptions, StartedHarnessServer } from "./server.js";

// Note: this module used to end with an `isDirectInvocation()` guard plus a
// `startHarnessServer({...}).then(...)` block so `node services/harness/src/index.ts`
// could spin up the harness standalone. That was never actually invoked by
// anything in the repo (no scripts, tests, or docs run this file directly —
// `agentmako dashboard` is the only programmatic consumer), and when tsup
// bundled this file into the CLI the direct-execution guard fired
// spuriously: both `import.meta.url` and `process.argv[1]` resolved to the
// CLI bundle, so the guard returned true and the harness auto-started with
// `process.cwd()` as projectRoot before the CLI's main could route to the
// requested command. That collided with the dashboard launcher's own call
// to `startHarnessServer` on port 3018 and hid the real boot error behind
// a stray "mako-harness failed to start" line on stderr.
//
// `services/api/src/server.ts` documented and removed the same hazard for
// the API service. Re-add as a separate script file (e.g.
// `services/harness/src/bin.ts`) if standalone invocation is ever needed.
