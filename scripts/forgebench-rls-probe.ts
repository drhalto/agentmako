import { invokeTool } from "../packages/tools/src/registry.ts";

const PROJECT_ID = "4bf6ebbd-fe39-46a6-8b4f-4b594563b32e";

async function main() {
  for (const table of ["events", "profiles", "support_tickets", "user_roles"]) {
    const live = (await invokeTool("db_rls", {
      projectId: PROJECT_ID,
      table,
      schema: "public",
    })) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const rlsEnabled = live?.rlsEnabled ?? live?.result?.rlsEnabled;
    const forceRls = live?.forceRls ?? live?.result?.forceRls;
    const policies = live?.policies ?? live?.result?.policies ?? [];
    console.log(`\n${`public.${table}`.padEnd(28)} rls=${rlsEnabled} force=${forceRls} policies=${policies.length}`);
    for (const p of policies) {
      const using = p.usingExpression ? ` USING(${p.usingExpression})` : "";
      console.log(`   - ${p.name} [${p.command}]${using}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
