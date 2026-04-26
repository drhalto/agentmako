import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import password from "@inquirer/password";
import type { AnswerToolQueryKind, AttachedProject, SupportLevel, ToolDefinitionSummary } from "@mako-ai/contracts";
import type { MakoApiService } from "@mako-ai/api";

export const CLI_COMMANDS = [
  "connect",
  "status",
  "verify",
  "refresh",
  "project list",
  "project attach",
  "project detach",
  "project index",
  "project status",
  "project db bind",
  "project db unbind",
  "project db test",
  "project db verify",
  "project db refresh",
  "answer ask",
  "tool list",
  "tool call",
  "workflow packet",
  "chat",
  "session list",
  "session show",
  "session resume",
  "session rm",
  "providers list",
  "providers test",
  "providers add",
  "providers remove",
  "keys set",
  "keys delete",
  "permissions list",
  "permissions add",
  "permissions remove",
  "permissions approve",
  "permissions deny",
  "undo",
  "tier",
  "memory remember",
  "memory recall",
  "memory list",
  "semantic search",
  "embeddings reindex",
  "catalog status",
  "catalog refresh",
  "usage",
  "telemetry show",
  "git precommit",
  "mcp",
  "dashboard",
  "serve",
  "doctor",
] as const;

const QUERY_KINDS = ["route_trace", "schema_usage", "auth_path", "file_health", "free_form"] as const;
export type CliAnswerQueryKind = AnswerToolQueryKind | "free_form";

export const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

export function color(text: string, colorCode: string): string {
  if (process.stdout.isTTY) {
    return `${colorCode}${text}${COLORS.reset}`;
  }
  return text;
}

export function printUsage(): void {
  console.log(`${color("agentmako CLI", COLORS.bright + COLORS.cyan)}

${color("Get started:", COLORS.bright)}
  ${color("agentmako connect", COLORS.yellow)} [path]       Attach + index + optional live DB connect + refresh
  ${color("agentmako status", COLORS.yellow)} [ref]         Show project status, snapshot, and DB binding state
  ${color("agentmako verify", COLORS.yellow)} [ref]         Verify the local schema snapshot against the live DB
  ${color("agentmako refresh", COLORS.yellow)} [ref]        Refresh the local schema snapshot from the live DB

${color("Connect options:", COLORS.bright)}
  ${color("--no-db", COLORS.gray)}                       Skip the live database step
  ${color("--db-env VAR", COLORS.gray)}                  Read DB URL from env var, bind as env_var_ref (CI)
  ${color("--keychain-from-env VAR", COLORS.gray)}       Read DB URL from env var, store in OS keychain (CI)
  ${color("--ref NAME", COLORS.gray)}                    Override the keychain entry ID
  ${color("--schemas a,b", COLORS.gray)}                 Override auto-discovered schema scope
  ${color("--yes", COLORS.gray)}                         Skip interactive prompts
  ${color("--no-index", COLORS.gray)}                    Skip the indexing step

${color("Dashboard:", COLORS.bright)}
  ${color("agentmako dashboard", COLORS.yellow)} [project]  Boot api + harness + web and open the browser
  ${color("--port N", COLORS.gray)}                         Override the dashboard port (default 3019)
  ${color("--api-port N / --harness-port N", COLORS.gray)}   Override service ports (defaults 3017 / 3018)
  ${color("--no-open", COLORS.gray)}                        Don't open the browser automatically

${color("Advanced / substrate:", COLORS.bright)}
  ${color("agentmako doctor", COLORS.yellow)}              Check system health and configuration
  ${color("agentmako serve", COLORS.yellow)} [port] [host]  Start the HTTP API server
  ${color("agentmako project list", COLORS.yellow)}        List all attached projects
  ${color("agentmako project attach", COLORS.yellow)} [path]   Attach a project for indexing
  ${color("agentmako project detach", COLORS.yellow)} [ref] [--purge] [--delete-secrets]
  ${color("agentmako project index", COLORS.yellow)} [path]    Index a project's codebase
  ${color("agentmako project status", COLORS.yellow)} [ref]    Show project status and stats
  ${color("agentmako project db bind", COLORS.yellow)} [ref] --strategy keychain_ref --url-from-env VAR
  ${color("agentmako project db bind", COLORS.yellow)} [ref] --strategy env_var_ref --ref VAR
  ${color("agentmako project db unbind", COLORS.yellow)} [ref] [--delete-secret]
  ${color("agentmako project db test", COLORS.yellow)} [ref]
  ${color("agentmako project db verify", COLORS.yellow)} [ref]
  ${color("agentmako project db refresh", COLORS.yellow)} [ref]
  ${color("agentmako answer ask", COLORS.yellow)} <ref> <kind> <question...>
  ${color("agentmako tool list", COLORS.yellow)}          List the shared tool surface
  ${color("agentmako tool call", COLORS.yellow)} <ref> <tool> <json-args>
  ${color("agentmako workflow packet", COLORS.yellow)} <ref> <family> <kind> <question...> [--watch] [--focus-item id1,id2]
  ${color("agentmako semantic search", COLORS.yellow)} <query> [--k N] [--kind code|doc|memory]
  ${color("agentmako embeddings reindex", COLORS.yellow)} [--kind semantic-unit|memory|all]
  ${color("agentmako catalog status|refresh", COLORS.yellow)}        Models.dev catalog source + force-refresh
  ${color("agentmako usage", COLORS.yellow)} [--days N] [--project ID] [--group-by model|kind|model+kind]
  ${color("agentmako git precommit", COLORS.yellow)} [ref] [--json]  Check staged TS/TSX route auth + server/client boundaries

${color("Query kinds:", COLORS.bright)}
  ${QUERY_KINDS.join(", ")}

${color("Examples:", COLORS.bright)}
  npx agentmako connect
  agentmako connect --no-db
  agentmako connect --keychain-from-env MAKO_DB_URL
  agentmako status
  agentmako verify
  agentmako refresh
  agentmako answer ask . route_trace "/api/v1/projects"
`);
}

