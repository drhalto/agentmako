import { Entry } from "@napi-rs/keyring";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@mako-ai/config";
import { ProjectManifestSchema, type JsonValue, type ProjectLocatorInput, type ProjectManifest } from "@mako-ai/contracts";
import {
  PgConnectionError,
  resolveFunction,
  resolveTable,
  withReadOnlyConnection,
  type PgObjectCandidate,
  type PgReadContext,
  type PgResolvedFunction,
  type PgResolvedTable,
} from "@mako-ai/extension-postgres";
import { MakoToolError } from "../errors.js";
import { borrowGlobalStore, resolveProjectFromToolContext, type ToolServiceOptions } from "../runtime.js";

export interface DbRuntimeOptions extends ToolServiceOptions {}

const KEYCHAIN_SERVICE_NAME = "mako-ai";
const PROJECT_MANIFEST_DIRNAME = ".mako";
const PROJECT_MANIFEST_FILENAME = "project.json";

interface NormalizedDbIdentifier {
  name: string;
  schema?: string;
}

function invalidToolInput(path: string, message: string): never {
  throw new MakoToolError(400, "invalid_tool_input", "Tool input validation failed.", {
    issues: [{ path, message }],
  });
}

function normalizeDbIdentifier(fieldPath: "table" | "name", rawName: string, schema?: string): NormalizedDbIdentifier {
  const trimmedName = rawName.trim();
  const trimmedSchema = schema?.trim();

  if (!trimmedName.includes(".")) {
    return {
      name: trimmedName,
      schema: trimmedSchema,
    };
  }

  const segments = trimmedName.split(".");
  if (segments.length !== 2 || segments.some((segment) => segment.trim() === "")) {
    invalidToolInput(fieldPath, `Invalid qualified identifier in \`${fieldPath}\`; expected \`schema.name\`.`);
  }

  const [qualifiedSchema, qualifiedName] = segments.map((segment) => segment.trim());
  if (trimmedSchema != null && trimmedSchema !== qualifiedSchema) {
    invalidToolInput(
      "schema",
      `Conflicting schema inputs: \`${fieldPath}\` specifies schema \`${qualifiedSchema}\` but \`schema\` is \`${trimmedSchema}\`.`,
    );
  }

  return {
    name: qualifiedName,
    schema: trimmedSchema ?? qualifiedSchema,
  };
}

function formatResolvedName(name: string, schema?: string): string {
  return schema ? `${schema}.${name}` : name;
}

export function requireDatabaseUrl(options: DbRuntimeOptions): string {
  const config = loadConfig(options.configOverrides);

  if (!config.databaseTools.enabled) {
    throw new MakoToolError(
      412,
      "db_not_connected",
      "Database tools are disabled. Set MAKO_DB_TOOLS_ENABLED=true to enable them.",
      { enabled: false },
    );
  }

  throw new MakoToolError(
    500,
    "db_query_failed",
    "Database URL must be resolved from the project's live DB binding.",
  );
}

