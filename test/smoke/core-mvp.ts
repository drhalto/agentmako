import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { normalizePath, openGlobalStore, openProjectStore } from "../../packages/store/src/index.ts";
import {
  createToolService,
  registerToolDefinition,
  unregisterToolDefinition,
} from "../../packages/tools/src/index.ts";
import { computeVerificationDiff, diffHasAnyDifference } from "../../services/indexer/src/db-binding/verify.ts";
import { fetchLiveSchemaIR } from "../../services/indexer/src/db-binding/live-catalog.ts";
import { fetchPingInfo, withReadOnlyConnection } from "../../extensions/postgres/src/index.ts";
import {
  computeNextStepHints,
  type ProjectStatusResultFromApi,
} from "../../apps/cli/src/index.ts";
import {
  AskToolOutputSchema,
  ProjectLocatorInputSchema,
  type SchemaIR,
  type SchemaSnapshot,
} from "../../packages/contracts/src/index.ts";
import { startHttpApiServer } from "../../services/api/src/server.ts";
import { cleanupSmokeStateDir } from "./state-cleanup.ts";

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const HIDDEN_SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);
const HIDDEN_SUPABASE_SCHEMAS = new Set(["auth", "storage", "realtime", "graphql_public", "extensions"]);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.MAKO_STATE_HOME = os.tmpdir();
const stateDirName = `.mako-ai-smoke-${Date.now()}-${process.pid}`;
const homeStateDir = path.join(os.tmpdir(), stateDirName);
const projectStateDir = path.join(repoRoot, stateDirName);
const repoManifestDir = path.join(repoRoot, ".mako");
const secondaryProjectRoot = path.join(repoRoot, "apps", "web");
const secondaryManifestDir = path.join(secondaryProjectRoot, ".mako");
const repoManifestBackup = `${repoManifestDir}.smoke-backup`;
const secondaryManifestBackup = `${secondaryManifestDir}.smoke-backup`;

// The smoke suite asserts fresh-state values on `project attach` (e.g. `mode ===
// "repo_only"`), which only hold if the project starts without a pre-existing manifest.
// But the maintainer may have run `agentmako connect .` against the monorepo itself and
// left a real `.mako/` behind. We back those up at startup and restore at teardown so the
// test gets a clean slate *and* the maintainer's local dev state survives the run.
function setupFreshState(): void {
  cleanupSmokeStateDir(homeStateDir);
  cleanupSmokeStateDir(projectStateDir);

  // If a prior run crashed after backing up but before restoring, the backup still
  // represents the real pre-test state. Restore it first so we don't lose it on the
  // follow-up run's fresh-state setup.
  if (existsSync(repoManifestBackup)) {
    rmSync(repoManifestDir, { recursive: true, force: true });
    renameSync(repoManifestBackup, repoManifestDir);
  }
  if (existsSync(repoManifestDir)) {
    renameSync(repoManifestDir, repoManifestBackup);
  }

  if (existsSync(secondaryManifestBackup)) {
    rmSync(secondaryManifestDir, { recursive: true, force: true });
    renameSync(secondaryManifestBackup, secondaryManifestDir);
  }
  if (existsSync(secondaryManifestDir)) {
    renameSync(secondaryManifestDir, secondaryManifestBackup);
  }
}

function teardownState(): void {
  cleanupSmokeStateDir(homeStateDir);
  cleanupSmokeStateDir(projectStateDir);

  // Delete whatever `.mako/` the test run wrote, then restore the maintainer's
  // pre-test backup if one was made.
  rmSync(repoManifestDir, { recursive: true, force: true });
  if (existsSync(repoManifestBackup)) {
    renameSync(repoManifestBackup, repoManifestDir);
  }

  rmSync(secondaryManifestDir, { recursive: true, force: true });
  if (existsSync(secondaryManifestBackup)) {
    renameSync(secondaryManifestBackup, secondaryManifestDir);
  }
}

function runCli(args: string[]): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    // Use the built CLI, not tsx source, to avoid module resolution issues in subprocess
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "apps/cli/dist/index.js"), ...args],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          MAKO_STATE_HOME: os.tmpdir(),
          MAKO_STATE_DIRNAME: stateDirName,
        },
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

async function runCliJson(args: string[]): Promise<unknown> {
  const result = await runCli(["--json", ...args]);

  if (result.exitCode !== 0) {
    throw new Error(`CLI failed for \`${args.join(" ")}\`:\n${result.stderr || result.stdout}`);
  }

  return JSON.parse(result.stdout.trim());
}

function runCliWithInput(args: string[], input: string): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, "apps/cli/dist/index.js"), ...args],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          MAKO_STATE_HOME: os.tmpdir(),
          MAKO_STATE_DIRNAME: stateDirName,
        },
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; requestId: string | null; body: unknown }> {
  const response = await fetch(url, init);
  const body = (await response.json()) as unknown;
  return {
    status: response.status,
    requestId: response.headers.get("x-request-id"),
    body,
  };
}

function makeHintStatusFixture(
  overrides: {
    latestRunStatus?: "succeeded" | "failed" | "queued" | null;
    snapshotState?: "present" | "no_sources" | "not_built";
    freshnessStatus?: string;
    binding?: Partial<ProjectStatusResultFromApi["dbBinding"]>;
  } = {},
): ProjectStatusResultFromApi {
  const base = {
    project: {
      projectId: "p_fake",
      displayName: "fake",
      canonicalPath: "/tmp/fake",
      lastSeenPath: "/tmp/fake",
      status: "active",
      supportTarget: "mako-ai",
      attachedAt: "2026-01-01T00:00:00.000Z",
    },
    manifest: null,
    manifestPath: "/tmp/fake/.mako/project.json",
    profile: null,
    latestRun:
      overrides.latestRunStatus === undefined
        ? { status: "succeeded" }
        : overrides.latestRunStatus === null
          ? null
          : { status: overrides.latestRunStatus },
    stats: null,
    schemaSnapshot: {
      state: overrides.snapshotState ?? "present",
      freshnessStatus: overrides.freshnessStatus ?? "fresh",
    },
    codeIndexFreshness: {
      checkedAt: "2026-01-01T00:00:00.000Z",
      state: "fresh",
      freshCount: 1,
      staleCount: 0,
      deletedCount: 0,
      unindexedCount: 0,
      unknownCount: 0,
      sample: [],
    },
    dbBinding: {
      strategy: "keychain_ref",
      ref: "",
      enabled: false,
      configured: false,
      ...overrides.binding,
    },
  };
  return base as unknown as ProjectStatusResultFromApi;
}

function makeSchemaIRFixture(
  schemas: Record<
    string,
    {
      tables?: Array<{
        name: string;
        columns?: string[];
        indexes?: Array<{
          name: string;
          unique?: boolean;
          primary?: boolean;
          columns?: string[];
          definition?: string | null;
        }>;
        foreignKeys?: {
          outbound?: Array<{
            constraintName: string;
            columns: string[];
            targetSchema: string;
            targetTable: string;
            targetColumns: string[];
            onUpdate?: string;
            onDelete?: string;
          }>;
          inbound?: Array<{
            constraintName: string;
            sourceSchema: string;
            sourceTable: string;
            sourceColumns: string[];
            columns: string[];
            onUpdate?: string;
            onDelete?: string;
          }>;
        };
        rls?: {
          rlsEnabled?: boolean;
          forceRls?: boolean;
          policies?: Array<{
            name: string;
            mode?: "PERMISSIVE" | "RESTRICTIVE";
            command?: string;
            roles?: string[];
            usingExpression?: string | null;
            withCheckExpression?: string | null;
          }>;
        };
        triggers?: Array<{
          name: string;
          enabled?: boolean;
          enabledMode?: "O" | "D" | "R" | "A";
          timing?: string;
          events?: string[];
        }>;
      }>;
      enums?: Array<{ name: string; values: string[] }>;
      rpcs?: string[];
    }
  >,
): SchemaIR {
  const ir: SchemaIR = { version: "1.0.0", schemas: {} };
  for (const [schemaName, payload] of Object.entries(schemas)) {
    ir.schemas[schemaName] = {
      tables: (payload.tables ?? []).map((table) => ({
        name: table.name,
        schema: schemaName,
        columns: (table.columns ?? []).map((columnName) => ({
          name: columnName,
          dataType: "text",
          nullable: false,
          sources: [{ kind: "sql_migration" as const, path: "fixture.sql" }],
        })),
        ...(table.indexes
          ? {
              indexes: table.indexes.map((index) => ({
                name: index.name,
                unique: index.unique ?? false,
                primary: index.primary ?? false,
                columns: [...(index.columns ?? [])],
                definition: index.definition ?? null,
              })),
            }
          : {}),
        ...(table.foreignKeys
          ? {
              foreignKeys: {
                outbound: (table.foreignKeys.outbound ?? []).map((fk) => ({
                  constraintName: fk.constraintName,
                  columns: [...fk.columns],
                  targetSchema: fk.targetSchema,
                  targetTable: fk.targetTable,
                  targetColumns: [...fk.targetColumns],
                  onUpdate: fk.onUpdate ?? "NO ACTION",
                  onDelete: fk.onDelete ?? "NO ACTION",
                })),
                inbound: (table.foreignKeys.inbound ?? []).map((fk) => ({
                  constraintName: fk.constraintName,
                  sourceSchema: fk.sourceSchema,
                  sourceTable: fk.sourceTable,
                  sourceColumns: [...fk.sourceColumns],
                  columns: [...fk.columns],
                  onUpdate: fk.onUpdate ?? "NO ACTION",
                  onDelete: fk.onDelete ?? "NO ACTION",
                })),
              },
            }
          : {}),
        ...(table.rls
          ? {
              rls: {
                rlsEnabled: table.rls.rlsEnabled ?? false,
                forceRls: table.rls.forceRls ?? false,
                policies: (table.rls.policies ?? []).map((policy) => ({
                  name: policy.name,
                  mode: policy.mode ?? "PERMISSIVE",
                  command: policy.command ?? "ALL",
                  roles: [...(policy.roles ?? [])],
                  usingExpression: policy.usingExpression ?? null,
                  withCheckExpression: policy.withCheckExpression ?? null,
                })),
              },
            }
          : {}),
        ...(table.triggers
          ? {
              triggers: table.triggers.map((trigger) => ({
                name: trigger.name,
                enabled: trigger.enabled ?? true,
                enabledMode: trigger.enabledMode ?? "O",
                timing: trigger.timing ?? "AFTER",
                events: [...(trigger.events ?? ["INSERT"])],
              })),
            }
          : {}),
        sources: [{ kind: "sql_migration" as const, path: "fixture.sql" }],
      })),
      views: [],
      enums: (payload.enums ?? []).map((enumDef) => ({
        name: enumDef.name,
        schema: schemaName,
        values: enumDef.values,
        sources: [{ kind: "sql_migration" as const, path: "fixture.sql" }],
      })),
      rpcs: (payload.rpcs ?? []).map((rpcName) => ({
        name: rpcName,
        schema: schemaName,
        sources: [{ kind: "sql_migration" as const, path: "fixture.sql" }],
      })),
    };
  }
  return ir;
}

function isSchemaHiddenByDefaultForSmoke(schemaName: string, platform: string): boolean {
  if (HIDDEN_SYSTEM_SCHEMAS.has(schemaName) || /^pg_(toast_)?temp_/.test(schemaName)) {
    return true;
  }

  if (platform === "supabase" && HIDDEN_SUPABASE_SCHEMAS.has(schemaName)) {
    return true;
  }

  return false;
}

async function discoverExpectedVisibleSchemas(databaseUrl: string): Promise<{ visible: string[]; hidden: string[] }> {
  return withReadOnlyConnection({ databaseUrl, statementTimeoutMs: 10_000 }, async (context) => {
    const ping = await fetchPingInfo(context);
    const schemaResult = await context.query<{ schema_name: string }>(`
      SELECT nspname AS schema_name
      FROM pg_catalog.pg_namespace
      ORDER BY nspname
    `);

    const visible: string[] = [];
    const hidden: string[] = [];
    for (const row of schemaResult.rows) {
      if (isSchemaHiddenByDefaultForSmoke(row.schema_name, ping.platform)) {
        hidden.push(row.schema_name);
      } else {
        visible.push(row.schema_name);
      }
    }

    return { visible, hidden };
  });
}

async function loadExpectedPolicies(
  databaseUrl: string,
  schemaName: string,
  tableName: string,
): Promise<
  Array<{
    name: string;
    mode: "PERMISSIVE" | "RESTRICTIVE";
    command: string;
    roles: string[];
    usingExpression: string | null;
    withCheckExpression: string | null;
  }>
> {
  return withReadOnlyConnection({ databaseUrl, statementTimeoutMs: 10_000 }, async (context) => {
    const result = await context.query<{
      policyname: string;
      permissive: string;
      roles: string[] | null;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `SELECT
         policyname,
         permissive,
         roles::text[] AS roles,
         cmd,
         qual,
         with_check
       FROM pg_catalog.pg_policies
       WHERE schemaname = $1
         AND tablename = $2
       ORDER BY policyname`,
      [schemaName, tableName],
    );

    return result.rows.map((row) => ({
      name: row.policyname,
      mode: row.permissive === "RESTRICTIVE" ? "RESTRICTIVE" : "PERMISSIVE",
      command: row.cmd === "*" ? "ALL" : row.cmd.toUpperCase(),
      roles: [...(row.roles ?? [])],
      usingExpression: row.qual ?? null,
      withCheckExpression: row.with_check ?? null,
    }));
  });
}