export function parseQueryKind(value: string): CliAnswerQueryKind {
  if ((QUERY_KINDS as readonly string[]).includes(value)) {
    return value as CliAnswerQueryKind;
  }

  throw new Error(`Unknown query kind: ${value}`);
}

export function resolveSupportLevel(value: SupportLevel | undefined): SupportLevel {
  return value ?? "best_effort";
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

interface TableColumn {
  key: string;
  header: string;
  width: number;
  align?: "left" | "right";
}

function formatTable<T extends Record<string, string | number | undefined>>(
  rows: T[],
  columns: TableColumn[],
): string {
  if (rows.length === 0) {
    return color("No data", COLORS.gray);
  }

  const widths = columns.map((col) => {
    const headerLen = col.header.length;
    const maxDataLen = Math.max(...rows.map((row) => String(row[col.key] ?? "").length));
    return Math.min(Math.max(headerLen, maxDataLen, 3), col.width);
  });

  const headerLine = columns
    .map((col, index) => color(col.header.padEnd(widths[index]), COLORS.bright))
    .join("  ");
  const separator = widths.map((width) => "─".repeat(width)).join("──");
  const dataLines = rows.map((row) =>
    columns
      .map((col, index) => {
        const value = String(row[col.key] ?? "");
        const padded = col.align === "right" ? value.padStart(widths[index]) : value.padEnd(widths[index]);
        return padded.length > widths[index] ? `${padded.slice(0, widths[index] - 1)}…` : padded;
      })
      .join("  "),
  );

  return [headerLine, color(separator, COLORS.gray), ...dataLines].join("\n");
}

export function formatProjectList(projects: AttachedProject[]): string {
  if (projects.length === 0) {
    return color("No projects attached. Use `agentmako connect [path]` to add one.", COLORS.yellow);
  }

  const rows = projects.map((project) => ({
    id: `${project.projectId.slice(0, 8)}…`,
    name: project.displayName,
    path: project.canonicalPath,
    lastIndexed: project.lastIndexedAt ? new Date(project.lastIndexedAt).toLocaleDateString() : color("never", COLORS.gray),
  }));

  return formatTable(rows, [
    { key: "id", header: "ID", width: 10 },
    { key: "name", header: "Name", width: 20 },
    { key: "path", header: "Path", width: 40 },
    { key: "lastIndexed", header: "Last Indexed", width: 15 },
  ]);
}

export function formatToolList(tools: ToolDefinitionSummary[]): string {
  if (tools.length === 0) {
    return color("No tools registered.", COLORS.yellow);
  }

  const rows = tools.map((tool) => ({
    name: tool.name,
    category: tool.category,
    readOnly: "mutation" in tool.annotations ? "no" : "yes",
    description: tool.description,
  }));

  return formatTable(rows, [
    { key: "name", header: "Tool", width: 18 },
    { key: "category", header: "Category", width: 10 },
    { key: "readOnly", header: "RO", width: 4 },
    { key: "description", header: "Description", width: 80 },
  ]);
}

export interface CliOptions {
  json: boolean;
  interactive: boolean;
  commandArgs: string[];
}

export function parseGlobalArgs(argv: string[]): CliOptions {
  const json = argv.includes("--json");
  const interactive = argv.includes("--interactive");
  const commandArgs = argv.filter((arg) => arg !== "--json" && arg !== "--interactive");
  return { json, interactive, commandArgs };
}

export function shouldUseInteractive(options: CliOptions): boolean {
  if (options.json) {
    return false;
  }
  if (options.interactive) {
    return true;
  }
  return process.stdout.isTTY ?? false;
}

export interface DetachArgs {
  projectReference?: string;
  purge: boolean;
  deleteSecrets: boolean;
  yes: boolean;
}

export function parseDetachArgs(args: string[]): DetachArgs {
  let purge = false;
  let deleteSecrets = false;
  let yes = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === "--purge") {
      purge = true;
      continue;
    }
    if (arg === "--delete-secrets") {
      deleteSecrets = true;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown detach option: ${arg}`);
    }

    positional.push(arg);
  }

  return {
    projectReference: positional[0],
    purge,
    deleteSecrets,
    yes,
  };
}

export interface DbBindArgs {
  projectReference?: string;
  strategy?: "env_var_ref" | "keychain_ref";
  ref?: string;
  urlFromEnv?: string;
  urlStdin: boolean;
}

export function parseDbBindArgs(args: string[]): DbBindArgs {
  const result: DbBindArgs = { urlStdin: false };
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--strategy") {
      const value = args[index + 1];
      if (!value || (value !== "env_var_ref" && value !== "keychain_ref")) {
        throw new Error("`--strategy` must be `env_var_ref` or `keychain_ref`.");
      }
      result.strategy = value;
      index += 1;
      continue;
    }

    if (arg === "--ref") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--ref` requires a value.");
      }
      result.ref = value;
      index += 1;
      continue;
    }

    if (arg === "--url-from-env") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--url-from-env` requires an environment variable name.");
      }
      result.urlFromEnv = value;
      index += 1;
      continue;
    }

    if (arg === "--url-stdin") {
      result.urlStdin = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown db bind option: ${arg}`);
    }

    positional.push(arg);
  }

  result.projectReference = positional[0];
  return result;
}

