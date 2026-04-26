/**
 * Real-world probe of the Roadmap 7.6 code-intel tools against forgebench:
 * - `lint_files` against a realistic file set
 * - `repo_map` at several token budgets
 *
 * Read-only. No mutation. Summarizes output to keep the run inspectable.
 */

import { openGlobalStore } from "../packages/store/src/index.ts";
import { invokeTool } from "../packages/tools/src/registry.ts";
import type {
  LintFilesToolOutput,
  RepoMapToolOutput,
} from "../packages/contracts/src/index.ts";

const FORGEBENCH_PATH = "C:/Users/Dustin/forgebench";

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

  console.log(`=== lint_files against forgebench (${projectId}) ===`);

  const lintTargets = [
    ["lib/events/actions.ts", "lib/events/dashboard.ts", "lib/events/queries.ts"],
    ["app/api/events/route.ts"],
    ["components/login-form.tsx", "components/sign-up-form.tsx"],
  ];

  for (const files of lintTargets) {
    const started = Date.now();
    try {
      const result = (await invokeTool("lint_files", {
        projectId,
        files,
      })) as LintFilesToolOutput;
      const codeCounts = new Map<string, number>();
      for (const finding of result.findings) {
        codeCounts.set(finding.code, (codeCounts.get(finding.code) ?? 0) + 1);
      }
      const codeSummary =
        codeCounts.size === 0
          ? "(none)"
          : [...codeCounts.entries()]
              .sort((left, right) => right[1] - left[1])
              .slice(0, 5)
              .map(([code, count]) => `${code}=${count}`)
              .join(" ");
      console.log(`\n-- files: ${files.join(", ")}`);
      console.log(
        `   resolved=${result.resolvedFiles.length}, unresolved=${result.unresolvedFiles.length}, findings=${result.findings.length}, truncated=${result.truncated}`,
      );
      console.log(`   top codes: ${codeSummary}`);
      for (const warning of result.warnings) {
        console.log(`   ⚠ ${warning}`);
      }
      console.log(`   (${Date.now() - started}ms)`);
    } catch (error) {
      console.log(`\n-- files: ${files.join(", ")}`);
      console.log(`   ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\n\n=== repo_map against forgebench ===`);

  const budgets = [512, 1024, 4096];
  for (const tokenBudget of budgets) {
    const started = Date.now();
    try {
      const result = (await invokeTool("repo_map", {
        projectId,
        tokenBudget,
      })) as RepoMapToolOutput;
      console.log(`\n-- tokenBudget=${tokenBudget}`);
      console.log(
        `   indexed=${result.totalFilesIndexed}, eligible=${result.totalFilesEligible}, included=${result.files.length}`,
      );
      console.log(
        `   estimatedTokens=${result.estimatedTokens}, truncatedByBudget=${result.truncatedByBudget}, truncatedByMaxFiles=${result.truncatedByMaxFiles}`,
      );
      console.log(`   top 5 files by score:`);
      for (const file of result.files.slice(0, 5)) {
        console.log(
          `     ${file.filePath} (score=${file.score.toFixed(2)}, in=${file.inboundCount}, out=${file.outboundCount}, symbols=${file.symbolsIncluded.length}/${file.symbolsTotal})`,
        );
      }
      console.log(`   first 600 chars of rendered output:`);
      const preview = result.rendered.slice(0, 600);
      console.log(preview.split("\n").map((line) => `     ${line}`).join("\n"));
      for (const warning of result.warnings) {
        console.log(`   ⚠ ${warning}`);
      }
      console.log(`   (${Date.now() - started}ms)`);
    } catch (error) {
      console.log(`\n-- tokenBudget=${tokenBudget}`);
      console.log(`   ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Focused variant so we can see the focus-boost in action on a real project.
  const focused = (await invokeTool("repo_map", {
    projectId,
    tokenBudget: 2048,
    focusFiles: ["app/api/events/route.ts"],
  })) as RepoMapToolOutput;
  console.log(`\n-- focused on app/api/events/route.ts, tokenBudget=2048`);
  console.log(
    `   first file in map: ${focused.files[0]?.filePath} (score=${focused.files[0]?.score.toFixed(2)})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
