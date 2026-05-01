import assert from "node:assert/strict";
import { SECRET_INPUT_MASK, printDbConnectionGuide } from "../../apps/cli/src/shared.js";

assert.equal(SECRET_INPUT_MASK, "*", "secret prompts should show masked paste feedback");

const originalLog = console.log;
const lines: string[] = [];
try {
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  printDbConnectionGuide("postgres");
} finally {
  console.log = originalLog;
}

const output = lines.join("\n");
assert.match(output, /masked with \* characters/i);
assert.match(output, /paste feedback is visible/i);
assert.match(output, /Ctrl\+Shift\+V/i);
assert.match(output, /OS keychain/i);

console.log("cli-secret-prompt: PASS");