export interface DbUnbindArgs {
  projectReference?: string;
  deleteSecret: boolean;
}

export function parseDbUnbindArgs(args: string[]): DbUnbindArgs {
  let deleteSecret = false;
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === "--delete-secret") {
      deleteSecret = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown db unbind option: ${arg}`);
    }
    positional.push(arg);
  }

  return { projectReference: positional[0], deleteSecret };
}

export interface DbVerifyRefreshArgs {
  projectReference?: string;
  includedSchemas?: string[];
}

export function parseDbVerifyRefreshArgs(commandName: string, args: string[]): DbVerifyRefreshArgs {
  const result: DbVerifyRefreshArgs = {};
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--schemas") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--schemas` requires a comma-separated list.");
      }
      result.includedSchemas = value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown db ${commandName} option: ${arg}`);
    }

    positional.push(arg);
  }

  result.projectReference = positional[0];
  return result;
}

export async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("`--url-stdin` requires piped input.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export async function promptYesNo(question: string, defaultValue: boolean): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
    const answer = (await rl.question(question + suffix)).trim().toLowerCase();
    if (answer === "") {
      return defaultValue;
    }
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export async function promptSecret(question: string): Promise<string> {
  if (!stdin.isTTY) {
    throw new Error(
      "Secure secret prompt requires an interactive terminal. Pass `--db-env <VAR>` for non-interactive capture.",
    );
  }

  // `@inquirer/password` handles raw-mode I/O, paste (including bracketed
  // paste on Windows terminals), backspace, Ctrl+C, and mask display across
  // every Node terminal the library supports. We own none of that logic.
  const answer = await password({
    message: question.replace(/:\s*$/u, ""),
    mask: false,
  });
  return answer.trim();
}

export interface ConnectArgs {
  projectReference?: string;
  bindDbExplicit: boolean | null;
  dbEnv?: string;
  keychainFromEnv?: string;
  ref?: string;
  schemas?: string[];
  yes: boolean;
  skipIndex: boolean;
}

export function parseConnectArgs(args: string[]): ConnectArgs {
  const result: ConnectArgs = {
    bindDbExplicit: null,
    yes: false,
    skipIndex: false,
  };
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--no-db") {
      result.bindDbExplicit = false;
      continue;
    }
    if (arg === "--db") {
      result.bindDbExplicit = true;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      result.yes = true;
      continue;
    }
    if (arg === "--no-index") {
      result.skipIndex = true;
      continue;
    }
    if (arg === "--db-env") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--db-env` requires an environment variable name.");
      }
      result.dbEnv = value;
      result.bindDbExplicit = true;
      index += 1;
      continue;
    }
    if (arg === "--keychain-from-env") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--keychain-from-env` requires an environment variable name.");
      }
      result.keychainFromEnv = value;
      result.bindDbExplicit = true;
      result.yes = true;
      index += 1;
      continue;
    }
    if (arg === "--ref") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--ref` requires a keychain entry id.");
      }
      result.ref = value;
      index += 1;
      continue;
    }
    if (arg === "--schemas") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("`--schemas` requires a comma-separated list.");
      }
      result.schemas = value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown connect option: ${arg}`);
    }
    positional.push(arg);
  }

  if (result.dbEnv && result.keychainFromEnv) {
    throw new Error("Cannot use both `--db-env` and `--keychain-from-env`.");
  }

  result.projectReference = positional[0];
  return result;
}

export function defaultKeychainRefFor(projectId: string): string {
  return `mako:${projectId}:primary-db`;
}

export function printDbConnectionGuide(orm: string): void {
  const bold = (text: string): string => color(text, COLORS.bright);
  const gray = (text: string): string => color(text, COLORS.gray);

  console.log();
  console.log(bold("Live database connection"));

  switch (orm) {
    case "supabase":
      console.log(gray("Detected Supabase. Grab your connection string from:"));
      console.log(gray("  Supabase dashboard → Project Settings → Database → Connection string"));
      console.log(gray("  Prefer the pooler URI (port 6543) for app/tooling use."));
      break;
    case "prisma":
      console.log(gray("Detected Prisma. Use the value of DATABASE_URL from your .env file."));
      break;
    case "drizzle":
      console.log(gray("Detected Drizzle. Check drizzle.config.ts or .env for the connection string."));
      break;
    case "sql":
      console.log(gray("Postgres connection string, e.g. postgresql://user:pass@host:5432/dbname"));
      break;
    default:
      console.log(gray("Postgres connection string, e.g. postgresql://user:pass@host:5432/dbname"));
      break;
  }

  console.log(gray("Input is hidden; the URL is stored in your OS keychain, not in the repo."));
  console.log();
}

export type ProjectStatusResultFromApi = NonNullable<ReturnType<MakoApiService["getProjectStatus"]>>;

export function computeNextStepHints(status: ProjectStatusResultFromApi): string[] {
  const hints: string[] = [];

  if (!status.latestRun || status.latestRun.status !== "succeeded") {
    hints.push("Run `agentmako project index` to build the schema snapshot for this project.");
    return hints;
  }

  const snapshotState = status.schemaSnapshot.state;
  if (snapshotState === "not_built") {
    hints.push("Schema sources are declared but no snapshot was persisted. Run `agentmako project index` again.");
  }

  if (status.schemaSnapshot.freshnessStatus === "refresh_required") {
    hints.push("Repo schema sources have drifted since the last snapshot. Run `agentmako project index` to rebuild.");
  }

  if (status.codeIndexFreshness.state === "dirty") {
    hints.push("Indexed code files have changed on disk. Run `agentmako project index` before relying on indexed search.");
  } else if (status.codeIndexFreshness.state === "unknown") {
    hints.push("Code-index freshness could not be proven. Run `agentmako project index` or use live text search for checks.");
  }

  const binding = status.dbBinding;
  if (!binding.configured) {
    if (binding.ref.trim() === "") {
      hints.push(
        "Run `agentmako connect` to attach a live database (optional), or `agentmako project db bind --strategy env_var_ref --ref MAKO_DB_URL` to wire one manually.",
      );
    } else if (binding.strategy === "keychain_ref") {
      hints.push(
        `Live DB binding is disabled. Run \`agentmako project db bind --strategy keychain_ref --ref ${binding.ref} --url-from-env <ENV_VAR>\` to re-enable it (keychain_ref requires a fresh secret source).`,
      );
    } else {
      hints.push(
        `Live DB binding is disabled. Run \`agentmako project db bind --strategy ${binding.strategy} --ref ${binding.ref}\` to re-enable it.`,
      );
    }
  } else {
    if (!binding.lastTestedAt) {
      hints.push("Run `agentmako project db test` to verify live DB connectivity.");
    } else if (binding.lastTestStatus === "failure") {
      hints.push("Last `agentmako project db test` failed. Fix the binding or re-run the test before verifying.");
    } else if (!binding.lastVerifiedAt && !binding.lastRefreshedAt) {
      hints.push("Run `agentmako verify` or `agentmako refresh` to compare the live catalog against the snapshot.");
    }

    if (binding.driftDetected) {
      hints.push(
        "Drift detected. Run `agentmako project index` followed by `agentmako refresh` to sync the snapshot to live.",
      );
    }
  }

  return hints;
}

