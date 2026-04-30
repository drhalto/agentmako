import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const cliEntry = path.join(process.cwd(), "apps", "cli", "src", "index.ts");
const result = spawnSync(process.execPath, ["--import", "tsx", cliEntry, "--version"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+(?:[-+].+)?$/);

console.log("cli-version: PASS");