function readProjectManifest(projectRoot: string): ProjectManifest {
  const manifestPath = join(projectRoot, PROJECT_MANIFEST_DIRNAME, PROJECT_MANIFEST_FILENAME);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch (error) {
    throw new MakoToolError(
      422,
      "db_binding_invalid",
      `Project manifest is missing or unreadable: ${manifestPath}`,
      {
        manifestPath,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const result = ProjectManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new MakoToolError(422, "db_binding_invalid", `Project manifest is invalid: ${manifestPath}`, {
      manifestPath,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  return result.data;
}

function resolveBoundDatabaseUrlFromManifest(manifest: ProjectManifest): string {
  const binding = manifest.database.liveBinding;
  if (!binding.enabled) {
    throw new MakoToolError(
      412,
      "db_binding_not_configured",
      "Live DB binding is not enabled for this project. Run `mako project db bind` first.",
      {
        projectId: manifest.projectId,
        strategy: binding.strategy,
        ref: binding.ref,
      },
    );
  }

  const trimmedRef = binding.ref.trim();
  if (trimmedRef === "") {
    throw new MakoToolError(
      422,
      "db_binding_invalid",
      "Live DB binding has an empty `ref` value.",
      {
        projectId: manifest.projectId,
        strategy: binding.strategy,
      },
    );
  }

  if (binding.strategy === "env_var_ref") {
    const value = process.env[trimmedRef];
    if (value === undefined || value.trim() === "") {
      throw new MakoToolError(
        422,
        "db_binding_invalid",
        `Environment variable \`${trimmedRef}\` is not set or is empty.`,
        {
          projectId: manifest.projectId,
          strategy: binding.strategy,
          ref: trimmedRef,
        },
      );
    }
    return value.trim();
  }

  if (binding.strategy === "keychain_ref") {
    try {
      const value = new Entry(KEYCHAIN_SERVICE_NAME, trimmedRef).getPassword();
      if (value === null || value.trim() === "") {
        throw new MakoToolError(
          422,
          "db_binding_invalid",
          `Keychain entry \`${trimmedRef}\` has no stored credential. Run \`mako project db bind\` first.`,
          {
            projectId: manifest.projectId,
            strategy: binding.strategy,
            ref: trimmedRef,
          },
        );
      }
      return value.trim();
    } catch (error) {
      if (error instanceof MakoToolError) {
        throw error;
      }
      throw new MakoToolError(
        422,
        "db_binding_invalid",
        `Failed to read keychain entry \`${trimmedRef}\`: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: manifest.projectId,
          strategy: binding.strategy,
          ref: trimmedRef,
        },
      );
    }
  }

  throw new MakoToolError(
    422,
    "db_binding_invalid",
    `Unknown binding strategy: ${String((binding as { strategy: unknown }).strategy)}`,
    {
      projectId: manifest.projectId,
      binding: {
        strategy: String(binding.strategy),
        ref: binding.ref,
        enabled: binding.enabled,
      },
    },
  );
}

async function resolveBoundDatabaseUrl(
  locator: ProjectLocatorInput,
  options: DbRuntimeOptions,
): Promise<string> {
  const project = await resolveProjectFromToolContext(locator, options);
  const manifest = readProjectManifest(project.canonicalPath);
  return resolveBoundDatabaseUrlFromManifest(manifest);
}

export function isDbToolAvailableForSession(options: DbRuntimeOptions): boolean {
  const config = loadConfig(options.configOverrides);
  if (!config.databaseTools.enabled) {
    return false;
  }

  const sessionProjectId = options.requestContext?.sessionProjectId;
  if (!sessionProjectId) {
    return false;
  }

  try {
    return borrowGlobalStore(options, (store) => {
      const project = store.getProjectById(sessionProjectId);
      if (!project) return false;
      const manifest = readProjectManifest(project.canonicalPath);
      resolveBoundDatabaseUrlFromManifest(manifest);
      return true;
    });
  } catch {
    return false;
  }
}

function translatePgConnectionError(error: PgConnectionError): MakoToolError {
  switch (error.code) {
    case "db_connect_failed":
      return new MakoToolError(503, "db_not_connected", error.message, { pgCode: "db_connect_failed" });
    case "db_permission_denied":
      return new MakoToolError(403, "db_permission_denied", error.message, {});
    case "db_unsupported_target":
      return new MakoToolError(400, "db_unsupported_target", error.message, {});
    default:
      return new MakoToolError(500, "db_query_failed", error.message, {});
  }
}

export async function withDbContext<T>(
  locator: ProjectLocatorInput,
  options: DbRuntimeOptions,
  callback: (context: PgReadContext) => Promise<T>,
): Promise<T> {
  const config = loadConfig(options.configOverrides);
  if (!config.databaseTools.enabled) {
    throw new MakoToolError(
      412,
      "db_not_connected",
      "Database tools are disabled. Set MAKO_DB_TOOLS_ENABLED=true to enable them.",
      { enabled: false },
    );
  }

  const databaseUrl = await resolveBoundDatabaseUrl(locator, options);

  try {
    return await withReadOnlyConnection({ databaseUrl }, callback);
  } catch (error) {
    if (error instanceof MakoToolError) {
      throw error;
    }
    if (error instanceof PgConnectionError) {
      throw translatePgConnectionError(error);
    }
    throw error;
  }
}

function candidatesToJson(candidates: PgObjectCandidate[]): JsonValue[] {
  return candidates.map(
    (candidate) => {
      const base = {
        schema: candidate.schema,
        name: candidate.name,
        kind: candidate.kind,
      } as Record<string, JsonValue>;
      if ("argTypes" in candidate) {
        base.argTypes = candidate.argTypes;
        base.signature = candidate.signature;
      }
      return base satisfies JsonValue;
    },
  );
}

function requestedToJson(requested: { schema: string | null; name: string; argTypes?: string[] | null }): JsonValue {
  const base = {
    schema: requested.schema,
    name: requested.name,
  } as Record<string, JsonValue>;
  if (requested.argTypes != null) {
    base.argTypes = requested.argTypes;
  }
  return base satisfies JsonValue;
}

export async function resolveTableOrThrow(
  context: PgReadContext,
  table: string,
  schema?: string,
): Promise<PgResolvedTable> {
  const normalized = normalizeDbIdentifier("table", table, schema);
  const result = await resolveTable(context, normalized.name, normalized.schema);
  if (result.resolved) {
    return result.resolved;
  }

  if (result.candidates.length > 1) {
    throw new MakoToolError(
      400,
      "db_ambiguous_object",
      `Ambiguous table: ${formatResolvedName(normalized.name, normalized.schema)}. Multiple schemas match; pass the "schema" input field to disambiguate.`,
      {
        requested: { schema: result.requested.schema, name: result.requested.name },
        candidates: candidatesToJson(result.candidates),
      },
    );
  }

  throw new MakoToolError(
    404,
    "db_object_not_found",
    `Table not found: ${formatResolvedName(normalized.name, normalized.schema)}`,
    {
      requested: { schema: result.requested.schema, name: result.requested.name },
    },
  );
}

export async function resolveFunctionOrThrow(
  context: PgReadContext,
  name: string,
  schema?: string,
  argTypes?: string[],
): Promise<PgResolvedFunction> {
  const normalized = normalizeDbIdentifier("name", name, schema);
  const result = await resolveFunction(context, normalized.name, normalized.schema, argTypes);
  if (result.resolved) {
    return result.resolved;
  }

  if (result.candidates.length > 1) {
    const disambiguationHints: string[] = [];
    if (normalized.schema == null) {
      disambiguationHints.push('"schema"');
    }
    if (argTypes == null) {
      disambiguationHints.push('"argTypes"');
    }
    const hint =
      disambiguationHints.length > 0
        ? `pass the ${disambiguationHints.join(" and ")} input field${disambiguationHints.length > 1 ? "s" : ""} to disambiguate.`
        : "inspect the candidate signatures and retry with a more specific selector.";
    throw new MakoToolError(
      400,
      "db_ambiguous_object",
      `Ambiguous routine: ${formatResolvedName(normalized.name, normalized.schema)}. Multiple routines match; ${hint}`,
      {
        requested: requestedToJson(result.requested),
        candidates: candidatesToJson(result.candidates),
      },
    );
  }

  throw new MakoToolError(
    404,
    "db_object_not_found",
    `Routine not found: ${formatResolvedName(normalized.name, normalized.schema)}`,
    {
      requested: requestedToJson(result.requested),
    },
  );
}
