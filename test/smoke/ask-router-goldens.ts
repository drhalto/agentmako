import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnswerResult, AskToolOutput, JsonObject } from "@mako-ai/contracts";
import { extractAnswerResultFromToolOutput } from "../../packages/contracts/src/tools.ts";
import { createApiService } from "../../services/api/src/service.ts";
import { createToolService } from "../../packages/tools/src/service.ts";
import { cleanupSmokeStateDir } from "./state-cleanup.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.MAKO_STATE_HOME = os.tmpdir();
const stateDirName = `.mako-ai-ask-goldens-${Date.now()}-${process.pid}`;
const homeStateDir = path.join(os.tmpdir(), stateDirName);
const projectStateDir = path.join(repoRoot, stateDirName);
const repoManifestDir = path.join(repoRoot, ".mako");
const repoManifestExisted = existsSync(repoManifestDir);

function cleanup(): void {
  cleanupSmokeStateDir(homeStateDir);
  cleanupSmokeStateDir(projectStateDir);
  if (!repoManifestExisted) {
    rmSync(repoManifestDir, { recursive: true, force: true });
  }
}

function createOptions(testDatabaseUrl?: string) {
  return {
    configOverrides: {
      stateDirName,
      databaseTools: {
        enabled: Boolean(testDatabaseUrl),
      },
    },
  };
}

interface AskGoldenCase {
  question: string;
  selectedFamily: AskToolOutput["selectedFamily"];
  selectedTool: string;
  selectedArgs: JsonObject;
  mode: AskToolOutput["mode"];
  confidence: number;
  requiresProject: boolean;
  expectedCompanionFamily?: string;
  expectedAttachmentReasonPattern?: RegExp;
  expectedNoCompanion?: boolean;
}

async function runAskCase(
  callAsk: (input: { question: string; projectId?: string }) => Promise<AskToolOutput>,
  projectId: string,
  testCase: AskGoldenCase,
): Promise<void> {
  const input = testCase.requiresProject ? { question: testCase.question, projectId } : { question: testCase.question };
  const result = await callAsk(input);

  assert.equal(result.toolName, "ask");
  assert.equal(result.mode, testCase.mode);
  assert.equal(result.selectedFamily, testCase.selectedFamily);
  assert.equal(result.selectedTool, testCase.selectedTool);
  assert.equal(result.confidence, testCase.confidence);
  assert.deepEqual(result.selectedArgs, testCase.selectedArgs);

  if (result.mode === "tool") {
    assert.equal((result.result as { toolName: string }).toolName, testCase.selectedTool);
    if (testCase.expectedCompanionFamily) {
      const answerResult = extractAnswerResultFromToolOutput(result.result);
      assert.ok(
        answerResult?.companionPacket,
        `expected ${testCase.selectedTool} to surface a companion workflow packet through ask`,
      );
      assert.equal(answerResult?.companionPacket?.packet.family, testCase.expectedCompanionFamily);
      if (testCase.expectedAttachmentReasonPattern) {
        assert.match(
          answerResult?.companionPacket?.attachmentReason ?? "",
          testCase.expectedAttachmentReasonPattern,
          "expected ask to preserve the companion attachment reason",
        );
      }
    } else if (testCase.expectedNoCompanion) {
      const answerResult = extractAnswerResultFromToolOutput(result.result);
      assert.equal(
        answerResult?.companionPacket,
        undefined,
        `expected ${testCase.selectedTool} to avoid attaching a default companion packet`,
      );
    }
    assert.equal(result.fallbackReason, null);
    return;
  }

  const fallbackResult = result.result as unknown as AnswerResult;
  assert.equal(fallbackResult.queryKind, "free_form");
  assert.equal(result.fallbackReason, "No deterministic named-tool pattern matched the question.");
}