async function main(): Promise<void> {
  setupFreshState();

  // Phase 3.1: computeNextStepHints branch coverage. Pure function, no DB needed.
  {
    const notIndexed = makeHintStatusFixture({ latestRunStatus: null });
    const notIndexedHints = computeNextStepHints(notIndexed);
    assert.ok(
      notIndexedHints.some((hint) => hint.includes("mako project index")),
      "expected not-indexed project to suggest running index",
    );

    const indexedNoDb = makeHintStatusFixture({
      binding: { configured: false, ref: "", enabled: false },
    });
    const indexedNoDbHints = computeNextStepHints(indexedNoDb);
    assert.ok(
      indexedNoDbHints.some((hint) => hint.includes("mako project db bind")),
      "expected indexed project with no binding to suggest db bind",
    );

    const bindingDisabledWithRef = makeHintStatusFixture({
      binding: {
        configured: false,
        enabled: false,
        strategy: "env_var_ref",
        ref: "MAKO_OLD_REF",
      },
    });
    const bindingDisabledHints = computeNextStepHints(bindingDisabledWithRef);
    assert.ok(
      bindingDisabledHints.some((hint) => hint.includes("MAKO_OLD_REF")),
      "expected a disabled binding with a ref to suggest re-enabling with that ref",
    );

    // Phase 3.1 review fix: disabled keychain_ref bindings must point at --url-from-env in the
    // re-enable hint because `mako project db bind --strategy keychain_ref` always needs a
    // fresh secret source.
    const disabledKeychainBinding = makeHintStatusFixture({
      binding: {
        configured: false,
        enabled: false,
        strategy: "keychain_ref",
        ref: "mako:proj_abc:primary-db",
      },
    });
    const disabledKeychainHints = computeNextStepHints(disabledKeychainBinding);
    const disabledKeychainReenableHint = disabledKeychainHints.find((hint) =>
      hint.includes("re-enable"),
    );
    assert.ok(
      disabledKeychainReenableHint,
      "expected a re-enable hint for a disabled keychain_ref binding",
    );
    assert.match(
      disabledKeychainReenableHint!,
      /--url-from-env/,
      "expected the disabled keychain_ref re-enable hint to include --url-from-env",
    );
    assert.match(
      disabledKeychainReenableHint!,
      /mako:proj_abc:primary-db/,
      "expected the disabled keychain_ref re-enable hint to carry the original ref",
    );
    assert.match(
      disabledKeychainReenableHint!,
      /keychain_ref/,
      "expected the disabled keychain_ref hint to name the correct strategy",
    );

    const boundNotTested = makeHintStatusFixture({
      binding: {
        configured: true,
        enabled: true,
        strategy: "env_var_ref",
        ref: "MAKO_DB",
      },
    });
    const boundNotTestedHints = computeNextStepHints(boundNotTested);
    assert.ok(
      boundNotTestedHints.some((hint) => hint.includes("mako project db test")),
      "expected bound-but-untested project to suggest test",
    );

    const testedNotVerified = makeHintStatusFixture({
      binding: {
        configured: true,
        enabled: true,
        strategy: "env_var_ref",
        ref: "MAKO_DB",
        lastTestedAt: "2026-01-01T00:00:00.000Z",
        lastTestStatus: "success",
      },
    });
    const testedNotVerifiedHints = computeNextStepHints(testedNotVerified);
    assert.ok(
      testedNotVerifiedHints.some(
        (hint) => hint.includes("verify") || hint.includes("refresh"),
      ),
      "expected tested-but-not-verified project to suggest verify or refresh",
    );

    const testFailed = makeHintStatusFixture({
      binding: {
        configured: true,
        enabled: true,
        strategy: "env_var_ref",
        ref: "MAKO_DB",
        lastTestedAt: "2026-01-01T00:00:00.000Z",
        lastTestStatus: "failure",
      },
    });
    const testFailedHints = computeNextStepHints(testFailed);
    assert.ok(
      testFailedHints.some((hint) => hint.toLowerCase().includes("test")),
      "expected a failed test to surface a retry hint",
    );

    const driftDetected = makeHintStatusFixture({
      binding: {
        configured: true,
        enabled: true,
        strategy: "env_var_ref",
        ref: "MAKO_DB",
        lastTestedAt: "2026-01-01T00:00:00.000Z",
        lastTestStatus: "success",
        lastVerifiedAt: "2026-01-01T00:00:00.000Z",
        driftDetected: true,
      },
    });
    const driftHints = computeNextStepHints(driftDetected);
    assert.ok(
      driftHints.some((hint) => hint.includes("Drift")),
      "expected drift-detected status to surface a drift resync hint",
    );

    const allCaughtUp = makeHintStatusFixture({
      binding: {
        configured: true,
        enabled: true,
        strategy: "env_var_ref",
        ref: "MAKO_DB",
        lastTestedAt: "2026-01-01T00:00:00.000Z",
        lastTestStatus: "success",
        lastRefreshedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    assert.equal(
      computeNextStepHints(allCaughtUp).length,
      0,
      "expected no hints when project is indexed, bound, tested, and refreshed",
    );

    const refreshRequired = makeHintStatusFixture({ freshnessStatus: "refresh_required" });
    const refreshRequiredHints = computeNextStepHints(refreshRequired);
    assert.ok(
      refreshRequiredHints.some((hint) => hint.includes("mako project index")),
      "expected refresh_required snapshot to suggest re-running index",
    );
  }

  // Phase 3 review fix: computeVerificationDiff must filter BOTH sides when
  // includedSchemas is passed, and must not leak comparison across the filter.
  // Exercised directly via the pure function so this runs without a real DB.
  {
    const storedIR = makeSchemaIRFixture({
      public: {
        tables: [{ name: "users", columns: ["id", "email"] }],
        enums: [{ name: "user_role", values: ["admin", "member"] }],
        rpcs: ["search_users"],
      },
      ops: {
        tables: [{ name: "audit_log", columns: ["id", "event"] }],
      },
    });

    const identicalLiveIR = makeSchemaIRFixture({
      public: {
        tables: [{ name: "users", columns: ["id", "email"] }],
        enums: [{ name: "user_role", values: ["admin", "member"] }],
        rpcs: ["search_users"],
      },
      ops: {
        tables: [{ name: "audit_log", columns: ["id", "event"] }],
      },
    });

    const fullClean = computeVerificationDiff(storedIR, identicalLiveIR);
    assert.equal(diffHasAnyDifference(fullClean), false, "expected full clean diff");
    assert.equal(fullClean.tableDiff.unchangedCount, 2);
    assert.equal(fullClean.indexDiff.unchangedCount, 0, "expected rich diffs to stay inert for repo-only fixtures");
    assert.equal(fullClean.foreignKeyDiff.unchangedCount, 0, "expected rich diffs to stay inert for repo-only fixtures");
    assert.equal(fullClean.rlsDiff.unchangedCount, 0, "expected rich diffs to stay inert for repo-only fixtures");
    assert.equal(fullClean.triggerDiff.unchangedCount, 0, "expected rich diffs to stay inert for repo-only fixtures");

    const liveWithOpsDrift = makeSchemaIRFixture({
      public: {
        tables: [{ name: "users", columns: ["id", "email"] }],
        enums: [{ name: "user_role", values: ["admin", "member"] }],
        rpcs: ["search_users"],
      },
      ops: {
        tables: [
          { name: "audit_log", columns: ["id", "event"] },
          { name: "new_ops_table", columns: ["id"] },
        ],
      },
    });

    const fullDrift = computeVerificationDiff(storedIR, liveWithOpsDrift);
    assert.equal(diffHasAnyDifference(fullDrift), true, "expected drift when ops changes");
    assert.deepEqual(fullDrift.tableDiff.additions, ["ops.new_ops_table"]);

    const partialPublicOnly = computeVerificationDiff(storedIR, liveWithOpsDrift, {
      includedSchemas: ["public"],
    });
    assert.equal(
      diffHasAnyDifference(partialPublicOnly),
      false,
      "expected ops-side drift to be invisible when scoped to public",
    );
    assert.equal(partialPublicOnly.tableDiff.additions.length, 0);
    assert.equal(partialPublicOnly.tableDiff.removals.length, 0);
    assert.equal(
      partialPublicOnly.tableDiff.unchangedCount,
      1,
      "expected only the public.users table in the scoped compare",
    );

    const liveWithPublicDrift = makeSchemaIRFixture({
      public: {
        tables: [
          { name: "users", columns: ["id", "email"] },
          { name: "posts", columns: ["id", "title"] },
        ],
        enums: [{ name: "user_role", values: ["admin", "member"] }],
        rpcs: ["search_users"],
      },
      ops: {
        tables: [{ name: "audit_log", columns: ["id", "event"] }],
      },
    });

    const partialPublicDrift = computeVerificationDiff(storedIR, liveWithPublicDrift, {
      includedSchemas: ["public"],
    });
    assert.equal(
      diffHasAnyDifference(partialPublicDrift),
      true,
      "expected public-side drift to be caught in the scoped compare",
    );
    assert.deepEqual(partialPublicDrift.tableDiff.additions, ["public.posts"]);

    const liveMissingStoredTable = makeSchemaIRFixture({
      public: {
        tables: [{ name: "users", columns: ["id", "email"] }],
        enums: [{ name: "user_role", values: ["admin", "member"] }],
        rpcs: ["search_users"],
      },
      ops: {},
    });
    const partialOpsDrift = computeVerificationDiff(storedIR, liveMissingStoredTable, {
      includedSchemas: ["ops"],
    });
    assert.equal(
      diffHasAnyDifference(partialOpsDrift),
      true,
      "expected a removal to be reported when a stored ops table disappears from live",
    );
    assert.deepEqual(partialOpsDrift.tableDiff.removals, ["ops.audit_log"]);
    assert.equal(partialOpsDrift.tableDiff.additions.length, 0);

    const storedLiveRichIR = makeSchemaIRFixture({
      public: {
        tables: [
          {
            name: "users",
            columns: ["id", "email"],
            indexes: [
              {
                name: "users_email_idx",
                unique: true,
                columns: ["email"],
                definition: "CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email)",
              },
            ],
            foreignKeys: {
              outbound: [
                {
                  constraintName: "users_account_id_fkey",
                  columns: ["account_id"],
                  targetSchema: "public",
                  targetTable: "accounts",
                  targetColumns: ["id"],
                  onUpdate: "CASCADE",
                  onDelete: "RESTRICT",
                },
              ],
            },
            rls: {
              rlsEnabled: true,
              forceRls: false,
              policies: [
                {
                  name: "users_select",
                  mode: "PERMISSIVE",
                  command: "SELECT",
                  roles: ["authenticated", "PUBLIC"],
                  usingExpression: "(auth.uid() = id)",
                },
              ],
            },
            triggers: [
              {
                name: "users_set_updated_at",
                enabledMode: "O",
                timing: "BEFORE",
                events: ["UPDATE"],
              },
            ],
          },
        ],
      },
    });
    const liveRichDriftIR = makeSchemaIRFixture({
      public: {
        tables: [
          {
            name: "users",
            columns: ["id", "email"],
            indexes: [
              {
                name: "users_email_idx",
                unique: true,
                columns: ["email"],
                definition: "CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email)",
              },
              {
                name: "users_created_at_idx",
                columns: ["created_at"],
                definition: "CREATE INDEX users_created_at_idx ON public.users USING btree (created_at)",
              },
            ],
            foreignKeys: {
              outbound: [
                {
                  constraintName: "users_account_id_fkey",
                  columns: ["account_id"],
                  targetSchema: "public",
                  targetTable: "accounts",
                  targetColumns: ["id"],
                  onUpdate: "CASCADE",
                  onDelete: "CASCADE",
                },
              ],
            },
            rls: {
              rlsEnabled: true,
              forceRls: true,
              policies: [
                {
                  name: "users_select",
                  mode: "RESTRICTIVE",
                  command: "SELECT",
                  roles: ["PUBLIC", "authenticated"],
                  usingExpression: "(auth.uid() = id)",
                },
              ],
            },
            triggers: [
              {
                name: "users_set_updated_at",
                enabledMode: "D",
                timing: "BEFORE",
                events: ["UPDATE"],
              },
            ],
          },
        ],
      },
    });
    const richDrift = computeVerificationDiff(storedLiveRichIR, liveRichDriftIR);
    assert.equal(diffHasAnyDifference(richDrift), true, "expected rich metadata drift to count as schema drift");
    assert.deepEqual(richDrift.indexDiff.additions, [
      "public.users.users_created_at_idx::unique=0::primary=0::columns=created_at::definition=CREATE INDEX users_created_at_idx ON public.users USING btree (created_at)",
    ]);
    assert.deepEqual(richDrift.foreignKeyDiff.additions, [
      "public.users.users_account_id_fkey::columns=account_id::target=public.accounts::targetColumns=id::onUpdate=CASCADE::onDelete=CASCADE",
    ]);
    assert.deepEqual(richDrift.foreignKeyDiff.removals, [
      "public.users.users_account_id_fkey::columns=account_id::target=public.accounts::targetColumns=id::onUpdate=CASCADE::onDelete=RESTRICT",
    ]);
    assert.deepEqual(richDrift.rlsDiff.additions, [
      "public.users.users_select::mode=RESTRICTIVE::command=SELECT::roles=PUBLIC|authenticated::using=(auth.uid() = id)::withCheck=",
      "public.users::__state::enabled=1::force=1",
    ]);
    assert.deepEqual(richDrift.rlsDiff.removals, [
      "public.users.users_select::mode=PERMISSIVE::command=SELECT::roles=PUBLIC|authenticated::using=(auth.uid() = id)::withCheck=",
      "public.users::__state::enabled=1::force=0",
    ]);
    assert.deepEqual(richDrift.triggerDiff.additions, [
      "public.users.users_set_updated_at::enabledMode=D::timing=BEFORE::events=UPDATE",
    ]);
    assert.deepEqual(richDrift.triggerDiff.removals, [
      "public.users.users_set_updated_at::enabledMode=O::timing=BEFORE::events=UPDATE",
    ]);
  }

  const attachResult = (await runCliJson(["project", "attach"])) as {
    project: { projectId: string; displayName: string };
    manifest: {
      projectId: string;
      database: { mode: string; liveBinding: { enabled: boolean } };
    };
    manifestPath: string;
  };
  assert.equal(attachResult.project.displayName, "mako-ai");
  assert.equal(attachResult.manifest.projectId, attachResult.project.projectId);
  assert.equal(attachResult.manifest.database.mode, "repo_only");
  assert.equal(attachResult.manifest.database.liveBinding.enabled, false);
  assert.match(attachResult.manifestPath, /\.mako[\\/]project\.json$/);

  const customizedManifest = JSON.parse(readFileSync(attachResult.manifestPath, "utf8")) as {
    database: {
      mode: string;
      liveBinding: { strategy: string; ref: string; enabled: boolean };
    };
    indexing: { include: string[]; exclude: string[] };
  };
  customizedManifest.database.mode = "live_refresh_enabled";
  customizedManifest.database.liveBinding = {
    strategy: "env_var_ref",
    ref: "MAKO_TEST_DATABASE_URL",
    enabled: true,
  };
  customizedManifest.indexing = {
    include: ["apps", "packages", "services"],
    exclude: [".mako", stateDirName, "node_modules", "tmp-custom"],
  };
  writeFileSync(attachResult.manifestPath, `${JSON.stringify(customizedManifest, null, 2)}\n`, "utf8");

  const listResult = (await runCliJson(["project", "list"])) as Array<{
    projectId: string;
  }>;
  assert.ok(
    listResult.some((project) => project.projectId === attachResult.project.projectId),
    "expected attached project in `project list` output",
  );

  const indexResult = (await runCliJson(["project", "index"])) as {
    stats: { routes: number };
    schemaSnapshot: { state: string };
  };
  assert.ok(indexResult.stats.routes >= 6, "expected local HTTP routes to be indexed");
  assert.equal(
    indexResult.schemaSnapshot.state,
    "no_sources",
    "expected no_sources schema snapshot state for the mako-ai repo (no declared schema sources)",
  );

  const statusResult = (await runCliJson(["project", "status"])) as {
    latestRun: { status: string };
    manifest: {
      projectId: string;
      packageManager: string;
      database: { mode: string; liveBinding: { strategy: string; ref: string; enabled: boolean } };
      indexing: { include: string[]; exclude: string[] };
    };
  };
  assert.equal(statusResult.latestRun.status, "succeeded");
  assert.equal(statusResult.manifest.projectId, attachResult.project.projectId);
  assert.equal(statusResult.manifest.packageManager, "pnpm");
  assert.equal(statusResult.manifest.database.mode, "live_refresh_enabled");
  assert.deepEqual(statusResult.manifest.database.liveBinding, {
    strategy: "env_var_ref",
    ref: "MAKO_TEST_DATABASE_URL",
    enabled: true,
  });
  assert.deepEqual(statusResult.manifest.indexing, {
    include: ["apps", "packages", "services"],
    exclude: [".mako", stateDirName, "node_modules", "tmp-custom"],
  });

  const detachResult = (await runCliJson(["project", "detach"])) as {
    project: { projectId: string; status: string };
    purged: boolean;
  };
  assert.equal(detachResult.project.projectId, attachResult.project.projectId);
  assert.equal(detachResult.project.status, "detached");
  assert.equal(detachResult.purged, false);

  const projectsAfterDetach = (await runCliJson(["project", "list"])) as Array<{
    projectId: string;
  }>;
  assert.equal(
    projectsAfterDetach.some((project) => project.projectId === attachResult.project.projectId),
    false,
    "expected detached project to disappear from active project list",
  );

  const reattachResult = (await runCliJson(["project", "attach"])) as {
    project: { projectId: string };
  };
  assert.equal(
    reattachResult.project.projectId,
    attachResult.project.projectId,
    "expected reattach without purge to preserve project identity",
  );

  const purgeScratchDir = path.join(
    os.tmpdir(),
    `mako-purge-scratch-${Date.now()}-${process.pid}`,
  );
  const purgeScratchManifest = path.join(purgeScratchDir, ".mako");
  const purgeScratchStateDir = path.join(purgeScratchDir, stateDirName);
  mkdirSync(purgeScratchDir, { recursive: true });
  try {
    writeFileSync(
      path.join(purgeScratchDir, "package.json"),
      `${JSON.stringify({ name: "mako-purge-scratch", version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );

    const purgeAttach = (await runCliJson(["project", "attach", purgeScratchDir])) as {
      project: { projectId: string };
    };
    assert.ok(
      existsSync(purgeScratchManifest),
      "expected .mako/ after attaching purge scratch project",
    );
    assert.ok(
      existsSync(purgeScratchStateDir),
      "expected project state dir after attaching purge scratch project",
    );

    const purgeDetach = (await runCliJson([
      "project",
      "detach",
      purgeScratchDir,
      "--purge",
    ])) as {
      project: { projectId: string; status: string };
      purged: boolean;
      removedPaths: string[];
    };
    assert.equal(purgeDetach.project.projectId, purgeAttach.project.projectId);
    assert.equal(purgeDetach.project.status, "detached");
    assert.equal(purgeDetach.purged, true);
    assert.ok(
      purgeDetach.removedPaths.some((removed) => path.basename(removed) === ".mako"),
      "expected purge removedPaths to include the .mako manifest dir",
    );
    assert.ok(
      purgeDetach.removedPaths.some((removed) => path.basename(removed) === stateDirName),
      "expected purge removedPaths to include the project state dir",
    );
    assert.equal(
      existsSync(purgeScratchManifest),
      false,
      "expected .mako/ removed after --purge",
    );
    assert.equal(
      existsSync(purgeScratchStateDir),
      false,
      "expected project state dir removed after --purge",
    );

    const purgeListAfter = (await runCliJson(["project", "list"])) as Array<{
      projectId: string;
    }>;
    assert.equal(
      purgeListAfter.some((project) => project.projectId === purgeAttach.project.projectId),
      false,
      "expected purged project to disappear from `project list` output",
    );

    const purgeReattach = (await runCliJson(["project", "attach", purgeScratchDir])) as {
      project: { projectId: string };
    };
    assert.notEqual(
      purgeReattach.project.projectId,
      purgeAttach.project.projectId,
      "expected reattach after --purge to create a fresh project id",
    );

    await runCliJson(["project", "detach", purgeScratchDir, "--purge"]);
  } finally {
    rmSync(purgeScratchDir, { recursive: true, force: true });
  }

  // Phase 2 schema snapshot: scratch project with supabase/migrations + generated types + a
  // prisma stub. Asserts: snapshot builds, unsupported sources become warnings (not failures),
  // freshness computes on read, fingerprint is stable across no-op reindex and changes on edit.
  const snapshotScratchDir = path.join(
    os.tmpdir(),
    `mako-snapshot-scratch-${Date.now()}-${process.pid}`,
  );
  const snapshotMigrationsDir = path.join(snapshotScratchDir, "supabase", "migrations");
  const snapshotMigrationFile = path.join(snapshotMigrationsDir, "001_init.sql");
  const snapshotTypesDir = path.join(snapshotScratchDir, "types");
  const snapshotTypesFile = path.join(snapshotTypesDir, "supabase.ts");
  const snapshotPrismaDir = path.join(snapshotScratchDir, "prisma");
  const snapshotPrismaFile = path.join(snapshotPrismaDir, "schema.prisma");

  mkdirSync(snapshotMigrationsDir, { recursive: true });
  mkdirSync(snapshotTypesDir, { recursive: true });
  mkdirSync(snapshotPrismaDir, { recursive: true });
  try {
    writeFileSync(
      path.join(snapshotScratchDir, "package.json"),
      `${JSON.stringify(
        {
          name: "mako-snapshot-scratch",
          version: "0.0.0",
          dependencies: { "@supabase/supabase-js": "^2.0.0" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const initialMigrationSql = `CREATE TYPE public.user_role AS ENUM ('admin', 'member', 'guest');

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  role public.user_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.search_users(query text)
RETURNS TABLE(id uuid, email text) AS $$
BEGIN
  RETURN QUERY SELECT id, email FROM public.users WHERE email ILIKE '%' || query || '%';
END;
$$ LANGUAGE plpgsql;
`;
    writeFileSync(snapshotMigrationFile, initialMigrationSql, "utf8");

    writeFileSync(
      snapshotTypesFile,
      `export interface Database {
  public: {
    Tables: {
      users: {
        Row: { id: string; email: string; role: "admin" | "member" | "guest"; created_at: string };
        Insert: { id?: string; email: string; role?: "admin" | "member" | "guest"; created_at?: string };
        Update: { id?: string; email?: string; role?: "admin" | "member" | "guest"; created_at?: string };
      };
    };
    Views: {};
    Enums: {
      user_role: "admin" | "member" | "guest";
    };
    Functions: {
      search_users: {
        Args: { query: string };
        Returns: { id: string; email: string }[];
      };
    };
  };
}
`,
      "utf8",
    );

    writeFileSync(
      snapshotPrismaFile,
      `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id    String @id
  email String
}
`,
      "utf8",
    );

    const snapshotAttach = (await runCliJson(["project", "attach", snapshotScratchDir])) as {
      project: { projectId: string };
      manifest: {
        database: { kind: string; schemaSources: string[] };
      };
    };

    assert.equal(snapshotAttach.manifest.database.kind, "supabase");
    assert.ok(
      snapshotAttach.manifest.database.schemaSources.includes("supabase/migrations"),
      "expected supabase/migrations in schemaSources",
    );
    assert.ok(
      snapshotAttach.manifest.database.schemaSources.includes("types/supabase.ts"),
      "expected types/supabase.ts in schemaSources",
    );
    assert.ok(
      snapshotAttach.manifest.database.schemaSources.includes("prisma/schema.prisma"),
      "expected prisma/schema.prisma in schemaSources",
    );

    const snapshotIndex = (await runCliJson(["project", "index", snapshotScratchDir])) as {
      schemaSnapshot: {
        state: string;
        fingerprint: string;
        sourceCount: number;
        warningCount: number;
        freshnessStatus: string;
        snapshotId: string;
      };
    };

    assert.equal(snapshotIndex.schemaSnapshot.state, "present");
    assert.equal(snapshotIndex.schemaSnapshot.freshnessStatus, "fresh");
    assert.equal(
      snapshotIndex.schemaSnapshot.sourceCount,
      2,
      "expected only the two supported sources (migration + generated types) to count",
    );
    assert.ok(
      snapshotIndex.schemaSnapshot.warningCount >= 1,
      "expected at least one warning for the unsupported prisma source",
    );
    assert.ok(
      snapshotIndex.schemaSnapshot.fingerprint.length > 0,
      "expected non-empty fingerprint",
    );

    const initialFingerprint = snapshotIndex.schemaSnapshot.fingerprint;
    const initialSnapshotId = snapshotIndex.schemaSnapshot.snapshotId;

    const snapshotStatus = (await runCliJson(["project", "status", snapshotScratchDir])) as {
      schemaSnapshot: {
        state: string;
        fingerprint: string;
        freshnessStatus: string;
        snapshotId: string;
      };
    };
    assert.equal(snapshotStatus.schemaSnapshot.state, "present");
    assert.equal(snapshotStatus.schemaSnapshot.freshnessStatus, "fresh");
    assert.equal(snapshotStatus.schemaSnapshot.fingerprint, initialFingerprint);
    assert.equal(snapshotStatus.schemaSnapshot.snapshotId, initialSnapshotId);

    writeFileSync(
      snapshotMigrationFile,
      `${initialMigrationSql}\nCREATE TABLE public.posts (id uuid PRIMARY KEY, title text NOT NULL);\n`,
      "utf8",
    );

    const snapshotStatusAfterEdit = (await runCliJson([
      "project",
      "status",
      snapshotScratchDir,
    ])) as {
      schemaSnapshot: { freshnessStatus: string; fingerprint: string; snapshotId: string };
    };
    assert.equal(
      snapshotStatusAfterEdit.schemaSnapshot.freshnessStatus,
      "refresh_required",
      "expected freshness to flip to refresh_required after editing a source file",
    );
    assert.equal(
      snapshotStatusAfterEdit.schemaSnapshot.fingerprint,
      initialFingerprint,
      "expected persisted fingerprint to remain unchanged until a rebuild",
    );
    assert.equal(
      snapshotStatusAfterEdit.schemaSnapshot.snapshotId,
      initialSnapshotId,
      "expected persisted snapshotId to remain unchanged until a rebuild",
    );

    const snapshotReindex = (await runCliJson(["project", "index", snapshotScratchDir])) as {
      schemaSnapshot: { freshnessStatus: string; fingerprint: string; snapshotId: string };
    };
    assert.equal(snapshotReindex.schemaSnapshot.freshnessStatus, "fresh");
    assert.notEqual(
      snapshotReindex.schemaSnapshot.fingerprint,
      initialFingerprint,
      "expected fingerprint to change after a schema source edit is rebuilt",
    );
    assert.notEqual(
      snapshotReindex.schemaSnapshot.snapshotId,
      initialSnapshotId,
      "expected snapshotId to rotate on rebuild",
    );

    const updatedFingerprint = snapshotReindex.schemaSnapshot.fingerprint;

    const snapshotReindexStable = (await runCliJson([
      "project",
      "index",
      snapshotScratchDir,
    ])) as {
      schemaSnapshot: { fingerprint: string };
    };
    assert.equal(
      snapshotReindexStable.schemaSnapshot.fingerprint,
      updatedFingerprint,
      "expected fingerprint to stay stable across a no-op reindex",
    );

    await runCliJson(["project", "detach", snapshotScratchDir, "--purge"]);
  } finally {
    rmSync(snapshotScratchDir, { recursive: true, force: true });
  }

  // Phase 2 review fix: adding a new schema source to disk + reattach causes the next status
  // call to report `refresh_required` even before a rebuild, because freshness must reflect
  // manifest source-set drift, not just file content changes.
  const driftScratchDir = path.join(
    os.tmpdir(),
    `mako-snapshot-drift-${Date.now()}-${process.pid}`,
  );
  const driftMigrationsDir = path.join(driftScratchDir, "supabase", "migrations");
  const driftMigrationFile = path.join(driftMigrationsDir, "001_init.sql");
  const driftTypesDir = path.join(driftScratchDir, "types");
  const driftTypesFile = path.join(driftTypesDir, "supabase.ts");
  mkdirSync(driftMigrationsDir, { recursive: true });
  try {
    writeFileSync(
      path.join(driftScratchDir, "package.json"),
      `${JSON.stringify(
        {
          name: "mako-snapshot-drift",
          version: "0.0.0",
          dependencies: { "@supabase/supabase-js": "^2.0.0" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeFileSync(
      driftMigrationFile,
      `CREATE TABLE public.items (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
`,
      "utf8",
    );

    const driftAttach = (await runCliJson(["project", "attach", driftScratchDir])) as {
      manifest: { database: { schemaSources: string[] } };
    };
    assert.deepEqual(
      driftAttach.manifest.database.schemaSources.sort(),
      ["supabase/migrations"],
      "expected only the migrations source on the first attach",
    );

    const driftIndex = (await runCliJson(["project", "index", driftScratchDir])) as {
      schemaSnapshot: {
        state: string;
        sourceCount: number;
        fingerprint: string;
        freshnessStatus: string;
      };
    };
    assert.equal(driftIndex.schemaSnapshot.state, "present");
    assert.equal(driftIndex.schemaSnapshot.sourceCount, 1);
    assert.equal(driftIndex.schemaSnapshot.freshnessStatus, "fresh");
    const driftInitialFingerprint = driftIndex.schemaSnapshot.fingerprint;

    mkdirSync(driftTypesDir, { recursive: true });
    writeFileSync(
      driftTypesFile,
      `export interface Database {
  public: {
    Tables: {
      items: {
        Row: { id: string; name: string };
        Insert: { id?: string; name: string };
        Update: { id?: string; name?: string };
      };
    };
    Views: {};
    Enums: {};
    Functions: {};
  };
}
`,
      "utf8",
    );

    const driftReattach = (await runCliJson(["project", "attach", driftScratchDir])) as {
      manifest: { database: { schemaSources: string[] } };
    };
    assert.ok(
      driftReattach.manifest.database.schemaSources.includes("types/supabase.ts"),
      "expected reattach to pick up the newly added generated types source",
    );

    const driftStatusBeforeRebuild = (await runCliJson([
      "project",
      "status",
      driftScratchDir,
    ])) as {
      schemaSnapshot: { freshnessStatus: string; fingerprint: string };
    };
    assert.equal(
      driftStatusBeforeRebuild.schemaSnapshot.freshnessStatus,
      "refresh_required",
      "expected freshness to flip to refresh_required after a manifest source set change",
    );
    assert.equal(
      driftStatusBeforeRebuild.schemaSnapshot.fingerprint,
      driftInitialFingerprint,
      "expected stored fingerprint to remain unchanged until a rebuild",
    );

    const driftReindex = (await runCliJson(["project", "index", driftScratchDir])) as {
      schemaSnapshot: { freshnessStatus: string; sourceCount: number; fingerprint: string };
    };
    assert.equal(driftReindex.schemaSnapshot.freshnessStatus, "fresh");
    assert.equal(driftReindex.schemaSnapshot.sourceCount, 2);
    assert.notEqual(driftReindex.schemaSnapshot.fingerprint, driftInitialFingerprint);

    await runCliJson(["project", "detach", driftScratchDir, "--purge"]);
  } finally {
    rmSync(driftScratchDir, { recursive: true, force: true });
  }

  // Phase 2 review fix: Supabase-types-only projects must extract column-level IR. Asserts
  // by loading the persisted snapshot directly via the project store.
  const typesOnlyScratchDir = path.join(
    os.tmpdir(),
    `mako-snapshot-types-only-${Date.now()}-${process.pid}`,
  );
  const typesOnlyTypesDir = path.join(typesOnlyScratchDir, "types");
  const typesOnlyTypesFile = path.join(typesOnlyTypesDir, "supabase.ts");
  mkdirSync(typesOnlyTypesDir, { recursive: true });
  try {
    writeFileSync(
      path.join(typesOnlyScratchDir, "package.json"),
      `${JSON.stringify(
        {
          name: "mako-snapshot-types-only",
          version: "0.0.0",
          dependencies: { "@supabase/supabase-js": "^2.0.0" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeFileSync(
      typesOnlyTypesFile,
      `export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          role: "admin" | "member" | "guest";
          created_at: string;
        };
        Insert: { id?: string; email: string; display_name?: string | null; role?: "admin" | "member" | "guest"; created_at?: string };
        Update: { id?: string; email?: string; display_name?: string | null; role?: "admin" | "member" | "guest"; created_at?: string };
      };
    };
    Views: {};
    Enums: {
      user_role: "admin" | "member" | "guest";
    };
    Functions: {};
  };
}
`,
      "utf8",
    );

    await runCliJson(["project", "attach", typesOnlyScratchDir]);
    const typesOnlyIndex = (await runCliJson(["project", "index", typesOnlyScratchDir])) as {
      schemaSnapshot: { state: string; sourceCount: number };
    };
    assert.equal(typesOnlyIndex.schemaSnapshot.state, "present");
    assert.equal(typesOnlyIndex.schemaSnapshot.sourceCount, 1);

    const typesOnlyStore = openProjectStore({
      projectRoot: typesOnlyScratchDir,
      stateDirName,
    });
    try {
      const loaded = typesOnlyStore.loadSchemaSnapshot();
      assert.ok(loaded, "expected a persisted snapshot for the types-only project");
      const usersTable = loaded!.ir.schemas.public?.tables.find((table) => table.name === "users");
      assert.ok(usersTable, "expected the users table in the parsed IR");
      const columnNames = usersTable!.columns.map((column) => column.name).sort();
      assert.deepEqual(
        columnNames,
        ["created_at", "display_name", "email", "id", "role"],
        "expected all Row column names to be extracted from the generated types file",
      );
      const displayName = usersTable!.columns.find((column) => column.name === "display_name");
      assert.ok(displayName, "expected the display_name column");
      assert.equal(
        displayName!.nullable,
        true,
        "expected `string | null` to be detected as nullable",
      );
      const emailColumn = usersTable!.columns.find((column) => column.name === "email");
      assert.equal(
        emailColumn?.nullable,
        false,
        "expected a non-optional `string` column to be non-nullable",
      );
      const userRoleEnum = loaded!.ir.schemas.public?.enums.find(
        (enumDef) => enumDef.name === "user_role",
      );
      assert.ok(userRoleEnum, "expected the user_role enum in the parsed IR");
      assert.deepEqual(userRoleEnum!.values.sort(), ["admin", "guest", "member"]);
    } finally {
      typesOnlyStore.close();
    }

    await runCliJson(["project", "detach", typesOnlyScratchDir, "--purge"]);
  } finally {
    rmSync(typesOnlyScratchDir, { recursive: true, force: true });
  }

  // Phase 3.5.1: schema snapshots stay canonical in JSON, but saving and clearing the
  // snapshot must also rebuild/clear the flattened current-snapshot read model in
  // project.db so later phases can query the current schema state directly.
  const snapshotReadModelScratchDir = path.join(
    os.tmpdir(),
    `mako-snapshot-read-model-${Date.now()}-${process.pid}`,
  );
  mkdirSync(snapshotReadModelScratchDir, { recursive: true });
  try {
    const snapshotReadModelStore = openProjectStore({
      projectRoot: snapshotReadModelScratchDir,
      stateDirName,
    });
    try {
      const publicLiveRef = { kind: "live_catalog" as const, path: "live:public" };
      const opsLiveRef = { kind: "live_catalog" as const, path: "live:ops" };

      const snapshotReadModelA: SchemaSnapshot = {
        snapshotId: "snapshot_read_model_a",
        sourceMode: "live_refresh_enabled",
        generatedAt: "2026-01-01T00:00:00.000Z",
        refreshedAt: "2026-01-01T00:00:00.000Z",
        fingerprint: "fingerprint_read_model_a",
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: [
          { kind: "live_catalog", path: "live:public", sha256: "sha_live_public_a" },
          { kind: "live_catalog", path: "live:auth", sha256: "sha_live_auth_a" },
        ],
        warnings: [],
        ir: {
          version: "1.0.0",
          schemas: {
            auth: {
              tables: [],
              views: [],
              enums: [],
              rpcs: [],
            },
            public: {
              tables: [
                {
                  name: "users",
                  schema: "public",
                  columns: [
                    { name: "id", dataType: "uuid", nullable: false, isPrimaryKey: true, sources: [publicLiveRef] },
                    { name: "email", dataType: "text", nullable: false, sources: [publicLiveRef] },
                    { name: "role", dataType: "public.user_role", nullable: false, defaultExpression: "'member'::public.user_role", sources: [publicLiveRef] },
                  ],
                  primaryKey: ["id"],
                  indexes: [
                    {
                      name: "users_pkey",
                      unique: true,
                      primary: true,
                      columns: ["id"],
                      definition: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)",
                    },
                    {
                      name: "users_email_key",
                      unique: true,
                      primary: false,
                      columns: ["email"],
                      definition: "CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)",
                    },
                  ],
                  foreignKeys: { outbound: [], inbound: [] },
                  rls: {
                    rlsEnabled: true,
                    forceRls: false,
                    policies: [
                      {
                        name: "users_select_active",
                        mode: "PERMISSIVE",
                        command: "SELECT",
                        roles: ["PUBLIC"],
                        usingExpression: "(active = true)",
                        withCheckExpression: null,
                      },
                    ],
                  },
                  triggers: [
                    {
                      name: "users_touch_updated_at",
                      enabled: true,
                      enabledMode: "O",
                      timing: "BEFORE",
                      events: ["UPDATE"],
                    },
                  ],
                  sources: [publicLiveRef],
                },
                {
                  name: "posts",
                  schema: "public",
                  columns: [
                    { name: "id", dataType: "uuid", nullable: false, isPrimaryKey: true, sources: [publicLiveRef] },
                    { name: "author_id", dataType: "uuid", nullable: false, sources: [publicLiveRef] },
                    { name: "title", dataType: "text", nullable: false, sources: [publicLiveRef] },
                  ],
                  primaryKey: ["id"],
                  foreignKeys: {
                    outbound: [
                      {
                        constraintName: "posts_author_id_fkey",
                        columns: ["author_id"],
                        targetSchema: "public",
                        targetTable: "users",
                        targetColumns: ["id"],
                        onUpdate: "CASCADE",
                        onDelete: "CASCADE",
                      },
                    ],
                    inbound: [],
                  },
                  sources: [publicLiveRef],
                },
              ],
              views: [{ name: "active_users", schema: "public", sources: [publicLiveRef] }],
              enums: [{ name: "user_role", schema: "public", values: ["admin", "member"], sources: [publicLiveRef] }],
              rpcs: [
                {
                  name: "search_users",
                  schema: "public",
                  argTypes: ["text"],
                  returnType: "TABLE(id uuid, email text)",
                  sources: [publicLiveRef],
                },
                {
                  name: "refresh_search_index",
                  schema: "public",
                  argTypes: [],
                  returnType: "procedure",
                  sources: [publicLiveRef],
                },
              ],
            },
          },
        },
      };

      snapshotReadModelStore.saveSchemaSnapshot(snapshotReadModelA);

      const readModelSchemas = snapshotReadModelStore.db.prepare(`
        SELECT schema_name
        FROM schema_snapshot_schemas
        ORDER BY schema_name
      `).all() as Array<{ schema_name: string }>;
      assert.deepEqual(readModelSchemas.map((row) => row.schema_name), ["auth", "public"]);

      const readModelTables = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, table_name
        FROM schema_snapshot_tables
        ORDER BY schema_name, table_name
      `).all() as Array<{ schema_name: string; table_name: string }>;
      assert.deepEqual(readModelTables.map((row) => ({ ...row })), [
        { schema_name: "public", table_name: "posts" },
        { schema_name: "public", table_name: "users" },
      ]);

      const readModelColumns = snapshotReadModelStore.db.prepare(`
        SELECT column_name, data_type, nullable, is_primary_key
        FROM schema_snapshot_columns
        WHERE schema_name = 'public' AND table_name = 'users'
        ORDER BY ordinal_position
      `).all() as Array<{
        column_name: string;
        data_type: string;
        nullable: number;
        is_primary_key: number;
      }>;
      assert.deepEqual(readModelColumns.map((row) => ({ ...row })), [
        { column_name: "id", data_type: "uuid", nullable: 0, is_primary_key: 1 },
        { column_name: "email", data_type: "text", nullable: 0, is_primary_key: 0 },
        { column_name: "role", data_type: "public.user_role", nullable: 0, is_primary_key: 0 },
      ]);

      const readModelEnums = snapshotReadModelStore.db.prepare(`
        SELECT enum_name, enum_value
        FROM schema_snapshot_enums
        WHERE schema_name = 'public'
        ORDER BY enum_name, sort_order
      `).all() as Array<{ enum_name: string; enum_value: string }>;
      assert.deepEqual(readModelEnums.map((row) => ({ ...row })), [
        { enum_name: "user_role", enum_value: "admin" },
        { enum_name: "user_role", enum_value: "member" },
      ]);

      const readModelViews = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, view_name
        FROM schema_snapshot_views
        ORDER BY schema_name, view_name
      `).all() as Array<{ schema_name: string; view_name: string }>;
      assert.deepEqual(readModelViews.map((row) => ({ ...row })), [{ schema_name: "public", view_name: "active_users" }]);

      const readModelRpcs = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, rpc_name, rpc_kind, return_type
        FROM schema_snapshot_rpcs
        ORDER BY schema_name, rpc_name, rpc_kind
      `).all() as Array<{ schema_name: string; rpc_name: string; rpc_kind: string; return_type: string | null }>;
      assert.deepEqual(readModelRpcs.map((row) => ({ ...row })), [
        {
          schema_name: "public",
          rpc_name: "refresh_search_index",
          rpc_kind: "procedure",
          return_type: "procedure",
        },
        {
          schema_name: "public",
          rpc_name: "search_users",
          rpc_kind: "function",
          return_type: "TABLE(id uuid, email text)",
        },
      ]);

      const readModelPrimaryKeys = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, table_name, column_name
        FROM schema_snapshot_primary_keys
        ORDER BY schema_name, table_name, ordinal_position
      `).all() as Array<{ schema_name: string; table_name: string; column_name: string }>;
      assert.deepEqual(readModelPrimaryKeys.map((row) => ({ ...row })), [
        { schema_name: "public", table_name: "posts", column_name: "id" },
        { schema_name: "public", table_name: "users", column_name: "id" },
      ]);

      const readModelForeignKeys = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, table_name, constraint_name, target_schema, target_table
        FROM schema_snapshot_foreign_keys
        ORDER BY schema_name, table_name, constraint_name
      `).all() as Array<{
        schema_name: string;
        table_name: string;
        constraint_name: string;
        target_schema: string;
        target_table: string;
      }>;
      assert.deepEqual(readModelForeignKeys.map((row) => ({ ...row })), [
        {
          schema_name: "public",
          table_name: "posts",
          constraint_name: "posts_author_id_fkey",
          target_schema: "public",
          target_table: "users",
        },
      ]);

      const readModelIndexes = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, table_name, index_name, is_unique, is_primary
        FROM schema_snapshot_indexes
        ORDER BY schema_name, table_name, index_name
      `).all() as Array<{
        schema_name: string;
        table_name: string;
        index_name: string;
        is_unique: number;
        is_primary: number;
      }>;
      assert.deepEqual(readModelIndexes.map((row) => ({ ...row })), [
        {
          schema_name: "public",
          table_name: "users",
          index_name: "users_email_key",
          is_unique: 1,
          is_primary: 0,
        },
        {
          schema_name: "public",
          table_name: "users",
          index_name: "users_pkey",
          is_unique: 1,
          is_primary: 1,
        },
      ]);

      const readModelPolicies = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, table_name, policy_name, mode, command
        FROM schema_snapshot_rls_policies
        ORDER BY schema_name, table_name, policy_name
      `).all() as Array<{
        schema_name: string;
        table_name: string;
        policy_name: string;
        mode: string;
        command: string;
      }>;
      assert.deepEqual(readModelPolicies.map((row) => ({ ...row })), [
        {
          schema_name: "public",
          table_name: "users",
          policy_name: "users_select_active",
          mode: "PERMISSIVE",
          command: "SELECT",
        },
      ]);

      const readModelTriggers = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, table_name, trigger_name, enabled_mode, timing
        FROM schema_snapshot_triggers
        ORDER BY schema_name, table_name, trigger_name
      `).all() as Array<{
        schema_name: string;
        table_name: string;
        trigger_name: string;
        enabled_mode: string;
        timing: string;
      }>;
      assert.deepEqual(readModelTriggers.map((row) => ({ ...row })), [
        {
          schema_name: "public",
          table_name: "users",
          trigger_name: "users_touch_updated_at",
          enabled_mode: "O",
          timing: "BEFORE",
        },
      ]);

      const snapshotReadModelB: SchemaSnapshot = {
        snapshotId: "snapshot_read_model_b",
        sourceMode: "live_refresh_enabled",
        generatedAt: "2026-01-02T00:00:00.000Z",
        refreshedAt: "2026-01-02T00:00:00.000Z",
        fingerprint: "fingerprint_read_model_b",
        freshnessStatus: "fresh",
        driftDetected: false,
        sources: [{ kind: "live_catalog", path: "live:ops", sha256: "sha_live_ops_b" }],
        warnings: [],
        ir: {
          version: "1.0.0",
          schemas: {
            ops: {
              tables: [
                {
                  name: "audit_logs",
                  schema: "ops",
                  columns: [
                    { name: "id", dataType: "uuid", nullable: false, isPrimaryKey: true, sources: [opsLiveRef] },
                    { name: "action", dataType: "text", nullable: false, sources: [opsLiveRef] },
                  ],
                  primaryKey: ["id"],
                  sources: [opsLiveRef],
                },
              ],
              views: [],
              enums: [],
              rpcs: [
                {
                  name: "rebuild_cache",
                  schema: "ops",
                  argTypes: ["uuid"],
                  returnType: "procedure",
                  sources: [opsLiveRef],
                },
              ],
            },
          },
        },
      };

      snapshotReadModelStore.saveSchemaSnapshot(snapshotReadModelB);

      const overwrittenTables = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, table_name
        FROM schema_snapshot_tables
        ORDER BY schema_name, table_name
      `).all() as Array<{ schema_name: string; table_name: string }>;
      assert.deepEqual(overwrittenTables.map((row) => ({ ...row })), [{ schema_name: "ops", table_name: "audit_logs" }]);

      const overwrittenPoliciesCount = snapshotReadModelStore.db.prepare(`
        SELECT COUNT(*) AS value
        FROM schema_snapshot_rls_policies
      `).get() as { value: number };
      assert.equal(overwrittenPoliciesCount.value, 0, "expected overwrite to remove stale policy rows");

      const overwrittenRpcs = snapshotReadModelStore.db.prepare(`
        SELECT schema_name, rpc_name, rpc_kind
        FROM schema_snapshot_rpcs
        ORDER BY schema_name, rpc_name, rpc_kind
      `).all() as Array<{ schema_name: string; rpc_name: string; rpc_kind: string }>;
      assert.deepEqual(overwrittenRpcs.map((row) => ({ ...row })), [
        { schema_name: "ops", rpc_name: "rebuild_cache", rpc_kind: "procedure" },
      ]);

      snapshotReadModelStore.clearSchemaSnapshot();
      assert.equal(
        snapshotReadModelStore.loadSchemaSnapshot(),
        null,
        "expected clearSchemaSnapshot to remove the canonical snapshot too",
      );

      for (const tableName of [
        "schema_snapshot_schemas",
        "schema_snapshot_tables",
        "schema_snapshot_columns",
        "schema_snapshot_primary_keys",
        "schema_snapshot_indexes",
        "schema_snapshot_foreign_keys",
        "schema_snapshot_rls_policies",
        "schema_snapshot_triggers",
        "schema_snapshot_views",
        "schema_snapshot_enums",
        "schema_snapshot_rpcs",
      ]) {
        const countRow = snapshotReadModelStore.db.prepare(
          `SELECT COUNT(*) AS value FROM ${tableName}`,
        ).get() as { value: number };
        assert.equal(countRow.value, 0, `expected ${tableName} to be cleared with the snapshot`);
      }
    } finally {
      snapshotReadModelStore.close();
    }
  } finally {
    rmSync(snapshotReadModelScratchDir, { recursive: true, force: true });
  }

  // Phase 3 DB binding lifecycle: bind env_var_ref, unbind, error paths.
  // Real DB connection is gated on MAKO_TEST_DATABASE_URL below.
  const dbBindingScratchDir = path.join(
    os.tmpdir(),
    `mako-db-binding-scratch-${Date.now()}-${process.pid}`,
  );
  const dbBindingMigrationsDir = path.join(dbBindingScratchDir, "supabase", "migrations");
  mkdirSync(dbBindingMigrationsDir, { recursive: true });
  const bindingEnvVarName = `MAKO_TEST_DB_BINDING_${process.pid}_${Date.now()}`;
  try {
    writeFileSync(
      path.join(dbBindingScratchDir, "package.json"),
      `${JSON.stringify(
        {
          name: "mako-db-binding-scratch",
          version: "0.0.0",
          dependencies: { "@supabase/supabase-js": "^2.0.0" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(dbBindingMigrationsDir, "001_init.sql"),
      `CREATE TABLE public.items (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
`,
      "utf8",
    );

    await runCliJson(["project", "attach", dbBindingScratchDir]);
    await runCliJson(["project", "index", dbBindingScratchDir]);

    const bindResult = (await runCliJson([
      "project",
      "db",
      "bind",
      dbBindingScratchDir,
      "--strategy",
      "env_var_ref",
      "--ref",
      bindingEnvVarName,
    ])) as {
      binding: { strategy: string; ref: string; enabled: boolean; configured: boolean };
    };
    assert.equal(bindResult.binding.strategy, "env_var_ref");
    assert.equal(bindResult.binding.ref, bindingEnvVarName);
    assert.equal(bindResult.binding.enabled, true);
    assert.equal(bindResult.binding.configured, true);

    const statusAfterBind = (await runCliJson(["project", "status", dbBindingScratchDir])) as {
      dbBinding: { strategy: string; ref: string; enabled: boolean; configured: boolean };
    };
    assert.equal(statusAfterBind.dbBinding.strategy, "env_var_ref");
    assert.equal(statusAfterBind.dbBinding.ref, bindingEnvVarName);
    assert.equal(statusAfterBind.dbBinding.enabled, true);
    assert.equal(statusAfterBind.dbBinding.configured, true);

    const originalEnvValue = process.env[bindingEnvVarName];
    delete process.env[bindingEnvVarName];
    try {
      const testMissingEnv = await runCli([
        "--json",
        "project",
        "db",
        "test",
        dbBindingScratchDir,
      ]);
      assert.notEqual(testMissingEnv.exitCode, 0, "expected db test to fail without env var");
      assert.match(
        testMissingEnv.stderr,
        /not set or is empty/i,
        "expected stderr to surface db_binding_invalid reason when env var is missing",
      );

      process.env[bindingEnvVarName] = "";
      const testEmptyEnv = await runCli([
        "--json",
        "project",
        "db",
        "test",
        dbBindingScratchDir,
      ]);
      assert.notEqual(testEmptyEnv.exitCode, 0, "expected db test to fail with empty env var");
      assert.match(
        testEmptyEnv.stderr,
        /not set or is empty/i,
        "expected stderr to surface db_binding_invalid reason when env var is empty",
      );
    } finally {
      if (originalEnvValue === undefined) {
        delete process.env[bindingEnvVarName];
      } else {
        process.env[bindingEnvVarName] = originalEnvValue;
      }
    }

    const unbindResult = (await runCliJson([
      "project",
      "db",
      "unbind",
      dbBindingScratchDir,
    ])) as {
      binding: { enabled: boolean; configured: boolean };
      secretDeleted: boolean;
    };
    assert.equal(unbindResult.binding.enabled, false);
    assert.equal(unbindResult.binding.configured, false);
    assert.equal(unbindResult.secretDeleted, false);

    const statusAfterUnbind = (await runCliJson(["project", "status", dbBindingScratchDir])) as {
      dbBinding: { enabled: boolean; configured: boolean; ref: string };
    };
    assert.equal(statusAfterUnbind.dbBinding.enabled, false);
    assert.equal(statusAfterUnbind.dbBinding.configured, false);
    assert.equal(
      statusAfterUnbind.dbBinding.ref,
      bindingEnvVarName,
      "expected the ref to persist across unbind even though enabled flipped to false",
    );

    const testAfterUnbind = await runCli([
      "--json",
      "project",
      "db",
      "test",
      dbBindingScratchDir,
    ]);
    assert.notEqual(testAfterUnbind.exitCode, 0, "expected db test to fail when binding disabled");
    assert.match(
      testAfterUnbind.stderr,
      /binding is not enabled/i,
      "expected stderr to surface db_binding_not_configured reason when disabled",
    );

    const bindKeychainMissingSecret = await runCli([
      "--json",
      "project",
      "db",
      "bind",
      dbBindingScratchDir,
      "--strategy",
      "keychain_ref",
      "--ref",
      `mako:test:primary-db-${process.pid}`,
    ]);
    assert.notEqual(
      bindKeychainMissingSecret.exitCode,
      0,
      "expected keychain_ref bind without a secret source to fail",
    );
    assert.match(
      bindKeychainMissingSecret.stderr,
      /--url-from-env|--url-stdin/,
      "expected stderr to mention the keychain_ref secret sources",
    );

    await runCliJson(["project", "detach", dbBindingScratchDir, "--purge"]);
  } finally {
    rmSync(dbBindingScratchDir, { recursive: true, force: true });
  }

  // Phase 3 live DB full path: gated on MAKO_TEST_DATABASE_URL (real Postgres required).
  const phase3LiveDatabaseUrl = process.env.MAKO_TEST_DATABASE_URL;
  if (phase3LiveDatabaseUrl && phase3LiveDatabaseUrl.trim() !== "") {
    const expectedDiscoveredSchemas = await discoverExpectedVisibleSchemas(phase3LiveDatabaseUrl);
    const liveScratchDir = path.join(
      os.tmpdir(),
      `mako-db-live-scratch-${Date.now()}-${process.pid}`,
    );
    const liveMigrationsDir = path.join(liveScratchDir, "supabase", "migrations");
    mkdirSync(liveMigrationsDir, { recursive: true });
    const liveEnvVarName = `MAKO_TEST_DB_LIVE_${process.pid}_${Date.now()}`;
    try {
      writeFileSync(
        path.join(liveScratchDir, "package.json"),
        `${JSON.stringify(
          {
            name: "mako-db-live-scratch",
            version: "0.0.0",
            dependencies: { "@supabase/supabase-js": "^2.0.0" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(
        path.join(liveMigrationsDir, "001_init.sql"),
        `CREATE TABLE public.items (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
`,
        "utf8",
      );

      process.env[liveEnvVarName] = phase3LiveDatabaseUrl;
      try {
        await runCliJson(["project", "attach", liveScratchDir]);
        await runCliJson(["project", "index", liveScratchDir]);
        await runCliJson([
          "project",
          "db",
          "bind",
          liveScratchDir,
          "--strategy",
          "env_var_ref",
          "--ref",
          liveEnvVarName,
        ]);

        const liveTest = (await runCliJson([
          "project",
          "db",
          "test",
          liveScratchDir,
        ])) as { success: boolean; serverVersion?: string };
        assert.equal(liveTest.success, true, "expected live db test to succeed");
        assert.ok(liveTest.serverVersion, "expected server version from live db test");

        // Phase 3 review gap: partial verify must not stamp project-wide state.
        // Snapshot sourceMode stays `repo_only`, lastVerifiedAt stays undefined.
        const statusBeforePartialVerify = (await runCliJson([
          "project",
          "status",
          liveScratchDir,
        ])) as {
          schemaSnapshot: { sourceMode?: string; freshnessStatus?: string };
          dbBinding: { lastVerifiedAt?: string; lastTestedAt?: string };
        };
        assert.equal(
          statusBeforePartialVerify.schemaSnapshot.sourceMode,
          "repo_only",
          "expected snapshot sourceMode to be repo_only after index, before any verify/refresh",
        );
        assert.equal(
          statusBeforePartialVerify.dbBinding.lastVerifiedAt,
          undefined,
          "expected lastVerifiedAt to be undefined before any verify call",
        );

        const partialVerify = (await runCliJson([
          "project",
          "db",
          "verify",
          liveScratchDir,
          "--schemas",
          "public",
        ])) as {
          partial: boolean;
          includedSchemas?: string[];
          outcome: string;
        };
        assert.equal(partialVerify.partial, true, "expected partial=true when --schemas is passed");
        assert.deepEqual(partialVerify.includedSchemas, ["public"]);

        const statusAfterPartialVerify = (await runCliJson([
          "project",
          "status",
          liveScratchDir,
        ])) as {
          schemaSnapshot: { sourceMode?: string; freshnessStatus?: string };
          dbBinding: { lastVerifiedAt?: string; lastTestedAt?: string };
        };
        assert.equal(
          statusAfterPartialVerify.schemaSnapshot.sourceMode,
          statusBeforePartialVerify.schemaSnapshot.sourceMode,
          "expected partial verify to leave snapshot sourceMode unchanged",
        );
        assert.equal(
          statusAfterPartialVerify.schemaSnapshot.freshnessStatus,
          statusBeforePartialVerify.schemaSnapshot.freshnessStatus,
          "expected partial verify to leave snapshot freshnessStatus unchanged",
        );
        assert.equal(
          statusAfterPartialVerify.dbBinding.lastVerifiedAt,
          undefined,
          "expected partial verify to leave dbBinding.lastVerifiedAt undefined",
        );
        assert.equal(
          statusAfterPartialVerify.dbBinding.lastTestedAt,
          statusBeforePartialVerify.dbBinding.lastTestedAt,
          "expected partial verify to leave dbBinding.lastTestedAt unchanged",
        );

        // Phase 3 review gap: procedures (prokind='p') must flow through the live catalog
        // alongside functions (prokind='f'). Directly compare what pg_proc has to what
        // fetchLiveSchemaIR returns so a silently-missing prokind would fail the run.
        interface ProKindRow {
          function_count: string;
          procedure_count: string;
        }
        const { functionCount, procedureCount } = await withReadOnlyConnection(
          { databaseUrl: phase3LiveDatabaseUrl, statementTimeoutMs: 10_000 },
          async (ctx) => {
            const result = await ctx.query<ProKindRow>(`
              SELECT
                COUNT(*) FILTER (WHERE p.prokind = 'f') AS function_count,
                COUNT(*) FILTER (WHERE p.prokind = 'p') AS procedure_count
              FROM pg_catalog.pg_proc p
              JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                AND n.nspname NOT LIKE 'pg\\_temp\\_%' ESCAPE '\\'
                AND n.nspname NOT LIKE 'pg\\_toast\\_temp\\_%' ESCAPE '\\'
            `);
            const row = result.rows[0];
            return {
              functionCount: Number(row?.function_count ?? 0),
              procedureCount: Number(row?.procedure_count ?? 0),
            };
          },
        );

        const liveOnlyIR = await fetchLiveSchemaIR({
          databaseUrl: phase3LiveDatabaseUrl,
          statementTimeoutMs: 10_000,
        });
        let liveRpcCount = 0;
        for (const ns of Object.values(liveOnlyIR.schemas)) {
          liveRpcCount += ns.rpcs.length;
        }
        assert.equal(
          liveRpcCount,
          functionCount + procedureCount,
          "expected live catalog IR to include every function and procedure from pg_proc",
        );
        if (procedureCount === 0) {
          console.log(
            "[smoke] note: MAKO_TEST_DATABASE_URL has no procedures (prokind='p'); " +
              "procedure ingestion path exercised trivially. Point the test at a DB with a procedure " +
              "to lock the fix against regressions end-to-end.",
          );
        } else {
          console.log(
            `[smoke] procedure coverage: ${procedureCount} procedure(s) and ${functionCount} function(s) ` +
              `pulled through fetchLiveSchemaIR.`,
          );
        }

        const liveRefresh = (await runCliJson([
          "project",
          "db",
          "refresh",
          liveScratchDir,
          "--schemas",
          "public",
        ])) as { sourceMode: string; tableCount: number; fingerprint: string };
        assert.equal(liveRefresh.sourceMode, "live_refresh_enabled");
        assert.ok(liveRefresh.fingerprint.length > 0);

        const liveProjectStore = openProjectStore({
          projectRoot: liveScratchDir,
          stateDirName,
          projectDbFilename: "project.db",
        });
        try {
          const liveSnapshot = liveProjectStore.loadSchemaSnapshot();
          assert.ok(liveSnapshot, "expected live refresh to persist a schema snapshot");
          const studyTracksTable = liveSnapshot!.ir.schemas.public?.tables.find(
            (table) => table.name === "study_tracks",
          );
          assert.ok(studyTracksTable, "expected public.study_tracks to be present in the refreshed live snapshot");
          assert.ok(Array.isArray(studyTracksTable!.indexes), "expected live snapshot tables to carry index metadata");
          assert.ok(studyTracksTable!.foreignKeys, "expected live snapshot tables to carry foreign key metadata");
          assert.ok(studyTracksTable!.rls, "expected live snapshot tables to carry RLS metadata");
          assert.ok(Array.isArray(studyTracksTable!.triggers), "expected live snapshot tables to carry trigger metadata");
        } finally {
          liveProjectStore.close();
        }

        const liveStatus = (await runCliJson([
          "project",
          "status",
          liveScratchDir,
        ])) as {
          schemaSnapshot: { sourceMode?: string };
          dbBinding: { lastRefreshedAt?: string; lastTestedAt?: string };
        };
        assert.equal(liveStatus.schemaSnapshot.sourceMode, "live_refresh_enabled");
        assert.ok(liveStatus.dbBinding.lastRefreshedAt, "expected lastRefreshedAt to be populated");
        assert.ok(liveStatus.dbBinding.lastTestedAt, "expected lastTestedAt to be populated");

        const verifyAfterRefresh = (await runCliJson([
          "project",
          "db",
          "verify",
          liveScratchDir,
          "--schemas",
          "public",
        ])) as {
          partial: boolean;
          outcome: string;
          indexDiff: { additions: string[]; removals: string[]; unchangedCount: number };
          foreignKeyDiff: { additions: string[]; removals: string[]; unchangedCount: number };
          rlsDiff: { additions: string[]; removals: string[]; unchangedCount: number };
          triggerDiff: { additions: string[]; removals: string[]; unchangedCount: number };
        };
        assert.equal(verifyAfterRefresh.partial, true, "expected schema-scoped verify to stay partial after refresh");
        assert.equal(verifyAfterRefresh.outcome, "verified");
        assert.deepEqual(verifyAfterRefresh.indexDiff.additions, []);
        assert.deepEqual(verifyAfterRefresh.indexDiff.removals, []);
        assert.ok(verifyAfterRefresh.indexDiff.unchangedCount >= 1, "expected at least one stable live index");
        assert.deepEqual(verifyAfterRefresh.foreignKeyDiff.additions, []);
        assert.deepEqual(verifyAfterRefresh.foreignKeyDiff.removals, []);
        assert.ok(
          verifyAfterRefresh.foreignKeyDiff.unchangedCount >= 1,
          "expected at least one stable live foreign key",
        );
        assert.deepEqual(verifyAfterRefresh.rlsDiff.additions, []);
        assert.deepEqual(verifyAfterRefresh.rlsDiff.removals, []);
        assert.ok(verifyAfterRefresh.rlsDiff.unchangedCount >= 1, "expected stable live RLS metadata");
        assert.deepEqual(verifyAfterRefresh.triggerDiff.additions, []);
        assert.deepEqual(verifyAfterRefresh.triggerDiff.removals, []);

        await runCliJson(["project", "db", "unbind", liveScratchDir]);
        await runCliJson(["project", "detach", liveScratchDir, "--purge"]);
      } finally {
        delete process.env[liveEnvVarName];
      }
    } finally {
      rmSync(liveScratchDir, { recursive: true, force: true });
    }

    // Phase 3.2: `agentmako connect --db-env` end-to-end path. Uses a separate scratch dir so
    // it cannot collide with the lower-level live test above. Exercises the full connect flow:
    // attach → index → bind (env_var_ref) → test → persist scope → refresh.
    const connectLiveScratchDir = path.join(
      os.tmpdir(),
      `mako-connect-live-scratch-${Date.now()}-${process.pid}`,
    );
    const connectLiveMigrationsDir = path.join(
      connectLiveScratchDir,
      "supabase",
      "migrations",
    );
    mkdirSync(connectLiveMigrationsDir, { recursive: true });
    const connectLiveEnvVarName = `MAKO_TEST_CONNECT_LIVE_${process.pid}_${Date.now()}`;
    try {
      writeFileSync(
        path.join(connectLiveScratchDir, "package.json"),
        `${JSON.stringify(
          {
            name: "mako-connect-live-scratch",
            version: "0.0.0",
            dependencies: { "@supabase/supabase-js": "^2.0.0" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(
        path.join(connectLiveMigrationsDir, "001_init.sql"),
        `CREATE TABLE public.items (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
`,
        "utf8",
      );

      process.env[connectLiveEnvVarName] = phase3LiveDatabaseUrl;
      try {
        const connectLive = (await runCliJson([
          "connect",
          connectLiveScratchDir,
          "--yes",
          "--db-env",
          connectLiveEnvVarName,
          "--schemas",
          "public",
        ])) as {
          project: { projectId: string };
          indexRun: { status: string } | null;
          dbBinding: { enabled: boolean; strategy: string; ref: string };
          bind: { binding: { enabled: boolean } } | null;
          test: { success: boolean; serverVersion?: string } | null;
          defaultSchemaScope: string[];
          scopeSource: string;
          refresh: { sourceMode: string; tableCount: number } | null;
        };
        assert.ok(connectLive.project.projectId, "expected connect live to return a project id");
        assert.equal(connectLive.indexRun?.status, "succeeded");
        assert.equal(connectLive.dbBinding.enabled, true);
        assert.equal(connectLive.dbBinding.strategy, "env_var_ref");
        assert.equal(connectLive.dbBinding.ref, connectLiveEnvVarName);
        assert.ok(connectLive.bind, "expected non-null bind result from connect");
        assert.equal(connectLive.bind!.binding.enabled, true);
        assert.ok(connectLive.test, "expected non-null test result from connect");
        assert.equal(connectLive.test!.success, true, "expected live connection test to pass");
        assert.deepEqual(connectLive.defaultSchemaScope, ["public"]);
        assert.equal(connectLive.scopeSource, "user");
        assert.ok(connectLive.refresh, "expected non-null refresh result from connect");
        assert.equal(connectLive.refresh!.sourceMode, "live_refresh_enabled");

        // Top-level `agentmako verify` without --schemas should pick up the saved default scope.
        const verifyWithSavedScope = (await runCliJson([
          "verify",
          connectLiveScratchDir,
        ])) as {
          partial: boolean;
          includedSchemas?: string[];
          outcome: string;
          scopeFromDefaults: boolean;
        };
        assert.equal(
          verifyWithSavedScope.scopeFromDefaults,
          true,
          "expected top-level verify to mark scopeFromDefaults when falling back to saved scope",
        );
        assert.deepEqual(verifyWithSavedScope.includedSchemas, ["public"]);
        assert.equal(verifyWithSavedScope.partial, true);
        assert.equal(verifyWithSavedScope.outcome, "verified");

        // Top-level `agentmako refresh` without --schemas should also pick up the saved scope.
        const refreshWithSavedScope = (await runCliJson([
          "refresh",
          connectLiveScratchDir,
        ])) as {
          sourceMode: string;
          tableCount: number;
          scopeFromDefaults: boolean;
        };
        assert.equal(
          refreshWithSavedScope.scopeFromDefaults,
          true,
          "expected top-level refresh to mark scopeFromDefaults when falling back to saved scope",
        );
        assert.equal(refreshWithSavedScope.sourceMode, "live_refresh_enabled");

        // An explicit `--schemas` on the top-level alias should override the saved scope.
        const verifyWithOverride = (await runCliJson([
          "verify",
          connectLiveScratchDir,
          "--schemas",
          "public",
        ])) as { scopeFromDefaults: boolean; includedSchemas?: string[] };
        assert.equal(
          verifyWithOverride.scopeFromDefaults,
          false,
          "expected explicit --schemas to disable scopeFromDefaults",
        );
        assert.deepEqual(verifyWithOverride.includedSchemas, ["public"]);

        // `agentmako status` alias should report the bound live connection.
        const statusAliasAfterConnect = (await runCliJson([
          "status",
          connectLiveScratchDir,
        ])) as {
          dbBinding: { enabled: boolean; lastRefreshedAt?: string };
          manifest: { database: { defaultSchemaScope?: string[] } };
        };
        assert.equal(statusAliasAfterConnect.dbBinding.enabled, true);
        assert.ok(
          statusAliasAfterConnect.dbBinding.lastRefreshedAt,
          "expected lastRefreshedAt to be stamped after connect's refresh step",
        );
        assert.deepEqual(
          statusAliasAfterConnect.manifest.database.defaultSchemaScope,
          ["public"],
          "expected status alias to report the saved defaultSchemaScope",
        );

        await runCliJson(["project", "db", "unbind", connectLiveScratchDir]);
        await runCliJson(["project", "detach", connectLiveScratchDir, "--purge"]);
      } finally {
        delete process.env[connectLiveEnvVarName];
      }
    } finally {
      rmSync(connectLiveScratchDir, { recursive: true, force: true });
    }

    // Phase 3.5: non-interactive `agentmako connect --db-env X` with no `--schemas` and no
    // saved scope should default to the visible app-schema set, persist it, and then inherit
    // it on the next run.
    const connectDefaultScopeScratchDir = path.join(
      os.tmpdir(),
      `mako-connect-default-scope-${Date.now()}-${process.pid}`,
    );
    const connectDefaultScopeMigrationsDir = path.join(
      connectDefaultScopeScratchDir,
      "supabase",
      "migrations",
    );
    mkdirSync(connectDefaultScopeMigrationsDir, { recursive: true });
    const connectDefaultScopeEnvVarName = `MAKO_TEST_CONNECT_DEFAULT_${process.pid}_${Date.now()}`;
    try {
      writeFileSync(
        path.join(connectDefaultScopeScratchDir, "package.json"),
        `${JSON.stringify(
          {
            name: "mako-connect-default-scope",
            version: "0.0.0",
            dependencies: { "@supabase/supabase-js": "^2.0.0" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(
        path.join(connectDefaultScopeMigrationsDir, "001_init.sql"),
        `CREATE TABLE public.items (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
`,
        "utf8",
      );

      process.env[connectDefaultScopeEnvVarName] = phase3LiveDatabaseUrl;
      try {
        const connectDefault = (await runCliJson([
          "connect",
          connectDefaultScopeScratchDir,
          "--yes",
          "--db-env",
          connectDefaultScopeEnvVarName,
        ])) as {
          defaultSchemaScope: string[];
          scopeSource: string;
          refresh: { sourceMode: string } | null;
          manifest: { database: { defaultSchemaScope?: string[] } };
        };
        assert.deepEqual(
          connectDefault.defaultSchemaScope,
          expectedDiscoveredSchemas.visible,
          "expected non-interactive connect with no --schemas to default to the detected visible app schemas",
        );
        assert.equal(
          connectDefault.scopeSource,
          "default",
          "expected scopeSource to be `default` when the CLI applied the visible-schema fallback",
        );
        assert.deepEqual(
          connectDefault.manifest.database.defaultSchemaScope,
          expectedDiscoveredSchemas.visible,
          "expected the default scope to be persisted to the manifest",
        );
        assert.equal(
          connectDefault.refresh?.sourceMode,
          "live_refresh_enabled",
          "expected refresh to run against the default scope",
        );

        // Re-running connect should now see the saved scope as inherited rather than
        // re-applying the default, proving the persistence is real.
        const connectInherit = (await runCliJson([
          "connect",
          connectDefaultScopeScratchDir,
          "--yes",
          "--db-env",
          connectDefaultScopeEnvVarName,
        ])) as { defaultSchemaScope: string[]; scopeSource: string };
        assert.deepEqual(connectInherit.defaultSchemaScope, expectedDiscoveredSchemas.visible);
        assert.equal(
          connectInherit.scopeSource,
          "inherited",
          "expected second connect run to inherit the saved scope, not re-default",
        );

        await runCliJson(["project", "db", "unbind", connectDefaultScopeScratchDir]);
        await runCliJson([
          "project",
          "detach",
          connectDefaultScopeScratchDir,
          "--purge",
        ]);
      } finally {
        delete process.env[connectDefaultScopeEnvVarName];
      }
    } finally {
      rmSync(connectDefaultScopeScratchDir, { recursive: true, force: true });
    }

    const manualVisibleSchema = expectedDiscoveredSchemas.visible.includes("public")
      ? "public"
      : expectedDiscoveredSchemas.visible[0];
    assert.ok(manualVisibleSchema, "expected at least one visible schema in the live DB");

    // Phase 3.5: interactive connect default path. Accepting the default should save all visible
    // app schemas without requiring the user to type a comma-separated list.
    const connectPromptDefaultScratchDir = path.join(
      os.tmpdir(),
      `mako-connect-prompt-default-${Date.now()}-${process.pid}`,
    );
    const connectPromptDefaultMigrationsDir = path.join(
      connectPromptDefaultScratchDir,
      "supabase",
      "migrations",
    );
    mkdirSync(connectPromptDefaultMigrationsDir, { recursive: true });
    const connectPromptDefaultEnvVarName = `MAKO_TEST_CONNECT_PROMPT_DEFAULT_${process.pid}_${Date.now()}`;
    try {
      writeFileSync(
        path.join(connectPromptDefaultScratchDir, "package.json"),
        `${JSON.stringify(
          {
            name: "mako-connect-prompt-default",
            version: "0.0.0",
            dependencies: { "@supabase/supabase-js": "^2.0.0" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(
        path.join(connectPromptDefaultMigrationsDir, "001_init.sql"),
        `CREATE TABLE public.items (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
`,
        "utf8",
      );

      process.env[connectPromptDefaultEnvVarName] = phase3LiveDatabaseUrl;
      try {
        const promptDefaultRun = await runCliWithInput(
          [
            "--interactive",
            "connect",
            connectPromptDefaultScratchDir,
            "--db-env",
            connectPromptDefaultEnvVarName,
          ],
          "\n\n",
        );
        assert.equal(promptDefaultRun.exitCode, 0, promptDefaultRun.stderr || promptDefaultRun.stdout);
        assert.ok(
          promptDefaultRun.stdout.includes("Use all detected app schemas"),
          "expected interactive connect to ask whether to use all detected app schemas",
        );

        const promptDefaultStatus = (await runCliJson([
          "status",
          connectPromptDefaultScratchDir,
        ])) as { manifest: { database: { defaultSchemaScope?: string[] } } };
        assert.deepEqual(
          promptDefaultStatus.manifest.database.defaultSchemaScope,
          expectedDiscoveredSchemas.visible,
          "expected interactive default acceptance to persist the visible app-schema set",
        );

        await runCliJson(["project", "db", "unbind", connectPromptDefaultScratchDir]);
        await runCliJson(["project", "detach", connectPromptDefaultScratchDir, "--purge"]);
      } finally {
        delete process.env[connectPromptDefaultEnvVarName];
      }
    } finally {
      rmSync(connectPromptDefaultScratchDir, { recursive: true, force: true });
    }

    // Phase 3.5: declining the default app-schema set should open a manual selection flow.
    const connectPromptManualScratchDir = path.join(
      os.tmpdir(),
      `mako-connect-prompt-manual-${Date.now()}-${process.pid}`,
    );
    const connectPromptManualMigrationsDir = path.join(
      connectPromptManualScratchDir,
      "supabase",
      "migrations",
    );
    mkdirSync(connectPromptManualMigrationsDir, { recursive: true });
    const connectPromptManualEnvVarName = `MAKO_TEST_CONNECT_PROMPT_MANUAL_${process.pid}_${Date.now()}`;
    try {
      writeFileSync(
        path.join(connectPromptManualScratchDir, "package.json"),
        `${JSON.stringify(
          {
            name: "mako-connect-prompt-manual",
            version: "0.0.0",
            dependencies: { "@supabase/supabase-js": "^2.0.0" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(
        path.join(connectPromptManualMigrationsDir, "001_init.sql"),
        `CREATE TABLE public.items (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
`,
        "utf8",
      );

      process.env[connectPromptManualEnvVarName] = phase3LiveDatabaseUrl;
      try {
        const promptManualRun = await runCliWithInput(
          [
            "--interactive",
            "connect",
            connectPromptManualScratchDir,
            "--db-env",
            connectPromptManualEnvVarName,
          ],
          `\nn\n${manualVisibleSchema}\n`,
        );
        assert.equal(promptManualRun.exitCode, 0, promptManualRun.stderr || promptManualRun.stdout);
        assert.ok(
          promptManualRun.stdout.includes("Visible schemas:"),
          "expected interactive connect to show the visible-schema selection list after declining the default",
        );

        const promptManualStatus = (await runCliJson([
          "status",
          connectPromptManualScratchDir,
        ])) as { manifest: { database: { defaultSchemaScope?: string[] } } };
        assert.deepEqual(
          promptManualStatus.manifest.database.defaultSchemaScope,
          [manualVisibleSchema],
          "expected manual schema selection to persist only the chosen visible schema",
        );

        await runCliJson(["project", "db", "unbind", connectPromptManualScratchDir]);
        await runCliJson(["project", "detach", connectPromptManualScratchDir, "--purge"]);
      } finally {
        delete process.env[connectPromptManualEnvVarName];
      }
    } finally {
      rmSync(connectPromptManualScratchDir, { recursive: true, force: true });
    }

    // Phase 3.5: advanced options must allow hidden/default-ignored schemas like `auth` to be
    // included in the saved scope when the user explicitly asks for them.
    const hiddenSchemaForAdvanced = expectedDiscoveredSchemas.hidden.includes("auth")
      ? "auth"
      : expectedDiscoveredSchemas.hidden[0];
    assert.ok(hiddenSchemaForAdvanced, "expected at least one hidden schema for the advanced-selection flow");

    const connectPromptAdvancedScratchDir = path.join(
      os.tmpdir(),
      `mako-connect-prompt-advanced-${Date.now()}-${process.pid}`,
    );
    const connectPromptAdvancedMigrationsDir = path.join(
      connectPromptAdvancedScratchDir,
      "supabase",
      "migrations",
    );
    mkdirSync(connectPromptAdvancedMigrationsDir, { recursive: true });
    const connectPromptAdvancedEnvVarName = `MAKO_TEST_CONNECT_PROMPT_ADVANCED_${process.pid}_${Date.now()}`;
    try {
      writeFileSync(
        path.join(connectPromptAdvancedScratchDir, "package.json"),
        `${JSON.stringify(
          {
            name: "mako-connect-prompt-advanced",
            version: "0.0.0",
            dependencies: { "@supabase/supabase-js": "^2.0.0" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(
        path.join(connectPromptAdvancedMigrationsDir, "001_init.sql"),
        `CREATE TABLE public.items (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
`,
        "utf8",
      );

      process.env[connectPromptAdvancedEnvVarName] = phase3LiveDatabaseUrl;
      try {
        const promptAdvancedRun = await runCliWithInput(
          [
            "--interactive",
            "connect",
            connectPromptAdvancedScratchDir,
            "--db-env",
            connectPromptAdvancedEnvVarName,
          ],
          `\nn\nadvanced\n${manualVisibleSchema},${hiddenSchemaForAdvanced}\n`,
        );
        assert.equal(promptAdvancedRun.exitCode, 0, promptAdvancedRun.stderr || promptAdvancedRun.stdout);
        assert.ok(
          promptAdvancedRun.stdout.includes("Advanced schema options:"),
          "expected advanced schema selection to be reachable after declining the default schema set",
        );

        const promptAdvancedStatus = (await runCliJson([
          "status",
          connectPromptAdvancedScratchDir,
        ])) as { manifest: { database: { defaultSchemaScope?: string[] } } };
        assert.deepEqual(
          promptAdvancedStatus.manifest.database.defaultSchemaScope,
          [hiddenSchemaForAdvanced, manualVisibleSchema].sort((left, right) => left.localeCompare(right)),
          "expected advanced schema selection to persist hidden schemas alongside visible ones",
        );

        await runCliJson(["project", "db", "unbind", connectPromptAdvancedScratchDir]);
        await runCliJson(["project", "detach", connectPromptAdvancedScratchDir, "--purge"]);
      } finally {
        delete process.env[connectPromptAdvancedEnvVarName];
      }
    } finally {
      rmSync(connectPromptAdvancedScratchDir, { recursive: true, force: true });
    }
  }

  // Phase 3.3 / 3.4: project profile depth + polish. Exercise every layer of
  // the detection model — proxy.ts middleware (Next.js 16), content-validation
  // rejection, import-graph server-boundary closure, exported-symbol auth-guard
  // extraction, resolved path aliases, corrected srcRoot behavior, richer
  // entry-point discovery, and negative cases for framework-reserved filenames
  // and SQL migrations. No live DB required; runs against scratch directories.
  {
    const profileDepthScratchDir = path.join(
      os.tmpdir(),
      `mako-profile-depth-scratch-${Date.now()}-${process.pid}`,
    );
    const profileLibDir = path.join(profileDepthScratchDir, "lib");
    const profileSrcDir = path.join(profileDepthScratchDir, "src", "lib");
    const profileAppDir = path.join(profileDepthScratchDir, "app");
    const profileMigrationsDir = path.join(
      profileDepthScratchDir,
      "supabase",
      "migrations",
    );
    mkdirSync(profileLibDir, { recursive: true });
    mkdirSync(profileSrcDir, { recursive: true });
    mkdirSync(profileAppDir, { recursive: true });
    mkdirSync(profileMigrationsDir, { recursive: true });
    try {
      writeFileSync(
        path.join(profileDepthScratchDir, "package.json"),
        `${JSON.stringify(
          {
            name: "mako-profile-depth-scratch",
            version: "0.0.0",
            dependencies: { next: "16.0.0" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      // tsconfig.base.json carries the alias definitions, and tsconfig.json
      // extends it. The 3.4.1 hotfix swaps the hand-rolled parser for
      // get-tsconfig so extends chains now resolve correctly instead of only
      // handling aliases defined directly in the leaf config.
      writeFileSync(
        path.join(profileDepthScratchDir, "tsconfig.base.json"),
        `{
  // JSONC comments and trailing commas must still parse through the base config.
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
    },
  },
}
`,
        "utf8",
      );

      // tsconfig.json: still JSONC, but now only extends the base config. The
      // profile should expose an absolute path to the scratch repo's `src/`
      // dir instead of the raw `./src/*` string, proving the extends chain was
      // honored.
      writeFileSync(
        path.join(profileDepthScratchDir, "tsconfig.json"),
        `{
  // JSONC comments and trailing commas must still parse in the leaf config too.
  "extends": "./tsconfig.base.json",
}
`,
        "utf8",
      );

      writeFileSync(
        path.join(profileDepthScratchDir, "next.config.ts"),
        `const nextConfig = {};
export default nextConfig;
`,
        "utf8",
      );

      // A generic src/ directory exists, but the real routing roots stay at the
      // repo root (`app/`, not `src/app`). 3.4 should therefore keep
      // `profile.srcRoot === rootPath` instead of switching to root/src just
      // because the directory exists.
      writeFileSync(
        path.join(profileSrcDir, "placeholder.ts"),
        `export const placeholder = true;
`,
        "utf8",
      );

      // Valid Next.js 16 `proxy.ts`: exports config with matcher.
      writeFileSync(
        path.join(profileDepthScratchDir, "proxy.ts"),
        `import { NextResponse } from "next/server";
export function middleware() {
  return NextResponse.next();
}
export const config = { matcher: ["/:path*"] };
`,
        "utf8",
      );

      // A top-level middleware.ts that does NOT export a config — should be
      // rejected by content validation even though the filename matches.
      writeFileSync(
        path.join(profileDepthScratchDir, "middleware.ts"),
        `export function middleware() { return null; }
`,
        "utf8",
      );

      // lib/auth.ts: seed for server-only closure (uses cookies() from
      // next/headers) and host of three valid auth-guard-named exports plus
      // one that does not match the naming convention.
      writeFileSync(
        path.join(profileLibDir, "auth.ts"),
        `import { cookies } from "next/headers";

export interface AuthContext {
  userId: string;
}

export function requireAuth(): boolean {
  const c = cookies();
  return Boolean(c);
}

export async function withSession<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

export const checkRole = (role: string): boolean => role === "admin";

export function notAGuard(): number {
  return 42;
}
`,
        "utf8",
      );

      // lib/uses-auth.ts: imports lib/auth.ts, so it should inherit
      // server-only-ness through the reverse-import closure even though it
      // never imports next/headers directly.
      writeFileSync(
        path.join(profileLibDir, "uses-auth.ts"),
        `import { requireAuth } from "./auth";
export function handler() {
  return requireAuth();
}
`,
        "utf8",
      );

      // lib/auth-type-only.ts: imports only a type from lib/auth.ts. Type-only
      // edges must NOT participate in the reverse-import closure, or this file
      // would be incorrectly marked server-only and its guard-like export would
      // leak into authGuardSymbols.
      writeFileSync(
        path.join(profileLibDir, "auth-type-only.ts"),
        `import type { AuthContext } from "./auth";

export const verifySessionShape = (context: AuthContext): boolean => {
  return context.userId.length > 0;
};
`,
        "utf8",
      );

      // app/layout.tsx: framework-reserved filename under app/. Its exported
      // `Layout` symbol must never leak into authGuardSymbols — both because
      // the name does not match the verb-prefix × auth-substring convention
      // AND because the basename `layout` is in the framework-reserved set
      // so the whole file is skipped during the auth-guard pass regardless
      // of what it exports.
      writeFileSync(
        path.join(profileAppDir, "layout.tsx"),
        `export default function Layout({ children }: { children: unknown }) {
  return children;
}
`,
        "utf8",
      );
      writeFileSync(
        path.join(profileAppDir, "page.tsx"),
        `export default function HomePage() {
  return null;
}
`,
        "utf8",
      );
      writeFileSync(
        path.join(profileAppDir, "robots.ts"),
        `export default function robots() {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
  };
}
`,
        "utf8",
      );

      // app/dashboard/page.tsx: framework-reserved filename that ALSO exports
      // a symbol matching the auth-guard naming convention. This is the
      // stricter reserved-basename test — the name passes the convention
      // filter, so the only thing protecting it from leaking into
      // authGuardSymbols is the FRAMEWORK_RESERVED_BASENAMES filter. If
      // `requireAdminPage` ever shows up in authGuardSymbols, the reserved-
      // basename filter regressed.
      const profileDashboardDir = path.join(profileAppDir, "dashboard");
      mkdirSync(profileDashboardDir, { recursive: true });
      writeFileSync(
        path.join(profileDashboardDir, "page.tsx"),
        `import { cookies } from "next/headers";

export function requireAdminPage() {
  const c = cookies();
  return Boolean(c);
}

export default function Page() {
  return null;
}
`,
        "utf8",
      );

      // A SQL migration file whose name contains "role" and "session". Must
      // never leak into authGuardSymbols — the filter only considers exported
      // symbols from source code files, and .sql is filtered out by extension.
      writeFileSync(
        path.join(profileMigrationsDir, "001_create_user_roles_and_sessions.sql"),
        `CREATE TABLE public.user_roles (id uuid PRIMARY KEY);
CREATE TABLE public.sessions (id uuid PRIMARY KEY);
`,
        "utf8",
      );

      const profileAttach = (await runCliJson(["project", "attach", profileDepthScratchDir])) as {
        profile: {
          srcRoot: string;
          pathAliases: Record<string, string>;
          middlewareFiles: string[];
          entryPoints: string[];
        };
      };

      assert.equal(
        profileAttach.profile.srcRoot,
        normalizePath(profileDepthScratchDir),
        "expected generic src/ plus root-level app/ to keep srcRoot at the project root",
      );
      assert.equal(
        profileAttach.profile.pathAliases["@/"],
        normalizePath(path.join(profileDepthScratchDir, "src")),
        "expected @/ path alias to resolve to the absolute src directory instead of the raw tsconfig target",
      );
      assert.deepEqual(
        profileAttach.profile.middlewareFiles,
        ["proxy.ts"],
        "expected attach-time middleware detection to keep reporting only the validated proxy.ts file",
      );
      assert.ok(
        profileAttach.profile.entryPoints.includes("app/page.tsx"),
        "expected app/page.tsx to appear in entryPoints as a concrete app-router entry file",
      );
      assert.ok(
        profileAttach.profile.entryPoints.includes("app/layout.tsx"),
        "expected app/layout.tsx to appear in entryPoints as a concrete app-router entry file",
      );
      assert.ok(
        profileAttach.profile.entryPoints.includes("app/dashboard/page.tsx"),
        "expected nested app-router page files to appear in entryPoints",
      );
      assert.ok(
        profileAttach.profile.entryPoints.includes("app/robots.ts"),
        "expected Next app-router metadata files like app/robots.ts to appear in entryPoints",
      );
      assert.ok(
        profileAttach.profile.entryPoints.includes("proxy.ts"),
        "expected validated proxy.ts to appear in entryPoints",
      );
      assert.ok(
        profileAttach.profile.entryPoints.includes("next.config.ts"),
        "expected next.config.ts to appear in entryPoints for Next.js projects",
      );

      const profileIndex = (await runCliJson([
        "project",
        "index",
        profileDepthScratchDir,
      ])) as {
        manifest: {
          capabilities: {
            middlewareFiles: string[];
            serverOnlyModules: string[];
            authGuardSymbols: string[];
          };
        };
      };

      const capabilities = profileIndex.manifest.capabilities;

      // Middleware detection: proxy.ts is real middleware (has config + matcher),
      // middleware.ts is not. Only proxy.ts should be listed.
      assert.deepEqual(
        capabilities.middlewareFiles,
        ["proxy.ts"],
        "expected proxy.ts to be detected and middleware.ts (no matching config/matcher body) to be rejected",
      );

      // Server-only closure: lib/auth.ts is a seed (imports next/headers),
      // lib/uses-auth.ts inherits via reverse import graph.
      assert.ok(
        capabilities.serverOnlyModules.includes("lib/auth.ts"),
        "expected lib/auth.ts to be in serverOnlyModules as a next/headers seed",
      );
      assert.ok(
        capabilities.serverOnlyModules.includes("lib/uses-auth.ts"),
        "expected lib/uses-auth.ts to inherit server-only-ness via reverse-import closure",
      );
      assert.ok(
        !capabilities.serverOnlyModules.includes("lib/auth-type-only.ts"),
        "expected lib/auth-type-only.ts to stay out of serverOnlyModules because import type edges do not execute at runtime",
      );
      assert.ok(
        !capabilities.serverOnlyModules.includes("app/layout.tsx"),
        "expected app/layout.tsx to NOT be server-only — it imports nothing that reaches a server primitive",
      );

      // Auth guard symbols: real exported names from server-only files only.
      assert.ok(
        capabilities.authGuardSymbols.includes("requireAuth"),
        "expected requireAuth in authGuardSymbols (verb `require` + substring `Auth`)",
      );
      assert.ok(
        capabilities.authGuardSymbols.includes("withSession"),
        "expected withSession in authGuardSymbols (verb `with` + substring `Session`)",
      );
      assert.ok(
        capabilities.authGuardSymbols.includes("checkRole"),
        "expected checkRole in authGuardSymbols (verb `check` + substring `Role`)",
      );
      assert.ok(
        !capabilities.authGuardSymbols.includes("notAGuard"),
        "expected notAGuard to be rejected — fails naming convention",
      );
      assert.ok(
        !capabilities.authGuardSymbols.includes("verifySessionShape"),
        "expected verifySessionShape to stay out of authGuardSymbols because its only edge to lib/auth.ts is import type",
      );
      assert.ok(
        !capabilities.authGuardSymbols.includes("Layout"),
        "expected framework-reserved Layout to be rejected — fails naming convention",
      );
      // Phase 3.3 review fix: framework-reserved basenames must never
      // contribute symbols to authGuardSymbols, even when those symbols
      // would pass the naming-convention filter. `requireAdminPage` is
      // exported from `app/dashboard/page.tsx` and the name matches
      // `require*` + `*User`, so the ONLY thing rejecting it is the
      // reserved-basename filter on the file itself.
      assert.ok(
        !capabilities.authGuardSymbols.includes("requireAdminPage"),
        "expected reserved-basename page.tsx to be skipped entirely, even for convention-matching exports",
      );
      // app/dashboard/page.tsx imports next/headers, so it IS server-only
      // and should be in serverOnlyModules — the reserved filter only
      // kicks in for symbol extraction, not for import-graph closure.
      assert.ok(
        capabilities.serverOnlyModules.includes("app/dashboard/page.tsx"),
        "expected reserved-basename page.tsx to still flow into serverOnlyModules via its next/headers import",
      );
      assert.ok(
        !capabilities.authGuardSymbols.some((name) =>
          name.includes("create_user_roles_and_sessions"),
        ),
        "expected SQL migration filenames to never leak into authGuardSymbols",
      );
      assert.ok(
        !capabilities.authGuardSymbols.some((name) =>
          /^(layout|page|route|default|error|loading|not-found|template)$/.test(name),
        ),
        "expected Next.js framework-reserved filename stems to never appear as auth guard symbols",
      );

      await runCliJson(["project", "detach", profileDepthScratchDir, "--purge"]);
    } finally {
      rmSync(profileDepthScratchDir, { recursive: true, force: true });
    }
  }

  // Phase 3.4 negative cases: missing `paths` should yield `{}`, and entry-point
  // discovery should still fall back to concrete file entries when there is no
  // middleware/proxy or next.config.* file.
  {
    const profilePolishFallbackScratchDir = path.join(
      os.tmpdir(),
      `mako-profile-polish-fallback-${Date.now()}-${process.pid}`,
    );
    const profilePolishFallbackSrcDir = path.join(profilePolishFallbackScratchDir, "src");
    mkdirSync(profilePolishFallbackSrcDir, { recursive: true });
    try {
      writeFileSync(
        path.join(profilePolishFallbackScratchDir, "package.json"),
        `${JSON.stringify(
          {
            name: "mako-profile-polish-fallback",
            version: "0.0.0",
            devDependencies: { typescript: "5.0.0" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      writeFileSync(
        path.join(profilePolishFallbackScratchDir, "tsconfig.json"),
        `{
  // No paths field here on purpose.
  "compilerOptions": {
    "baseUrl": ".",
  },
}
`,
        "utf8",
      );
      writeFileSync(
        path.join(profilePolishFallbackSrcDir, "index.ts"),
        `export const main = true;
`,
        "utf8",
      );

      const profileFallbackAttach = (await runCliJson([
        "project",
        "attach",
        profilePolishFallbackScratchDir,
      ])) as {
        profile: {
          srcRoot: string;
          pathAliases: Record<string, string>;
          middlewareFiles: string[];
          entryPoints: string[];
        };
      };

      assert.equal(
        profileFallbackAttach.profile.srcRoot,
        normalizePath(path.join(profilePolishFallbackScratchDir, "src")),
        "expected non-Next projects with a real src/ tree to keep srcRoot at root/src",
      );
      assert.deepEqual(
        profileFallbackAttach.profile.pathAliases,
        {},
        "expected pathAliases to stay empty when tsconfig.compilerOptions.paths is absent",
      );
      assert.deepEqual(
        profileFallbackAttach.profile.middlewareFiles,
        [],
        "expected middlewareFiles to stay empty when no validated middleware or proxy file exists",
      );
      assert.ok(
        profileFallbackAttach.profile.entryPoints.includes("src/index.ts"),
        "expected src/index.ts to stay discoverable through the non-Next fallback entry-point logic",
      );
      assert.ok(
        !profileFallbackAttach.profile.entryPoints.some((entryPoint) => entryPoint.startsWith("next.config.")),
        "expected entryPoints to skip next.config.* when the project has no Next config file",
      );

      await runCliJson(["project", "detach", profilePolishFallbackScratchDir, "--purge"]);
    } finally {
      rmSync(profilePolishFallbackScratchDir, { recursive: true, force: true });
    }
  }

  // Phase 3.1 / 3.6: connect lifecycle (replaces the old `project init` tests).
  const initScratchDir = path.join(
    os.tmpdir(),
    `mako-init-scratch-${Date.now()}-${process.pid}`,
  );
  mkdirSync(initScratchDir, { recursive: true });
  try {
    writeFileSync(
      path.join(initScratchDir, "package.json"),
      `${JSON.stringify(
        { name: "mako-init-scratch", version: "0.0.0" },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const connectResult = (await runCliJson([
      "connect",
      initScratchDir,
      "--yes",
      "--no-db",
    ])) as {
      project: { projectId: string; displayName: string };
      indexRun: { status: string } | null;
      schemaSnapshot: { state: string };
      dbBinding: { enabled: boolean; configured: boolean };
      bind: unknown;
      test: unknown;
      nextSteps: string[];
    };
    assert.ok(connectResult.project.projectId, "expected connect to return a project id");
    assert.equal(connectResult.indexRun?.status, "succeeded");
    assert.equal(connectResult.schemaSnapshot.state, "no_sources");
    assert.equal(connectResult.dbBinding.enabled, false);
    assert.equal(connectResult.bind, null);
    assert.equal(connectResult.test, null);
    assert.ok(
      connectResult.nextSteps.some((hint) => /db bind|connect/.test(hint)),
      "expected connect --no-db to surface a bind or reconnect hint",
    );

    const reConnectResult = (await runCliJson([
      "connect",
      initScratchDir,
      "--yes",
      "--no-db",
    ])) as { project: { projectId: string } };
    assert.equal(
      reConnectResult.project.projectId,
      connectResult.project.projectId,
      "expected connect to be idempotent on already-attached projects",
    );

    const initEnvVarName = `MAKO_TEST_INIT_${process.pid}_${Date.now()}`;
    const bindResult = (await runCliJson([
      "project",
      "db",
      "bind",
      initScratchDir,
      "--strategy",
      "env_var_ref",
      "--ref",
      initEnvVarName,
    ])) as {
      binding: { enabled: boolean; strategy: string; ref: string };
    };
    assert.equal(bindResult.binding.enabled, true);
    assert.equal(bindResult.binding.strategy, "env_var_ref");
    assert.equal(bindResult.binding.ref, initEnvVarName);

    const statusAfterBind = (await runCliJson([
      "project",
      "status",
      initScratchDir,
    ])) as {
      manifest: {
        database: {
          liveBinding: { strategy: string; ref: string; enabled: boolean };
        };
      };
    };
    assert.equal(
      statusAfterBind.manifest.database.liveBinding.enabled,
      true,
      "expected post-bind manifest to reflect the enabled flag",
    );
    assert.equal(
      statusAfterBind.manifest.database.liveBinding.ref,
      initEnvVarName,
      "expected post-bind manifest to reflect the env var ref",
    );
    assert.equal(
      statusAfterBind.manifest.database.liveBinding.strategy,
      "env_var_ref",
      "expected post-bind manifest to reflect the env_var_ref strategy",
    );

    const keychainMissingSecret = await runCli([
      "--json",
      "project",
      "db",
      "bind",
      initScratchDir,
      "--strategy",
      "keychain_ref",
      "--ref",
      `mako:test-init-${process.pid}:primary-db`,
    ]);
    assert.notEqual(
      keychainMissingSecret.exitCode,
      0,
      "expected keychain_ref bind without a secret source to fail",
    );
    assert.match(
      keychainMissingSecret.stderr,
      /--url-from-env|--url-stdin/,
      "expected stderr to mention the keychain_ref secret sources",
    );

    const connectNoIndex = (await runCliJson([
      "connect",
      initScratchDir,
      "--yes",
      "--no-db",
      "--no-index",
    ])) as { indexRun: unknown };
    assert.equal(
      connectNoIndex.indexRun,
      null,
      "expected --no-index to skip the index step",
    );

    const missingExplicitPath = path.join(
      os.tmpdir(),
      `mako-definitely-missing-${Date.now()}-${process.pid}`,
    );
    const statusOnMissingDir = await runCli([
      "--interactive",
      "project",
      "status",
      missingExplicitPath,
    ]);
    assert.equal(statusOnMissingDir.exitCode, 1);
    assert.match(
      statusOnMissingDir.stdout,
      /No project attached/,
      "expected friendly message when status runs on an unattached path in interactive mode",
    );
    assert.match(
      statusOnMissingDir.stdout,
      /Next steps/,
      "expected next-steps hint in friendly not-attached output",
    );
    assert.ok(
      statusOnMissingDir.stdout.includes(missingExplicitPath),
      "expected the not-attached hint to echo the explicit path the user provided",
    );

    await runCliJson(["project", "detach", initScratchDir, "--purge"]);
  } finally {
    rmSync(initScratchDir, { recursive: true, force: true });
  }

  // Phase 3.2: top-level `connect` command + schema scope persistence + aliases.
  const connectScratchDir = path.join(
    os.tmpdir(),
    `mako-connect-scratch-${Date.now()}-${process.pid}`,
  );
  mkdirSync(connectScratchDir, { recursive: true });
  try {
    writeFileSync(
      path.join(connectScratchDir, "package.json"),
      `${JSON.stringify(
        { name: "mako-connect-scratch", version: "0.0.0" },
        null,
        2,
      )}\n`,
      "utf8",
    );

    // Connect --yes --no-db — the fully non-interactive smoke path. Should attach + index
    // without touching the DB, and leave the project ready for downstream commands.
    const connectNoDb = (await runCliJson([
      "connect",
      connectScratchDir,
      "--yes",
      "--no-db",
    ])) as {
      project: { projectId: string; displayName: string };
      indexRun: { status: string } | null;
      schemaSnapshot: { state: string };
      dbBinding: { enabled: boolean; configured: boolean };
      bind: unknown;
      test: unknown;
      defaultSchemaScope: string[];
      scopeSource: string;
      refresh: unknown;
      nextSteps: string[];
    };
    assert.ok(connectNoDb.project.projectId, "expected connect --no-db to return a project id");
    assert.equal(connectNoDb.indexRun?.status, "succeeded");
    assert.equal(connectNoDb.dbBinding.enabled, false);
    assert.equal(connectNoDb.bind, null);
    assert.equal(connectNoDb.test, null);
    assert.equal(connectNoDb.refresh, null);
    assert.deepEqual(connectNoDb.defaultSchemaScope, []);
    assert.equal(connectNoDb.scopeSource, "none");

    // Connect with --db-env should refuse when the env var is not set, without writing anything.
    const connectMissingEnv = await runCli([
      "--json",
      "connect",
      connectScratchDir,
      "--yes",
      "--db-env",
      `MAKO_NONEXISTENT_URL_${process.pid}_${Date.now()}`,
    ]);
    assert.notEqual(
      connectMissingEnv.exitCode,
      0,
      "expected connect --db-env with missing env to fail",
    );
    assert.match(
      connectMissingEnv.stderr,
      /not set or empty/i,
      "expected stderr to surface the missing env reason",
    );

    // Top-level `status` alias should match `project status` JSON output for the same project.
    const connectStatusAlias = (await runCliJson([
      "status",
      connectScratchDir,
    ])) as { manifest: { projectId: string }; dbBinding: { enabled: boolean } };
    const connectStatusBase = (await runCliJson([
      "project",
      "status",
      connectScratchDir,
    ])) as { manifest: { projectId: string }; dbBinding: { enabled: boolean } };
    assert.equal(
      connectStatusAlias.manifest.projectId,
      connectStatusBase.manifest.projectId,
      "expected top-level `status` to return the same project as `project status`",
    );
    assert.equal(connectStatusAlias.dbBinding.enabled, connectStatusBase.dbBinding.enabled);

    // Top-level `status` on an unattached path should surface the `agentmako connect` hint and
    // exit with code 1 — same as `project status` but pointed at the new public front door.
    const connectMissingDir = path.join(
      os.tmpdir(),
      `mako-connect-missing-${Date.now()}-${process.pid}`,
    );
    const topLevelStatusMissing = await runCli([
      "--interactive",
      "status",
      connectMissingDir,
    ]);
    assert.equal(topLevelStatusMissing.exitCode, 1);
    assert.match(
      topLevelStatusMissing.stdout,
      /No project attached/,
      "expected top-level status to surface the not-attached message",
    );
    assert.match(
      topLevelStatusMissing.stdout,
      /agentmako connect/,
      "expected top-level status not-attached hint to recommend `agentmako connect`",
    );

    // Top-level `verify` on an unattached path should also surface the connect hint.
    const topLevelVerifyMissing = await runCli([
      "--interactive",
      "verify",
      connectMissingDir,
    ]);
    assert.equal(topLevelVerifyMissing.exitCode, 1);
    assert.match(
      topLevelVerifyMissing.stdout,
      /agentmako connect/,
      "expected top-level verify not-attached hint to recommend `agentmako connect`",
    );

    // Connect --yes --no-db --schemas public,ops should persist default schema scope into the
    // manifest even when no DB is bound. This is the "save defaults once" pillar of Phase 3.2.
    const connectWithScope = (await runCliJson([
      "connect",
      connectScratchDir,
      "--yes",
      "--no-db",
      "--schemas",
      "public,ops",
    ])) as {
      defaultSchemaScope: string[];
      scopeSource: string;
      manifest: { database: { defaultSchemaScope?: string[] } };
    };
    assert.deepEqual(connectWithScope.defaultSchemaScope, ["public", "ops"]);
    assert.equal(connectWithScope.scopeSource, "user");
    assert.deepEqual(
      connectWithScope.manifest.database.defaultSchemaScope,
      ["public", "ops"],
      "expected defaultSchemaScope to be persisted in the manifest after connect",
    );

    // Reading the manifest from disk should show the same scope — confirms we wrote through.
    const manifestPathOnDisk = path.join(connectScratchDir, ".mako", "project.json");
    const manifestOnDisk = JSON.parse(readFileSync(manifestPathOnDisk, "utf8")) as {
      database: { defaultSchemaScope?: string[] };
    };
    assert.deepEqual(
      manifestOnDisk.database.defaultSchemaScope,
      ["public", "ops"],
      "expected on-disk manifest to carry defaultSchemaScope",
    );

    // Re-running connect --yes --no-db (without --schemas) should preserve the saved scope —
    // attach/index cycle must not clobber it.
    const connectReconnect = (await runCliJson([
      "connect",
      connectScratchDir,
      "--yes",
      "--no-db",
    ])) as {
      defaultSchemaScope: string[];
      manifest: { database: { defaultSchemaScope?: string[] } };
    };
    assert.deepEqual(
      connectReconnect.defaultSchemaScope,
      ["public", "ops"],
      "expected re-running connect to preserve the saved schema scope",
    );
    assert.deepEqual(
      connectReconnect.manifest.database.defaultSchemaScope,
      ["public", "ops"],
      "expected re-run connect manifest to still carry defaultSchemaScope",
    );

    // Connect --schemas "" (empty after filtering) should clear the saved scope.
    const connectClearScope = (await runCliJson([
      "connect",
      connectScratchDir,
      "--yes",
      "--no-db",
      "--schemas",
      ",",
    ])) as {
      defaultSchemaScope: string[];
      manifest: { database: { defaultSchemaScope?: string[] } };
    };
    // With empty schemas and --yes (no interactive fallback), scope should stay whatever was
    // saved — because args.schemas.length is 0 so the fallback-to-saved branch fires.
    assert.deepEqual(
      connectClearScope.defaultSchemaScope,
      ["public", "ops"],
      "expected connect --yes --schemas ',' to leave saved scope intact (no prompt, no clear)",
    );

    const connectProjectStore = openProjectStore({
      projectRoot: connectScratchDir,
      stateDirName,
    });
    try {
      const lifecycleEvents = connectProjectStore.queryLifecycleEvents({ limit: 20 });
      assert.ok(
        lifecycleEvents.some(
          (event) =>
            event.eventType === "project_attach" &&
            event.projectId === connectNoDb.project.projectId &&
            event.outcome === "success",
        ),
        "expected connect scratch project to log a successful project_attach event",
      );
      assert.ok(
        lifecycleEvents.some(
          (event) =>
            event.eventType === "project_index" &&
            event.projectId === connectNoDb.project.projectId &&
            event.outcome === "success",
        ),
        "expected connect scratch project to log a successful project_index event",
      );

      const lifecycleRow = connectProjectStore.db
        .prepare("SELECT event_id FROM lifecycle_events ORDER BY finished_at DESC LIMIT 1")
        .get() as { event_id: string } | undefined;
      assert.ok(lifecycleRow, "expected at least one lifecycle_events row");
      assert.throws(
        () => connectProjectStore.db.prepare("DELETE FROM lifecycle_events WHERE event_id = ?").run(lifecycleRow!.event_id),
        /append-only/i,
        "expected lifecycle_events deletes to be blocked by an append-only trigger",
      );
    } finally {
      connectProjectStore.close();
    }

    const dummyToolName = `phase4_dummy_${Date.now()}_${process.pid}`;
    registerToolDefinition({
      name: dummyToolName,
      category: "symbols",
      description: "Smoke-only dummy tool for Phase 4 logging verification.",
      annotations: { readOnlyHint: true },
      inputSchema: ProjectLocatorInputSchema,
      outputSchema: AskToolOutputSchema,
      async execute(input) {
        return {
          toolName: dummyToolName,
          mode: "tool",
          selectedFamily: "smoke",
          selectedTool: dummyToolName,
          selectedArgs: input,
          confidence: 1,
          fallbackReason: null,
          result: { ok: true },
        };
      },
    });

    const toolService = createToolService({ configOverrides: { stateDirName } });
    try {
      const dummyResult = (await toolService.callTool(dummyToolName, {
        projectRef: connectScratchDir,
      })) as unknown as { toolName: string; result: { ok: boolean } };
      assert.equal(dummyResult.toolName, dummyToolName);
      assert.equal(dummyResult.result.ok, true, "expected dummy tool to return a structured success payload");

      const dummyProjectStore = openProjectStore({
        projectRoot: connectScratchDir,
        stateDirName,
      });
      try {
        const dummyToolRun = dummyProjectStore.queryToolRuns({ toolName: dummyToolName, limit: 1 })[0];
        assert.ok(dummyToolRun, "expected dynamically registered tool to be logged without logging-layer changes");
        assert.equal(dummyToolRun.toolName, dummyToolName);
        assert.ok(dummyToolRun.durationMs >= 0, "expected dummy tool run to record duration_ms");

        const toolRunRow = dummyProjectStore.db
          .prepare("SELECT run_id FROM tool_runs WHERE tool_name = ? ORDER BY finished_at DESC LIMIT 1")
          .get(dummyToolName) as { run_id: string } | undefined;
        assert.ok(toolRunRow, "expected at least one tool_runs row for the dummy tool");
        assert.throws(
          () => dummyProjectStore.db.prepare("UPDATE tool_runs SET tool_name = ? WHERE run_id = ?").run("bad_name", toolRunRow!.run_id),
          /append-only/i,
          "expected tool_runs updates to be blocked by an append-only trigger",
        );
      } finally {
        dummyProjectStore.close();
      }

      const dummyGlobalStore = openGlobalStore({ stateDirName });
      try {
        const dummyUsage = dummyGlobalStore.getToolUsageStat(dummyToolName);
        assert.ok(dummyUsage, "expected dummy tool usage stat to be tracked in global.db");
        assert.ok(dummyUsage!.callCount >= 1, "expected dummy tool usage call_count >= 1");
        assert.equal(
          dummyUsage!.lastProjectId,
          connectNoDb.project.projectId,
          "expected dummy tool usage stats to remember the last project id",
        );
      } finally {
        dummyGlobalStore.close();
      }
    } finally {
      unregisterToolDefinition(dummyToolName);
      toolService.close();
    }

    await runCliJson(["project", "detach", connectScratchDir, "--purge"]);

    const postPurgeGlobalStore = openGlobalStore({ stateDirName });
    try {
      const postPurgeUsage = postPurgeGlobalStore.getToolUsageStat(dummyToolName);
      assert.ok(postPurgeUsage, "expected tool_usage_stats rows to survive project detach/purge");
      assert.ok(postPurgeUsage!.callCount >= 1, "expected surviving tool_usage_stats row to keep its call count");
    } finally {
      postPurgeGlobalStore.close();
    }
  } finally {
    rmSync(connectScratchDir, { recursive: true, force: true });
  }

  const unsupportedSchemaScratchDir = path.join(
    os.tmpdir(),
    `mako-unsupported-schema-${Date.now()}-${process.pid}`,
  );
  mkdirSync(path.join(unsupportedSchemaScratchDir, "prisma"), { recursive: true });
  try {
    writeFileSync(
      path.join(unsupportedSchemaScratchDir, "package.json"),
      `${JSON.stringify({ name: "mako-unsupported-schema", version: "0.0.0" }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(unsupportedSchemaScratchDir, "prisma", "schema.prisma"),
      [
        'generator client {',
        '  provider = "prisma-client-js"',
        '}',
        '',
        'datasource db {',
        '  provider = "postgresql"',
        '  url      = env("DATABASE_URL")',
        '}',
      ].join("\n"),
      "utf8",
    );

    const unsupportedIndexResult = (await runCliJson([
      "project",
      "index",
      unsupportedSchemaScratchDir,
    ])) as {
      project: { projectId: string };
      schemaSnapshot: { state: string; warningCount?: number };
      schemaSnapshotWarnings: Array<{ kind: string; sourcePath?: string }>;
    };
    assert.equal(unsupportedIndexResult.schemaSnapshot.state, "not_built");
    assert.ok(
      unsupportedIndexResult.schemaSnapshotWarnings.some(
        (warning) => warning.kind === "unsupported_source" && warning.sourcePath === "prisma/schema.prisma",
      ),
      "expected index output to surface an unsupported_source warning for prisma/schema.prisma",
    );

    const unsupportedStatus = (await runCliJson([
      "project",
      "status",
      unsupportedSchemaScratchDir,
    ])) as {
      schemaSnapshot: { state: string; warningCount?: number };
    };
    assert.equal(unsupportedStatus.schemaSnapshot.state, "not_built");
    assert.ok(
      (unsupportedStatus.schemaSnapshot.warningCount ?? 0) > 0,
      "expected not_built status to surface a non-zero snapshot warningCount",
    );

    const unsupportedProjectStore = openProjectStore({
      projectRoot: unsupportedSchemaScratchDir,
      stateDirName,
    });
    try {
      const latestSchemaBuild = unsupportedProjectStore.queryLifecycleEvents({
        eventType: "schema_snapshot_build",
        limit: 1,
      })[0];
      assert.ok(latestSchemaBuild, "expected a schema_snapshot_build lifecycle event for the unsupported schema run");
      const latestWarnings = ((latestSchemaBuild!.metadata as { warnings?: unknown[] }).warnings ?? []) as Array<{
        kind?: string;
        sourcePath?: string;
      }>;
      assert.ok(
        latestWarnings.some(
          (warning) => warning.kind === "unsupported_source" && warning.sourcePath === "prisma/schema.prisma",
        ),
        "expected schema_snapshot_build metadata to persist the unsupported_source warning",
      );
    } finally {
      unsupportedProjectStore.close();
    }

    rmSync(path.join(unsupportedSchemaScratchDir, "prisma", "schema.prisma"), { force: true });

    await runCliJson(["project", "index", unsupportedSchemaScratchDir]);

    const missingProjectStore = openProjectStore({
      projectRoot: unsupportedSchemaScratchDir,
      stateDirName,
    });
    try {
      const schemaBuildEvents = missingProjectStore.queryLifecycleEvents({
        eventType: "schema_snapshot_build",
        limit: 2,
      });
      assert.ok(schemaBuildEvents.length >= 2, "expected re-indexing to append a second schema_snapshot_build event");
      const latestWarnings = ((schemaBuildEvents[0]!.metadata as { warnings?: unknown[] }).warnings ?? []) as Array<{
        kind?: string;
      }>;
      assert.ok(
        latestWarnings.length === 0 || latestWarnings.some((warning) => warning.kind === "source_missing"),
        "expected the next schema_snapshot_build event to reflect the missing Prisma source",
      );
    } finally {
      missingProjectStore.close();
    }

    await runCliJson(["project", "detach", unsupportedSchemaScratchDir, "--purge"]);
  } finally {
    rmSync(unsupportedSchemaScratchDir, { recursive: true, force: true });
  }

  const secondaryAttachResult = (await runCliJson(["project", "attach", "apps/web"])) as {
    project: { projectId: string; displayName: string };
  };
  assert.match(secondaryAttachResult.project.displayName, /web/i);

  const secondaryIndexResult = (await runCliJson(["project", "index", "apps/web"])) as {
    stats: { files: number };
  };
  assert.ok(secondaryIndexResult.stats.files > 0, "expected second attached project to index successfully");

  const cliTools = (await runCliJson(["tool", "list"])) as Array<{
    name: string;
    outputSchema: unknown;
  }>;
  assert.ok(
    cliTools.some((tool) => tool.name === "route_trace" && tool.outputSchema != null),
    "expected route_trace tool metadata from CLI tool list",
  );
  assert.ok(
    cliTools.some((tool) => tool.name === "ask" && tool.outputSchema != null),
    "expected ask tool metadata from CLI tool list",
  );

  const cliToolCall = (await runCliJson([
    "tool",
    "call",
    ".",
    "imports_deps",
    JSON.stringify({ file: "services/api/src/server.ts" }),
  ])) as {
    resolvedFilePath: string | null;
    imports: Array<{ specifier: string }>;
  };
  assert.equal(cliToolCall.resolvedFilePath, "services/api/src/server.ts");
  assert.ok(
    cliToolCall.imports.some((edge) => edge.specifier === "./service.js"),
    "expected imports_deps CLI tool call to include ./service.js",
  );

  const repoProjectStore = openProjectStore({
    projectRoot: repoRoot,
    stateDirName,
  });
  try {
    const importsDepsRun = repoProjectStore.queryToolRuns({ toolName: "imports_deps", limit: 1 })[0];
      assert.ok(importsDepsRun, "expected imports_deps calls to be logged in tool_runs");
      assert.equal(importsDepsRun.toolName, "imports_deps");
      assert.ok(importsDepsRun.durationMs >= 0, "expected tool_runs rows to record duration_ms");

      const benchmarkPayload = {
        request: { tool: "imports_deps", file: "services/api/src/server.ts" },
        response: { imports: ["./service.js"] },
      };
      const payloadToolRun = repoProjectStore.insertToolRun({
        projectId: attachResult.project.projectId,
        toolName: "phase4_1_benchmark_probe",
        inputSummary: { file: "services/api/src/server.ts" },
        outputSummary: { ok: true },
        payload: benchmarkPayload,
        outcome: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        requestId: `phase4_1_payload_${Date.now()}`,
      });
      const nullablePayloadToolRun = repoProjectStore.insertToolRun({
        projectId: attachResult.project.projectId,
        toolName: "phase4_1_benchmark_probe_nullable",
        inputSummary: { file: "services/api/src/routes.ts" },
        outputSummary: { ok: true },
        outcome: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        requestId: `phase4_1_nullable_${Date.now()}`,
      });
      assert.deepEqual(
        payloadToolRun.payload,
        benchmarkPayload,
        "expected tool_runs payload_json to round-trip when supplied",
      );
      assert.equal(
        nullablePayloadToolRun.payload,
        undefined,
        "expected tool_runs payload_json to stay nullable when omitted",
      );

      const benchmarkSuite = repoProjectStore.saveBenchmarkSuite({
        name: `Phase 4.1 Smoke Suite ${Date.now()}`,
        description: "Smoke-only suite definition for benchmark storage verification.",
        version: "1.0.0",
        config: { runner: "smoke", phase: "4.1" },
      });
      const storedBenchmarkSuite = repoProjectStore.getBenchmarkSuite(benchmarkSuite.suiteId);
      assert.deepEqual(
        storedBenchmarkSuite,
        benchmarkSuite,
        "expected benchmark_suites rows to round-trip without data loss",
      );
      assert.ok(
        repoProjectStore.listBenchmarkSuites().some((suite) => suite.suiteId === benchmarkSuite.suiteId),
        "expected listBenchmarkSuites to include the saved suite",
      );

      const benchmarkCase = repoProjectStore.saveBenchmarkCase({
        suiteId: benchmarkSuite.suiteId,
        name: "imports_deps payload capture",
        toolName: payloadToolRun.toolName,
        input: { file: "services/api/src/server.ts" },
        expectedOutcome: { outcome: "success", importCountAtLeast: 1 },
      });
      assert.ok(
        repoProjectStore.listBenchmarkCases(benchmarkSuite.suiteId).some((item) => item.caseId === benchmarkCase.caseId),
        "expected listBenchmarkCases to include the saved case",
      );

      const benchmarkAssertion = repoProjectStore.saveBenchmarkAssertion({
        caseId: benchmarkCase.caseId,
        assertionType: "json_path_equals",
        expectedValue: { path: "response.imports[0]", value: "./service.js" },
        tolerance: 0,
      });
      assert.ok(
        repoProjectStore
          .listBenchmarkAssertions(benchmarkCase.caseId)
          .some((item) => item.assertionId === benchmarkAssertion.assertionId),
        "expected listBenchmarkAssertions to include the saved assertion",
      );

      const benchmarkRun = repoProjectStore.insertBenchmarkRun({
        suiteId: benchmarkSuite.suiteId,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: "passed",
        runnerVersion: "smoke-suite",
      });
      assert.equal(
        repoProjectStore.getBenchmarkRun(benchmarkRun.runId)?.suiteId,
        benchmarkSuite.suiteId,
        "expected benchmark_runs rows to reference the suite definition",
      );
      assert.ok(
        repoProjectStore.listBenchmarkRuns({ suiteId: benchmarkSuite.suiteId }).some((item) => item.runId === benchmarkRun.runId),
        "expected listBenchmarkRuns to include the saved run",
      );

      const benchmarkCaseResult = repoProjectStore.insertBenchmarkCaseResult({
        runId: benchmarkRun.runId,
        caseId: benchmarkCase.caseId,
        toolRunId: payloadToolRun.runId,
        outcome: "passed",
        actualValue: { outcome: "success", imports: ["./service.js"] },
      });
      const linkedToolRun = repoProjectStore.db
        .prepare(`
          SELECT tr.run_id, tr.tool_name
          FROM benchmark_case_results bcr
          INNER JOIN tool_runs tr ON tr.run_id = bcr.tool_run_id
          WHERE bcr.case_result_id = ?
        `)
        .get(benchmarkCaseResult.caseResultId) as { run_id: string; tool_name: string } | undefined;
      assert.ok(linkedToolRun, "expected benchmark_case_results rows to resolve their tool_runs link");
      assert.equal(linkedToolRun!.run_id, payloadToolRun.runId);
      assert.equal(linkedToolRun!.tool_name, payloadToolRun.toolName);
      assert.ok(
        repoProjectStore
          .listBenchmarkCaseResults({ runId: benchmarkRun.runId })
          .some((item) => item.caseResultId === benchmarkCaseResult.caseResultId),
        "expected listBenchmarkCaseResults to include the saved case result",
      );
      assert.throws(
        () =>
          repoProjectStore.insertBenchmarkCaseResult({
            runId: benchmarkRun.runId,
            caseId: benchmarkCase.caseId,
            toolRunId: `missing_tool_run_${Date.now()}`,
            outcome: "failed",
          }),
        /benchmark-link-failed/i,
        "expected missing tool_runs links to fail explicitly",
      );

      const benchmarkAssertionResult = repoProjectStore.insertBenchmarkAssertionResult({
        caseResultId: benchmarkCaseResult.caseResultId,
        assertionId: benchmarkAssertion.assertionId,
        passed: true,
        actualValue: { path: "response.imports[0]", value: "./service.js" },
        expectedValue: benchmarkAssertion.expectedValue,
      });
      const storedAssertionResult = repoProjectStore.getBenchmarkAssertionResult(
        benchmarkAssertionResult.assertionResultId,
      );
      assert.deepEqual(
        storedAssertionResult,
        benchmarkAssertionResult,
        "expected benchmark_assertion_results rows to be queryable individually",
      );
      assert.ok(
        repoProjectStore
          .listBenchmarkAssertionResults({ caseResultId: benchmarkCaseResult.caseResultId })
          .some((item) => item.assertionResultId === benchmarkAssertionResult.assertionResultId),
        "expected listBenchmarkAssertionResults to include the saved assertion result",
      );

      assert.throws(
        () => repoProjectStore.db.prepare("DELETE FROM benchmark_runs WHERE run_id = ?").run(benchmarkRun.runId),
        /append-only/i,
        "expected benchmark_runs deletes to be blocked by an append-only trigger",
      );
      assert.throws(
        () =>
          repoProjectStore.db
            .prepare("UPDATE benchmark_case_results SET outcome = ? WHERE case_result_id = ?")
            .run("failed", benchmarkCaseResult.caseResultId),
        /append-only/i,
        "expected benchmark_case_results updates to be blocked by an append-only trigger",
      );
  } finally {
    repoProjectStore.close();
  }

  const repoGlobalStore = openGlobalStore({ stateDirName });
  try {
    const importsDepsUsage = repoGlobalStore.getToolUsageStat("imports_deps");
    assert.ok(importsDepsUsage, "expected imports_deps usage stats to be tracked globally");
    assert.ok(importsDepsUsage!.callCount >= 1, "expected imports_deps call_count >= 1");
  } finally {
    repoGlobalStore.close();
  }

  const cliProjectPrecedence = (await runCliJson([
    "tool",
    "call",
    ".",
    "symbols_of",
    JSON.stringify({
      projectRef: secondaryAttachResult.project.projectId,
      file: "services/api/src/server.ts",
    }),
  ])) as {
    projectId: string;
    resolvedFilePath: string | null;
  };
  assert.equal(
    cliProjectPrecedence.projectId,
    attachResult.project.projectId,
    "expected positional project selector to win over JSON payload projectRef",
  );
  assert.equal(cliProjectPrecedence.resolvedFilePath, "services/api/src/server.ts");

  const cliProjectIdPrecedence = (await runCliJson([
    "tool",
    "call",
    ".",
    "symbols_of",
    JSON.stringify({
      projectId: secondaryAttachResult.project.projectId,
      file: "services/api/src/server.ts",
    }),
  ])) as {
    projectId: string;
    resolvedFilePath: string | null;
  };
  assert.equal(
    cliProjectIdPrecedence.projectId,
    attachResult.project.projectId,
    "expected positional project selector to win over JSON payload projectId",
  );
  assert.equal(cliProjectIdPrecedence.resolvedFilePath, "services/api/src/server.ts");

  const cliAskTool = (await runCliJson([
    "tool",
    "call",
    ".",
    "ask",
    JSON.stringify({ question: "where is /api/v1/projects handled" }),
  ])) as {
    toolName: string;
    mode: string;
    selectedTool: string;
    selectedArgs: { projectRef?: string; route?: string };
    result: { toolName: string };
  };
  assert.equal(cliAskTool.toolName, "ask");
  assert.equal(cliAskTool.mode, "tool");
  assert.equal(cliAskTool.selectedTool, "route_trace");
  assert.deepEqual(cliAskTool.selectedArgs, {
    projectRef: ".",
    route: "/api/v1/projects",
  });
  assert.equal(cliAskTool.result.toolName, "route_trace");

  const routeAnswer = (await runCliJson([
    "answer",
    "ask",
    ".",
    "route_trace",
    "/api/v1/projects",
  ])) as {
    answer?: string;
    packet: { evidence: Array<{ title: string; filePath?: string }> };
  };
  assert.match(routeAnswer.answer ?? "", /services\/api\/src\/server\.ts/);
  assert.ok(
    routeAnswer.packet.evidence.some((block) => block.title.startsWith("Route Definition") && block.filePath === "services/api/src/routes.ts"),
    "expected route definition evidence from services/api/src/routes.ts",
  );

  const fileHealth = (await runCliJson([
    "answer",
    "ask",
    ".",
    "file_health",
    "services/api/src/server.ts",
  ])) as {
    packet: { evidence: Array<{ title: string; content: string }> };
  };
  assert.ok(
    fileHealth.packet.evidence.some(
      (block) =>
        block.title === "Inbound Dependents of services/api/src/server.ts" &&
        block.content.includes("services/api/src/index.ts"),
    ),
    "expected inbound dependency evidence for services/api/src/server.ts",
  );

  // Additional query kinds coverage
  const schemaUsage = (await runCliJson([
    "answer",
    "ask",
    ".",
    "schema_usage",
    "projects",
  ])) as {
    answer?: string;
    packet: { evidence: Array<{ title: string; kind: string; filePath?: string }> };
  };
  assert.ok(
    (schemaUsage.answer ?? "") !== "",
    "expected schema_usage to return an answer",
  );
  assert.ok(
    schemaUsage.packet.evidence.some((block) => block.kind === "schema"),
    "expected schema evidence in schema_usage response",
  );

  const authPath = (await runCliJson([
    "answer",
    "ask",
    ".",
    "auth_path",
    "login",
  ])) as {
    answer?: string;
    packet: { evidence: Array<{ title: string; filePath?: string }> };
  };
  assert.ok(
    (authPath.answer ?? "") !== "",
    "expected auth_path to return an answer",
  );
  assert.ok(
    authPath.packet.evidence.some((block) => block.title.includes("Project Auth Profile")),
    "expected auth profile evidence in auth_path response",
  );

  const freeForm = (await runCliJson([
    "answer",
    "ask",
    ".",
    "free_form",
    "services/api/src/server.ts dependencies",
  ])) as {
    answer?: string;
    packet: { evidence: Array<{ title: string; kind: string }> };
  };
  assert.ok(
    (freeForm.answer ?? "") !== "",
    "expected free_form to return an answer",
  );
  assert.ok(
    freeForm.packet.evidence.some((block) => block.kind === "file" || block.kind === "route"),
    "expected file or route evidence in free_form response",
  );

  // Negative path assertions - verify graceful degradation (no crashes)
  const nonExistentRoute = (await runCliJson([
    "answer",
    "ask",
    ".",
    "route_trace",
    "/xyz123/nonexistent/path",
  ])) as { packet: { evidenceStatus: string } };
  assert.ok(
    nonExistentRoute.packet.evidenceStatus === "partial",
    "expected partial evidence for non-existent route",
  );

  const nonExistentFile = (await runCliJson([
    "answer",
    "ask",
    ".",
    "file_health",
    "xyzabc/nonexistent.ts",
  ])) as { packet: { evidenceStatus: string } };
  // Note: evidenceStatus may be "complete" if file search finds partial matches
  // The key assertion is that it doesn't crash and returns a structured response
  assert.ok(
    nonExistentFile.packet.evidenceStatus !== undefined,
    "expected structured response (not crash) for non-existent file",
  );

  const nonExistentSchema = (await runCliJson([
    "answer",
    "ask",
    ".",
    "schema_usage",
    "xyz123_nonexistent_table",
  ])) as { packet: { evidenceStatus: string } };
  assert.ok(
    nonExistentSchema.packet.evidenceStatus === "partial",
    "expected partial evidence for non-existent schema",
  );

  const noAuthContext = (await runCliJson([
    "answer",
    "ask",
    ".",
    "auth_path",
    "xyz123 utility endpoint",
  ])) as { answerConfidence?: number; packet: { evidenceStatus: string } };
  assert.ok(
    noAuthContext.answerConfidence === undefined ||
      noAuthContext.answerConfidence < 0.7 ||
      noAuthContext.packet.evidenceStatus === "partial",
    "expected degraded confidence for auth without context",
  );

  const gibberishQuery = (await runCliJson([
    "answer",
    "ask",
    ".",
    "free_form",
    "xyzabc123nonexistent",
  ])) as { packet: { evidence: unknown[] } };
  assert.ok(
    Array.isArray(gibberishQuery.packet.evidence),
    "expected evidence array for gibberish query",
  );

  const server = await startHttpApiServer({
    host: "127.0.0.1",
    port: 0,
    configOverrides: {
      stateDirName,
      // Force the DB tool surface into a db_not_connected state so negative-path
      // assertions below are deterministic regardless of the caller's env.
      databaseTools: { enabled: true },
    },
  });

  try {
    const baseUrl = `http://${server.host}:${server.port}`;
    const mcpClient = new Client(
      { name: "mako-smoke", version: "0.1.0" },
      { capabilities: { roots: { listChanged: true } } },
    );
    const mcpTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    mcpClient.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: [{ uri: pathToFileURL(repoRoot).href, name: "repo-root" }],
    }));

    const health = await fetchJson(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual((health.body as { ok: boolean }).ok, true);
    assert.equal((health.body as { requestId: string }).requestId, health.requestId);

    const projects = await fetchJson(`${baseUrl}/api/v1/projects`);
    assert.equal(projects.status, 200);
    assert.equal((projects.body as { requestId: string }).requestId, projects.requestId);
    assert.ok(
      (projects.body as { ok: boolean; data: Array<{ projectId: string }> }).data.some(
        (project) => project.projectId === attachResult.project.projectId,
      ),
      "expected attached project from API project list",
    );

    // Architectural decision #18: tool-layer identifier resolution must be exact and must surface typed ambiguity errors.
    const ambiguousSymbols = await fetchJson(`${baseUrl}/api/v1/tools/symbols_of`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: attachResult.project.projectId,
        file: "index.ts",
      }),
    });

    assert.equal(ambiguousSymbols.status, 400);
    assert.equal((ambiguousSymbols.body as { ok: boolean }).ok, false);
    assert.equal(
      (ambiguousSymbols.body as { error: { code: string } }).error.code,
      "ambiguous_file",
    );
    assert.ok(
      ((ambiguousSymbols.body as { error: { details?: { candidates?: unknown[] } } }).error.details?.candidates ?? []).length >= 2,
      "expected ambiguous_file to include at least two candidate file paths",
    );

    const ambiguousImports = await fetchJson(`${baseUrl}/api/v1/tools/imports_deps`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: attachResult.project.projectId,
        file: "index.ts",
      }),
    });

    assert.equal(ambiguousImports.status, 400);
    assert.equal((ambiguousImports.body as { ok: boolean }).ok, false);
    assert.equal(
      (ambiguousImports.body as { error: { code: string } }).error.code,
      "ambiguous_file",
    );
    assert.ok(
      ((ambiguousImports.body as { error: { details?: { candidates?: unknown[] } } }).error.details?.candidates ?? []).length >= 2,
      "expected imports_deps ambiguity to include at least two candidate file paths",
    );

    const httpTools = await fetchJson(`${baseUrl}/api/v1/tools`);
    assert.equal(httpTools.status, 200);
    assert.ok(
      (httpTools.body as { ok: boolean; data: Array<{ name: string; outputSchema: unknown }> }).data.some(
        (tool) => tool.name === "imports_cycles" && tool.outputSchema != null,
      ),
      "expected output schemas from HTTP tools list",
    );
    assert.ok(
      (httpTools.body as { ok: boolean; data: Array<{ name: string; outputSchema: unknown }> }).data.some(
        (tool) => tool.name === "ask" && tool.outputSchema != null,
      ),
      "expected ask in the HTTP tools list",
    );

    const httpToolCall = await fetchJson(`${baseUrl}/api/v1/tools/route_trace`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: attachResult.project.projectId,
        route: "/api/v1/projects",
      }),
    });

    assert.equal(httpToolCall.status, 200);
    assert.match(
      ((httpToolCall.body as { ok: boolean; data: { result: { answer?: string } } }).data.result.answer ?? ""),
      /services\/api\/src\/server\.ts/,
    );

    const httpAskToolCall = await fetchJson(`${baseUrl}/api/v1/tools/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: attachResult.project.projectId,
        question: "what depends on services/api/src/server.ts",
      }),
    });
    assert.equal(httpAskToolCall.status, 200);
    const httpAskToolData = (httpAskToolCall.body as {
      ok: boolean;
      data: {
        toolName: string;
        mode: string;
        selectedFamily: string;
        selectedTool: string;
        selectedArgs: { projectId?: string; file?: string };
        fallbackReason: string | null;
        result: { toolName: string };
      };
    }).data;
    assert.equal(httpAskToolData.toolName, "ask");
    assert.equal(httpAskToolData.mode, "tool");
    assert.equal(httpAskToolData.selectedFamily, "imports");
    assert.equal(httpAskToolData.selectedTool, "imports_impact");
    assert.deepEqual(httpAskToolData.selectedArgs, {
      projectId: attachResult.project.projectId,
      file: "services/api/src/server.ts",
    });
    assert.equal(httpAskToolData.fallbackReason, null);
    assert.equal(httpAskToolData.result.toolName, "imports_impact");

    const apiAnswer = await fetchJson(`${baseUrl}/api/v1/answers`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectId: attachResult.project.projectId,
        queryKind: "route_trace",
        queryText: "/api/v1/projects",
      }),
    });

    assert.equal(apiAnswer.status, 200);
    assert.equal((apiAnswer.body as { requestId: string }).requestId, apiAnswer.requestId);
    assert.match(
      ((apiAnswer.body as { ok: boolean; data: { answer?: string } }).data.answer ?? ""),
      /services\/api\/src\/server\.ts/,
    );

    const apiAnswerFromMeta = await fetchJson(`${baseUrl}/api/v1/answers`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        _meta: { cwd: repoRoot },
        queryKind: "route_trace",
        queryText: "/api/v1/projects",
      }),
    });

    assert.equal(apiAnswerFromMeta.status, 200);
    assert.match(
      ((apiAnswerFromMeta.body as { ok: boolean; data: { answer?: string } }).data.answer ?? ""),
      /services\/api\/src\/server\.ts/,
    );

    await mcpClient.connect(mcpTransport);
    const mcpTools = await mcpClient.listTools();
    assert.ok(
      mcpTools.tools.some((tool) => tool.name === "symbols_of" && tool.outputSchema != null),
      "expected symbols_of tool in MCP tools/list output",
    );
    assert.ok(
      mcpTools.tools.some((tool) => tool.name === "ask" && tool.outputSchema != null),
      "expected ask in MCP tools/list output",
    );
    assert.ok(
      mcpTools.tools.some((tool) => tool.name === "tool_search" && tool.outputSchema != null),
      "expected tool_search in MCP tools/list output",
    );
    const authPathTool = mcpTools.tools.find((tool) => tool.name === "auth_path");
    assert.ok(authPathTool != null, "expected auth_path in MCP tools/list output");
    const authPathProperties = (
      authPathTool.inputSchema as { properties?: Record<string, unknown> } | undefined
    )?.properties;
    assert.ok(authPathProperties?.route != null, "expected auth_path MCP schema to expose route");
    assert.ok(authPathProperties?.file != null, "expected auth_path MCP schema to expose file");
    assert.ok(authPathProperties?.feature != null, "expected auth_path MCP schema to expose feature");

    // Phase 3: verify all 6 DB tools are exposed in the MCP tool manifest with outputSchema.
    for (const dbToolName of ["db_ping", "db_columns", "db_fk", "db_rls", "db_rpc", "db_table_schema"]) {
      assert.ok(
        mcpTools.tools.some((tool) => tool.name === dbToolName && tool.outputSchema != null),
        `expected ${dbToolName} in MCP tools/list output with outputSchema`,
      );
    }
    for (const actionToolName of ["file_write", "file_edit", "create_file", "delete_file", "apply_patch", "shell_run"]) {
      assert.ok(
        mcpTools.tools.some(
          (tool) =>
            tool.name === actionToolName &&
            (tool._meta as { requiresApproval?: boolean } | undefined)?.requiresApproval === true,
        ),
        `expected ${actionToolName} in MCP tools/list output with _meta.requiresApproval=true`,
      );
    }

    const mcpToolResult = await mcpClient.callTool({
      name: "symbols_of",
      arguments: {
        projectId: attachResult.project.projectId,
        file: "services/api/src/server.ts",
      },
    });
    assert.equal(mcpToolResult.isError, undefined);
    assert.ok(
      Array.isArray((mcpToolResult.structuredContent as { symbols?: unknown[] }).symbols),
      "expected structured symbols output from MCP tool call",
    );

    const mcpSessionProjectResult = await mcpClient.callTool({
      name: "symbols_of",
      arguments: {
        file: "services/api/src/server.ts",
      },
    });
    assert.equal(mcpSessionProjectResult.isError, undefined);
    assert.equal(
      (mcpSessionProjectResult.structuredContent as { projectId: string }).projectId,
      attachResult.project.projectId,
      "expected session active project to resolve follow-up MCP tool calls",
    );

    const mcpToolSearchResult = await mcpClient.callTool({
      name: "tool_search",
      arguments: {
        query: "ask auth file_write",
      },
    });
    assert.equal(mcpToolSearchResult.isError, undefined);
    const mcpToolSearchData = mcpToolSearchResult.structuredContent as {
      query: string;
      count: number;
      results: Array<{
        name: string;
        family: string;
        availability: string;
        reason: string | null;
      }>;
    };
    assert.equal(mcpToolSearchData.query, "ask auth file_write");
    assert.ok(
      mcpToolSearchData.results.some(
        (result) =>
          result.name === "ask" &&
          result.family === "registry" &&
          result.availability === "immediate",
      ),
      "expected tool_search to surface the MCP-visible ask tool",
    );
    assert.ok(
      mcpToolSearchData.results.some(
        (result) =>
          result.name === "file_write" &&
          result.family === "action" &&
          result.availability === "blocked",
      ),
      "expected tool_search to surface blocked action tools for MCP callers",
    );

    let currentRoots = [repoRoot];
    const mcpRootsClient = new Client(
      { name: "mako-smoke-roots", version: "0.1.0" },
      { capabilities: { roots: { listChanged: true } } },
    );
    const mcpRootsTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    mcpRootsClient.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: currentRoots.map((root, index) => ({ uri: pathToFileURL(root).href, name: `root-${index}` })),
    }));
    await mcpRootsClient.connect(mcpRootsTransport);
    const mcpRootsResult = await mcpRootsClient.callTool({
      name: "symbols_of",
      arguments: {
        file: "services/api/src/server.ts",
      },
    });
    assert.equal(mcpRootsResult.isError, undefined);
    assert.equal(
      (mcpRootsResult.structuredContent as { projectId: string }).projectId,
      attachResult.project.projectId,
      "expected MCP roots to resolve an attached project without explicit args",
    );

    currentRoots = [secondaryProjectRoot];
    const mcpRootsSwitchResult = await mcpRootsClient.callTool({
      name: "symbols_of",
      arguments: {
        file: "src/main.tsx",
      },
    });
    assert.equal(mcpRootsSwitchResult.isError, undefined);
    assert.equal(
      (mcpRootsSwitchResult.structuredContent as { projectId: string }).projectId,
      secondaryAttachResult.project.projectId,
      "expected MCP roots resolution to follow the current roots instead of auto-pinning the previous project",
    );
    await mcpRootsClient.close();

    const mcpCwdClient = new Client({ name: "mako-smoke-cwd", version: "0.1.0" });
    const mcpCwdTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    await mcpCwdClient.connect(mcpCwdTransport);
    const mcpCwdResult = await mcpCwdClient.callTool({
      name: "symbols_of",
      arguments: {
        file: "services/api/src/server.ts",
      },
      _meta: {
        cwd: repoRoot,
      },
    });
    assert.equal(mcpCwdResult.isError, undefined);
    assert.equal(
      (mcpCwdResult.structuredContent as { projectId: string }).projectId,
      attachResult.project.projectId,
      "expected MCP _meta.cwd to resolve an attached project without explicit args",
    );
    await mcpCwdClient.close();

    const originalManifest = readFileSync(attachResult.manifestPath, "utf8");
    try {
      writeFileSync(attachResult.manifestPath, "{invalid", "utf8");
      const invalidManifestStatus = await fetchJson(
        `${baseUrl}/api/v1/projects/status?ref=${encodeURIComponent(attachResult.project.projectId)}`,
      );
      assert.equal(invalidManifestStatus.status, 422);
      assert.equal(
        (invalidManifestStatus.body as { error: { code: string } }).error.code,
        "project_manifest_invalid",
      );
    } finally {
      writeFileSync(attachResult.manifestPath, originalManifest, "utf8");
    }

    // detach_target_ambiguous: force two attached projects to match the same reference path
    // with equal matchLength by aliasing the primary's last_seen_path onto the secondary's
    // canonical path. This is the only branch in detach.ts that returns a 409, and it is
    // otherwise hard to trigger from the CLI without this targeted injection.
    const ambiguousReferencePath = normalizePath(realpathSync(secondaryProjectRoot));
    const ambiguousSetupStore = openGlobalStore({ stateDirName });
    try {
      ambiguousSetupStore.db
        .prepare("UPDATE projects SET last_seen_path = ? WHERE project_id = ?")
        .run(ambiguousReferencePath, attachResult.project.projectId);
    } finally {
      ambiguousSetupStore.close();
    }
    try {
      const ambiguousDetach = await fetchJson(`${baseUrl}/api/v1/projects/detach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectRef: ambiguousReferencePath }),
      });
      assert.equal(ambiguousDetach.status, 409);
      assert.equal(
        (ambiguousDetach.body as { error: { code: string } }).error.code,
        "detach_target_ambiguous",
      );
      const ambiguousCandidates =
        (ambiguousDetach.body as {
          error: { details?: { candidates?: Array<{ projectId: string }> } };
        }).error.details?.candidates ?? [];
      const ambiguousCandidateIds = ambiguousCandidates
        .map((candidate) => candidate.projectId)
        .sort();
      assert.deepEqual(
        ambiguousCandidateIds,
        [attachResult.project.projectId, secondaryAttachResult.project.projectId].sort(),
        "expected both projects in detach_target_ambiguous candidate list",
      );
    } finally {
      const ambiguousRevertStore = openGlobalStore({ stateDirName });
      try {
        ambiguousRevertStore.db
          .prepare("UPDATE projects SET last_seen_path = canonical_path WHERE project_id = ?")
          .run(attachResult.project.projectId);
      } finally {
        ambiguousRevertStore.close();
      }
    }

    // Phase 3 negative-path: DB tools must surface the project-binding error
    // instead of crashing the server when the project's live binding cannot be
    // resolved on this process.
    const dbPingDisconnected = await fetchJson(`${baseUrl}/api/v1/tools/db_ping`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: attachResult.project.projectId }),
    });

    assert.equal(dbPingDisconnected.status, 422);
    assert.equal((dbPingDisconnected.body as { ok: boolean }).ok, false);
    assert.equal(
      (dbPingDisconnected.body as { error: { code: string } }).error.code,
      "db_binding_invalid",
    );
    assert.match(
      (dbPingDisconnected.body as { error: { message: string } }).error.message,
      /MAKO_TEST_DATABASE_URL/,
    );

    const dbColumnsDisconnected = await fetchJson(`${baseUrl}/api/v1/tools/db_columns`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: attachResult.project.projectId, table: "any_table" }),
    });

    assert.equal(dbColumnsDisconnected.status, 422);
    assert.equal(
      (dbColumnsDisconnected.body as { error: { code: string } }).error.code,
      "db_binding_invalid",
    );

    const dbFkDisconnected = await fetchJson(`${baseUrl}/api/v1/tools/db_fk`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: attachResult.project.projectId, table: "any_table" }),
    });
    assert.equal(dbFkDisconnected.status, 422);
    assert.equal(
      (dbFkDisconnected.body as { error: { code: string } }).error.code,
      "db_binding_invalid",
    );

    const dbRlsDisconnected = await fetchJson(`${baseUrl}/api/v1/tools/db_rls`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: attachResult.project.projectId, table: "any_table" }),
    });
    assert.equal(dbRlsDisconnected.status, 422);
    assert.equal(
      (dbRlsDisconnected.body as { error: { code: string } }).error.code,
      "db_binding_invalid",
    );

    const dbRpcDisconnected = await fetchJson(`${baseUrl}/api/v1/tools/db_rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: attachResult.project.projectId, name: "any_function" }),
    });
    assert.equal(dbRpcDisconnected.status, 422);
    assert.equal(
      (dbRpcDisconnected.body as { error: { code: string } }).error.code,
      "db_binding_invalid",
    );

    const dbTableSchemaDisconnected = await fetchJson(`${baseUrl}/api/v1/tools/db_table_schema`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: attachResult.project.projectId, table: "any_table" }),
    });
    assert.equal(dbTableSchemaDisconnected.status, 422);
    assert.equal(
      (dbTableSchemaDisconnected.body as { error: { code: string } }).error.code,
      "db_binding_invalid",
    );

    // Phase 3: disabled flag should still short-circuit before project binding resolution.
    const disabledServer = await startHttpApiServer({
      host: "127.0.0.1",
      port: 0,
      configOverrides: {
        stateDirName,
        databaseTools: { enabled: false },
      },
    });

    try {
      const disabledBaseUrl = `http://${disabledServer.host}:${disabledServer.port}`;
      const dbPingDisabled = await fetchJson(`${disabledBaseUrl}/api/v1/tools/db_ping`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: attachResult.project.projectId }),
      });
      assert.equal(dbPingDisabled.status, 412);
      assert.equal(
        (dbPingDisabled.body as { error: { code: string } }).error.code,
        "db_not_connected",
      );
      assert.match(
        (dbPingDisabled.body as { error: { message: string } }).error.message,
        /MAKO_DB_TOOLS_ENABLED/,
      );
    } finally {
      await disabledServer.close();
    }

    const invalidJson = await fetchJson(`${baseUrl}/api/v1/projects/attach`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{invalid",
    });

    assert.equal(invalidJson.status, 400);
    assert.equal((invalidJson.body as { ok: boolean }).ok, false);
    assert.equal((invalidJson.body as { requestId: string }).requestId, invalidJson.requestId);
    assert.equal(
      (invalidJson.body as { error: { code: string } }).error.code,
      "invalid_json",
    );

    const missingProjectPath = path.join(repoRoot, "__missing_smoke_project__", `${Date.now()}`);
    const unexpectedFailure = await fetchJson(`${baseUrl}/api/v1/projects/attach`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectRoot: missingProjectPath,
      }),
    });

    assert.equal(unexpectedFailure.status, 400);
    assert.equal((unexpectedFailure.body as { ok: boolean }).ok, false);
    assert.equal(
      (unexpectedFailure.body as { requestId: string }).requestId,
      unexpectedFailure.requestId,
    );
    assert.equal(
      (unexpectedFailure.body as { error: { code: string } }).error.code,
      "not_a_project_path",
    );
    assert.match(
      (unexpectedFailure.body as { error: { message: string } }).error.message,
      /Project path does not exist:/,
    );

    await mcpClient.close();

    // Phase 3 positive-path: gated behind MAKO_TEST_DATABASE_URL so local dev doesn't
    // require a running Postgres, but CI can exercise the full catalog query path.
    const testDatabaseUrl = process.env.MAKO_TEST_DATABASE_URL;
    if (testDatabaseUrl && testDatabaseUrl.trim() !== "") {
      const dbServer = await startHttpApiServer({
        host: "127.0.0.1",
        port: 0,
        configOverrides: {
          stateDirName,
          databaseTools: { enabled: true },
        },
      });

      try {
      const dbBaseUrl = `http://${dbServer.host}:${dbServer.port}`;
      const dbToolLocator = { projectId: attachResult.project.projectId };
      const dbMcpClient = new Client({ name: "mako-smoke-db", version: "0.1.0" });
        const dbMcpTransport = new StreamableHTTPClientTransport(new URL(`${dbBaseUrl}/mcp`));

        const expectedStudyTrackColumns = [
          {
            name: "id",
            type: "bigint",
            nullable: false,
            default: null,
            isPrimaryKey: true,
            isIdentity: true,
            comment: null,
          },
          {
            name: "course_id",
            type: "uuid",
            nullable: false,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "slug",
            type: "text",
            nullable: false,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "title",
            type: "text",
            nullable: false,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "level",
            type: "integer",
            nullable: false,
            default: "1",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "published",
            type: "boolean",
            nullable: false,
            default: "false",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "created_at",
            type: "timestamp with time zone",
            nullable: false,
            default: "now()",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
        ];
        const expectedStudyTrackOutbound = [
          {
            constraintName: "study_tracks_course_id_fkey",
            columns: ["course_id"],
            targetSchema: "public",
            targetTable: "courses",
            targetColumns: ["id"],
            onUpdate: "CASCADE",
            onDelete: "RESTRICT",
          },
        ];
        const expectedStudyTrackInbound = [
          {
            constraintName: "study_sessions_study_track_id_fkey",
            sourceSchema: "public",
            sourceTable: "study_sessions",
            sourceColumns: ["study_track_id"],
            columns: ["id"],
            onUpdate: "CASCADE",
            onDelete: "CASCADE",
          },
        ];
        const expectedStudyTrackPolicies = await loadExpectedPolicies(
          phase3LiveDatabaseUrl!,
          "public",
          "study_tracks",
        );
        const expectedStudyTrackIndexes = [
          {
            name: "study_tracks_pkey",
            unique: true,
            primary: true,
            columns: ["id"],
            definition: "CREATE UNIQUE INDEX study_tracks_pkey ON public.study_tracks USING btree (id)",
          },
          {
            name: "study_tracks_slug_key",
            unique: true,
            primary: false,
            columns: ["slug"],
            definition: "CREATE UNIQUE INDEX study_tracks_slug_key ON public.study_tracks USING btree (slug)",
          },
          {
            name: "study_tracks_title_lower_idx",
            unique: false,
            primary: false,
            columns: [],
            definition: "CREATE INDEX study_tracks_title_lower_idx ON public.study_tracks USING btree (lower(title))",
          },
        ];
        const expectedPublicStudyTrackBadgeCandidates = [
          {
            schema: "public",
            name: "study_track_badge",
            kind: "function",
            argTypes: ["text"],
            signature: "study_track_badge(track_slug text)",
          },
          {
            schema: "public",
            name: "study_track_badge",
            kind: "function",
            argTypes: ["text", "integer"],
            signature: "study_track_badge(track_slug text, cohort_year integer)",
          },
        ];
        const expectedCrossSchemaStudyTrackBadgeCandidates = [
          {
            schema: "hogwarts_smoke_shadow",
            name: "study_track_badge",
            kind: "function",
            argTypes: ["text", "integer"],
            signature: "study_track_badge(track_slug text, cohort_year integer)",
          },
          ...expectedPublicStudyTrackBadgeCandidates,
        ];
        const expectedCourseColumns = [
          {
            name: "id",
            type: "uuid",
            nullable: false,
            default: "uuid_generate_v4()",
            isPrimaryKey: true,
            isIdentity: false,
            comment: null,
          },
          {
            name: "code",
            type: "character varying(20)",
            nullable: false,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "name",
            type: "character varying(100)",
            nullable: false,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "short_description",
            type: "text",
            nullable: true,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "full_description",
            type: "text",
            nullable: true,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "course_type",
            type: "course_type",
            nullable: false,
            default: "'core'::course_type",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "professor_id",
            type: "uuid",
            nullable: true,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "classroom",
            type: "character varying(100)",
            nullable: true,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "schedule",
            type: "text",
            nullable: true,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "credits",
            type: "integer",
            nullable: false,
            default: "1",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "min_year",
            type: "integer",
            nullable: false,
            default: "1",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "max_year",
            type: "integer",
            nullable: false,
            default: "7",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "required_materials",
            type: "text[]",
            nullable: true,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "syllabus_url",
            type: "text",
            nullable: true,
            default: null,
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "is_active",
            type: "boolean",
            nullable: false,
            default: "true",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "created_at",
            type: "timestamp with time zone",
            nullable: false,
            default: "now()",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
          {
            name: "updated_at",
            type: "timestamp with time zone",
            nullable: false,
            default: "now()",
            isPrimaryKey: false,
            isIdentity: false,
            comment: null,
          },
        ];
        const expectedCourseOutbound = [
          {
            constraintName: "courses_professor_id_fkey",
            columns: ["professor_id"],
            targetSchema: "public",
            targetTable: "professors",
            targetColumns: ["id"],
            onUpdate: "NO ACTION",
            onDelete: "SET NULL",
          },
        ];
        const expectedCourseInbound = [
          {
            constraintName: "assignments_course_id_fkey",
            sourceSchema: "public",
            sourceTable: "assignments",
            sourceColumns: ["course_id"],
            columns: ["id"],
            onUpdate: "NO ACTION",
            onDelete: "CASCADE",
          },
          {
            constraintName: "course_prerequisites_course_id_fkey",
            sourceSchema: "public",
            sourceTable: "course_prerequisites",
            sourceColumns: ["course_id"],
            columns: ["id"],
            onUpdate: "NO ACTION",
            onDelete: "CASCADE",
          },
          {
            constraintName: "course_prerequisites_prerequisite_course_id_fkey",
            sourceSchema: "public",
            sourceTable: "course_prerequisites",
            sourceColumns: ["prerequisite_course_id"],
            columns: ["id"],
            onUpdate: "NO ACTION",
            onDelete: "CASCADE",
          },
          {
            constraintName: "enrollments_course_id_fkey",
            sourceSchema: "public",
            sourceTable: "enrollments",
            sourceColumns: ["course_id"],
            columns: ["id"],
            onUpdate: "NO ACTION",
            onDelete: "CASCADE",
          },
          {
            constraintName: "potion_brewing_sessions_course_id_fkey",
            sourceSchema: "public",
            sourceTable: "potion_brewing_sessions",
            sourceColumns: ["course_id"],
            columns: ["id"],
            onUpdate: "NO ACTION",
            onDelete: "SET NULL",
          },
          {
            constraintName: "study_tracks_course_id_fkey",
            sourceSchema: "public",
            sourceTable: "study_tracks",
            sourceColumns: ["course_id"],
            columns: ["id"],
            onUpdate: "CASCADE",
            onDelete: "RESTRICT",
          },
        ];
        const expectedCoursePolicies = await loadExpectedPolicies(
          phase3LiveDatabaseUrl!,
          "public",
          "courses",
        );

        await dbMcpClient.connect(dbMcpTransport);

        const dbPingOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_ping`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(dbToolLocator),
        });
        assert.equal(dbPingOk.status, 200);
        const dbPingData = (dbPingOk.body as {
          data: {
            connected: boolean;
            platform: string;
            database: string;
            serverVersion: string;
            currentUser: string;
            readOnly: boolean;
            schemas: string[];
          };
        }).data;
        assert.deepEqual(
          {
            connected: dbPingData.connected,
            platform: dbPingData.platform,
            database: dbPingData.database,
            currentUser: dbPingData.currentUser,
            readOnly: dbPingData.readOnly,
          },
          {
            connected: true,
            platform: "supabase",
            database: "postgres",
            currentUser: "postgres",
            readOnly: true,
          },
        );
        assert.match(dbPingData.serverVersion, /^17\./);
        assert.ok(Array.isArray(dbPingData.schemas), "expected schemas array");
        for (const requiredSchema of ["auth", "storage", "supabase_functions", "public", "hogwarts_smoke_shadow"]) {
          assert.ok(dbPingData.schemas.includes(requiredSchema), `expected schema ${requiredSchema} in db_ping output`);
        }

        const dbPingMcp = await dbMcpClient.callTool({ name: "db_ping", arguments: dbToolLocator });
        assert.equal(dbPingMcp.isError, undefined);
        assert.deepEqual(
          dbPingMcp.structuredContent,
          {
            toolName: "db_ping",
            connected: true,
            platform: "supabase",
            database: "postgres",
            serverVersion: dbPingData.serverVersion,
            currentUser: "postgres",
            readOnly: true,
            schemas: dbPingData.schemas,
          },
        );

        // Pin an exact catalog slice so Phase 3 regressions surface as assertion failures.
        const dbColumnsOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_columns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "public.study_tracks" }),
        });
        assert.equal(dbColumnsOk.status, 200);
        const dbColumnsData = (dbColumnsOk.body as {
          data: { table: string; schema: string; columns: typeof expectedStudyTrackColumns };
        }).data;
        assert.deepEqual(
          {
            table: dbColumnsData.table,
            schema: dbColumnsData.schema,
            columns: dbColumnsData.columns,
          },
          {
            table: "study_tracks",
            schema: "public",
            columns: expectedStudyTrackColumns,
          },
        );

        const dbColumnsConflict = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_columns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "public.study_tracks", schema: "hogwarts_smoke_shadow" }),
        });
        assert.equal(dbColumnsConflict.status, 400);
        assert.equal(
          (dbColumnsConflict.body as { error: { code: string } }).error.code,
          "invalid_tool_input",
        );
        assert.deepEqual(
          (dbColumnsConflict.body as { error: { details?: { issues?: Array<{ path: string; message: string }> } } }).error.details?.issues,
          [
            {
              path: "schema",
              message: "Conflicting schema inputs: `table` specifies schema `public` but `schema` is `hogwarts_smoke_shadow`.",
            },
          ],
        );

        const dbFkOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_fk`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "study_tracks", schema: "public" }),
        });
        assert.equal(dbFkOk.status, 200);
        const dbFkData = (dbFkOk.body as {
          data: {
            table: string;
            schema: string;
            outbound: typeof expectedStudyTrackOutbound;
            inbound: typeof expectedStudyTrackInbound;
          };
        }).data;
        assert.deepEqual(
          {
            table: dbFkData.table,
            schema: dbFkData.schema,
            outbound: dbFkData.outbound,
            inbound: dbFkData.inbound,
          },
          {
            table: "study_tracks",
            schema: "public",
            outbound: expectedStudyTrackOutbound,
            inbound: expectedStudyTrackInbound,
          },
        );

        const dbRlsOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_rls`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "study_tracks", schema: "public" }),
        });
        assert.equal(dbRlsOk.status, 200);
        const dbRlsData = (dbRlsOk.body as {
          data: {
            table: string;
            schema: string;
            rlsEnabled: boolean;
            forceRls: boolean;
            policies: typeof expectedStudyTrackPolicies;
          };
        }).data;
        assert.deepEqual(
          {
            table: dbRlsData.table,
            schema: dbRlsData.schema,
            rlsEnabled: dbRlsData.rlsEnabled,
            forceRls: dbRlsData.forceRls,
            policies: dbRlsData.policies,
          },
          {
            table: "study_tracks",
            schema: "public",
            rlsEnabled: true,
            forceRls: true,
            policies: expectedStudyTrackPolicies,
          },
        );

        const dbRpcOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, name: "public.study_track_badge", argTypes: ["text", "integer"] }),
        });
        assert.equal(dbRpcOk.status, 200);
        const dbRpcData = (dbRpcOk.body as {
          data: {
            toolName: string;
            name: string;
            schema: string;
            args: Array<{ name: string | null; type: string; mode: string }>;
            returns: string;
            language: string;
            securityDefiner: boolean;
            volatility: string;
            source: string | null;
          };
        }).data;
        assert.deepEqual(
          dbRpcData,
          {
            toolName: "db_rpc",
            name: "study_track_badge",
            schema: "public",
            args: [
              { name: "track_slug", type: "text", mode: "in" },
              { name: "cohort_year", type: "integer", mode: "in" },
            ],
            returns: "text",
            language: "sql",
            securityDefiner: true,
            volatility: "stable",
            source: null,
          },
        );

        const dbRpcMcp = await dbMcpClient.callTool({
          name: "db_rpc",
          arguments: { ...dbToolLocator, name: "public.study_track_badge", argTypes: ["text", "integer"] },
        });
        assert.equal(dbRpcMcp.isError, undefined);
        assert.deepEqual(dbRpcMcp.structuredContent, dbRpcData);

        const dbRpcSameSchemaAmbiguous = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, name: "study_track_badge", schema: "public" }),
        });
        assert.equal(dbRpcSameSchemaAmbiguous.status, 400);
        assert.equal(
          (dbRpcSameSchemaAmbiguous.body as { error: { code: string } }).error.code,
          "db_ambiguous_object",
        );
        const dbRpcSameSchemaAmbiguousDetails = (dbRpcSameSchemaAmbiguous.body as {
          error: {
            details?: {
              requested?: { schema: string | null; name: string; argTypes?: string[] };
              candidates?: typeof expectedPublicStudyTrackBadgeCandidates;
            };
          };
        }).error.details;
        assert.deepEqual(dbRpcSameSchemaAmbiguousDetails?.requested, {
          schema: "public",
          name: "study_track_badge",
        });
        assert.deepEqual(
          [...(dbRpcSameSchemaAmbiguousDetails?.candidates ?? [])].sort((left, right) => left.signature.localeCompare(right.signature)),
          [...expectedPublicStudyTrackBadgeCandidates].sort((left, right) => left.signature.localeCompare(right.signature)),
        );

        const dbRpcSourceOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...dbToolLocator,
            name: "public.study_track_badge",
            argTypes: ["text", "integer"],
            includeSource: true,
          }),
        });
        assert.equal(dbRpcSourceOk.status, 200);
        const dbRpcSourceData = (dbRpcSourceOk.body as {
          data: {
            source: string | null;
          };
        }).data;
        assert.equal(
          dbRpcSourceData.source,
          "\n    SELECT track_slug || '-' || cohort_year::text || '-owl';\n",
        );

        const dbTableSchemaOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_table_schema`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "public.study_tracks" }),
        });
        assert.equal(dbTableSchemaOk.status, 200);
        const dbTableSchemaData = (dbTableSchemaOk.body as {
          data: {
            table: string;
            schema: string;
            columns: typeof expectedStudyTrackColumns;
            indexes: Array<{
              name: string;
              unique: boolean;
              primary: boolean;
              columns: string[];
              definition: string | null;
            }>;
            constraints: Array<{ name: string; type: string; definition: string | null }>;
            foreignKeys: { outbound: typeof expectedStudyTrackOutbound; inbound: typeof expectedStudyTrackInbound };
            rls: { rlsEnabled: boolean; forceRls: boolean; policies: typeof expectedStudyTrackPolicies };
            triggers: Array<unknown>;
          };
        }).data;
        assert.equal(dbTableSchemaData.table, "study_tracks");
        assert.equal(dbTableSchemaData.schema, "public");
        assert.deepEqual(dbTableSchemaData.columns, dbColumnsData.columns);
        assert.deepEqual(dbTableSchemaData.foreignKeys, {
          outbound: dbFkData.outbound,
          inbound: dbFkData.inbound,
        });
        assert.deepEqual(dbTableSchemaData.rls, {
          rlsEnabled: dbRlsData.rlsEnabled,
          forceRls: dbRlsData.forceRls,
          policies: dbRlsData.policies,
        });
        assert.deepEqual(dbTableSchemaData.indexes, expectedStudyTrackIndexes);
        assert.deepEqual(dbTableSchemaData.constraints, [
          {
            name: "study_tracks_course_id_fkey",
            type: "FOREIGN KEY",
            definition: "FOREIGN KEY (course_id) REFERENCES courses(id) ON UPDATE CASCADE ON DELETE RESTRICT",
          },
          {
            name: "study_tracks_pkey",
            type: "PRIMARY KEY",
            definition: "PRIMARY KEY (id)",
          },
          {
            name: "study_tracks_slug_key",
            type: "UNIQUE",
            definition: "UNIQUE (slug)",
          },
        ]);
        assert.deepEqual(dbTableSchemaData.triggers, []);

        const dbCoursesColumnsOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_columns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "courses", schema: "public" }),
        });
        assert.equal(dbCoursesColumnsOk.status, 200);
        const dbCoursesColumnsData = (dbCoursesColumnsOk.body as {
          data: { toolName: string; table: string; schema: string; columns: typeof expectedCourseColumns };
        }).data;
        assert.deepEqual(dbCoursesColumnsData, {
          toolName: "db_columns",
          table: "courses",
          schema: "public",
          columns: expectedCourseColumns,
        });

        const dbCoursesFkOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_fk`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "courses", schema: "public" }),
        });
        assert.equal(dbCoursesFkOk.status, 200);
        const dbCoursesFkData = (dbCoursesFkOk.body as {
          data: {
            toolName: string;
            table: string;
            schema: string;
            outbound: typeof expectedCourseOutbound;
            inbound: typeof expectedCourseInbound;
          };
        }).data;
        assert.deepEqual(dbCoursesFkData, {
          toolName: "db_fk",
          table: "courses",
          schema: "public",
          outbound: expectedCourseOutbound,
          inbound: expectedCourseInbound,
        });

        const dbCoursesRlsOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_rls`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "courses", schema: "public" }),
        });
        assert.equal(dbCoursesRlsOk.status, 200);
        const dbCoursesRlsData = (dbCoursesRlsOk.body as {
          data: {
            toolName: string;
            table: string;
            schema: string;
            rlsEnabled: boolean;
            forceRls: boolean;
            policies: typeof expectedCoursePolicies;
          };
        }).data;
        assert.deepEqual(dbCoursesRlsData, {
          toolName: "db_rls",
          table: "courses",
          schema: "public",
          rlsEnabled: true,
          forceRls: false,
          policies: expectedCoursePolicies,
        });

        const dbStudentProfileRpcOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, name: "get_student_profile", schema: "public" }),
        });
        assert.equal(dbStudentProfileRpcOk.status, 200);
        const dbStudentProfileRpcData = (dbStudentProfileRpcOk.body as {
          data: {
            toolName: string;
            name: string;
            schema: string;
            args: Array<{ name: string | null; type: string; mode: string }>;
            returns: string;
            language: string;
            securityDefiner: boolean;
            volatility: string;
            source: string | null;
          };
        }).data;
        assert.deepEqual(dbStudentProfileRpcData, {
          toolName: "db_rpc",
          name: "get_student_profile",
          schema: "public",
          args: [
            { name: "p_student_id", type: "uuid", mode: "in" },
            { name: "student_id", type: "uuid", mode: "table" },
            { name: "full_name", type: "text", mode: "table" },
            { name: "house_name", type: "house_type", mode: "table" },
            { name: "year", type: "integer", mode: "table" },
            { name: "blood_status", type: "blood_status", mode: "table" },
            { name: "wand_info", type: "text", mode: "table" },
            { name: "total_points", type: "integer", mode: "table" },
            { name: "current_enrollments", type: "bigint", mode: "table" },
            { name: "gpa", type: "numeric", mode: "table" },
          ],
          returns:
            "TABLE(student_id uuid, full_name text, house_name house_type, year integer, blood_status blood_status, wand_info text, total_points integer, current_enrollments bigint, gpa numeric)",
          language: "plpgsql",
          securityDefiner: true,
          volatility: "volatile",
          source: null,
        });

        const dbStudentProfileRpcMcp = await dbMcpClient.callTool({
          name: "db_rpc",
          arguments: { ...dbToolLocator, name: "get_student_profile", schema: "public" },
        });
        assert.equal(dbStudentProfileRpcMcp.isError, undefined);
        assert.deepEqual(dbStudentProfileRpcMcp.structuredContent, dbStudentProfileRpcData);

        const dbStudentProfileRpcSourceOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, name: "get_student_profile", schema: "public", includeSource: true }),
        });
        assert.equal(dbStudentProfileRpcSourceOk.status, 200);
        const dbStudentProfileRpcSource = (dbStudentProfileRpcSourceOk.body as {
          data: { source: string | null };
        }).data.source;
        assert.ok(dbStudentProfileRpcSource != null && dbStudentProfileRpcSource.length > 0, "expected RPC source");
        assert.match(dbStudentProfileRpcSource ?? "", /RETURN QUERY/);
        assert.match(dbStudentProfileRpcSource ?? "", /FROM students s/);
        assert.match(dbStudentProfileRpcSource ?? "", /WHERE s.id = p_student_id;/);

        const dbProcedureOk = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, name: "refresh_study_track_badges", schema: "public" }),
        });
        assert.equal(dbProcedureOk.status, 200);
        const dbProcedureData = (dbProcedureOk.body as {
          data: {
            toolName: string;
            name: string;
            schema: string;
            args: Array<{ name: string | null; type: string; mode: string }>;
            returns: string;
            language: string;
            securityDefiner: boolean;
            volatility: string;
            source: string | null;
          };
        }).data;
        assert.deepEqual(dbProcedureData, {
          toolName: "db_rpc",
          name: "refresh_study_track_badges",
          schema: "public",
          args: [{ name: "track_slug", type: "text", mode: "in" }],
          returns: "procedure",
          language: "plpgsql",
          securityDefiner: false,
          volatility: "volatile",
          source: null,
        });

        const dbProcedureMcp = await dbMcpClient.callTool({
          name: "db_rpc",
          arguments: { ...dbToolLocator, name: "refresh_study_track_badges", schema: "public" },
        });
        assert.equal(dbProcedureMcp.isError, undefined);
        assert.deepEqual(dbProcedureMcp.structuredContent, dbProcedureData);

        const dbColumnsAmbiguous = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_columns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "study_tracks" }),
        });
        assert.equal(dbColumnsAmbiguous.status, 400);
        assert.equal(
          (dbColumnsAmbiguous.body as { error: { code: string } }).error.code,
          "db_ambiguous_object",
        );
        const dbColumnsAmbiguousCandidates = [
          ...((dbColumnsAmbiguous.body as {
            error: { details?: { candidates?: Array<{ schema: string; name: string; kind: string }> } };
          }).error.details?.candidates ?? []),
        ].sort((left, right) => left.schema.localeCompare(right.schema));
        assert.deepEqual(dbColumnsAmbiguousCandidates, [
          { schema: "hogwarts_smoke_shadow", name: "study_tracks", kind: "table" },
          { schema: "public", name: "study_tracks", kind: "table" },
        ]);

        const dbRpcAmbiguous = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, name: "study_track_badge" }),
        });
        assert.equal(dbRpcAmbiguous.status, 400);
        assert.equal(
          (dbRpcAmbiguous.body as { error: { code: string } }).error.code,
          "db_ambiguous_object",
        );
        const dbRpcAmbiguousCandidates = [
          ...((dbRpcAmbiguous.body as {
            error: {
              details?: {
                candidates?: Array<{
                  schema: string;
                  name: string;
                  kind: string;
                  argTypes: string[];
                  signature: string;
                }>;
              };
            };
          }).error.details?.candidates ?? []),
        ].sort((left, right) => left.schema.localeCompare(right.schema) || left.signature.localeCompare(right.signature));
        assert.deepEqual(
          dbRpcAmbiguousCandidates,
          [...expectedCrossSchemaStudyTrackBadgeCandidates].sort(
            (left, right) => left.schema.localeCompare(right.schema) || left.signature.localeCompare(right.signature),
          ),
        );

        // db_object_not_found for a guaranteed-missing table.
        const dbColumnsMissing = await fetchJson(`${dbBaseUrl}/api/v1/tools/db_columns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...dbToolLocator, table: "__mako_smoke_missing_table__", schema: "public" }),
        });
        assert.equal(dbColumnsMissing.status, 404);
        assert.equal(
          (dbColumnsMissing.body as { error: { code: string } }).error.code,
          "db_object_not_found",
        );
        assert.equal(
          (dbColumnsMissing.body as { error: { details?: { requested?: { name?: string } } } }).error.details
            ?.requested?.name,
          "__mako_smoke_missing_table__",
        );
        await dbMcpClient.close();
      } finally {
        await dbServer.close();
      }
    }
  } finally {
    await server.close();
    teardownState();
  }
}

void main().catch((error: unknown) => {
  teardownState();
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