export function printProjectStatusBlock(status: ProjectStatusResultFromApi): void {
  if (!status.project) {
    return;
  }

  console.log(color(`Project: ${status.project.displayName}`, COLORS.bright + COLORS.cyan));
  console.log(color(`Path: ${status.project.canonicalPath}`, COLORS.gray));
  console.log(color(`ID: ${status.project.projectId}`, COLORS.gray));
  console.log();

  if (status.manifest) {
    console.log(color("Manifest:", COLORS.bright));
    console.log(`  Path: ${status.manifestPath}`);
    console.log(`  Package Manager: ${status.manifest.packageManager}`);
    console.log(`  Frameworks: ${status.manifest.frameworks.join(", ")}`);
    console.log(`  Languages: ${status.manifest.languages.join(", ")}`);
    console.log(`  Database: ${status.manifest.database.kind} (${status.manifest.database.mode})`);
    if (status.manifest.database.defaultSchemaScope && status.manifest.database.defaultSchemaScope.length > 0) {
      console.log(`  Default Schema Scope: ${status.manifest.database.defaultSchemaScope.join(", ")}`);
    }
    if (status.manifest.database.schemaSources.length > 0) {
      console.log(`  Schema Sources: ${status.manifest.database.schemaSources.join(", ")}`);
    }
    console.log();
  }

  if (status.profile) {
    console.log(color("Profile:", COLORS.bright));
    console.log(`  Support Level: ${color(status.profile.supportLevel, COLORS.yellow)}`);
    console.log(`  Framework: ${status.profile.framework}`);
    console.log(`  ORM: ${status.profile.orm}`);
    console.log();
  }

  if (status.latestRun) {
    const statusColor =
      status.latestRun.status === "succeeded"
        ? COLORS.green
        : status.latestRun.status === "failed"
          ? COLORS.red
          : COLORS.yellow;
    console.log(color("Latest Index Run:", COLORS.bright));
    console.log(`  Status: ${color(status.latestRun.status, statusColor)}`);
    console.log(`  Started: ${status.latestRun.startedAt ?? "N/A"}`);
    console.log(`  Finished: ${status.latestRun.finishedAt ?? "N/A"}`);
    if (status.latestRun.stats) {
      console.log(`  Files: ${status.latestRun.stats.files ?? 0}`);
      console.log(`  Routes: ${status.latestRun.stats.routes ?? 0}`);
    }
    console.log();
  }

  if (status.stats) {
    console.log(color("Index Stats:", COLORS.bright));
    console.log(`  Files: ${status.stats.files}`);
    console.log(`  Chunks: ${status.stats.chunks}`);
    console.log(`  Symbols: ${status.stats.symbols}`);
    console.log(`  Import Edges: ${status.stats.importEdges}`);
    console.log(`  Routes: ${status.stats.routes}`);
    console.log(`  Schema Objects: ${status.stats.schemaObjects}`);
  }

  console.log();
  console.log(color("Code Index Freshness:", COLORS.bright));
  const codeFreshness = status.codeIndexFreshness;
  const codeFreshnessColor =
    codeFreshness.state === "fresh"
      ? COLORS.green
      : codeFreshness.state === "dirty"
        ? COLORS.yellow
        : COLORS.red;
  console.log(`  ${color("State:", COLORS.gray)} ${color(`${codeFreshness.state} (indexed rows only)`, codeFreshnessColor)}`);
  console.log(`  ${color("Checked:", COLORS.gray)} ${codeFreshness.checkedAt}`);
  console.log(`  ${color("Fresh:", COLORS.gray)} ${codeFreshness.freshCount}`);
  console.log(`  ${color("Stale:", COLORS.gray)} ${codeFreshness.staleCount}`);
  console.log(`  ${color("Deleted:", COLORS.gray)} ${codeFreshness.deletedCount}`);
  console.log(`  ${color("Unknown:", COLORS.gray)} ${codeFreshness.unknownCount}`);
  console.log(`  ${color("Unindexed scan:", COLORS.gray)} skipped`);
  const firstProblem = codeFreshness.sample.find((detail) => detail.state !== "fresh");
  if (firstProblem) {
    console.log(`  ${color("Sample:", COLORS.gray)} ${firstProblem.filePath} - ${firstProblem.reason}`);
  }

  console.log();
  console.log(color("Schema Snapshot:", COLORS.bright));
  const snapshotState = status.schemaSnapshot.state;
  console.log(`  ${color("State:", COLORS.gray)} ${snapshotState}`);
  if (snapshotState === "present") {
    if (status.schemaSnapshot.sourceMode) {
      console.log(`  ${color("Source mode:", COLORS.gray)} ${status.schemaSnapshot.sourceMode}`);
    }
    if (status.schemaSnapshot.freshnessStatus) {
      const freshnessColor =
        status.schemaSnapshot.freshnessStatus === "fresh" || status.schemaSnapshot.freshnessStatus === "verified"
          ? COLORS.green
          : COLORS.yellow;
      console.log(`  ${color("Freshness:", COLORS.gray)} ${color(status.schemaSnapshot.freshnessStatus, freshnessColor)}`);
    }
    if (status.schemaSnapshot.fingerprint) {
      console.log(`  ${color("Fingerprint:", COLORS.gray)} ${status.schemaSnapshot.fingerprint.slice(0, 16)}…`);
    }
    if (typeof status.schemaSnapshot.sourceCount === "number") {
      console.log(`  ${color("Sources:", COLORS.gray)} ${status.schemaSnapshot.sourceCount}`);
    }
    if (typeof status.schemaSnapshot.warningCount === "number" && status.schemaSnapshot.warningCount > 0) {
      console.log(`  ${color("Warnings:", COLORS.yellow)} ${status.schemaSnapshot.warningCount}`);
    }
  }

  console.log();
  console.log(color("Database Binding:", COLORS.bright));
  if (!status.dbBinding.configured) {
    const hasRef = status.dbBinding.ref.trim() !== "";
    if (!hasRef) {
      console.log(`  ${color("Status:", COLORS.gray)} not configured`);
    } else {
      console.log(`  ${color("Status:", COLORS.gray)} disabled`);
      console.log(`  ${color("Strategy:", COLORS.gray)} ${status.dbBinding.strategy}`);
      console.log(`  ${color("Ref:", COLORS.gray)} ${status.dbBinding.ref}`);
    }
  } else {
    console.log(`  ${color("Status:", COLORS.gray)} ${color("enabled", COLORS.green)}`);
    console.log(`  ${color("Strategy:", COLORS.gray)} ${status.dbBinding.strategy}`);
    console.log(`  ${color("Ref:", COLORS.gray)} ${status.dbBinding.ref}`);
    if (status.dbBinding.lastTestedAt) {
      const testColor = status.dbBinding.lastTestStatus === "success" ? COLORS.green : COLORS.red;
      console.log(`  ${color("Last test:", COLORS.gray)} ${color(status.dbBinding.lastTestStatus ?? "unknown", testColor)} at ${status.dbBinding.lastTestedAt}`);
    } else {
      console.log(`  ${color("Last test:", COLORS.gray)} never`);
    }
    if (status.dbBinding.lastVerifiedAt) {
      console.log(`  ${color("Last verified:", COLORS.gray)} ${status.dbBinding.lastVerifiedAt}`);
    }
    if (status.dbBinding.lastRefreshedAt) {
      console.log(`  ${color("Last refreshed:", COLORS.gray)} ${status.dbBinding.lastRefreshedAt}`);
    }
    if (status.dbBinding.sourceMode) {
      console.log(`  ${color("Source mode:", COLORS.gray)} ${status.dbBinding.sourceMode}`);
    }
    if (status.dbBinding.driftDetected) {
      console.log(`  ${color("Drift:", COLORS.yellow)} detected`);
    }
  }
}

