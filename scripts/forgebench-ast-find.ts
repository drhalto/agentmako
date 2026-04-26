/**
 * Real-world smoke of `ast_find_pattern` against the forgebench project.
 *
 * Fires a handful of representative patterns — the kinds of structural
 * queries users actually ask — and reports what the new tool returns.
 * Read-only. No mutation.
 */

import { openGlobalStore } from "../packages/store/src/index.ts";
import { invokeTool } from "../packages/tools/src/registry.ts";
import type { AstFindPatternToolOutput } from "../packages/contracts/src/index.ts";

const FORGEBENCH_PATH = "C:/Users/Dustin/forgebench";

interface Probe {
  label: string;
  pattern: string;
  captures?: string[];
  languages?: ("ts" | "tsx" | "js" | "jsx")[];
  pathGlob?: string;
  maxMatches?: number;
}

const PROBES: Probe[] = [
  {
    label: "console.log with any argument",
    pattern: "console.log($X)",
    captures: ["X"],
  },
  {
    label: "useEffect with empty deps (structural-only)",
    pattern: "useEffect($FN, [])",
  },
  {
    label: "any `.rpc($NAME, $ARGS)` call — captures RPC name + args",
    pattern: "$OBJ.rpc($NAME, $ARGS)",
    captures: ["OBJ", "NAME", "ARGS"],
  },
  {
    label: "throw new Error with message",
    pattern: "throw new Error($MSG)",
    captures: ["MSG"],
  },
  {
    label: "next/navigation useRouter",
    pattern: "useRouter()",
  },
  {
    label: "async function with any body (TSX only)",
    pattern: "async function $NAME($$$PARAMS) { $$$BODY }",
    captures: ["NAME"],
    languages: ["tsx"],
  },
  {
    label: "app/ pathGlob — any function declaration",
    pattern: "function $NAME($$$PARAMS) { $$$BODY }",
    captures: ["NAME"],
    pathGlob: "app/**/*.tsx",
    maxMatches: 20,
  },
];

function summarize(result: AstFindPatternToolOutput, probe: Probe): void {
  const top = result.matches.slice(0, 5);
  const captureKeys = probe.captures ?? [];
  console.log(`\n--- ${probe.label}`);
  console.log(`    pattern: ${probe.pattern}`);
  console.log(
    `    filesScanned=${result.filesScanned}, matches=${result.matches.length}, truncated=${result.truncated}`,
  );
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }
  if (top.length === 0) {
    console.log("    (no matches)");
    return;
  }
  for (const match of top) {
    const capturesSummary =
      captureKeys.length > 0
        ? " " +
          captureKeys
            .map((key) => {
              const value = match.captures[key];
              if (value == null) return `${key}=<none>`;
              const snippet = value.length > 40 ? `${value.slice(0, 37)}...` : value;
              return `${key}=${JSON.stringify(snippet)}`;
            })
            .join(" ")
        : "";
    console.log(
      `    ${match.filePath}:${match.lineStart}:${match.columnStart}${capturesSummary}`,
    );
  }
  if (result.matches.length > top.length) {
    console.log(`    ... and ${result.matches.length - top.length} more`);
  }
}

async function main(): Promise<void> {
  const globalStore = openGlobalStore();
  let projectId: string;
  try {
    const existing = globalStore.getProjectByPath(FORGEBENCH_PATH);
    if (!existing) {
      console.error("forgebench not registered. Run scripts/forgebench-register.ts first.");
      process.exit(1);
    }
    projectId = existing.projectId;
  } finally {
    globalStore.close();
  }

  console.log(`Running ast_find_pattern probes against forgebench (${projectId})`);

  for (const probe of PROBES) {
    const started = Date.now();
    try {
      const result = (await invokeTool("ast_find_pattern", {
        projectId,
        pattern: probe.pattern,
        ...(probe.captures ? { captures: probe.captures } : {}),
        ...(probe.languages ? { languages: probe.languages } : {}),
        ...(probe.pathGlob ? { pathGlob: probe.pathGlob } : {}),
        ...(probe.maxMatches ? { maxMatches: probe.maxMatches } : {}),
      })) as AstFindPatternToolOutput;
      summarize(result, probe);
      console.log(`    (${Date.now() - started}ms)`);
    } catch (error) {
      console.log(`\n--- ${probe.label}`);
      console.log(
        `    ERROR: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
