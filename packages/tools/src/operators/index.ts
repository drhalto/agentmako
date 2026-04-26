import type {
  TenantLeakAuditBasis,
  ProjectProfile,
  SchemaRpc,
  SchemaSnapshot,
  SchemaSourceRef,
  SchemaTable,
  TenantLeakAuditFinding,
  TenantLeakAuditProtectedTable,
  TenantLeakAuditReviewedSurface,
  TenantLeakAuditResult,
  TenantLeakAuditSurfaceKind,
  TenantLeakAuditToolInput,
  TenantLeakAuditToolOutput,
} from "@mako-ai/contracts";
import { hashJson, type FunctionTableRef, type ProjectStore, type ResolvedRouteRecord, type ResolvedSchemaObjectRecord } from "@mako-ai/store";
import type { ProgressReporter } from "../progress/types.js";
import { withProjectContext, type ToolServiceOptions } from "../runtime.js";
import { ensureFreshSchemaSnapshot } from "../schema-freshness.js";

const DEFAULT_TENANT_SIGNAL_TOKENS = [
  "tenant_id",
  "tenantid",
  "workspace_id",
  "workspaceid",
  "organization_id",
  "organizationid",
  "org_id",
  "orgid",
  "account_id",
  "accountid",
];

const COMMON_TENANT_CONTEXT_PATTERNS = [
  /\bcurrent_tenant\s*\(/i,
  /\bcurrent_workspace\s*\(/i,
  /\bcurrent_organization\s*\(/i,
  /\bcurrent_account\s*\(/i,
  /\bauth\s*\.\s*jwt\s*\(/i,
  /\bcurrent_setting\s*\(\s*['"][^'"]*(tenant|workspace|organization|account)[^'"]*['"]/i,
];

const TENANT_LEAK_AUDIT_ROLLOUT_STAGE = "opt_in" as const;

interface ProtectedTableRecord {
  table: SchemaTable;
  protectedTable: TenantLeakAuditProtectedTable;
  tenantColumnsLower: string[];
}

interface RpcRecord {
  schema: string;
  rpc: SchemaRpc;
}

export async function tenantLeakAuditTool(
  input: TenantLeakAuditToolInput,
  options: ToolServiceOptions = {},
): Promise<TenantLeakAuditToolOutput> {
  return withProjectContext(input, options, async ({ project, profile, projectStore }) => {
    // Refresh the schema snapshot inline if it is stale and the project has a
    // live DB binding. Without this, audit findings may be computed against a
    // snapshot that is many revisions behind the live DB — the exact failure
    // mode where "RLS enabled but no policies" gets reported even though the
    // live DB has policies.
    const freshness = await ensureFreshSchemaSnapshot({
      projectId: project.projectId,
      projectRoot: project.canonicalPath,
      projectStore,
      freshen: input.freshen ?? true,
      toolOptions: options,
    });
    const result = await buildTenantLeakAuditResult(profile, projectStore, options.progressReporter);
    result.warnings = [...freshness.warnings, ...result.warnings];
    return {
      toolName: "tenant_leak_audit",
      projectId: project.projectId,
      result,
    };
  });
}

export async function buildTenantLeakAuditResult(
  profile: ProjectProfile | null,
  projectStore: ProjectStore,
  progressReporter?: ProgressReporter,
): Promise<TenantLeakAuditResult> {
  const snapshot = projectStore.loadSchemaSnapshot();
  const latestIndexRun = projectStore.getLatestIndexRun();
  const warnings: string[] = [];
  const tenantSignals = collectTenantSignals(profile);
  const basis = buildAuditBasis(latestIndexRun?.runId ?? null, snapshot);

  if (!profile?.authz?.tenantForeignKey) {
    warnings.push(
      "tenant leak audit is using fallback tenant signals because the project auth profile does not declare tenantForeignKey.",
    );
  }

  if (!snapshot) {
    warnings.push("tenant leak audit requires a schema snapshot; build or refresh the snapshot before relying on these findings.");
    await progressReporter?.report({
      stage: "table_iteration",
      message: "No schema snapshot available; no protected tables to review.",
      current: 0,
      total: 0,
    });
    await progressReporter?.report({
      stage: "finding_collect",
      message: "No schema snapshot available; no tenant findings to collect.",
      current: 0,
      total: 0,
    });
    return {
      advisoryOnly: true,
      rolloutStage: TENANT_LEAK_AUDIT_ROLLOUT_STAGE,
      basis,
      tenantSignals,
      protectedTables: [],
      findings: [],
      reviewedSurfaces: [],
      summary: {
        protectedTableCount: 0,
        directEvidenceCount: 0,
        weakSignalCount: 0,
        reviewedSurfaceCount: 0,
      },
      warnings,
    };
  }

  const protectedTables = collectProtectedTables(snapshot, tenantSignals);
  if (protectedTables.length === 0) {
    warnings.push("tenant leak audit found no tenant-keyed tables in the current schema snapshot.");
  }

  const findings: TenantLeakAuditFinding[] = [];
  const reviewedSurfaces: TenantLeakAuditReviewedSurface[] = [];
  const routesByFile = new Map(projectStore.listRoutes().map((route) => [route.filePath, route] as const));
  const schemaObjects = projectStore.listSchemaObjects();

  await progressReporter?.report({
    stage: "table_iteration",
    message: `Reviewing ${protectedTables.length} tenant-keyed table(s).`,
    current: 0,
    total: protectedTables.length,
  });
  for (let index = 0; index < protectedTables.length; index += 1) {
    const protectedTable = protectedTables[index];
    await progressReporter?.report({
      stage: "table_iteration",
      message: `Reviewing ${protectedTable.protectedTable.tableKey}.`,
      current: index + 1,
      total: protectedTables.length,
    });
    collectTableFindings({
      protectedTable,
      tenantSignals,
      findings,
      reviewedSurfaces,
    });
  }

  const functionTableRefs = projectStore.listFunctionTableRefs();
  await progressReporter?.report({
    stage: "finding_collect",
    message: `Collecting code/RPC findings from ${functionTableRefs.length} table reference(s).`,
    current: 0,
    total: functionTableRefs.length,
  });
  for (let index = 0; index < functionTableRefs.length; index += 1) {
    const ref = functionTableRefs[index];
    await progressReporter?.report({
      stage: "finding_collect",
      message: `Checking ${ref.targetSchema}.${ref.targetTable}.`,
      current: index + 1,
      total: functionTableRefs.length,
    });
    const protectedTable = protectedTables.find(
      (entry) =>
        entry.table.schema === ref.targetSchema &&
        entry.table.name === ref.targetTable,
    );
    if (!protectedTable) {
      continue;
    }

    const rpcRecord = findRpc(snapshot, ref);
    collectRpcFindings({
      ref,
      rpcRecord,
      protectedTable,
      schemaObjects,
      projectStore,
      routesByFile,
      tenantSignals,
      findings,
      reviewedSurfaces,
    });
  }

  const recommendedFollowOn = buildTenantLeakAuditFollowOnHint(findings);

  return {
    advisoryOnly: true,
    rolloutStage: TENANT_LEAK_AUDIT_ROLLOUT_STAGE,
    basis,
    tenantSignals,
    protectedTables: protectedTables.map((entry) => entry.protectedTable),
    findings: findings.sort(compareFindings),
    reviewedSurfaces: reviewedSurfaces.sort(compareReviewedSurfaces),
    ...(recommendedFollowOn ? { recommendedFollowOn } : {}),
    summary: {
      protectedTableCount: protectedTables.length,
      directEvidenceCount: findings.filter((entry) => entry.strength === "direct_evidence").length,
      weakSignalCount: findings.filter((entry) => entry.strength === "weak_signal").length,
      reviewedSurfaceCount: reviewedSurfaces.length,
    },
    warnings,
  };
}

function buildTenantLeakAuditFollowOnHint(
  findings: readonly TenantLeakAuditFinding[],
): NonNullable<TenantLeakAuditResult["recommendedFollowOn"]> | null {
  const directEvidenceCount = findings.filter((entry) => entry.strength === "direct_evidence").length;
  const weakSignalCount = findings.filter((entry) => entry.strength === "weak_signal").length;

  if (directEvidenceCount > 0) {
    return {
      toolName: "workflow_packet",
      family: "implementation_brief",
      reason:
        directEvidenceCount === 1
          ? "turn the direct tenant-protection gap into one implementation brief with concrete remediation and verification guidance"
          : `turn the ${directEvidenceCount} direct tenant-protection gaps into one implementation brief with concrete remediation and verification guidance`,
    };
  }

  if (weakSignalCount > 0) {
    return {
      toolName: "workflow_packet",
      family: "verification_plan",
      reason:
        weakSignalCount === 1
          ? "turn the weak tenant-signal finding into a targeted verification plan before treating it as a confirmed leak"
          : `turn the ${weakSignalCount} weak tenant-signal findings into a targeted verification plan before treating them as confirmed leaks`,
    };
  }

  return null;
}

function collectTenantSignals(profile: ProjectProfile | null): string[] {
  const signals = new Set<string>(DEFAULT_TENANT_SIGNAL_TOKENS);
  const configured = profile?.authz?.tenantForeignKey?.trim();
  if (configured) {
    signals.add(configured.toLowerCase());
    signals.add(configured.replace(/_/g, "").toLowerCase());
  }
  return Array.from(signals).sort((left, right) => left.localeCompare(right));
}

function collectProtectedTables(snapshot: SchemaSnapshot, tenantSignals: string[]): ProtectedTableRecord[] {
  const signalSet = new Set(tenantSignals);
  const out: ProtectedTableRecord[] = [];

  for (const [schemaName, namespace] of Object.entries(snapshot.ir.schemas)) {
    for (const table of namespace.tables ?? []) {
      const tenantColumns = table.columns
        .map((column) => column.name)
        .filter((column) => signalSet.has(column.toLowerCase()));
      if (tenantColumns.length === 0) {
        continue;
      }
      out.push({
        table,
        tenantColumnsLower: tenantColumns.map((column) => column.toLowerCase()),
        protectedTable: {
          tableKey: `${schemaName}.${table.name}`,
          tenantColumns,
          rlsEnabled: table.rls?.rlsEnabled ?? false,
          policyCount: table.rls?.policies.length ?? 0,
          evidenceRefs: tableSourceRefs(table),
        },
      });
    }
  }

  return out.sort((left, right) =>
    left.protectedTable.tableKey.localeCompare(right.protectedTable.tableKey),
  );
}

function collectTableFindings(args: {
  protectedTable: ProtectedTableRecord;
  tenantSignals: string[];
  findings: TenantLeakAuditFinding[];
  reviewedSurfaces: TenantLeakAuditReviewedSurface[];
}): void {
  const { protectedTable, tenantSignals, findings, reviewedSurfaces } = args;
  const tableKey = protectedTable.protectedTable.tableKey;
  const evidenceRefs = protectedTable.protectedTable.evidenceRefs;
  const rls = protectedTable.table.rls;

  if (!rls?.rlsEnabled) {
    findings.push(
      createFinding({
        strength: "direct_evidence",
        surfaceKind: "table",
        surfaceKey: tableKey,
        code: "table_rls_disabled",
        message: `Tenant-keyed table \`${tableKey}\` does not have RLS enabled.`,
        evidenceRefs,
        tenantSignals: protectedTable.protectedTable.tenantColumns,
        metadata: {
          tenantColumns: protectedTable.protectedTable.tenantColumns,
        },
      }),
    );
    return;
  }

  if (rls.policies.length === 0) {
    findings.push(
      createFinding({
        strength: "direct_evidence",
        surfaceKind: "table",
        surfaceKey: tableKey,
        code: "table_rls_policy_missing",
        message: `Tenant-keyed table \`${tableKey}\` has RLS enabled but no policies.`,
        evidenceRefs,
        tenantSignals: protectedTable.protectedTable.tenantColumns,
      }),
    );
    return;
  }

  const matchingPolicies = rls.policies.filter((policy) =>
    containsTenantSignal(
      [policy.usingExpression, policy.withCheckExpression, policy.roles.join(" ")].filter((value): value is string => Boolean(value)).join(" "),
      tenantSignals,
    ),
  );

  if (matchingPolicies.length === 0) {
    findings.push(
      createFinding({
        strength: "weak_signal",
        surfaceKind: "table",
        surfaceKey: tableKey,
        code: "table_policies_missing_tenant_signal",
        message: `Tenant-keyed table \`${tableKey}\` has RLS policies, but none mention a known tenant signal.`,
        evidenceRefs,
        tenantSignals: protectedTable.protectedTable.tenantColumns,
        metadata: {
          policyNames: rls.policies.map((policy) => policy.name),
        },
      }),
    );
    return;
  }

  reviewedSurfaces.push({
    surfaceKind: "table",
    surfaceKey: tableKey,
    classification: "not_a_leak",
    reason: `RLS policies on \`${tableKey}\` include tenant-scoping signals.`,
    evidenceRefs,
    metadata: {
      matchingPolicyNames: matchingPolicies.map((policy) => policy.name),
    },
  });
}

function collectRpcFindings(args: {
  ref: FunctionTableRef;
  rpcRecord: RpcRecord | null;
  protectedTable: ProtectedTableRecord;
  schemaObjects: ResolvedSchemaObjectRecord[];
  projectStore: ProjectStore;
  routesByFile: Map<string, ResolvedRouteRecord>;
  tenantSignals: string[];
  findings: TenantLeakAuditFinding[];
  reviewedSurfaces: TenantLeakAuditReviewedSurface[];
}): void {
  const {
    ref,
    rpcRecord,
    protectedTable,
    schemaObjects,
    projectStore,
    routesByFile,
    tenantSignals,
    findings,
    reviewedSurfaces,
  } = args;
  // `buildRpcKey` already embeds the schema (`schema.name(argTypes)`), so
  // `rpcSurfaceKey` is just the key itself. Previously this prepended
  // `${ref.rpcSchema}.` which produced `public.public.name(...)` in every
  // operator finding message and broke cross-linking against graph node
  // keys. Keep surfaceKey aligned with the graph's rpc node key.
  const rpcSurfaceKey = buildRpcKey(ref.rpcSchema, ref.rpcName, ref.argTypes);
  const rpcEvidenceRefs = dedupeStrings([
    ...(rpcRecord ? rpcSourceRefs(rpcRecord.rpc) : [`rpc:${rpcSurfaceKey}`]),
    ...protectedTable.protectedTable.evidenceRefs,
  ]);
  const rpcBodyHasSignal = containsTenantSignal(rpcRecord?.rpc.bodyText ?? "", tenantSignals);

  if (rpcBodyHasSignal) {
    reviewedSurfaces.push({
      surfaceKind: "rpc",
      surfaceKey: rpcSurfaceKey,
      classification: "not_a_leak",
      reason: `RPC \`${rpcSurfaceKey}\` includes tenant-scoping signals while touching protected table \`${protectedTable.protectedTable.tableKey}\`.`,
      evidenceRefs: rpcEvidenceRefs,
      metadata: {
        tableKey: protectedTable.protectedTable.tableKey,
      },
    });
  } else {
    findings.push(
      createFinding({
        strength: "weak_signal",
        surfaceKind: "rpc",
        surfaceKey: rpcSurfaceKey,
        code: "rpc_touches_protected_table_without_tenant_signal",
        message: `RPC \`${rpcSurfaceKey}\` touches protected table \`${protectedTable.protectedTable.tableKey}\` without an obvious tenant-scoping signal in its body.`,
        evidenceRefs: rpcEvidenceRefs,
        tenantSignals: protectedTable.protectedTable.tenantColumns,
        metadata: {
          tableKey: protectedTable.protectedTable.tableKey,
          argTypes: ref.argTypes,
        },
      }),
    );
  }

  const rpcObject = schemaObjects.find(
    (object) =>
      object.objectType === "rpc" &&
      object.schemaName === ref.rpcSchema &&
      object.objectName === ref.rpcName,
  );
  if (!rpcObject) {
    return;
  }

  for (const usage of projectStore.listSchemaUsages(rpcObject.objectId)) {
    if (containsTenantSignal(usage.excerpt ?? "", tenantSignals)) {
      continue;
    }
    const route = routesByFile.get(usage.filePath);
    const surfaceKind: TenantLeakAuditSurfaceKind = route ? "route" : "file";
    const surfaceKey = route ? route.routeKey : usage.filePath;
    const evidenceRefs = dedupeStrings([
      formatPathLineRef(usage.filePath, usage.line),
      ...rpcEvidenceRefs,
    ]);
    findings.push(
      createFinding({
        strength: "weak_signal",
        surfaceKind,
        surfaceKey,
        code: route ? "route_rpc_usage_missing_tenant_signal" : "file_rpc_usage_missing_tenant_signal",
        message: route
          ? `Route \`${route.routeKey}\` calls RPC \`${rpcSurfaceKey}\` without an obvious tenant-scoping signal near the usage site.`
          : `File \`${usage.filePath}\` calls RPC \`${rpcSurfaceKey}\` without an obvious tenant-scoping signal near the usage site.`,
        evidenceRefs,
        tenantSignals: protectedTable.protectedTable.tenantColumns,
        metadata: {
          rpcKey: rpcSurfaceKey,
          usageKind: usage.usageKind,
          ...(typeof usage.line === "number" ? { line: usage.line } : {}),
        },
      }),
    );
  }
}

function createFinding(input: Omit<TenantLeakAuditFinding, "findingId">): TenantLeakAuditFinding {
  return {
    ...input,
    evidenceRefs: dedupeStrings(input.evidenceRefs),
    tenantSignals: dedupeStrings(input.tenantSignals),
    findingId: `tenant_finding_${hashJson({
      surfaceKind: input.surfaceKind,
      surfaceKey: input.surfaceKey,
      code: input.code,
      evidenceRefs: dedupeStrings(input.evidenceRefs),
    })}`,
  };
}

function buildAuditBasis(
  latestIndexRunId: string | null,
  snapshot: SchemaSnapshot | null,
): TenantLeakAuditBasis {
  return {
    latestIndexRunId,
    schemaSnapshotId: snapshot?.snapshotId ?? null,
    schemaFingerprint: snapshot?.fingerprint ?? null,
  };
}

function findRpc(snapshot: SchemaSnapshot, ref: FunctionTableRef): RpcRecord | null {
  const namespace = snapshot.ir.schemas[ref.rpcSchema];
  if (!namespace) {
    return null;
  }
  const rpc = namespace.rpcs.find(
    (entry) =>
      entry.name === ref.rpcName &&
      stringifyArgTypes(entry.argTypes) === stringifyArgTypes(ref.argTypes),
  );
  if (!rpc) {
    return null;
  }
  return { schema: ref.rpcSchema, rpc };
}

function tableSourceRefs(table: SchemaTable): string[] {
  const refs = table.sources.map(formatSchemaSourceRef).filter((value): value is string => Boolean(value));
  return refs.length > 0 ? refs : [`table:${table.schema}.${table.name}`];
}

function rpcSourceRefs(rpc: SchemaRpc): string[] {
  const refs = rpc.sources.map(formatSchemaSourceRef).filter((value): value is string => Boolean(value));
  return refs.length > 0 ? refs : [`rpc:${buildRpcKey(rpc.schema, rpc.name, rpc.argTypes)}`];
}

function formatSchemaSourceRef(source: SchemaSourceRef | undefined): string | null {
  if (!source?.path) {
    return null;
  }
  return typeof source.line === "number" ? `${source.path}:${source.line}` : source.path;
}

function formatPathLineRef(filePath: string, line?: number): string {
  return typeof line === "number" ? `${filePath}:${line}` : filePath;
}

function containsTenantSignal(text: string, tenantSignals: string[]): boolean {
  if (!text) {
    return false;
  }
  const normalized = stripSqlComments(text).toLowerCase();
  if (COMMON_TENANT_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return tenantSignals.some((signal) =>
    new RegExp(`(^|[^a-z0-9_])${escapeRegex(signal.toLowerCase())}([^a-z0-9_]|$)`).test(normalized),
  );
}

function stripSqlComments(text: string): string {
  return text
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRpcKey(schema: string, name: string, argTypes?: string[]): string {
  const args = argTypes ?? [];
  return `${schema}.${name}(${args.join(",")})`;
}

function stringifyArgTypes(argTypes?: string[]): string {
  return JSON.stringify(argTypes ?? []);
}

function dedupeStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function compareFindings(left: TenantLeakAuditFinding, right: TenantLeakAuditFinding): number {
  if (left.strength !== right.strength) {
    return left.strength === "direct_evidence" ? -1 : 1;
  }
  if (left.surfaceKind !== right.surfaceKind) {
    return left.surfaceKind.localeCompare(right.surfaceKind);
  }
  if (left.surfaceKey !== right.surfaceKey) {
    return left.surfaceKey.localeCompare(right.surfaceKey);
  }
  return left.code.localeCompare(right.code);
}

function compareReviewedSurfaces(
  left: TenantLeakAuditReviewedSurface,
  right: TenantLeakAuditReviewedSurface,
): number {
  if (left.surfaceKind !== right.surfaceKind) {
    return left.surfaceKind.localeCompare(right.surfaceKind);
  }
  return left.surfaceKey.localeCompare(right.surfaceKey);
}