export function printNextStepHints(hints: string[]): void {
  if (hints.length === 0) {
    return;
  }
  console.log();
  console.log(color("Next steps:", COLORS.bright));
  for (const hint of hints) {
    console.log(`  • ${hint}`);
  }
}

export function formatWarning(message: string): string {
  return `${color("⚠", COLORS.yellow)} ${color(message, COLORS.yellow)}`;
}

export function loadSchemaScopeFromStatus(status: ProjectStatusResultFromApi | null): string[] | undefined {
  const scope = status?.manifest?.database.defaultSchemaScope;
  if (!scope || scope.length === 0) {
    return undefined;
  }
  return [...scope];
}

export function printVerifyResult(result: Awaited<ReturnType<MakoApiService["verifyProjectDb"]>>): void {
  console.log();
  const verified = result.outcome === "verified";
  const icon = verified ? color("✓", COLORS.green) : color("⚠", COLORS.yellow);
  const label = verified ? color("Verified — no drift detected", COLORS.green) : color("Drift detected", COLORS.yellow);
  console.log(`${icon} ${label}`);

  if (result.includedSchemas && result.includedSchemas.length > 0) {
    console.log(`  ${color("Schemas:", COLORS.gray)} ${result.includedSchemas.join(", ")} (${result.includedSchemas.length})`);
  }

  const diffs = [
    { label: "Tables", diff: result.tableDiff },
    { label: "Columns", diff: result.columnDiff },
    { label: "Enums", diff: result.enumDiff },
    { label: "RPCs", diff: result.rpcDiff },
    { label: "Indexes", diff: result.indexDiff },
    { label: "Foreign keys", diff: result.foreignKeyDiff },
    { label: "RLS policies", diff: result.rlsDiff },
    { label: "Triggers", diff: result.triggerDiff },
  ];

  for (const { label: diffLabel, diff } of diffs) {
    const added = diff.additions.length;
    const removed = diff.removals.length;
    const unchanged = diff.unchangedCount;
    if (verified) {
      console.log(`  ${color(`${diffLabel}:`, COLORS.gray)} ${unchanged}`);
    } else {
      console.log(`  ${color(`${diffLabel}:`, COLORS.gray)} +${added} -${removed} (=${unchanged})`);
    }
  }

  if (!verified) {
    console.log();
    console.log(color("  Run `agentmako refresh` to update the local snapshot.", COLORS.gray));
  }
}