async function main(): Promise<void> {
  cleanup();
  let api: ReturnType<typeof createApiService> | undefined;
  let toolService: ReturnType<typeof createToolService> | undefined;
  try {
    const testDatabaseUrl = process.env.MAKO_TEST_DATABASE_URL?.trim() || undefined;
    const options = createOptions(testDatabaseUrl);
    api = createApiService(options);
    toolService = createToolService(options);
    const activeToolService = toolService;

    api.attachProject(repoRoot);
    await api.indexProject(repoRoot);

    const status = api.getProjectStatus(repoRoot);
    assert.ok(status?.project, "expected attached project for ask goldens");
    const projectId = status.project.projectId;

    const callAsk = async (input: { question: string; projectId?: string }): Promise<AskToolOutput> => {
      return (await activeToolService.callTool("ask", input)) as AskToolOutput;
    };

  const dbCases: AskGoldenCase[] = [
    {
      question: "columns of public.study_tracks",
      selectedFamily: "db",
      selectedTool: "db_columns",
      selectedArgs: { projectId, table: "public.study_tracks" },
      mode: "tool",
      confidence: 0.97,
      requiresProject: true,
    },
    {
      question: "schema for public.study_tracks",
      selectedFamily: "db",
      selectedTool: "db_table_schema",
      selectedArgs: { projectId, table: "public.study_tracks" },
      mode: "tool",
      confidence: 0.96,
      requiresProject: true,
    },
    {
      question: "what foreign keys does courses have",
      selectedFamily: "db",
      selectedTool: "db_fk",
      selectedArgs: { projectId, table: "courses" },
      mode: "tool",
      confidence: 0.95,
      requiresProject: true,
    },
    {
      question: "show policies for courses",
      selectedFamily: "db",
      selectedTool: "db_rls",
      selectedArgs: { projectId, table: "courses" },
      mode: "tool",
      confidence: 0.96,
      requiresProject: true,
    },
    {
      question: "show rpc get_student_profile",
      selectedFamily: "db",
      selectedTool: "db_rpc",
      selectedArgs: { projectId, name: "get_student_profile" },
      mode: "tool",
      confidence: 0.94,
      requiresProject: true,
    },
  ];

  const routeAuthCases: AskGoldenCase[] = [
    {
      question: "where is /api/v1/projects handled",
      selectedFamily: "answers",
      selectedTool: "route_trace",
      selectedArgs: { projectId, route: "/api/v1/projects" },
      mode: "tool",
      confidence: 0.97,
      requiresProject: true,
      expectedCompanionFamily: "verification_plan",
      expectedAttachmentReasonPattern: /queryKind=route_trace/,
    },
    {
      question: "trace route /api/v1/projects",
      selectedFamily: "answers",
      selectedTool: "route_trace",
      selectedArgs: { projectId, route: "/api/v1/projects" },
      mode: "tool",
      confidence: 0.97,
      requiresProject: true,
    },
    {
      question: "what handles /api/v1/projects",
      selectedFamily: "answers",
      selectedTool: "route_trace",
      selectedArgs: { projectId, route: "/api/v1/projects" },
      mode: "tool",
      confidence: 0.97,
      requiresProject: true,
    },
    {
      question: "where is /api/v1/projects handled?",
      selectedFamily: "answers",
      selectedTool: "route_trace",
      selectedArgs: { projectId, route: "/api/v1/projects" },
      mode: "tool",
      confidence: 0.97,
      requiresProject: true,
    },
    {
      question: "what auth protects /api/v1/projects",
      selectedFamily: "answers",
      selectedTool: "auth_path",
      selectedArgs: { projectId, route: "/api/v1/projects" },
      mode: "tool",
      confidence: 0.96,
      requiresProject: true,
      expectedNoCompanion: true,
    },
    {
      question: "auth path for services/api/src/routes.ts",
      selectedFamily: "answers",
      selectedTool: "auth_path",
      selectedArgs: { projectId, file: "services/api/src/routes.ts" },
      mode: "tool",
      confidence: 0.95,
      requiresProject: true,
      expectedNoCompanion: true,
    },
  ];

  const importSymbolCases: AskGoldenCase[] = [
    {
      question: "what does services/api/src/server.ts import",
      selectedFamily: "imports",
      selectedTool: "imports_deps",
      selectedArgs: { projectId, file: "services/api/src/server.ts" },
      mode: "tool",
      confidence: 0.97,
      requiresProject: true,
    },
    {
      question: "what does services/api/src/server.ts import?",
      selectedFamily: "imports",
      selectedTool: "imports_deps",
      selectedArgs: { projectId, file: "services/api/src/server.ts" },
      mode: "tool",
      confidence: 0.97,
      requiresProject: true,
    },
    {
      question: "what depends on services/api/src/server.ts",
      selectedFamily: "imports",
      selectedTool: "imports_impact",
      selectedArgs: { projectId, file: "services/api/src/server.ts" },
      mode: "tool",
      confidence: 0.97,
      requiresProject: true,
    },
    {
      question: "what depends on services/api/src/server.ts?",
      selectedFamily: "imports",
      selectedTool: "imports_impact",
      selectedArgs: { projectId, file: "services/api/src/server.ts" },
      mode: "tool",
      confidence: 0.97,
      requiresProject: true,
    },
    {
      question: "import hotspots",
      selectedFamily: "imports",
      selectedTool: "imports_hotspots",
      selectedArgs: { projectId },
      mode: "tool",
      confidence: 0.95,
      requiresProject: true,
    },
    {
      question: "show import cycles",
      selectedFamily: "imports",
      selectedTool: "imports_cycles",
      selectedArgs: { projectId },
      mode: "tool",
      confidence: 0.95,
      requiresProject: true,
    },
    {
      question: "symbols in services/api/src/server.ts",
      selectedFamily: "symbols",
      selectedTool: "symbols_of",
      selectedArgs: { projectId, file: "services/api/src/server.ts" },
      mode: "tool",
      confidence: 0.96,
      requiresProject: true,
    },
    {
      question: "symbols in services/api/src/server.ts?",
      selectedFamily: "symbols",
      selectedTool: "symbols_of",
      selectedArgs: { projectId, file: "services/api/src/server.ts" },
      mode: "tool",
      confidence: 0.96,
      requiresProject: true,
    },
    {
      question: "exports of apps/cli/src/index.ts",
      selectedFamily: "symbols",
      selectedTool: "exports_of",
      selectedArgs: { projectId, file: "apps/cli/src/index.ts" },
      mode: "tool",
      confidence: 0.96,
      requiresProject: true,
    },
  ];

  const schemaFileCases: AskGoldenCase[] = [
    {
      question: "where is projects used",
      selectedFamily: "answers",
      selectedTool: "schema_usage",
      selectedArgs: { projectId, object: "projects" },
      mode: "tool",
      confidence: 0.9,
      requiresProject: true,
    },
    {
      question: "where is project_aliases referenced",
      selectedFamily: "answers",
      selectedTool: "schema_usage",
      selectedArgs: { projectId, object: "project_aliases" },
      mode: "tool",
      confidence: 0.9,
      requiresProject: true,
    },
    {
      question: "what code uses answer_traces",
      selectedFamily: "answers",
      selectedTool: "schema_usage",
      selectedArgs: { projectId, object: "answer_traces" },
      mode: "tool",
      confidence: 0.9,
      requiresProject: true,
    },
    {
      question: "what does services/api/src/server.ts do",
      selectedFamily: "answers",
      selectedTool: "file_health",
      selectedArgs: { projectId, file: "services/api/src/server.ts" },
      mode: "tool",
      confidence: 0.91,
      requiresProject: true,
      expectedCompanionFamily: "verification_plan",
      expectedAttachmentReasonPattern: /queryKind=file_health/,
    },
    {
      question: "file health for services/api/src/routes.ts",
      selectedFamily: "answers",
      selectedTool: "file_health",
      selectedArgs: { projectId, file: "services/api/src/routes.ts" },
      mode: "tool",
      confidence: 0.91,
      requiresProject: true,
    },
    {
      question: "file health for services/api/src/routes.ts!",
      selectedFamily: "answers",
      selectedTool: "file_health",
      selectedArgs: { projectId, file: "services/api/src/routes.ts" },
      mode: "tool",
      confidence: 0.91,
      requiresProject: true,
    },
  ];

  const composerCases: AskGoldenCase[] = [
    {
      question: "trace file services/api/src/server.ts",
      selectedFamily: "composer",
      selectedTool: "trace_file",
      selectedArgs: { projectId, file: "services/api/src/server.ts" },
      mode: "tool",
      confidence: 0.96,
      requiresProject: true,
      expectedCompanionFamily: "verification_plan",
      expectedAttachmentReasonPattern: /queryKind=trace_file/,
    },
    {
      question: "trace table answer_traces",
      selectedFamily: "composer",
      selectedTool: "trace_table",
      selectedArgs: { projectId, table: "answer_traces" },
      mode: "tool",
      confidence: 0.94,
      requiresProject: true,
    },
    {
      question: "why is instructor attendance window missing on the dashboard",
      selectedFamily: "composer",
      selectedTool: "cross_search",
      selectedArgs: { projectId, term: "attendance window" },
      mode: "tool",
      confidence: 0.72,
      requiresProject: true,
    },
    {
      question: "why does the dashboard sidebar disagree with the page access checks",
      selectedFamily: "composer",
      selectedTool: "cross_search",
      selectedArgs: { projectId, term: "dashboard sidebar" },
      mode: "tool",
      confidence: 0.72,
      requiresProject: true,
    },
  ];

  const fallbackCases: AskGoldenCase[] = [
    {
      question: "how does the API server work overall",
      selectedFamily: "fallback",
      selectedTool: "free_form",
      selectedArgs: { projectId, queryKind: "free_form", queryText: "how does the API server work overall" },
      mode: "fallback",
      confidence: 0.2,
      requiresProject: true,
    },
    {
      question: "summarize the project architecture",
      selectedFamily: "fallback",
      selectedTool: "free_form",
      selectedArgs: { projectId, queryKind: "free_form", queryText: "summarize the project architecture" },
      mode: "fallback",
      confidence: 0.2,
      requiresProject: true,
    },
    {
      question: "what should I refactor first in this repo",
      selectedFamily: "fallback",
      selectedTool: "free_form",
      selectedArgs: { projectId, queryKind: "free_form", queryText: "what should I refactor first in this repo" },
      mode: "fallback",
      confidence: 0.2,
      requiresProject: true,
    },
  ];

    if (testDatabaseUrl) {
      for (const testCase of dbCases) {
        await runAskCase(callAsk, projectId, testCase);
      }
    }

    for (const group of [routeAuthCases, importSymbolCases, schemaFileCases, composerCases, fallbackCases]) {
      for (const testCase of group) {
        await runAskCase(callAsk, projectId, testCase);
      }
    }

    let missingProjectError: unknown;
    try {
      await callAsk({ question: "where is /api/v1/projects handled" });
    } catch (error) {
      missingProjectError = error;
    }

    assert.ok(missingProjectError instanceof Error, "expected missing_project_context error");
    assert.equal((missingProjectError as { code?: string }).code, "missing_project_context");
    assert.equal(
      (missingProjectError as { message?: string }).message,
      "The routed tool `route_trace` requires project context. Provide `projectId` or `projectRef`.",
    );
    assert.deepEqual((missingProjectError as { details?: JsonObject }).details, {
      selectedFamily: "answers",
      selectedTool: "route_trace",
      selectedArgs: { route: "/api/v1/projects" },
    });
  } finally {
    toolService?.close();
    api?.close();
    cleanup();
  }
}

void main().catch((error: unknown) => {
  cleanup();
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
