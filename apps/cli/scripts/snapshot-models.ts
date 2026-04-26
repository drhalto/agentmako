/**
 * Phase 3.9: refresh the bundled models.dev snapshot shipped with the CLI.
 *
 * Usage:
 *   node --import tsx apps/cli/scripts/snapshot-models.ts [--url <url>] [--out <path>]
 *
 * Defaults:
 *   - URL: https://models.dev/api.json
 *   - OUT: packages/harness-contracts/models/snapshot.json
 *
 * After running this script, `corepack pnpm build` will copy the refreshed
 * snapshot into `apps/cli/dist/models-snapshot.json` via the tsup onSuccess
 * hook so the installed CLI bundle picks it up.
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const DEFAULT_URL = "https://models.dev/api.json";

function parseArgs(argv: string[]): { url: string; out: string } {
  let url = DEFAULT_URL;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--url" && argv[i + 1]) {
      url = argv[i + 1]!;
      i += 1;
    } else if (argv[i] === "--out" && argv[i + 1]) {
      out = argv[i + 1]!;
      i += 1;
    }
  }
  if (!out) {
    const here = fileURLToPath(new URL(".", import.meta.url));
    out = resolve(here, "../../../packages/harness-contracts/models/snapshot.json");
  }
  return { url, out };
}

async function main(): Promise<void> {
  const { url, out } = parseArgs(process.argv.slice(2));
  process.stdout.write(`fetching ${url}...\n`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`unexpected status ${response.status} from ${url}`);
    }
    const payload = await response.json();
    const body = {
      __fetchedAt: new Date().toISOString(),
      __source: url,
      payload,
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(body, null, 2), "utf8");
    const providerCount = Object.keys(payload as Record<string, unknown>).length;
    process.stdout.write(
      `wrote ${out}\n` +
        `  providers: ${providerCount}\n` +
        `  timestamp: ${body.__fetchedAt}\n`,
    );
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `snapshot-models failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