export function printRefreshResult(result: Awaited<ReturnType<MakoApiService["refreshProjectDb"]>>): void {
  console.log();
  console.log(
    `${color("✓", COLORS.green)} ${color("Snapshot refreshed", COLORS.green)} · ${color(`${result.sourceMode} · ${result.tableCount} tables`, COLORS.gray)}`,
  );
  if (result.warningCount > 0) {
    console.log(`  ${color("Warnings:", COLORS.yellow)} ${result.warningCount}`);
  }
}

export function printNotAttachedMessage(projectReference: string, interactive: boolean): void {
  if (!interactive) {
    throw new Error(`No attached project found for: ${projectReference}`);
  }

  console.log(formatWarning(`No project attached at ${projectReference}.`));
  console.log();
  console.log(color("Next steps:", COLORS.bright));

  let isCwd = false;
  try {
    isCwd = path.resolve(projectReference) === process.cwd();
  } catch {
    isCwd = false;
  }
  const needsQuoting = /\s/.test(projectReference);
  const pathSuffix = isCwd ? "" : ` ${needsQuoting ? `"${projectReference}"` : projectReference}`;
  console.log(`  • Run \`agentmako connect${pathSuffix}\` to attach this repo and optionally connect a live database.`);
  process.exitCode = 1;
}
